//! The fence for real, from outside and from inside. This one program is
//! the launcher (`fence`), the programs it fences (`inside`) and the tests
//! that start them, so it has a `main` of its own.
//!
//! Each test that needs namespaces asks first whether the fence holds
//! here, by the probe over nothing. Where the system refuses it (a
//! container whose seccomp refuses `unshare` or that masks `/proc`, a
//! kernel without user namespaces, root) it says so and why, and passes as
//! skipped; with `BANDA_FENCE_TESTS=require`, as `scripts/check.sh` sets
//! outside CI, it fails instead. A fence that fails to set up for any other
//! reason fails every such test. With `BANDA_FENCE_TESTS=all`, as CI's
//! `fence` part sets, every test runs: one that would skip for anything it
//! lacks here (namespaces, Landlock's scopes, bwrap) fails.

use banda_fence::{Holes, Layer, Probe, Spec, Why};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Output, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// The build this program says it is, as the launcher and in its specs.
const BUILD: &str = "fence-tests";

pub fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().collect();
    match args.get(1).and_then(|arg| arg.to_str()) {
        Some("fence") => launcher(&args[2..]),
        Some("probe") => probe(&args[2..]),
        Some("inside") => inside(&args[2..]),
        Some("session") => session(&args[2..]),
        _ => run_tests(&args[1..]),
    }
}

// The launcher and the probe, as `banda fence` runs them.

/// `fence --spec-fd N -- program args…`
fn launcher(args: &[OsString]) -> ExitCode {
    let (fd, rest) = spec_fd(args);
    assert_eq!(rest[0], "--");
    banda_fence::launch(fd, &rest[1..], BUILD)
}

/// `probe --spec-fd N`: what the probe finds over that spec, as one line,
/// with this program behind it, doing nothing.
fn probe(args: &[OsString]) -> ExitCode {
    let (fd, _) = spec_fd(args);
    let found = match banda_fence::take(fd, BUILD) {
        Ok(spec) => banda_fence::probe(&spec, &[me().into_os_string(), "inside".into()]),
        Err(words) => Probe::Missing {
            why: Why::SetupFailed,
            words,
        },
    };
    println!("{}", serde_json::to_string(&found).unwrap());
    ExitCode::SUCCESS
}

fn spec_fd(args: &[OsString]) -> (i32, &[OsString]) {
    assert_eq!(args[0], "--spec-fd");
    let fd = args[1].to_str().unwrap().parse().unwrap();
    (fd, &args[2..])
}

/// `session <terminal> program args…`: runs the program, the launcher, in
/// a session of its own whose controlling terminal is `terminal`, in the
/// foreground there, as a shell without job control would.
#[allow(unsafe_code)]
fn session(args: &[OsString]) -> ExitCode {
    rustix::process::setsid().unwrap();
    let flags = rustix::fs::OFlags::RDWR | rustix::fs::OFlags::CLOEXEC;
    let terminal = rustix::fs::open(args[0].as_os_str(), flags, rustix::fs::Mode::empty()).unwrap();
    rustix::process::ioctl_tiocsctty(&terminal).unwrap();
    // The terminal's interrupt reaches this process too: held back here,
    // and the launcher and the program set their own.
    // SAFETY: a mask of this process's own, from a set it fills.
    unsafe {
        let mut set = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::sigprocmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
    }
    let status = Command::new(&args[1]).args(&args[2..]).status().unwrap();
    ExitCode::from(u8::try_from(status.code().unwrap_or(1)).unwrap_or(1))
}

// What a fenced program does, saying each action on stdout as
// `action path: ok`, or with what it read, or `…: errno N`.

fn inside(args: &[OsString]) -> ExitCode {
    let mut args = args.iter().map(|arg| arg.to_str().unwrap().to_owned());
    while let Some(action) = args.next() {
        let mut next = || args.next().expect("an argument");
        let said = match action.as_str() {
            "uid" => format!("uid {}", rustix::process::getuid().as_raw()),
            "pid" => format!("pid {}", std::process::id()),
            "list" => {
                let folder = next();
                format!("list {folder}: {}", listed(&folder))
            }
            "read" => {
                let file = next();
                let read = std::fs::read_to_string(&file).map(|read| read.trim_end().to_owned());
                format!(
                    "read {file}: {}",
                    read.unwrap_or_else(|error| errno(&error))
                )
            }
            "write" => {
                let file = next();
                let written = std::fs::write(&file, "written inside");
                format!("write {file}: {}", outcome(written))
            }
            "chmod" => {
                use std::os::unix::fs::PermissionsExt;
                let (place, mode) = (next(), next());
                let mode = std::fs::Permissions::from_mode(u32::from_str_radix(&mode, 8).unwrap());
                format!(
                    "chmod {place}: {}",
                    outcome(std::fs::set_permissions(&place, mode))
                )
            }
            "rename" => {
                let (from, to) = (next(), next());
                format!("rename {from}: {}", outcome(std::fs::rename(&from, &to)))
            }
            "run" => {
                let program = next();
                let ran = (Command::new(&program).output())
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
                format!(
                    "run {program}: {}",
                    ran.unwrap_or_else(|error| errno(&error))
                )
            }
            "connect" => {
                let socket = next();
                let connected = std::os::unix::net::UnixStream::connect(&socket).map(drop);
                format!("connect {socket}: {}", outcome(connected))
            }
            "abstract" => {
                use std::os::linux::net::SocketAddrExt;
                let name = next();
                let address = std::os::unix::net::SocketAddr::from_abstract_name(&name).unwrap();
                let connected = std::os::unix::net::UnixStream::connect_addr(&address).map(drop);
                format!("abstract {name}: {}", outcome(connected))
            }
            "signal" => {
                let number = next();
                let sent = rustix::process::test_kill_process(pid(number.parse().unwrap()));
                format!("signal {number}: {}", outcome(sent.map_err(Into::into)))
            }
            "trace" => {
                let number = next();
                format!(
                    "trace {number}: {}",
                    outcome(trace(number.parse().unwrap()))
                )
            }
            "status" => {
                let status = std::fs::read_to_string("/proc/self/status").unwrap();
                let wanted = ["NoNewPrivs", "CapEff", "CapAmb"];
                let lines = (status.lines())
                    .filter(|line| wanted.iter().any(|name| line.starts_with(name)))
                    .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "));
                format!("status {}", lines.collect::<Vec<_>>().join(", "))
            }
            "stat" => {
                use std::os::unix::fs::MetadataExt;
                let place = next();
                let stat = std::fs::metadata(&place).unwrap();
                format!("stat {place}: {:o} {}", stat.mode() & 0o7777, stat.uid())
            }
            "flags" => {
                use rustix::fs::StatVfsMountFlags as Flags;
                let place = next();
                let flags = rustix::fs::statvfs(place.as_str()).unwrap().f_flag;
                let named = [
                    (Flags::RDONLY, "ro"),
                    (Flags::NOSUID, "nosuid"),
                    (Flags::NODEV, "nodev"),
                    (Flags::NOEXEC, "noexec"),
                ];
                let set = (named.iter()).filter(|(flag, _)| flags.contains(*flag));
                let set: Vec<&str> = set.map(|(_, name)| *name).collect();
                format!("flags {place}: {}", set.join(" "))
            }
            "pty" => {
                use rustix::pty::OpenptFlags;
                let made =
                    rustix::pty::openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).and_then(|pty| {
                        rustix::pty::grantpt(&pty)?;
                        rustix::pty::unlockpt(&pty)?;
                        rustix::pty::ptsname(&pty, Vec::new())
                    });
                match made {
                    Ok(name) => format!("pty {}", name.to_string_lossy()),
                    Err(error) => format!("pty: errno {}", error.raw_os_error()),
                }
            }
            "landlock" => {
                let (allowed, denied) = (next(), next());
                landlock(&allowed, &denied)
            }
            "unshare" => {
                let folder = next();
                format!("unshare {folder}: {}", outcome(unshared(&folder)))
            }
            "uncover" => {
                let folder = next();
                format!("uncover {folder}: {}", uncovered(&folder))
            }
            "nest" => nest(&next()),
            "count" => {
                let (name, ms) = (next(), next());
                count(&name, ms.parse().unwrap())
            }
            other => panic!("no action {other}"),
        };
        println!("{said}");
    }
    ExitCode::SUCCESS
}

