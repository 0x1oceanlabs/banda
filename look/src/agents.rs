//! How messages to an Agent are sent, as the Person chooses (ADR 0016,
//! decision 3): the agents module's own `~/.config/banda/agents.toml`.
//! What Enter does was the window's own choice before; a file holds it now,
//! as every other setting.
//!
//! The composer runs in the window, so `banda look` resolves it with the
//! look, watches it with the look's files, and names its problems in the
//! same list, as it does `browser.toml`.

use crate::Problem;
use crate::keyed::{self, Keyed, Layer};
use crate::theme::Places;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

/// Reads an `agents.toml`; `None`, with the problem, when it cannot be
/// read as the schema.
pub fn read_agents(path: &Path, text: &str, problems: &mut Vec<Problem>) -> Option<AgentsSettings> {
    toml::from_str(text)
        .map_err(|error| problems.push(Problem::toml(path, text, &error)))
        .ok()
}

/// The settings on this machine; `agents.toml` is watched.
pub fn resolve(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> (Agents, Keyed) {
    let file = places.agents_file();
    watched.push(file.clone());
    let mine_file = std::fs::read_to_string(&file)
        .ok()
        .map(|text| (file.clone(), text));
    let mine = mine_file
        .as_ref()
        .and_then(|(path, text)| read_agents(path, text, problems))
        .unwrap_or_default();
    let defaults = AgentsSettings {
        enter: Some(Enter::default()),
    };
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("file", &mine, mine_file.as_ref()),
    ];
    let enter = mine.enter.unwrap_or_default();
    let keyed = keyed::keyed(&AgentsSettings { enter: Some(enter) }, &layers);
    (Agents { enter }, keyed)
}

/// Whether `banda look check` reads `path` as an `agents.toml`.
pub fn is_agents_file(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == "agents.toml")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolved(text: Option<&str>) -> (Agents, Keyed, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("agents.toml"), text).unwrap();
        }
        let (mut problems, mut watched) = (Vec::new(), Vec::new());
        let (agents, keyed) = resolve(&Places::at(folder.path()), &mut problems, &mut watched);
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
    }
}
