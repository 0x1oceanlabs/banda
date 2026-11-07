//! `files.places`: the Person's home, Desktop and Downloads, as the system
//! names them (ADR 0073, decision 1), so the window does not guess. On
//! Linux the XDG user dirs say where Desktop and Downloads are; on macOS
//! they are the standard folders.

use crate::model::Places;
use crate::shown;
use std::path::{Path, PathBuf};

/// The places on this machine; none without a home.
pub fn here() -> Option<Places> {
    let home = dirs::home_dir()?;
    Some(of(&home, dirs::desktop_dir(), dirs::download_dir()))
}

/// The places under `home`: the folder the system names for each, else
/// the one of that name in `home`, when it is there.
pub fn of(home: &Path, desktop: Option<PathBuf>, downloads: Option<PathBuf>) -> Places {
    let place = |named: Option<PathBuf>, name: &str| {
        (named.into_iter())
            .chain([home.join(name)])
            .find(|path| path.is_dir())
            .map(|path| shown(&path))
    };
    Places {
        home: shown(home),
        desktop: place(desktop, "Desktop"),
        downloads: place(downloads, "Downloads"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_is_the_systems_folder_else_the_one_in_home_and_none_when_neither_is_there() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path();
        std::fs::create_dir_all(home.join("Bureau")).unwrap();
        std::fs::create_dir_all(home.join("Downloads")).unwrap();
        // The system names a Desktop of its own, and a Downloads not there.
        let places = of(
            home,
            Some(home.join("Bureau")),
            Some(home.join("Téléchargements")),
        );
        assert_eq!(places.home, shown(home));
        assert_eq!(places.desktop, Some(shown(&home.join("Bureau"))));
        assert_eq!(places.downloads, Some(shown(&home.join("Downloads"))));
        // Neither named nor there.
        let bare = tempfile::tempdir().unwrap();
        let places = of(bare.path(), None, None);
        assert_eq!((places.desktop, places.downloads), (None, None));
    }
}
