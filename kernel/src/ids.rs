//! Our IDs are the identity, and a Harness's IDs are evidence (ADR 0002,
//! decision 7). An ID Banda makes is a UUIDv7, except a derived one, a
//! UUIDv5: a command ID derived from what sends it ([`CommandId::derive`]),
//! and what a workspaces command makes, derived from that command's ID
//! (ADR 0088, decision 11).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Defines an ID type: a UUID that is text in SQLite and a string on the
/// wire, and that `new()` makes as a UUIDv7. A module uses it for its own IDs. The crate that uses it depends on
/// `serde`, `ts-rs`, `uuid` and `rusqlite`. Its JSON Schema, for a tool's
/// params, is a string. Pass `export_to = "<dir>/"` to
/// put its TypeScript type in a module's folder.
#[macro_export]
macro_rules! id {
    ($(#[$doc:meta])* $name:ident $(, export_to = $dir:literal)?) => {
        $(#[$doc])*
        #[derive(
            Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord,
            ::serde::Serialize, ::serde::Deserialize, ::ts_rs::TS,
        )]
        #[ts(export, type = "string" $(, export_to = $dir)?)]
        pub struct $name(::uuid::Uuid);

        impl $name {
            /// A new ID, ordered by the time it was made.
            pub fn new() -> Self {
                Self(::uuid::Uuid::now_v7())
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
            type Err = ::uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                ::uuid::Uuid::parse_str(s).map(Self)
            }
        }

        impl $crate::schemars::JsonSchema for $name {
            fn schema_name() -> std::borrow::Cow<'static, str> {
                stringify!($name).into()
            }

            fn inline_schema() -> bool {
                true
            }

            fn json_schema(_: &mut $crate::schemars::SchemaGenerator) -> $crate::schemars::Schema {
                $crate::schemars::json_schema!({ "type": "string", "format": "uuid" })
            }
        }

        impl ::rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> ::rusqlite::Result<::rusqlite::types::ToSqlOutput<'_>> {
                Ok(::rusqlite::types::ToSqlOutput::from(self.0.to_string()))
            }
        }

        impl ::rusqlite::types::FromSql for $name {
            fn column_result(
                value: ::rusqlite::types::ValueRef<'_>,
            ) -> ::rusqlite::types::FromSqlResult<Self> {
                let text = value.as_str()?;
                text.parse()
                    .map_err(|e| ::rusqlite::types::FromSqlError::Other(Box::new(e)))
            }
        }
    };
}

id!(
    /// A Project: one body of work and its folder.
    ProjectId
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
    /// One event in a Project's log.
    EventId
);
id!(
    /// One command, chosen by its caller. A repeated command ID returns the
    /// first result (ADR 0002, decision 2).
    CommandId
);

/// The namespace of the command IDs Banda derives: any UUID, fixed for good,
/// as a derived ID must come out the same in every version.
const DERIVED: uuid::Uuid = uuid::Uuid::from_u128(0x1381_b1cc_08e3_41ff_b9bd_24b4_06cb_f01c);

impl CommandId {
    /// The command `step` of `source` sends: the same ID each time it is
    /// made, a UUIDv5. What sends a command again, `banda mcp` a request
    /// of its session, a listener's reaction to a fact of another scope's
    /// log ([`Listener::once`](crate::Listener::once)), later a workflow's
    /// step, lands on the first one's receipt, so it runs once (ADR 0082,
    /// decision 4), for as long as the receipt is kept: thirty days. Past
    /// them the same ID runs as a new command, so a reaction that catches
    /// up on older events keeps its own cursor of what it did. `source`
    /// names one sender, and only it: another sender with the same steps
    /// gets other IDs. The ID names the step, not what it asks: the
    /// receipt keeps the method, the author and a hash of the params, so a
    /// step sent again asks the same, and one that asks otherwise under
    /// its ID is refused as `conflict`.
    pub fn derive(source: &str, step: &str) -> CommandId {
        let source = uuid::Uuid::new_v5(&DERIVED, source.as_bytes());
        CommandId(uuid::Uuid::new_v5(&source, step.as_bytes()))
    }
}

/// Anyone who acts in a Project: a Person or an Agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
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

#[cfg(test)]
mod tests {
    use super::CommandId;

    #[test]
    fn a_derived_command_id_is_the_same_each_time_and_its_senders_own() {
        let session = "6f1c0e52-3b1a-4d55-9f7e-2a9a8e0c1d11";
        let first = CommandId::derive(session, "7");
        assert_eq!(first, CommandId::derive(session, "7"));
        assert_ne!(first, CommandId::derive(session, "8"));
        assert_ne!(first, CommandId::derive("another session", "7"));
        // Fixed for good: a resend from an older Banda finds its receipt.
        assert_eq!(
            CommandId::derive("a", "b").to_string(),
            "a6a85341-5cd4-5383-a684-ad949636c543"
        );
    }
}
