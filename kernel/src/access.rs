//! The one place that decides whether a Participant may do something
//! (ADR 0001, decision 8). Every method names the [`Right`] it needs: the
//! kernel's own in one exhaustive `match`, a module's through
//! [`Module::right`](crate::Module::right) (ADR 0002, decision 9). The
//! kernel asks here before it runs any of them.

use crate::{Participant, PersonId, Refusal};

/// What a method needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentId, Code};

    #[test]
    fn the_owner_may_do_everything() {
        let owner = PersonId::new();
        for right in [Right::Read, Right::Write, Right::Manage, Right::Decide] {
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
        for right in [Right::Manage, Right::Decide] {
            assert_eq!(
                decide(&agent, right, owner).unwrap_err().code,
                Code::Forbidden
            );
        }
    }
}
