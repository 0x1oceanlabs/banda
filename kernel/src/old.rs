//! What older engines kept, moved once to where this one keeps it.
//!
//! - Before ADR 0069 a Project was a Space: its data was in `spaces/<id>/`,
//!   its files `space.json`, `space.sqlite3` and `space.lock`, and so were
//!   the machine's (ADR 0069, decision 3).
//! - Before ADR 0026 a Project kept its data in its folder, in `.banda/`.
//!   The first engine to see one moves that data out, into
//!   `projects/<id>/`, and the folder keeps the work alone (ADR 0026,
//!   decision 2).
//! - Before the fence a Project was trusted or not, and nobody had said it
//!   (ADR 0083, F0-3). The first engine with the fence says the trust of
//!   each that was trusted then, once for the whole store
//!   ([`said_before_fence`]).

use crate::Error;
use crate::project::{self, LOCK, MANIFEST, Manifest, Said, SaidBy};
use std::path::{Path, PathBuf};

/// The folder inside a Project that Banda kept for itself.
const OLD: &str = ".banda";

/// Where the Projects' data was while they were Spaces.
const SPACES: &str = "spaces";

/// A Space's files and what they are called now: the database before the
/// manifest, so a Project whose database did not move is never opened,
/// and so never starts an empty one.
const SPACE_FILES: [(&str, &str); 4] = [
    ("space.sqlite3-wal", "project.sqlite3-wal"),
    ("space.sqlite3-shm", "project.sqlite3-shm"),
    ("space.sqlite3", "project.sqlite3"),
    ("space.json", MANIFEST),
];

/// The lock a Space's engine held.
const SPACE_LOCK: &str = "space.lock";

/// Moves what the engine kept while Projects were Spaces (ADR 0069, for
/// good): `data`'s `spaces/` becomes `projects/`, and the machine's
/// folder's files take their new names; each Project's take theirs as the
/// kernel opens it (`rename_files`). Each step is a rename on one disk, so
/// a start cut short leaves nothing half done, and the next goes on.
pub(crate) fn from_spaces(data: &Path, projects: &Path, machine: Option<&Path>) {
    let spaces = data.join(SPACES);
    if spaces.is_dir()
        && let Err(error) = move_spaces(&spaces, projects)
    {
        tracing::error!(%error, "spaces/ did not all move to projects/; the next start goes on");
    }
    if let Some(machine) = machine
        && let Err(error) = rename_files(machine)
    {
        tracing::error!(%error, "the machine's files kept a Space's names; the next start tries again");
    }
}

/// `spaces/` into `projects/`: whole, or each Project `projects/` lacks.
fn move_spaces(spaces: &Path, projects: &Path) -> std::io::Result<()> {
    if !projects.exists() {
        return std::fs::rename(spaces, projects);
    }
    for entry in std::fs::read_dir(spaces)? {
        let entry = entry?;
        let to = projects.join(entry.file_name());
        if !to.exists() {
            std::fs::rename(entry.path(), to)?;
        }
    }
    // Left behind only when both held one Project; that one stays to see.
    let _ = std::fs::remove_dir(spaces);
    Ok(())
}

/// Gives a Space's files in `folder` their new names, unless an older
/// Banda holds it open.
pub(crate) fn rename_files(folder: &Path) -> Result<(), Error> {
    let left = |(old, new): &(&str, &str)| folder.join(old).exists() && !folder.join(new).exists();
    if !SPACE_FILES.iter().any(left) {
        return Ok(());
    }
    let lock = project::locked(&folder.join(SPACE_LOCK))?;
    for (old, new) in SPACE_FILES {
        let (old, new) = (folder.join(old), folder.join(new));
        if old.exists() && !new.exists() {
            std::fs::rename(old, new)?;
        }
    }
    drop(lock);
    let _ = std::fs::remove_file(folder.join(SPACE_LOCK));
    tracing::info!(folder = %folder.display(), "a Space's files are a Project's now");
    Ok(())
}

