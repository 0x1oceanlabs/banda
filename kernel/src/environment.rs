//! Where a Project's programs run: the environment port (ADR 0084,
//! decision 1). Every program Banda starts for a Project, a Harness's
//! process, a terminal's or a git act the Person asked for, goes through
//! its [`Environment`], and no module starts one itself (decision 4). The
//! engine says which adapter that is as it builds the kernel
//! ([`KernelBuilder::environment`](crate::KernelBuilder::environment)); the
//! platform's `banda-environments` holds them, `local` first, which runs
//! a program on the host as Banda always has. What keeps Banda's books,
//! git's status for one, runs on the host and executes nothing of the
//! Project's, so it does not come here.
//!
//! A program leads a process group of its own wherever it starts, so
//! stopping the group stops what it started too ([`ProcessGroup`]).

use rustix::process::{Pid, Signal, kill_process_group};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use tokio::process::Child;
use ts_rs::TS;

/// A program with its arguments, never a shell line, what it changes of
/// the environment it starts in, and the folder it starts in.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Program {
    pub program: String,
    pub args: Vec<String>,
    /// What it adds to the environment it starts in.
    pub env: BTreeMap<String, String>,
    /// What it takes away from that environment before `env` adds: what
    /// the engine was told that is not for it.
    #[ts(as = "Option<Vec<String>>", optional)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unset: Vec<String>,
    /// The folder it starts in; the engine's own when none.
    #[ts(optional, type = "string")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<PathBuf>,
}

/// What a program [`Environment::spawn`] starts reads on its stdin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    /// Nothing: it reads an end at once.
    Null,
    /// What the engine writes to it.
    Piped,
}

/// Where a Project's programs run (ADR 0084, decision 1): the port, as
/// [`Identity`](crate::api::Identity) is the port that says who a
/// connection is. Each method starts one program, or says why it did not.
pub trait Environment: Send + Sync + 'static {
    /// Starts `program`, with its stdin as `input` says and its stdout and
    /// stderr piped to the engine. It leads a process group of its own,
    /// and is killed once its holder lets go of it.
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Child>;

    /// Starts `program` on the terminal `pts`, which it reads and writes
    /// on all three of its streams, as the leader of a session of its own
    /// whose controlling terminal `pts` is. It outlives its holder: it
    /// hears the hangup once the terminal closes.
    fn pty(&self, program: &Program, pts: pty_process::Pts) -> io::Result<Child>;
}

/// The process group a program an [`Environment`] started leads, named by
/// its leader's number: a signal to it reaches what the program started
/// too. Once the program ended and was waited for, that number may name
/// another process, so a holder signals it only while the program runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessGroup(Pid);

impl ProcessGroup {
    /// The group `child` leads, while it runs.
    pub fn of(child: &Child) -> Option<ProcessGroup> {
        let id = i32::try_from(child.id()?).ok()?;
        Pid::from_raw(id).map(ProcessGroup)
    }

    /// Sends `signal` to each process in it; a group already gone stays
    /// so.
    pub fn signal(self, signal: Signal) {
        let _ = kill_process_group(self.0, signal);
    }

    /// Its leader's number.
    pub fn leader(self) -> i32 {
        self.0.as_raw_pid()
    }
}

/// The environment of a kernel the engine gave none: it starts nothing. A
/// test whose modules start no program needs none.
pub(crate) struct Nowhere;

impl Nowhere {
    fn refused(program: &Program) -> io::Error {
        io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "{} could not start: this engine has no environment to start programs in.",
                program.program
            ),
        )
    }
}

impl Environment for Nowhere {
    fn spawn(&self, program: &Program, _: Input) -> io::Result<Child> {
        Err(Nowhere::refused(program))
    }

    fn pty(&self, program: &Program, _: pty_process::Pts) -> io::Result<Child> {
        Err(Nowhere::refused(program))
    }
}
