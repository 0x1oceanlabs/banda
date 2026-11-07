//! The `local` environment runs a program on the host as Banda always
//! has (ADR 0084, decision 1): in its folder, with the engine's
//! environment less what it takes away and plus what it adds, leading a
//! process group of its own on pipes, or a session of its own on a PTY.
//! A terminal's program starts only on a terminal, and a Harness's never
//! on one (ADR 0083, decision 1). What it hands back stops the program
//! and what it started (ADR 0090, decision 3).
#![cfg(unix)]

use banda_environments::{Asked, How};
use banda_environments::{Local, Recorded};
use banda_kernel::{Environment, Holes, Input, Program, Pty, PtySize, Whose};
use rustix::process::{Pid, getpgid, getsid};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::time::timeout;

/// The size a test's terminal opens at.
const SIZE: PtySize = PtySize { rows: 24, cols: 80 };
/// How long a test waits for what should come at once.
const SOON: Duration = Duration::from_secs(5);

/// `/bin/sh -c script` as the Person's own runs on pipes, a git act's, as
/// [`changed`] says.
fn sh(script: &str, cwd: &Path) -> Program {
    changed(Program::act("/bin/sh", args(script)), cwd)
}

/// `program` in `cwd`, with `ADDED` added, and `HOME` and `ADDED` taken
/// away first.
fn changed(mut program: Program, cwd: &Path) -> Program {
    program.env = BTreeMap::from([("ADDED".to_owned(), "yes".to_owned())]);
    program.unset = vec!["HOME".to_owned(), "ADDED".to_owned()];
    program.cwd = Some(cwd.to_owned());
    program
}

fn args(script: &str) -> Vec<String> {
    vec!["-c".to_owned(), script.to_owned()]
}

const SAYS: &str =
    "echo $$; pwd; echo \"$ADDED\"; echo \"${HOME-none}\"; read line; echo \"$line\"";

#[tokio::test]
async fn a_program_runs_in_its_folder_with_what_it_changes_and_a_group_of_its_own() {
    let folder = tempfile::tempdir().unwrap();
    let mut child = Local.spawn(&sh(SAYS, folder.path()), Input::Piped).unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let pid: i32 = stdout.next_line().await.unwrap().unwrap().parse().unwrap();
    let pid = Pid::from_raw(pid).unwrap();
    assert_eq!(getpgid(Some(pid)).unwrap(), pid, "it leads its group");

    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"typed\n").await.unwrap();
    let mut said = String::new();
    stdout.into_inner().read_to_string(&mut said).await.unwrap();
    let folder = std::fs::canonicalize(folder.path()).unwrap();
    assert_eq!(said, format!("{}\nyes\nnone\ntyped\n", folder.display()));
    assert!(child.wait().await.unwrap().success());
}

#[tokio::test]
async fn a_program_with_nothing_to_read_reads_an_end() {
    let folder = tempfile::tempdir().unwrap();
    let program = sh("cat; echo done >&2", folder.path());
    let child = Local.spawn(&program, Input::Null).unwrap();
    let ended = child.wait_with_output().await.unwrap();
    assert_eq!(
        (&ended.stdout[..], &ended.stderr[..]),
        (&b""[..], &b"done\n"[..])
    );
}

/// Read in `/proc`, Linux's.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn a_program_let_go_of_is_killed() {
    let (started, pid, _said) = leaves("echo $$; sleep 30").await;
    drop(started);
    gone(pid).await;
}

/// What `pty` printed, up to and with `end`.
async fn printed(pty: &mut Pty, said: &mut String, end: &str) {
    let mut buffer = [0; 1024];
    while !said.contains(end) {
        let read = timeout(SOON, pty.output.read(&mut buffer)).await;
        let read = read.expect("it prints soon").unwrap();
        assert!(read > 0, "{said:?}");
        said.push_str(&String::from_utf8_lossy(&buffer[..read]));
    }
}

