//! Before ADR 0006 a Project had one file per Agent,
//! `.banda/agents/<name>.toml`, naming the Agent's Harness; since ADR 0026
//! they are in the Project's data, `projects/<id>/agents/`. Only
//! [`read`] reads them still, so the Threads from then learn their
//! Harness; nothing writes them, and nothing removes them.

use banda_kernel::AgentId;
use serde::Deserialize;
use std::path::Path;

/// What an Agent's file from before ADR 0006 says: who it was and its
/// Harness. Anything else it holds is left as it is.
#[derive(Deserialize)]
struct AgentFile {
    id: AgentId,
    harness: String,
}

/// Each old Agent of a Project and its Harness. What cannot be read, a file
/// or the whole folder, is logged and skipped: the Project opens anyway, and
/// only the Threads it names miss their Harness.
pub fn read(data: &Path) -> Vec<(AgentId, String)> {
    let folder = data.join("agents");
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
    fn old_agent_files_name_their_harness() {
        let data = tempfile::tempdir().unwrap();
        assert!(read(data.path()).is_empty());
        let folder = data.path().join("agents");
        std::fs::create_dir_all(&folder).unwrap();
        let id = AgentId::new();
        let text = format!("id = \"{id}\"\nharness = \"codex\"\nmode = \"supervised\"\n");
        std::fs::write(folder.join("Writer.toml"), text).unwrap();
        std::fs::write(folder.join("Broken.toml"), "id = 3").unwrap();
        std::fs::write(folder.join("notes.txt"), "not an Agent").unwrap();
        assert_eq!(read(data.path()), vec![(id, "codex".to_owned())]);
    }
}
