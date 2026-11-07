//! A snooze's rules (ADR 0074): when a Thread may be snoozed, and what
//! wakes one before its time. Pure: the caller brings the time.

use crate::model::{Fact, Snooze, TurnState, Wake};
use banda_kernel::{Participant, Refusal};
use banda_look::snooze::LONGEST;

/// Whether a Thread may be snoozed until `until`, or, without it, until
/// the turn that runs ends, at `now`. One that `asks` may not be: what
/// calls its Person is never put away. One snoozed until its turn ends
/// needs a turn that `works`, and none sleeps longer than a year.
pub fn may_snooze(asks: bool, works: bool, until: Option<i64>, now: i64) -> Result<(), Refusal> {
    if asks {
        return Err(Refusal::conflict(
            "This Thread asks its Person: answer it before snoozing it.",
        ));
    }
    match until {
        Some(until) if until <= now => Err(Refusal::invalid("That time has passed.")),
        Some(until) if until.saturating_sub(now) > LONGEST => {
            Err(Refusal::invalid("A snooze lasts a year at most."))
        }
        None if !works => Err(Refusal::conflict(
            "Only a Thread at work can be snoozed until it is done.",
        )),
        _ => Ok(()),
    }
}

/// Whether a Thread sleeps at `now` under `snooze`: nothing woke it, and
/// its time has not come.
pub fn asleep(snooze: &Snooze, now: i64) -> bool {
    snooze.woke.is_none() && snooze.until.is_none_or(|until| until > now)
}

/// Whether `snooze` is its Person's that goes on by itself (ADR 0074,
/// decision 8), and has not yet: nothing woke it, and its turn has not
/// gone again. While it is, it stays theirs to change.
pub fn goes_on(snooze: &Snooze) -> bool {
    matches!(snooze.by, Participant::Person(_)) && snooze.woke.is_none() && snooze.resume.is_some()
}

/// What `fact`, by `author`, would wake a snoozed Thread for: what
/// calls its Person, or the end of a turn. Most facts, as a reply that
/// grows, wake nothing, and need no look at a snooze.
pub fn wake_of(fact: &Fact, author: Participant) -> Option<Wake> {
    match fact {
        Fact::QuestionAsked { .. } => Some(Wake::Question),
        Fact::TurnEnded {
            state: TurnState::Failed,
            ..
        } => Some(Wake::Failure),
        // A message taken back never began a turn.
        Fact::TurnEnded { state, .. } if *state != TurnState::Withdrawn => Some(Wake::Done),
        Fact::MessagePosted { .. } | Fact::MessageSteered { .. }
            if matches!(author, Participant::Person(_)) =>
        {
            Some(Wake::Message)
        }
        _ => None,
    }
}