fn listed(folder: &str) -> String {
    let mut names: Vec<String> = match std::fs::read_dir(folder) {
        Ok(entries) => (entries.map(|entry| entry.unwrap().file_name()))
            .map(|name| name.to_string_lossy().into_owned())
            .collect(),
        Err(error) => vec![errno(&error)],
    };
    names.sort();
    names.join(" ")
}

fn errno(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(code) => format!("errno {code}"),
        None => error.to_string(),
    }
}

fn outcome(done: std::io::Result<()>) -> String {
    done.map_or_else(|error| errno(&error), |()| "ok".to_owned())
}

/// Attaches to `number` as a tracer, and lets go at once if it could.
#[allow(unsafe_code)]
fn trace(number: i32) -> std::io::Result<()> {
    // SAFETY: PTRACE_ATTACH and PTRACE_DETACH read no memory of this
    // process.
    unsafe {
        if libc::ptrace(libc::PTRACE_ATTACH, number, 0, 0) == -1 {
            return Err(std::io::Error::last_os_error());
        }
        libc::ptrace(libc::PTRACE_DETACH, number, 0, 0);
    }
    Ok(())
}

/// What a Harness's own sandbox does with Landlock: it reads only under
/// `allowed`.
fn landlock(allowed: &str, denied: &str) -> String {
    use landlock::{
        ABI, AccessFs, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus,
    };
    let reads = AccessFs::from_read(ABI::V1);
    let restricted = Ruleset::default()
        .handle_access(reads)
        .and_then(|ruleset| ruleset.create())
        .and_then(|ruleset| {
            ruleset.add_rule(PathBeneath::new(PathFd::new(allowed).unwrap(), reads))
        })
        .and_then(|ruleset| ruleset.restrict_self());
    match restricted {
        Ok(status) if status.ruleset != RulesetStatus::NotEnforced => {}
        Ok(_) => return "landlock: not enforced".to_owned(),
        Err(error) => return format!("landlock: {error}"),
    }
    let read = |folder: &str| outcome(std::fs::read_dir(folder).map(drop));
    format!(
        "landlock {allowed}: {}, {denied}: {}",
        read(allowed),
        read(denied)
    )
}

/// What a nested sandbox does first: a user and a mount namespace of its
/// own, root in it.
#[allow(unsafe_code)]
fn nested() -> std::io::Result<()> {
    use rustix::thread::UnshareFlags;
    let uid = rustix::process::getuid().as_raw();
    let gid = rustix::process::getgid().as_raw();
    // SAFETY: this program has one thread here, and keeps its fd table.
    unsafe { rustix::thread::unshare_unsafe(UnshareFlags::NEWUSER | UnshareFlags::NEWNS) }?;
    std::fs::write("/proc/self/setgroups", "deny")?;
    std::fs::write("/proc/self/uid_map", format!("0 {uid} 1"))?;
    std::fs::write("/proc/self/gid_map", format!("0 {gid} 1"))
}

/// A nested sandbox's namespaces, and a mount there.
fn unshared(folder: &str) -> std::io::Result<()> {
    nested()?;
    let flags = rustix::mount::MountFlags::empty();
    rustix::mount::mount("none", folder, "tmpfs", flags, None)?;
    std::fs::write(Path::new(folder).join("made"), "")
}

/// From a nested sandbox's namespaces, root there: whether the cover on
/// `folder` comes off, and what the folder lists after.
fn uncovered(folder: &str) -> String {
    if let Err(error) = nested() {
        return format!("no namespaces: {}", errno(&error));
    }
    let off = rustix::mount::unmount(folder, rustix::mount::UnmountFlags::DETACH);
    format!(
        "{}; list: {}",
        outcome(off.map_err(Into::into)),
        listed(folder)
    )
}

