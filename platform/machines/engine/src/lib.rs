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
//!
//! The file also says when the machine stays awake, which the engine
//! follows ([`Machine::awake`], [`awake::keep`], ADR 0097); `get` says it
//! too, and whether the machine has a battery, for Settings → Machines.

mod about;
pub mod awake;
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

pub use about::{About, about};
pub use awake::Awake;
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
    /// Whether Banda starts at login here, as the file says.
    at_login: watch::Sender<bool>,
    /// When the machine stays awake, as the file says.
    awake: watch::Sender<Awake>,
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
        let said = file::said(&path, held.as_deref(), &found);
        Machine(Arc::new(Held {
            config,
            found,
            now: watch::Sender::new(said.named),
            at_login: watch::Sender::new(said.at_login),
            awake: watch::Sender::new(said.awake),
            read: Mutex::new(held),
        }))
    }

    /// What this machine is called and drawn by, kept current: what the
    /// engine's `welcome` says, and its `machine.named` streams.
    pub fn named(&self) -> watch::Receiver<Named> {
        self.0.now.subscribe()
    }

    /// Whether Banda starts at login on this machine, kept current: the
    /// engine's launchd job keeps its plist where launchd loads it at
    /// login, or not, as it changes (ADR 0086, decision 1).
    pub fn starts_at_login(&self) -> watch::Receiver<bool> {
        self.0.at_login.subscribe()
    }

    /// When this machine stays awake, kept current: while its Agents work,
    /// and while it is on power, as `machine.toml` says (ADR 0097).
    pub fn awake(&self) -> watch::Receiver<Awake> {
        self.0.awake.subscribe()
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
        let said = file::said(&path, held.as_deref(), &self.0.found);
        *read = held;
        self.0.now.send_if_modified(|now| {
            let changed = *now != said.named;
            *now = said.named;
            changed
        });
        self.0.at_login.send_if_modified(|at_login| {
            let changed = *at_login != said.at_login;
            *at_login = said.at_login;
            changed
        });
        self.0.awake.send_if_modified(|awake| {
            let changed = *awake != said.awake;
            *awake = said.awake;
            changed
        });
    }
}

/// Whether Banda starts at login on this machine, as `machine.toml` in
/// `config` says: unless it says it does not. For a client that starts
/// the engine, which has no [`Machine`].
pub fn starts_at_login(config: &std::path::Path) -> bool {
    let path = config.join(file::NAME);
    file::at_login(&file::logged(&path, file::held(&path).as_deref()))
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
        /// Banda found, which a key machine.toml leaves out takes; when it
        /// stays awake, and whether it has a battery. The settings' `set`
        /// changes them, in machine.toml, which only the Person does; the
        /// stream `machine.named` says each change of the name and icon.
        call get(Nothing) -> Naming, Read;
    }
}

/// This machine's name and icon now, and what Banda found; what it is, in
/// words, for Settings' "This machine", as its system says now; and when it
/// stays awake, which another machine's window shows too (ADR 0097).
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "machines/")]
pub struct Naming {
    #[serde(flatten)]
    pub named: Named,
    /// What it is when its machine.toml says nothing.
    pub found: Named,
    /// The system it runs, "Arch Linux", "macOS 26.1"; none where the
    /// system does not say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub system: Option<String>,
    /// Its model, as its maker names it, "MacBook Pro"; none where its
    /// firmware does not say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// When it stays awake, as its machine.toml says now.
    pub awake: Awake,
    /// It has a battery of its own, as a laptop: Settings says what a
    /// closed lid does to it (ADR 0097, decision 4).
    pub battery: bool,
}

impl Machines {
    async fn get(&self, _: Call, _: Nothing) -> Result<Naming, Refusal> {
        // The file as it is now, so a `set` just made is in the answer
        // before the folder's watch hears it.
        self.machine.reread();
        let battery = found::battery().await;
        let About { system, model } = about();
        Ok(Naming {
            named: self.machine.now(),
            found: self.machine.0.found.clone(),
            system,
            model,
            awake: *self.machine.0.awake.borrow(),
            battery,
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

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::MachineIcon;

    #[test]
    fn whether_banda_starts_at_login_follows_the_file() {
        let config = tempfile::tempdir().unwrap();
        let found = Named {
            name: "m1pro".to_owned(),
            icon: MachineIcon::Laptop,
        };
        let machine = Machine::new(config.path(), found);
        let mut at_login = machine.starts_at_login();
        assert!(*at_login.borrow_and_update(), "on, with no file");
        assert!(starts_at_login(config.path()));

        std::fs::write(config.path().join(file::NAME), "start-at-login = false\n").unwrap();
        machine.reread();
        assert!(at_login.has_changed().unwrap());
        assert!(!*at_login.borrow_and_update());
        assert!(!starts_at_login(config.path()));
        assert_eq!(machine.now().name, "m1pro", "the name as it was");

        // A change of the name alone says nothing new of it.
        std::fs::write(
            config.path().join(file::NAME),
            "name = \"studio\"\nstart-at-login = false\n",
        )
        .unwrap();
        machine.reread();
        assert!(!at_login.has_changed().unwrap());
    }

    #[test]
    fn when_the_machine_stays_awake_follows_the_file() {
        let config = tempfile::tempdir().unwrap();
        let found = Named {
            name: "m1pro".to_owned(),
            icon: MachineIcon::Laptop,
        };
        let machine = Machine::new(config.path(), found);
        let mut awake = machine.awake();
        let by_default = Awake {
            while_working: true,
            plugged_in: false,
        };
        assert_eq!(*awake.borrow_and_update(), by_default, "with no file");

        std::fs::write(config.path().join(file::NAME), "awake-plugged-in = true\n").unwrap();
        machine.reread();
        assert!(awake.has_changed().unwrap());
        let plugged = Awake {
            plugged_in: true,
            ..by_default
        };
        assert_eq!(*awake.borrow_and_update(), plugged);

        // A change of the name alone says nothing new of it.
        std::fs::write(
            config.path().join(file::NAME),
            "name = \"studio\"\nawake-plugged-in = true\n",
        )
        .unwrap();
        machine.reread();
        assert!(!awake.has_changed().unwrap());

        std::fs::remove_file(config.path().join(file::NAME)).unwrap();
        machine.reread();
        assert_eq!(*awake.borrow_and_update(), by_default, "taken out");
    }
}
