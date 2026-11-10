//! Which paths the bytes module looks at, and the file a token serves:
//! opened through no link and known by what it is on its disk, so a token
//! never serves another file put in its place, nor one a link leads to.

use file_id::FileId;
use std::fs::File;
use std::io;
use std::path::Path;

/// Whether `asked` is a path Banda resolves at all, as the window's main
/// process does (`wholeIn`): none is empty, or starts at home (`~`), on
/// the network (`//`, `\\`) or with a scheme, which it refuses before it
/// resolves. A scheme has two letters or more, as one is a Windows drive.
pub fn resolvable(asked: &str) -> bool {
    let bytes = asked.as_bytes();
    let scheme = || {
        let name = bytes.iter().position(|&byte| byte == b':');
        name.is_some_and(|colon| {
            colon >= 2
                && bytes[0].is_ascii_alphabetic()
                && (bytes[1..colon].iter())
                    .all(|&byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
        })
    };
    let network = matches!(bytes, [b'/' | b'\\', b'/' | b'\\', ..]);
    !(asked.is_empty() || asked.starts_with('~') || network || scheme())
}

/// Whether `path` names a file on this machine's own disks, so that a look
/// at it stays on this machine (ADR 0090, decision 7): see
/// [`on_this_machine_on`].
pub fn on_this_machine(path: &Path) -> bool {
    on_this_machine_on(cfg!(windows), path.as_os_str().as_encoded_bytes())
}

/// Whether `path` is whole and on this machine's own disks: on Windows on
/// a drive, never a share or a device (`\\host\…`, `\\?\…`, `\\.\…`,
/// `\??\…`), as a look at a share sends the Person's NTLM hash to its
/// host, nor a file's stream (`x.bat::$DATA`), which opens as another kind
/// of file. Elsewhere it starts at the root, and never at `//`.
pub fn on_this_machine_on(windows: bool, path: &[u8]) -> bool {
    if path.contains(&0) {
        return false;
    }
    if windows {
        matches!(path, [drive, b':', b'\\' | b'/', ..] if drive.is_ascii_alphabetic())
            && !path[2..].contains(&b':')
    } else {
        path.starts_with(b"/") && !path.starts_with(b"//")
    }
}

/// A file opened as a token serves it.
pub struct Pinned {
    pub file: File,
    pub size: u64,
    /// What it is on its disk: its device and inode, on Windows its volume
    /// and file ID.
    pub id: FileId,
}

/// Why no file is served at a path.
#[derive(Debug)]
pub enum Unpinned {
    /// Nothing is there.
    Missing,
    /// It is a folder, or else no regular file.
    NoFile,
    /// It is not its own real path: a link is on the way to it now.
    Moved,
    Io(io::Error),
}

impl From<io::Error> for Unpinned {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Unpinned::Missing,
            _ => Unpinned::Io(error),
        }
    }
}

/// The file at `path`, which is whole and its own real path: opened
/// through no link, as no link is on the way to it and its last name is
/// opened without following one, and a regular file.
pub fn pin(path: &Path) -> Result<Pinned, Unpinned> {
    if dunce::canonicalize(path)? != path {
        return Err(Unpinned::Moved);
    }
    // Windows opens no folder to read, so there a folder is told apart
    // first.
    if cfg!(not(unix)) && !std::fs::metadata(path)?.is_file() {
        return Err(Unpinned::NoFile);
    }
    let file = open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(Unpinned::NoFile);
    }
    let id = identity(&meta, path)?;
    Ok(Pinned {
        file,
        size: meta.len(),
        id,
    })
}

/// Opens `path` to read: no link followed at its last name, and no wait
/// on a pipe no one writes, which is refused once it is open. A regular
/// file reads as it would without `O_NONBLOCK`.
#[cfg(unix)]
fn open(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    File::options()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
}

/// Opens `path` to read, sharing it with readers and writers but never
/// with a rename or a delete: while it is open, no other file takes its
/// path, so what its path is read as below is the file opened.
#[cfg(not(unix))]
fn open(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_SHARE_READ | FILE_SHARE_WRITE, without FILE_SHARE_DELETE.
    const READ_AND_WRITE: u32 = 0x1 | 0x2;
    File::options()
        .read(true)
        .share_mode(READ_AND_WRITE)
        .open(path)
}

/// What the file opened is on its disk, by the open file itself.
#[cfg(unix)]
fn identity(meta: &std::fs::Metadata, _: &Path) -> io::Result<FileId> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileId::new_inode(meta.dev(), meta.ino()))
}

