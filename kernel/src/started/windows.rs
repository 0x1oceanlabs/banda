//! A program on Windows (ADR 0090, decision 3), born in a Job Object of its
//! own through `process-wrap`: it starts suspended, is put in its Job
//! Object, and only then runs, so nothing it starts is ever outside it.
//! Ending the Job Object kills the program and all it started: npm's CLIs
//! are `.cmd`s, and killing `cmd.exe` alone would leave `node.exe`
//! running, as Git for Windows' `git.exe` on PATH starts the real one.
//!
//! - No program in it may leave it: its Job Object allows no breaking
//!   away, so a Node, which puts its children in a Job Object they may
//!   silently leave, cannot let a tool an Agent started outlive Banda's.
//! - It ends as its last handle closes: when this is let go of, and when
//!   the engine ends, however it ends.
//! - It shares the engine's hidden console and leads a process group of
//!   its own (`host::hide`).
//!
//! Windows has no TERM. A program on pipes is asked to stop by its holder
//! closing its stdin, as a Harness's adapter stops then; asked here, it is
//! killed with all it started, as git is.

use super::Pipes;
use process_wrap::tokio::{ChildWrapper, CommandWrap, CreationFlags, JobObject, KillOnDrop};
use std::io;
use std::process::ExitStatus;
use tokio::process::Command;

/// A program on Windows, in a Job Object of its own.
#[derive(Debug)]
pub(super) struct Process {
    /// The program, under its Job Object.
    child: Box<dyn ChildWrapper>,
}

impl Process {
    /// Starts `command` in a Job Object of its own, which ends as it is let
    /// go of.
    pub(super) fn spawn(command: Command) -> io::Result<Process> {
        let mut wrapped = CommandWrap::from(command);
        // The flags go through process-wrap, which adds its own to them.
        (wrapped.wrap(CreationFlags(crate::host::FLAGS)))
            .wrap(JobObject)
            .wrap(KillOnDrop);
        Ok(Process {
            child: wrapped.spawn()?,
        })
    }

    pub(super) fn pipes(&mut self) -> Pipes {
        let child = &mut self.child;
        (
            child.stdin().take(),
            child.stdout().take(),
            child.stderr().take(),
        )
    }

    pub(super) fn id(&self) -> Option<u32> {
        self.child.id()
    }

    /// Waits for the program itself to end, as on Unix: what it started
    /// ends with its Job Object ([`Process::kill`]), maybe a moment after
    /// it. Nothing here waits for all in the Job Object to end:
    /// `process-wrap`'s own wait returns at the Job Object's first message,
    /// which may say a program joined it, not that the last one ended. What
    /// needs all of it gone after a kill tries again while it goes, as
    /// git's lock taken away does (`host::remove_left`).
    pub(super) async fn wait(&mut self) -> io::Result<ExitStatus> {
        // Under the Job Object's own wrapper is the program's.
        self.child.inner_mut().wait().await
    }

    pub(super) fn ask_to_stop(&mut self) {
        self.kill();
    }

    /// Ends its Job Object: it and all it started are killed, even once it
    /// ended, as a launcher may end while what it started runs on.
    pub(super) fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use crate::Started;
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::{AsyncRead, AsyncReadExt};
    use tokio::process::{ChildStdout, Command};

    /// How long a program the tests start would run if nothing ended it.
    const LONG: &str = "30";
    /// How soon its pipe closes once it is ended.
    const SOON: Duration = Duration::from_secs(10);

    /// `cmd.exe` running `ping` for [`LONG`] seconds: `ping` is a program
    /// the started one started, and holds its stdout too.
    fn launcher() -> Command {
        let mut command = Command::new("cmd.exe");
        command
            .args(["/d", "/c", "ping", "-n", LONG, "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command
    }

    /// Its stdout, once it said something: by then `ping` runs.
    async fn running(started: &mut Started) -> ChildStdout {
        let mut stdout = started.stdout.take().unwrap();
        let mut first = [0; 1];
        stdout.read_exact(&mut first).await.unwrap();
        stdout
    }

    /// Whether `stdout` closes soon: whether all that held it ended.
    async fn closes(mut stdout: impl AsyncRead + Unpin) -> bool {
        let mut rest = Vec::new();
        let read = stdout.read_to_end(&mut rest);
        tokio::time::timeout(SOON, read).await.is_ok()
    }

    #[tokio::test]
    async fn killed_or_asked_to_stop_it_ends_with_all_it_started() {
        for asked in [false, true] {
            let mut started = Started::spawn(launcher()).unwrap();
            let stdout = running(&mut started).await;
            match asked {
                true => started.ask_to_stop(),
                false => started.kill(),
            }
            assert!(closes(stdout).await, "ping outlived its Job Object");
            let ended = started.wait().await.unwrap();
            assert!(!ended.success());
            // Once it ended, both do nothing.
            started.ask_to_stop();
            started.kill();
        }
    }

    #[tokio::test]
    async fn let_go_of_it_ends_with_all_it_started() {
        let mut started = Started::spawn(launcher()).unwrap();
        let stdout = running(&mut started).await;
        drop(started);
        assert!(closes(stdout).await, "ping outlived its Job Object");
    }

    #[tokio::test]
    async fn a_launcher_that_ended_leaves_nothing_once_killed() {
        // `start /b` leaves `ping` running as `cmd.exe` ends.
        let mut command = Command::new("cmd.exe");
        command
            .args(["/d", "/c", "start", "/b", "ping", "-n", LONG, "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut started = Started::spawn(command).unwrap();
        let stdout = running(&mut started).await;
        let ended = tokio::time::timeout(SOON, started.wait()).await;
        assert!(ended.is_ok(), "the launcher itself ended");
        started.kill();
        assert!(closes(stdout).await, "ping outlived its Job Object");
    }

    /// What the test below starts in its Job Object: this test itself,
    /// which starts `ping` asking to break away from it.
    const BREAKING_AWAY: &str = "BANDA_TEST_BREAKING_AWAY";

    #[tokio::test]
    async fn nothing_it_starts_leaves_its_job_object() {
        use std::os::windows::process::CommandExt;
        use windows::Win32::System::Threading::CREATE_BREAKAWAY_FROM_JOB;
        if std::env::var_os(BREAKING_AWAY).is_some() {
            // Windows refuses it, or the program starts in the Job Object
            // all the same.
            let started = std::process::Command::new("ping.exe")
                .args(["-n", LONG, "127.0.0.1"])
                .creation_flags(CREATE_BREAKAWAY_FROM_JOB.0)
                .spawn();
            println!("broke away: {}", started.is_ok());
            return;
        }
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["started::windows::tests::nothing_it_starts_leaves_its_job_object"])
            .args(["--exact", "--nocapture"])
            .env(BREAKING_AWAY, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut started = Started::spawn(command).unwrap();
        let stdout = running(&mut started).await;
        let ended = started.wait().await.unwrap();
        assert!(ended.success(), "the test it ran passed");
        started.kill();
        assert!(closes(stdout).await, "ping left the Job Object");
    }
}