/// A fence inside the fence, as a trial engine inside an Agent's starts
/// its own Harness: it hides `folder` and lists it.
fn nest(folder: &str) -> String {
    let spec = Spec {
        hidden: vec![PathBuf::from(folder)],
        ..spec()
    };
    let output = fenced(&spec, &me_inside(&["list", folder]));
    let code = output.status.code().unwrap_or(-1);
    let said = String::from_utf8_lossy(&output.stdout);
    format!("nest {folder}: {code} {}", said.trim())
}

/// How many times the signal `name` (`INT`, `USR1`) reaches this program
/// within `ms` of its saying `ready`: each dequeued as it comes.
#[allow(unsafe_code)]
fn count(name: &str, ms: u64) -> String {
    let number = match name {
        "INT" => libc::SIGINT,
        "USR1" => libc::SIGUSR1,
        other => panic!("no signal {other}"),
    };
    // SAFETY: a mask of this program's own, from a set it fills, and a
    // siginfo the call writes.
    unsafe {
        let mut set = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, number);
        libc::sigprocmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        println!("ready");
        std::io::stdout().flush().unwrap();
        let until = Instant::now() + Duration::from_millis(ms);
        let mut times = 0;
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            let wait = libc::timespec {
                tv_sec: 0,
                tv_nsec: i64::from(left.subsec_nanos()).max(1),
            };
            let mut info: libc::siginfo_t = std::mem::zeroed();
            if libc::sigtimedwait(&set, &mut info, &wait) == number {
                times += 1;
            }
        }
        format!("count {name}: {times}")
    }
}

// Starting the launcher, as an environment does.

fn me() -> PathBuf {
    std::env::current_exe().unwrap()
}

/// This program, to run inside with `actions`.
fn me_inside(actions: &[&str]) -> Vec<OsString> {
    let mut program = vec![me().into_os_string(), "inside".into()];
    program.extend(actions.iter().map(OsString::from));
    program
}

/// The launcher's own arguments, set to fence `program` as `sealed` says.
fn launcher_args(sealed: &banda_fence::Sealed, program: &[OsString]) -> Vec<OsString> {
    let args: Vec<String> = (program[1..].iter())
        .map(|arg| arg.to_str().unwrap().to_owned())
        .collect();
    banda_fence::argv(sealed, program[0].to_str().unwrap(), &args)
}

/// The launcher, set to fence `program` as `spec` says.
fn launcher_of(spec: &Spec, program: &[OsString]) -> Command {
    let sealed = spec.seal().unwrap();
    let mut command = Command::new(me());
    command.args(launcher_args(&sealed, program));
    banda_fence::attach(&mut command, sealed);
    command
}

fn fenced(spec: &Spec, program: &[OsString]) -> Output {
    launcher_of(spec, program)
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

/// What the fenced program said, line by line, once it ended well.
fn said(spec: &Spec, program: &[OsString]) -> Vec<String> {
    let output = fenced(spec, program);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{:?}: {stderr}", output.status);
    let stdout = String::from_utf8(output.stdout).unwrap();
    stdout.lines().map(str::to_owned).collect()
}

fn spec() -> Spec {
    Spec {
        build: BUILD.to_owned(),
        ..Spec::default()
    }
}

fn sh(script: &str) -> Vec<OsString> {
    vec!["/bin/sh".into(), "-c".into(), script.into()]
}

fn path(path: &Path) -> &str {
    path.to_str().unwrap()
}

/// What the probe finds over `spec`, from its one line.
fn probed(spec: &Spec) -> Probe {
    let sealed = spec.seal().unwrap();
    let mut command = Command::new(me());
    command.args(["probe", "--spec-fd", &sealed.number().to_string()]);
    banda_fence::attach(&mut command, sealed);
    let output = command.output().unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 1, "one line: {stdout:?}");
    serde_json::from_str(lines[0]).unwrap()
}

/// What `BANDA_FENCE_TESTS` asks: `require` or `all`, or anything else.
fn asked() -> String {
    std::env::var("BANDA_FENCE_TESTS").unwrap_or_default()
}

/// Whether a test fails, rather than skips, where the system refuses the
/// fence.
fn required() -> bool {
    matches!(asked().as_str(), "require" | "all")
}

/// Whether every test must run: one that would skip fails.
fn all_required() -> bool {
    asked() == "all"
}

/// Why the fence cannot hold here, if the system refuses it: the probe
/// over nothing. A fence that fails for another reason fails the test.
fn cannot_hold() -> Option<&'static str> {
    static FOUND: OnceLock<Result<(), (Why, String)>> = OnceLock::new();
    let found = FOUND.get_or_init(|| match probed(&spec()) {
        Probe::Holds { .. } => Ok(()),
        Probe::Missing { why, words } => Err((why, words)),
    });
    match found {
        Ok(()) => None,
        Err((Why::NoUserNamespaces | Why::Refused, words)) if !required() => Some(words),
        Err((why, words)) => panic!(
            "the fence does not hold here ({why:?}): {words}{}",
            if required() {
                format!(
                    " (BANDA_FENCE_TESTS={}; set BANDA_FENCE_TESTS=skip to run without)",
                    asked()
                )
            } else {
                String::new()
            }
        ),
    }
}

/// The kernel's Landlock version, or none.
#[allow(unsafe_code)]
fn landlock_abi() -> Option<i64> {
    const VERSION: libc::c_uint = 1;
    // SAFETY: asks the kernel its Landlock version, with no ruleset to read.
    let abi = unsafe {
        libc::syscall(
            libc::SYS_landlock_create_ruleset,
            std::ptr::null::<libc::c_void>(),
            0usize,
            VERSION,
        )
    };
    (abi > 0).then_some(abi)
}

// The tests.

enum Ran {
    Passed,
    Skipped(String),
}

macro_rules! needs_the_fence {
    () => {
        if let Some(why) = cannot_hold() {
            return Ran::Skipped(format!("the fence cannot hold here: {why}"));
        }
    };
}