/// What the file opened is on its disk, by its path: Rust's own reading
/// of it is not stable on Windows, and the open file keeps its path.
#[cfg(not(unix))]
fn identity(_: &std::fs::Metadata, path: &Path) -> io::Result<FileId> {
    file_id::get_file_id(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_starts_at_the_projects_folder_or_the_root_never_at_home_the_network_or_a_scheme() {
        for asked in ["notes.md", "src/a.ts", "/home/ro/notes.md", "../up.md"] {
            assert!(resolvable(asked), "{asked}");
        }
        // One letter and a colon is a Windows drive, not a scheme.
        assert!(resolvable("C:\\notes.md"));
        assert!(resolvable("c:/notes.md"));
        for asked in [
            "",
            "~/notes.md",
            "~",
            "file:///home/ro/notes.md",
            "https://example.com/a.png",
            "x-y.z+w:thing",
            "//server/notes.md",
            "\\\\server\\notes.md",
            "/\\server\\notes.md",
        ] {
            assert!(!resolvable(asked), "{asked}");
        }
    }

    #[test]
    fn on_windows_a_path_is_on_this_machine_on_a_drive_only_never_a_share_a_device_or_a_stream() {
        let windows = |path: &str| on_this_machine_on(true, path.as_bytes());
        for path in ["C:\\Users\\Ro\\notes.md", "c:/Users/Ro/notes.md", "D:\\"] {
            assert!(windows(path), "{path}");
        }
        for path in [
            "\\\\attacker\\share\\x.png",
            "//attacker/share/x.png",
            "\\\\?\\C:\\x.exe",
            "\\\\?\\UNC\\attacker\\share\\x",
            "\\\\.\\pipe\\banda",
            "\\??\\UNC\\attacker\\share\\x",
            "\\Users\\Ro\\notes.md",
            "C:notes.md",
            "notes.md",
            "C:\\x\\run.bat::$DATA",
            "C:\\x\\notes.md:hidden",
            "C:\\x\0.png",
        ] {
            assert!(!windows(path), "{path}");
        }
    }

    #[test]
    fn elsewhere_a_path_is_on_this_machine_from_the_root_never_from_two_slashes() {
        let elsewhere = |path: &str| on_this_machine_on(false, path.as_bytes());
        assert!(elsewhere("/home/ro/notes.md"));
        assert!(elsewhere("/Users/ro/a:b.md"));
        for path in ["//server/x", "notes.md", "~/notes.md", "/x\0"] {
            assert!(!elsewhere(path), "{path}");
        }
    }

    #[test]
    fn a_file_is_pinned_by_what_it_is_and_a_folder_or_nothing_is_not() {
        let folder = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(folder.path()).unwrap();
        let path = folder.join("a.txt");
        std::fs::write(&path, "0123456789").unwrap();
        let pinned = pin(&path).unwrap();
        assert_eq!(pinned.size, 10);
        assert_eq!(
            pin(&path).unwrap().id,
            pinned.id,
            "the same file, the same id"
        );
        // Another file put in its place is known as another.
        std::fs::rename(&path, folder.join("old.txt")).unwrap();
        std::fs::write(&path, "0123456789").unwrap();
        assert_ne!(pin(&path).unwrap().id, pinned.id);
        assert!(matches!(pin(&folder), Err(Unpinned::NoFile)));
        assert!(matches!(
            pin(&folder.join("gone.txt")),
            Err(Unpinned::Missing)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn no_link_is_followed_on_the_way_nor_at_the_last_name() {
        let folder = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(folder.path()).unwrap();
        std::fs::create_dir(folder.join("real")).unwrap();
        std::fs::write(folder.join("real/a.txt"), "a").unwrap();
        std::os::unix::fs::symlink(folder.join("real"), folder.join("via")).unwrap();
        std::os::unix::fs::symlink(folder.join("real/a.txt"), folder.join("b.txt")).unwrap();
        assert!(matches!(
            pin(&folder.join("via/a.txt")),
            Err(Unpinned::Moved)
        ));
        assert!(matches!(pin(&folder.join("b.txt")), Err(Unpinned::Moved)));
        assert!(pin(&folder.join("real/a.txt")).is_ok());
    }

    /// Without `O_NONBLOCK` the open would wait for a writer, for ever.
    #[cfg(unix)]
    #[test]
    fn a_pipe_is_no_file_and_its_open_does_not_wait() {
        let folder = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(folder.path()).unwrap();
        let pipe = folder.join("pipe.txt");
        let made = std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap();
        assert!(made.success());
        assert!(matches!(pin(&pipe), Err(Unpinned::NoFile)));
    }
}
