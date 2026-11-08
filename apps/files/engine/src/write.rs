//! `files.write`: a file's new text, saved only over the text it was made
//! from (ADR 0073, decisions 4 and 8). Nothing is lost to a write from
//! elsewhere: when the file moved since, nothing is written, and the
//! answer says what is there now.
//!
//! The path comes through the path guard, which follows its links: a
//! link's target is written, if the guard lets the caller reach it, and
//! the link stays a link. What is still a link here leads nowhere, and is
//! not written through. The text goes to a new file beside it, with the
//! file's permissions, which then takes its place, so a reader sees the
//! old text or the new, never half of it. An Agent's write, on Linux, does
//! all of it in the folder it opened from its Project's, through no link
//! ([`crate::beneath`]), so nothing put in a folder's place meanwhile
//! leads it elsewhere.

use crate::model::Locked;
use crate::read::hash;
use banda_kernel::host;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

/// What became of a write.
#[derive(Debug, PartialEq, Eq)]
pub enum Saved {
    /// The file holds the text now: its hash. `wrote` is false when it
    /// held it already, so nothing was written.
    Holds { hash: String, wrote: bool },
    /// The file is not at the base: its hash now, none when it is gone.
    Moved { hash: Option<String> },
}

/// Why nothing was written, other than the file having moved.
#[derive(Debug)]
pub enum Unwritten {
    Locked(Locked),
    /// A link that leads nowhere.
    Link,
    /// The folder it goes in is not there.
    NoFolder,
    Io(std::io::Error),
}

impl From<std::io::Error> for Unwritten {
    fn from(error: std::io::Error) -> Self {
        Unwritten::Io(error)
    }
}

/// Why Files would not write `path`, a path as the guard reads it, its
/// links followed; none when it would. `config` is Banda's settings
/// folder, and `kept` what the fence keeps read-only from the caller.
pub fn locked(path: &Path, config: Option<&Path>, kept: &[PathBuf]) -> Option<Locked> {
    if let Some(why) = fenced(path, config, kept) {
        return Some(why);
    }
    // What is not there yet is no one's to refuse: a new file needs only
    // its folder, and a missing folder is the write's to say.
    #[cfg(unix)]
    let denied = |path: &Path| {
        let access = rustix::fs::access(path, rustix::fs::Access::WRITE_OK);
        access.is_err_and(|error| error != rustix::io::Errno::NOENT)
    };
    // Windows says who may write in access lists, which only a try asks
    // (ADR 0090, decision 10); its read-only mark it says plainly.
    #[cfg(not(unix))]
    let denied = |path: &Path| {
        std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().readonly())
    };
    (denied(path) || path.parent().is_some_and(denied)).then_some(Locked::Denied)
}

/// Why Files leaves `path` as it is whoever may write it: it is in
/// `.git`, or in Banda's settings folder `config`, or is one of them; or,
/// for an Agent, in what the fence keeps read-only from it (`kept`), as
/// where a setting kept in the Person's dotfiles leads, or gh's sign-in.
pub fn fenced(path: &Path, config: Option<&Path>, kept: &[PathBuf]) -> Option<Locked> {
    let git = |part: std::path::Component| host::same_name(part.as_os_str(), ".git".as_ref());
    if path.components().any(git) {
        return Some(Locked::Git);
    }
    let settings = config.into_iter().chain(kept.iter().map(PathBuf::as_path));
    settings
        .into_iter()
        .any(|folder| inside(path, folder))
        .then_some(Locked::Settings)
}

/// Whether `path` is in `folder`, as it is named or as the system reads
/// it, its links followed.
pub(crate) fn inside(path: &Path, folder: &Path) -> bool {
    host::within(path, folder)
        || dunce::canonicalize(folder).is_ok_and(|real| host::within(path, &real))
}

