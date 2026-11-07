//! The launcher's steps, in the order it takes them, single-threaded: the
//! namespaces, the mounts, Landlock's scopes, then a PID namespace whose
//! first process starts the program and stays its init.

use super::plan::{self, May};
use super::sys::{self, Forked, Signals};
use crate::{Layer, Spec, Why};
use rustix::fd::OwnedFd;
use rustix::fs::{Access, AtFlags, CWD, FileType, Mode, OFlags, StatVfsMountFlags, StatxFlags};
use rustix::mount::{
    FsMountFlags, FsOpenFlags, MountAttrFlags, MountFlags, MountPropagationFlags, MoveMountFlags,
    OpenTreeFlags,
};
use rustix::process::{Pid, Signal, WaitOptions};
use rustix::thread::UnshareFlags;
use std::ffi::{CString, OsStr, OsString};
use std::fmt::Display;
use std::fs::{DirBuilder, OpenOptions};
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// How the launcher exits when the fence was not set up: it ran nothing.
pub(crate) const UNSET: i32 = crate::UNSET as i32;
/// How it exits when the program inside could not start: not found, or
/// found and refused.
const NOT_FOUND: i32 = 127;
const NOT_RUN: i32 = 126;

/// The signals the launcher and the init pass on to what they started;
/// SIGKILL needs none, since each dies with the one above it.
const PASSED_ON: [i32; 6] = [
    libc::SIGTERM,
    libc::SIGINT,
    libc::SIGHUP,
    libc::SIGQUIT,
    libc::SIGUSR1,
    libc::SIGUSR2,
];

/// The host's devices a program finds in the fence's `/dev`: those that
/// give or take bytes, and the terminal it would have.
const DEVICES: [&str; 6] = ["null", "zero", "full", "random", "urandom", "tty"];

/// What every mount the fence makes or takes in carries: no set-user-ID
/// program runs from it, and no device opens through it.
const LIMITED: MountAttrFlags =
    MountAttrFlags::MOUNT_ATTR_NOSUID.union(MountAttrFlags::MOUNT_ATTR_NODEV);

/// Why the fence did not hold: of what kind, and what failed in words.
#[derive(Debug)]
pub(crate) struct Failed {
    pub why: Why,
    pub words: String,
}

impl Failed {
    pub(crate) fn setup(words: impl Into<String>) -> Failed {
        Failed {
            why: Why::SetupFailed,
            words: words.into(),
        }
    }

    fn step(step: impl Display, error: impl Display) -> Failed {
        Failed::setup(format!("{step}: {error}"))
    }

    fn namespaces(error: io::Error) -> Failed {
        Failed {
            why: Why::NoUserNamespaces,
            words: format!("this system gives this user no namespaces of its own: {error}"),
        }
    }

    fn refused(words: impl Into<String>) -> Failed {
        Failed {
            why: Why::Refused,
            words: words.into(),
        }
    }

    /// A step of the mounts that failed: refused by the system when it is
    /// not allowed here (a container that masks `/proc`, a security
    /// module) or not there (a kernel before 5.12).
    fn mount(step: impl Display, error: impl Into<io::Error>) -> Failed {
        let error = error.into();
        match error.raw_os_error() {
            Some(libc::EPERM | libc::ENOSYS) => Failed::refused(format!(
                "this system refuses a step of the fence, {step}: {error}"
            )),
            _ => Failed::step(step, error),
        }
    }
}

/// The program to run, made ready before any fork, so the process that
/// runs it only changes folder and execs.
pub(crate) struct Exec {
    /// What it is called, for what is said of it.
    name: String,
    /// Where it may be, in order: its own path when it names one, else
    /// its name in each folder on `PATH`, looked for inside the fence.
    candidates: Vec<CString>,
    argv: Vec<CString>,
    envp: Vec<CString>,
    /// The folder it starts in, and whether that one was asked for.
    cwd: CString,
    asked: bool,
}