/// Moves out the data of every old Project in `root`'s folders that `projects`
/// does not hold yet, and whose folder no Project there names. A move that
/// fails leaves `.banda/` as it was, and the next start tries again.
pub(crate) fn move_out(root: &Path, projects: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut folders: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    folders.sort();
    let mut named: Option<Vec<PathBuf>> = None;
    for folder in folders {
        if !folder.join(OLD).is_dir() {
            continue;
        }
        let named = named.get_or_insert_with(|| named_folders(projects));
        match move_one(&folder, projects, named) {
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

/// The folders the Projects in `projects` name.
fn named_folders(projects: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(projects) else {
        return Vec::new();
    };
    (entries.flatten())
        .filter_map(|entry| Manifest::read(&entry.path()).ok())
        .map(|manifest| manifest.folder)
        .collect()
}

/// Whether it moved: `false` when `.banda/` holds no Project, or
/// `projects` holds that one already, or one of them names its folder
/// (`named`).
///
/// What a folder holds is anyone's to write, a clone's or an Agent's as
/// much as an older Banda's, so the Project it makes is foreign until the
/// Person trusts it (ADR 0083, F0-3): not trusted, its trust not said, and
/// seeing no other Project, whatever its manifest says.
fn move_one(folder: &Path, projects: &Path, named: &mut Vec<PathBuf>) -> Result<bool, Error> {
    let old = folder.join(OLD);
    // Its files are a Space's: they take their new names first.
    rename_files(&old)?;
    if !old.join(MANIFEST).is_file() {
        return Ok(false);
    }
    let mut manifest = Manifest::read(&old)?;
    let data = projects.join(manifest.id.to_string());
    if data.exists() {
        tracing::warn!(
            folder = %folder.display(),
            "this Project's data is already out of its folder; .banda/ stays"
        );
        return Ok(false);
    }
    let canonical = dunce::canonicalize(folder)?;
    if named.contains(&canonical) {
        tracing::warn!(
            folder = %folder.display(),
            "a Project names this folder already; .banda/ stays"
        );
        return Ok(false);
    }
    manifest.folder = canonical.clone();
    manifest.untrusted = true;
    manifest.trust_said = false;
    manifest.said = None;
    manifest.sees_others = false;
    manifest.scratch = false;
    manifest.version = project::VERSION;
    named.push(canonical);
    // An older Banda that has it open holds this lock.
    let lock = project::locked(&old.join(LOCK))?;
    // One rename on one disk; a copy across two, which takes the old
    // folder away only once the copy is in place.
    manifest.write(&old)?;
    match std::fs::rename(&old, &data) {
        Ok(()) => return Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }
    project::place(projects, &manifest, |to| copy(&old, to))?;
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

/// The first version of a manifest from the fence on, which says whether
/// its trust was said.
const FENCE: u32 = 1;

/// What the store keeps, in its data folder, once the upgrade that brought
/// the fence said the trust of its Projects ([`said_before_fence`]): when.
const UPGRADED: &str = "said-before-fence.json";

/// Whether the upgrade that brought the fence is still to say the trust of
/// the Projects in `data` (the engine's data folder): only until it did
/// once ([`upgraded`]).
pub(crate) fn upgrading(data: &Path) -> bool {
    !data.join(UPGRADED).exists()
}

/// Keeps in `data` that the upgrade said the trust of its Projects, so no
/// later start does it again.
pub(crate) fn upgraded(data: &Path) {
    let at = serde_json::json!({ "at": crate::now_ms() });
    if let Err(error) = project::write_whole(&data.join(UPGRADED), at.to_string().as_bytes()) {
        tracing::error!(%error, "the upgrade to the fence was not kept as done; the next start does it again");
    }
}

/// Says, once, that the Person trusts a Project they trusted before the
/// fence (Roma, 2026-11-08): while the store is [`upgrading`], a manifest
/// from before it (`version` 0) of a trusted Project, scratch ones aside,
/// is marked as said by this upgrade, with when, so it reads apart from
/// one the Person said. Once the store is [`upgraded`], it is never called
/// again: a manifest of version 0 found later, as an older engine may
/// write, is said by nobody. One not written now stays unsaid, for the
/// Person to say.
pub(crate) fn said_before_fence(data: &Path, manifest: &mut Manifest) {
    if manifest.version >= FENCE {
        return;
    }
    let trusted = !manifest.untrusted && !manifest.scratch && !manifest.trust_said;
    let upgraded = manifest.change_in(data, |manifest| {
        if trusted {
            manifest.trust_said = true;
            manifest.said = Some(Said::now(SaidBy::Upgrade));
        }
        manifest.version = project::VERSION;
    });
    match upgraded {
        Ok(()) if trusted => tracing::info!(
            project = %manifest.id,
            "a Project trusted before the fence is said to be trusted, once"
        ),
        Ok(()) => {}
        Err(error) => tracing::error!(
            data = %data.display(),
            %error,
            "a Project from before the fence was not marked; the Person says its trust"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandId, Participant, PersonId, ProjectId};

    #[test]
    fn a_copy_holds_all_but_the_lock() {
        let (from, to) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::create_dir_all(from.path().join("kept/1")).unwrap();
        std::fs::write(from.path().join("kept/1/a.md"), "a").unwrap();
        std::fs::write(from.path().join(LOCK), "").unwrap();
        copy(from.path(), to.path()).unwrap();
        assert_eq!(std::fs::read(to.path().join("kept/1/a.md")).unwrap(), b"a");
        assert!(!to.path().join(LOCK).exists());
    }

    fn old_project(root: &Path, name: &str) -> ProjectId {
        let old = root.join(name).join(OLD);
        std::fs::create_dir_all(old.join("kept/1")).unwrap();
        std::fs::write(old.join("kept/1/notes.md"), "# hi").unwrap();
        std::fs::write(old.join("space.sqlite3"), "db").unwrap();
        std::fs::write(old.join(SPACE_LOCK), "").unwrap();
        let id = ProjectId::new();
        let manifest = serde_json::json!({
            "id": id,
            "name": name,
            "author": Participant::Person(PersonId::new()),
            "command": CommandId::new(),
            "created_at": 1,
        });
        std::fs::write(old.join("space.json"), manifest.to_string()).unwrap();
        id
    }

    #[test]
    #[cfg_attr(
        windows,
        ignore = "no Banda on Windows ever kept a Project's data in its folder"
    )]
    fn an_old_projects_data_moves_out_and_names_its_folder() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_project(root.path(), "Work");
        std::fs::write(root.path().join("Work/README.md"), "work").unwrap();

        move_out(root.path(), data.path());

        let moved = data.path().join(id.to_string());
        let manifest = Manifest::read(&moved).unwrap();
        assert_eq!(manifest.id, id);
        // Foreign until the Person trusts it (ADR 0083, F0-3).
        assert!(manifest.untrusted && !manifest.trust_said && manifest.said.is_none());
        assert_eq!(manifest.version, project::VERSION);
        assert_eq!(
            manifest.folder,
            dunce::canonicalize(root.path().join("Work")).unwrap()
        );
        assert_eq!(
            std::fs::read(moved.join("kept/1/notes.md")).unwrap(),
            b"# hi"
        );
        assert_eq!(std::fs::read(moved.join("project.sqlite3")).unwrap(), b"db");
        assert!(!root.path().join("Work").join(OLD).exists());
        assert!(root.path().join("Work/README.md").is_file());
    }

    #[test]
    fn a_project_an_older_banda_holds_open_stays_where_it_is() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_project(root.path(), "Work");
        let _held = project::locked(&root.path().join("Work").join(OLD).join(SPACE_LOCK)).unwrap();

        move_out(root.path(), data.path());

        assert!(!data.path().join(id.to_string()).exists());
        assert!(
            root.path()
                .join("Work")
                .join(OLD)
                .join("space.json")
                .is_file()
        );
    }

    #[test]
    fn a_project_already_out_keeps_its_old_folder_untouched() {
        let (root, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let id = old_project(root.path(), "Work");
        std::fs::create_dir_all(data.path().join(id.to_string())).unwrap();

        move_out(root.path(), data.path());

        assert!(root.path().join("Work").join(OLD).join(MANIFEST).is_file());
    }

    /// A Space's data, as an engine before ADR 0069 kept it.
    fn space(spaces: &Path) -> ProjectId {
        let id = ProjectId::new();
        let folder = spaces.join(id.to_string());
        std::fs::create_dir_all(folder.join("kept")).unwrap();
        std::fs::write(folder.join("space.sqlite3"), "db").unwrap();
        std::fs::write(folder.join("space.sqlite3-wal"), "wal").unwrap();
        std::fs::write(folder.join("space.json"), "{}").unwrap();
        std::fs::write(folder.join(SPACE_LOCK), "").unwrap();
        id
    }

    #[test]
    fn the_spaces_are_projects_with_their_data_renamed_and_so_is_the_machine() {
        let data = tempfile::tempdir().unwrap();
        let id = space(&data.path().join(SPACES));
        let machine = data.path().join("machine");
        std::fs::create_dir_all(&machine).unwrap();
        std::fs::write(machine.join("space.sqlite3"), "machine").unwrap();
        std::fs::write(machine.join("space.json"), "{}").unwrap();
        let projects = data.path().join("projects");

        from_spaces(data.path(), &projects, Some(&machine));
        let moved = projects.join(id.to_string());
        rename_files(&moved).unwrap();

        assert_eq!(std::fs::read(moved.join("project.sqlite3")).unwrap(), b"db");
        assert_eq!(
            std::fs::read(moved.join("project.sqlite3-wal")).unwrap(),
            b"wal"
        );
        assert!(moved.join(MANIFEST).is_file() && moved.join("kept").is_dir());
        assert!(!moved.join("space.json").exists() && !moved.join(SPACE_LOCK).exists());
        assert!(!data.path().join(SPACES).exists());
        assert_eq!(
            std::fs::read(machine.join("project.sqlite3")).unwrap(),
            b"machine"
        );
        assert!(machine.join(MANIFEST).is_file());

        // Again, nothing is left to do.
        from_spaces(data.path(), &projects, Some(&machine));
        rename_files(&moved).unwrap();
        assert!(moved.join(MANIFEST).is_file());
    }

    #[test]
    fn a_space_beside_projects_joins_them_and_one_an_older_banda_holds_waits() {
        let data = tempfile::tempdir().unwrap();
        let projects = data.path().join("projects");
        let here = space(&projects);
        let joining = space(&data.path().join(SPACES));
        let _held = project::locked(&projects.join(here.to_string()).join(SPACE_LOCK)).unwrap();

        from_spaces(data.path(), &projects, None);
        rename_files(&projects.join(joining.to_string())).unwrap();
        let held = rename_files(&projects.join(here.to_string()));

        assert!(projects.join(joining.to_string()).join(MANIFEST).is_file());
        // Held open: its files keep their names until the next start.
        assert!(held.is_err());
        assert!(projects.join(here.to_string()).join("space.json").is_file());
        assert!(!projects.join(here.to_string()).join(MANIFEST).exists());
    }
}
