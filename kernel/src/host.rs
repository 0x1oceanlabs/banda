//! The host system's ways, where the engine needs them alike on each (ADR
//! 0090, decision 3): the PATH a program is found on and how it is found,
//! how a program the engine runs for itself starts, how two paths compare,
//! which paths are on this machine's own disks, which names a file cannot
//! have, how a file written whole is put in place, and how one is copied
//! where a fenced Agent may write (`host/beneath.rs`). Unix's ways are the
//! plain ones; Windows' differ, and are in `host/windows.rs`.
//!
//! On Windows each program the engine starts, on its own or through a
//! Project's environment, shares the engine's console, which was started
//! hidden, so none opens a window; none gets a console of its own, which
//! would be one more hidden `conhost.exe` each. Each leads a process group
//! of its own ([`hide`]), so a Ctrl+C in a console where someone runs
//! `banda serve` by hand reaches the engine alone.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

mod beneath;
#[cfg(windows)]
mod windows;

pub use beneath::copy_beneath;

/// What each program the engine starts on Windows starts with:
/// `CREATE_NEW_PROCESS_GROUP`, and no `CREATE_NO_WINDOW`.
#[cfg(windows)]
pub(crate) const FLAGS: ::windows::Win32::System::Threading::PROCESS_CREATION_FLAGS =
    ::windows::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

/// Starts `command` as each program the engine starts on the host does: on
/// Windows in the engine's hidden console, leading a process group of its
/// own; elsewhere as it is. A tokio command passes `as_std_mut()`.
pub fn hide(command: &mut std::process::Command) {
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(command, FLAGS.0);
    #[cfg(not(windows))]
    let _ = command;
}

/// `program`, a program the engine runs for itself on the host, as a
/// Project's environment starts one: found on the PATH the host has now
/// ([`path`]), and given that PATH, in the engine's hidden console
/// ([`hide`]). One not found does not start, so Windows never looks for it
/// further, in `WindowsApps` among the rest. It is killed once let go of.
pub fn command(program: impl AsRef<Path>) -> io::Result<tokio::process::Command> {
    command_on(program, path())
}

/// [`command`], found on `path` and given it.
pub fn command_on(
    program: impl AsRef<Path>,
    path: OsString,
) -> io::Result<tokio::process::Command> {
    let program = program.as_ref();
    let found = find(program, &path).ok_or_else(|| {
        let missing = format!("{} is not on PATH.", program.display());
        io::Error::new(io::ErrorKind::NotFound, missing)
    })?;
    Ok(starting(found, path))
}

/// The command that starts `found` with the PATH `path`, killed once let
/// go of, in the engine's hidden console ([`hide`]).
fn starting(found: PathBuf, path: OsString) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(found);
    command.env("PATH", path).kill_on_drop(true);
    hide(command.as_std_mut());
    command
}

/// Whether the engine's own programs are found only where root changes
/// them ([`guard`]).
static GUARDED: AtomicBool = AtomicBool::new(false);

/// The programs [`own`] found in no place only root changes, and so did
/// not start, each said in the log once.
static UNGUARDED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

/// Says that the fence holds (ADR 0083): a program the engine runs for
/// itself on the host ([`own`]) is found then only where only root
/// changes it, when there is one. The engine says it once, as it finds
/// that the fence holds.
pub fn guard() {
    GUARDED.store(true, Ordering::Relaxed);
}

/// Whether the engine said [`guard`].
pub fn guarded() -> bool {
    GUARDED.load(Ordering::Relaxed)
}

/// What sets a command up to start behind the fence (ADR 0083): the
/// launcher, starting the command's program with its arguments,
/// variables and folder, and the folders the fence hides that it reads
/// besides opened to it.
pub type Fencing = Box<
    dyn Fn(&tokio::process::Command, &[PathBuf]) -> io::Result<tokio::process::Command>
        + Send
        + Sync,
>;

/// How the engine's own bookkeeping starts behind the fence, once the
/// engine said [`fence_books`].
static BOOKS: std::sync::OnceLock<Fencing> = std::sync::OnceLock::new();

/// Says how a program the engine runs for its own books that reads what an
/// Agent may write, as git reads a repository's config and attributes,
/// starts behind the fence: whatever such a program runs then reaches no
/// more than an Agent does. The engine says it once, as it finds that the
/// fence holds.
pub fn fence_books(fencing: Fencing) {
    let _ = BOOKS.set(fencing);
}