impl Exec {
    /// `program` and its arguments, with this process's environment, in
    /// `cwd`, else in the folder this process started in.
    pub(crate) fn new(program: &[OsString], cwd: Option<&Path>) -> Result<Exec, Failed> {
        let Some(name) = program.first() else {
            return Err(Failed::setup("there is no program to run"));
        };
        let argv = program.iter().map(|arg| c(arg)).collect::<Result<_, _>>()?;
        let envp = (std::env::vars_os())
            .filter_map(|(key, value)| {
                let mut pair = key.into_encoded_bytes();
                pair.push(b'=');
                pair.extend(value.into_encoded_bytes());
                CString::new(pair).ok()
            })
            .collect();
        let candidates = if name.as_bytes().contains(&b'/') {
            vec![c(name)?]
        } else {
            let path =
                std::env::var_os("PATH").unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".into());
            (std::env::split_paths(&path))
                .filter(|folder| folder.is_absolute())
                .map(|folder| c(folder.join(name).as_os_str()))
                .collect::<Result<_, _>>()?
        };
        let (cwd, asked) = match cwd {
            Some(cwd) => (cwd.to_path_buf(), true),
            None => (
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
                false,
            ),
        };
        Ok(Exec {
            name: name.to_string_lossy().into_owned(),
            candidates,
            argv,
            envp,
            cwd: c(cwd.as_os_str())?,
            asked,
        })
    }
}

/// `text` as C takes it.
fn c(text: &OsStr) -> Result<CString, Failed> {
    CString::new(text.as_bytes())
        .map_err(|_| Failed::setup(format!("{} holds a NUL", text.to_string_lossy())))
}

/// Each place the launcher mounts on or from, by fd, so a mount lands on
/// the folder it checked.
struct Opened {
    hidden: Vec<(PathBuf, OwnedFd)>,
    read_only: Vec<OwnedFd>,
    /// Each hole, with how it opens and whether it is a folder.
    holes: Vec<(PathBuf, May, bool, OwnedFd)>,
}

/// Each place covered, with the mount it was on before.
type Covered = Vec<(PathBuf, u64)>;

/// The fence as [`setup`] left it: the layers that hold, and what the
/// probe checks of it from inside.
pub(crate) struct Fenced {
    pub layers: Vec<Layer>,
    covered: Covered,
    /// Each place kept read-only.
    read_only: Vec<PathBuf>,
}

/// Sets the fence up around this process: everything but the PID
/// namespace, which [`start`] makes.
pub(crate) fn setup(spec: &Spec) -> Result<Fenced, Failed> {
    sys::one_thread().map_err(|error| Failed::step("starting the launcher", error))?;
    let (uid, gid) = (rustix::process::getuid(), rustix::process::getgid());
    if uid.is_root() || rustix::process::geteuid().is_root() {
        return Err(Failed::refused(
            "Banda runs as root here, and the fence holds only around a user: start Banda as one",
        ));
    }
    let starter = rustix::process::getppid();
    rustix::process::set_parent_process_death_signal(Some(Signal::KILL))
        .map_err(|error| Failed::step("tying the launcher to its starter", error))?;
    if rustix::process::getppid() != starter {
        return Err(Failed::setup("the launcher's starter is gone"));
    }
    sys::no_terminal().map_err(|error| Failed::step("letting go of the terminal", error))?;
    rustix::thread::clear_ambient_capability_set()
        .map_err(|error| Failed::step("dropping inherited capabilities", error))?;
    let plan = plan::plan(spec).map_err(Failed::setup)?;
    // As the host has it: what is there to cover, and the folders above.
    let (_, roots) = open_all(&plan)?;
    let pins = plan::pins(roots, renamable);

    let (uid, gid) = (uid.as_raw(), gid.as_raw());
    let namespaces = UnshareFlags::NEWUSER | UnshareFlags::NEWNS | UnshareFlags::NEWIPC;
    sys::unshare(namespaces).map_err(Failed::namespaces)?;
    map(uid, gid).map_err(Failed::namespaces)?;
    // What is mounted here stays here, and what the host mounts later, as
    // a USB stick, still shows.
    let downstream = MountPropagationFlags::DOWNSTREAM | MountPropagationFlags::REC;
    rustix::mount::mount_change("/", downstream)
        .map_err(|error| Failed::mount("making the mounts its own", error))?;
    let (mut covered, mut read_only) = system(uid, gid)?;
    pin(&pins)?;
    // Opened again under the pins, in this namespace, whose mounts alone
    // take a mount.
    let (opened, _) = open_all(&plan)?;
    covered.extend(mount(uid, gid, opened)?);
    rustix::thread::set_no_new_privs(true)
        .map_err(|error| Failed::step("setting no_new_privs", error))?;
    let mut layers = vec![Layer::Namespaces];
    if scoped() {
        layers.push(Layer::Landlock);
    }
    read_only.extend(plan.read_only);
    Ok(Fenced {
        layers,
        covered,
        read_only,
    })
}

