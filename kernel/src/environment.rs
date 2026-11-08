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
//! Each program comes back with the handle that stops it and what it
//! started ([`Started`]), and one on a terminal with the terminal, the
//! port's own ([`Pty`]): a module holds no system's process or terminal
//! (ADR 0090, decision 3).
//!
//! Each program says whose it is ([`Whose`]): a Harness's is one to start
//! behind the fence, which keeps Banda's own state out of its reach, with
//! the [`Holes`] its Project has in it; the Person's own, a terminal or a
//! git act, is one to start outside it (ADR 0083, decision 1). The engine
//! says so as it makes the program, through the constructor of whose it
//! is, and nowhere else, so a program has holes exactly when it is one to
//! fence.
//!
//! On Windows (ADR 0090) each program is born in a Job Object, which
//! stopping it ends with all in it, and no program starts on a terminal,
//! until ConPTY (step 7).

use crate::{Pty, PtySize, Started};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use ts_rs::TS;

/// A program with its arguments, never a shell line, what it changes of
/// the environment it starts in, and the folder it starts in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
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
    /// Whose program it is. It is the engine's to say, never a client's:
    /// it goes in no frame, and a program read from one is a Harness's
    /// with no holes, the most fenced.
    #[ts(skip)]
    #[serde(skip, default = "Whose::told")]
    whose: Whose,
    /// The holes it has in the fence, which [`Program::holes`] says only
    /// when it is one to start behind it.
    #[ts(skip)]
    #[serde(skip)]
    holes: Holes,
}

/// Whose a [`Program`] is (ADR 0083, decision 1), which its environment
/// knows as it starts it: a Harness's is one to start behind the fence,
/// and the Person's own, which a gesture of theirs starts, outside it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Whose {
    /// A Harness's process: its adapter and all it starts, its CLI, the
    /// shells its Agents run commands in and their `banda mcp`.
    Harness,
    /// A Harness's CLI asked about itself, as its version or an account's
    /// limits.
    HarnessProbe,
    /// A terminal the Person opened, a Harness's sign-in among them.
    Terminal,
    /// A git act the Person asked for, as a commit or a push, which runs
    /// the repository's hooks as their own git does.
    Act,
}

impl Whose {
    /// Whether a program of it is one to start behind the fence.
    pub fn fenced(self) -> bool {
        matches!(self, Whose::Harness | Whose::HarnessProbe)
    }

    /// Whose a program read from a frame is, which says nothing of it: a
    /// Harness's.
    fn told() -> Whose {
        Whose::Harness
    }
}

/// Where a program behind the fence reaches into the folders it hides
/// (ADR 0083, decision 1): holes in it, each a folder inside a hidden one,
/// as its Project's own data. What the fence leaves in sight, the Person's
/// home and the Project's folder in it, needs no hole.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Holes {
    /// Folders it reads and writes, as Claude Code's sessions of its
    /// Project.
    pub writes: Vec<PathBuf>,
    /// Folders it only reads, as the files its Project keeps for messages.
    pub reads: Vec<PathBuf>,
    /// Whether it reaches the Person's SSH agent, through a hole for the
    /// agent's socket where the session has one: only a Harness's process
    /// in a Project whose trust the Person said (ADR 0083, F0-3). Without
    /// it no socket is bound, and [`SSH_AGENT`] is unset.
    pub ssh_agent: bool,
}

/// The variable that names the SSH agent's socket.
pub const SSH_AGENT: &str = "SSH_AUTH_SOCK";

impl Program {
    /// A Harness's process, `program` with `args`, to start behind the
    /// fence with `holes` in it: its Project's, or none for the machine's.
    pub fn harness(program: impl Into<String>, args: Vec<String>, holes: Holes) -> Program {
        Program::of(Whose::Harness, program, args, holes)
    }

    /// A Harness's CLI, `program` with `args`, asked about itself: to start
    /// behind the fence, with no holes in it.
    pub fn harness_probe(program: impl Into<String>, args: Vec<String>) -> Program {
        Program::of(Whose::HarnessProbe, program, args, Holes::default())
    }

    /// The program of a terminal the Person opened: to start outside the
    /// fence.
    pub fn terminal(program: impl Into<String>, args: Vec<String>) -> Program {
        Program::of(Whose::Terminal, program, args, Holes::default())
    }

    /// A git act the Person asked for: to start outside the fence.
    pub fn act(program: impl Into<String>, args: Vec<String>) -> Program {
        Program::of(Whose::Act, program, args, Holes::default())
    }

    fn of(whose: Whose, program: impl Into<String>, args: Vec<String>, holes: Holes) -> Program {
        Program {
            program: program.into(),
            args,
            env: BTreeMap::new(),
            unset: Vec::new(),
            cwd: None,
            whose,
            holes,
        }
    }

    /// Whose program it is.
    pub fn whose(&self) -> Whose {
        self.whose
    }

    /// The holes it has in the fence when it is one to start behind it;
    /// `None` when it is the Person's own.
    pub fn holes(&self) -> Option<&Holes> {
        self.whose.fenced().then_some(&self.holes)
    }
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
    /// stderr piped to the engine. On Unix it leads a process group of its
    /// own. It is killed once its holder lets go of it.
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Started>;

    /// Opens a terminal of `size` and starts `program` on it, which it
    /// reads and writes on all three of its streams: on Unix as the leader
    /// of a session of its own whose controlling terminal it is. It
    /// outlives its holder: it hears the hangup once the terminal closes.
    fn pty(&self, program: &Program, size: PtySize) -> io::Result<(Started, Pty)>;

    /// Whether the fence around a Harness's programs holds here, as it
    /// was found when the environment was made. One that says nothing has
    /// none.
    fn fence(&self) -> crate::Fence {
        crate::Fence::not_built()
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
    fn spawn(&self, program: &Program, _: Input) -> io::Result<Started> {
        Err(Nowhere::refused(program))
    }

    fn pty(&self, program: &Program, _: PtySize) -> io::Result<(Started, Pty)> {
        Err(Nowhere::refused(program))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_has_holes_exactly_when_it_is_one_to_fence() {
        let holes = Holes {
            writes: vec![PathBuf::from("/data/sessions/claude")],
            reads: vec![PathBuf::from("/data/files")],
            ssh_agent: true,
        };
        let made = [
            Program::harness("adapter", vec![], holes.clone()),
            Program::harness_probe("claude", vec!["--version".to_owned()]),
            Program::terminal("sh", vec![]),
            Program::act("make", vec!["all".to_owned()]),
        ];
        let whose = [
            Whose::Harness,
            Whose::HarnessProbe,
            Whose::Terminal,
            Whose::Act,
        ];
        assert_eq!(made.each_ref().map(Program::whose), whose);
        let none = Holes::default();
        let had = made.each_ref().map(Program::holes);
        assert_eq!(had, [Some(&holes), Some(&none), None, None]);
    }

    #[test]
    fn whose_a_program_is_goes_in_no_frame_and_one_read_from_a_frame_is_fenced() {
        let mut program = Program::terminal("sh", vec!["-l".to_owned()]);
        program.cwd = Some(PathBuf::from("/work"));
        let said = serde_json::to_value(&program).unwrap();
        let shown =
            serde_json::json!({ "program": "sh", "args": ["-l"], "env": {}, "cwd": "/work" });
        assert_eq!(said, shown);

        let read: Program = serde_json::from_value(said).unwrap();
        assert_eq!(read.whose(), Whose::Harness);
        assert_eq!(read.holes(), Some(&Holes::default()));
    }
}
