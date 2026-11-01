//! A Harness's conversation written down as it happens, when its entry
//! names a folder to `record` in. Each start writes one file,
//! `<harness>-<milliseconds since 1970>.jsonl`, with a line per ACP frame:
//! `{"to":"agent","frame":…}` for what Bandaso sent and
//! `{"to":"client","frame":…}` for what the Harness answered. The fake
//! agent replays such a file (`FAKE_AGENT_REPLAY`), so tests hold what a
//! real Claude Code or Codex said.

use serde_json::{Value, json};
use std::fs::File;
use std::io::Write as _;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Recording(Mutex<File>);

impl Recording {
    /// A new file for `harness` in `folder`, which it makes if it must.
    pub fn start(folder: &Path, harness: &str) -> Result<Recording, String> {
        let since = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let path = folder.join(format!("{harness}-{}.jsonl", since.as_millis()));
        std::fs::create_dir_all(folder)
            .and_then(|()| File::create_new(&path))
            .map(|file| Recording(Mutex::new(file)))
            .map_err(|error| {
                format!(
                    "Bandaso cannot record the conversation in {}: {error}",
                    path.display()
                )
            })
    }

    /// Writes down `line`, one frame sent `to` one side.
    pub fn write(&self, to: To, line: &str) {
        let to = match to {
            To::Agent => "agent",
            To::Client => "client",
        };
        let frame = serde_json::from_str(line).unwrap_or_else(|_| Value::String(line.to_owned()));
        let mut entry = json!({ "to": to, "frame": frame }).to_string();
        entry.push('\n');
        if let Err(error) = self.0.lock().unwrap().write_all(entry.as_bytes()) {
            tracing::warn!(%error, "a recording lost a frame");
        }
    }
}

/// Which side a frame went to: the Harness, or Bandaso.
pub enum To {
    Agent,
    Client,
}