/// Whether the engine said [`fence_books`].
pub fn books_fenced() -> bool {
    BOOKS.get().is_some()
}

/// `command`, behind the fence where the engine said [`fence_books`], with
/// `reads` opened to it; else as it is.
pub fn books(
    command: tokio::process::Command,
    reads: &[PathBuf],
) -> io::Result<tokio::process::Command> {
    match BOOKS.get() {
        Some(fencing) => fencing(&command, reads),
        None => Ok(command),
    }
}

/// `program`, one the engine runs for itself on the host and no
/// Project's, as [`command`] starts it; where the engine said [`guard`],
/// the first of that name on the PATH that only root changes
/// ([`only_root_changes`]), as named, so a link starts as its name says;
/// and given the folders of the PATH only root changes alone, so what it
/// starts by name is root's too. With none of root's there, it does not
/// start: one an Agent could change would run outside the fence. The log
/// says so once for each.
pub fn own(program: impl AsRef<Path>) -> io::Result<tokio::process::Command> {
    let path = self::path();
    match owned(program.as_ref(), &path, guarded()) {
        Owned::Root(found, given) => Ok(starting(found, given)),
        Owned::Unguarded | Owned::Missing => command_on(program, path),
        Owned::NotRoots(found) => {
            if UNGUARDED.lock().unwrap().insert(found.clone()) {
                tracing::warn!(
                    program = %found.display(),
                    "Banda does not run this program for itself while the fence holds: it is \
                     in a place an Agent can change, and none of its name on the PATH is in a \
                     place only root changes"
                );
            }
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "{} is not in a place only root changes, so Banda does not run it for \
                     itself while the fence holds.",
                    program.as_ref().display()
                ),
            ))
        }
    }
}

/// What [`own`] finds for a program.
#[derive(Debug, PartialEq, Eq)]
pub enum Owned {
    /// Not `guarded`: found as [`command`] finds it.
    Unguarded,
    /// One only root changes, and the PATH of root's folders it is given.
    Root(PathBuf, OsString),
    /// None of root's: the first there is, which does not start.
    NotRoots(PathBuf),
    /// None of that name at all: it is not installed.
    Missing,
}

/// What [`own`] starts for `program` on `path`, where `guarded`.
pub fn owned(program: &Path, path: &OsStr, guarded: bool) -> Owned {
    if !guarded {
        return Owned::Unguarded;
    }
    if let Some(found) = programs(program, path).find(|found| only_root_changes(found)) {
        let roots = std::env::split_paths(path).filter(|folder| only_root_changes(folder));
        let given = std::env::join_paths(roots).unwrap_or_default();
        return Owned::Root(found, given);
    }
    match find(program, path) {
        Some(found) => Owned::NotRoots(found),
        None => Owned::Missing,
    }
}

/// The system's own program `name`, as the PATH finds it: the first of
/// that name that only root changes ([`only_root_changes`]); none where
/// there is none. For a program that is always the system's, as systemd's
/// `systemctl`, which the engine and its clients run outside the fence,
/// whether it holds or not.
pub fn system(name: &str) -> Option<PathBuf> {
    system_on(name, &path())
}

/// [`system`], on `path`.
pub fn system_on(name: &str, path: &OsStr) -> Option<PathBuf> {
    programs(Path::new(name), path).find(|found| only_root_changes(found))
}

/// Whether only root changes `path`, as it is named and where it leads:
/// it and each folder above it are root's, and a folder or a file is
/// written by no one else, but a group this user is not in, as NixOS's
/// store is by its builders' (`root:nixbld`, `1775`); a link on the way is
/// root's, in a folder only root changes, so no one else moves it.
#[cfg(unix)]
pub fn only_root_changes(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let groups = own_groups();
    let roots = |found: &std::fs::Metadata| {
        let others = written_by_others(found.mode(), found.gid(), &groups);
        found.uid() == 0 && (found.file_type().is_symlink() || !others)
    };
    let named = (path.ancestors()).all(|at| std::fs::symlink_metadata(at).is_ok_and(|f| roots(&f)));
    named
        && path.is_absolute()
        && dunce::canonicalize(path).is_ok_and(|real| {
            (real.ancestors()).all(|at| std::fs::metadata(at).is_ok_and(|f| roots(&f)))
        })
}