fn a_hidden_folder_reads_empty_and_the_user_is_itself() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let state = t.path().join("state");
    std::fs::create_dir(&state).unwrap();
    let secret = state.join("engine.json");
    std::fs::write(&secret, "kept").unwrap();
    let spec = Spec {
        hidden: vec![state.clone()],
        ..spec()
    };
    let actions = [
        "list",
        path(&state),
        "read",
        path(&secret),
        "uid",
        "stat",
        path(&state),
        "flags",
        path(&state),
    ];
    let lines = said(&spec, &me_inside(&actions));
    let uid = rustix::process::getuid().as_raw();
    assert_ne!(uid, 0, "the tests run as a user");
    assert_eq!(
        lines,
        [
            format!("list {}: ", path(&state)),
            format!("read {}: errno {}", path(&secret), libc::ENOENT),
            format!("uid {uid}"),
            format!("stat {}: 700 {uid}", path(&state)),
            format!("flags {}: nosuid nodev", path(&state)),
        ]
    );
    assert_eq!(std::fs::read_to_string(&secret).unwrap(), "kept");
    Ran::Passed
}

fn holes_show_their_folders_each_as_it_opens() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let data = t.path().join("data");
    let projects = data.join("projects");
    let sessions = projects.join("a/sessions/claude");
    let files = projects.join("a/files");
    let engine = data.join("engine/1.0");
    for folder in [&sessions, &files, &engine, &projects.join("b")] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let kept = files.join("kept.txt");
    std::fs::write(&kept, "a file").unwrap();
    std::fs::write(projects.join("b/secret"), "b's").unwrap();
    let runnable: std::fs::Permissions = std::os::unix::fs::PermissionsExt::from_mode(0o755);
    let tool = engine.join("tool");
    let script = files.join("script");
    for program in [&tool, &script] {
        std::fs::write(program, "#!/bin/sh\necho ran\n").unwrap();
        std::fs::set_permissions(program, runnable.clone()).unwrap();
    }
    let spec = Spec {
        hidden: vec![data.clone()],
        holes: Holes {
            writes: vec![sessions.clone()],
            reads: vec![files.clone()],
            runs: vec![engine.clone()],
        },
        ..spec()
    };
    let session = sessions.join("s.json");
    let added = files.join("added");
    let a = projects.join("a");
    let lines = said(
        &spec,
        &me_inside(&[
            "write",
            path(&session),
            "read",
            path(&kept),
            "write",
            path(&added),
            "run",
            path(&tool),
            "run",
            path(&script),
            "list",
            path(&projects),
            "list",
            path(&a),
        ]),
    );
    assert_eq!(
        lines,
        [
            format!("write {}: ok", path(&session)),
            format!("read {}: a file", path(&kept)),
            format!("write {}: errno {}", path(&added), libc::EROFS),
            format!("run {}: ran", path(&tool)),
            format!("run {}: errno {}", path(&script), libc::EACCES),
            format!("list {}: a", path(&projects)),
            format!("list {}: files sessions", path(&a)),
        ]
    );
    assert_eq!(std::fs::read_to_string(&session).unwrap(), "written inside");
    assert!(!added.exists());
    Ran::Passed
}

fn config_is_read_only_inside() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let config = t.path().join("config");
    std::fs::create_dir(&config).unwrap();
    let look = config.join("look.toml");
    std::fs::write(&look, "radius = 6\n").unwrap();
    let spec = Spec {
        read_only: vec![config.clone()],
        ..spec()
    };
    let new = config.join("harnesses.toml");
    let actions = [
        "read",
        path(&look),
        "write",
        path(&look),
        "write",
        path(&new),
    ];
    let lines = said(&spec, &me_inside(&actions));
    assert_eq!(
        lines,
        [
            format!("read {}: radius = 6", path(&look)),
            format!("write {}: errno {}", path(&look), libc::EROFS),
            format!("write {}: errno {}", path(&new), libc::EROFS),
        ]
    );
    assert_eq!(std::fs::read_to_string(&look).unwrap(), "radius = 6\n");
    assert!(!new.exists());
    Ran::Passed
}

fn the_system_folders_are_the_fences_own_or_read_only() -> Ran {
    needs_the_fence!();
    // A terminal of the host's, which the program must not reach.
    use rustix::pty::OpenptFlags;
    let host = rustix::pty::openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
    rustix::pty::unlockpt(&host).unwrap();
    let hosts = rustix::pty::ptsname(&host, Vec::new()).unwrap();
    let hosts = hosts.to_str().unwrap();
    let actions = [
        "list",
        "/dev",
        "read",
        hosts,
        "pty",
        "write",
        "/dev/shm/made",
        "flags",
        "/sys",
        "flags",
        "/sys/fs/cgroup",
    ];
    let lines = said(&spec(), &me_inside(&actions));
    assert_eq!(
        lines[0],
        "list /dev: fd full null ptmx pts random shm stderr stdin stdout tty urandom zero"
    );
    assert!(
        lines[1].starts_with(&format!("read {hosts}: errno")),
        "{}",
        lines[1]
    );
    assert_eq!(lines[2], "pty /dev/pts/0");
    assert_eq!(lines[3], "write /dev/shm/made: ok");
    for line in &lines[4..] {
        let (_, flags) = line.split_once(": ").unwrap();
        assert!(flags.split(' ').any(|flag| flag == "ro"), "{line}");
    }
    assert!(!Path::new("/dev/shm/made").exists());
    Ran::Passed
}

fn a_program_behind_the_fence_has_no_privileges_and_a_cover_stays_put() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let state = t.path().join("state");
    std::fs::create_dir(&state).unwrap();
    std::fs::write(state.join("engine.json"), "kept").unwrap();
    let spec = Spec {
        hidden: vec![state.clone()],
        ..spec()
    };
    let lines = said(&spec, &me_inside(&["status", "uncover", path(&state)]));
    let none = "0000000000000000";
    assert_eq!(
        lines[0],
        format!("status CapEff: {none}, CapAmb: {none}, NoNewPrivs: 1")
    );
    // Root in a namespace of its own, the program still cannot take the
    // cover off: it is locked to the fence's.
    let (outcome, list) = lines[1].split_once("; ").unwrap();
    assert!(!outcome.ends_with(": ok"), "{}", lines[1]);
    assert_eq!(list, "list: ");
    Ran::Passed
}

