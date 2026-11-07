//! The `local` environment runs a program on the host as Banda always
//! has (ADR 0084, decision 1): in its folder, with the engine's
//! environment less what it takes away and plus what it adds, leading a
//! process group of its own on pipes, or a session of its own on a PTY.
#![cfg(unix)]

use banda_environments::{Asked, How};
use banda_environments::{Local, Recorded};
use banda_kernel::{Environment, Input, Program};
use rustix::process::{Pid, getpgid, getsid};
use std::collections::BTreeMap;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// `/bin/sh -c script` in `cwd`, with `ADDED` added, and `HOME` and
/// `ADDED` taken away first.
fn sh(script: &str, cwd: &std::path::Path) -> Program {
    Program {
        program: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), script.to_owned()],
        env: BTreeMap::from([("ADDED".to_owned(), "yes".to_owned())]),
        unset: vec!["HOME".to_owned(), "ADDED".to_owned()],
        cwd: Some(cwd.to_owned()),
    }
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
    let folder = tempfile::tempdir().unwrap();
    let program = sh("echo $$; sleep 30", folder.path());
    let mut child = Local.spawn(&program, Input::Null).unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let pid: i32 = stdout.next_line().await.unwrap().unwrap().parse().unwrap();
    drop(child);
    // Once killed, it ends: gone, or waiting to be reaped.
    let stat = format!("/proc/{pid}/stat");
    for _ in 0..500 {
        match std::fs::read_to_string(&stat) {
            Err(_) => return,
            Ok(said)
                if said
                    .rsplit_once(") ")
                    .is_some_and(|(_, rest)| rest.starts_with('Z')) =>
            {
                return;
            }
            Ok(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
        }
    }
    panic!("{pid} still runs");
}

#[tokio::test]
async fn a_program_on_a_terminal_leads_its_session_there() {
    let folder = tempfile::tempdir().unwrap();
    let (pty, pts) = pty_process::open().unwrap();
    pty.resize(pty_process::Size::new(24, 80)).unwrap();
    let program = sh(
        "echo $$; pwd; echo \"$ADDED\"; tty -s && echo on-a-terminal; sleep 1",
        folder.path(),
    );
    let child = Local.pty(&program, pts).unwrap();
    let (mut output, _input) = pty.into_split();
    let mut said = String::new();
    let mut buffer = [0; 1024];
    while !said.contains("on-a-terminal") {
        let read = output.read(&mut buffer).await.unwrap();
        assert!(read > 0, "{said:?}");
        said.push_str(&String::from_utf8_lossy(&buffer[..read]));
    }
    let lines: Vec<&str> = said.lines().map(str::trim).collect();
    let pid = Pid::from_raw(lines[0].parse().unwrap()).unwrap();
    assert_eq!(getsid(Some(pid)).unwrap(), pid, "it leads its session");
    let folder = std::fs::canonicalize(folder.path()).unwrap();
    assert_eq!(lines[1], folder.display().to_string());
    assert_eq!(lines[2], "yes");
    drop(child);
}

#[tokio::test]
async fn a_recorded_environment_says_what_it_was_asked_and_starts_it() {
    let folder = tempfile::tempdir().unwrap();
    let recorded = Recorded::new(Local);
    let asks = recorded.asks();
    let program = sh("echo started", folder.path());
    let child = recorded.spawn(&program, Input::Null).unwrap();
    let ended = child.wait_with_output().await.unwrap();
    assert_eq!(ended.stdout, b"started\n");
    let asked = Asked {
        how: How::Spawn,
        program,
    };
    assert_eq!(asks.all(), std::slice::from_ref(&asked));
    assert_eq!(asks.of("sh"), [asked]);
    assert_eq!(asks.of("git"), []);
}
