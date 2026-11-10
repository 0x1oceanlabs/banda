//! A copy from beneath one of Banda's folders to beneath another, where a
//! fenced Agent may write on either side: a Project's Claude Code
//! sessions are a hole in the fence (ADR 0078, decision 3; ADR 0083,
//! decision 1), and the engine copies them outside it. Each name on the
//! way is opened from the folder before it, through no link: on the side
//! copied from, a link is passed over, so the copy never reads what the
//! fence hides; on the side copied to, a link refuses the copy, so it
//! never writes where the fence hides. A file is read from the handle
//! that was checked, and written beside its place, then put in place, in
//! the folder opened so.
//!
//! On Unix it goes by folder handles (`openat` with `O_NOFOLLOW`). Where
//! there is no fence, as on Windows, it goes by paths, a link passed over
//! or refused as it is seen.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

/// Copies each of `paths`, plain names beneath the folder `from`, to the
/// same place beneath `to`: a file whole, a folder with all in it, to
/// [`DEEPEST`] folders deep. What is not there, is a link, or is deeper,
/// copies nothing. A file already at its place is replaced only by one
/// that goes on from it, as a log or a transcript grows; one that is the
/// same, or goes on past the copy, stays. One that went another way
/// refuses the copy as `AlreadyExists`; a link, or what is neither a file
/// nor a folder, on the way to a place refuses it as `PermissionDenied`.
/// Each is looked at first, so nothing is written then.
pub fn copy_beneath(from: &Path, to: &Path, paths: &[PathBuf]) -> io::Result<()> {
    let (from, to) = (Dir::root(from)?, Dir::root(to)?);
    let paths: Vec<Vec<&OsStr>> = (paths.iter().map(PathBuf::as_path))
        .map(names)
        .collect::<Result<_, _>>()?;
    for write in [false, true] {
        for names in &paths {
            copy_path(&from, &to, names, write)?;
        }
    }
    Ok(())
}

/// The plain names of `path`, which leads nowhere else.
fn names(path: &Path) -> io::Result<Vec<&OsStr>> {
    (path.components())
        .map(|part| match part {
            Component::Normal(name) => Ok(name),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} is no path beneath a folder", path.display()),
            )),
        })
        .collect()
}

/// Copies what `names` leads to beneath `from` to the same place beneath
/// `to`, its folders made there when it `write`s; else it only looks.
fn copy_path(from: &Dir, to: &Dir, names: &[&OsStr], write: bool) -> io::Result<()> {
    let Some((last, before)) = names.split_last() else {
        return Ok(());
    };
    let mut here: Option<Dir> = None;
    for name in before {
        match here.as_ref().unwrap_or(from).found(name)? {
            Some(Found::Folder(folder)) => here = Some(folder),
            _ => return Ok(()),
        }
    }
    let Some(found) = here.as_ref().unwrap_or(from).found(last)? else {
        return Ok(());
    };
    let mut there: Option<Dir> = None;
    for name in before {
        match there.as_ref().unwrap_or(to).folder(name, write)? {
            Some(folder) => there = Some(folder),
            // Nothing there yet: all of it is new.
            None => return Ok(()),
        }
    }
    copy_found(found, there.as_ref().unwrap_or(to), last, write)
}

/// How many folders deep a folder copied whole goes, it counted: Claude
/// Code keeps a session's sub-agents a level or two beneath it. A folder
/// deeper copies nothing, so a chain of folders an Agent made, one in
/// another, never holds the copy long, nor a handle open for each.
const DEEPEST: usize = 8;

/// Copies `found` as `name` in the folder `to`: a folder by walking it,
/// each folder on the way down held open while the names in it are
/// copied, [`DEEPEST`] at most.
fn copy_found(found: Found, to: &Dir, name: &OsStr, write: bool) -> io::Result<()> {
    let folder = match found {
        Found::File(file) => return copy_file(file, to, name, write),
        Found::Folder(folder) => folder,
    };
    let Some(into) = to.folder(name, write)? else {
        return Ok(());
    };
    // Each folder on the way down: the names in it still to copy, it,
    // and where they go.
    let mut open = vec![(folder.names()?, folder, into)];
    loop {
        let deep = open.len();
        let Some((names, folder, into)) = open.last_mut() else {
            return Ok(());
        };
        let Some(name) = names.pop() else {
            open.pop();
            continue;
        };
        let inner = match folder.found(&name)? {
            Some(Found::File(file)) => {
                copy_file(file, into, &name, write)?;
                continue;
            }
            Some(Found::Folder(inner)) if deep < DEEPEST => inner,
            _ => continue,
        };
        if let Some(inside) = into.folder(&name, write)? {
            open.push((inner.names()?, inner, inside));
        }
    }
}

