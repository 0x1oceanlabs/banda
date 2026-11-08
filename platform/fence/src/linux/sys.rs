//! The calls Rust cannot make safe, each in one wrapper that says why it
//! holds. The launcher runs single-threaded, and [`fork`] checks that it
//! does, so a fork copies the one thread there is, holding no lock another
//! would release.

use rustix::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd};
use rustix::mount::MountAttrFlags;
use rustix::process::Pid;
use rustix::thread::UnshareFlags;
use std::ffi::{CStr, CString};
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether this process has taken its spec's fd: it owns one, once.
static TAKEN: AtomicBool = AtomicBool::new(false);

/// Whether this process has taken the fd it says how its start went on.
static STATUS_TAKEN: AtomicBool = AtomicBool::new(false);

/// The fd `number`, handed down by the process that started this one. It
/// is taken once in a process, as it starts, before it opens any fd of its
/// own: a second call is refused.
pub(crate) fn inherited(number: i32) -> io::Result<OwnedFd> {
    own(number, &TAKEN, "spec")
}

/// The fd `number` the launcher says how its start went on: a pipe its
/// starter reads to its end. It is taken once, as it starts, before the
/// spec, so a spec it refuses is said there too.
pub(crate) fn status(number: i32) -> io::Result<OwnedFd> {
    own(number, &STATUS_TAKEN, "status")
}

#[allow(unsafe_code)]
fn own(number: i32, taken: &AtomicBool, what: &str) -> io::Result<OwnedFd> {
    if number < 3 {
        return Err(io::Error::other(format!("fd {number} is no {what}'s")));
    }
    // It must be open before this process owns it.
    rustix::io::fcntl_getfd(
        // SAFETY: borrowed only for this one call, which reads its flags.
        unsafe { BorrowedFd::borrow_raw(number) },
    )?;
    if taken.swap(true, Ordering::SeqCst) {
        return Err(io::Error::other(format!(
            "this process has taken its {what} already"
        )));
    }
    // SAFETY: the starter named it on the command line and kept it open
    // across exec; this process takes it once, as it starts, before it
    // opens any of its own, and owns it from here, so it is closed once,
    // by its owner.
    Ok(unsafe { OwnedFd::from_raw_fd(number) })
}

/// Refuses a process of more than one thread: a namespace is made for the
/// calling thread alone, and a fork copies only it.
pub(crate) fn one_thread() -> io::Result<()> {
    let status = std::fs::read_to_string("/proc/self/status")?;
    let threads = (status.lines())
        .find_map(|line| line.strip_prefix("Threads:"))
        .map(str::trim);
    match threads {
        Some("1") => Ok(()),
        other => Err(io::Error::other(format!(
            "this process runs {} threads, not one",
            other.unwrap_or("an unknown number of")
        ))),
    }
}

/// `unshare(flags)` of this thread, which is the process's one.
#[allow(unsafe_code)]
pub(crate) fn unshare(flags: UnshareFlags) -> io::Result<()> {
    assert!(!flags.contains(UnshareFlags::FILES));
    // SAFETY: the fd table stays shared (no CLONE_FILES), so no thread
    // sees an fd another closed; the launcher has no other thread.
    Ok(unsafe { rustix::thread::unshare_unsafe(flags) }?)
}

/// Which side of a fork this is.
pub(crate) enum Forked {
    Child,
    Parent(Pid),
}

/// `fork()`, through the C library, which keeps its own books of it, of a
/// process of one thread: of more, it refuses.
#[allow(unsafe_code)]
pub(crate) fn fork() -> io::Result<Forked> {
    one_thread()?;
    // SAFETY: the process is single-threaded (checked above), so the child
    // holds a whole copy of its one thread and no lock held elsewhere; it
    // goes on in Rust as the parent would, and ends by exec or exit.
    match unsafe { libc::fork() } {
        -1 => Err(io::Error::last_os_error()),
        0 => Ok(Forked::Child),
        pid => Ok(Forked::Parent(Pid::from_raw(pid).expect("a child's pid"))),
    }
}

