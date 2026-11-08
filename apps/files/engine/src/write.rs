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
use banda_kernel::host;
use std::io::Write;
use std::path::Path;
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
/// folder.
pub fn locked(path: &Path, config: Option<&Path>) -> Option<Locked> {
    if let Some(why) = fenced(path, config) {
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
/// `.git`, or in Banda's settings folder `config`, or is one of them.
pub fn fenced(path: &Path, config: Option<&Path>) -> Option<Locked> {
    let git = |part: std::path::Component| host::same_name(part.as_os_str(), ".git".as_ref());
    if path.components().any(git) {
        return Some(Locked::Git);
    }
    config
        .is_some_and(|config| inside(path, config))
        .then_some(Locked::Settings)
}

/// Whether `path` is in `folder`, as it is named or as the system reads
/// it, its links followed.
fn inside(path: &Path, folder: &Path) -> bool {
    host::within(path, folder)
        || dunce::canonicalize(folder).is_ok_and(|real| host::within(path, &real))
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