fn whoever_started_the_fence_is_out_of_reach() -> Ran {
    needs_the_fence!();
    let starter = std::process::id().to_string();
    let actions = [
        "pid", "signal", &starter, "trace", &starter, "list", "/proc",
    ];
    let lines = said(&spec(), &me_inside(&actions));
    assert_eq!(
        lines[0], "pid 2",
        "the program is its namespace's second process"
    );
    let refused = [libc::ESRCH, libc::EPERM].map(|code| format!("errno {code}"));
    for line in &lines[1..3] {
        let (_, outcome) = line.split_once(": ").unwrap();
        assert!(refused.iter().any(|refused| refused == outcome), "{line}");
    }
    let listed = lines[3].split_once(": ").unwrap().1.split(' ');
    let numbers: Vec<u32> = listed.filter_map(|name| name.parse().ok()).collect();
    assert_eq!(
        numbers,
        [1, 2],
        "the namespace's /proc shows its own processes alone"
    );
    Ran::Passed
}

fn the_landlock_layer_holds_where_the_kernel_has_it() -> Ran {
    needs_the_fence!();
    let Some(abi) = landlock_abi().filter(|abi| *abi >= 6) else {
        return Ran::Skipped("this kernel has no Landlock scopes (ABI 6)".to_owned());
    };
    let t = tempfile::tempdir().unwrap();
    let state = t.path().join("state");
    std::fs::create_dir(&state).unwrap();
    let real = Spec {
        hidden: vec![state],
        ..spec()
    };
    match probed(&real) {
        Probe::Holds { layers } => {
            assert_eq!(layers, [Layer::Namespaces, Layer::Landlock], "ABI {abi}");
        }
        missing => panic!("{missing:?}"),
    }
    // An abstract socket made outside, as a display server's.
    use std::os::linux::net::SocketAddrExt;
    let name = format!("banda-fence-test-{}", std::process::id());
    let address = std::os::unix::net::SocketAddr::from_abstract_name(&name).unwrap();
    let _listening = std::os::unix::net::UnixListener::bind_addr(&address).unwrap();
    let lines = said(&spec(), &me_inside(&["abstract", &name]));
    assert_eq!(lines, [format!("abstract {name}: errno {}", libc::EPERM)]);
    Ran::Passed
}

fn the_init_and_the_program_hold_only_their_streams() -> Ran {
    needs_the_fence!();
    // A pipe whose ends the launcher's starter leaves open in it.
    let (read, write) = rustix::pipe::pipe().unwrap();
    let mut launcher = launcher_of(&spec(), &me_inside(&["list", "/proc/1/fd"]));
    let output = launcher.stdin(Stdio::null()).output().unwrap();
    drop((read, write));
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "list /proc/1/fd: 0 1 2\n"
    );
    Ran::Passed
}

