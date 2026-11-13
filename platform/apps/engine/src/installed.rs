//! The Apps installed on this machine from a folder (ADR 0126, decision
//! 5), in Banda's own data:
//!
//! ```text
//! <data>/apps/
//!   clients/
//!     installed.json    who installed it, from where and when, and its copy
//!     1794588292418/    the folder, as it was copied at that install
//! ```
//!
//! An install copies the folder, so what runs is what was installed, and a
//! change to the folder it came from changes nothing until it is installed
//! again. It goes in three steps, so the engine never runs a copy it did
//! not take: the copy is made in a folder of its own ([`Installed::stage`]),
//! the engine takes the App from there, and only then does
//! `installed.json` name it ([`Installed::commit`]). One the engine
//! refused is taken away ([`Installed::discard`]), and the App goes on from
//! the copy it had. The copies no install names go as the engine next
//! starts ([`Installed::sweep`]): one may still be read by a worker that
//! ends as its last call does.

use crate::folder::Folder;
use crate::folder::is_id;
use banda_kernel::{Participant, ProjectId, Refusal, host};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// Who installed it and which copy runs, beside the copies.
const KEPT: &str = "installed.json";
/// The copy's folder in an install from before each had its own.
const FIRST_COPY: &str = "app";

/// The most an App's folder holds: its files, and their bytes together.
const FILES_MOST: usize = 2000;
const BYTES_MOST: u64 = 32 * 1024 * 1024;

/// Who installed an App, from where and when: what Banda keeps beside
/// the copy, and says of each installed App.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "apps/")]
pub struct InstalledFrom {
    /// The folder it was copied from.
    #[ts(type = "string")]
    pub from: PathBuf,
    /// Who installed it.
    pub by: Participant,
    /// The Project its installer worked in; none when the Person
    /// installed it by their own call.
    #[ts(optional, type = "string")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectId>,
    /// When, in ms since the epoch.
    pub at: i64,
}

/// What `installed.json` holds.
#[derive(Serialize, Deserialize)]
struct Kept {
    #[serde(flatten)]
    from: InstalledFrom,
    /// The folder of the copy that runs, beside it.
    #[serde(default = "first_copy")]
    copy: String,
}

fn first_copy() -> String {
    FIRST_COPY.to_owned()
}

/// An App installed: as its copy reads, who installed it, and its copy.
pub struct Install {
    pub app: Folder,
    pub from: InstalledFrom,
    pub copy: PathBuf,
}

/// Where this machine keeps its installed Apps: `<data>/apps`.
#[derive(Clone, Debug)]
pub struct Installed {
    root: PathBuf,
}

fn broke(what: &str, error: std::io::Error) -> Refusal {
    tracing::error!(%error, "{what}");
    Refusal::internal()
}

impl Installed {
    pub fn in_folder(root: impl Into<PathBuf>) -> Installed {
        Installed { root: root.into() }
    }

    /// Banda's loop for a worker on Node, as a file beside the Apps,
    /// written when it is not there as this engine has it. No App's id has
    /// a dot, so it is taken for none.
    pub fn runner(&self) -> PathBuf {
        let file = self.root.join(".runner.mjs");
        let same = std::fs::read_to_string(&file).is_ok_and(|kept| kept == crate::worker::RUNNER);
        if !same {
            let written = std::fs::create_dir_all(&self.root)
                .and_then(|()| std::fs::write(&file, crate::worker::RUNNER));
            if let Err(error) = written {
                tracing::error!(%error, "Banda's loop for workers was not written: no App runs");
            }
        }
        file
    }

