//! Spaces made before ADR 0026 kept their data in the folder, in `.banda/`.
//! The first engine to see one moves that data out, into `spaces/<id>/`,
//! and the folder keeps the work alone (ADR 0026, decision 2).

use crate::Error;
use crate::space::{self, LOCK, MANIFEST, Manifest};
use std::path::Path;

/// The folder inside a Space that Banda kept for itself.
const OLD: &str = ".banda";

/// Moves out the data of every old Space in `root`'s folders that `spaces`
/// does not hold yet. A move that fails leaves `.banda/` as it was, and
/// the next start tries again.
pub(crate) fn move_out(root: &Path, spaces: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut folders: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    folders.sort();
    for folder in folders {
        if !folder.join(OLD).join(MANIFEST).is_file() {
            continue;
        }
        match move_one(&folder, spaces) {
            Ok(true) => tracing::info!(folder = %folder.display(), "a Project's data moved out"),
            Ok(false) => {}
            Err(error) => tracing::error!(
                folder = %folder.display(),
                %error,
                "a Project's data did not move out; it stays in .banda/"
            ),
        }
    }
}

/// Whether it moved: `false` when `spaces` holds that Space already.
fn move_one(folder: &Path, spaces: &Path) -> Result<bool, Error> {
    let old = folder.join(OLD);
    let mut manifest = Manifest::read(&old)?;
    let data = spaces.join(manifest.id.to_string());
    if data.exists() {
        tracing::warn!(
            folder = %folder.display(),
            "this Project's data is already out of its folder; .banda/ stays"
        );
        return Ok(false);
    }
    manifest.folder = std::fs::canonicalize(folder)?;
    // An older Banda that has it open holds this lock.
    let lock = space::locked(&old.join(LOCK))?;
    // One rename on one disk; a copy across two, which takes the old
    // folder away only once the copy is in place.
    manifest.write(&old)?;
    match std::fs::rename(&old, &data) {
        Ok(()) => return Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }
    space::place(spaces, &manifest, |to| copy(&old, to))?;
    drop(lock);
    std::fs::remove_dir_all(&old)?;
    Ok(true)
}

/// Copies what the folder `from` holds into the folder `to`, all but the
/// lock.
fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == LOCK {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_dir() {
            std::fs::create_dir(to.join(&name))?;
            copy(&entry.path(), &to.join(&name))?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), to.join(&name))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandId, Participant, PersonId, SpaceId};

    #[test]
    fn a_copy_holds_all_but_the_lock() {
        let (from, to) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::create_dir_all(from.path().join("files/1")).unwrap();
        std::fs::write(from.path().join("files/1/a.md"), "a").unwrap();
        std::fs::write(from.path().join(LOCK), "").unwrap();
        copy(from.path(), to.path()).unwrap();
        assert_eq!(std::fs::read(to.path().join("files/1/a.md")).unwrap(), b"a");
        assert!(!to.path().join(LOCK).exists());
    }

    fn old_space(root: &Path, name: &str) -> SpaceId {
        let old = root.join(name).join(OLD);
        std::fs::create_dir_all(old.join("files/1")).unwrap();
        std::fs::write(old.join("files/1/notes.md"), "# hi").unwrap();
        std::fs::write(old.join("space.sqlite3"), "db").unwrap();
        std::fs::write(old.join(LOCK), "").unwrap();
        let id = SpaceId::new();
        let manifest = serde_json::json!({
            "id": id,
            "name": name,
            "author": Participant::Person(PersonId::new()),
            "command": CommandId::new(),
            "created_at": 1,
        });
        std::fs::write(old.join(MANIFEST), manifest.to_string()).unwrap();
        id
    }

    #[test]
    fn an_old_spaces_data_moves_out_and_names_its_folder() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_space(root.path(), "Work");
        std::fs::write(root.path().join("Work/README.md"), "work").unwrap();

        move_out(root.path(), data.path());

        let moved = data.path().join(id.to_string());
        let manifest = Manifest::read(&moved).unwrap();
        assert_eq!(manifest.id, id);
        assert_eq!(
            manifest.folder,
            std::fs::canonicalize(root.path().join("Work")).unwrap()
        );
        assert_eq!(
            std::fs::read(moved.join("files/1/notes.md")).unwrap(),
            b"# hi"
        );
        assert_eq!(std::fs::read(moved.join("space.sqlite3")).unwrap(), b"db");
        assert!(!root.path().join("Work").join(OLD).exists());
        assert!(root.path().join("Work/README.md").is_file());
    }

    #[test]
    fn a_space_an_older_banda_holds_open_stays_where_it_is() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_space(root.path(), "Work");
        let _held = space::locked(&root.path().join("Work").join(OLD).join(LOCK)).unwrap();

        move_out(root.path(), data.path());

        assert!(!data.path().join(id.to_string()).exists());
        assert!(root.path().join("Work").join(OLD).join(MANIFEST).is_file());
    }

    #[test]
    fn a_space_already_out_keeps_its_old_folder_untouched() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_space(root.path(), "Work");
        std::fs::create_dir_all(data.path().join(id.to_string())).unwrap();

        move_out(root.path(), data.path());

        assert!(root.path().join("Work").join(OLD).join(MANIFEST).is_file());
    }
}