fn the_fenced_tree_dies_with_the_launcher() -> Ran {
    needs_the_fence!();
    let mut launcher = launcher_of(&spec(), &sh("sleep 600 & echo started; exec sleep 601"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut started = String::new();
    let mut out = BufReader::new(launcher.stdout.take().unwrap());
    out.read_line(&mut started).unwrap();
    assert_eq!(started, "started\n");
    let leader = launcher.id();
    // The init, the shell that became `sleep 601`, and its `sleep 600`.
    let tree = wait_for(|| Some(descendants(leader)).filter(|found| found.len() >= 3));
    let tree = tree.expect("the fenced tree under the launcher");
    rustix::process::kill_process(pid(leader), rustix::process::Signal::KILL).unwrap();
    launcher.wait().unwrap();
    let gone = wait_for(|| tree.iter().all(|&process| !alive(process)).then_some(()));
    assert!(gone.is_some(), "{tree:?} outlived the launcher");
    Ran::Passed
}

fn a_signal_to_the_launcher_reaches_the_program() -> Ran {
    needs_the_fence!();
    let script = "trap 'echo heard; exit 0' TERM; echo ready; while :; do sleep 0.05; done";
    let mut launcher = launcher_of(&spec(), &sh(script))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(launcher.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    assert_eq!(line, "ready\n");
    let leader = pid(launcher.id());
    rustix::process::kill_process(leader, rustix::process::Signal::TERM).unwrap();
    let mut rest = String::new();
    out.read_to_string(&mut rest).unwrap();
    assert_eq!(rest, "heard\n");
    assert_eq!(launcher.wait().unwrap().code(), Some(0));
    Ran::Passed
}

/// Starts `command`, waits for the program's `ready`, does `send`, and
/// says how many times the program counted its signal.
fn counted(mut command: Command, send: impl FnOnce(u32)) -> String {
    let mut launcher = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(launcher.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    assert_eq!(line, "ready\n");
    send(launcher.id());
    let mut rest = String::new();
    out.read_to_string(&mut rest).unwrap();
    assert!(launcher.wait().unwrap().success());
    rest.trim().to_owned()
}

fn a_signal_reaches_the_program_once_from_the_launcher_or_a_terminal() -> Ran {
    needs_the_fence!();
    use rustix::process::Signal;
    // To the launcher alone.
    let command = launcher_of(&spec(), &me_inside(&["count", "USR1", "500"]));
    let once = counted(command, |leader| {
        rustix::process::kill_process(pid(leader), Signal::USR1).unwrap();
    });
    assert_eq!(once, "count USR1: 1");

    // To the whole group, from a program: the program's own, and the
    // launcher's passed on at most.
    use std::os::unix::process::CommandExt;
    let mut command = launcher_of(&spec(), &me_inside(&["count", "USR1", "500"]));
    command.process_group(0);
    let group = counted(command, |leader| {
        rustix::process::kill_process_group(pid(leader), Signal::USR1).unwrap();
    });
    assert!(
        ["count USR1: 1", "count USR1: 2"].contains(&group.as_str()),
        "{group}"
    );

    // A terminal's interrupt, to its whole foreground group.
    use rustix::pty::OpenptFlags;
    let terminal = rustix::pty::openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
    rustix::pty::grantpt(&terminal).unwrap();
    rustix::pty::unlockpt(&terminal).unwrap();
    let name = rustix::pty::ptsname(&terminal, Vec::new()).unwrap();
    let sealed = spec().seal().unwrap();
    let mut command = Command::new(me());
    command.arg("session").arg(name.to_str().unwrap()).arg(me());
    command.args(launcher_args(&sealed, &me_inside(&["count", "INT", "500"])));
    banda_fence::attach(&mut command, sealed);
    let interrupted = counted(command, |_| {
        rustix::io::write(&terminal, b"\x03").unwrap();
    });
    assert_eq!(interrupted, "count INT: 1");
    Ran::Passed
}

fn a_program_ended_by_a_signal_ends_the_launcher_with_128_and_its_number() -> Ran {
    needs_the_fence!();
    for (script, code) in [
        ("kill -TERM $$", 143),
        ("kill -KILL $$", 137),
        ("exit 3", 3),
    ] {
        let output = fenced(&spec(), &sh(script));
        assert_eq!(output.status.code(), Some(code), "{script}: {output:?}");
    }
    Ran::Passed
}

fn stdout_is_the_programs_alone() -> Ran {
    needs_the_fence!();
    let quiet = fenced(&spec(), &["true".into()]);
    assert!(quiet.status.success(), "{quiet:?}");
    assert!(
        quiet.stdout.is_empty() && quiet.stderr.is_empty(),
        "{quiet:?}"
    );

    let spoke = fenced(&spec(), &sh("echo hi"));
    assert_eq!(spoke.stdout, b"hi\n");
    assert!(spoke.stderr.is_empty(), "{spoke:?}");

    let missing = fenced(&spec(), &["no-such-program-anywhere".into()]);
    assert_eq!(missing.status.code(), Some(127));
    assert!(missing.stdout.is_empty());
    let words = String::from_utf8_lossy(&missing.stderr);
    assert!(
        words.contains("no-such-program-anywhere could not start"),
        "{words}"
    );
    Ran::Passed
}

fn the_launcher_refuses_what_it_cannot_do_and_runs_nothing() -> Ran {
    // Each is refused before any namespace, so these run anywhere.
    let t = tempfile::tempdir().unwrap();
    let marker = t.path().join("ran");
    let program = sh(&format!("touch {}", path(&marker)));
    let refused = |spec: &Spec, words: &str| {
        let output = fenced(spec, &program);
        let said = String::from_utf8_lossy(&output.stderr);
        assert_eq!(output.status.code(), Some(125), "{said}");
        assert!(output.stdout.is_empty());
        assert!(
            said.starts_with("banda fence: ") && said.contains(words),
            "{words}: {said}"
        );
        assert!(!marker.exists(), "{words}: the program ran");
    };
    let other = Spec {
        build: "another".to_owned(),
        ..spec()
    };
    refused(&other, "another build of banda");
    let gone = Spec {
        hidden: vec![t.path().join("gone")],
        ..spec()
    };
    refused(&gone, "is not there for the fence to cover");
    let link = t.path().join("link");
    std::os::unix::fs::symlink(t.path(), &link).unwrap();
    let linked = Spec {
        hidden: vec![link],
        ..spec()
    };
    refused(&linked, "is a link");
    let state = t.path().join("state");
    let wide = Spec {
        hidden: vec![state.clone()],
        holes: Holes {
            writes: vec![state.clone()],
            ..Holes::default()
        },
        ..spec()
    };
    refused(&wide, "as wide as");
    let nested = Spec {
        hidden: vec![state.clone()],
        holes: Holes {
            writes: vec![state.join("p")],
            reads: vec![state.join("p/q")],
            ..Holes::default()
        },
        ..spec()
    };
    refused(&nested, "one inside the other");
    // A place to hide in a folder of the user's own that it cannot enter:
    // the program could open that folder again, so it is refused.
    use std::os::unix::fs::PermissionsExt;
    let locked = t.path().join("locked");
    std::fs::create_dir(&locked).unwrap();
    let mode = std::fs::Permissions::from_mode;
    std::fs::set_permissions(&locked, mode(0o000)).unwrap();
    let closed = Spec {
        hidden_if_there: vec![locked.join("service.sock")],
        ..spec()
    };
    let output = fenced(&closed, &program);
    std::fs::set_permissions(&locked, mode(0o700)).unwrap();
    let said = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(125), "{said}");
    assert!(
        said.contains("which this user owns and cannot enter"),
        "{said}"
    );
    assert!(!marker.exists(), "the program ran");

    // A spec on a memfd anyone may still write is no spec.
    let open = rustix::fs::memfd_create("open", rustix::fs::MemfdFlags::empty()).unwrap();
    rustix::io::write(&open, &serde_json::to_vec(&spec()).unwrap()).unwrap();
    let fd = rustix::fd::AsRawFd::as_raw_fd(&open).to_string();
    let output = Command::new(me())
        .args(["fence", "--spec-fd", &fd, "--"])
        .args(&program)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(125));
    assert!(String::from_utf8_lossy(&output.stderr).contains("not sealed"));
    assert!(!marker.exists());
    Ran::Passed
}

fn the_program_starts_in_its_folder_and_never_in_a_hidden_one() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let project = t.path().join("project");
    let state = t.path().join("state");
    std::fs::create_dir(&project).unwrap();
    std::fs::create_dir(&state).unwrap();
    std::fs::write(state.join("engine.json"), "kept").unwrap();
    let asked = Spec {
        cwd: Some(project.clone()),
        hidden: vec![state.clone()],
        ..spec()
    };
    let output = fenced(&asked, &sh("pwd"));
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        path(&project)
    );

    // Started in a folder the fence hides, it finds that folder empty.
    let inherited = Spec { cwd: None, ..asked };
    let output = launcher_of(&inherited, &sh("ls -A ."))
        .current_dir(&state)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(output.stdout, b"");

    let missing = Spec {
        cwd: Some(t.path().join("gone")),
        ..spec()
    };
    let output = fenced(&missing, &sh("pwd"));
    assert_eq!(output.status.code(), Some(125), "{output:?}");
    assert!(output.stdout.is_empty());
    Ran::Passed
}