/// Opens each place `plan` mounts on or from, checked as [`open`] checks
/// it, and says which are the roots of what the fence covers or keeps.
fn open_all(plan: &plan::Plan) -> Result<(Opened, Vec<&Path>), Failed> {
    let mut opened = Opened {
        hidden: Vec::new(),
        read_only: Vec::new(),
        holes: Vec::new(),
    };
    let mut roots: Vec<&Path> = Vec::new();
    for path in &plan.hidden {
        let found = open(path, Links::Refused)?.ok_or_else(|| {
            Failed::setup(format!(
                "{} is not there for the fence to cover",
                path.display()
            ))
        })?;
        opened.hidden.push((path.clone(), found));
        roots.push(path);
    }
    for path in &plan.hidden_if_there {
        if let Some(found) = open(path, Links::RootsOnly)? {
            opened.hidden.push((path.clone(), found));
            roots.push(path);
        }
    }
    for path in &plan.read_only {
        opened
            .read_only
            .push(open(path, Links::Refused)?.ok_or_else(|| {
                Failed::setup(format!("{} is not there to keep read-only", path.display()))
            })?);
        roots.push(path);
    }
    for (path, may) in &plan.holes {
        let found = open(path, Links::Refused)?.ok_or_else(|| {
            Failed::setup(format!("{} is not there to open a hole to", path.display()))
        })?;
        let folder = kind(&found)? == FileType::Directory;
        opened.holes.push((path.clone(), *may, folder, found));
    }
    Ok((opened, roots))
}

/// What [`open`] does with a place that is a link.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Links {
    /// Refuses it: the fence covers a place where it is, never through a
    /// link.
    Refused,
    /// For what the fence hides only when it is there: follows it when
    /// root made it, as the system's sockets' links, and passes over one
    /// the user made, which leads to nothing to hide. A place this user
    /// cannot reach it passes over only as [`out_of_reach`] says.
    RootsOnly,
}

/// `path` opened as a place, its last part not followed when it is a
/// link (see [`Links`]): `None` when it is not there, or passed over.
fn open(path: &Path, links: Links) -> Result<Option<OwnedFd>, Failed> {
    let flags = OFlags::PATH | OFlags::CLOEXEC;
    let Some(found) = place(path, flags | OFlags::NOFOLLOW, links, path)? else {
        return Ok(None);
    };
    let link = rustix::fs::fstat(&found)
        .map_err(|error| Failed::step(format!("reading {}", path.display()), error))?;
    if FileType::from_raw_mode(link.st_mode) != FileType::Symlink {
        return Ok(Some(found));
    }
    if links == Links::Refused {
        return Err(Failed::setup(format!(
            "{} is a link: the fence covers a place where it is, never through a link",
            path.display()
        )));
    }
    if link.st_uid != 0 {
        return Ok(None);
    }
    place(path, flags, links, &target(path)?)
}

/// `path` opened with `flags`: `None` when it is not there, or when this
/// user cannot reach `reached`, where it leads, and [`out_of_reach`] passes
/// that over.
fn place(
    path: &Path,
    flags: OFlags,
    links: Links,
    reached: &Path,
) -> Result<Option<OwnedFd>, Failed> {
    use rustix::io::Errno;
    match rustix::fs::open(path, flags, Mode::empty()) {
        Ok(found) => Ok(Some(found)),
        Err(Errno::NOENT) => Ok(None),
        Err(Errno::ACCESS) if links == Links::RootsOnly => out_of_reach(reached).map(|()| None),
        Err(error) => Err(Failed::step(format!("opening {}", path.display()), error)),
    }
}

/// Where the link `path` leads, as it names it.
fn target(path: &Path) -> Result<PathBuf, Failed> {
    let named = rustix::fs::readlink(path, Vec::new())
        .map_err(|error| Failed::step(format!("reading the link {}", path.display()), error))?;
    let named = Path::new(OsStr::from_bytes(named.as_bytes()));
    Ok(path.parent().unwrap_or(Path::new("/")).join(named))
}

/// Whether a place to hide that this user cannot reach is passed over: it
/// is when the first folder on its way that this user cannot enter is not
/// the user's own, as a service's, whose mode the program cannot change
/// either. One in a folder of the user's own is refused: the program could
/// open that folder again.
fn out_of_reach(path: &Path) -> Result<(), Failed> {
    let me = rustix::process::getuid().as_raw();
    let mut above: Vec<&Path> = path.ancestors().skip(1).collect();
    above.reverse();
    let Some(closed) =
        (above.into_iter()).find(|folder| rustix::fs::access(*folder, Access::EXEC_OK).is_err())
    else {
        return Err(Failed::setup(format!(
            "{} could not be reached, though every folder on its way opens",
            path.display()
        )));
    };
    let owner = rustix::fs::stat(closed)
        .map_err(|error| Failed::step(format!("reading {}", closed.display()), error))?
        .st_uid;
    if owner != me {
        return Ok(());
    }
    Err(Failed::setup(format!(
        "{} is in {}, which this user owns and cannot enter: the fence cannot cover it",
        path.display(),
        closed.display()
    )))
}

