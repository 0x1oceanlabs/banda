//! The `local` environment on Windows (ADR 0090): a program runs on pipes,
//! is killed once let go of, and its handle stops it, with its Job Object.
//! It is found as the host finds one, a `.cmd` by its name too, on the
//! PATH it names or the host's, and one not found does not start. No
//! program starts on a terminal until ConPTY (step 7), and it says so.
#![cfg(windows)]

use banda_environments::Local;
use banda_kernel::{Environment, Input, Program, PtySize};
use std::time::Duration;
use tokio::time::timeout;

/// How long a test waits for what should come at once.
const SOON: Duration = Duration::from_secs(10);

/// `cmd /c line`, as the Person's own runs on pipes, a git act's.
fn cmd(line: &str) -> Program {
    Program::act("cmd.exe", vec!["/c".to_owned(), line.to_owned()])
}

/// A program that runs for half a minute unless it is stopped.
fn lasting() -> Program {
    let args = ["-n", "30", "127.0.0.1"].map(str::to_owned);
    Program::act("ping.exe", args.to_vec())
}

#[tokio::test]
async fn a_program_runs_on_pipes_and_says_what_it_printed() {
    let started = Local.spawn(&cmd("echo started"), Input::Null).unwrap();
    let ended = timeout(SOON, started.wait_with_output()).await.unwrap();
    let ended = ended.unwrap();
    assert!(ended.status.success());
    assert_eq!(String::from_utf8_lossy(&ended.stdout).trim(), "started");
}

#[tokio::test]
async fn a_program_asked_to_stop_or_killed_ends() {
    for asked in [true, false] {
        let mut started = Local.spawn(&lasting(), Input::Null).unwrap();
        assert!(started.id().is_some());
        match asked {
            true => started.ask_to_stop(),
            false => started.kill(),
        }
        let ended = timeout(SOON, started.wait())
            .await
            .expect("it ends at once");
        assert!(!ended.unwrap().success());
        // Once it ended, both do nothing.
        started.ask_to_stop();
        started.kill();
    }
}

#[tokio::test]
async fn a_program_let_go_of_is_killed() {
    let started = Local.spawn(&lasting(), Input::Null).unwrap();
    let id = started.id().unwrap();
    assert!(runs(id).await, "it runs");
    drop(started);
    let ending = async {
        while runs(id).await {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    };
    timeout(SOON, ending).await.expect("it was killed");
}

/// Whether the process numbered `id` runs, as `tasklist` says.
async fn runs(id: u32) -> bool {
    let filter = format!("PID eq {id}");
    let args = ["/FI", &filter, "/NH", "/FO", "CSV"].map(str::to_owned);
    let asked = Program::act("tasklist.exe", args.to_vec());
    let listed = Local.spawn(&asked, Input::Null).unwrap();
    let listed = timeout(SOON, listed.wait_with_output()).await.unwrap();
    String::from_utf8_lossy(&listed.unwrap().stdout).contains(&format!("\"{id}\""))
}

#[tokio::test]
async fn no_program_starts_on_a_terminal_yet_and_it_says_so() {
    let folder = tempfile::tempdir().unwrap();
    let marked = folder.path().join("ran");
    let line = format!("echo ran > \"{}\"", marked.display());
    let program = Program::terminal("cmd.exe", vec!["/c".to_owned(), line]);
    let size = PtySize { rows: 24, cols: 80 };
    let refused = Local.pty(&program, size).unwrap_err();
    assert_eq!(refused.kind(), std::io::ErrorKind::Unsupported);
    assert!(
        refused.to_string().contains("not on Windows yet"),
        "{refused}"
    );
    assert!(!marked.exists(), "it did not run");
}

#[tokio::test]
async fn a_program_not_on_path_does_not_start_and_says_so() {
    let missing = Program::act("banda-no-such-program", Vec::new());
    let refused = Local.spawn(&missing, Input::Null).unwrap_err();
    assert_eq!(refused.kind(), std::io::ErrorKind::NotFound);
    assert!(refused.to_string().contains("is not on PATH"), "{refused}");
}

#[tokio::test]
async fn a_cmd_is_found_by_its_name_on_the_path_the_program_names() {
    let folder = tempfile::tempdir().unwrap();
    let script = "@echo off\r\necho hello %1\r\n";
    std::fs::write(folder.path().join("hello.cmd"), script).unwrap();
    let mut program = Program::act("hello", vec!["there".to_owned()]);
    let path = folder.path().display().to_string();
    program.env.insert("Path".to_owned(), path);
    let started = Local.spawn(&program, Input::Null).unwrap();
    let ended = timeout(SOON, started.wait_with_output()).await.unwrap();
    let ended = ended.unwrap();
    assert!(ended.status.success());
    assert_eq!(String::from_utf8_lossy(&ended.stdout).trim(), "hello there");
}

#[tokio::test]
async fn a_program_gets_the_host_s_path_unless_it_takes_it_away() {
    let said = |unset: bool| async move {
        let mut program = cmd("echo %PATH%");
        if unset {
            program.unset.push("PATH".to_owned());
        }
        let started = Local.spawn(&program, Input::Null).unwrap();
        let ended = timeout(SOON, started.wait_with_output()).await.unwrap();
        String::from_utf8_lossy(&ended.unwrap().stdout)
            .trim()
            .to_lowercase()
    };
    let path = said(false).await;
    assert!(path.contains("system32"), "{path}");
    // Found on the host's PATH all the same, and run with none.
    assert_eq!(said(true).await, "%path%");
}
