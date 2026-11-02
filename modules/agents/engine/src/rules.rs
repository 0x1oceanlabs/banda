//! The agents module's decisions and state machines. Pure: no database,
//! clock, randomness or Harness protocol. IDs come in from the caller.
//!
//! Here are a turn's rules, and [`next`] moves it; a message
//! ([`message`]) and what an Agent writes to another Thread
//! ([`to_thread`]) have files of their own. A Question's rules are in
//! `questions.rs`, and what a Thread keeps of what a Harness says in
//! `transcript/output.rs`.

use crate::model::{Can, Failure, Opener, TurnId, TurnState, TurnView};
use banda_kernel::Refusal;
use std::collections::HashMap;

pub mod message;
mod moves;
pub mod to_thread;
pub use moves::{Event, Step, Then, TurnFacts, next};

/// Whether a turn has yet to end.
pub fn ongoing(state: TurnState) -> bool {
    matches!(state, TurnState::Queued | TurnState::Running)
}

/// Whether a Person may still change a message, take it back or send it
/// now: only while its turn waits.
pub fn waits(state: TurnState) -> Result<(), Refusal> {
    next(&TurnFacts::of(state), Event::Withdraw).map(drop)
}

/// Whether a waiting message can be changed: one tried again cannot,
/// since a turn already ran it.
pub fn may_change(first: bool) -> Result<(), Refusal> {
    let waiting = TurnFacts {
        first,
        ..TurnFacts::of(TurnState::Queued)
    };
    next(&waiting, Event::Change).map(drop)
}

/// How a turn ended: its state, in plain words why, and what kind of
/// failure it was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ending {
    pub state: TurnState,
    pub reason: Option<String>,
    pub failure: Option<Failure>,
}

impl Ending {
    pub fn new(state: TurnState, reason: Option<&str>) -> Ending {
        Ending {
            state,
            reason: reason.map(str::to_owned),
            failure: None,
        }
    }

    /// A turn a restart cut short.
    pub fn cut_short() -> Ending {
        Ending::new(
            TurnState::Interrupted,
            Some("Banda stopped while the Agent worked."),
        )
    }

    pub fn failed(reason: impl Into<String>, failure: Option<Failure>) -> Ending {
        Ending {
            state: TurnState::Failed,
            reason: Some(reason.into()),
            failure,
        }
    }

    /// A usage limit learns when it resets, `at`, if it does not know.
    pub fn resets(mut self, at: Option<i64>) -> Ending {
        if let Some(Failure::UsageLimit {
            until: until @ None,
        }) = &mut self.failure
        {
            *until = at;
        }
        self
    }
}

/// Whether a Thread may be forked at the end of a turn: the turn ran and
/// ended, and no turn of the Thread runs now (ADR 0027).
pub fn may_fork(state: TurnState, works: bool) -> Result<(), Refusal> {
    let turn = TurnFacts {
        works,
        ..TurnFacts::of(state)
    };
    next(&turn, Event::Fork).map(drop)
}

/// Whether a Thread may go back to before `turn`'s message, one of its
/// `turns` (ADR 0027).
pub fn may_rewind(
    turn: TurnId,
    turns: &[TurnView],
    openers: &HashMap<TurnId, Opener>,
) -> Result<(), Refusal> {
    let (_, found) = facts(turns, openers, false)
        .find(|(one, _)| one.id == turn)
        .ok_or_else(|| Refusal::not_found("There is no such turn."))?;
    next(&found, Event::Rewind).map(drop)
}

/// Whether a turn may be tried again: a Person asked for it, it failed or
/// was cut short, and nothing came after it in its Thread.
pub fn retry(state: TurnState, latest: bool, by_itself: bool) -> Result<(), Refusal> {
    let turn = TurnFacts {
        latest,
        by_itself,
        ..TurnFacts::of(state)
    };
    next(&turn, Event::Retry).map(drop)
}

/// Where a turn stands among its Thread's turns, as its rules need it.
pub struct Position {
    /// No turn ran its message before it: one tried again has a turn
    /// before it.
    pub first: bool,
    /// It is the latest that began, and its message waits for no other.
    pub latest: bool,
}

/// Where `turn` stands among `turns`, in the order they were made. A turn
/// taken back counts for nothing.
pub fn position(turns: &[TurnView], turn: TurnId) -> Position {
    let counted = || turns.iter().filter(|t| t.state != TurnState::Withdrawn);
    let Some(found) = counted().find(|t| t.id == turn) else {
        return Position {
            first: false,
            latest: false,
        };
    };
    let mut its = counted().filter(|t| t.message == found.message);
    let first = its.next().map(|t| t.id) == Some(turn);
    let last = its.next_back().map_or(first, |t| t.id == turn);
    let begun = counted().rfind(|t| t.state != TurnState::Queued);
    Position {
        first,
        latest: last && begun.map(|t| t.id) == Some(turn),
    }
}