/// Copies the file `copy` as `name` in the folder `to`, when it goes in
/// place of the one there ([`replaces`]).
fn copy_file(mut copy: File, to: &Dir, name: &OsStr, write: bool) -> io::Result<()> {
    if replaces(&mut copy, to.file(name)?)? && write {
        to.put(name, &mut copy)?;
    }
    Ok(())
}

/// Whether `copy` goes in place of `held`, the file at its place: when
/// there is none, or `held` stops short of it. Not when `held` is the
/// same, or goes on past it; and one that went another way is refused.
fn replaces(copy: &mut File, held: Option<File>) -> io::Result<bool> {
    let Some(mut held) = held else {
        return Ok(true);
    };
    let (long, short) = (copy.metadata()?.len(), held.metadata()?.len());
    if !same_start(copy, &mut held, long.min(short))? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "a file where the copy goes went another way",
        ));
    }
    Ok(short < long)
}

/// Whether the first `length` bytes of `a` and `b` are the same.
fn same_start(a: &mut File, b: &mut File, length: u64) -> io::Result<bool> {
    const CHUNK: usize = 64 * 1024;
    a.seek(SeekFrom::Start(0))?;
    b.seek(SeekFrom::Start(0))?;
    let (mut x, mut y) = (vec![0; CHUNK], vec![0; CHUNK]);
    let mut left = length;
    while left > 0 {
        let n = CHUNK.min(usize::try_from(left).unwrap_or(CHUNK));
        a.read_exact(&mut x[..n])?;
        b.read_exact(&mut y[..n])?;
        if x[..n] != y[..n] {
            return Ok(false);
        }
        left -= n as u64;
    }
    Ok(true)
}

/// What a name in a folder is, opened.
enum Found {
    File(File),
    Folder(Dir),
}

/// A name for a file written beside its place, before it is put there:
/// one of its own, so two copies that write the same file at once, as a
/// fork's move and its source's, never write or take away each other's.
fn part() -> OsString {
    format!(".{}.part", uuid::Uuid::new_v4()).into()
}

/// A link, or what is neither a file nor a folder, where the copy goes.
fn not_plain(name: &OsStr) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("{} is a link or no plain file or folder", name.display()),
    )
}

#[cfg(unix)]
use unix::Dir;

#[cfg(unix)]
mod unix {
    use super::{Found, not_plain, part};
    use rustix::fs::{AtFlags, Mode, OFlags};
    use rustix::io::Errno;
    use std::ffi::{OsStr, OsString};
    use std::fs::File;
    use std::io::{self, Seek as _};
    use std::os::fd::OwnedFd;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    /// How a name is opened to be read: through no link, and never
    /// waiting, as on a pipe put in a file's place.
    const READ: OFlags = OFlags::RDONLY
        .union(OFlags::NOFOLLOW)
        .union(OFlags::NONBLOCK)
        .union(OFlags::CLOEXEC);
    const FOLDER: OFlags = READ.union(OFlags::DIRECTORY);

    /// A folder, opened once: each name in it is opened from here.
    pub struct Dir(OwnedFd);

    impl Dir {
        /// The folder at `path`, one of Banda's own.
        pub fn root(path: &Path) -> io::Result<Dir> {
            let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
            Ok(Dir(rustix::fs::open(path, flags, Mode::empty())?))
        }

        /// `name` in it, a file or a folder; none when it is not there,
        /// or is a link or neither.
        pub fn found(&self, name: &OsStr) -> io::Result<Option<Found>> {
            let opened = match rustix::fs::openat(&self.0, name, READ, Mode::empty()) {
                Err(Errno::NOENT | Errno::LOOP | Errno::NXIO) => return Ok(None),
                opened => File::from(opened?),
            };
            let kind = opened.metadata()?.file_type();
            Ok(if kind.is_dir() {
                Some(Found::Folder(Dir(OwnedFd::from(opened))))
            } else if kind.is_file() {
                Some(Found::File(opened))
            } else {
                None
            })
        }

        /// The folder `name` in it, made first when it `make`s; none when
        /// it is not there and is not made. A link or a file in its place
        /// is refused.
        pub fn folder(&self, name: &OsStr, make: bool) -> io::Result<Option<Dir>> {
            match rustix::fs::openat(&self.0, name, FOLDER, Mode::empty()) {
                Ok(folder) => return Ok(Some(Dir(folder))),
                Err(Errno::NOENT) if make => {}
                Err(Errno::NOENT) => return Ok(None),
                Err(Errno::LOOP | Errno::NOTDIR) => return Err(not_plain(name)),
                Err(error) => return Err(error.into()),
            }
            let mode = Mode::RWXU | Mode::RWXG | Mode::RWXO;
            match rustix::fs::mkdirat(&self.0, name, mode) {
                Ok(()) | Err(Errno::EXIST) => {}
                Err(error) => return Err(error.into()),
            }
            match rustix::fs::openat(&self.0, name, FOLDER, Mode::empty()) {
                Err(Errno::LOOP | Errno::NOTDIR) => Err(not_plain(name)),
                opened => Ok(Some(Dir(opened?))),
            }
        }

