//! The IDs every part says are `banda-base`'s, so that code which
//! runs in a client too says them without the kernel; here is who acts.

pub use banda_base::{AgentId, CommandId, DeviceId, EventId, PersonId, ProjectId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Anyone who acts in a Project: a Person or an Agent.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS, schemars::JsonSchema,
)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
#[ts(export)]
pub enum Participant {
    Person(PersonId),
    Agent(AgentId),
}

impl Participant {
    /// The Agent, if an Agent it is.
    pub fn agent(&self) -> Option<AgentId> {
        match self {
            Participant::Agent(agent) => Some(*agent),
            Participant::Person(_) => None,
        }
    }

    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Participant::Person(_) => "person",
            Participant::Agent(_) => "agent",
        }
    }

    pub(crate) fn id(&self) -> String {
        match self {
            Participant::Person(id) => id.to_string(),
            Participant::Agent(id) => id.to_string(),
        }
    }

    pub(crate) fn from_parts(kind: &str, id: &str) -> Option<Participant> {
        match kind {
            "person" => id.parse().ok().map(Participant::Person),
            "agent" => id.parse().ok().map(Participant::Agent),
            _ => None,
        }
    }
}
