//! What Files does with files (ADR 0073, decision 10): makes a file or a
//! folder, renames, moves and copies, each answering what undoes it.
//!
//! Each acts on what is at a path itself: a link is renamed, moved or
//! copied as a link, never what it leads to. Nothing is written over: a
//! name taken in the folder is a clash, which the caller answers (replace,
//! keep both, skip), and what a replace takes the place of goes to the
//! Trash first, so it can come back. A move within one disk is a rename;
//! across disks it is a copy, then the first is removed. A copy goes a
//! piece at a time, so it says how far it is and stops when asked, and
//! what it left half done is removed.

use crate::model::{Clash, Clashing, Done, Job, Step};
use crate::shown;
use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::fs::{File, Metadata, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// How much of a file is copied at a time.
const CHUNK: usize = 1 << 20;
/// How often a copy says how far it is.
const EVERY: Duration = Duration::from_millis(100);

/// Why a name cannot name a file, if it cannot: empty, `.` or `..`, or
/// with a `/` or a NUL in it.
pub fn misnamed(name: &str) -> Option<&'static str> {
    if name.trim().is_empty() {
        Some("A name cannot be empty.")
    } else if name == "." || name == ".." {
        Some("A name cannot be . or ..")
    } else if name.contains(['/', '\0']) || (cfg!(windows) && name.contains('\\')) {
        Some("A name cannot hold a / .")
    } else {
        None
    }
}

/// Whether something is at `path`, a link that leads nowhere too.
pub fn there(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

/// Makes an empty file or folder at `path`, never over what is there.
pub fn make(path: &Path, folder: bool) -> io::Result<()> {
    if folder {
        std::fs::create_dir(path)
    } else {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map(drop)
    }
}

/// Renames `from` to `to`, never over what is there, where the system
/// can say so in one step; else it looks first.
pub fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        use rustix::fs::{CWD, RenameFlags, renameat_with};
        use rustix::io::Errno;
        match renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE) {
            Ok(()) => return Ok(()),
            // A disk that cannot say it, as some network ones.
            Err(Errno::INVAL | Errno::NOSYS | Errno::NOTSUP) => {}
            Err(error) => return Err(error.into()),
        }
    }
    if there(to) {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    std::fs::rename(from, to)
}

/// Whether `to` is `from` under a name that differs only in its case, on
/// a disk that does not tell them apart.
pub fn same_but_case(from: &Path, to: &Path) -> bool {
    let (Some(a), Some(b)) = (from.file_name(), to.file_name()) else {
        return false;
    };
    a != b
        && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        && from
            .canonicalize()
            .is_ok_and(|real| to.canonicalize().is_ok_and(|other| other == real))
}

/// The next free name for `name` in `dir`, taking none of `taken` either:
/// `name 2.ext`, then `name 3.ext`; `name 2.ext` again goes on from 3. A
/// folder's whole name is counted, and a dotfile's.
pub fn free_name(dir: &Path, name: &str, folder: bool, taken: &HashSet<OsString>) -> String {
    let (stem, ext) = if folder { (name, "") } else { split(name) };
    let (base, mut n) = match stem.rsplit_once(' ') {
        Some((base, number)) if !base.is_empty() => match number.parse::<u32>() {
            Ok(number) if number >= 2 && !number.to_string().starts_with('0') => (base, number + 1),
            _ => (stem, 2),
        },
        _ => (stem, 2),
    };
    loop {
        let next = format!("{base} {n}{ext}");
        if !taken.contains(OsString::from(&next).as_os_str()) && !there(&dir.join(&next)) {
            return next;
        }
        n += 1;
    }
}

/// A file's name before its extension, and its extension with its dot:
/// `.tar.gz` and the like whole, a dotfile's none.
fn split(name: &str) -> (&str, &str) {
    let Some(dot) = name.rfind('.').filter(|&dot| dot > 0) else {
        return (name, "");
    };
    let stem = &name[..dot];
    match stem.rfind('.') {
        Some(inner) if inner > 0 && stem[inner..].eq_ignore_ascii_case(".tar") => {
            (&name[..inner], &name[inner..])
        }
        _ => (stem, &name[dot..]),
    }
}

/// One thing to move or copy: from where, to where, and whether what is
/// there now goes to the Trash first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub asked: String,
    pub from: PathBuf,
    pub to: PathBuf,
    pub replace: bool,
}

/// What a move or copy does with each path.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub items: Vec<Item>,
    /// Asked to be left where they are: their clashes skipped.
    pub skipped: Vec<String>,
    /// Already where a move takes them.
    pub stay: Vec<PathBuf>,
}

