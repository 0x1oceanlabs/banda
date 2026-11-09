//! A Thread put away until a time, until the turn that runs ends, or
//! Someday (ADR 0074; ADR 0098, decisions 11 and 12). The Later is the
//! Thread's, kept on it, so every window, machine and Agent sees the same
//! one. Whether it still sleeps is worked out from it
//! ([`crate::rules::later`]): what calls its Person wakes it early as that
//! fact is written ([`heard`]), and its time wakes it on the host
//! ([`crate::time_comes`]); a reader whose clock is ahead of that fact
//! takes it as awake already.
use crate::model::{Fact, Later, ThreadId, TurnId, TurnState, Until, Wake, Woke, WokeSeen};
use crate::rules::later::{asleep, may_put_off, persons_own, sees, wake_of, wakes};
use crate::{emit, store};
use banda_kernel::{Error, Participant, Refusal, Tx};
use schemars::JsonSchema;
use serde::Deserialize;
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
    /// Someday: no time, and it never wakes by itself; a Person's only
    /// (ADR 0098, decision 12).
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    #[schemars(skip)]
    pub someday: bool,
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

/// Puts off `thread` for `author`, in place of a Later it had, even while
/// it asks (ADR 0098, decision 11). An Agent puts off only its own
/// Thread, never Someday or so that it goes on by itself, and not while
/// its Person's goes on.
pub fn later(tx: &mut Tx<'_>, author: Participant, ask: LaterAsk) -> Result<(), Error> {
    let thread = thread_of(tx, author, ask.thread)?;
    may_touch(tx, author, thread)?;
    let at = tx.now();
    let ends = until_of(at, &ask)?;
    let works = store::running(tx.sql(), thread)?.is_some();
    let asks = store::asks(tx.sql(), thread)?;
    may_put_off(author, asks, works, ends, at)?;
    let resume = match ask.resume {
        false => None,
        true => Some(resumed(tx, author, thread, ends)?),
    };
    // Put off, an archived Thread leaves Archive, whoever put it off (ADR
    // 0074, decision 4).
    crate::marks::unarchived(tx, author, thread)?;
    let (until, someday) = ends.kept();
    let later = Later {
        at,
        by: author,
        until,
        someday,
        woke: None,
        resume,
        woke_seen: None,
    };
    store::set_later(tx.sql(), thread, &later)?;
    let fact = Fact::ThreadLater {
        thread,
        until,
        someday,
        resume,
    };
    emit(tx, author, thread, &fact)
}

/// When a Later asked at `now` ends: `after` a while, at `until`,
/// Someday, or with none of them, when the turn that runs ends.
fn until_of(now: i64, ask: &LaterAsk) -> Result<Until, Refusal> {
    match (ask.after.as_deref(), ask.until, ask.someday) {
        (Some(after), None, false) => now
            .checked_add(while_of(after)?)
            .map(Until::At)
            .ok_or_else(|| Refusal::invalid("That while ends past any time Banda can keep.")),
        (None, Some(at), false) => Ok(Until::At(at)),
        (None, None, true) => Ok(Until::Someday),
        (None, None, false) => Ok(Until::Done),
        _ => Err(Refusal::invalid(
            "Give one of `after`, `until` and `someday`.",
        )),
    }
}

/// The turn of `thread` that goes on by itself as `until` comes: the one
/// that failed last, now. Only a Person's Later goes on, at a time
/// (decisions 8 and 10).
fn resumed(
    tx: &Tx<'_>,
    author: Participant,
    thread: ThreadId,
    until: Until,
) -> Result<TurnId, Error> {
    if author.agent().is_some() {
        return Err(Refusal::forbidden(
            "An Agent's Later starts no turn: only its Person's goes on by itself.",
        )
        .into());
    }
    if !matches!(until, Until::At(_)) {
        return Err(Refusal::invalid("A turn goes on by itself at a time: give `until`.").into());
    }
    let failed = store::turns_in(tx.sql(), thread, TurnState::Failed)?.pop();
    let failed =
        failed.ok_or_else(|| Refusal::conflict("No turn of this Thread failed to go on with."))?;
    Ok(failed.id)
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
        Some(later) if asleep(&later, now) => woke(
            tx,
            author,
            thread,
            later,
            Woke {
                at: now,
                by: Wake::Woken,
            },
        ),
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
    let now = tx.now();
    match store::later(tx.sql(), thread)? {
        Some(later) if wakes(&later, by, now) => {
            woke(tx, author, thread, later, Woke { at: now, by })
        }
        _ => Ok(()),
    }
}

/// `thread`, under `later`, woke at `at` by `by`, as `author` says.
pub(crate) fn woke(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    later: Later,
    Woke { at, by }: Woke,
) -> Result<(), Error> {
    let woke = Some(Woke { at, by });
    store::set_later(tx.sql(), thread, &Later { woke, ..later })?;
    let fact = Fact::ThreadWoke {
        thread,
        by,
        at: Some(at),
    };
    emit(tx, author, thread, &fact)
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
    if store::later(tx.sql(), thread)?.is_some_and(|later| persons_own(&later)) {
        return Err(Refusal::forbidden(
            "Your Person put this Thread off to go on by itself, or Someday: only they change that Later.",
        )
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{LaterAsk, until_of};
    use crate::model::Until;

    fn ask(after: Option<&str>, until: Option<i64>, someday: bool) -> LaterAsk {
        LaterAsk {
            thread: None,
            after: after.map(Into::into),
            until,
            someday,
            resume: false,
        }
    }

    #[test]
    fn a_later_ends_after_a_while_at_a_moment_with_its_turn_or_someday() {
        let ends = |after, until, someday| until_of(1_000, &ask(after, until, someday));
        assert_eq!(ends(Some("1m"), None, false), Ok(Until::At(61_000)));
        assert_eq!(ends(None, Some(5_000), false), Ok(Until::At(5_000)));
        assert_eq!(ends(None, None, false), Ok(Until::Done));
        assert_eq!(ends(None, None, true), Ok(Until::Someday));
        assert!(ends(Some("1m"), Some(5_000), false).is_err(), "one only");
        assert!(ends(None, Some(5_000), true).is_err(), "one only");
        assert!(ends(Some("1m"), None, true).is_err(), "one only");
        assert!(ends(Some("soon"), None, false).is_err());
        assert!(
            until_of(i64::MAX, &ask(Some("1m"), None, false)).is_err(),
            "past any time"
        );
    }
}
