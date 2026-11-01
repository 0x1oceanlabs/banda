//! Where the engine keeps things on this machine, and the file that tells a
//! client where the running engine listens.
//!
//! | Place | Default | Holds |
//! |---|---|---|
//! | root | `~/Banda` | the Spaces' folders |
//! | state | `~/.local/state/banda` | the owner's ID, the lock, `engine.json` |
//! | config | `~/.config/banda` | `harnesses.toml` |
//!
//! `BANDA_ROOT`, `BANDA_STATE` and `BANDA_CONFIG` move each one, so a
//! test or a trial window runs beside the real engine.

use crate::Failure;
use banda_kernel::{PersonId, api};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The engine listens on this machine only.
pub const HOST: &str = "127.0.0.1";

pub struct Places {
    pub root: PathBuf,
    pub state: PathBuf,
    pub config: PathBuf,
}

/// What a client needs to reach the running engine. Only this machine's
/// user can read the file that holds it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Running {
    pub protocol: u32,
    pub port: u16,
    /// Whoever holds it is the owner, until the engine stops.
    pub secret: String,
}

impl Running {
    pub fn url(&self) -> String {
        format!("ws://{HOST}:{}{}", self.port, api::PATH)
    }
}

const RUNNING: &str = "engine.json";
const OWNER: &str = "owner.json";

#[derive(Serialize, Deserialize)]
struct Owner {
    person: PersonId,
}

fn place(variable: &str, default: Option<PathBuf>, under: &str) -> Result<PathBuf, Failure> {
    if let Some(set) = std::env::var_os(variable).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(set));
    }
    default.map(|base| base.join(under)).ok_or_else(|| {
        Failure::broken(format!(
            "Set {variable}: this system has no default place for it."
        ))
    })
}

impl Places {
    pub fn from_env() -> Result<Places, Failure> {
        let state = dirs::state_dir().or_else(dirs::data_local_dir);
        Ok(Places {
            root: place("BANDA_ROOT", dirs::home_dir(), "Banda")?,
            state: place("BANDA_STATE", state, "banda")?,
            config: place("BANDA_CONFIG", dirs::config_dir(), "banda")?,
        })
    }

    pub fn harnesses(&self) -> PathBuf {
        self.config.join("harnesses.toml")
    }

    /// Held by the engine while it runs: one engine per state folder.
    pub fn lock(&self) -> PathBuf {
        self.state.join("engine.lock")
    }

    /// The Person who owns this machine's Spaces, made on first use.
    pub fn owner(&self) -> std::io::Result<PersonId> {
        let path = self.state.join(OWNER);
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Owner>(&bytes)
                .map(|o| o.person)
                .map_err(std::io::Error::other),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let person = PersonId::new();
                write_private(&path, &serde_json::to_vec(&Owner { person })?)?;
                Ok(person)
            }
            Err(error) => Err(error),
        }
    }

    /// Where the running engine listens.
    pub fn running(&self) -> Result<Running, Failure> {
        let path = self.state.join(RUNNING);
        let bytes = std::fs::read(&path).map_err(|_| {
            Failure::broken("Banda's engine is not running. Start it with: banda serve")
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|e| Failure::broken(format!("{} does not parse: {e}", path.display())))
    }

    /// Tells clients where the engine listens.
    pub fn announce(&self, running: &Running) -> std::io::Result<()> {
        write_private(
            &self.state.join(RUNNING),
            &serde_json::to_vec_pretty(running)?,
        )
    }

    /// The engine no longer listens.
    pub fn withdraw(&self) {
        let _ = std::fs::remove_file(self.state.join(RUNNING));
    }
}

/// Writes a file only this user can read, whole or not at all.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let temporary = path.with_extension("new");
    let mut options = std::fs::File::options();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(temporary, path)
}