/// What each of `sources` (as asked, and where it is) does as it moves or
/// copies into `dir`: the clashes to ask about, when some are to be asked.
pub fn plan(
    sources: &[(String, PathBuf)],
    dir: &Path,
    copy: bool,
    clash: Clash,
    answers: &BTreeMap<String, Clash>,
) -> Result<Plan, Vec<Clashing>> {
    let mut plan = Plan::default();
    let mut clashes = Vec::new();
    // The names this job takes in the folder, as it goes.
    let mut taken: HashSet<OsString> = HashSet::new();
    for (asked, from) in sources {
        let Some(name) = from.file_name() else {
            continue;
        };
        let folder = from.is_dir() && !from.is_symlink();
        let to = dir.join(name);
        let keep_both = |taken: &HashSet<OsString>| {
            dir.join(free_name(dir, &name.to_string_lossy(), folder, taken))
        };
        let item = |to: PathBuf, replace: bool| Item {
            asked: asked.clone(),
            from: from.clone(),
            to,
            replace,
        };
        let next = if from.parent() == Some(dir) {
            // Into its own folder: a copy is a duplicate; a move stays.
            if !copy {
                plan.stay.push(from.clone());
                continue;
            }
            item(keep_both(&taken), false)
        } else if taken.contains(name) {
            item(keep_both(&taken), false)
        } else if there(&to) {
            match answers.get(asked).copied().unwrap_or(clash) {
                Clash::Ask => {
                    clashes.push(Clashing {
                        path: asked.clone(),
                        name: name.to_string_lossy().into_owned(),
                        folder: to.is_dir(),
                    });
                    continue;
                }
                Clash::Replace => item(to, true),
                Clash::KeepBoth => item(keep_both(&taken), false),
                Clash::Skip => {
                    plan.skipped.push(asked.clone());
                    continue;
                }
            }
        } else {
            item(to, false)
        };
        if let Some(name) = next.to.file_name() {
            taken.insert(name.to_owned());
        }
        plan.items.push(next);
    }
    if clashes.is_empty() {
        Ok(plan)
    } else {
        Err(clashes)
    }
}

/// Why a job stopped before its end.
#[derive(Debug)]
pub enum Halt {
    /// It was asked to.
    Stopped,
    /// The disk refused: what, and why.
    Failed(PathBuf, io::Error),
}

impl Halt {
    fn at(path: &Path) -> impl FnOnce(io::Error) -> Halt + '_ {
        move |error| Halt::Failed(path.to_path_buf(), error)
    }
}

/// What a job hears and says while it runs: whether to stop, and how far
/// it is, as a piece of the stream.
pub struct Run<'a> {
    pub stop: &'a dyn Fn() -> bool,
    pub tell: &'a mut dyn FnMut(Job),
}

/// Bytes copied of all, said at most every [`EVERY`].
struct Bytes {
    done: u64,
    of: u64,
    said: Option<Instant>,
}

impl Bytes {
    fn add(&mut self, run: &mut Run<'_>, name: &str, n: u64) {
        self.done += n;
        if self.of == 0 || self.said.is_some_and(|said| said.elapsed() < EVERY) {
            return;
        }
        self.said = Some(Instant::now());
        (run.tell)(Job::Progress {
            done: self.done.min(self.of),
            of: self.of,
            name: name.to_owned(),
        });
    }
}

