//! A Thread put away until a time, or until the turn that runs ends (ADR
//! 0074). The snooze is the Thread's, kept on it, so every window, machine
//! and Agent sees the same one. Whether it still sleeps is worked out
//! from it ([`crate::rules::snooze`]): what calls its Person wakes it
//! early as that fact is written ([`heard`]), and its time needs no timer.

use crate::model::{Fact, Snooze, ThreadId, Wake, Woke};
use crate::rules::snooze::{asleep, may_snooze, wake_of, wakes};
use crate::{emit, store};
use banda_kernel::{Error, Participant, Refusal, Tx};
use schemars::JsonSchema;
use serde::Deserialize;
use ts_rs::TS;

/// What `agents.snooze` is asked: a Thread, and until when.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
pub struct SnoozeAsk {
    /// The Thread's ID, as `threads` lists it.
    pub thread: ThreadId,
    /// When it comes back, in milliseconds since the epoch. Leave it out
    /// to snooze a Thread at work until its turn ends.
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub until: Option<i64>,
}

/// Snoozes `thread` for `author`, in place of a snooze it had. An Agent
/// snoozes only its own Thread.
pub fn snooze(tx: &mut Tx<'_>, author: Participant, ask: SnoozeAsk) -> Result<(), Error> {
    let SnoozeAsk { thread, until } = ask;
    may_touch(tx, author, thread)?;
    let asks = store::asks(tx.sql(), thread)?;
    let works = store::running(tx.sql(), thread)?.is_some();
    let at = tx.now();
    may_snooze(asks, works, until, at)?;
    let snooze = Snooze {
        at,
        by: author,
        until,
        woke: None,
    };
    store::set_snooze(tx.sql(), thread, &snooze)?;
    emit(tx, author, thread, &Fact::ThreadSnoozed { thread, until })
}

/// Wakes `thread` now, if it sleeps; one awake stays so, and nothing is
/// written, as `mkdir -p` answers.
pub fn wake(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    may_touch(tx, author, thread)?;
    let now = tx.now();
    match store::snooze(tx.sql(), thread)? {
        Some(snooze) if asleep(&snooze, now) => woke(tx, author, thread, snooze, Wake::Woken),
        _ => Ok(()),
    }
}

/// Wakes `thread` if `fact`, which `author` just wrote, calls its Person:
/// every fact of the module passes here.
pub fn heard(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    fact: &Fact,
) -> Result<(), Error> {
    let Some(by) = wake_of(fact, author) else {
        return Ok(());
    };
    match store::snooze(tx.sql(), thread)? {
        Some(snooze) if wakes(&snooze, by, tx.now()) => woke(tx, author, thread, snooze, by),
        _ => Ok(()),
    }
}

fn woke(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    snooze: Snooze,
    by: Wake,
) -> Result<(), Error> {
    let woke = Some(Woke { at: tx.now(), by });
    store::set_snooze(tx.sql(), thread, &Snooze { woke, ..snooze })?;
    emit(tx, author, thread, &Fact::ThreadWoke { thread, by })
}

/// Whether `author` may snooze or wake `thread`: a Thread there is, and,
/// for an Agent, its own.
fn may_touch(tx: &Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    let (_, its) = store::title_and_agent(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    if author.agent().is_some_and(|agent| agent != its) {
        return Err(Refusal::forbidden("An Agent snoozes only its own Thread.").into());
    }
    Ok(())
}