/// `execve(path, argv, envp)`: returns only when it failed, with why.
#[allow(unsafe_code)]
pub(crate) fn exec(path: &CStr, argv: &[CString], envp: &[CString]) -> io::Error {
    let ended = |strings: &[CString]| -> Vec<*const libc::c_char> {
        (strings.iter().map(|string| string.as_ptr()))
            .chain([std::ptr::null()])
            .collect()
    };
    let (argv, envp) = (ended(argv), ended(envp));
    // SAFETY: both arrays end with a null pointer, and each entry is a
    // NUL-terminated string that outlives the call.
    unsafe { libc::execve(path.as_ptr(), argv.as_ptr(), envp.as_ptr()) };
    io::Error::last_os_error()
}

/// The value a signal the launcher passes on carries, so the init tells it
/// from its own copy of one sent to the whole process group.
const PASSED: usize = 0xBA_9DA;

/// A signal as it came: its number, and whether the kernel sent it (as a
/// terminal does, to its whole foreground group) or the launcher passed it
/// on.
pub(crate) struct Caught {
    pub number: i32,
    pub from_kernel: bool,
    pub passed: bool,
}

/// A set of signals, by their numbers.
pub(crate) struct Signals(libc::sigset_t);

impl Signals {
    #[allow(unsafe_code)]
    pub(crate) fn of(numbers: &[i32]) -> Signals {
        // SAFETY: sigemptyset fills the set it is given; sigaddset adds to
        // it a number the C library knows, or refuses one it does not.
        unsafe {
            let mut set = std::mem::zeroed();
            libc::sigemptyset(&mut set);
            for &number in numbers {
                libc::sigaddset(&mut set, number);
            }
            Signals(set)
        }
    }

    /// Holds them back from this thread: they wait, pending, until it
    /// asks for them ([`Signals::wait`]).
    #[allow(unsafe_code)]
    pub(crate) fn block(&self) -> io::Result<()> {
        // SAFETY: reads the set, and writes no old one.
        match unsafe { libc::sigprocmask(libc::SIG_BLOCK, &self.0, std::ptr::null_mut()) } {
            0 => Ok(()),
            _ => Err(io::Error::last_os_error()),
        }
    }

    /// The next of them that comes, as it comes; `None` once `within`
    /// passed with none, when it is given.
    #[allow(unsafe_code)]
    pub(crate) fn wait(&self, within: Option<std::time::Duration>) -> io::Result<Option<Caught>> {
        let within = within.map(|within| libc::timespec {
            tv_sec: libc::time_t::try_from(within.as_secs()).unwrap_or(libc::time_t::MAX),
            // Under a second's nanoseconds: a long holds them everywhere.
            tv_nsec: within.subsec_nanos() as libc::c_long,
        });
        loop {
            // SAFETY: an all-zero siginfo_t is a valid one; the call
            // overwrites it.
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            // SAFETY: reads the set and the timeout, and writes the siginfo
            // it is given.
            let number = unsafe {
                match &within {
                    Some(within) => libc::sigtimedwait(&self.0, &mut info, within),
                    None => libc::sigwaitinfo(&self.0, &mut info),
                }
            };
            if number > 0 {
                let queued = info.si_code == libc::SI_QUEUE;
                // SAFETY: a signal sigqueue sent carries a value, read only
                // then.
                let passed = queued && unsafe { info.si_value() }.sival_ptr as usize == PASSED;
                return Ok(Some(Caught {
                    number,
                    from_kernel: info.si_code == libc::SI_KERNEL,
                    passed,
                }));
            }
            let error = io::Error::last_os_error();
            match error.raw_os_error() {
                Some(libc::EAGAIN) => return Ok(None),
                Some(libc::EINTR) => {}
                _ => return Err(error),
            }
        }
    }
}