/// What kind of file `place` is.
fn kind(place: &OwnedFd) -> Result<FileType, Failed> {
    let stat = rustix::fs::fstat(place).map_err(|error| Failed::step("reading a place", error))?;
    Ok(FileType::from_raw_mode(stat.st_mode))
}

/// The mount `place` is on.
fn mount_of(place: &OwnedFd) -> rustix::io::Result<u64> {
    let found = rustix::fs::statx(place, "", AtFlags::EMPTY_PATH, StatxFlags::MNT_ID)?;
    Ok(found.stx_mnt_id)
}

/// The mount `path` is on, as it is found now.
fn mount_at(path: &Path) -> rustix::io::Result<u64> {
    let found = rustix::fs::statx(CWD, path, AtFlags::empty(), StatxFlags::MNT_ID)?;
    Ok(found.stx_mnt_id)
}

/// Whether this user may rename `folder`: it owns the folder it is in,
/// which it may make writable, or may write that folder, which is not
/// sticky or the folder is its own.
fn renamable(folder: &Path) -> bool {
    let Some(parent) = folder.parent() else {
        return false;
    };
    let (Ok(above), Ok(itself)) = (rustix::fs::stat(parent), rustix::fs::lstat(folder)) else {
        // Unsure: pinned, which costs only a mount.
        return true;
    };
    let me = rustix::process::getuid().as_raw();
    if above.st_uid == me {
        return true;
    }
    let writable = rustix::fs::access(parent, Access::WRITE_OK | Access::EXEC_OK).is_ok();
    let sticky = above.st_mode & 0o1000 != 0;
    writable && (!sticky || itself.st_uid == me)
}