/// Moves or copies the items of `plan`, saying how far the bytes are, and
/// answers what was done and what undoes it: also when it stopped or
/// failed on the way.
pub fn run(plan: Plan, copy: bool, run: &mut Run<'_>) -> Done {
    let mut done = Done {
        paths: plan.stay.iter().map(|path| shown(path)).collect(),
        skipped: plan.skipped,
        ..Done::default()
    };
    // What a replace sent to the Trash, to come back once undone.
    let since = crate::trashcan::now();
    let mut replaced: Vec<PathBuf> = Vec::new();
    // Where each item went, and where it came from.
    let mut went: Vec<(PathBuf, PathBuf)> = Vec::new();
    // A move within a disk renames at once; the rest is copied, and what
    // a move copied is removed after.
    let mut copies = Vec::new();
    let mut halt = None;
    for mut item in plan.items {
        if (run.stop)() {
            halt = Some(Halt::Stopped);
            break;
        }
        if copy {
            copies.push(item);
            continue;
        }
        let renamed = make_room(&mut item, &mut replaced)
            .and_then(|()| rename_new(&item.from, &item.to).map_err(Halt::at(&item.from)));
        match renamed {
            Ok(()) => went.push((item.to, item.from)),
            Err(Halt::Failed(_, error)) if crosses(&error) => copies.push(item),
            Err(why) => {
                halt = Some(why);
                break;
            }
        }
    }
    if halt.is_none() && !copies.is_empty() {
        let of = copies.iter().map(|item| size_of(&item.from)).sum();
        let mut bytes = Bytes {
            done: 0,
            of,
            said: None,
        };
        let mut buffer = vec![0; CHUNK];
        for mut item in copies {
            let copied = make_room(&mut item, &mut replaced).and_then(|()| {
                copy_whole(&item.from, &item.to, &mut buffer, &mut bytes, run)
                    // What it left half done goes.
                    .inspect_err(|_| remove(&item.to))
            });
            let moved = copied.and_then(|()| match copy {
                true => Ok(()),
                false => remove_whole(&item.from).map_err(Halt::at(&item.from)),
            });
            match moved {
                Ok(()) => went.push((item.to, item.from)),
                Err(why) => {
                    halt = Some(why);
                    break;
                }
            }
        }
    }
    done.paths.extend(went.iter().map(|(to, _)| shown(to)));
    done.undo = undo(&went, copy, crate::trashcan::ids(&replaced, since));
    match halt {
        Some(Halt::Stopped) => done.stopped = true,
        Some(Halt::Failed(path, error)) => {
            done.failed = Some(format!("{} could not be done: {error}.", shown(&path)));
        }
        None => {}
    }
    done
}

/// Sends what is at an item's place to the Trash, if it is to replace it:
/// once, right before the item goes there.
fn make_room(item: &mut Item, replaced: &mut Vec<PathBuf>) -> Result<(), Halt> {
    if !std::mem::take(&mut item.replace) {
        return Ok(());
    }
    match crate::trashcan::put(std::slice::from_ref(&item.to)).failed {
        Some(why) => Err(Halt::Failed(item.to.clone(), io::Error::other(why))),
        None => {
            replaced.push(item.to.clone());
            Ok(())
        }
    }
}

/// Whether a rename failed only as it would cross from one disk to
/// another.
fn crosses(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::CrossesDevices
}

/// What undoes a move or a copy: the copies go to the Trash, or what
/// moved goes back to its folder and, where it was renamed to be kept
/// beside another, gets its name back; then what a replace sent to the
/// Trash comes back.
fn undo(went: &[(PathBuf, PathBuf)], copy: bool, replaced: Vec<String>) -> Vec<Step> {
    let mut steps = Vec::new();
    if copy {
        if !went.is_empty() {
            steps.push(Step::Trash {
                paths: went.iter().map(|(to, _)| shown(to)).collect(),
            });
        }
    } else {
        let mut back: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
        let mut names = Vec::new();
        for (to, from) in went {
            let (Some(dir), Some(name), Some(was)) =
                (from.parent(), to.file_name(), from.file_name())
            else {
                continue;
            };
            back.entry(dir.to_path_buf()).or_default().push(shown(to));
            if name != was {
                names.push(Step::Rename {
                    path: shown(&dir.join(name)),
                    name: was.to_string_lossy().into_owned(),
                });
            }
        }
        steps.extend(back.into_iter().map(|(dir, paths)| Step::Move {
            paths,
            dir: shown(&dir),
        }));
        steps.extend(names);
    }
    if !replaced.is_empty() {
        steps.push(Step::Restore { items: replaced });
    }
    steps
}

/// The bytes of the files at and under `path`, its links not followed.
fn size_of(path: &Path) -> u64 {
    let Ok(meta) = path.symlink_metadata() else {
        return 0;
    };
    if !meta.is_dir() {
        return if meta.is_file() { meta.len() } else { 0 };
    }
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().map(|entry| size_of(&entry.path())).sum())
        .unwrap_or(0)
}

