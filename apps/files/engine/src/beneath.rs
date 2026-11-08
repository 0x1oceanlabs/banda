//! A path an Agent's call reaches, opened from its Project's folder (ADR
//! 0083), on Linux. The path guard (`banda_kernel::Reach`) reads where a
//! path leads, its links followed, and refuses it outside the folder; a
//! read or a write then opens it from the folder, opened once, along that
//! path through no link at all: a folder put in place of another between
//! the two, or a link put in place of either, fails the open, and never
//! leads elsewhere. A write makes its new file and puts it in place in the
//! folder it opened so.
//!
//! With `openat2`, from Linux 5.6, the path is resolved beneath the
//! folder (`RESOLVE_BENEATH`) through no link (`RESOLVE_NO_SYMLINKS`,
//! `RESOLVE_NO_MAGICLINKS`). On an older kernel it is opened one name at a
//! time, none followed if it is a link (`O_NOFOLLOW`).

use rustix::fs::{CWD, Mode, OFlags, ResolveFlags};
use rustix::io::Errno;
use std::ffi::OsStr;
use std::io;
use std::os::fd::{AsFd, BorrowedFd, OwnedFd};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether this kernel has no `openat2`, once it said so.
static NO_OPENAT2: AtomicBool = AtomicBool::new(false);

/// How every name is resolved: beneath the folder, through no link.
const RESOLVE: ResolveFlags = ResolveFlags::BENEATH
    .union(ResolveFlags::NO_SYMLINKS)
    .union(ResolveFlags::NO_MAGICLINKS);

/// A Project's folder, opened once: what a walled call opens, it opens
/// from here.
pub struct Beneath {
    folder: OwnedFd,
    path: PathBuf,
    /// Whether it opens with `openat2`, else one name at a time.
    openat2: bool,
}

impl Beneath {
    /// The Project's folder `folder`, as the guard resolved it: absolute,
    /// and opened through no link.
    pub fn open(folder: &Path) -> io::Result<Beneath> {
        Beneath::opened(folder, !NO_OPENAT2.load(Ordering::Relaxed))
    }

    /// [`Beneath::open`], with `openat2` or one name at a time.
    fn opened(folder: &Path, openat2: bool) -> io::Result<Beneath> {
        let flags = OFlags::PATH | OFlags::DIRECTORY | OFlags::CLOEXEC;
        let resolve = ResolveFlags::NO_SYMLINKS | ResolveFlags::NO_MAGICLINKS;
        let opened = match self::openat2(openat2, CWD, folder, flags, Mode::empty(), resolve) {
            Some(opened) => opened?,
            None => {
                let root = rustix::fs::open("/", flags, Mode::empty())?;
                let inside = folder.strip_prefix("/").map_err(|_| outside(folder))?;
                walk(root.as_fd(), inside, flags, Mode::empty())?
            }
        };
        Ok(Beneath {
            folder: opened,
            path: folder.to_owned(),
            openat2: openat2 && !NO_OPENAT2.load(Ordering::Relaxed),
        })
    }

    /// The path `path`, which the guard resolved inside the folder, from
    /// the folder.
    fn inside<'p>(&self, path: &'p Path) -> io::Result<&'p Path> {
        let inside = path.strip_prefix(&self.path).map_err(|_| outside(path))?;
        let plain = inside
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
        plain.then_some(inside).ok_or_else(|| outside(path))
    }

    /// The file or folder at `path`, inside the folder, opened with
    /// `flags`, made with `mode` when they say so.
    pub fn file(&self, path: &Path, flags: OFlags, mode: Mode) -> io::Result<OwnedFd> {
        let inside = self.inside(path)?;
        let flags = flags | OFlags::CLOEXEC | OFlags::NOFOLLOW;
        if inside.as_os_str().is_empty() {
            return Ok(rustix::fs::openat(&self.folder, ".", flags, mode)?);
        }
        match openat2(self.openat2, &self.folder, inside, flags, mode, RESOLVE) {
            Some(opened) => opened,
            None => walk(self.folder.as_fd(), inside, flags, mode),
        }
    }

    /// The folder `path` is in, opened from the folder, and its name: what
    /// a write makes its new file in and puts in place.
    pub fn parent<'p>(&self, path: &'p Path) -> io::Result<(OwnedFd, &'p OsStr)> {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Err(outside(path));
        };
        self.inside(path)?;
        let flags = OFlags::PATH | OFlags::DIRECTORY;
        Ok((self.file(parent, flags, Mode::empty())?, name))
    }
}