/// Maps this user to itself in the new user namespace, never to root.
/// `deny` in `setgroups` comes first, as the kernel asks of a process
/// that maps its own group: no one in the namespace may change its groups
/// then, and the process keeps those it has.
fn map(uid: u32, gid: u32) -> io::Result<()> {
    match write("/proc/self/setgroups", "deny") {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    write("/proc/self/uid_map", &format!("{uid} {uid} 1"))?;
    write("/proc/self/gid_map", &format!("{gid} {gid} 1"))
}

fn write(path: &str, text: &str) -> io::Result<()> {
    OpenOptions::new()
        .write(true)
        .open(path)?
        .write_all(text.as_bytes())
}

/// The system's own folders as a program finds them inside: `/sys`
/// read-only, and a `/dev` of the fence's own, with only the devices a
/// program needs, its own terminals and its own shared memory. Says what
/// it covered, each with the mount it was on, and what it keeps read-only.
fn system(uid: u32, gid: u32) -> Result<(Covered, Vec<PathBuf>), Failed> {
    let mut read_only = Vec::new();
    if let Some(sys) = open(Path::new("/sys"), Links::Refused)? {
        let tree = clone(&sys).map_err(|error| Failed::mount("taking /sys", error))?;
        let set = LIMITED | MountAttrFlags::MOUNT_ATTR_RDONLY | MountAttrFlags::MOUNT_ATTR_NOEXEC;
        sys::mount_set(&tree, set)
            .map_err(|error| Failed::mount("making /sys read-only", error))?;
        put(&tree, &sys).map_err(|error| Failed::mount("keeping /sys read-only", error))?;
        read_only.push(PathBuf::from("/sys"));
    }

    let dev = Path::new("/dev");
    let place = open(dev, Links::Refused)?.ok_or_else(|| Failed::setup("there is no /dev"))?;
    let before = mount_of(&place).map_err(|error| Failed::step("reading /dev", error))?;
    let mut covered = vec![(dev.to_path_buf(), before)];
    let terminals = dev.join("pts");
    if let Ok(before) = mount_at(&terminals) {
        covered.push((terminals.clone(), before));
    }
    let mut devices = Vec::new();
    for name in DEVICES {
        let path = dev.join(name);
        let flags = OpenTreeFlags::OPEN_TREE_CLONE | OpenTreeFlags::OPEN_TREE_CLOEXEC;
        match rustix::mount::open_tree(CWD, &path, flags) {
            Ok(tree) => devices.push((path, tree)),
            Err(rustix::io::Errno::NOENT) => {}
            Err(error) => {
                return Err(Failed::mount(format!("taking {}", path.display()), error));
            }
        }
    }
    let attrs = LIMITED | MountAttrFlags::MOUNT_ATTR_NOEXEC;
    let fresh =
        tmpfs("0755", uid, gid, attrs).map_err(|error| Failed::mount("making /dev", error))?;
    put(&fresh, &place).map_err(|error| Failed::mount("putting /dev in place", error))?;
    for (path, tree) in devices {
        made(&path, false)
            .map_err(|error| Failed::step(format!("making {}", path.display()), error))?;
        put_at(&tree, &path)
            .map_err(|error| Failed::mount(format!("putting {} in", path.display()), error))?;
    }
    let shared = dev.join("shm");
    for folder in [&terminals, &shared] {
        made(folder, true)
            .map_err(|error| Failed::step(format!("making {}", folder.display()), error))?;
    }
    let own =
        own_terminals().map_err(|error| Failed::mount("making terminals of its own", error))?;
    put_at(&own, &terminals)
        .map_err(|error| Failed::mount("putting its terminals in /dev/pts", error))?;
    let memory = tmpfs("1777", uid, gid, LIMITED)
        .map_err(|error| Failed::mount("making its shared memory", error))?;
    put_at(&memory, &shared)
        .map_err(|error| Failed::mount("putting its shared memory in /dev/shm", error))?;
    let links = [
        ("ptmx", "pts/ptmx"),
        ("fd", "/proc/self/fd"),
        ("stdin", "/proc/self/fd/0"),
        ("stdout", "/proc/self/fd/1"),
        ("stderr", "/proc/self/fd/2"),
    ];
    for (name, target) in links {
        std::os::unix::fs::symlink(target, dev.join(name))
            .map_err(|error| Failed::step(format!("linking /dev/{name}"), error))?;
    }
    Ok((covered, read_only))
}

/// Pins each folder of `pins`, outermost first, as a mount of itself, so
/// each holds what is mounted under it later once.
fn pin(pins: &[PathBuf]) -> Result<(), Failed> {
    for pin in pins {
        let flags = OpenTreeFlags::OPEN_TREE_CLONE
            | OpenTreeFlags::OPEN_TREE_CLOEXEC
            | OpenTreeFlags::AT_RECURSIVE
            | OpenTreeFlags::AT_SYMLINK_NOFOLLOW;
        let tree = rustix::mount::open_tree(CWD, pin, flags)
            .map_err(|error| Failed::mount(format!("taking {}", pin.display()), error))?;
        put_at(&tree, pin)
            .map_err(|error| Failed::mount(format!("pinning {}", pin.display()), error))?;
    }
    Ok(())
}

/// The mounts of the spec: the holes taken from the host first, then the
/// covers, the holes put back inside them, and the read-only folders. Says
/// what it covered, each with the mount it was on.
fn mount(uid: u32, gid: u32, opened: Opened) -> Result<Covered, Failed> {
    let mut holes = Vec::new();
    for (path, may, folder, place) in opened.holes {
        let tree = clone(&place)
            .map_err(|error| Failed::mount(format!("taking {}", path.display()), error))?;
        let set = match may {
            May::Write => LIMITED,
            May::Read => {
                LIMITED | MountAttrFlags::MOUNT_ATTR_RDONLY | MountAttrFlags::MOUNT_ATTR_NOEXEC
            }
            May::Run => LIMITED | MountAttrFlags::MOUNT_ATTR_RDONLY,
        };
        sys::mount_set(&tree, set)
            .map_err(|error| Failed::mount(format!("limiting {}", path.display()), error))?;
        holes.push((path, folder, tree));
    }

    let mut covered = Vec::new();
    for (path, place) in &opened.hidden {
        let before = mount_of(place)
            .map_err(|error| Failed::step(format!("reading {}", path.display()), error))?;
        let cover = match kind(place)? {
            FileType::Directory => tmpfs("0700", uid, gid, LIMITED),
            _ => nothing(),
        }
        .map_err(|error| Failed::mount("making a cover", error))?;
        put(&cover, place)
            .map_err(|error| Failed::mount(format!("covering {}", path.display()), error))?;
        covered.push((path.clone(), before));
    }

    for (path, folder, tree) in holes {
        made(&path, folder)
            .map_err(|error| Failed::step(format!("making {}", path.display()), error))?;
        put_at(&tree, &path).map_err(|error| {
            Failed::mount(format!("opening the hole {}", path.display()), error)
        })?;
    }

    for place in &opened.read_only {
        let tree =
            clone(place).map_err(|error| Failed::mount("taking a read-only folder", error))?;
        sys::mount_set(&tree, LIMITED | MountAttrFlags::MOUNT_ATTR_RDONLY)
            .map_err(|error| Failed::mount("making a folder read-only", error))?;
        put(&tree, place).map_err(|error| Failed::mount("keeping a folder read-only", error))?;
    }
    Ok(covered)
}

/// A copy of the mounts at `place`, and of all under it, not yet anywhere.
fn clone(place: &OwnedFd) -> rustix::io::Result<OwnedFd> {
    let flags = OpenTreeFlags::OPEN_TREE_CLONE
        | OpenTreeFlags::OPEN_TREE_CLOEXEC
        | OpenTreeFlags::AT_EMPTY_PATH
        | OpenTreeFlags::AT_RECURSIVE;
    rustix::mount::open_tree(place, "", flags)
}

/// Puts the mount `tree` over `place`.
fn put(tree: &OwnedFd, place: &OwnedFd) -> rustix::io::Result<()> {
    let flags = MoveMountFlags::MOVE_MOUNT_F_EMPTY_PATH | MoveMountFlags::MOVE_MOUNT_T_EMPTY_PATH;
    rustix::mount::move_mount(tree, "", place, "", flags)
}

/// Puts the mount `tree` at `path`, as it is found now.
fn put_at(tree: &OwnedFd, path: &Path) -> rustix::io::Result<()> {
    let flags = MoveMountFlags::MOVE_MOUNT_F_EMPTY_PATH;
    rustix::mount::move_mount(tree, "", CWD, path, flags)
}

/// An empty folder of the fence's own, this user's, of `mode`, its mount
/// limited by `attrs`; a mount made in the fence's user namespace takes no
/// device of its own anyway.
fn tmpfs(mode: &str, uid: u32, gid: u32, attrs: MountAttrFlags) -> io::Result<OwnedFd> {
    let context = rustix::mount::fsopen("tmpfs", FsOpenFlags::FSOPEN_CLOEXEC)?;
    rustix::mount::fsconfig_set_string(&context, "mode", mode)?;
    rustix::mount::fsconfig_set_string(&context, "uid", uid.to_string())?;
    rustix::mount::fsconfig_set_string(&context, "gid", gid.to_string())?;
    rustix::mount::fsconfig_create(&context)?;
    Ok(rustix::mount::fsmount(
        &context,
        FsMountFlags::FSMOUNT_CLOEXEC,
        attrs,
    )?)
}

/// Terminals of the fence's own, none of the host's among them: a new
/// instance of `devpts`, whose `ptmx` anyone inside may open.
fn own_terminals() -> io::Result<OwnedFd> {
    let context = rustix::mount::fsopen("devpts", FsOpenFlags::FSOPEN_CLOEXEC)?;
    rustix::mount::fsconfig_set_flag(&context, "newinstance")?;
    rustix::mount::fsconfig_set_string(&context, "ptmxmode", "0666")?;
    rustix::mount::fsconfig_set_string(&context, "mode", "0620")?;
    rustix::mount::fsconfig_create(&context)?;
    let attrs = MountAttrFlags::MOUNT_ATTR_NOSUID | MountAttrFlags::MOUNT_ATTR_NOEXEC;
    Ok(rustix::mount::fsmount(
        &context,
        FsMountFlags::FSMOUNT_CLOEXEC,
        attrs,
    )?)
}

/// `/dev/null`, read-only, to cover a file or a socket with.
fn nothing() -> io::Result<OwnedFd> {
    let flags = OpenTreeFlags::OPEN_TREE_CLONE | OpenTreeFlags::OPEN_TREE_CLOEXEC;
    let tree = rustix::mount::open_tree(CWD, "/dev/null", flags)?;
    let set = MountAttrFlags::MOUNT_ATTR_RDONLY
        | MountAttrFlags::MOUNT_ATTR_NOSUID
        | MountAttrFlags::MOUNT_ATTR_NOEXEC;
    sys::mount_set(&tree, set)?;
    Ok(tree)
}

/// Makes the place a mount is put at, inside a folder of the fence's own:
/// a folder, or an empty file for a file's, a device's or a socket's. A
/// place there already is left as it is.
fn made(path: &Path, folder: bool) -> io::Result<()> {
    let mut folders = DirBuilder::new();
    folders.recursive(true).mode(0o700);
    if folder {
        folders.create(path)?;
        // The mount put here brings its own mode; until then, the folder
        // is its owner's alone.
        return std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }
    if let Some(parent) = path.parent() {
        folders.create(parent)?;
    }
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path);
    match file {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        file => file.map(drop),
    }
}