        /// The file `name` in it, if one is there. A link or a folder in
        /// its place is refused.
        pub fn file(&self, name: &OsStr) -> io::Result<Option<File>> {
            let opened = match rustix::fs::openat(&self.0, name, READ, Mode::empty()) {
                Err(Errno::NOENT) => return Ok(None),
                Err(Errno::LOOP | Errno::NXIO) => return Err(not_plain(name)),
                opened => File::from(opened?),
            };
            match opened.metadata()?.is_file() {
                true => Ok(Some(opened)),
                false => Err(not_plain(name)),
            }
        }

        /// The names in it.
        pub fn names(&self) -> io::Result<Vec<OsString>> {
            let mut names = Vec::new();
            for entry in rustix::fs::Dir::read_from(&self.0)? {
                let name = OsStr::from_bytes(entry?.file_name().to_bytes()).to_owned();
                if name != "." && name != ".." {
                    names.push(name);
                }
            }
            Ok(names)
        }

        /// Writes `from` whole as `name` in it: made beside its place, by a
        /// name of its own made there alone, then put in place.
        pub fn put(&self, name: &OsStr, from: &mut File) -> io::Result<()> {
            let part = part();
            let flags =
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
            let mode = Mode::RUSR | Mode::WUSR | Mode::RGRP | Mode::WGRP | Mode::ROTH | Mode::WOTH;
            let mut file = File::from(rustix::fs::openat(&self.0, &part, flags, mode)?);
            let put = (|| {
                from.seek(io::SeekFrom::Start(0))?;
                io::copy(from, &mut file)?;
                Ok(rustix::fs::renameat(&self.0, &part, &self.0, name)?)
            })();
            if put.is_err() {
                let _ = rustix::fs::unlinkat(&self.0, &part, AtFlags::empty());
            }
            put
        }
    }
}

#[cfg(not(unix))]
use paths::Dir;

#[cfg(not(unix))]
mod paths {
    use super::{Found, not_plain, part};
    use std::ffi::{OsStr, OsString};
    use std::fs::File;
    use std::io::{self, Seek as _};
    use std::path::{Path, PathBuf};

    /// A folder, by its path.
    pub struct Dir(PathBuf);

    impl Dir {
        pub fn root(path: &Path) -> io::Result<Dir> {
            match std::fs::metadata(path)?.is_dir() {
                true => Ok(Dir(path.to_owned())),
                false => Err(io::Error::from(io::ErrorKind::NotADirectory)),
            }
        }

        pub fn found(&self, name: &OsStr) -> io::Result<Option<Found>> {
            let path = self.0.join(name);
            let kind = match std::fs::symlink_metadata(&path) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
                found => found?.file_type(),
            };
            Ok(if kind.is_dir() {
                Some(Found::Folder(Dir(path)))
            } else if kind.is_file() {
                Some(Found::File(File::open(path)?))
            } else {
                None
            })
        }

        pub fn folder(&self, name: &OsStr, make: bool) -> io::Result<Option<Dir>> {
            let path = self.0.join(name);
            match std::fs::symlink_metadata(&path) {
                Ok(found) if found.is_dir() => Ok(Some(Dir(path))),
                Ok(_) => Err(not_plain(name)),
                Err(e) if e.kind() == io::ErrorKind::NotFound && make => {
                    std::fs::create_dir(&path)?;
                    Ok(Some(Dir(path)))
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e),
            }
        }