/// Sends `number` to `pid`, marked as passed on by the launcher.
#[allow(unsafe_code)]
pub(crate) fn pass_on(pid: Pid, number: i32) -> io::Result<()> {
    let value = libc::sigval {
        sival_ptr: PASSED as *mut libc::c_void,
    };
    // SAFETY: sends a signal with a value the kernel copies as a number;
    // nothing is read through it.
    match unsafe { libc::sigqueue(pid.as_raw_nonzero().get(), number, value) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// Signals as a program expects them at its start: none held back, and
/// SIGPIPE as the system has it, which Rust's own start ignores (as std's
/// `Command` does for a child).
#[allow(unsafe_code)]
pub(crate) fn signals_as_at_start() -> io::Result<()> {
    let none = Signals::of(&[]);
    // SAFETY: sets the mask from a set this owns; SIG_DFL is a disposition,
    // no handler.
    unsafe {
        if libc::sigprocmask(libc::SIG_SETMASK, &none.0, std::ptr::null_mut()) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::signal(libc::SIGPIPE, libc::SIG_DFL) == libc::SIG_ERR {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

/// `close_range(first, last, flags)` (Linux 5.9; with CLOEXEC, 5.11).
#[allow(unsafe_code)]
fn close_range(first: u32, last: u32, flags: libc::c_uint) -> io::Result<()> {
    // SAFETY: changes or closes fds by number; no caller holds one of
    // those it closes (see each).
    let done = unsafe { libc::syscall(libc::SYS_close_range, first, last, flags) };
    match done {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// Marks every fd from `first` on to close on exec.
pub(crate) fn close_on_exec_from(first: u32) -> io::Result<()> {
    close_range(first, u32::MAX, libc::CLOSE_RANGE_CLOEXEC)
}

/// Closes every fd from 3 on but `kept`: what the launcher's starter left
/// open in it, which none of its processes needs. Called as the launcher
/// starts, while it holds no fd of its own but `kept`.
pub(crate) fn close_all_but(kept: Option<&OwnedFd>) -> io::Result<()> {
    let kept = kept.and_then(|kept| u32::try_from(kept.as_raw_fd()).ok());
    match kept {
        Some(kept) if kept >= 3 => {
            if kept > 3 {
                close_range(3, kept - 1, 0)?;
            }
            close_range(kept + 1, u32::MAX, 0)
        }
        _ => close_range(3, u32::MAX, 0),
    }
}

/// Lets go of this process's controlling terminal, if it has one, so
/// nothing it starts opens `/dev/tty`. Its process group stays as it is.
/// It refuses to in a process that leads its session, where letting go
/// would hang up the terminal's group.
#[allow(unsafe_code)]
pub(crate) fn no_terminal() -> io::Result<()> {
    use rustix::fs::{Mode, OFlags};
    let flags = OFlags::RDWR | OFlags::NOCTTY | OFlags::CLOEXEC;
    let tty = match rustix::fs::open("/dev/tty", flags, Mode::empty()) {
        Ok(tty) => tty,
        // No controlling terminal, or no /dev/tty here.
        Err(rustix::io::Errno::NXIO | rustix::io::Errno::NOENT) => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if rustix::process::getsid(None)? == rustix::process::getpid() {
        return Err(io::Error::other(
            "it leads a session with a terminal; start it in its starter's session",
        ));
    }
    // SAFETY: TIOCNOTTY takes no argument and reads no memory of this
    // process.
    match unsafe { libc::ioctl(tty.as_raw_fd(), libc::TIOCNOTTY) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

/// The mount attributes `set` on every mount of the tree `tree` (an
/// `open_tree` clone), which may only gain them (Linux 5.12): what a
/// mount in a user namespace may not lose, it keeps. rustix has no
/// `mount_setattr`, but has its attributes.
#[allow(unsafe_code)]
pub(crate) fn mount_set(tree: &OwnedFd, set: MountAttrFlags) -> io::Result<()> {
    #[repr(C)]
    struct MountAttr {
        attr_set: u64,
        attr_clr: u64,
        propagation: u64,
        userns_fd: u64,
    }
    let attr = MountAttr {
        attr_set: u64::from(set.bits()),
        attr_clr: 0,
        propagation: 0,
        userns_fd: 0,
    };
    // SAFETY: the kernel reads `attr`, of the size given, during the call,
    // and the empty path names `tree` itself.
    let done = unsafe {
        libc::syscall(
            libc::SYS_mount_setattr,
            tree.as_raw_fd(),
            c"".as_ptr(),
            libc::AT_EMPTY_PATH | libc::AT_RECURSIVE,
            &attr as *const MountAttr,
            std::mem::size_of::<MountAttr>(),
        )
    };
    match done {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}