/// Whether a file of `mode` and the group `gid` is written by anyone but
/// its owner and a group this user is not in (`groups`).
#[cfg(unix)]
fn written_by_others(mode: u32, gid: u32, groups: &BTreeSet<u32>) -> bool {
    mode & 0o002 != 0 || (mode & 0o020 != 0 && groups.contains(&gid))
}

/// The groups this user writes as: the engine's own, and each the system's
/// list of groups names the user in, which `sg` takes on at once.
#[cfg(unix)]
fn own_groups() -> BTreeSet<u32> {
    let mut groups: BTreeSet<u32> = (rustix::process::getgroups().unwrap_or_default().iter())
        .map(|group| group.as_raw())
        .collect();
    groups.insert(rustix::process::getegid().as_raw());
    groups.insert(rustix::process::getgid().as_raw());
    let uid = rustix::process::getuid().as_raw();
    let passwd = std::fs::read_to_string("/etc/passwd").unwrap_or_default();
    let mine = passwd.lines().find_map(|line| {
        let fields: Vec<&str> = line.split(':').collect();
        (fields.get(2)?.parse::<u32>().ok()? == uid).then(|| fields[0].to_owned())
    });
    if let Some(mine) = mine {
        let group = std::fs::read_to_string("/etc/group").unwrap_or_default();
        groups.extend(group.lines().filter_map(|line| {
            let fields: Vec<&str> = line.split(':').collect();
            let members = fields.get(3)?;
            members
                .split(',')
                .any(|member| member.trim() == mine)
                .then(|| fields.get(2)?.parse::<u32>().ok())?
        }));
    }
    groups
}

/// No place on Windows is root's: its programs are found as [`command`]
/// finds them, where Banda has no fence yet.
#[cfg(not(unix))]
pub fn only_root_changes(_: &Path) -> bool {
    false
}

/// The PATH the engine finds programs on, and gives the programs it starts
/// that name none: its own; on Windows, which has no login shell, the
/// user's and the system's from the registry after it, read again each
/// time, so a CLI installed while the engine runs is found (ADR 0059,
/// decision 3, on Windows).
pub fn path() -> OsString {
    let own = std::env::var_os("PATH").unwrap_or_default();
    #[cfg(windows)]
    let own = windows::with_registry(own);
    own
}

/// The program `program` names: itself when it is a path, else the first
/// of that name in the folders of `path` that runs ([`runnable`]). On
/// Windows a name without the extension of a program is tried with each
/// of `PATHEXT`'s that the engine can start, as a shell tries them: `npx`
/// is `npx.cmd`.
pub fn find(program: impl AsRef<Path>, path: &OsStr) -> Option<PathBuf> {
    programs(program.as_ref(), path).next()
}

/// Each program `program` may name, as [`find`] looks, in its order.
pub fn programs(named: &Path, path: &OsStr) -> impl Iterator<Item = PathBuf> + use<> {
    let folders: Vec<PathBuf> = if named.components().count() > 1 || named.is_absolute() {
        vec![named.to_owned()]
    } else {
        (std::env::split_paths(path))
            .filter(|folder| !folder.as_os_str().is_empty())
            .map(|folder| folder.join(named))
            .collect()
    };
    folders
        .into_iter()
        .flat_map(names)
        .filter(|candidate| runnable(candidate))
}

/// The files `program` may be: itself; on Windows, with each extension a
/// program there may have, unless it has one.
fn names(program: PathBuf) -> impl Iterator<Item = PathBuf> {
    #[cfg(windows)]
    return windows::names(program).into_iter();
    #[cfg(not(windows))]
    std::iter::once(program)
}

/// Whether `path` is a program that runs: a file with an exec bit.
#[cfg(unix)]
pub fn runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// Whether `path` is a program that runs. Windows has no exec bit: it is
/// a file whose extension says it is a program the engine can start,
/// `.exe` and `.com`, or `.cmd` and `.bat` through `cmd.exe`. Never one of
/// the stubs Banda never runs (ADR 0090, decision 2): one under a
/// `WindowsApps` folder, the Store's aliases, where an old Claude Desktop's
/// `Claude.exe` opens Claude Desktop and `bash.exe` installs WSL; nor
/// `wsl.exe` or `bash.exe` in the system's folder, which install WSL
/// whatever they are asked.
#[cfg(windows)]
pub use windows::runnable;