/// Adds Landlock's scopes, where the kernel has them (ABI 6): nothing
/// inside reaches an abstract socket or signals a process made outside.
/// Scopes only: a rule on files would stop the mounts the Harnesses' own
/// sandboxes make inside. Whether both hold.
fn scoped() -> bool {
    use landlock::{Ruleset, RulesetAttr, RulesetStatus, Scope};
    let restricted = Ruleset::default()
        .scope(Scope::AbstractUnixSocket | Scope::Signal)
        .and_then(|ruleset| ruleset.create())
        .and_then(|ruleset| ruleset.restrict_self());
    matches!(restricted, Ok(status) if status.ruleset == RulesetStatus::FullyEnforced)
}

/// Starts `exec` in a PID namespace of its own, under an init that passes
/// signals on and reaps. This process stays outside, as the one its
/// starter holds, until the program ends; then it exits as the program
/// did, a signal `n` as `128 + n`. It returns only when it could not.
/// `report` hears a failure inside, instead of stderr.
pub(crate) fn start(exec: Exec, report: Option<&OwnedFd>) -> Failed {
    let mut handled = PASSED_ON.to_vec();
    handled.push(libc::SIGCHLD);
    let signals = Signals::of(&handled);
    if let Err(error) = signals.block() {
        return Failed::step("holding signals back", error);
    }
    if let Err(error) = sys::unshare(UnshareFlags::NEWPID) {
        return Failed::step("making the PID namespace", error);
    }
    let launcher = match rustix::process::pidfd_open(
        rustix::process::getpid(),
        rustix::process::PidfdFlags::empty(),
    ) {
        Ok(launcher) => launcher,
        Err(error) => return Failed::step("opening the launcher's pidfd", error),
    };
    match sys::fork() {
        Err(error) => Failed::step("starting the init", error),
        Ok(Forked::Child) => init(exec, launcher, report, &signals),
        Ok(Forked::Parent(init)) => {
            drop(launcher);
            quiet();
            supervise(init, &signals, false)
        }
    }
}

