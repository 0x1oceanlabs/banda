//! The Person's marks on a Thread, kept on the Thread by its host beside
//! its Later (ADR 0096): the latest turn they saw, and that they archived
//! it. Each window kept them in its own storage before, so a window on
//! another machine never knew them. Now every window and every Agent reads
//! them in the list. Only the Person marks a Thread: an Agent reads the
//! marks, and sets none.

use crate::model::{Archived, Fact, ThreadId, TurnId};
use crate::rules::archive::{holds, may_archive};
use crate::rules::later::asleep;
use crate::{emit, emit_in_project, laters, store};
use banda_kernel::{Call, Error, Participant, Refusal, Tx};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// What `agents.read` is asked: the Thread, and the turn of it its Person
/// saw settled.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct ReadAsk {
    /// The Thread's ID, as `threads` lists it.
    pub thread: ThreadId,
    /// The turn they saw; without it, the Thread's latest that ended.
    #[serde(default)]
    #[ts(optional)]
    pub turn: Option<TurnId>,
}

/// What `agents.import_marks` is asked: the marks a window kept of this
/// Project's Threads before their host kept them, by ID only (ADR 0096,
/// decision 9). A field this host does not know is refused, so a newer
/// window's marks are never dropped unread (decision 8).
#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "agents/")]
pub struct ImportMarks {
    /// The turn of each Thread the window saw last. Each moves the host's
    /// seen forward, never back.
    #[serde(default)]
    #[ts(as = "Option<BTreeMap<ThreadId, TurnId>>", optional)]
    pub seen: BTreeMap<ThreadId, TurnId>,
    /// The Threads the window showed archived. Each is archived from now.
    #[serde(default)]
    #[ts(as = "Option<Vec<ThreadId>>", optional)]
    pub archived: Vec<ThreadId>,
}

/// What `agents.import_marks` answers: how many marks moved.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Imported {
    pub count: u32,
}

/// The most marks of each kind one move takes: as many as a window kept.
const MOST: usize = 10_000;

/// The Person who calls, or the refusal of an Agent: only a Person marks a
/// Thread (ADR 0096, decision 5), checked before any write, as `switch`
/// checks.
pub fn person(call: &Call) -> Result<Participant, Refusal> {
    let author = call.participant();
    match author.agent() {
        Some(_) => Err(Refusal::forbidden("Only a Person marks a Thread.")),
        None => Ok(author),
    }
}

/// Marks `turn` of `thread` as the latest its Person saw, or without one,
/// the Thread's latest that ended. Seen moves forward only: a turn of
/// another Thread, one that has not ended, or one older than the mark
/// changes nothing, and the mark it holds writes nothing (ADR 0096,
/// decision 2).
pub fn read(
    tx: &mut Tx<'_>,
    author: Participant,
    ReadAsk { thread, turn }: ReadAsk,
) -> Result<(), Error> {
    store::thread(tx.sql(), thread)?.ok_or_else(no_thread)?;
    let turn = match turn {
        Some(turn) => Some(turn),
        None => store::latest_ended(tx.sql(), thread)?,
    };
    let Some(turn) = turn else { return Ok(()) };
    if !forward(tx.sql(), thread, turn)? {
        return Ok(());
    }
    store::set_seen(tx.sql(), thread, Some(turn))?;
    emit(tx, author, thread, &Fact::ThreadSeen { thread, turn })
}

/// Takes back what its Person saw of `thread`, so its latest turn calls
/// them again. One with nothing seen stays as it is, and nothing is
/// written.
pub fn unread(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    store::thread(tx.sql(), thread)?.ok_or_else(no_thread)?;
    if store::seen(tx.sql(), thread)?.is_none() {
        return Ok(());
    }
    store::set_seen(tx.sql(), thread, None)?;
    store::set_cleared(tx.sql(), thread, tx.now())?;
    emit(tx, author, thread, &Fact::ThreadUnseen { thread })
}

/// Whether the seen of `thread` moves to `turn`: one of its turns that
/// ended, later than the one seen names, if that one is there still.
fn forward(sql: &Connection, thread: ThreadId, turn: TurnId) -> Result<bool, Error> {
    let Some(to) = store::ended_turn(sql, thread, turn)? else {
        return Ok(false);
    };
    let from = match store::seen(sql, thread)? {
        Some(seen) => store::ended_turn(sql, thread, seen)?,
        None => None,
    };
    Ok(from.is_none_or(|from| to > from))
}