/// Writes `text` at `path` when the file there is still at `base`, the
/// hash it was read at; with none, when no file is there. A file that
/// holds `text` already is left as it is. Nothing is written in `config`,
/// Banda's settings, nor in what the fence keeps read-only from the
/// caller (`kept`).
pub fn write(
    path: &Path,
    text: &str,
    base: Option<&str>,
    config: Option<&Path>,
    kept: &[PathBuf],
) -> Result<Saved, Unwritten> {
    if let Some(why) = locked(path, config, kept) {
        return Err(Unwritten::Locked(why));
    }
    let was = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_symlink() => return Err(Unwritten::Link),
        // Read as a file, a folder fails as Windows says it may not be.
        Ok(meta) if meta.is_dir() => {
            return Err(std::io::Error::from(std::io::ErrorKind::IsADirectory).into());
        }
        Ok(meta) => Some((meta, hash(&std::fs::read(path)?))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let now = hash(text.as_bytes());
    let held = was.as_ref().map(|(_, hash)| hash.as_str());
    if let Some(settled) = settled(held, &now, base) {
        return Ok(settled);
    }
    let folder = path.parent().ok_or(Unwritten::NoFolder)?;
    if !folder.is_dir() {
        return Err(Unwritten::NoFolder);
    }
    let mut made = tempfile::Builder::new();
    made.prefix(".banda-").suffix(".tmp");
    // A new file is made as any program makes one, the umask narrowing it.
    #[cfg(unix)]
    if was.is_none() {
        use std::os::unix::fs::PermissionsExt;
        made.permissions(std::fs::Permissions::from_mode(0o666));
    }
    let mut new = made.tempfile_in(folder)?;
    if let Some((meta, _)) = &was {
        // Its own permissions, set as they are, past the umask.
        new.as_file().set_permissions(meta.permissions())?;
    }
    new.write_all(text.as_bytes())?;
    new.as_file().sync_all()?;
    match was {
        Some(_) => persisted(new, path, true)?,
        // Only where nothing came meanwhile; what came is what is there.
        None => match persisted(new, path, false) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Ok(Saved::Moved {
                    hash: Some(hash(&std::fs::read(path)?)),
                });
            }
            Err(error) => return Err(error.into()),
        },
    }
    Ok(Saved::Holds {
        hash: now,
        wrote: true,
    })
}

/// What a write of the text hashed `now` over the file there, hashed
/// `held` (none when none is), comes to without writing: the text there
/// already, or a file not at `base`; none when it is to write.
fn settled(held: Option<&str>, now: &str, base: Option<&str>) -> Option<Saved> {
    if held == Some(now) {
        return Some(Saved::Holds {
            hash: now.to_owned(),
            wrote: false,
        });
    }
    (held != base).then(|| Saved::Moved {
        hash: held.map(str::to_owned),
    })
}

/// [`write`], for an Agent's call on Linux: the folder `path` goes in
/// opened from the Project's `folder` through no link
/// ([`crate::beneath`]), and the file read, made and put in place there,
/// by name in that folder alone; never in what the fence keeps read-only
/// from it (`kept`).
#[cfg(target_os = "linux")]
pub fn write_beneath(
    folder: &Path,
    path: &Path,
    text: &str,
    base: Option<&str>,
    config: Option<&Path>,
    kept: &[PathBuf],
) -> Result<Saved, Unwritten> {
    use rustix::fs::{AtFlags, FileType, Mode, OFlags, RenameFlags};
    use std::io::Read;
    if let Some(why) = locked(path, config, kept) {
        return Err(Unwritten::Locked(why));
    }
    let beneath = crate::beneath::Beneath::open(folder)?;
    let (dir, name) = beneath.parent(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => Unwritten::NoFolder,
        _ => Unwritten::Io(error),
    })?;
    let read = |name: &std::ffi::OsStr| -> std::io::Result<String> {
        let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let mut bytes = Vec::new();
        std::fs::File::from(rustix::fs::openat(&dir, name, flags, Mode::empty())?)
            .read_to_end(&mut bytes)?;
        Ok(hash(&bytes))
    };
    let was = match rustix::fs::statat(&dir, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(stat) => match FileType::from_raw_mode(stat.st_mode) {
            FileType::Symlink => return Err(Unwritten::Link),
            FileType::Directory => {
                return Err(std::io::Error::from(std::io::ErrorKind::IsADirectory).into());
            }
            _ => Some((Mode::from_raw_mode(stat.st_mode & 0o7777), read(name)?)),
        },
        Err(rustix::io::Errno::NOENT) => None,
        Err(error) => return Err(std::io::Error::from(error).into()),
    };
    let now = hash(text.as_bytes());
    let held = was.as_ref().map(|(_, hash)| hash.as_str());
    if let Some(settled) = settled(held, &now, base) {
        return Ok(settled);
    }
    let (new, file) = made_in(&dir, was.is_none())?;
    let written = (|| {
        let mut file = std::fs::File::from(file);
        if let Some((mode, _)) = &was {
            // Its own permissions, set as they are, past the umask.
            rustix::fs::fchmod(&file, *mode)?;
        }
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        let flags = match was {
            Some(_) => RenameFlags::empty(),
            // Only where nothing came meanwhile; what came is what is there.
            None => RenameFlags::NOREPLACE,
        };
        match rustix::fs::renameat_with(&dir, &new, &dir, name, flags) {
            // A file system that takes no RENAME_NOREPLACE, as NFS, SMB or
            // a FUSE mount: a link made only where nothing is, then its
            // new name taken away, as `tempfile` does.
            Err(rustix::io::Errno::INVAL | rustix::io::Errno::NOSYS) if was.is_none() => {
                rustix::fs::linkat(&dir, &new, &dir, name, AtFlags::empty())?;
                let _ = rustix::fs::unlinkat(&dir, &new, AtFlags::empty());
                Ok(())
            }
            put => Ok::<_, std::io::Error>(put?),
        }
    })();
    if let Err(error) = written {
        let _ = rustix::fs::unlinkat(&dir, &new, AtFlags::empty());
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return Ok(Saved::Moved {
                hash: Some(read(name)?),
            });
        }
        return Err(error.into());
    }
    Ok(Saved::Holds {
        hash: now,
        wrote: true,
    })
}

