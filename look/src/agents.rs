//! How messages to an Agent are sent, as the Person chooses (ADR 0016,
//! decision 3): the agents module's own `~/.config/banda/agents.toml`.
//! What Enter does was the window's own choice before; a file holds it now,
//! as every other setting.
//!
//! The composer runs in the window, so `banda look` resolves it with the
//! look, watches it with the look's files, and names its problems in the
//! same list, as it does `browser.toml`.

use crate::file::OneFile;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a message written while the Agent works goes when sent with
/// Enter.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Enter {
    /// Into the turn: the Agent reads it as it works, as in T3 Code.
    #[default]
    Steer,
    /// Into the queue: it waits until the turn ends.
    Queue,
}

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../agents.toml");

/// How messages to an Agent are sent. Every key is optional.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct AgentsSettings {
    /// What Enter does with a message written while the Agent works.
    /// Ctrl+Enter (⌘+Enter on a Mac) does the other.
    pub enter: Option<Enter>,
}

/// How messages to an Agent are sent, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Agents {
    pub enter: Enter,
}

impl OneFile for AgentsSettings {
    const NAME: &'static str = "agents.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    type Resolved = Agents;

    fn defaults() -> Self {
        AgentsSettings {
            enter: Some(Enter::default()),
        }
    }

    fn over(self, under: Self) -> Self {
        AgentsSettings {
            enter: self.enter.or(under.enter),
        }
    }

    fn resolved(self) -> Agents {
        Agents {
            enter: self.enter.unwrap_or_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Problem;
    use crate::keyed::Keyed;
    use crate::theme::Places;

    fn resolved(text: Option<&str>) -> (Agents, Keyed, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("agents.toml"), text).unwrap();
        }
        let (mut problems, mut watched) = (Vec::new(), Vec::new());
        let (agents, keyed) = crate::file::resolve::<AgentsSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut watched,
        );
        assert_eq!(watched, vec![folder.path().join("agents.toml")]);
        (agents, keyed, problems)
    }

    #[test]
    fn enter_steers_unless_the_file_says_queue() {
        let (agents, keyed, problems) = resolved(None);
        assert_eq!(agents.enter, Enter::Steer);
        assert_eq!(keyed["enter"].from.layer, "defaults");
        assert!(problems.is_empty());
        let (agents, _, problems) = resolved(Some(TEMPLATE));
        assert_eq!(agents.enter, Enter::Steer);
        assert!(problems.is_empty());
        let (agents, keyed, _) = resolved(Some("\nenter = \"queue\"\n"));
        assert_eq!(agents.enter, Enter::Queue);
        assert_eq!(keyed["enter"].from.line, Some(2));
    }

    #[test]
    fn a_wrong_value_is_a_problem() {
        let (agents, _, problems) = resolved(Some("enter = \"send\"\n"));
        assert_eq!(agents.enter, Enter::Steer);
        assert_eq!(problems.len(), 1);
        assert_eq!(
            problems[0].key.as_deref(),
            Some("enter"),
            "its row shows it"
        );
    }
}