        pub fn file(&self, name: &OsStr) -> io::Result<Option<File>> {
            let path = self.0.join(name);
            match std::fs::symlink_metadata(&path) {
                Ok(found) if found.is_file() => Ok(Some(File::open(path)?)),
                Ok(_) => Err(not_plain(name)),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e),
            }
        }

        pub fn names(&self) -> io::Result<Vec<OsString>> {
            std::fs::read_dir(&self.0)?
                .map(|entry| entry.map(|entry| entry.file_name()))
                .collect()
        }

        pub fn put(&self, name: &OsStr, from: &mut File) -> io::Result<()> {
            let part = self.0.join(part());
            let mut file = File::create_new(&part)?;
            let put = (|| {
                from.seek(io::SeekFrom::Start(0))?;
                io::copy(from, &mut file)?;
                drop(file);
                super::super::rename(&part, &self.0.join(name))
            })();
            if put.is_err() {
                let _ = super::super::remove_left(&part);
            }
            put
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    /// Two of Banda's folders, and one beside them the fence hides.
    fn places() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let [from, to, hidden] = ["from", "to", "hidden"].map(|name| t.path().join(name));
        for folder in [&from, &to, &hidden] {
            std::fs::create_dir(folder).unwrap();
        }
        std::fs::write(hidden.join("secret"), "secret").unwrap();
        (t, from, to, hidden)
    }

    fn write(path: PathBuf, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(path: PathBuf) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_file_and_a_folder_go_whole_and_a_file_there_is_replaced_only_by_one_that_goes_on_from_it()
    {
        let (_t, from, to, _) = places();
        write(from.join("s/a.jsonl"), "one\ntwo\n");
        write(from.join("s/b/c.jsonl"), "sub\n");
        write(from.join("grown"), "one\ntwo\n");
        write(to.join("grown"), "one\n");
        write(from.join("past"), "one\n");
        write(to.join("past"), "one\ntwo\n");
        let copied = paths(&["s", "grown", "past", "gone/x"]);
        copy_beneath(&from, &to, &copied).unwrap();
        assert_eq!(read(to.join("s/a.jsonl")), "one\ntwo\n");
        assert_eq!(read(to.join("s/b/c.jsonl")), "sub\n");
        assert_eq!(read(to.join("grown")), "one\ntwo\n", "it went on here");
        assert_eq!(read(to.join("past")), "one\ntwo\n", "it went on there");
        assert!(!to.join("gone").exists(), "nothing for what is not there");
        for left in std::fs::read_dir(&to).unwrap() {
            let name = left.unwrap().file_name().into_string().unwrap();
            assert!(!name.ends_with(".part"), "{name} is left");
        }

        // One that went another way refuses the copy before any is written.
        write(from.join("new"), "new\n");
        write(from.join("apart"), "one\nthree\n");
        write(to.join("apart"), "one\ntwo\n");
        let refused = copy_beneath(&from, &to, &paths(&["new", "apart"])).unwrap_err();
        assert_eq!(refused.kind(), io::ErrorKind::AlreadyExists);
        assert!(!to.join("new").exists());
        assert_eq!(read(to.join("apart")), "one\ntwo\n");
        assert!(copy_beneath(&from, &to, &paths(&["../x"])).is_err());
    }

    #[test]
    fn a_link_where_it_copies_from_is_passed_over_and_never_read() {
        let (_t, from, to, hidden) = places();
        symlink(hidden.join("secret"), from.join("file")).unwrap();
        symlink(&hidden, from.join("folder")).unwrap();
        std::fs::create_dir(from.join("s")).unwrap();
        symlink(hidden.join("secret"), from.join("s/inside")).unwrap();
        write(from.join("s/kept"), "kept");
        let copied = paths(&["file", "folder/secret", "folder", "s"]);
        copy_beneath(&from, &to, &copied).unwrap();
        assert!(!to.join("file").exists());
        assert!(!to.join("folder").exists());
        assert!(!to.join("s/inside").exists());
        assert_eq!(read(to.join("s/kept")), "kept");
    }

    #[test]
    fn a_link_where_it_copies_to_refuses_the_copy_and_nothing_lands_beyond_it() {
        let (_t, from, to, hidden) = places();
        write(from.join("s/a"), "mine");
        write(from.join("f"), "mine");
        let planted = [
            ("s", hidden.clone()),
            ("f", hidden.join("secret")),
            ("f.part", hidden.join("secret")),
        ];
        for (name, target) in planted {
            symlink(&target, to.join(name)).unwrap();
            let copied = paths(&[if name == "s" { "s/a" } else { "f" }]);
            let refused = copy_beneath(&from, &to, &copied);
            if name == "f.part" {
                // The part has a name of its own, and the link is let be.
                refused.unwrap();
                assert_eq!(read(to.join("f")), "mine");
                assert!(to.join("f.part").is_symlink());
                std::fs::remove_file(to.join("f")).unwrap();
            } else {
                assert!(refused.is_err(), "{name}");
                std::fs::remove_file(to.join(name)).unwrap();
            }
            assert_eq!(read(hidden.join("secret")), "secret", "{name}");
            assert!(!hidden.join("a").exists(), "{name}");
        }
    }

    #[test]
    fn a_folder_goes_only_as_deep_as_a_sessions_and_what_is_deeper_copies_nothing() {
        let (_t, from, to, _) = places();
        // A chain of folders one in another, past the deepest a copy goes.
        let deep = |levels: usize| -> PathBuf { std::iter::repeat_n("a", levels).collect() };
        write(from.join("s").join(deep(DEEPEST - 1)).join("f"), "kept");
        write(from.join("s").join(deep(DEEPEST + 2)).join("f"), "deep");
        copy_beneath(&from, &to, &paths(&["s"])).unwrap();
        assert_eq!(read(to.join("s").join(deep(DEEPEST - 1)).join("f")), "kept");
        assert!(!to.join("s").join(deep(DEEPEST)).exists());
    }
}
