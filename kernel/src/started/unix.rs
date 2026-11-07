//! A program on Unix: the leader of a process group of its own, stopped
//! by signals to that group.

use super::Pipes;
use rustix::process::{Pid, Signal, kill_process_group};
use std::io;
use std::process::ExitStatus;
use tokio::process::{Child, Command};

/// A program on Unix, and the group it leads.
#[derive(Debug)]
pub(super) struct Process {
    child: Child,
    /// The process group it leads, by its number as it started: a signal
    /// to it reaches what the program started too.
    group: Option<Pid>,
    /// It leads a session on a terminal, and hears its hangup.
    terminal: bool,
}

impl Process {
    /// Starts `command` as the leader of a process group of its own,
    /// killed once let go of.
    pub(super) fn spawn(mut command: Command) -> io::Result<Process> {
        let child = command.process_group(0).kill_on_drop(true).spawn()?;
        Ok(Process::of(child, false))
    }

    pub(super) fn on_terminal(child: Child) -> Process {
        Process::of(child, true)
    }

    fn of(child: Child, terminal: bool) -> Process {
        let leader = child.id().and_then(|id| i32::try_from(id).ok());
        Process {
            group: leader.and_then(Pid::from_raw),
            child,
            terminal,
        }
    }

    pub(super) fn pipes(&mut self) -> Pipes {
        let child = &mut self.child;
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    }

    pub(super) fn id(&self) -> Option<u32> {
        self.child.id()
    }

    pub(super) async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait().await
    }

    /// TERM to its group, with HUP before it on a terminal; nothing once it
    /// ended and was waited for.
    pub(super) fn ask_to_stop(&mut self) {
        if self.child.id().is_none() {
            return;
        }
        if self.group.is_none() {
            let _ = self.child.start_kill();
            return;
        }
        if self.terminal {
            self.signal(Signal::HUP);
        }
        self.signal(Signal::TERM);
    }

    /// KILL to its group, and to it, should it have left the group.
    pub(super) fn kill(&mut self) {
        self.signal(Signal::KILL);
        let _ = self.child.start_kill();
    }

    /// Sends `signal` to each process in its group; a group already gone
    /// stays so.
    fn signal(&self, signal: Signal) {
        if let Some(group) = self.group {
            let _ = kill_process_group(group, signal);
        }
    }
}
