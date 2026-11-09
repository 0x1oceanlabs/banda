//! A Thread put away until a time, or until the turn that runs ends (ADR
//! 0074). The Later is the Thread's, kept on it, so every window, machine
//! and Agent sees the same one. Whether it still sleeps is worked out
//! from it ([`crate::rules::later`]): what calls its Person wakes it
//! early as that fact is written ([`heard`]), and its time needs no timer.

use crate::model::{Fact, Later, ThreadId, TurnState, Wake, Woke, WokeSeen};
use crate::rules::later::{asleep, goes_on, may_put_off, sees, wake_of, wakes};
use crate::{emit, store};
use banda_kernel::{Error, EventFilter, Listener, Participant, Refusal, Tx, now_ms};
use schemars::JsonSchema;
use serde::Deserialize;
use std::time::Duration;
use ts_rs::TS;

/// What `agents.later` is asked: a Thread, and until when.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
pub struct LaterAsk {
    /// The Thread's ID, as `threads` lists it; an Agent's own by default.
    #[serde(default)]
    #[ts(optional)]
    pub thread: Option<ThreadId>,
    /// How long it sleeps: `30m`, `2h`, `1d`.
    #[serde(default)]
    #[ts(optional)]
    pub after: Option<String>,
    /// Or when it comes back, in milliseconds since the epoch. With
    /// neither, a Thread at work sleeps until its turn ends.
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub until: Option<i64>,
    /// As `until` comes, its latest turn, failed, goes again, as after a
    /// usage limit resets (ADR 0074, decision 8).
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    #[schemars(skip)]
    pub resume: bool,
}

/// What `agents.see_woke` is asked: a Thread, and whether its Person
/// dismissed that it woke, or only saw it.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct SeeWokeAsk {
    /// The Thread's ID, as `threads` lists it.
    pub thread: ThreadId,
    /// `seen`, as they look at it, or `dismissed`, as they dismiss its
    /// Pane's line.
    pub seen: WokeSeen,
}

/// What `agents.wake` is asked: a Thread.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
pub struct WakeAsk {
    /// The Thread's ID, as `threads` lists it; an Agent's own by default.
    #[serde(default)]
    #[ts(optional)]
    pub thread: Option<ThreadId>,
}

/// Puts off `thread` for `author`, in place of a Later it had. An Agent
/// puts off only its own Thread, never so that it goes on by itself, and
/// not while its Person's goes on.
pub fn later(tx: &mut Tx<'_>, author: Participant, ask: LaterAsk) -> Result<(), Error> {
    let LaterAsk {
        thread,
        after,
        until,
        resume,
    } = ask;
    let thread = thread_of(tx, author, thread)?;
    may_touch(tx, author, thread)?;
    // An Agent's Later sends nothing and starts no turn (decision 10):
    // only its Person's goes on by itself.
    if resume && author.agent().is_some() {
        return Err(Refusal::forbidden(
            "An Agent's Later starts no turn: only its Person's goes on by itself.",
        )
        .into());
    }
    if after.is_some() && until.is_some() {
        return Err(Refusal::invalid("Give `after` or `until`, not both.").into());
    }
    let until =
        match after.as_deref().map(while_of).transpose()? {
            Some(after) => Some(tx.now().checked_add(after).ok_or_else(|| {
                Refusal::invalid("That while ends past any time Banda can keep.")
            })?),
            None => until,
        };
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
    may_put_off(asks, works, until, at)?;
    // Put off, an archived Thread leaves Archive, whoever put it off (ADR
    // 0074, decision 4).
    crate::marks::unarchived(tx, author, thread)?;
    let later = Later {
        at,
        by: author,
        until,
        woke: None,
        resume,
        woke_seen: None,
    };
    store::set_later(tx.sql(), thread, &later)?;
    let fact = Fact::ThreadLater {
        thread,
        until,
        resume,
    };
    emit(tx, author, thread, &fact)
}

/// The Thread a Later or a wake names, or for an Agent that names none,
/// its own.
fn thread_of(
    tx: &Tx<'_>,
    author: Participant,
    thread: Option<ThreadId>,
) -> Result<ThreadId, Error> {
    match (thread, author) {
        (Some(thread), _) => Ok(thread),
        // A pass of no Thread, as a Harness's process's, has none to put off.
        (None, Participant::Agent(agent)) => store::thread_of(tx.sql(), agent)?.ok_or_else(|| {
            Refusal::forbidden(
                "An Agent puts off or wakes only its own Thread, and this pass names none.",
            )
            .into()
        }),
        (None, Participant::Person(_)) => Err(Refusal::invalid("Name the Thread.").into()),
    }
}

/// `30m`, `2h`, `1d`, `90 minutes`: how long, in milliseconds, as the
/// Later's field reads it (`banda_look::later`), a year at most.
fn while_of(text: &str) -> Result<i64, Refusal> {
    banda_look::later::while_of(text).ok_or_else(|| {
        Refusal::invalid(format!(
            "`after` is how long, up to a year, as 30m, 2h or 1d, not \"{text}\"."
        ))
    })
}

