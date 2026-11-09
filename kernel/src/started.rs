//! What an environment hands back for each program it starts (ADR 0090,
//! decision 3; ADR 0084, plan step 1): the program, with its pipes and its
//! end, and the handle that stops it and what it started. A module stops
//! its programs only through it: git, a terminal's program, a Harness's on
//! pipes. The git module's bookkeeping git, run on the host, starts as one
//! too ([`Started::spawn`]).
//!
//! How a program is held and stopped is the system's own, in a file of its
//! own:
//! - On Unix a program leads a process group of its own, so a request to
//!   stop (TERM) and a kill (KILL) reach what it started too. One on a
//!   terminal hears a hangup (HUP) before the request, as when its
//!   terminal closes.
//! - On Windows a program is born in a Job Object of its own, which a kill
//!   ends with all in it. Windows has no TERM: a program on pipes is asked
//!   to stop by its holder closing its stdin, so asked here it is killed.

#[cfg(unix)]
mod unix;
#[cfg(not(unix))]
mod windows;

#[cfg(unix)]
use unix::Process;
#[cfg(not(unix))]
use windows::Process;

use std::io;
use std::process::{ExitStatus, Output};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
#[cfg(unix)]
use tokio::process::Child;
use tokio::process::{ChildStderr, ChildStdin, ChildStdout, Command};

/// A program's pipes, as it starts: what it reads, prints and says on
/// stderr, each when it is piped.
type Pipes = (Option<ChildStdin>, Option<ChildStdout>, Option<ChildStderr>);

/// A program an environment started, and the handle that stops it and what
/// it started. Its pipes are taken from it, as a child's are. Let go of, a
/// program started on pipes is killed: alone on Unix, where what it started
/// is killed only by [`Started::kill`], and with its Job Object on Windows.
/// One on a terminal outlives it.
#[derive(Debug)]
pub struct Started {
    process: Process,
    /// What it reads, when the engine writes to it.
    pub stdin: Option<ChildStdin>,
    /// What it prints, when the engine reads it.
    pub stdout: Option<ChildStdout>,
    /// What it says on stderr, when the engine reads it.
    pub stderr: Option<ChildStderr>,
    /// What goes with it, let go of as it is ([`Started::holding`]).
    held: Option<Held>,
}

/// What a [`Started`] holds for whoever started it, only to drop it with
/// it.
struct Held(#[expect(dead_code, reason = "only dropped")] Box<dyn Send + Sync>);

impl std::fmt::Debug for Held {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Held")
    }
}

impl Started {
    /// Starts `command` on the host, as the engine's own child: on Unix it
    /// leads a process group of its own, and on Windows it is born in a Job
    /// Object of its own. It is killed once let go of.
    pub fn spawn(command: Command) -> io::Result<Started> {
        Ok(Started::of(Process::spawn(command)?))
    }

    /// `child`, which an environment started on a terminal, as the leader
    /// of a session of its own there: asked to stop, it hears the hangup
    /// first. Unix's: a ConPTY's program is started otherwise (ADR 0090,
    /// step 7).
    #[cfg(unix)]
    pub fn on_terminal(child: Child) -> Started {
        Started::of(Process::on_terminal(child))
    }

    fn of(mut process: Process) -> Started {
        let (stdin, stdout, stderr) = process.pipes();
        Started {
            process,
            stdin,
            stdout,
            stderr,
            held: None,
        }
    }

    /// It, holding `held` till it is let go of: as the engine's note that
    /// it runs, which goes once the engine no longer holds it.
    pub fn holding(mut self, held: impl Send + Sync + 'static) -> Started {
        self.held = Some(Held(Box::new(held)));
        self
    }

    /// Its number, until it ended and was waited for.
    pub fn id(&self) -> Option<u32> {
        self.process.id()
    }

    /// Waits for it to end. What it reads closes first, as a child's does.
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        drop(self.stdin.take());
        self.process.wait().await
    }

    /// Waits for it to end, with all it printed on stdout and stderr.
    pub async fn wait_with_output(mut self) -> io::Result<Output> {
        drop(self.stdin.take());
        let (stdout, stderr) = (self.stdout.take(), self.stderr.take());
        let (status, stdout, stderr) =
            tokio::try_join!(self.process.wait(), all_of(stdout), all_of(stderr))?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    }

    /// Asks it and what it started to stop, while it runs: TERM to its
    /// group on Unix, with HUP before it on a terminal. On Windows, which
    /// has no TERM, its Job Object ends: a Harness's adapter is asked by
    /// its stdin closing, which its holder closes.
    pub fn ask_to_stop(&mut self) {
        self.process.ask_to_stop();
    }

    /// Kills it and what it started, even once it ended: a launcher, as
    /// `npx`, may have ended while what it started holds its pipes. On
    /// Unix that is KILL to its group, whose number is another's only once
    /// all of it ended, so a holder kills soon after it ended or not at
    /// all. On Windows its Job Object ends, with all in it.
    pub fn kill(&mut self) {
        self.process.kill();
    }

    /// Stops it and what it started: asked first, killed if it has not
    /// ended within `grace`. Waits till it has ended.
    pub async fn stop(&mut self, grace: Duration) -> io::Result<ExitStatus> {
        self.ask_to_stop();
        if let Ok(ended) = tokio::time::timeout(grace, self.wait()).await {
            return ended;
        }
        self.kill();
        self.wait().await
    }
}

/// All `pipe` says, to its end: nothing, when it is not there.
async fn all_of(pipe: Option<impl AsyncRead + Unpin>) -> io::Result<Vec<u8>> {
    let mut all = Vec::new();
    if let Some(mut pipe) = pipe {
        pipe.read_to_end(&mut all).await?;
    }
    Ok(all)
}
