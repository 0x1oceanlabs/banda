//! What Banda and a Harness say to each other, written down as it
//! happens, when a test has the Harness's entry `record` in a folder. Each
//! start of its program writes one file, `<harness>-<UUIDv7>.jsonl`, named
//! in the order of the starts, with a line per ACP frame:
//! `{"to":"agent","frame":…}` for what Banda sent and
//! `{"to":"client","frame":…}` for what the Harness answered. The fake
//! agent replays such a file (`FAKE_AGENT_REPLAY`), so tests hold what a
//! real Claude Code or Codex said.

use serde_json::{Value, json};
use std::fs::File;
use std::io::Write as _;
use std::path::Path;
use std::sync::Mutex;

pub struct Recording(Mutex<File>);

impl Recording {
    /// A new file for `harness` in `folder`, which it makes if it must.
    pub fn start(folder: &Path, harness: &str) -> Result<Recording, String> {
        let path = folder.join(format!("{harness}-{}.jsonl", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(folder)
            .and_then(|()| File::create_new(&path))
            .map(|file| Recording(Mutex::new(file)))
            .map_err(|error| {
                format!(
                    "Banda cannot record the Harness in {}: {error}",
                    path.display()
                )
            })
    }

    /// Writes down `line`, one frame sent `to` one side.
    pub fn write(&self, to: To, line: &str) {
        let to = match to {
            To::Harness => "agent",
            To::Banda => "client",
        };
        let frame = serde_json::from_str(line).unwrap_or_else(|_| Value::String(line.to_owned()));
        let mut entry = json!({ "to": to, "frame": frame }).to_string();
        entry.push('\n');
        if let Err(error) = self.0.lock().unwrap().write_all(entry.as_bytes()) {
            tracing::warn!(%error, "a recording lost a frame");
        }
    }
}

/// Which side a frame went to. The file says it in ACP's words: the
/// Harness is the agent, Banda the client.
pub enum To {
    Harness,
    Banda,
}