    /// Every installed App, by id, as its copy reads now. One whose copy
    /// does not read is logged and left out: it runs nothing until it is
    /// installed again.
    pub fn list(&self) -> Vec<Install> {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut ids: Vec<String> = entries
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| is_id(name))
            .collect();
        ids.sort();
        ids.iter().filter_map(|id| self.read(id)).collect()
    }

    fn kept(&self, id: &str) -> Option<Kept> {
        let bytes = std::fs::read(self.root.join(id).join(KEPT)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn read(&self, id: &str) -> Option<Install> {
        let Some(Kept { from, copy }) = self.kept(id) else {
            tracing::error!(id, "an installed App does not say who installed it");
            return None;
        };
        let copy = self.root.join(id).join(copy);
        match Folder::read(&copy) {
            Ok(app) if app.id == id => Some(Install { app, from, copy }),
            Ok(app) => {
                tracing::error!(id, named = app.id, "an installed App names another id");
                None
            }
            Err(refusal) => {
                tracing::error!(id, why = %refusal.message, "an installed App does not read");
                None
            }
        }
    }

    /// Copies `app`, read from the folder `from.from`, into a folder of
    /// its own beside the copy that runs: where the copy is, for the
    /// engine to take the App from.
    pub fn stage(&self, app: &Folder, from: &InstalledFrom) -> Result<PathBuf, Refusal> {
        let place = self.root.join(&app.id);
        // By when it was installed, and apart from one made that moment.
        let copy = (0..)
            .map(|again| place.join(format!("{}{}", from.at, "-".repeat(again))))
            .find(|copy| !copy.exists())
            .expect("a name not taken");
        let mut copied = Copied::default();
        if let Err(refusal) = copy_folder(&from.from, &copy, &mut copied) {
            self.discard(&copy);
            return Err(refusal);
        }
        Ok(copy)
    }

    /// Names `copy`, staged and taken by the engine, as the App's that
    /// runs, installed as `from` says.
    pub fn commit(&self, app: &Folder, from: &InstalledFrom, copy: &Path) -> Result<(), Refusal> {
        let kept = Kept {
            from: from.clone(),
            copy: (copy.file_name().unwrap_or_default().to_string_lossy()).into_owned(),
        };
        let place = self.root.join(&app.id);
        let written = || -> std::io::Result<()> {
            let new = place.join(format!("{KEPT}.new"));
            std::fs::write(&new, serde_json::to_vec_pretty(&kept)?)?;
            host::rename(&new, &place.join(KEPT))
        };
        written().map_err(|e| broke("an install was not kept", e))
    }

    /// Takes away `copy`, staged and not taken: its App is as it was, and
    /// one never installed before is not installed.
    pub fn discard(&self, copy: &Path) {
        let _ = host::remove_all(copy);
        if let Some(place) = copy.parent() {
            // Only when nothing else is in it.
            let _ = std::fs::remove_dir(place);
        }
    }

    /// Takes away the copies no install names, left by an install put in
    /// another's place or cut short: as the engine starts, when no worker
    /// reads one.
    pub fn sweep(&self) {
        for Install { app, copy, .. } in self.list() {
            let place = self.root.join(&app.id);
            let others = std::fs::read_dir(&place).into_iter().flatten().flatten();
            for other in others.map(|entry| entry.path()) {
                if other.is_dir() && other != copy {
                    let _ = host::remove_all(&other);
                }
            }
        }
    }

    /// Takes the installed App `id` away. Its data stays in each Project
    /// (ADR 0085, decision 6).
    pub fn remove(&self, id: &str) -> Result<(), Refusal> {
        let place = self.root.join(id);
        if !is_id(id) || !place.is_dir() {
            return Err(Refusal::not_found(format!(
                "No App named {id} is installed on this machine."
            )));
        }
        host::remove_all(&place).map_err(|e| broke("an installed App was not removed", e))
    }
}

/// How much of a folder was copied so far.
#[derive(Default)]
struct Copied {
    files: usize,
    bytes: u64,
}

/// Copies the folder `from` to `to`: its files and its folders, but git's
/// own. A link is refused: an App's folder holds its own files.
fn copy_folder(from: &Path, to: &Path, copied: &mut Copied) -> Result<(), Refusal> {
    let unread = |error: std::io::Error| {
        Refusal::invalid(format!("{} could not be read: {error}.", from.display()))
    };
    std::fs::create_dir_all(to).map_err(|e| broke("an App's copy was not made", e))?;
    for entry in std::fs::read_dir(from).map_err(unread)? {
        let entry = entry.map_err(unread)?;
        let (path, name) = (entry.path(), entry.file_name());
        let kind = entry.file_type().map_err(unread)?;
        if kind.is_symlink() {
            return Err(Refusal::invalid(format!(
                "{} is a link: an App's folder holds its own files.",
                path.display()
            )));
        }
        if kind.is_dir() {
            if name != ".git" {
                copy_folder(&path, &to.join(&name), copied)?;
            }
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        copied.files += 1;
        copied.bytes += entry.metadata().map_err(unread)?.len();
        if copied.files > FILES_MOST || copied.bytes > BYTES_MOST {
            return Err(Refusal::invalid(format!(
                "An App's folder holds at most {FILES_MOST} files and {} MB.",
                BYTES_MOST / (1024 * 1024)
            )));
        }
        std::fs::copy(&path, to.join(&name)).map_err(unread)?;
    }
    Ok(())
}
