//! The one place that decides whether a Participant may do something
//! (ADR 0001, decision 8). Every method names the [`Right`] it needs: the
//! kernel's own in one exhaustive `match`, a module's through
//! [`Module::right`](crate::Module::right) (ADR 0002, decision 9). The
//! kernel asks here before it runs any of them.

use crate::{Participant, PersonId, Refusal, SpaceId};

/// What a method needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Right {
    /// See the Space's work.
    Read,
    /// Change the Space's work: send, answer, edit.
    Write,
    /// Change the Space itself: its Agents, its settings, who is in it.
    Manage,
    /// Decide what an Agent asked a Person to decide. An Agent never
    /// answers in a Person's place (ADR 0002, decision 9).
    Decide,
    /// Run programs as the Person, as a terminal does. An Agent runs them
    /// through its Harness, under its Thread's mode.
    Run,
}

/// On one computer the owner may do everything, and Agents may read and
/// write the Space's work but neither manage it nor decide for a Person.
/// Members and roles arrive here when teams do.
pub fn decide(participant: &Participant, right: Right, owner: PersonId) -> Result<(), Refusal> {
    match (participant, right) {
        (Participant::Person(person), _) if *person == owner => Ok(()),
        (Participant::Person(_), _) => Err(Refusal::forbidden(
            "Only the owner of this computer's Spaces may do this.",
        )),
        (Participant::Agent(_), Right::Read | Right::Write) => Ok(()),
        (Participant::Agent(_), Right::Manage) => Err(Refusal::forbidden(
            "An Agent may not change the Space itself.",
        )),
        (Participant::Agent(_), Right::Decide) => Err(Refusal::forbidden(
            "Only a Person decides what an Agent asked.",
        )),
        (Participant::Agent(_), Right::Run) => Err(Refusal::forbidden(
            "An Agent runs programs through its Harness, not in a terminal.",
        )),
    }
}

/// Who calls: a Participant, and the one Space a pass keeps them in. The
/// owner's secret keeps them in none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caller {
    pub participant: Participant,
    pub only: Option<SpaceId>,
}

impl From<Participant> for Caller {
    fn from(participant: Participant) -> Caller {
        Caller {
            participant,
            only: None,
        }
    }
}

/// The Space wall (ADR 0019, decision 2): a caller with a pass works only
/// in the Space of its pass, `only`; one with `None` works anywhere.
/// `space` is the one a call, a subscription or a stream is for. The
/// kernel gives a walled call for no Space its own Space first; a Space
/// that is still `None` is refused, since it would reach past the wall.
pub fn within(only: Option<SpaceId>, space: Option<SpaceId>) -> Result<(), Refusal> {
    match only {
        Some(only) if space != Some(only) => {
            Err(Refusal::forbidden("An Agent works only in its own Space."))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentId, Code};

    #[test]
    fn the_owner_may_do_everything() {
        let owner = PersonId::new();
        for right in [
            Right::Read,
            Right::Write,
            Right::Manage,
            Right::Decide,
            Right::Run,
        ] {
            assert_eq!(decide(&Participant::Person(owner), right, owner), Ok(()));
        }
    }

    #[test]
    fn another_person_may_do_nothing_yet() {
        let owner = PersonId::new();
        let refusal =
            decide(&Participant::Person(PersonId::new()), Right::Read, owner).unwrap_err();
        assert_eq!(refusal.code, Code::Forbidden);
    }

    #[test]
    fn an_agent_works_in_the_space_but_neither_manages_nor_decides() {
        let owner = PersonId::new();
        let agent = Participant::Agent(AgentId::new());
        assert_eq!(decide(&agent, Right::Read, owner), Ok(()));
        assert_eq!(decide(&agent, Right::Write, owner), Ok(()));
        for right in [Right::Manage, Right::Decide, Right::Run] {
            assert_eq!(
                decide(&agent, right, owner).unwrap_err().code,
                Code::Forbidden
            );
        }
    }

    #[test]
    fn an_agent_works_only_in_the_space_of_its_pass() {
        let (own, other) = (SpaceId::new(), SpaceId::new());
        assert_eq!(within(Some(own), Some(own)), Ok(()));
        for space in [Some(other), None] {
            let refusal = within(Some(own), space).unwrap_err();
            assert_eq!(refusal.code, Code::Forbidden);
            assert_eq!(refusal.message, "An Agent works only in its own Space.");
        }
    }

    #[test]
    fn the_owner_has_no_wall() {
        assert_eq!(within(None, Some(SpaceId::new())), Ok(()));
        assert_eq!(within(None, None), Ok(()));
    }
}
