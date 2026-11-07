//! The system's Trash (ADR 0073, decision 10), through the `trash` crate:
//! freedesktop's on Linux, the Recycle Bin on Windows, Finder's on macOS.
//!
//! Linux and Windows let an app list what is there and put it back, so a
//! Trash is undone here, and the Trash place lists it. macOS lets no app
//! do either (its `~/.Trash` may not even be read without Full Disk
//! Access, and Finder renames what it holds as it likes): there Files
//! moves to the Trash, and Finder puts back.

use crate::model::Trashed;
use std::path::{Path, PathBuf};

/// What macOS says to a put back or a delete.
#[cfg(target_os = "macos")]
const FINDERS: &str = "On macOS, Finder keeps the Trash: put back or empty it there.";

/// What went to the Trash.
#[derive(Debug, Default)]
pub struct Put {
    /// How many of the paths went, from the first.
    pub went: usize,
    /// Why the next did not go, if one did not.
    pub failed: Option<String>,
}

/// Puts `paths` in the Trash, one after another, until one does not go.
pub fn put(paths: &[PathBuf]) -> Put {
    let mut put = Put::default();
    for path in paths {
        if let Err(error) = trash::delete(path) {
            let why = said(error);
            put.failed = Some(format!(
                "{} did not go to the Trash: {why}",
                crate::shown(path)
            ));
            break;
        }
        put.went += 1;
    }
    put
}

/// Now, as the Trash counts when it took something: seconds.
pub fn now() -> i64 {
    crate::now() / 1000
}

/// The ids that put `paths` back, those the Trash took since `since` (its
/// [`now`]), where the system says them; none on macOS. The system says
/// no id as it trashes: each is found again by where it came from, the
/// latest that came since.
#[cfg(not(target_os = "macos"))]
pub fn ids(paths: &[PathBuf], since: i64) -> Vec<String> {
    if paths.is_empty() {
        return Vec::new();
    }
    let Ok(items) = trash::os_limited::list() else {
        return Vec::new();
    };
    paths
        .iter()
        .filter_map(|path| {
            (items.iter())
                // A second may have turned between.
                .filter(|item| item.original_path() == *path && item.time_deleted >= since - 1)
                .max_by_key(|item| item.time_deleted)
                .map(|item| item.id.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn ids(_: &[PathBuf], _: i64) -> Vec<String> {
    Vec::new()
}

/// What the Trash holds, the latest first, of what came from where
/// `reached` says; none where the system lets no app list it.
pub fn list(reached: impl Fn(&Path) -> bool) -> Result<Option<Vec<Trashed>>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        use trash::TrashItemSize;
        let mut listed: Vec<Trashed> = (trash::os_limited::list().map_err(said)?)
            .into_iter()
            .filter(|item| reached(&item.original_path()))
            .map(|item| {
                let size = trash::os_limited::metadata(&item)
                    .ok()
                    .map(|meta| meta.size);
                Trashed {
                    id: item.id.to_string_lossy().into_owned(),
                    name: item.name.to_string_lossy().into_owned(),
                    from: crate::shown(&item.original_parent),
                    when: item.time_deleted.saturating_mul(1000),
                    folder: matches!(size, Some(TrashItemSize::Entries(_))),
                    size: size.and_then(|size| size.size()),
                }
            })
            .collect();
        listed.sort_by(|a, b| b.when.cmp(&a.when).then_with(|| a.name.cmp(&b.name)));
        Ok(Some(listed))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = reached;
        Ok(None)
    }
}

/// Puts back the items `ids` names, where `reached` says each may go:
/// where each is now.
pub fn restore(ids: &[String], reached: impl Fn(&Path) -> bool) -> Result<Vec<PathBuf>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let items = picked(ids, &reached)?;
        let paths = items.iter().map(trash::TrashItem::original_path).collect();
        trash::os_limited::restore_all(items).map_err(|error| match error {
            trash::Error::RestoreCollision { path, .. } => format!(
                "{} is there again, so it cannot be put back.",
                crate::shown(&path)
            ),
            trash::Error::RestoreTwins { path, .. } => format!(
                "Two items would go back to {}: put back one at a time.",
                crate::shown(&path)
            ),
            error => said(error),
        })?;
        Ok(paths)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (ids, reached);
        Err(FINDERS.to_owned())
    }
}

/// Deletes for good the items `ids` names, or every item with none, of
/// those `reached` lets go.
pub fn purge(ids: Option<&[String]>, reached: impl Fn(&Path) -> bool) -> Result<usize, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let items = match ids {
            Some(ids) => picked(ids, &reached)?,
            None => (trash::os_limited::list().map_err(said)?)
                .into_iter()
                .filter(|item| reached(&item.original_path()))
                .collect(),
        };
        let count = items.len();
        trash::os_limited::purge_all(items).map_err(said)?;
        Ok(count)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (ids, reached);
        Err(FINDERS.to_owned())
    }
}

/// The items of the Trash `ids` names: all of them there, each from where
/// `reached` lets it go.
#[cfg(not(target_os = "macos"))]
fn picked(
    ids: &[String],
    reached: &impl Fn(&Path) -> bool,
) -> Result<Vec<trash::TrashItem>, String> {
    let items = trash::os_limited::list().map_err(said)?;
    ids.iter()
        .map(|id| {
            let item = (items.iter())
                .find(|item| item.id.to_string_lossy() == **id)
                .ok_or_else(|| "It is not in the Trash any more.".to_owned())?;
            if !reached(&item.original_path()) {
                return Err(format!(
                    "{} came from outside the Project's folder.",
                    item.name.to_string_lossy()
                ));
            }
            Ok(item.clone())
        })
        .collect()
}

/// What the crate's error says, in words.
fn said(error: trash::Error) -> String {
    match error {
        trash::Error::CouldNotAccess { target } => format!("{target} cannot be reached."),
        trash::Error::TargetedRoot => "A disk's top cannot go to the Trash.".to_owned(),
        trash::Error::Os { description, .. } | trash::Error::Unknown { description } => description,
        #[cfg(all(unix, not(target_os = "macos")))]
        trash::Error::FileSystem { path, source } => {
            format!("{}: {source}", crate::shown(&path))
        }
        error => format!("{error:?}"),
    }
}
