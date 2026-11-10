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
use banda_look::keyed::Renamed;
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

/// How an Agent's windows stand, its Flow (ADR 0079): where its Thread
/// opens, and what a pick of it shows.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "agents/")]
pub enum Flow {
    /// Where the window has it: beside the Pane in front, and a pick goes
    /// to wherever its Pane is. `off` before ADR 0079 (grace).
    #[serde(alias = "off")]
    Free,
    /// Each Project on its own workspace, its Agents in a row, a pick at
    /// the left (ADR 0065, ADR 0102). `project` before ADR 0079, `space`
    /// before ADR 0069 (grace).
    #[default]
    #[serde(alias = "project")]
    #[serde(alias = "space")]
    Row,
    /// As the row, and what has the focus fills the screen (ADR 0102).
    Solo,
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
    /// How a new Thread starts: on which account (ADR 0093, decision 7),
    /// and with what on each Harness, by the Harness's ID: `[start.claude]`.
    /// The Agents section sets it from the composer's bar.
    pub start: Option<Starts>,
    /// The Flow (ADR 0079). `workspaces` before ADR 0079 (grace).
    #[serde(alias = "workspaces")]
    pub flow: Option<Flow>,
    /// How many seconds the focus stays on a Thread it only came to, by
    /// the Strip's scroll or a key that moves the focus, before its mark
    /// counts as seen: 0 at once. A click or a key in it counts at once (ADR 0096,
    /// decision 3).
    pub seen_after: Option<f64>,
}

/// How long the focus stays on a Thread before it is seen, by default.
pub const SEEN_AFTER: f64 = 2.5;

/// How messages to an Agent are sent, every key resolved.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Agents {
    pub enter: Enter,
    pub flow: Flow,
    /// Seconds the focus stays on a Thread before it is seen; 0 at once.
    pub seen_after: f64,
    /// The account a new Thread starts on, by its entry's ID: none, the
    /// first one on (ADR 0093, decision 7).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// The account a new Thread starts on while `account` is out, of any
    /// Harness: none, no other.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

/// `agents.toml`'s `[start]`: the accounts a new Thread starts on, and
/// what it starts with on each Harness.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub struct Starts {
    /// The account a new Thread starts on, by its entry's ID in
    /// harnesses.toml: `account = "work"`. By default the first one on.
    pub account: Option<String>,
    /// The account a new Thread starts on while `account` is out, a limit
    /// window spent, when it has room itself; of any Harness:
    /// `fallback = "personal"`. By default none.
    pub fallback: Option<String>,
    /// What a new Thread on each Harness starts with, by its ID.
    #[serde(flatten)]
    pub harnesses: BTreeMap<String, Start>,
}

impl OneFile for AgentsSettings {
    const NAME: &'static str = "agents.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    const RENAMED: &'static [Renamed] = &[
        Renamed::key("", "workspaces", "flow"),
        Renamed::value("workspaces", "off", "free"),
        Renamed::value("workspaces", "project", "row"),
        Renamed::value("workspaces", "space", "row"),
        Renamed::value("flow", "off", "free"),
        Renamed::value("flow", "project", "row"),
        Renamed::value("flow", "space", "row"),
    ];
    type Resolved = Agents;

    fn defaults() -> Self {
        AgentsSettings {
            enter: Some(Enter::default()),
            start: None,
            flow: Some(Flow::default()),
            seen_after: Some(SEEN_AFTER),
        }
    }

    fn over(self, under: Self) -> Self {
        AgentsSettings {
            enter: self.enter.or(under.enter),
            start: self.start.or(under.start),
            flow: self.flow.or(under.flow),
            seen_after: self.seen_after.or(under.seen_after),
        }
    }

    fn resolved(self) -> Agents {
        let start = self.start.unwrap_or_default();
        Agents {
            enter: self.enter.unwrap_or_default(),
            flow: self.flow.unwrap_or_default(),
            // Less than none, or no number, is none.
            seen_after: self
                .seen_after
                .filter(|seconds| seconds.is_finite())
                .unwrap_or(SEEN_AFTER)
                .max(0.0),
            account: start.account,
            fallback: start.fallback,
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
    /// it `offer`s, with this over them, and `unchosen` for its mode when
    /// this names none, as the fence has it (ADR 0083). An option the
    /// Harness does not offer, or a value it has not, is left out. Before
    /// it offered anything, this goes as written, and the Harness says
    /// what it does not take.
    pub fn over(&self, offer: Option<&Offer>, unchosen: Mode) -> Settings {
        let mut settings = Settings {
            mode: self.mode.unwrap_or(unchosen),
            ..Settings::default()
        };
        let Some(offer) = offer else {
            settings.options = self.options.clone();
            settings.plan = self.plan.unwrap_or_default();
            return settings;
        };
        for option in &offer.options {
            let value = self.options.get(&option.id).filter(|v| option.takes(v));
            let value = value.unwrap_or(&option.value);
            settings.options.insert(option.id.clone(), value.clone());
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
    let read = banda_look::file::read_at::<AgentsSettings>(file);
    let start = read.and_then(|settings| settings.start?.harnesses.remove(harness));
    start.unwrap_or_default()
}

/// The Flow the `agents.toml` at `file` says now, read when asked, as
/// `start` is.
pub fn flow(file: &Path) -> Flow {
    (banda_look::file::read_at::<AgentsSettings>(file))
        .and_then(|settings| settings.flow)
        .unwrap_or_default()
}

/// The accounts `file`'s `[start]` names for a new Thread (ADR 0093,
/// decision 7): the one it starts on, and the one it starts on while that
/// one is out. A file that is not there names neither.
pub fn accounts(file: &Path) -> (Option<String>, Option<String>) {
    let start = banda_look::file::read_at::<AgentsSettings>(file).and_then(|read| read.start);
    let Starts {
        account, fallback, ..
    } = start.unwrap_or_default();
    (account, fallback)
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_look::Places;
    use banda_look::Problem;
    use banda_look::keyed::Keyed;

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
    fn a_thread_is_seen_after_the_focus_rests_on_it_as_the_file_says() {
        let (agents, _, _) = resolved(None);
        assert_eq!(agents.seen_after, SEEN_AFTER);
        let (agents, keyed, problems) = resolved(Some("seen-after = 0\n"));
        assert_eq!(agents.seen_after, 0.0);
        assert_eq!(keyed["seen-after"].from.line, Some(1));
        assert!(problems.is_empty());
        let (agents, _, _) = resolved(Some("seen-after = 1.5\n"));
        assert_eq!(agents.seen_after, 1.5);
        let (agents, _, _) = resolved(Some("seen-after = -3.0\n"));
        assert_eq!(agents.seen_after, 0.0, "less than none is none");
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

    #[test]
    fn start_names_the_accounts_beside_each_harness_s_own() {
        let text = "[start]\naccount = \"work\"\nfallback = \"personal\"\n\n[start.claude]\nmode = \"auto\"\n";
        let (agents, _, problems) = resolved(Some(text));
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(agents.account.as_deref(), Some("work"));
        assert_eq!(agents.fallback.as_deref(), Some("personal"));
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("agents.toml");
        std::fs::write(&file, text).unwrap();
        assert_eq!(start(&file, "claude").mode, Some(Mode::Auto));
        assert_eq!(start(&file, "account"), Start::default(), "no Harness's");
        let (agents, _, _) = resolved(None);
        assert_eq!((agents.account, agents.fallback), (None, None));
    }
}