/// Wakes `thread` now, if it sleeps; one awake stays so, and nothing is
/// written, as `mkdir -p` answers. An Agent wakes only its own Thread,
/// its default, and not while its Person's Later goes on.
pub fn wake(tx: &mut Tx<'_>, author: Participant, thread: Option<ThreadId>) -> Result<(), Error> {
    let thread = thread_of(tx, author, thread)?;
    may_touch(tx, author, thread)?;
    let now = tx.now();
    match store::later(tx.sql(), thread)? {
        Some(later) if asleep(&later, now) => woke(tx, author, thread, later, Wake::Woken),
        _ => Ok(()),
    }
}

/// Marks what its Person has seen of `thread` waking by itself (ADR 0074,
/// decisions 3 and 7), on its host, so every window and machine reads the
/// same (ADR 0096). It moves forward only, and only on a Thread that woke
/// by itself: anything else writes nothing, as `agents.read` does.
pub fn see_woke(
    tx: &mut Tx<'_>,
    author: Participant,
    SeeWokeAsk { thread, seen }: SeeWokeAsk,
) -> Result<(), Error> {
    store::thread(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let Some(later) = store::later(tx.sql(), thread)? else {
        return Ok(());
    };
    if !sees(&later, seen, tx.now()) {
        return Ok(());
    }
    let woke_seen = Some(seen);
    store::set_later(tx.sql(), thread, &Later { woke_seen, ..later })?;
    emit(tx, author, thread, &Fact::ThreadWokeSeen { thread, seen })
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
    match store::later(tx.sql(), thread)? {
        Some(later) if wakes(&later, by, tx.now()) => woke(tx, author, thread, later, by),
        _ => Ok(()),
    }
}

fn woke(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    later: Later,
    by: Wake,
) -> Result<(), Error> {
    let woke = Some(Woke { at: tx.now(), by });
    store::set_later(tx.sql(), thread, &Later { woke, ..later })?;
    emit(tx, author, thread, &Fact::ThreadWoke { thread, by })
}

/// Whether `author` may put off or wake `thread`: a Thread there is, and,
/// for an Agent, its own, with no Later of its Person's that goes on by
/// itself: put off again or woken, it would not go on (decision 8).
fn may_touch(tx: &Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    let (_, its) = store::title_and_agent(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let Some(agent) = author.agent() else {
        return Ok(());
    };
    if agent != its {
        return Err(Refusal::forbidden("An Agent puts off or wakes only its own Thread.").into());
    }
    if store::later(tx.sql(), thread)?.is_some_and(|later| goes_on(&later)) {
        return Err(Refusal::forbidden(
            "Your Person put this Thread off to go on by itself: only they change that Later.",
        )
        .into());
    }
    Ok(())
}

/// The name of the module's listener of new Laters.
pub const LISTENER: &str = "laters";

/// The facts that may bring a turn that goes on by itself: a new Later.
pub fn put_off() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(vec!["thread.later".into()]),
    }
}

/// Goes on with each Thread put off to go on by itself as its time comes
/// (ADR 0074, decision 8): its failed turn goes again. A time that passed
/// while the engine was off goes as it starts. It hears new Laters, each
/// acked once the Laters are read again, and stops with its Project.
pub async fn resume(mut heard: Listener) {
    let mut woken: Option<i64> = None;
    loop {
        let Some(project) = heard.project() else {
            return;
        };
        let due = match project.read(store::resuming).await {
            Ok(due) => due,
            Err(error) => {
                tracing::warn!(%error, "the Laters that go on were not read");
                return;
            }
        };
        let now = now_ms();
        let times = due.iter().filter_map(|(_, later)| later.until);
        let next = times.filter(|&until| until > now).min();
        for (thread, _) in due
            .iter()
            .filter(|(_, later)| later.until.is_some_and(|until| until <= now))
        {
            let thread = *thread;
            if let Err(error) = project.write(move |tx| go_on(tx, thread)).await {
                tracing::warn!(%error, "a put-off Thread's turn did not go on");
            }
        }
        drop(project);
        if let Some(seq) = woken.take()
            && let Err(error) = heard.ack_through(seq).await
        {
            tracing::warn!(%error, "the Laters' place in the log was not kept");
        }
        // Until the next one's time, or a new Later.
        let wait = next.map_or(Duration::MAX, |at| Duration::from_millis((at - now) as u64));
        match tokio::time::timeout(wait, heard.next()).await {
            Ok(Ok(Some(event))) => woken = Some(event.seq),
            Ok(Ok(None) | Err(_)) => return,
            Err(_) => {}
        }
    }
}

/// Sends `thread`'s failed turn again, as the one who put it off, once:
/// the Later no longer goes on after. One that is no longer its latest
/// stays as it is.
fn go_on(tx: &mut Tx<'_>, thread: ThreadId) -> Result<(), Error> {
    let found = store::later(tx.sql(), thread)?;
    let Some(mut later) = found.filter(|later| later.woke.is_none()) else {
        return Ok(());
    };
    let Some(turn) = later.resume.take() else {
        return Ok(());
    };
    store::set_later(tx.sql(), thread, &later)?;
    // Refused, it is not tried again: the Later has gone on once.
    if let Err(error) = crate::retry(tx, later.by, turn) {
        tracing::warn!(%error, "a put-off Thread's failed turn did not go again");
    }
    Ok(())
}
