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
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// An agent program and how to start it. It speaks ACP on its stdio.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Harness {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The Person's own CLI the program runs, when it runs one.
    #[serde(default)]
    pub cli: Option<Cli>,
    /// A folder where each start of the program writes what Banda and
    /// the Harness say to each other, one ACP frame per line, for tests to
    /// replay. Only a test sets it, never a Harness list: a recording holds
    /// everything said, a secret typed into a form too.
    #[serde(skip)]
    pub record: Option<PathBuf>,
}

/// A CLI the Person installed, which an adapter runs in place of a copy
/// of its own (ADR 0003, decision 3).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Cli {
    /// Its name on PATH, or its path.
    pub program: String,
    /// The variable that tells the adapter where it is: Claude Code's
    /// `CLAUDE_CODE_EXECUTABLE`, Codex's `CODEX_PATH`.
    pub variable: String,
    /// The oldest version the adapter supports: the one it was built for.
    /// An older CLI still runs, and its Threads warn.
    #[serde(default)]
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

/// The Harnesses this machine can start.
#[derive(Clone, Debug, Default)]
pub struct Harnesses(Arc<[Harness]>);

#[derive(Deserialize)]
struct HarnessFile {
    #[serde(default)]
    harness: Vec<Harness>,
}

impl Harnesses {
    pub fn new(harnesses: Vec<Harness>) -> Self {
        Self(harnesses.into())
    }

    /// The Harnesses Banda starts when a machine names none: the ACP
    /// adapters for Claude Code and Codex, at versions we checked, each
    /// running the Person's own CLI. Each one signs in on its own; Banda
    /// holds no model provider's credentials.
    pub fn known() -> Self {
        let npx = |id: &str,
                   name: &str,
                   package: &str,
                   (program, variable, minimum): (&str, &str, &str)| Harness {
            id: id.to_owned(),
            name: name.to_owned(),
            command: "npx".to_owned(),
            args: vec!["-y".to_owned(), package.to_owned()],
            env: BTreeMap::new(),
            cli: Some(Cli {
                program: program.to_owned(),
                variable: variable.to_owned(),
                minimum: Some(minimum.to_owned()),
            }),
            record: None,
        };
        Self::new(vec![
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
        ])
    }

    /// Reads a Harness list: `[[harness]]` tables with `id`, `name`,
    /// `command`, and optional `args`, `env` and `cli`.
    pub fn parse(text: &str) -> Result<Self, String> {
        let file: HarnessFile = toml::from_str(text).map_err(|e| e.to_string())?;
        Ok(Self::new(file.harness))
    }

    /// Reads the machine's Harness list from `path`. A machine with no list
    /// gets the [`known`](Self::known) Harnesses.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::parse(&text).map_err(|e| format!("{}: {e}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::known()),
            Err(error) => Err(format!("{}: {error}", path.display())),
        }
    }

    pub fn find(&self, id: &str) -> Option<&Harness> {
        self.0.iter().find(|h| h.id == id)
    }

    pub fn views(&self) -> Vec<HarnessView> {
        self.0
            .iter()
            .map(|h| HarnessView {
                id: h.id.clone(),
                name: h.name.clone(),
            })
            .collect()
    }
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
