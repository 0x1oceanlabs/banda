//! A Thread put away until a time, or until the turn that runs ends (ADR
//! 0074). The snooze is the Thread's, kept on it, so every window, machine
//! and Agent sees the same one. Whether it still sleeps is worked out
//! from it ([`crate::rules::snooze`]): what calls its Person wakes it
//! early as that fact is written ([`heard`]), and its time needs no timer.

use crate::model::{Fact, Snooze, ThreadId, TurnState, Wake, Woke};
use crate::rules::snooze::{asleep, may_snooze, wake_of, wakes};
use crate::{emit, store};
use banda_kernel::{Error, EventFilter, Heard, Participant, Refusal, Tx, now_ms};
use schemars::JsonSchema;
use serde::Deserialize;
use std::time::Duration;
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
    /// As `until` comes, its latest turn, failed, goes again, as after a
    /// usage limit resets (ADR 0074, decision 8).
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    pub resume: bool,
}

/// Snoozes `thread` for `author`, in place of a snooze it had. An Agent
/// snoozes only its own Thread.
pub fn snooze(tx: &mut Tx<'_>, author: Participant, ask: SnoozeAsk) -> Result<(), Error> {
    let SnoozeAsk {
        thread,
        until,
        resume,
    } = ask;
    may_touch(tx, author, thread)?;
    if resume && until.is_none() {
        return Err(Refusal::invalid("A turn goes on by itself at a time: give `until`.").into());
    }
    // The turn that goes again is the one that failed last, now.
    let resume = match resume {
        false => None,
        true => Some(
            store::turns_in(tx.sql(), thread, TurnState::Failed)?
                .pop()
                .ok_or_else(|| Refusal::conflict("No turn of this Thread failed to go on with."))?
                .id,
        ),
    };
    let asks = store::asks(tx.sql(), thread)?;
    let works = store::running(tx.sql(), thread)?.is_some();
    let at = tx.now();
    may_snooze(asks, works, until, at)?;
    let snooze = Snooze {
        at,
        by: author,
        until,
        woke: None,
        resume,
    };
    store::set_snooze(tx.sql(), thread, &snooze)?;
    let snoozed = Fact::ThreadSnoozed {
        thread,
        until,
        resume,
    };
    emit(tx, author, thread, &snoozed)
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

/// The facts that may bring a turn that goes on by itself: a new snooze.
pub fn snoozed() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(vec!["thread.snoozed".into()]),
    }
}

/// Goes on with each Thread snoozed to go on by itself as its time comes
/// (ADR 0074, decision 8): its failed turn goes again. A time that passed
/// while the engine was off goes as it starts. It hears new snoozes, and
/// stops with its Project.
pub async fn resume(mut heard: Heard) {
    loop {
        let Some(project) = heard.project() else {
            return;
        };
        let due = match project.read(store::resuming).await {
            Ok(due) => due,
            Err(error) => {
                tracing::warn!(%error, "the snoozes that go on were not read");
                return;
            }
        };
        let now = now_ms();
        let times = due.iter().filter_map(|(_, snooze)| snooze.until);
        let next = times.filter(|&until| until > now).min();
        for (thread, _) in due
            .iter()
            .filter(|(_, s)| s.until.is_some_and(|u| u <= now))
        {
            let thread = *thread;
            if let Err(error) = project.write(move |tx| go_on(tx, thread)).await {
                tracing::warn!(%error, "a snoozed Thread's turn did not go on");
            }
        }
        drop(project);
        // Until the next one's time, or a new snooze.
        let wait = next.map_or(Duration::MAX, |at| Duration::from_millis((at - now) as u64));
        if let Ok(Ok(None) | Err(_)) = tokio::time::timeout(wait, heard.next()).await {
            return;
        }
    }
}

/// Sends `thread`'s failed turn again, as the one who snoozed it, once:
/// the snooze no longer goes on after. One that is no longer its latest
/// stays as it is.
fn go_on(tx: &mut Tx<'_>, thread: ThreadId) -> Result<(), Error> {
    let found = store::snooze(tx.sql(), thread)?;
    let Some(mut snooze) = found.filter(|snooze| snooze.woke.is_none()) else {
        return Ok(());
    };
    let Some(turn) = snooze.resume.take() else {
        return Ok(());
    };
    store::set_snooze(tx.sql(), thread, &snooze)?;
    // Refused, it is not tried again: the snooze has gone on once.
    if let Err(error) = crate::retry(tx, snooze.by, turn) {
        tracing::warn!(%error, "a snoozed Thread's failed turn did not go again");
    }
    Ok(())
}