/// `openat2` with `resolve`, where `asked`; none on a kernel without it,
/// which is then not asked again.
fn openat2(
    asked: bool,
    folder: impl AsFd,
    path: &Path,
    flags: OFlags,
    mode: Mode,
    resolve: ResolveFlags,
) -> Option<io::Result<OwnedFd>> {
    if !asked {
        return None;
    }
    match rustix::fs::openat2(folder, path, flags | OFlags::CLOEXEC, mode, resolve) {
        Err(Errno::NOSYS) => {
            NO_OPENAT2.store(true, Ordering::Relaxed);
            None
        }
        opened => Some(opened.map_err(io::Error::from)),
    }
}

/// `path`, plain names inside `folder`, opened one name at a time with
/// none followed if it is a link: a folder on the way that is a link is
/// no folder (`O_DIRECTORY`), and the last that is one fails
/// (`O_NOFOLLOW`).
fn walk(folder: BorrowedFd, path: &Path, flags: OFlags, mode: Mode) -> io::Result<OwnedFd> {
    let names: Vec<&OsStr> = (path.components())
        .map(|part| match part {
            Component::Normal(name) => Ok(name),
            _ => Err(outside(path)),
        })
        .collect::<io::Result<_>>()?;
    let Some((last, before)) = names.split_last() else {
        return Ok(rustix::fs::openat(
            folder,
            ".",
            flags | OFlags::CLOEXEC,
            mode,
        )?);
    };
    let through = OFlags::PATH | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut at = rustix::fs::openat(folder, ".", through, Mode::empty())?;
    for name in before {
        at = rustix::fs::openat(&at, *name, through, Mode::empty())?;
    }
    let flags = flags | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    Ok(rustix::fs::openat(&at, *last, flags, mode)?)
}

fn outside(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("{} is not inside the Project's folder", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Project's folder with `a/notes.md`, beside a folder outside it.
    fn places() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(t.path()).unwrap();
        let (project, other) = (root.join("project"), root.join("other"));
        std::fs::create_dir_all(project.join("a")).unwrap();
        std::fs::create_dir(&other).unwrap();
        std::fs::write(project.join("a/notes.md"), "mine").unwrap();
        std::fs::write(other.join("notes.md"), "secret").unwrap();
        (t, project, other)
    }

    fn read(beneath: &Beneath, path: &Path) -> io::Result<String> {
        let opened = beneath.file(path, OFlags::RDONLY, Mode::empty())?;
        std::fs::read_to_string(format!(
            "/proc/self/fd/{}",
            std::os::fd::AsRawFd::as_raw_fd(&opened)
        ))
    }

    /// Each way of opening, `openat2` and one name at a time.
    fn both(test: impl Fn(fn(&Path) -> io::Result<Beneath>)) {
        test(|folder| Beneath::opened(folder, true));
        test(|folder| Beneath::opened(folder, false));
    }

    #[test]
    fn a_folder_put_in_another_s_place_after_the_guard_leads_nowhere() {
        both(|open| {
            let (_t, project, other) = places();
            let beneath = open(&project).unwrap();
            let path = project.join("a/notes.md");
            assert_eq!(read(&beneath, &path).unwrap(), "mine");
            // The guard read `a/notes.md` as inside; then `a` becomes a
            // link to the folder outside.
            std::fs::rename(project.join("a"), project.join("was")).unwrap();
            std::os::unix::fs::symlink(&other, project.join("a")).unwrap();
            assert!(read(&beneath, &path).is_err(), "never the file outside");
            // The file itself, a link out.
            std::fs::remove_file(project.join("a")).unwrap();
            std::fs::rename(project.join("was"), project.join("a")).unwrap();
            std::fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(other.join("notes.md"), &path).unwrap();
            assert!(read(&beneath, &path).is_err());
            // Nor a path outside the folder.
            assert!(read(&beneath, &other.join("notes.md")).is_err());
            assert!(read(&beneath, &project.join("a/../../other/notes.md")).is_err());
        });
    }

    #[test]
    fn the_project_s_folder_is_opened_through_no_link() {
        both(|open| {
            let (_t, project, other) = places();
            let link = project.parent().unwrap().join("link");
            std::os::unix::fs::symlink(&other, &link).unwrap();
            assert!(open(&link).is_err());
            assert!(open(&project).is_ok());
        });
    }

    #[test]
    fn a_write_s_folder_is_opened_from_the_project_s() {
        both(|open| {
            let (_t, project, other) = places();
            let beneath = open(&project).unwrap();
            let path = project.join("a/new.md");
            let (folder, name) = beneath.parent(&path).unwrap();
            assert_eq!(name, "new.md");
            let flags = OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC;
            let made = rustix::fs::openat(&folder, name, flags, Mode::from_raw_mode(0o600));
            drop(made.unwrap());
            assert!(path.exists());
            std::fs::rename(project.join("a"), project.join("was")).unwrap();
            std::os::unix::fs::symlink(&other, project.join("a")).unwrap();
            assert!(beneath.parent(&path).is_err());
        });
    }
}
