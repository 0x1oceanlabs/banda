//! The agents module's settings are text files that people and Agents edit
//! (ADR 0002, decision 1): the Harness list, one per machine, says which
//! agent programs it can start.
//!
//! Before ADR 0006 a Space also had one file per Agent,
//! `.banda/agents/<name>.toml`, naming the Agent's Harness. Only
//! [`old_agents`] reads them still, so the Threads from then learn their
//! Harness; nothing writes them, and nothing removes them.

use crate::model::{HarnessView, Program};
use banda_kernel::AgentId;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// An agent program and how to start it. It speaks ACP on its stdio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Harness {
    /// How Threads and the window name it: `claude`, `codex`.
    pub id: String,
    /// What the Person reads: `Claude Code`.
    pub name: String,
    /// The program that speaks ACP: its name on PATH, or its path.
    pub command: String,
    /// Whether Threads start with it. One turned off stays in the list,
    /// with how it starts, for when it is turned on again.
    #[serde(default = "on", skip_serializing_if = "is_on")]
    #[schemars(extend("default" = true))]
    pub enabled: bool,
    /// The program's arguments.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Variables over the environment it starts in.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// The Person's own CLI the program runs, when it runs one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<Cli>,
    /// A folder where each start of the program writes what Banda and
    /// the Harness say to each other, one ACP frame per line, for tests to
    /// replay. Only a test sets it, never a Harness list: a recording holds
    /// everything said, a secret typed into a form too.
    #[serde(skip)]
    pub record: Option<PathBuf>,
}

fn on() -> bool {
    true
}

fn is_on(enabled: &bool) -> bool {
    *enabled
}

/// A CLI the Person installed, which an adapter runs in place of a copy
/// of its own (ADR 0003, decision 3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Cli {
    /// Its name on PATH, or its path.
    pub program: String,
    /// The variable that tells the adapter where it is: Claude Code's
    /// `CLAUDE_CODE_EXECUTABLE`, Codex's `CODEX_PATH`.
    pub variable: String,
    /// The oldest version the adapter supports: the one it was built for.
    /// An older CLI still runs, and its Threads warn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<String>,
}

impl Harness {
    /// The entry's own program with `args` after its arguments and `env`
    /// over its environment, as a Harness's sign-in in a terminal runs.
    pub fn program(&self, args: &[String], env: &HashMap<String, String>) -> Program {
        Program {
            program: self.command.clone(),
            args: self.args.iter().chain(args).cloned().collect(),
            env: self.env.clone().into_iter().chain(env.clone()).collect(),
        }
    }
}

/// The Harnesses this machine can start. Read from a file, they follow
/// it: each look at them reads it again once it changed (ADR 0016), so a
/// Harness the settings Pane or the Person's editor changed starts its
/// next process as the file now says.
#[derive(Clone, Debug, Default)]
pub struct Harnesses(Arc<Mutex<List>>);

#[derive(Debug, Default)]
struct List {
    harnesses: Arc<[Harness]>,
    /// The file the list follows, and its text when last read: none when
    /// it was not there. The text, not its time and size, tells a change,
    /// as the look's files do: two quick saves of one length share both.
    file: Option<(PathBuf, Option<String>)>,
}

/// The Harnesses this machine starts Threads with. Without the file,
/// Banda starts Claude Code and Codex, each with the Person's own CLI.
#[derive(Serialize, Deserialize, JsonSchema)]
pub struct HarnessFile {
    /// One `[[harness]]` table per agent program.
    #[serde(default)]
    harness: Vec<Harness>,
}

impl Harnesses {
    pub fn new(harnesses: Vec<Harness>) -> Self {
        Self::with(harnesses, None)
    }

    fn with(harnesses: Vec<Harness>, file: Option<(PathBuf, Option<String>)>) -> Self {
        let harnesses = harnesses.into();
        Self(Arc::new(Mutex::new(List { harnesses, file })))
    }