/// What the rules know of each of a Thread's `turns`, in the order they
/// were made, who opened each in `openers`.
fn facts<'a>(
    turns: &'a [TurnView],
    openers: &'a HashMap<TurnId, Opener>,
    held: bool,
) -> impl Iterator<Item = (&'a TurnView, TurnFacts)> {
    let works = Works::of(turns, openers, held);
    turns.iter().map(move |turn| {
        let opener = opener_of(openers, turn.id);
        (
            turn,
            works.facts(turn.state, opener, position(turns, turn.id)),
        )
    })
}

/// What the rules know of `turn`, opened by `opener` and asked to stop if
/// `stopping`, among its Thread's `turns`, who opened each in `openers`. A
/// turn not among them yet is new: it waits.
pub fn known(
    turns: &[TurnView],
    openers: &HashMap<TurnId, Opener>,
    held: bool,
    turn: TurnId,
    opener: Opener,
    stopping: bool,
) -> TurnFacts {
    let found = turns.iter().find(|one| one.id == turn);
    let state = found.map_or(TurnState::Queued, |one| one.state);
    TurnFacts {
        stopping,
        ..Works::of(turns, openers, held).facts(state, opener, position(turns, turn))
    }
}

fn opener_of(openers: &HashMap<TurnId, Opener>, turn: TurnId) -> Opener {
    openers.get(&turn).copied().unwrap_or(Opener::Person)
}

/// What the rules know of a Thread, whichever of its turns they look at:
/// whether its queue is held, whether a turn runs, whose, and whether one
/// waits.
#[derive(Clone, Copy)]
struct Works {
    held: bool,
    works: bool,
    own_works: bool,
    waits: bool,
}

impl Works {
    fn of(turns: &[TurnView], openers: &HashMap<TurnId, Opener>, held: bool) -> Works {
        let running = turns.iter().find(|turn| turn.state == TurnState::Running);
        Works {
            held,
            works: running.is_some(),
            own_works: running.is_some_and(|turn| opener_of(openers, turn.id).by_itself()),
            waits: turns.iter().any(|turn| turn.state == TurnState::Queued),
        }
    }

    /// What the rules know of one of its turns, in `state`, opened by
    /// `opener`, standing at `position`.
    fn facts(self, state: TurnState, opener: Opener, position: Position) -> TurnFacts {
        TurnFacts {
            by_itself: opener.by_itself(),
            by_person: opener.by_person(),
            first: position.first,
            latest: position.latest,
            held: self.held,
            works: self.works,
            own_works: self.own_works,
            waits: self.waits,
            ..TurnFacts::of(state)
        }
    }
}

/// What a Person may do with each of a Thread's turns now (ADR 0014,
/// decision 2): what [`next`] accepts of a Person.
pub fn can(turns: &mut [TurnView], openers: &HashMap<TurnId, Opener>, held: bool) {
    let can: Vec<Can> = facts(turns, openers, held)
        .map(|(_, facts)| {
            let takes = |event| next(&facts, event).is_ok();
            Can {
                stop: takes(Event::Stop),
                retry: takes(Event::Retry),
                edit: takes(Event::Change),
                withdraw: takes(Event::Withdraw),
                steer: takes(Event::Steer),
                fork: takes(Event::Fork),
                rewind: takes(Event::Rewind),
            }
        })
        .collect();
    for (turn, can) in turns.iter_mut().zip(can) {
        turn.can = can;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ItemId;

    fn turn(message: ItemId, state: TurnState) -> TurnView {
        TurnView {
            id: TurnId::new(),
            message,
            state,
            reason: None,
            failure: None,
            started: None,
            ended: None,
            plan: false,
            can: Can::default(),
        }
    }

    #[test]
    fn a_person_may_do_with_each_turn_what_its_commands_allow() {
        let (asked, again) = (ItemId::new(), ItemId::new());
        let mut turns = vec![
            turn(asked, TurnState::Failed),
            turn(again, TurnState::Done),
            turn(again, TurnState::Queued),
            turn(ItemId::new(), TurnState::Running),
        ];
        let own = HashMap::from([(turns[3].id, Opener::ByItself)]);
        can(&mut turns, &own, false);
        let [failed, done, retried, by_itself] = [0, 1, 2, 3].map(|i| turns[i].can);
        assert!(!failed.retry, "a turn began after it");
        assert!(!done.stop && !done.retry);
        assert!(
            retried.stop && retried.withdraw && !retried.edit,
            "a turn ran its message"
        );
        assert!(
            by_itself.stop && !by_itself.steer,
            "the Agent went on by itself"
        );
    }

    #[test]
    fn a_usage_limit_learns_when_it_resets_and_nothing_else_does() {
        let limit = |until| Ending::failed("Limit.", Some(Failure::UsageLimit { until }));
        assert_eq!(
            limit(None).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(5) })
        );
        assert_eq!(
            limit(Some(3)).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(3) }),
            "what the failure itself says wins"
        );
        let other = Ending::failed("Down.", Some(Failure::Provider)).resets(Some(5));
        assert_eq!(other.failure, Some(Failure::Provider));
    }
}
