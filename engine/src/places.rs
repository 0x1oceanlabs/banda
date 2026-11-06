//! Where the engine keeps things on this machine, and the file that tells a
//! client where the running engine listens.
//!
//! | Place | Default | Holds |
//! |---|---|---|
//! | root | `~/Banda` | where a new Project's folder goes |
//! | data | `~/.local/share/banda` | each Project's data, in `projects/<id>/` (ADR 0026) |
//! | state | `~/.local/state/banda` | the owner's ID, the lock, `engine.json`, this machine's scope (`machine/`), the window's profile (`window/`), the logs (`logs/`), the engine's last panics (`problems/`) |
//! | config | `~/.config/banda` | `harnesses.toml`, `agents.toml` and the look's files |
//! | cache | `~/.cache/banda` | what can be made again: Files' small pictures (`thumbnails/`) |
//!
//! `banda` is Banda's folder: Banda Dev keeps its things in `banda-dev`, and
//! a build from a checkout in `banda-local` ([`FOLDER`], ADR 0033). The root is theirs together. `BANDA_ROOT`, `BANDA_DATA`,
//! `BANDA_STATE`, `BANDA_CONFIG` and `BANDA_CACHE` move each one, so a
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
    pub data: PathBuf,
    pub state: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
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

/// Which Banda this is (ADR 0033, decision 1), fixed when it is built by
/// `BANDA_CHANNEL` (build.rs): the folder Banda, Banda Dev or a build from
/// a checkout keeps its things in, so they never share a data, state or
/// config folder, a lock or a socket. The window names the same
/// (`app/desktop/src/channel.ts`).
pub const FOLDER: &str = env!("BANDA_FOLDER");

/// Whether this Banda was built from a checkout, not released: its own
/// folder, `banda-local`.
pub fn from_checkout() -> bool {
    FOLDER == "banda-local"
}

/// Which Banda this is, as `BANDA_CHANNEL` named it: `stable`, `dev` or
/// `local`.
pub fn channel() -> &'static str {
    match FOLDER {
        "banda" => "stable",
        "banda-dev" => "dev",
        _ => "local",
    }
}

const RUNNING: &str = "engine.json";
const OWNER: &str = "owner.json";

#[derive(Serialize, Deserialize)]
struct Owner {
    person: PersonId,
}

/// The variable that moves the state's place, where `engine.json` says
/// where the engine listens.
const STATE: &str = "BANDA_STATE";

/// Whether `BANDA_STATE` names the state's place, as a test or a trial
/// names its own engine's.
pub fn state_named() -> bool {
    std::env::var_os(STATE).is_some_and(|set| !set.is_empty())
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
            data: place("BANDA_DATA", dirs::data_dir(), FOLDER)?,
            state: place(STATE, state, FOLDER)?,
            config: place("BANDA_CONFIG", dirs::config_dir(), FOLDER)?,
            cache: place("BANDA_CACHE", dirs::cache_dir(), FOLDER)?,
        })
    }

    pub fn harnesses(&self) -> PathBuf {
        self.config.join("harnesses.toml")
    }

    /// Where Files keeps files' small pictures (ADR 0073, step F6).
    pub fn thumbnails(&self) -> PathBuf {
        self.cache.join("thumbnails")
    }

    /// This machine's scope: the store and log of its modules, as the
    /// workspaces (ADR 0025, decision 1). It is laid out as a Project's data
    /// is (ADR 0026): the manifest, the store and the lock.
    pub fn machine(&self) -> PathBuf {
        self.state.join("machine")
    }

    /// Where the engine and the window write their logs (ADR 0039,
    /// decision 1).
    pub fn logs(&self) -> PathBuf {
        self.state.join("logs")
    }

    /// Where the engine's panic hook leaves its panics for the problems
    /// module (ADR 0039, decision 1).
    pub fn problems(&self) -> PathBuf {
        self.state.join("problems")
    }

    /// Where the window listens for `banda menu` while it is open.
    pub fn window(&self) -> PathBuf {
        self.state.join("window.sock")
    }

    /// Held by the engine while it runs: one engine per state folder.
    pub fn lock(&self) -> PathBuf {
        self.state.join("engine.lock")
    }

    /// The Person who owns this machine's Projects, made on first use.
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