fn the_folders_above_a_hidden_one_stay_where_they_are() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let home = t.path().join("home");
    let state = home.join(".local/state/banda");
    std::fs::create_dir_all(&state).unwrap();
    // One the user may not write, but owns, and so may make writable.
    let local = home.join(".local");
    let shut = std::os::unix::fs::PermissionsExt::from_mode(0o555);
    std::fs::set_permissions(&local, shut).unwrap();
    let hidden = Spec {
        hidden: vec![state.clone()],
        ..spec()
    };
    let states = local.join("state");
    let moved = |folder: &Path| path(&folder.with_extension("moved")).to_owned();
    let (to_states, to_local, to_home) = (moved(&states), moved(&local), moved(&home));
    let actions = [
        "chmod",
        path(&local),
        "755",
        "rename",
        path(&states),
        &to_states,
        "rename",
        path(&local),
        &to_local,
        "rename",
        path(&home),
        &to_home,
    ];
    let lines = said(&hidden, &me_inside(&actions));
    assert_eq!(lines.len(), 4);
    assert_eq!(lines[0], format!("chmod {}: ok", path(&local)));
    let busy = format!("errno {}", libc::EBUSY);
    for line in &lines[1..] {
        assert!(line.ends_with(&busy), "{line}");
    }
    assert!(state.is_dir());

    // Every pin is one mount, however deep.
    let deep = t.path().join("a/b/c/d/e/f/g/h/state");
    std::fs::create_dir_all(&deep).unwrap();
    let mounts = |spec: &Spec| -> usize {
        let counted = said(spec, &sh("wc -l < /proc/self/mountinfo"));
        counted[0].trim().parse().unwrap()
    };
    let deeply = Spec {
        hidden: vec![deep.clone()],
        ..spec()
    };
    let added = mounts(&deeply) - mounts(&spec());
    // A cover, and a pin at most for each folder above it.
    assert!(
        added <= deep.ancestors().count(),
        "{added} mounts for one cover"
    );
    Ran::Passed
}

fn a_hidden_socket_is_out_of_reach_but_through_a_hole() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let socket = t.path().join("docker.sock");
    let run = t.path().join("run");
    std::fs::create_dir(&run).unwrap();
    let (agent, bus) = (run.join("agent.sock"), run.join("bus"));
    let bind = std::os::unix::net::UnixListener::bind;
    let _listening = [&socket, &agent, &bus].map(|socket| bind(socket).unwrap());
    // A link the user made, which leads elsewhere: passed over.
    let elsewhere = t.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    std::fs::write(elsewhere.join("kept"), "").unwrap();
    let link = t.path().join("display");
    std::os::unix::fs::symlink(&elsewhere, &link).unwrap();
    // In root's own folder, which this user neither enters nor owns where
    // it is closed, as a service's: out of reach already, and passed over.
    let roots = PathBuf::from("/root/banda-fence-test.sock");
    let spec = Spec {
        hidden: vec![run.clone()],
        hidden_if_there: vec![socket.clone(), t.path().join("not-there.sock"), link, roots],
        holes: Holes {
            writes: vec![agent.clone()],
            ..Holes::default()
        },
        ..spec()
    };
    let actions = [
        "connect",
        path(&socket),
        "connect",
        path(&agent),
        "connect",
        path(&bus),
        "list",
        path(&elsewhere),
    ];
    let lines = said(&spec, &me_inside(&actions));
    assert_eq!(lines.len(), 4);
    assert!(!lines[0].ends_with(": ok"), "{}", lines[0]);
    assert_eq!(lines[1], format!("connect {}: ok", path(&agent)));
    assert_eq!(
        lines[2],
        format!("connect {}: errno {}", path(&bus), libc::ENOENT)
    );
    assert_eq!(lines[3], format!("list {}: kept", path(&elsewhere)));
    Ran::Passed
}

fn namespaces_and_a_fence_nest_inside() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let mnt = t.path().join("mnt");
    let hidden = t.path().join("hidden");
    std::fs::create_dir(&mnt).unwrap();
    std::fs::create_dir(&hidden).unwrap();
    std::fs::write(hidden.join("secret"), "").unwrap();
    let lines = said(&spec(), &me_inside(&["unshare", path(&mnt)]));
    assert_eq!(lines, [format!("unshare {}: ok", path(&mnt))]);
    let lines = said(&spec(), &me_inside(&["nest", path(&hidden)]));
    assert_eq!(lines, [format!("nest {0}: 0 list {0}:", path(&hidden))]);
    Ran::Passed
}

fn bwrap_works_inside() -> Ran {
    needs_the_fence!();
    let bwrap = "/usr/bin/bwrap";
    if !Path::new(bwrap).exists() {
        return Ran::Skipped(format!("there is no {bwrap} here"));
    }
    let program = [
        bwrap,
        "--unshare-all",
        "--share-net",
        "--ro-bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--",
        "/bin/sh",
        "-c",
        "echo inner $$",
    ]
    .map(OsString::from);
    // bwrap is its namespace's init, and runs the command second.
    assert_eq!(said(&spec(), &program), ["inner 2"]);
    Ran::Passed
}

fn a_landlock_sandbox_works_inside() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let (allowed, denied) = (t.path().join("allowed"), t.path().join("denied"));
    std::fs::create_dir(&allowed).unwrap();
    std::fs::create_dir(&denied).unwrap();
    let lines = said(
        &spec(),
        &me_inside(&["landlock", path(&allowed), path(&denied)]),
    );
    if lines == ["landlock: not enforced"] {
        return Ran::Skipped("this kernel has no Landlock".to_owned());
    }
    let refused = format!("{}: errno {}", path(&denied), libc::EACCES);
    assert_eq!(
        lines,
        [format!("landlock {}: ok, {refused}", path(&allowed))]
    );
    Ran::Passed
}

