//! A Later's rules (ADR 0074): when a Thread may be put off, and what
//! wakes one before its time. Pure: the caller brings the time.

use crate::model::{Fact, Later, TurnState, Until, Wake, WokeSeen};
use banda_kernel::{Participant, Refusal};
use banda_look::later::LONGEST;

/// Whether a Thread may be put off until `until` at `now`. One that asks
/// may (ADR 0098, decision 11): its Agent waits, and it comes back with
/// the same question; a new call still wakes it early. One put off until
/// its turn ends needs a turn that `works`, and none sleeps longer than a
/// year. Only a Person puts one off Someday (decision 12), or one that
/// asks: its Agent would hide its own question.
pub fn may_put_off(
    by: Participant,
    asks: bool,
    works: bool,
    until: Until,
    now: i64,
) -> Result<(), Refusal> {
    if asks && by.agent().is_some() {
        return Err(Refusal::conflict(
            "Your Person has yet to answer: a Thread that asks is theirs to put off.",
        ));
    }
    match until {
        Until::Someday if by.agent().is_some() => Err(Refusal::forbidden(
            "Only a Person puts a Thread off Someday.",
        )),
        Until::At(at) if at <= now => Err(Refusal::invalid("That time has passed.")),
        Until::At(at) if at.saturating_sub(now) > LONGEST => {
            Err(Refusal::invalid("A Later lasts a year at most."))
        }
        Until::Done if !works => Err(Refusal::conflict(
            "Only a Thread at work can be put off until it is done.",
        )),
        _ => Ok(()),
    }
}

/// Whether a Thread sleeps at `now` under `later`: nothing woke it, and
/// its time has not come.
pub fn asleep(later: &Later, now: i64) -> bool {
    // Until done and Someday keep no time, and sleep on.
    later.woke.is_none() && later.until.is_none_or(|until| until > now)
}

/// Whether a Thread under `later` woke by itself at `now`: its time
/// came, or what calls its Person woke it early. One its Person woke, by
/// hand or by writing to it, did not: they know already.
pub fn woke_by_itself(later: &Later, now: i64) -> bool {
    match later.woke {
        Some(woke) => !matches!(woke.by, Wake::Woken | Wake::Message),
        None => !asleep(later, now),
    }
}

/// Whether its Person seeing `seen` of a Thread under `later` at `now`
/// marks anything: it woke by itself, and the mark moves forward.
pub fn sees(later: &Later, seen: WokeSeen, now: i64) -> bool {
    woke_by_itself(later, now) && later.woke_seen.is_none_or(|was| seen > was)
}

/// Whether `later` is its Person's own while nothing woke it: one that
/// goes on by itself (ADR 0074, decision 8) or Someday (ADR 0098,
/// decision 12). While it is, only they change it or wake it.
pub fn persons_own(later: &Later) -> bool {
    matches!(later.by, Participant::Person(_))
        && later.woke.is_none()
        && (later.resume.is_some() || later.someday)
}

/// What `fact`, by `author`, would wake a put-off Thread for: what
/// calls its Person, or the end of a turn. Most facts, as a reply that
/// grows, wake nothing, and need no look at a Later.
pub fn wake_of(fact: &Fact, author: Participant) -> Option<Wake> {
    match fact {
        Fact::QuestionAsked { .. } => Some(Wake::Question),
        Fact::TurnEnded {
            state: TurnState::Failed,
            ..
        } => Some(Wake::Failure),
        // A message taken back never began a turn.
        Fact::TurnEnded { state, .. } if *state != TurnState::Withdrawn => Some(Wake::Done),
        // Its Person writes to it, or answers what it asked.
        Fact::MessagePosted { .. }
        | Fact::MessageSteered { .. }
        | Fact::QuestionAnswered { .. }
            if matches!(author, Participant::Person(_)) =>
        {
            Some(Wake::Message)
        }
        _ => None,
    }
}