    /// The Harnesses Banda starts when a machine names none: the ACP
    /// adapters for Claude Code and Codex, at versions we checked, each
    /// running the Person's own CLI. Each one signs in on its own; Banda
    /// holds no model provider's credentials.
    pub fn known() -> Self {
        Self::new(known())
    }

    /// Reads a Harness list: `[[harness]]` tables with `id`, `name`,
    /// `command`, and optional `args`, `env` and `cli`.
    /// A mistake keeps TOML's place for it, so a check names the line.
    pub fn parse(text: &str) -> Result<Self, toml::de::Error> {
        parse(text).map(Self::new)
    }

    /// The machine's Harness list in `path`, followed from then on. A
    /// machine with no list gets the [`known`](Self::known) Harnesses.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = read(path)?;
        let harnesses = listed(path, text.as_deref())?;
        Ok(Self::with(harnesses, Some((path.to_owned(), text))))
    }

    /// The list as its file says now. A file that changed into one that
    /// does not read is logged, and the list before it stays.
    fn now(&self) -> Arc<[Harness]> {
        let mut list = self.0.lock().unwrap();
        let List { harnesses, file } = &mut *list;
        if let Some((path, was)) = file {
            match read(path) {
                Ok(text) if text != *was => {
                    match listed(path, text.as_deref()) {
                        Ok(read) => *harnesses = read.into(),
                        Err(error) => tracing::warn!(%error, "the Harness list does not read"),
                    }
                    *was = text;
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "the Harness list cannot be read"),
            }
        }
        harnesses.clone()
    }

    pub fn find(&self, id: &str) -> Option<Harness> {
        self.now().iter().find(|h| h.id == id).cloned()
    }

    /// Entry `id`, when Threads may start with it.
    pub fn get(&self, id: &str) -> Result<Harness, String> {
        match self.find(id) {
            Some(harness) if harness.enabled => Ok(harness),
            Some(harness) => Err(format!("{} is turned off in harnesses.toml.", harness.name)),
            None => Err(format!("This computer has no Harness named \"{id}\".")),
        }
    }

    pub fn views(&self) -> Vec<HarnessView> {
        self.now().iter().map(HarnessView::of).collect()
    }
}

fn known() -> Vec<Harness> {
    let npx = |id: &str,
               name: &str,
               package: &str,
               (program, variable, minimum): (&str, &str, &str)| Harness {
        id: id.to_owned(),
        name: name.to_owned(),
        command: "npx".to_owned(),
        args: vec!["-y".to_owned(), package.to_owned()],
        enabled: true,
        env: BTreeMap::new(),
        cli: Some(Cli {
            program: program.to_owned(),
            variable: variable.to_owned(),
            minimum: Some(minimum.to_owned()),
        }),
        record: None,
    };
    vec![
        npx(
            "claude",
            "Claude Code",
            "@agentclientprotocol/claude-agent-acp@0.99.1",
            // The adapter's Agent SDK 0.3.312 was built for Claude Code
            // 2.1.312 (its `claudeCodeVersion`).
            ("claude", "CLAUDE_CODE_EXECUTABLE", "2.1.312"),
        ),
        npx(
            "codex",
            "Codex",
            "@agentclientprotocol/codex-acp@2.5.0",
            // The adapter depends on `@openai/codex` ^0.165.0.
            ("codex", "CODEX_PATH", "0.165.0"),
        ),
    ]
}

fn parse(text: &str) -> Result<Vec<Harness>, toml::de::Error> {
    Ok(toml::from_str::<HarnessFile>(text)?.harness)
}

/// The file's text; none when it is not there.
fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

/// The list `text` says, or the known one when there is no file.
fn listed(path: &Path, text: Option<&str>) -> Result<Vec<Harness>, String> {
    match text {
        Some(text) => parse(text).map_err(|e| format!("{}: {e}", path.display())),
        None => Ok(known()),
    }
}