/// The PID namespace's first process: it mounts the namespace's own
/// `/proc`, starts the program, and reaps until the program ends, when it
/// exits as the program did and the namespace goes with it.
fn init(exec: Exec, launcher: OwnedFd, report: Option<&OwnedFd>, signals: &Signals) -> ! {
    let tied = rustix::process::set_parent_process_death_signal(Some(Signal::KILL));
    if tied.is_err() || gone(&launcher) {
        std::process::exit(UNSET);
    }
    drop(launcher);
    let proc = rustix::mount::mount(
        "proc",
        "/proc",
        "proc",
        MountFlags::NOSUID | MountFlags::NODEV | MountFlags::NOEXEC,
        None,
    );
    if let Err(error) = proc {
        tell(
            report,
            &Failed::mount("mounting the namespace's /proc", error),
        );
        std::process::exit(UNSET);
    }
    match sys::fork() {
        Err(error) => {
            tell(report, &Failed::step("starting the program", error));
            std::process::exit(UNSET)
        }
        Ok(Forked::Child) => run(exec, report),
        Ok(Forked::Parent(program)) => {
            quiet();
            supervise(program, signals, true)
        }
    }
}

/// Whether the process `pidfd` names has ended.
fn gone(pidfd: &OwnedFd) -> bool {
    let mut polled = [rustix::event::PollFd::new(
        pidfd,
        rustix::event::PollFlags::IN,
    )];
    let now = rustix::event::Timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    match rustix::event::poll(&mut polled, Some(&now)) {
        Ok(_) => !polled[0].revents().is_empty(),
        Err(_) => true,
    }
}