/// A program that runs JavaScript as Node does: what the engine starts
/// the programs it carries on, and what a module runs code of its own on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    pub program: PathBuf,
    /// Whether it is an Electron, which runs as Node only with
    /// `ELECTRON_RUN_AS_NODE`.
    pub electron: bool,
}

/// Whether `path` is `folder` or is inside it, part by part, as the system
/// compares names ([`same_name`]): without case on Windows, whose disks
/// ignore it, and a drive or a share the same whether Windows' `\\?\`
/// names it or not, as it does a path past 260 characters.
pub fn within(path: &Path, folder: &Path) -> bool {
    let mut parts = path.components();
    folder
        .components()
        .all(|part| parts.next().is_some_and(|had| same_part(had, part)))
}

/// Whether `a` and `b` name the same path, as [`within`] compares them.
pub fn same(a: &Path, b: &Path) -> bool {
    a.components().count() == b.components().count() && within(a, b)
}

fn same_part(a: Component, b: Component) -> bool {
    match (a, b) {
        (Component::Prefix(a), Component::Prefix(b)) => same_prefix(a.kind(), b.kind()),
        (a, b) => same_name(a.as_os_str(), b.as_os_str()),
    }
}

/// Whether two of Windows' prefixes name the same drive or share, `\\?\`
/// or not.
fn same_prefix(a: Prefix, b: Prefix) -> bool {
    let plain = |prefix| match prefix {
        Prefix::VerbatimDisk(drive) => Prefix::Disk(drive),
        Prefix::VerbatimUNC(server, share) => Prefix::UNC(server, share),
        other => other,
    };
    match (plain(a), plain(b)) {
        (Prefix::Disk(a), Prefix::Disk(b)) => a.eq_ignore_ascii_case(&b),
        (Prefix::UNC(server, share), Prefix::UNC(other, its)) => {
            same_name(server, other) && same_name(share, its)
        }
        (a, b) => a == b,
    }
}

/// Whether two names of a file are the same name: on Windows without case,
/// as NTFS compares them, each letter by its one capital ([`capital`]). A
/// name that is not text, as only Windows' unpaired surrogates make, is
/// the same as itself alone.
pub fn same_name(a: &OsStr, b: &OsStr) -> bool {
    let folded = |a: &str, b: &str| a.chars().map(capital).eq(b.chars().map(capital));
    a == b
        || cfg!(windows)
            && a.to_str()
                .zip(b.to_str())
                .is_some_and(|(a, b)| folded(a, b))
}

/// `c` as NTFS compares it without case, near enough: its capital, when it
/// has one alone. NTFS folds one UTF-16 unit to one by its upper-case
/// table, so a sign such as KELVIN SIGN stays apart from `k`, which
/// lower-casing would make it; a letter past the first 65,536 stays as it
/// is; and none outside ASCII becomes one in it, as the dotless `ı` would
/// become `I`, so a name in ASCII is never matched by one that is not.
fn capital(c: char) -> char {
    let mut capitals = c.to_uppercase();
    match (capitals.next(), capitals.next()) {
        (Some(capital), None)
            if u32::from(c) <= 0xFFFF
                && u32::from(capital) <= 0xFFFF
                && capital.is_ascii() == c.is_ascii() =>
        {
            capital
        }
        _ => c,
    }
}

/// The key `env` holds the variable `name` under: on Windows, whose
/// variables' names ignore case, `Path` for `PATH`, so it is changed in
/// its place and not set a second time.
pub fn named<'a, V>(env: &'a BTreeMap<String, V>, name: &str) -> Option<&'a String> {
    env.keys().find(|key| match cfg!(windows) {
        true => key.eq_ignore_ascii_case(name),
        false => key.as_str() == name,
    })
}

/// Why this host refuses `name` for a file or a folder, if it does: on
/// Windows the names it refuses ([`windows_refuses`]); elsewhere none.
pub fn refused_name(name: &str) -> Option<&'static str> {
    windows_refuses(name).filter(|_| cfg!(windows))
}