/// Copies what is at `from` to `to`, where nothing is: a folder with all
/// it holds, a link as a link, a file with its permissions and its time.
fn copy_whole(
    from: &Path,
    to: &Path,
    buffer: &mut [u8],
    bytes: &mut Bytes,
    run: &mut Run<'_>,
) -> Result<(), Halt> {
    if (run.stop)() {
        return Err(Halt::Stopped);
    }
    let meta = from.symlink_metadata().map_err(Halt::at(from))?;
    if meta.is_symlink() {
        let target = std::fs::read_link(from).map_err(Halt::at(from))?;
        return link(&target, to).map_err(Halt::at(to));
    }
    if meta.is_dir() {
        std::fs::create_dir(to).map_err(Halt::at(to))?;
        let mut entries: Vec<_> = (std::fs::read_dir(from).map_err(Halt::at(from))?)
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        entries.sort();
        for name in entries {
            copy_whole(&from.join(&name), &to.join(&name), buffer, bytes, run)?;
        }
        // Its own permissions last: a folder may not let itself be written.
        return std::fs::set_permissions(to, meta.permissions()).map_err(Halt::at(to));
    }
    if !meta.is_file() {
        // A socket or a pipe holds nothing to copy.
        return Ok(());
    }
    copy_file(from, to, &meta, buffer, bytes, run)
}

fn copy_file(
    from: &Path,
    to: &Path,
    meta: &Metadata,
    buffer: &mut [u8],
    bytes: &mut Bytes,
    run: &mut Run<'_>,
) -> Result<(), Halt> {
    let name = from
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let mut source = File::open(from).map_err(Halt::at(from))?;
    let mut copy = (OpenOptions::new().write(true).create_new(true))
        .open(to)
        .map_err(Halt::at(to))?;
    loop {
        if (run.stop)() {
            return Err(Halt::Stopped);
        }
        let n = source.read(buffer).map_err(Halt::at(from))?;
        if n == 0 {
            break;
        }
        copy.write_all(&buffer[..n]).map_err(Halt::at(to))?;
        bytes.add(run, &name, n as u64);
    }
    copy.set_permissions(meta.permissions())
        .map_err(Halt::at(to))?;
    if let Ok(modified) = meta.modified() {
        let _ = copy.set_modified(modified);
    }
    Ok(())
}

/// A link at `to` that leads where `target` does.
fn link(target: &Path, to: &Path) -> io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, to);
    #[cfg(windows)]
    return if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, to)
    } else {
        std::os::windows::fs::symlink_file(target, to)
    };
}

/// Removes what is at `path`: a folder with all it holds, a link itself.
pub fn remove_whole(path: &Path) -> io::Result<()> {
    let meta = path.symlink_metadata()?;
    if meta.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// Removes what a copy left half done, if it can.
fn remove(path: &Path) {
    if let Err(error) = remove_whole(path)
        && error.kind() != io::ErrorKind::NotFound
    {
        tracing::warn!(path = %path.display(), %error, "a half copy stayed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no() -> HashSet<OsString> {
        HashSet::new()
    }

    #[test]
    fn keep_both_counts_on_from_two_before_the_extension() {
        let dir = tempfile::tempdir().unwrap();
        let at = dir.path();
        std::fs::write(at.join("a.txt"), "").unwrap();
        assert_eq!(free_name(at, "a.txt", false, &no()), "a 2.txt");
        std::fs::write(at.join("a 2.txt"), "").unwrap();
        assert_eq!(free_name(at, "a.txt", false, &no()), "a 3.txt");
        // A name kept beside another goes on from its number.
        assert_eq!(free_name(at, "a 2.txt", false, &no()), "a 3.txt");
        // Names this job took count too.
        let taken = HashSet::from([OsString::from("a 3.txt")]);
        assert_eq!(free_name(at, "a.txt", false, &taken), "a 4.txt");
    }

    #[test]
    fn keep_both_reads_a_name_as_a_person_does() {
        let dir = tempfile::tempdir().unwrap();
        let at = dir.path();
        assert_eq!(
            free_name(at, "notes.tar.gz", false, &no()),
            "notes 2.tar.gz"
        );
        assert_eq!(free_name(at, ".env", false, &no()), ".env 2");
        assert_eq!(free_name(at, "Makefile", false, &no()), "Makefile 2");
        assert_eq!(free_name(at, "v1.2.txt", false, &no()), "v1.2 2.txt");
        // A folder's dot is part of its name; a number that is not one
        // Banda gave is part of it too.
        assert_eq!(free_name(at, "lib.rs", true, &no()), "lib.rs 2");
        assert_eq!(free_name(at, "take 1", true, &no()), "take 1 2");
        assert_eq!(free_name(at, "take 01", true, &no()), "take 01 2");
    }

    #[test]
    fn a_name_is_not_empty_nor_a_path() {
        assert!(misnamed("a.txt").is_none());
        assert!(misnamed(".env").is_none());
        for bad in ["", "  ", ".", "..", "a/b", "a\0b"] {
            assert!(misnamed(bad).is_some(), "{bad:?}");
        }
    }
}