fn the_probe_holds_over_a_real_spec_and_names_its_layers() -> Ran {
    needs_the_fence!();
    let t = tempfile::tempdir().unwrap();
    let state = t.path().join("state");
    let config = t.path().join("config");
    let data = t.path().join("data");
    let sessions = data.join("projects/a/sessions/claude");
    for folder in [&state, &config, &sessions] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let real = Spec {
        hidden: vec![state, data],
        read_only: vec![config],
        holes: Holes {
            writes: vec![sessions],
            ..Holes::default()
        },
        ..spec()
    };
    match probed(&real) {
        Probe::Holds { layers } => assert_eq!(layers[0], Layer::Namespaces, "{layers:?}"),
        missing => panic!("{missing:?}"),
    }
    let gone = Spec {
        hidden: vec![t.path().join("gone")],
        ..spec()
    };
    match probed(&gone) {
        Probe::Missing { why, words } => {
            assert_eq!(why, Why::SetupFailed);
            assert!(words.contains("not there"), "{words}");
        }
        holds => panic!("{holds:?}"),
    }
    Ran::Passed
}

// The tree of processes, as the host sees it.

fn pid(number: u32) -> rustix::process::Pid {
    rustix::process::Pid::from_raw(i32::try_from(number).unwrap()).unwrap()
}

/// Every process under `leader`, by each one's parent in `/proc`.
fn descendants(leader: u32) -> Vec<u32> {
    let parents: Vec<(u32, u32)> = (std::fs::read_dir("/proc").unwrap())
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<u32>().ok())
        .filter_map(|process| Some((process, stat(process)?.1)))
        .collect();
    let mut found = vec![leader];
    let mut at = 0;
    while at < found.len() {
        let parent = found[at];
        let children = parents.iter().filter(|(_, of)| *of == parent);
        found.extend(children.map(|(process, _)| *process));
        at += 1;
    }
    found.remove(0);
    found
}

/// A process's state, and its parent's number.
fn stat(process: u32) -> Option<(char, u32)> {
    let stat = std::fs::read_to_string(format!("/proc/{process}/stat")).ok()?;
    let mut after = stat.rsplit_once(')')?.1.split_whitespace();
    let state = after.next()?.chars().next()?;
    Some((state, after.next()?.parse().ok()?))
}

fn alive(process: u32) -> bool {
    stat(process).is_some_and(|(state, _)| !matches!(state, 'Z' | 'X'))
}

fn wait_for<T>(mut found: impl FnMut() -> Option<T>) -> Option<T> {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if let Some(found) = found() {
            return Some(found);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

// The runner.

macro_rules! tests {
    ($($test:ident),* $(,)?) => {
        &[$((stringify!($test), $test as fn() -> Ran)),*]
    };
}

/// A test, by its name.
type Test = (&'static str, fn() -> Ran);

const TESTS: &[Test] = tests![
    a_hidden_folder_reads_empty_and_the_user_is_itself,
    holes_show_their_folders_each_as_it_opens,
    config_is_read_only_inside,
    the_system_folders_are_the_fences_own_or_read_only,
    a_program_behind_the_fence_has_no_privileges_and_a_cover_stays_put,
    whoever_started_the_fence_is_out_of_reach,
    the_landlock_layer_holds_where_the_kernel_has_it,
    the_init_and_the_program_hold_only_their_streams,
    the_fenced_tree_dies_with_the_launcher,
    a_signal_to_the_launcher_reaches_the_program,
    a_signal_reaches_the_program_once_from_the_launcher_or_a_terminal,
    a_program_ended_by_a_signal_ends_the_launcher_with_128_and_its_number,
    stdout_is_the_programs_alone,
    the_launcher_refuses_what_it_cannot_do_and_runs_nothing,
    the_program_starts_in_its_folder_and_never_in_a_hidden_one,
    the_folders_above_a_hidden_one_stay_where_they_are,
    a_hidden_socket_is_out_of_reach_but_through_a_hole,
    namespaces_and_a_fence_nest_inside,
    bwrap_works_inside,
    a_landlock_sandbox_works_inside,
    the_probe_holds_over_a_real_spec_and_names_its_layers,
];

/// The tests chosen by `args`, as libtest reads them: any name holding a
/// filter (or equal to one, with `--exact`), none holding a `--skip`; the
/// other flags cargo passes, and their values, aside.
fn chosen(args: &[OsString]) -> Vec<&'static Test> {
    const VALUED: [&str; 6] = [
        "--test-threads",
        "--format",
        "--color",
        "--logfile",
        "--shuffle-seed",
        "-Z",
    ];
    let mut filters = Vec::new();
    let mut skips = Vec::new();
    let mut exact = false;
    let mut args = args.iter().filter_map(|arg| arg.to_str());
    while let Some(arg) = args.next() {
        match arg {
            "--exact" => exact = true,
            "--skip" => skips.extend(args.next()),
            valued if VALUED.contains(&valued) => {
                args.next();
            }
            flag if flag.starts_with('-') => {}
            filter => filters.push(filter),
        }
    }
    let matches = |name: &str, filter: &str| {
        if exact {
            name == filter
        } else {
            name.contains(filter)
        }
    };
    (TESTS.iter())
        .filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| matches(name, f)))
        .filter(|(name, _)| !skips.iter().any(|skip| matches(name, skip)))
        .collect()
}

/// Runs the chosen tests one after another, and says each as libtest
/// does; a skipped one says why, and fails where every test must run.
fn run_tests(args: &[OsString]) -> ExitCode {
    let chosen = chosen(args);
    if args.iter().any(|arg| arg == "--list") {
        for (name, _) in chosen {
            println!("{name}: test");
        }
        return ExitCode::SUCCESS;
    }
    println!("\nrunning {} tests", chosen.len());
    let (mut passed, mut skipped, mut failed) = (0, 0, 0);
    for (name, test) in chosen {
        match std::panic::catch_unwind(test) {
            Ok(Ran::Passed) => {
                passed += 1;
                println!("test {name} ... ok");
            }
            Ok(Ran::Skipped(why)) if all_required() => {
                failed += 1;
                println!(
                    "test {name} ... FAILED: it would skip ({why}), and BANDA_FENCE_TESTS=all"
                );
            }
            Ok(Ran::Skipped(why)) => {
                skipped += 1;
                println!("test {name} ... skipped: {why}");
            }
            Err(_) => {
                failed += 1;
                println!("test {name} ... FAILED");
            }
        }
    }
    let result = if failed == 0 { "ok" } else { "FAILED" };
    println!("\ntest result: {result}. {passed} passed; {failed} failed; {skipped} skipped\n");
    if failed == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