/// The program, in its folder, with every fd but its three streams
/// closed as it starts.
fn run(exec: Exec, report: Option<&OwnedFd>) -> ! {
    if rustix::process::set_parent_process_death_signal(Some(Signal::KILL)).is_err() {
        std::process::exit(UNSET);
    }
    let ready = sys::signals_as_at_start()
        .map_err(|error| Failed::step("setting signals as a program starts with them", error))
        .and_then(|()| enter(&exec))
        .and_then(|()| {
            sys::close_on_exec_from(3)
                .map_err(|error| Failed::step("closing what the program is not given", error))
        });
    if let Err(failed) = ready {
        tell(report, &failed);
        std::process::exit(UNSET);
    }
    let mut last: Option<io::Error> = None;
    for candidate in &exec.candidates {
        let error = sys::exec(candidate, &exec.argv, &exec.envp);
        match error.raw_os_error() {
            Some(libc::ENOENT | libc::ENOTDIR) => {}
            Some(libc::EACCES) => last = Some(error),
            _ => {
                last = Some(error);
                break;
            }
        }
    }
    let (code, error) = match last {
        Some(error) => (NOT_RUN, error),
        None => (NOT_FOUND, io::Error::from(io::ErrorKind::NotFound)),
    };
    let failed = Failed::step(format!("{} could not start", exec.name), error);
    tell(report, &failed);
    std::process::exit(code)
}

/// Goes into the program's folder by its path, so a folder the launcher
/// started in under what the fence covers is not kept open: the one asked
/// for, else the launcher's own, else the root.
fn enter(exec: &Exec) -> Result<(), Failed> {
    match rustix::process::chdir(exec.cwd.as_c_str()) {
        Ok(()) => Ok(()),
        Err(error) if exec.asked => Err(Failed::step(
            format!("going into {}", exec.cwd.to_string_lossy()),
            error,
        )),
        Err(_) => rustix::process::chdir("/").map_err(|error| Failed::step("going into /", error)),
    }
}

/// Says `failed` where it is heard: on `report`, else on stderr. Never on
/// stdout, which is the program's.
pub(crate) fn tell(report: Option<&OwnedFd>, failed: &Failed) {
    match report {
        Some(report) => super::probe::said(report, failed),
        None => eprintln!("banda fence: {}", failed.words),
    }
}

/// Points this process's stdin and stdout at `/dev/null`, so what reads
/// or writes the program's streams sees them end with it.
pub(crate) fn quiet() {
    if let Ok(null) = rustix::fs::open("/dev/null", OFlags::RDWR | OFlags::CLOEXEC, Mode::empty()) {
        let _ = rustix::stdio::dup2_stdin(&null);
        let _ = rustix::stdio::dup2_stdout(&null);
    }
}

/// Waits on `child`, passing signals of [`PASSED_ON`] on, and exits as it
/// does. The init (`init`) reaps every process that ends under it too.
///
/// The program shares the launcher's process group, so a signal to the
/// whole group reaches it once already. The launcher passes on what was
/// sent to it, marked, but not what the kernel sent the group (a
/// terminal's); the init passes on only what the launcher marked, never
/// its own copy of the group's.
fn supervise(child: Pid, signals: &Signals, init: bool) -> ! {
    let waited = if init { None } else { Some(child) };
    loop {
        let Ok(caught) = signals.wait() else {
            std::process::exit(UNSET)
        };
        if caught.number != libc::SIGCHLD {
            if init && caught.passed {
                if let Some(signal) = Signal::from_named_raw(caught.number) {
                    let _ = rustix::process::kill_process(child, signal);
                }
            } else if !init && !caught.from_kernel {
                let _ = sys::pass_on(child, caught.number);
            }
            continue;
        }
        while let Ok(Some((ended, status))) = rustix::process::waitpid(waited, WaitOptions::NOHANG)
        {
            if ended == child {
                std::process::exit(code(status));
            }
        }
    }
}

/// How a process that ended so says it, as a shell does: its code, or
/// `128 + n` for the signal `n` that ended it.
fn code(status: rustix::process::WaitStatus) -> i32 {
    match (status.exit_status(), status.terminating_signal()) {
        (Some(code), _) => code,
        (None, Some(signal)) => 128 + signal,
        (None, None) => 1,
    }
}

/// Whether the fence keeps what it should, from inside: each read-only
/// place is on a read-only mount, and each covered place on a mount other
/// than the one it was on.
pub(crate) fn verify(fenced: &Fenced) -> Result<(), Failed> {
    for place in &fenced.read_only {
        let found = rustix::fs::statvfs(place)
            .map_err(|error| Failed::step(format!("checking {}", place.display()), error))?;
        if !found.f_flag.contains(StatVfsMountFlags::RDONLY) {
            return Err(Failed::setup(format!(
                "{} is still writable",
                place.display()
            )));
        }
    }
    for (place, before) in &fenced.covered {
        let now = mount_at(place)
            .map_err(|error| Failed::step(format!("checking {}", place.display()), error))?;
        if now == *before {
            return Err(Failed::setup(format!("{} is not covered", place.display())));
        }
    }
    Ok(())
}
