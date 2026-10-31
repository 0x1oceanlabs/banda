//! Our IDs are the identity, and a Harness's IDs are evidence (ADR 0002,
//! decision 7). Every ID here is a UUIDv7 made by Bandaso.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

macro_rules! id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
        #[ts(export, type = "string")]
        pub struct $name(Uuid);

        impl $name {
            /// A new ID, ordered by the time it was made.
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(f)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(s).map(Self)
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.0.to_string()))
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                let text = value.as_str()?;
                text.parse().map_err(|e| FromSqlError::Other(Box::new(e)))
            }
        }
    };
}

id!(
    /// A Space: one body of work and its folder.
    SpaceId
);
id!(
    /// A Person: a human Participant.
    PersonId
);
id!(
    /// An Agent: an AI Participant.
    AgentId
);
id!(
    /// One event in a Space's log.
    EventId
);
id!(
    /// One command, chosen by its caller. A repeated command ID returns the
    /// first result (ADR 0002, decision 2).
    CommandId
);

/// Anyone who acts in a Space: a Person or an Agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
#[ts(export)]
pub enum Participant {
    Person(PersonId),
    Agent(AgentId),
}

impl Participant {
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
