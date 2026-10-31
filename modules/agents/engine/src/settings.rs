//! The agents module's settings are text files that people and Agents edit
//! (ADR 0002, decision 1):
//!
//! - the Harness list, one per machine: which agent programs it can start;
//! - one file per Agent, in the Space: `.bandaso/agents/<name>.toml`, with
//!   the Agent's ID and its Harness. The file's name is the Agent's name.

use crate::model::{AgentView, HarnessView};
use bandaso_kernel::{AgentId, Error, Refusal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

    /// The Harnesses Bandaso starts when a machine names none: the ACP
    /// adapters for Claude Code and Codex, at versions we checked. Each one
    /// signs in on its own; Bandaso holds no model provider's credentials.
    pub fn known() -> Self {
        let npx = |id: &str, name: &str, package: &str| Harness {
            id: id.to_owned(),
            name: name.to_owned(),
            command: "npx".to_owned(),
            args: vec!["-y".to_owned(), package.to_owned()],
            env: BTreeMap::new(),
        };
        Self::new(vec![
            npx(
                "claude",
                "Claude Code",
                "@agentclientprotocol/claude-agent-acp@0.99.1",
            ),
            npx("codex", "Codex", "@agentclientprotocol/codex-acp@2.5.0"),
        ])
    }

    /// Reads a Harness list: `[[harness]]` tables with `id`, `name`,
    /// `command`, and optional `args` and `env`.
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

#[derive(Serialize, Deserialize)]
struct AgentFile {
    id: AgentId,
    harness: String,
}

fn folder(space: &Path) -> PathBuf {
    space.join(".bandaso").join("agents")
}

/// The Agents of a Space, by name. A file that does not parse is logged
/// and skipped, so one bad edit hides one Agent, not all of them.
pub fn agents(space: &Path) -> Result<Vec<AgentView>, Error> {
    let entries = match std::fs::read_dir(folder(space)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut agents = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Some(name) = path
            .extension()
            .is_some_and(|e| e == "toml")
            .then(|| path.file_stem().and_then(|s| s.to_str()))
            .flatten()
        else {
            continue;
        };
        let parsed = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| toml::from_str::<AgentFile>(&text).map_err(|e| e.to_string()));
        match parsed {
            Ok(file) => agents.push(AgentView {
                id: file.id,
                name: name.to_owned(),
                harness: file.harness,
            }),
            Err(error) => {
                tracing::warn!(file = %path.display(), %error, "an Agent's file does not parse")
            }
        }
    }
    agents.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(agents)
}

pub fn agent(space: &Path, id: AgentId) -> Result<AgentView, Refusal> {
    agents(space)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| Refusal::not_found("There is no such Agent in this Space."))
}

/// Writes a new Agent's file. Its name is a plain name that no other Agent
/// of the Space has.
pub fn create(space: &Path, name: &str, harness: &str) -> Result<AgentView, Error> {
    let name = bandaso_kernel::plain_name(name).ok_or_else(|| {
        Refusal::invalid(
            "An Agent's name is 1 to 64 characters, with no slashes and no leading dot.",
        )
    })?;
    let id = AgentId::new();
    let text = toml::to_string(&AgentFile {
        id,
        harness: harness.to_owned(),
    })
    .map_err(|e| Error::Io(std::io::Error::other(e)))?;
    std::fs::create_dir_all(folder(space))?;
    let path = folder(space).join(format!("{name}.toml"));
    let mut file = match std::fs::File::create_new(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(Refusal::conflict(format!(
                "This Space already has an Agent named {name}."
            ))
            .into());
        }
        Err(error) => return Err(error.into()),
    };
    std::io::Write::write_all(&mut file, text.as_bytes())?;
    Ok(AgentView {
        id,
        name: name.to_owned(),
        harness: harness.to_owned(),
    })
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
    fn agents_are_files_that_keep_their_id() {
        let space = tempfile::tempdir().unwrap();
        let made = create(space.path(), " Writer ", "claude").unwrap();
        assert_eq!(made.name, "Writer");
        assert!(space.path().join(".bandaso/agents/Writer.toml").is_file());
        assert_eq!(agents(space.path()).unwrap(), vec![made.clone()]);
        assert_eq!(agent(space.path(), made.id).unwrap(), made);

        let twin = create(space.path(), "Writer", "codex").unwrap_err();
        assert!(matches!(twin, Error::Refused(r) if r.code == bandaso_kernel::Code::Conflict));
        std::fs::write(space.path().join(".bandaso/agents/Broken.toml"), "id = 3").unwrap();
        assert_eq!(
            agents(space.path()).unwrap().len(),
            1,
            "a bad file hides only itself"
        );
    }
}