/// A new file in the folder `dir`, made there alone, by a name of
/// Banda's: as any program makes one, the umask narrowing it, when it is
/// `new`; else the Person's alone until it takes its file's permissions.
#[cfg(target_os = "linux")]
fn made_in(
    dir: &std::os::fd::OwnedFd,
    new: bool,
) -> std::io::Result<(std::ffi::OsString, std::os::fd::OwnedFd)> {
    use rustix::fs::{Mode, OFlags};
    use std::sync::atomic::{AtomicU64, Ordering};
    static MADE: AtomicU64 = AtomicU64::new(0);
    let mode = Mode::from_raw_mode(if new { 0o666 } else { 0o600 });
    let flags = OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut tried = 0;
    loop {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.subsec_nanos());
        let made = MADE.fetch_add(1, Ordering::Relaxed);
        let name = format!(".banda-{}-{made}-{nanos}.tmp", std::process::id());
        match rustix::fs::openat(dir, &name, flags, mode) {
            Ok(file) => return Ok((name.into(), file)),
            Err(rustix::io::Errno::EXIST) if tried < 8 => tried += 1,
            Err(error) => return Err(error.into()),
        }
    }
}

/// Puts `new` in place as `path`: over the file there when `over`, else
/// only where none is, a few times while another program holds either
/// ([`host::tried`]).
pub(crate) fn persisted(new: NamedTempFile, path: &Path, over: bool) -> std::io::Result<()> {
    let mut held = Some(new);
    host::tried(|| {
        let new = held
            .take()
            .expect("tried again only once it was given back");
        let put = match over {
            true => new.persist(path),
            false => new.persist_noclobber(path),
        };
        put.map(drop).map_err(|failed| {
            held = Some(failed.file);
            failed.error
        })
    })
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    /// A Project's folder with `a/notes.md`, beside a folder outside it.
    fn places() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(t.path()).unwrap();
        let (project, other) = (root.join("project"), root.join("other"));
        std::fs::create_dir_all(project.join("a")).unwrap();
        std::fs::create_dir(&other).unwrap();
        std::fs::write(project.join("a/notes.md"), "mine").unwrap();
        (t, project, other)
    }

    #[test]
    fn an_agent_s_write_is_made_and_put_in_place_in_its_project_s_folder() {
        let (_t, project, _) = places();
        let notes = project.join("a/notes.md");
        std::fs::set_permissions(&notes, std::fs::Permissions::from_mode(0o640)).unwrap();
        let base = hash(b"mine");
        let saved = write_beneath(&project, &notes, "new", Some(&base), None, &[]).unwrap();
        assert_eq!(
            saved,
            Saved::Holds {
                hash: hash(b"new"),
                wrote: true
            }
        );
        assert_eq!(std::fs::read_to_string(&notes).unwrap(), "new");
        let mode = std::fs::metadata(&notes).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o640, "its own permissions");
        // Not at its base: nothing written.
        let saved = write_beneath(&project, &notes, "x", Some(&base), None, &[]).unwrap();
        assert_eq!(
            saved,
            Saved::Moved {
                hash: Some(hash(b"new"))
            }
        );
        // A new one, only where none is.
        let fresh = project.join("a/fresh.md");
        let saved = write_beneath(&project, &fresh, "hi", None, None, &[]).unwrap();
        assert!(matches!(saved, Saved::Holds { wrote: true, .. }));
        let saved = write_beneath(&project, &fresh, "other", None, None, &[]).unwrap();
        assert_eq!(
            saved,
            Saved::Moved {
                hash: Some(hash(b"hi"))
            }
        );
        // No new file of Banda's left behind.
        let left = std::fs::read_dir(project.join("a")).unwrap().count();
        assert_eq!(left, 2);
        let gone = write_beneath(&project, &project.join("b/x.md"), "x", None, None, &[]);
        assert!(matches!(gone, Err(Unwritten::NoFolder)));
    }

    #[test]
    fn an_agent_writes_nothing_the_fence_keeps_read_only_though_it_is_in_its_project() {
        let (_t, project, other) = places();
        // A setting kept in the Person's dotfiles, which are the Project:
        // Banda's config links to it, and the fence keeps it read-only.
        let dotfiles = project.join("banda");
        std::fs::create_dir(&dotfiles).unwrap();
        let agents = dotfiles.join("agents.toml");
        std::fs::write(&agents, "a").unwrap();
        let config = other.join("config");
        std::fs::create_dir(&config).unwrap();
        std::os::unix::fs::symlink(&agents, config.join("agents.toml")).unwrap();
        let kept = [config.clone(), agents.clone()];
        let base = hash(b"a");
        let refused = write_beneath(&project, &agents, "b", Some(&base), Some(&config), &kept);
        assert!(
            matches!(refused, Err(Unwritten::Locked(Locked::Settings))),
            "{refused:?}"
        );
        assert_eq!(std::fs::read_to_string(&agents).unwrap(), "a");
        let refused = write(&agents, "b", Some(&base), Some(&config), &kept);
        assert!(matches!(refused, Err(Unwritten::Locked(Locked::Settings))));
        // The Person's own write is as it was.
        let written = write(&agents, "b", Some(&base), Some(&config), &[]).unwrap();
        assert!(matches!(written, Saved::Holds { wrote: true, .. }));
        assert_eq!(locked(&agents, Some(&config), &[]), None);
        assert_eq!(locked(&agents, None, &kept), Some(Locked::Settings));
    }

    #[test]
    fn a_folder_put_in_another_s_place_after_the_guard_takes_no_write_outside() {
        let (_t, project, other) = places();
        std::fs::write(other.join("notes.md"), "secret").unwrap();
        // The guard read `a/notes.md` as inside; then `a` becomes a link
        // to the folder outside.
        std::fs::rename(project.join("a"), project.join("was")).unwrap();
        std::os::unix::fs::symlink(&other, project.join("a")).unwrap();
        let notes = project.join("a/notes.md");
        let base = hash(b"secret");
        let written = write_beneath(&project, &notes, "new", Some(&base), None, &[]);
        assert!(written.is_err(), "{written:?}");
        let fresh = write_beneath(&project, &project.join("a/new.md"), "new", None, None, &[]);
        assert!(fresh.is_err(), "{fresh:?}");
        assert_eq!(
            std::fs::read_to_string(other.join("notes.md")).unwrap(),
            "secret"
        );
        assert!(!other.join("new.md").exists());
        assert_eq!(std::fs::read_dir(&other).unwrap().count(), 1);
        // The file itself a link out: refused as a link, not written.
        std::fs::remove_file(project.join("a")).unwrap();
        std::fs::rename(project.join("was"), project.join("a")).unwrap();
        std::fs::remove_file(project.join("a/notes.md")).unwrap();
        std::os::unix::fs::symlink(other.join("notes.md"), project.join("a/notes.md")).unwrap();
        let linked = write_beneath(&project, &notes, "new", Some(&base), None, &[]);
        assert!(matches!(linked, Err(Unwritten::Link)), "{linked:?}");
        assert_eq!(
            std::fs::read_to_string(other.join("notes.md")).unwrap(),
            "secret"
        );
    }
}
