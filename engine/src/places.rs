//! Where the engine keeps things on this machine, and the file that tells a
//! client where the running engine listens.
//!
//! | Place | Default | Holds |
//! |---|---|---|
//! | root | `~/Banda` | where a new Project's folder goes |
//! | data | `~/.local/share/banda` | each Project's data, in `projects/<id>/` (ADR 0026); the window's copy of `banda`, in `engine/<version>/` (ADR 0086) |
//! | state | `~/.local/state/banda` | the owner's ID, the lock, `engine.json`, how the last run went (`run.json`), the passes (`passes.sqlite3`), this machine's scope (`machine/`), the window's profile (`window/`), the logs (`logs/`), the engine's last panics (`problems/`) |
//! | config | `~/.config/banda` | `harnesses.toml`, `agents.toml` and the look's files |
//! | cache | `~/.cache/banda` | what can be made again: Files' small pictures (`thumbnails/`) |
//!
//! `banda` is Banda's folder: Banda Dev keeps its things in `banda-dev`, and
//! a build from a checkout in `banda-local` ([`FOLDER`], ADR 0033). The root is theirs together. `BANDA_ROOT`, `BANDA_DATA`,
//! `BANDA_STATE`, `BANDA_CONFIG` and `BANDA_CACHE` move each one, so a
//! test or a trial window runs beside the real engine.
//!
//! On Windows the four are folders of Banda's folder in `%LOCALAPPDATA%`,
//! `data`, `state`, `config` and `cache`, and none is in Roaming, which a
//! company's roaming profile copies to other machines. The root is
//! `%USERPROFILE%\Banda`. A variable moves a place there only within the
//! Person's profile (`places/windows.rs`, ADR 0090, decision 3).

use crate::Failure;
use banda_kernel::{PersonId, api};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(windows)]
mod windows;

/// The engine listens on this machine only.
pub const HOST: &str = "127.0.0.1";

pub struct Places {
    pub root: PathBuf,
    pub data: PathBuf,
    pub state: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
}

/// What a client needs to reach the running engine, and what `banda
/// status` says of it. Only this machine's user can read the file that
/// holds it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Running {
    pub protocol: u32,
    pub port: u16,
    /// Whoever holds it is the owner, until the engine stops.
    pub secret: String,
    /// The engine's build id, so a client knows whether the engine is its
    /// own build, even of the same version (ADR 0086, decision 2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<String>,
    /// Its version, as `banda --version` says it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// When it began to serve, in ms since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    /// Its process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// The systemd user unit it runs as, when it is the session's service
    /// (ADR 0086, decision 1), or on macOS its launchd job's label; none
    /// as a window's child, or a `banda serve` in a shell, even one inside
    /// that unit (`service::own_unit`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// Why it runs as the window's child where it is not the session's
    /// service, as launchd or systemd did not start it, in plain words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child: Option<String>,
    /// The PID namespace its process runs in, by its inode: its `pid`
    /// names it only there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid_ns: Option<u64>,
}

/// The PID namespace this process runs in, by its inode.
pub fn pid_ns() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata("/proc/self/ns/pid")
            .ok()
            .map(|found| found.ino())
    }
    #[cfg(not(target_os = "linux"))]
    None
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
/// (`client/desktop/src/channel.ts`).
pub const FOLDER: &str = env!("BANDA_FOLDER");

/// The app's bundle ID on macOS, as the window's `channel.ts` names it:
/// `so.banda.app`, `so.banda.dev` or `so.banda.local` (build.rs).
pub const APP_ID: &str = env!("BANDA_APP_ID");

/// Every Banda's folder: Stable's, Dev's and a checkout's. The fence hides
/// them all (`fence.rs`), on Linux so far.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const FOLDERS: [&str; 3] = ["banda", "banda-dev", "banda-local"];

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

/// The variables that move each place, as [`Places::variables`] names
/// them.
pub const VARIABLES: [&str; 5] = [
    "BANDA_ROOT",
    "BANDA_DATA",
    STATE,
    "BANDA_CONFIG",
    "BANDA_CACHE",
];