#[tokio::test]
async fn a_program_on_a_terminal_leads_its_session_there() {
    let folder = tempfile::tempdir().unwrap();
    let script = "echo $$; pwd; echo \"$ADDED\"; stty size; tty -s && echo on-a-terminal; \
        read line; stty size; echo resized";
    let program = changed(Program::terminal("/bin/sh", args(script)), folder.path());
    let (mut started, mut pty) = Local.pty(&program, SIZE).unwrap();
    let mut said = String::new();
    printed(&mut pty, &mut said, "on-a-terminal").await;
    let lines: Vec<&str> = said.lines().map(str::trim).collect();
    let pid = Pid::from_raw(lines[0].parse().unwrap()).unwrap();
    assert_eq!(getsid(Some(pid)).unwrap(), pid, "it leads its session");
    assert_eq!(started.id(), u32::try_from(pid.as_raw_pid()).ok());
    assert_eq!(pty.control.front(), started.id(), "it is in front");
    let folder = std::fs::canonicalize(folder.path()).unwrap();
    assert_eq!(lines[1], folder.display().to_string());
    assert_eq!(lines[2], "yes");
    assert_eq!(lines[3], "24 80");

    pty.control
        .resize(PtySize {
            rows: 30,
            cols: 100,
        })
        .unwrap();
    pty.input.write_all(b"\n").await.unwrap();
    printed(&mut pty, &mut said, "resized").await;
    assert!(said.contains("30 100"), "{said:?}");
    assert!(started.wait().await.unwrap().success());
}

/// The PTY's own end stays the engine's: a program started after a
/// terminal opened, as an Agent's, could otherwise type into it. Read in
/// `/proc`, Linux's.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn no_program_started_after_a_terminal_gets_its_pty() {
    let shell = Program::terminal("/bin/sh", args("sleep 5"));
    let (shell, _pty) = Local.pty(&shell, SIZE).unwrap();
    let on = std::fs::read_link(format!("/proc/{}/fd/0", shell.id().unwrap())).unwrap();
    let number = on.file_name().unwrap().to_string_lossy().into_owned();
    assert!(ptys("self").contains(&number), "the engine holds {on:?}");
    let later = Program::act("/bin/sh", args("sleep 5"));
    let later = Local.spawn(&later, Input::Null).unwrap();
    let theirs = ptys(&later.id().unwrap().to_string());
    assert!(!theirs.contains(&number), "it holds {on:?}'s other end");
}

/// The PTYs `process` holds the engine's end of, each by its number, as
/// in `/dev/pts/<number>`: so a test knows its own from another's opened
/// at the same time. Read in `/proc`, Linux's.
#[cfg(target_os = "linux")]
fn ptys(process: &str) -> Vec<String> {
    let fds = std::fs::read_dir(format!("/proc/{process}/fd")).unwrap();
    let held = |fd: std::fs::DirEntry| {
        let to = std::fs::read_link(fd.path()).ok()?;
        if !to.ends_with("ptmx") {
            return None;
        }
        let info = format!("/proc/{process}/fdinfo/{}", fd.file_name().display());
        let info = std::fs::read_to_string(info).ok()?;
        let number = info
            .lines()
            .find_map(|line| line.strip_prefix("tty-index:"))?;
        Some(number.trim().to_owned())
    };
    fds.flatten().filter_map(held).collect()
}

#[tokio::test]
async fn a_recorded_environment_says_what_it_was_asked_and_starts_it() {
    let folder = tempfile::tempdir().unwrap();
    let recorded = Recorded::new(Local);
    let asks = recorded.asks();
    let harness_s = Program::harness("/bin/sh", args("echo started"), Holes::default());
    let program = changed(harness_s, folder.path());
    let child = recorded.spawn(&program, Input::Null).unwrap();
    let ended = child.wait_with_output().await.unwrap();
    assert_eq!(ended.stdout, b"started\n");
    let asked = Asked {
        how: How::Spawn,
        program,
    };
    assert_eq!(asks.all(), std::slice::from_ref(&asked));
    let whose = &asks.all()[0].program;
    assert_eq!(
        (whose.whose(), whose.holes()),
        (Whose::Harness, Some(&Holes::default()))
    );
    assert_eq!(asks.of("sh"), [asked]);
    assert_eq!(asks.of("git"), []);
}