/// Whether `by` wakes a Thread under `snooze` at `now`: it sleeps, and
/// the end of a turn wakes only one snoozed until it is done.
pub fn wakes(snooze: &Snooze, by: Wake, now: i64) -> bool {
    asleep(snooze, now) && (by != Wake::Done || snooze.until.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ItemId, TurnId, Woke};
    use banda_kernel::{AgentId, PersonId};

    const NOW: i64 = 1_000;

    fn until(until: Option<i64>) -> Snooze {
        Snooze {
            at: NOW - 10,
            by: Participant::Person(PersonId::new()),
            until,
            woke: None,
            resume: None,
        }
    }

    fn ended(state: TurnState) -> Fact {
        Fact::TurnEnded {
            turn: TurnId::new(),
            state,
            reason: None,
            failure: None,
            note: None,
        }
    }

    fn posted() -> Fact {
        Fact::MessagePosted {
            item: ItemId::new(),
            turn: TurnId::new(),
            text: "hi".into(),
            images: Vec::new(),
            answers: false,
        }
    }

    #[test]
    fn a_thread_that_asks_or_a_time_gone_cannot_be_snoozed() {
        assert!(may_snooze(false, false, Some(NOW + 1), NOW).is_ok());
        assert!(may_snooze(true, true, Some(NOW + 1), NOW).is_err());
        assert!(may_snooze(false, false, Some(NOW), NOW).is_err());
        assert!(may_snooze(false, true, None, NOW).is_ok());
        assert!(
            may_snooze(false, false, None, NOW).is_err(),
            "until done needs work"
        );
        assert!(may_snooze(false, false, Some(NOW + LONGEST), NOW).is_ok());
        for later in [NOW + LONGEST + 1, i64::MAX] {
            assert!(
                may_snooze(false, false, Some(later), NOW).is_err(),
                "a year at most"
            );
        }
    }

    #[test]
    fn only_the_persons_snooze_that_has_yet_to_go_on_goes_on() {
        let turn = Some(TurnId::new());
        let going = Snooze {
            resume: turn,
            ..until(Some(NOW + 60))
        };
        assert!(goes_on(&going));
        assert!(!goes_on(&until(Some(NOW + 60))), "it only sleeps");
        let woken = Woke {
            at: NOW,
            by: Wake::Message,
        };
        let woke = Snooze {
            woke: Some(woken),
            ..going.clone()
        };
        assert!(!goes_on(&woke), "woken, it goes on no more");
        let agents = Snooze {
            by: Participant::Agent(AgentId::new()),
            ..going
        };
        assert!(!goes_on(&agents), "an Agent's starts no turn");
    }

    #[test]
    fn it_sleeps_until_its_time_or_what_woke_it() {
        assert!(asleep(&until(Some(NOW + 1)), NOW));
        assert!(!asleep(&until(Some(NOW)), NOW), "its time came");
        assert!(asleep(&until(None), NOW + 1_000_000));
        let woken = Snooze {
            woke: Some(Woke {
                at: NOW,
                by: Wake::Woken,
            }),
            ..until(None)
        };
        assert!(!asleep(&woken, NOW));
    }

    /// What `fact` by `author` wakes a Thread under `snooze` for.
    fn woken(snooze: &Snooze, fact: &Fact, author: Participant, now: i64) -> Option<Wake> {
        wake_of(fact, author).filter(|by| wakes(snooze, *by, now))
    }

    #[test]
    fn what_calls_its_person_wakes_it_and_the_rest_lets_it_sleep() {
        let person = Participant::Person(PersonId::new());
        let agent = Participant::Agent(AgentId::new());
        let timed = until(Some(NOW + 60));
        let asked = Fact::QuestionAsked {
            item: ItemId::new(),
            turn: TurnId::new(),
            title: "Run it?".into(),
            choices: Vec::new(),
            form: None,
            plan: None,
        };
        assert_eq!(woken(&timed, &asked, agent, NOW), Some(Wake::Question));
        let failed = ended(TurnState::Failed);
        assert_eq!(woken(&timed, &failed, agent, NOW), Some(Wake::Failure));
        assert_eq!(woken(&timed, &ended(TurnState::Done), agent, NOW), None);
        assert_eq!(woken(&timed, &posted(), person, NOW), Some(Wake::Message));
        assert_eq!(
            woken(&timed, &posted(), agent, NOW),
            None,
            "another Thread's Agent writing to it is not its Person"
        );
        assert_eq!(
            woken(&timed, &asked, agent, NOW + 60),
            None,
            "awake once its time came"
        );
        let delta = Fact::ReplyGrew {
            item: ItemId::new(),
            turn: TurnId::new(),
            text: "more".into(),
        };
        assert_eq!(wake_of(&delta, agent), None, "a reply that grows");
    }

    #[test]
    fn until_done_any_end_of_a_turn_wakes_it() {
        let agent = Participant::Agent(AgentId::new());
        let done = until(None);
        let end = |state| woken(&done, &ended(state), agent, NOW);
        assert_eq!(end(TurnState::Done), Some(Wake::Done));
        assert_eq!(end(TurnState::Stopped), Some(Wake::Done));
        assert_eq!(
            end(TurnState::Failed),
            Some(Wake::Failure),
            "a failure says so"
        );
        assert_eq!(end(TurnState::Withdrawn), None);
    }
}
