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
//! old text or the new, never half of it.

use crate::model::Locked;
use crate::read::hash;
use std::io::Write;
use std::path::Path;

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
/// folder.
pub fn locked(path: &Path, config: Option<&Path>) -> Option<Locked> {
    if path.components().any(|part| part.as_os_str() == ".git") {
        return Some(Locked::Git);
    }
    if config.is_some_and(|config| inside(path, config)) {
        return Some(Locked::Settings);
    }
    // What is not there yet is no one's to refuse: a new file needs only
    // its folder, and a missing folder is the write's to say.
    let denied = |path: &Path| {
        let access = rustix::fs::access(path, rustix::fs::Access::WRITE_OK);
        access.is_err_and(|error| error != rustix::io::Errno::NOENT)
    };
    (denied(path) || path.parent().is_some_and(denied)).then_some(Locked::Denied)
}

/// Whether `path` is in `folder`, as it is named or as the system reads
/// it, its links followed.
fn inside(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
        || folder
            .canonicalize()
            .is_ok_and(|real| path.starts_with(real))
}

/// Writes `text` at `path` when the file there is still at `base`, the
/// hash it was read at; with none, when no file is there. A file that
/// holds `text` already is left as it is.
pub fn write(
    path: &Path,
    text: &str,
    base: Option<&str>,
    config: Option<&Path>,
) -> Result<Saved, Unwritten> {
    if let Some(why) = locked(path, config) {
        return Err(Unwritten::Locked(why));
    }
    let was = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_symlink() => return Err(Unwritten::Link),
        Ok(meta) => Some((meta, hash(&std::fs::read(path)?))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let now = hash(text.as_bytes());
    let held = was.as_ref().map(|(_, hash)| hash.as_str());
    if held == Some(now.as_str()) {
        return Ok(Saved::Holds {
            hash: now,
            wrote: false,
        });
    }
    if held != base {
        return Ok(Saved::Moved {
            hash: held.map(str::to_owned),
        });
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
        Some(_) => {
            new.persist(path).map_err(|e| e.error)?;
        }
        // Only where nothing came meanwhile; what came is what is there.
        None => match new.persist_noclobber(path) {
            Ok(_) => {}
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Ok(Saved::Moved {
                    hash: Some(hash(&std::fs::read(path)?)),
                });
            }
            Err(e) => return Err(e.error.into()),
        },
    }
    Ok(Saved::Holds {
        hash: now,
        wrote: true,
    })
}
