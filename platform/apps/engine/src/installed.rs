//! The Apps installed on this machine from a folder (ADR 0126, decision
//! 5), in Banda's own data:
//!
//! ```text
//! <data>/apps/
//!   clients/
//!     app/              the folder, as it was copied
//!     installed.json    who installed it, from where, and when
//! ```
//!
//! An install copies the folder, so what runs is what was installed, and a
//! change to the folder it came from changes nothing until it is installed
//! again. The copy is made beside its place and renamed into it, so a copy
//! cut short leaves the App as it was.

use crate::folder::Folder;
use crate::folder::is_id;
use banda_kernel::{Participant, ProjectId, Refusal, host};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// The copy of the App's folder, inside its place.
const COPY: &str = "app";
/// Who installed it, beside the copy.
const KEPT: &str = "installed.json";
/// A copy while it is made, and the one it replaces until that is gone:
/// no App's id has a dot, so none is taken for an App.
const NEW: &str = ".new";
const OLD: &str = ".old";

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

    /// Where the App `id` runs from: the copy of its folder.
    pub fn copy_of(&self, id: &str) -> PathBuf {
        self.root.join(id).join(COPY)
    }

    /// Every installed App, by id, as its copy reads now. One whose copy
    /// does not read is logged and left out: it runs nothing until it is
    /// installed again.
    pub fn list(&self) -> Vec<(Folder, InstalledFrom)> {
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

    fn read(&self, id: &str) -> Option<(Folder, InstalledFrom)> {
        let folder = match Folder::read(&self.copy_of(id)) {
            Ok(folder) if folder.id == id => folder,
            Ok(folder) => {
                tracing::error!(id, named = folder.id, "an installed App names another id");
                return None;
            }
            Err(refusal) => {
                tracing::error!(id, why = %refusal.message, "an installed App does not read");
                return None;
            }
        };
        let kept = std::fs::read(self.root.join(id).join(KEPT))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        if kept.is_none() {
            tracing::error!(id, "an installed App does not say who installed it");
        }
        Some((folder, kept?))
    }

    /// Copies `app`, read from the folder `kept.from`, into its place,
    /// over the copy installed before.
    pub fn install(&self, app: &Folder, kept: &InstalledFrom) -> Result<(), Refusal> {
        let place = self.root.join(&app.id);
        let new = self.root.join(format!("{}{NEW}", app.id));
        let old = self.root.join(format!("{}{OLD}", app.id));
        for left in [&new, &old] {
            if left.exists() {
                host::remove_all(left).map_err(|e| broke("an install left before stays", e))?;
            }
        }
        let made = (|| {
            let mut copied = Copied::default();
            copy(&kept.from, &new.join(COPY), &mut copied)?;
            let kept = serde_json::to_vec_pretty(kept).map_err(|_| Refusal::internal())?;
            std::fs::write(new.join(KEPT), kept).map_err(|e| broke("an install was not kept", e))
        })();
        if let Err(refusal) = made {
            let _ = host::remove_all(&new);
            return Err(refusal);
        }
        let swap = || -> std::io::Result<()> {
            if place.exists() {
                host::rename(&place, &old)?;
            }
            host::rename(&new, &place)?;
            if old.exists() {
                host::remove_all(&old)?;
            }
            Ok(())
        };
        swap().map_err(|e| broke("an install was not put in place", e))
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
fn copy(from: &Path, to: &Path, copied: &mut Copied) -> Result<(), Refusal> {
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
                copy(&path, &to.join(&name), copied)?;
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
