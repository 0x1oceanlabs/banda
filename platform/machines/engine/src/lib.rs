//! The machines module: what this machine is called and drawn by, the
//! same in every window that shows it (ADR 0095). Its name and icon are
//! the host's own (ADR 0081, decision 12): its `machine.toml` says them,
//! else Banda finds them once as the engine starts ([`found`]).
//!
//! The engine says them in its `welcome` ([`Machine::named`]), and again
//! on the kernel's `machine.named` stream whenever they change: through
//! the settings' `set`, which only the Person calls for this file, or as
//! the file changes by hand. This module follows the file for it, and
//! answers `get` for Settings.

mod file;
mod found;

use banda_kernel::{
    Call, Error, Kind, Module, ModuleProject, Named, Nothing, Refusal, Right, Scope,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;
use ts_rs::TS;

pub use found::found;

/// The module's settings files in `~/.config/banda` (ADR 0016).
pub const SETTINGS: [banda_look::SettingsFile; 1] = [file::FILE];

/// This machine's name and icon, as `machine.toml` says them over what
/// Banda found: the module keeps it current, and the API's `welcome`
/// reads it. A clone is the same.
#[derive(Clone)]
pub struct Machine(Arc<Held>);

struct Held {
    /// The config folder `machine.toml` is in.
    config: PathBuf,
    found: Named,
    now: watch::Sender<Named>,
    /// The file as last read, none while it is not there: what it holds,
    /// not its time, tells a change, as the look's files do, so a change
    /// of another file of the folder logs nothing again.
    read: Mutex<Option<Vec<u8>>>,
}

impl Machine {
    /// The machine as `machine.toml` in `config` says, over what Banda
    /// `found`.
    pub fn new(config: impl Into<PathBuf>, found: Named) -> Machine {
        let config = config.into();
        let path = config.join(file::NAME);
        let held = file::held(&path);
        let named = file::named(&path, held.as_deref(), &found);
        Machine(Arc::new(Held {
            config,
            found,
            now: watch::Sender::new(named),
            read: Mutex::new(held),
        }))
    }

    /// What this machine is called and drawn by, kept current: what the
    /// engine's `welcome` says, and its `machine.named` streams.
    pub fn named(&self) -> watch::Receiver<Named> {
        self.0.now.subscribe()
    }

    fn now(&self) -> Named {
        self.0.now.borrow().clone()
    }

    /// Reads `machine.toml` again, and keeps what it names, when it
    /// changed: `machine.named` hears it when that is not what it named.
    fn reread(&self) {
        let path = self.0.config.join(file::NAME);
        let held = file::held(&path);
        let mut read = self.0.read.lock().unwrap_or_else(|read| read.into_inner());
        if held == *read {
            return;
        }
        let named = file::named(&path, held.as_deref(), &self.0.found);
        *read = held;
        self.0.now.send_if_modified(|now| {
            let changed = *now != named;
            *now = named;
            changed
        });
    }
}

/// The machines module.
pub struct Machines {
    machine: Machine,
}

impl Machines {
    pub fn new(machine: Machine) -> Self {
        Self { machine }
    }
}

banda_kernel::methods! {
    Machines(Call) as "MachinesMethods" in "machines/" {
        /// This machine's name and icon, as every window shows it, and what
        /// Banda found, which a key machine.toml leaves out takes. The
        /// settings' `set` changes them, in machine.toml, which only the
        /// Person does; the stream `machine.named` says each change.
        call get(Nothing) -> Naming, Read;
    }
}

/// This machine's name and icon now, and what Banda found.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "machines/")]
pub struct Naming {
    #[serde(flatten)]
    pub named: Named,
    /// What it is when its machine.toml says nothing.
    pub found: Named,
}

impl Machines {
    async fn get(&self, _: Call, _: Nothing) -> Result<Naming, Refusal> {
        Ok(Naming {
            named: self.machine.now(),
            found: self.machine.0.found.clone(),
        })
    }
}

#[async_trait::async_trait]
impl Module for Machines {
    fn name(&self) -> &'static str {
        "machines"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    /// Follows the config folder, so a change by hand, or by the
    /// settings' `set`, is heard at once.
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        let config = self.machine.0.config.clone();
        // Made, so a file written there later is heard.
        if let Err(error) = std::fs::create_dir_all(&config) {
            tracing::warn!(%error, "the config folder was not made: the machine's name is not followed");
        }
        // Resolved, as the system names what changed by the real path: on
        // macOS a folder under /var is heard as one under /private/var.
        let config = dunce::canonicalize(&config).unwrap_or(config);
        let mut watch = match project.watch([config]) {
            Ok(watch) => watch,
            Err(error) => {
                tracing::warn!(%error, "the machine's name is not followed");
                return Ok(());
            }
        };
        if let [folder, ..] = watch.limited() {
            tracing::warn!(
                folder = %folder.display(),
                "the system had no watch left for the config folder, so a change of the \
                 machine's name is heard as the engine starts again: raise inotify's \
                 max_user_watches"
            );
        }
        let machine = self.machine.clone();
        tokio::spawn(async move {
            while watch.next().await.is_some() {
                machine.reread();
            }
        });
        // What changed before the watch began.
        self.machine.reread();
        Ok(())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}
