//! Which paths the bytes module looks at, and the file a token serves:
//! opened through no link and known by what it is on its disk, so a token
//! never serves another file put in its place, nor one a link leads to.

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

/// What a file is on its disk, as the open file itself says: its device
/// and inode, on Windows its volume's serial number and its file index.
pub type Identity = (u64, u64);

/// A file opened as a token serves it.
pub struct Pinned {
    pub file: File,
    pub size: u64,
    pub id: Identity,
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
/// opened without following one, and a regular file. On Windows the open
/// may follow a link put in its place; the file's ID, which the caller
/// compares, is then another's.
pub fn pin(path: &Path) -> Result<Pinned, Unpinned> {
    if dunce::canonicalize(path)? != path {
        return Err(Unpinned::Moved);
    }
    // Looked at before it is opened, as the window's host only looked: the
    // open of a device acts on it, and Windows opens no folder to read.
    if !std::fs::metadata(path)?.is_file() {
        return Err(Unpinned::NoFile);
    }
    let file = open(path)?;
    // Looked at again as it is open, as that is the file served.
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(Unpinned::NoFile);
    }
    let id = identity(&file, &meta)?;
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

/// Opens `path` to read, shared with readers, writers, a rename and a
/// delete, as the window's host opened it, so a save over it or a
/// checkout never fails while it is served. Windows may follow a link at
/// its last name: the file's ID, read from the file opened, tells.
#[cfg(not(unix))]
fn open(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// What the file opened is on its disk.
#[cfg(unix)]
fn identity(_: &File, meta: &std::fs::Metadata) -> io::Result<Identity> {
    use std::os::unix::fs::MetadataExt;
    Ok((meta.dev(), meta.ino()))
}

/// What the file opened is on its disk, read from the open file, never
/// from its path again, which another file may take as it is read.
/// Rust's own reading of it is not stable on Windows.
#[cfg(not(unix))]
fn identity(file: &File, _: &std::fs::Metadata) -> io::Result<Identity> {
    let info = winapi_util::file::information(file)?;
    Ok((info.volume_serial_number(), info.file_index()))
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
        // Nor by the open itself, should a link take the file's place
        // after it was looked at.
        assert!(open(&folder.join("b.txt")).is_err());
    }

    /// A pipe is refused before it is opened; and opened, should one take
    /// a file's place after it was looked at, it is not waited on, as
    /// without `O_NONBLOCK` its open would wait for a writer for ever.
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
        let (sent, opened) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let opened = open(&pipe).and_then(|file| file.metadata());
            sent.send(opened.map(|meta| meta.is_file())).ok();
        });
        let opened = opened.recv_timeout(std::time::Duration::from_secs(10));
        assert!(!opened.expect("the open waited").unwrap(), "no file");
    }
}