/// What `harnesses.toml` starts as when the settings Pane first writes
/// it: the known Harnesses, written out, so a change to one keeps the
/// others.
pub fn template() -> String {
    let known = HarnessFile { harness: known() };
    let list = toml::to_string(&known).expect("a Harness list writes as TOML");
    format!(
        "#:schema ./schemas/harnesses.schema.json\n\
         # The Harnesses Banda starts Threads with. Without this file, the\n\
         # ones below.\n\n{list}"
    )
}

/// What an Agent's file from before ADR 0006 says: who it was and its
/// Harness. Anything else it holds is left as it is.
#[derive(Deserialize)]
struct AgentFile {
    id: AgentId,
    harness: String,
}

/// Each old Agent of a Space and its Harness. What cannot be read, a file
/// or the whole folder, is logged and skipped: the Space opens anyway, and
/// only the Threads it names miss their Harness.
pub fn old_agents(space: &Path) -> Vec<(AgentId, String)> {
    let folder = space.join(".banda").join("agents");
    let entries = match std::fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            tracing::warn!(folder = %folder.display(), %error, "the old Agents' folder cannot be read");
            return Vec::new();
        }
    };
    let mut agents = Vec::new();
    for path in entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
    {
        if path.extension().is_none_or(|e| e != "toml") {
            continue;
        }
        let parsed = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| toml::from_str::<AgentFile>(&text).map_err(|e| e.to_string()));
        match parsed {
            Ok(file) => agents.push((file.id, file.harness)),
            Err(error) => {
                tracing::warn!(file = %path.display(), %error, "an old Agent's file does not parse")
            }
        }
    }
    agents
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_harness_list_reads_from_text() {
        let list = Harnesses::parse(
            r#"
            [[harness]]
            id = "fake"
            name = "Fake"
            command = "/bin/fake"
            args = ["--quiet"]
            "#,
        )
        .unwrap();
        let fake = list.find("fake").unwrap();
        assert_eq!(fake.args, ["--quiet"]);
        assert!(list.find("claude").is_none());
        assert!(Harnesses::parse("harness = 3").is_err());
    }

    #[test]
    fn the_list_follows_its_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("harnesses.toml");
        let list = Harnesses::load(&path).unwrap();
        assert!(list.find("claude").is_some(), "no file: the known ones");
        let fake = "[[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = \"fake\"\n";
        std::fs::write(&path, fake).unwrap();
        assert!(list.find("claude").is_none());
        assert_eq!(list.get("fake").unwrap().command, "fake");
        std::fs::write(&path, format!("{fake}enabled = false\n")).unwrap();
        assert_eq!(
            list.get("fake").unwrap_err(),
            "Fake is turned off in harnesses.toml."
        );
        assert!(!list.views()[0].enabled, "a list shows it still");
        std::fs::write(&path, "harness = 3").unwrap();
        assert!(
            list.find("fake").is_some(),
            "a file that does not read changes nothing"
        );
    }

    #[test]
    fn the_template_reads_as_the_known_harnesses() {
        assert_eq!(parse(&template()).unwrap(), known());
    }

    #[test]
    fn old_agent_files_name_their_harness() {
        let space = tempfile::tempdir().unwrap();
        assert!(old_agents(space.path()).is_empty());
        let folder = space.path().join(".banda/agents");
        std::fs::create_dir_all(&folder).unwrap();
        let id = AgentId::new();
        let text = format!("id = \"{id}\"\nharness = \"codex\"\nmode = \"supervised\"\n");
        std::fs::write(folder.join("Writer.toml"), text).unwrap();
        std::fs::write(folder.join("Broken.toml"), "id = 3").unwrap();
        std::fs::write(folder.join("notes.txt"), "not an Agent").unwrap();
        assert_eq!(old_agents(space.path()), vec![(id, "codex".to_owned())]);
    }
}