/// Why Windows refuses `name` for a file or a folder, if it does: one of
/// `<>:"|?*\` in it, or a control character; a name its devices have, as
/// `CON`, `NUL`, `COM1` or `LPT9`, with an extension or not; or an end in
/// a dot or a space, which Windows drops, so `.git.` is `.git`. Unix takes
/// all of them. (Naming Files, Paths, and Namespaces, in Microsoft's docs.)
fn windows_refuses(name: &str) -> Option<&'static str> {
    const DEVICES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
    if name.contains(['<', '>', ':', '"', '|', '?', '*', '\\']) || name.contains(char::is_control) {
        return Some("On Windows a name cannot hold any of < > : \" | ? * \\ .");
    }
    if name.ends_with(['.', ' ']) && name != "." && name != ".." {
        return Some("On Windows a name cannot end in a dot or a space.");
    }
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    let numbered = |prefix: &str| {
        let Some((start, number)) = stem.split_at_checked(3) else {
            return false;
        };
        start.eq_ignore_ascii_case(prefix)
            && (number.len() == 1 && number.as_bytes()[0].is_ascii_digit()
                || ["¹", "²", "³"].contains(&number))
    };
    let device = DEVICES
        .iter()
        .any(|device| stem.eq_ignore_ascii_case(device))
        || numbered("COM")
        || numbered("LPT");
    device.then_some("On Windows a name cannot be one of its devices', as CON, NUL, COM1 or LPT1.")
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

/// Puts `from` in place of `to`, a file or a folder, which it replaces
/// when it is a file: one written whole beside it, put in place in one
/// step ([`tried`]).
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    tried(|| std::fs::rename(from, to))
}

/// Moves the folder `from` to `to`, where nothing may be: what is there is
/// never replaced, and the move fails as `AlreadyExists`. On Windows it is
/// tried for a few seconds, while a program just stopped still works in it.
pub fn move_folder(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use rustix::fs::{CWD, RenameFlags, renameat_with};
        Ok(renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE)?)
    }
    // Windows' rename in a safe call takes the place of a file that is
    // there, so it looks first. A folder never takes another's place.
    #[cfg(not(unix))]
    windows::tried(windows::FOLDER, || match std::fs::symlink_metadata(to) {
        Ok(_) => Err(io::Error::from(io::ErrorKind::AlreadyExists)),
        Err(_) => std::fs::rename(from, to),
    })
}

/// Removes the folder `path` and all in it: on Windows tried for a few
/// seconds, while a program just stopped still holds what is in it.
pub fn remove_all(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    return windows::tried(windows::FOLDER, || std::fs::remove_dir_all(path));
    #[cfg(not(windows))]
    std::fs::remove_dir_all(path)
}

/// Removes the file `path`, which a program just killed may hold a moment
/// longer: on Windows tried for a few seconds, as the last programs in its
/// Job Object end after it.
pub fn remove_left(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    return windows::tried(windows::FOLDER, || std::fs::remove_file(path));
    #[cfg(not(windows))]
    std::fs::remove_file(path)
}

