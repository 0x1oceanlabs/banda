//! The one place that decides whether a Participant may do something
//! (ADR 0001, decision 8). Every module maps each of its methods to a
//! [`Right`] with one exhaustive `match`, so a new method cannot exist
//! without one (ADR 0002, decision 9), and then asks here.

use crate::{Actor, PersonId, Refusal};

/// What a method needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Right {
    /// See the Space's work.
    Read,
    /// Change the Space's work: send, answer, edit.
    Write,
    /// Change the Space itself: its Agents, its settings, who is in it.
    Manage,
}

/// On one computer the owner may do everything, and Agents may read and
/// write the Space's work but not manage it. Members and roles arrive here
/// when teams do.
pub fn decide(actor: &Actor, right: Right, owner: PersonId) -> Result<(), Refusal> {
    match (actor, right) {
        (Actor::Person(person), _) if *person == owner => Ok(()),
        (Actor::Person(_), _) => Err(Refusal::forbidden(
            "Only the owner of this computer's Spaces may do this.",
        )),
        (Actor::Agent(_), Right::Read | Right::Write) => Ok(()),
        (Actor::Agent(_), Right::Manage) => Err(Refusal::forbidden(
            "An Agent may not change the Space itself.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AgentId;

    #[test]
    fn the_owner_may_do_everything() {
        let owner = PersonId::new();
        for right in [Right::Read, Right::Write, Right::Manage] {
            assert_eq!(decide(&Actor::Person(owner), right, owner), Ok(()));
        }
    }

    #[test]
    fn another_person_may_do_nothing_yet() {
        let owner = PersonId::new();
        let refusal = decide(&Actor::Person(PersonId::new()), Right::Read, owner).unwrap_err();
        assert_eq!(refusal.code, "forbidden");
    }

    #[test]
    fn an_agent_works_in_the_space_but_does_not_manage_it() {
        let owner = PersonId::new();
        let agent = Actor::Agent(AgentId::new());
        assert_eq!(decide(&agent, Right::Read, owner), Ok(()));
        assert_eq!(decide(&agent, Right::Write, owner), Ok(()));
        assert_eq!(
            decide(&agent, Right::Manage, owner).unwrap_err().code,
            "forbidden"
        );
    }
}
