//! How Threads start and messages to an Agent are sent, as the Person
//! chooses (ADR 0016, decision 3): the agents module's own
//! `~/.config/banda/agents.toml`. What Enter does was the window's own
//! choice before; a file holds it now, as every other setting. What a new
//! Thread on each Harness starts with was its entry's in `harnesses.toml`
//! before: that file is the Harnesses' own (ADR 0040, decision 6).
//!
//! The composer runs in the window, so `banda look` resolves it with the
//! look, watches it with the look's files, and names its problems in the
//! same list: the look carries it as `files["agents.toml"]`. The engine
//! reads the file itself as a Thread starts ([`start`]).

use crate::model::{Mode, Offer, OptionValue, Settings};
use banda_look::OneFile;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use ts_rs::TS;

/// Where a message written while the Agent works goes when sent with
/// Enter.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "agents/")]
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
    /// What a new Thread on each Harness starts with, by the Harness's ID:
    /// `[start.claude]`. The Agents section sets it from the composer's
    /// bar.
    pub start: Option<BTreeMap<String, Start>>,
}

/// How messages to an Agent are sent, every key resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
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
            start: None,
        }
    }

    fn over(self, under: Self) -> Self {
        AgentsSettings {
            enter: self.enter.or(under.enter),
            start: self.start.or(under.start),
        }
    }

    fn resolved(self) -> Agents {
        Agents {
            enter: self.enter.unwrap_or_default(),
        }
    }
}

/// What a new Thread on a Harness starts with, over the Harness's own:
/// what it leaves out, the Harness chooses.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub struct Start {
    /// How freely its Agent acts: "supervised", "accept_edits", "auto" or
    /// "full_access".
    pub mode: Option<Mode>,
    /// The Agent makes a plan before it changes anything.
    pub plan: Option<bool>,
    /// The Harness's options by their IDs, as its Threads offer them:
    /// `model = "opus"`.
    #[serde(flatten)]
    pub options: BTreeMap<String, OptionValue>,
}

impl Start {
    /// What a new Thread starts with: the Harness's own values for what
    /// it `offer`s, with this over them. An option the Harness does not
    /// offer, or a value it has not, is left out. Before it offered
    /// anything, this goes as written, and the Harness says what it does
    /// not take.
    pub fn over(&self, offer: Option<&Offer>) -> Settings {
        let mut settings = Settings::default();
        let Some(offer) = offer else {
            settings.options = self.options.clone();
            settings.mode = self.mode.unwrap_or_default();
            settings.plan = self.plan.unwrap_or_default();
            return settings;
        };
        for option in &offer.options {
            let value = self.options.get(&option.id).filter(|v| option.takes(v));
            let value = value.unwrap_or(&option.value);
            settings.options.insert(option.id.clone(), value.clone());
        }
        if let Some(mode) = self.mode {
            settings.mode = mode;
        }
        if let Some(plan) = self.plan.filter(|_| offer.plans) {
            settings.plan = plan;
        }
        settings
    }
}

/// What a new Thread on `harness` starts with, as the `agents.toml` at
/// `file` says now: read as the Thread starts, so a change shows at the
/// next one with nothing to follow. A file that is not there says nothing,
/// and the Harness chooses; a wrong key is logged and left out, as the
/// look leaves it out, and the rest still reads.
pub fn start(file: &Path, harness: &str) -> Start {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Start::default();
    };
    let mut problems = Vec::new();
    let read = banda_look::file::read::<AgentsSettings>(file, &text, &mut problems);
    for problem in &problems {
        tracing::warn!(%problem, "agents.toml");
    }
    let start = read.and_then(|settings| settings.start?.remove(harness));
    start.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_look::Problem;
    use banda_look::keyed::Keyed;
    use banda_look::theme::Places;

    fn resolved(text: Option<&str>) -> (Agents, Keyed, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("agents.toml"), text).unwrap();
        }
        let (mut problems, mut watched) = (Vec::new(), Vec::new());
        let (agents, keyed) = banda_look::file::resolve::<AgentsSettings>(
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

    #[test]
    fn a_new_thread_starts_as_the_file_says_for_its_harness() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("agents.toml");
        assert_eq!(start(&file, "claude"), Start::default(), "no file");
        let text = "[start.claude]\nmode = \"auto\"\nmodel = \"opus\"\n";
        std::fs::write(&file, text).unwrap();
        let claude = start(&file, "claude");
        assert_eq!(claude.mode, Some(Mode::Auto));
        assert_eq!(
            claude.options,
            BTreeMap::from([("model".to_owned(), OptionValue::Choice("opus".to_owned()))])
        );
        assert_eq!(start(&file, "codex"), Start::default(), "another's");
        let wrong = "enter = \"send\"\n\n[start.claude]\nmodel = \"opus\"\n";
        std::fs::write(&file, wrong).unwrap();
        assert!(
            !start(&file, "claude").options.is_empty(),
            "a wrong key elsewhere leaves the rest"
        );
    }
}