#[tokio::test]
async fn a_harness_s_program_never_starts_on_a_terminal_nor_a_terminal_s_on_pipes() {
    let folder = tempfile::tempdir().unwrap();
    let marked = folder.path().join("ran");
    let script = format!("touch '{}'", marked.display());
    let harness_s = [
        Program::harness("/bin/sh", args(&script), Holes::default()),
        Program::harness_probe("/bin/sh", args(&script)),
    ];
    for program in harness_s {
        let refused = Local.pty(&program, SIZE).unwrap_err();
        assert_eq!(refused.kind(), std::io::ErrorKind::PermissionDenied);
        assert!(
            refused.to_string().contains("behind the fence"),
            "{refused}"
        );
    }
    let terminal_s = Program::terminal("/bin/sh", args(&script));
    let refused = Local.spawn(&terminal_s, Input::Null).unwrap_err();
    assert_eq!(refused.kind(), std::io::ErrorKind::PermissionDenied);
    assert!(refused.to_string().contains("on a terminal"), "{refused}");
    assert!(!marked.exists(), "none of them ran");

    let (mut ran, _pty) = Local.pty(&terminal_s, SIZE).unwrap();
    assert!(ran.wait().await.unwrap().success());
    assert!(marked.exists(), "a terminal's starts on one");
}

/// Whether `pid` still runs: one killed may stay a zombie a moment, till
/// it is reaped. Read in `/proc`, Linux's.
#[cfg(target_os = "linux")]
fn runs(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
        let state = stat.rsplit_once(") ").map_or("", |(_, rest)| rest);
        !state.starts_with('Z')
    })
}

#[cfg(target_os = "linux")]
async fn gone(pid: u32) {
    let ending = async {
        while runs(pid) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    timeout(SOON, ending).await.expect("it ended");
}

/// `script` started on pipes, the process number it says first, and the
/// rest of what it says.
#[cfg(target_os = "linux")]
async fn leaves(script: &str) -> (banda_kernel::Started, u32, impl AsyncBufReadExt) {
    let mut started = Local
        .spawn(&sh(script, Path::new("/")), Input::Null)
        .unwrap();
    let mut said = BufReader::new(started.stdout.take().unwrap());
    let mut line = String::new();
    said.read_line(&mut line).await.unwrap();
    (started, line.trim().parse().unwrap(), said)
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn a_program_asked_to_stop_and_what_it_started_hear_it() {
    let script = "trap 'echo asked; exit 3' TERM; sleep 30 & echo $!; wait";
    let (mut started, sleep, mut said) = leaves(script).await;
    started.ask_to_stop();
    let ended = timeout(SOON, started.wait()).await.unwrap().unwrap();
    assert_eq!(ended.code(), Some(3));
    let mut rest = String::new();
    said.read_to_string(&mut rest).await.unwrap();
    assert_eq!(rest, "asked\n");
    gone(sleep).await;
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn a_program_killed_ends_with_what_it_started_though_they_would_not_stop() {
    use std::os::unix::process::ExitStatusExt;
    let (mut started, sleep, _said) = leaves("trap '' TERM; sleep 30 & echo $!; wait").await;
    started.ask_to_stop();
    let waited = timeout(Duration::from_millis(300), started.wait()).await;
    assert!(waited.is_err() && runs(sleep), "they go on");
    started.kill();
    let ended = timeout(SOON, started.wait()).await.unwrap().unwrap();
    assert_eq!(ended.signal(), Some(9));
    gone(sleep).await;
}

/// As a launcher such as `npx` may: it ends, and what it started goes on.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn what_a_program_left_running_is_killed_after_it_ended() {
    let (mut started, sleep, _said) = leaves("sleep 30 & echo $!").await;
    assert!(started.wait().await.unwrap().success());
    assert!(runs(sleep), "it goes on");
    started.kill();
    gone(sleep).await;
}

/// Asked to stop, a terminal's program hears the hangup first, as when
/// its terminal closes, then the request.
#[tokio::test]
async fn a_program_on_a_terminal_asked_to_stop_hears_the_hangup_first() {
    let script = "trap 'echo hung-up' HUP; trap 'echo asked; exit 4' TERM; echo ready; \
        while :; do sleep 0.05; done";
    let program = Program::terminal("/bin/sh", args(script));
    let (mut started, mut pty) = Local.pty(&program, SIZE).unwrap();
    let mut said = String::new();
    printed(&mut pty, &mut said, "ready").await;
    started.ask_to_stop();
    printed(&mut pty, &mut said, "asked").await;
    let ended = timeout(SOON, started.wait()).await.unwrap().unwrap();
    assert_eq!(ended.code(), Some(4));
    let heard = said.find("hung-up").expect("it heard the hangup");
    assert!(heard < said.find("asked").unwrap(), "{said:?}");
}