/// Whether `BANDA_STATE` names the state's place, as a test or a trial
/// names its own engine's.
pub fn state_named() -> bool {
    named(STATE).is_some()
}

/// What the state's place is under when no variable moves it.
#[cfg(not(windows))]
pub fn state_base() -> Option<PathBuf> {
    dirs::state_dir().or_else(dirs::data_local_dir)
}

/// The state's place when no variable moves it.
pub fn default_state() -> Option<PathBuf> {
    let [_, state, ..] = defaults();
    state
}

/// The data, state, config and cache places when no variable moves them:
/// Banda's folder in each of the system's own, as XDG names them on Linux;
/// on Windows a folder of each in Banda's folder in `%LOCALAPPDATA%`.
fn defaults() -> [Option<PathBuf>; 4] {
    #[cfg(windows)]
    return dirs::data_local_dir().map_or_else(Default::default, |local| {
        windows::defaults_in(&local, FOLDER).map(Some)
    });
    #[cfg(not(windows))]
    [
        dirs::data_dir(),
        state_base(),
        dirs::config_dir(),
        dirs::cache_dir(),
    ]
    .map(|base| base.map(|base| base.join(FOLDER)))
}

/// The variable `variable`'s place, when it is set.
fn named(variable: &str) -> Option<PathBuf> {
    std::env::var_os(variable)
        .filter(|set| !set.is_empty())
        .map(PathBuf::from)
}

fn place(variable: &str, default: Option<PathBuf>) -> Result<PathBuf, Failure> {
    named(variable).or(default).ok_or_else(|| {
        Failure::broken(format!(
            "Set {variable}: this system has no default place for it."
        ))
    })
}

impl Places {
    pub fn from_env() -> Result<Places, Failure> {
        let [root, data, state, config, cache] = VARIABLES;
        let [data_at, state_at, config_at, cache_at] = defaults();
        let places = Places {
            root: place(root, dirs::home_dir().map(|home| home.join("Banda")))?,
            data: place(data, data_at)?,
            state: place(state, state_at)?,
            config: place(config, config_at)?,
            cache: place(cache, cache_at)?,
        };
        #[cfg(windows)]
        windows::in_the_profile(&places, |variable| named(variable).is_some())?;
        Ok(places)
    }

    /// Every place under `base`, by its name: for tests.
    #[cfg(test)]
    pub fn under(base: &Path) -> Places {
        let at = |name: &str| base.join(name);
        Places {
            root: at("root"),
            data: at("data"),
            state: at("state"),
            config: at("config"),
            cache: at("cache"),
        }
    }

    /// Each place by the variable that moves it, so an engine started
    /// apart, as the session's service, keeps its things where its
    /// starter finds them.
    pub fn variables(&self) -> [(&'static str, &Path); 5] {
        let [root, data, state, config, cache] = VARIABLES;
        [
            (root, &self.root),
            (data, &self.data),
            (state, &self.state),
            (config, &self.config),
            (cache, &self.cache),
        ]
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

    /// Where the window listens for `banda menu` while it is open: a
    /// socket in the state folder, or on Windows a pipe named for it
    /// (window.rs).
    pub fn window(&self) -> PathBuf {
        crate::window::place(&self.state)
    }

    /// Held by the engine while it runs: one engine per state folder.
    pub fn lock(&self) -> PathBuf {
        self.state.join("engine.lock")
    }

    /// How the engine's last run went: since when, where it listened, and
    /// how it left (`run.rs`).
    pub fn run(&self) -> PathBuf {
        self.state.join("run.json")
    }

    /// This host's passes, hashed (ADR 0083, decision 2).
    pub fn passes(&self) -> PathBuf {
        self.state.join("passes.sqlite3")
    }

    /// The modes the Person chose for each Harness's new Threads in
    /// Settings, which only Full access the Person chose there counts by
    /// where the fence does not hold (ADR 0083, F0-3).
    pub fn modes_chosen(&self) -> PathBuf {
        self.state.join(banda_agents::chosen_modes::FILE)
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
pub fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
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
    drop(file);
    banda_kernel::host::rename(&temporary, path)
}