/// Archives `thread` for its Person, now, and wakes it if it sleeps (ADR
/// 0074, decision 4). A Thread at work, or one that asks, is refused. One
/// archived already, with nothing new since, writes nothing.
pub fn archive(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    let changed = store::thread(tx.sql(), thread)?
        .ok_or_else(no_thread)?
        .updated_at;
    let (works, asks) = state(tx.sql(), thread)?;
    may_archive(works, asks)?;
    if holds(store::archived(tx.sql(), thread)?, changed, works, asks) {
        return Ok(());
    }
    laters::wake(tx, author, Some(thread))?;
    store::set_archived(tx.sql(), thread, Some(Archived { at: tx.now() }))?;
    emit(tx, author, thread, &Fact::ThreadArchived { thread })
}

/// Brings `thread` back from Archive for its Person. One not archived
/// stays as it is, and nothing is written.
pub fn unarchive(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    store::thread(tx.sql(), thread)?.ok_or_else(no_thread)?;
    if unarchived(tx, author, thread)? {
        store::set_cleared(tx.sql(), thread, tx.now())?;
    }
    Ok(())
}

/// Takes `thread` out of Archive, if it is marked: as its Person brings it
/// back, or as `author` puts it off (ADR 0074, decision 4). Says whether it
/// was.
pub fn unarchived(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<bool, Error> {
    if store::archived(tx.sql(), thread)?.is_none() {
        return Ok(false);
    }
    store::set_archived(tx.sql(), thread, None)?;
    emit(tx, author, thread, &Fact::ThreadUnarchived { thread })?;
    Ok(true)
}

/// Moves the marks a window kept to the host, once (ADR 0096, decision 9).
/// A seen moves the host's forward, never back. An archive is from now,
/// where the host has none, and leaves a Thread at work or that asks, and
/// one asleep. Neither touches a Thread the host does not know, nor one
/// its Person took a mark off since the host kept them, so a window that
/// moves its marks again undoes nothing they chose (#853). One fact says
/// marks moved, not one for each: a list reads itself again, as after a
/// rewind.
pub fn import(
    tx: &mut Tx<'_>,
    author: Participant,
    ImportMarks { seen, archived }: ImportMarks,
) -> Result<Imported, Error> {
    if seen.len() > MOST || archived.len() > MOST {
        let most = format!("A window moves at most {MOST} marks of each kind at once.");
        return Err(Refusal::invalid(most).into());
    }
    let at = tx.now();
    let mut count = 0;
    for (thread, turn) in seen {
        if !store::cleared(tx.sql(), thread)? && forward(tx.sql(), thread, turn)? {
            store::set_seen(tx.sql(), thread, Some(turn))?;
            count += 1;
        }
    }
    for thread in archived {
        if takes(tx.sql(), thread, at)? {
            store::set_archived(tx.sql(), thread, Some(Archived { at }))?;
            count += 1;
        }
    }
    if count > 0 {
        emit_in_project(tx, author, &Fact::MarksMoved {})?;
    }
    Ok(Imported { count })
}

/// Whether `thread` takes a window's archive from `at`: the host knows it
/// and has none on it, its Person took none off it, it is not asleep (ADR
/// 0074, decision 4), and the archive holds, so it neither works nor asks.
fn takes(sql: &Connection, thread: ThreadId, at: i64) -> Result<bool, Error> {
    let Some(summary) = store::thread(sql, thread)? else {
        return Ok(false);
    };
    if store::archived(sql, thread)?.is_some() || store::cleared(sql, thread)? {
        return Ok(false);
    }
    if store::later(sql, thread)?.is_some_and(|later| asleep(&later, at)) {
        return Ok(false);
    }
    let (works, asks) = state(sql, thread)?;
    Ok(holds(
        Some(Archived { at }),
        summary.updated_at,
        works,
        asks,
    ))
}

/// Whether `thread` works, and whether it asks its Person.
pub(crate) fn state(sql: &Connection, thread: ThreadId) -> Result<(bool, bool), Error> {
    Ok((
        store::running(sql, thread)?.is_some(),
        store::asks(sql, thread)?,
    ))
}

fn no_thread() -> Refusal {
    Refusal::not_found("There is no such Thread.")
}