/// Whether `by` wakes a Thread under `later` at `now`: it sleeps, and
/// the end of a turn wakes only one put off until it is done.
pub fn wakes(later: &Later, by: Wake, now: i64) -> bool {
    asleep(later, now) && (by != Wake::Done || later.ends() == Until::Done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ItemId, TurnId, Woke};
    use banda_kernel::{AgentId, PersonId};

    const NOW: i64 = 1_000;

    fn until(until: Option<i64>) -> Later {
        Later {
            at: NOW - 10,
            by: Participant::Person(PersonId::new()),
            until,
            someday: false,
            woke: None,
            resume: None,
            woke_seen: None,
        }
    }

    fn someday() -> Later {
        Later {
            someday: true,
            ..until(None)
        }
    }

    fn ended(state: TurnState) -> Fact {
        Fact::TurnEnded {
            turn: TurnId::new(),
            state,
            reason: None,
            failure: None,
            note: None,
            changed_lines: None,
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
    fn a_time_gone_or_past_a_year_cannot_be_put_off_to_nor_by_an_agent_someday_or_asking() {
        let person = Participant::Person(PersonId::new());
        let agent = Participant::Agent(AgentId::new());
        assert!(may_put_off(person, false, false, Until::At(NOW + 1), NOW).is_ok());
        assert!(may_put_off(person, false, false, Until::At(NOW), NOW).is_err());
        assert!(may_put_off(person, false, true, Until::Done, NOW).is_ok());
        assert!(
            may_put_off(person, false, false, Until::Done, NOW).is_err(),
            "until done needs work"
        );
        assert!(may_put_off(person, false, false, Until::Someday, NOW).is_ok());
        assert!(may_put_off(agent, false, false, Until::Someday, NOW).is_err());
        assert!(may_put_off(agent, false, false, Until::At(NOW + 1), NOW).is_ok());
        assert!(
            may_put_off(person, true, true, Until::Done, NOW).is_ok(),
            "decision 11"
        );
        assert!(may_put_off(agent, true, true, Until::Done, NOW).is_err());
        assert!(may_put_off(person, false, false, Until::At(NOW + LONGEST), NOW).is_ok());
        for later in [NOW + LONGEST + 1, i64::MAX] {
            assert!(
                may_put_off(person, false, false, Until::At(later), NOW).is_err(),
                "a year at most"
            );
        }
    }

    #[test]
    fn someday_sleeps_through_any_time_and_the_end_of_a_turn() {
        let later = someday();
        assert_eq!(later.ends(), Until::Someday);
        assert!(asleep(&later, i64::MAX));
        assert!(!wakes(&later, Wake::Done, NOW));
        assert!(wakes(&later, Wake::Question, NOW));
        assert!(wakes(&later, Wake::Woken, NOW));
    }

    #[test]
    fn only_the_persons_later_that_goes_on_or_someday_is_their_own() {
        let turn = Some(TurnId::new());
        let going = Later {
            resume: turn,
            ..until(Some(NOW + 60))
        };
        assert!(persons_own(&going));
        assert!(persons_own(&someday()));
        assert!(!persons_own(&until(Some(NOW + 60))), "it only sleeps");
        let woken = Woke {
            at: NOW,
            by: Wake::Message,
        };
        let woke = Later {
            woke: Some(woken),
            ..going.clone()
        };
        assert!(!persons_own(&woke), "woken, it goes on no more");
        let agents = Later {
            by: Participant::Agent(AgentId::new()),
            ..going
        };
        assert!(!persons_own(&agents), "an Agent's starts no turn");
    }

    #[test]
    fn it_sleeps_until_its_time_or_what_woke_it() {
        assert!(asleep(&until(Some(NOW + 1)), NOW));
        assert!(!asleep(&until(Some(NOW)), NOW), "its time came");
        assert!(asleep(&until(None), NOW + 1_000_000));
        let woken = Later {
            woke: Some(Woke {
                at: NOW,
                by: Wake::Woken,
            }),
            ..until(None)
        };
        assert!(!asleep(&woken, NOW));
    }

    #[test]
    fn what_woke_by_itself_is_seen_once_then_dismissed() {
        let timed = until(Some(NOW + 60));
        assert!(!woke_by_itself(&timed, NOW), "it sleeps");
        assert!(woke_by_itself(&timed, NOW + 60), "its time came");
        assert!(!sees(&timed, WokeSeen::Seen, NOW), "nothing to see yet");
        assert!(sees(&timed, WokeSeen::Seen, NOW + 60));
        let seen = Later {
            woke_seen: Some(WokeSeen::Seen),
            ..timed.clone()
        };
        assert!(!sees(&seen, WokeSeen::Seen, NOW + 60), "seen once");
        assert!(sees(&seen, WokeSeen::Dismissed, NOW + 60), "then dismissed");
        let dismissed = Later {
            woke_seen: Some(WokeSeen::Dismissed),
            ..timed.clone()
        };
        assert!(!sees(&dismissed, WokeSeen::Seen, NOW + 60), "never back");
        for (by, itself) in [
            (Wake::Question, true),
            (Wake::Failure, true),
            (Wake::Done, true),
            (Wake::Message, false),
            (Wake::Woken, false),
        ] {
            let woke = Later {
                woke: Some(Woke { at: NOW, by }),
                ..timed.clone()
            };
            assert_eq!(woke_by_itself(&woke, NOW), itself, "{by:?}");
        }
    }

    /// What `fact` by `author` wakes a Thread under `later` for.
    fn woken(later: &Later, fact: &Fact, author: Participant, now: i64) -> Option<Wake> {
        wake_of(fact, author).filter(|by| wakes(later, *by, now))
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
            sub: None,
            asker: None,
            crew: None,
            start: None,
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
            sub: None,
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