/// `act`, which changes a file in place. On Windows it is done again a few
/// times, a moment apart, while another program holds what it changes:
/// Defender or the search indexer may hold a new file a moment.
pub fn tried<T>(act: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    #[cfg(windows)]
    return windows::tried(windows::FILE, act);
    #[cfg(not(windows))]
    {
        let mut act = act;
        act()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn a_path_is_within_a_folder_part_by_part() {
        let folder = Path::new("/work/banda");
        assert!(within(Path::new("/work/banda/src/main.rs"), folder));
        assert!(within(Path::new("/work/banda/"), folder));
        assert!(!within(Path::new("/work/banda-local/x"), folder));
        assert!(!within(Path::new("/work"), folder));
        assert!(same(Path::new("/work/banda/"), folder));
        assert!(!same(Path::new("/work/banda/src"), folder));
        // Unix's names have case.
        assert_eq!(within(Path::new("/Work/Banda/x"), folder), cfg!(windows));
    }

    #[test]
    fn a_drive_or_a_share_is_the_same_with_windows_long_prefix_or_without() {
        let (srv, share) = (OsStr::new("srv"), OsStr::new("Share"));
        assert!(same_prefix(Prefix::VerbatimDisk(b'C'), Prefix::Disk(b'c')));
        assert!(!same_prefix(Prefix::VerbatimDisk(b'C'), Prefix::Disk(b'D')));
        let plain = Prefix::UNC(srv, share);
        assert!(same_prefix(Prefix::VerbatimUNC(srv, share), plain));
        let other = Prefix::UNC(srv, OsStr::new("other"));
        assert!(!same_prefix(Prefix::VerbatimUNC(srv, share), other));
        assert!(!same_prefix(Prefix::Disk(b'C'), plain));
    }

    #[cfg(windows)]
    #[test]
    fn a_long_path_named_with_its_prefix_is_within_its_folder() {
        let folder = Path::new(r"C:\Users\roma\Banda\app");
        let deep = format!(
            r"\\?\C:\Users\roma\Banda\app\{}x.js",
            r"node_modules\a\".repeat(30)
        );
        assert!(within(Path::new(&deep), folder));
        let share = Path::new(r"\\srv\share\work");
        assert!(within(Path::new(r"\\?\UNC\srv\share\work\x"), share));
        assert!(same(
            Path::new(r"\\?\c:\users\roma"),
            Path::new(r"C:\Users\Roma")
        ));
    }

    #[test]
    fn a_name_is_the_same_without_case_only_on_windows() {
        assert!(same_name(OsStr::new("Banda"), OsStr::new("Banda")));
        let shouted = same_name(OsStr::new("Banda"), OsStr::new("bANDA"));
        assert_eq!(shouted, cfg!(windows));
        assert!(!same_name(OsStr::new("banda"), OsStr::new("banda-dev")));
        let cyrillic = same_name(OsStr::new("Проект"), OsStr::new("проект"));
        assert_eq!(cyrillic, cfg!(windows));
        // As NTFS keeps them apart: lower-cased, each would be the other.
        assert!(!same_name(OsStr::new("wor\u{212A}"), OsStr::new("work")));
        assert!(!same_name(OsStr::new("\u{2126}"), OsStr::new("ω")));
        assert!(!same_name(OsStr::new("\u{131}"), OsStr::new("i")));
    }

    #[cfg(windows)]
    #[test]
    fn names_that_are_not_text_are_not_folded_together() {
        use std::os::windows::ffi::OsStringExt;
        // Two unpaired surrogates, which both read as U+FFFD lossily.
        let a = OsString::from_wide(&[0xD800, u16::from(b'a')]);
        let b = OsString::from_wide(&[0xDC00, u16::from(b'a')]);
        assert!(!same_name(&a, &b));
        assert!(same_name(&a, &a.clone()));
    }

    #[test]
    fn a_variable_is_found_by_its_name_and_on_windows_without_case() {
        let env = BTreeMap::from([("Path".to_owned(), "C:\\bin".to_owned())]);
        let found = named(&env, "PATH").map(String::as_str);
        assert_eq!(found, cfg!(windows).then_some("Path"));
        assert_eq!(named(&env, "Path").map(String::as_str), Some("Path"));
    }

    #[test]
    fn windows_refuses_its_devices_its_marks_and_an_end_in_a_dot_or_a_space() {
        for refused in [
            "a<b",
            "a>b",
            "C:",
            "say\"hi\"",
            "a|b",
            "what?",
            "*.rs",
            "a\\b",
            "tab\there",
            "CON",
            "con.txt",
            "Nul",
            "aux.tar.gz",
            "PRN",
            "COM0",
            "COM1",
            "com9.log",
            "LPT1",
            "lpt3",
            "COM¹",
            "LPT³.txt",
            "name.",
            "name ",
            "folder. ",
            ".git.",
            ".git::$DATA",
        ] {
            assert!(windows_refuses(refused).is_some(), "{refused:?}");
            assert_eq!(refused_name(refused).is_some(), cfg!(windows));
        }
        for taken in [
            "main.rs",
            "CONTRIBUTING.md",
            "console",
            "COM",
            "COM10",
            "LPT12",
            "LPT",
            "nul2",
            ".gitignore",
            "a b",
            "über",
            "..",
            ".",
        ] {
            assert_eq!(windows_refuses(taken), None, "{taken:?}");
            assert_eq!(refused_name(taken), None);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_program_is_found_by_its_exec_bit_on_the_folders_of_a_path() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let (first, second) = (folder.path().join("a"), folder.path().join("b"));
        for (dir, mode) in [(&first, 0o644), (&second, 0o755)] {
            std::fs::create_dir(dir).unwrap();
            let program = dir.join("tool");
            std::fs::write(&program, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        let path = std::env::join_paths([&first, &second]).unwrap();
        assert_eq!(find("tool", &path), Some(second.join("tool")));
        assert_eq!(find(first.join("tool"), &path), None, "no exec bit");
        assert_eq!(find("gone", &path), None);
    }

    #[cfg(unix)]
    #[test]
    fn only_root_changes_a_program_of_root_s_as_it_is_named() {
        use std::os::unix::fs::PermissionsExt;
        assert!(only_root_changes(Path::new("/usr")));
        assert!(!only_root_changes(Path::new("usr")));
        assert!(!only_root_changes(Path::new("/tmp")), "anyone writes it");
        let folder = tempfile::tempdir().unwrap();
        let mine = folder.path().join("gh");
        std::fs::write(&mine, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&mine, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!only_root_changes(&mine));
        // A link of this user's to a program of root's, as a version
        // manager's shim: this user moves it, and it starts as another.
        let sh = ["/usr/bin/sh", "/bin/sh"]
            .map(Path::new)
            .into_iter()
            .find(|sh| only_root_changes(sh));
        let shim = folder.path().join("shim");
        std::os::unix::fs::symlink(sh.unwrap(), &shim).unwrap();
        assert!(!only_root_changes(&shim));
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_its_group_writes_is_root_s_alone_when_this_user_is_not_in_it() {
        let groups = BTreeSet::from([1000, 10]);
        // NixOS's store: `root:nixbld`, 1775.
        assert!(!written_by_others(0o41775, 30000, &groups));
        assert!(
            written_by_others(0o41775, 10, &groups),
            "a group of this user's"
        );
        assert!(written_by_others(0o40777, 30000, &groups), "anyone's");
        assert!(!written_by_others(0o40755, 10, &groups));
        assert!(own_groups().contains(&rustix::process::getegid().as_raw()));
    }

    #[cfg(unix)]
    #[test]
    fn a_guarded_program_is_one_only_root_changes_with_none_else_on_its_path() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let home = folder.path().join("bin");
        std::fs::create_dir(&home).unwrap();
        let sh = ["/usr/bin", "/bin"].map(PathBuf::from).into_iter();
        let system = sh
            .clone()
            .find(|bin| only_root_changes(&bin.join("sh")))
            .unwrap();
        // One of the same name first on the PATH, in a folder of the user's.
        let mine = home.join("sh");
        std::fs::write(&mine, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&mine, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::join_paths([&home, &system]).unwrap();
        assert_eq!(owned(Path::new("sh"), &path, false), Owned::Unguarded);
        let found = owned(Path::new("sh"), &path, true);
        assert_eq!(found, Owned::Root(system.join("sh"), system.clone().into()));
        // With none of root's, none starts: not the first there is.
        let lone = home.join("banda-own-test");
        std::fs::write(&lone, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&lone, std::fs::Permissions::from_mode(0o755)).unwrap();
        let found = owned(Path::new("banda-own-test"), &path, true);
        assert_eq!(found, Owned::NotRoots(lone.clone()));
        let none = owned(Path::new("banda-none-such"), &path, true);
        assert_eq!(none, Owned::Missing);
        let missing = own("banda-none-such").unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
        // Named by its path, as a test names its own `gh`, it is the same.
        assert_eq!(owned(&lone, &path, true), Owned::NotRoots(lone));
        // The system's own program is root's, whether guarded or not.
        assert_eq!(system_on("sh", &path), Some(system.join("sh")));
        assert_eq!(system_on("banda-own-test", &path), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_program_of_the_engine_s_own_is_found_on_path_or_does_not_start() {
        let said = command("sh")
            .unwrap()
            .args(["-c", "echo here"])
            .output()
            .await;
        assert_eq!(String::from_utf8_lossy(&said.unwrap().stdout), "here\n");
        let missing = command("banda-no-such-program").unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
    }
}
