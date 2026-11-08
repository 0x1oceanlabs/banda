//! The Person's marks on a Thread, kept on the Thread by its host beside
//! its snooze (ADR 0096): for now, that they archived it (step 1a). Each
//! window kept them in its own storage before, so a window on another
//! machine never knew them. Now every window and every Agent reads them in
//! the list. Only the Person marks a Thread: an Agent reads the marks, and
//! sets none.

use crate::model::{Archived, Fact, ThreadId};
use crate::rules::archive::{holds, may_archive};
use crate::rules::snooze::asleep;
use crate::{emit, emit_in_project, snoozes, store};
use banda_kernel::{Call, Error, Participant, Refusal, Tx};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What `agents.import_marks` is asked: the marks a window kept of this
/// Project's Threads before their host kept them, by ID only (ADR 0096,
/// decision 9). A field this host does not know is refused, so a newer
/// window's marks are never dropped unread (decision 8).
#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "agents/")]
pub struct ImportMarks {
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

/// The most marks one move takes: as many as a window kept.
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
    snoozes::wake(tx, author, Some(thread))?;
    store::set_archived(tx.sql(), thread, Some(Archived { at: tx.now() }))?;
    emit(tx, author, thread, &Fact::ThreadArchived { thread })
}

/// Brings `thread` back from Archive for its Person. One not archived
/// stays as it is, and nothing is written.
pub fn unarchive(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    store::thread(tx.sql(), thread)?.ok_or_else(no_thread)?;
    unarchived(tx, author, thread)
}

/// Takes `thread` out of Archive, if it is marked: as its Person brings it
/// back, or as `author` snoozes it (ADR 0074, decision 4).
pub fn unarchived(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    if store::archived(tx.sql(), thread)?.is_none() {
        return Ok(());
    }
    store::set_archived(tx.sql(), thread, None)?;
    emit(tx, author, thread, &Fact::ThreadUnarchived { thread })
}

/// Moves the archives a window kept to the host, once, each from now (ADR
/// 0096, decision 9). A Thread the host does not know or has archived
/// already, one at work or that asks, and one asleep, is left as it is.
/// One fact says marks moved, not one for each: a list reads itself
/// again, as after a rewind.
pub fn import(
    tx: &mut Tx<'_>,
    author: Participant,
    ImportMarks { archived }: ImportMarks,
) -> Result<Imported, Error> {
    if archived.len() > MOST {
        let most = format!("A window moves at most {MOST} marks at once.");
        return Err(Refusal::invalid(most).into());
    }
    let at = tx.now();
    let mut count = 0;
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
/// and has none on it, it is not asleep (ADR 0074, decision 4), and the
/// archive holds, so it neither works nor asks.
fn takes(sql: &Connection, thread: ThreadId, at: i64) -> Result<bool, Error> {
    let Some(summary) = store::thread(sql, thread)? else {
        return Ok(false);
    };
    if store::archived(sql, thread)?.is_some() {
        return Ok(false);
    }
    if store::snooze(sql, thread)?.is_some_and(|snooze| asleep(&snooze, at)) {
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
fn state(sql: &Connection, thread: ThreadId) -> Result<(bool, bool), Error> {
    Ok((
        store::running(sql, thread)?.is_some(),
        store::asks(sql, thread)?,
    ))
}

fn no_thread() -> Refusal {
    Refusal::not_found("There is no such Thread.")
}
