//! A program on Windows, which has neither process groups nor signals:
//! for now it is killed alone, as tokio kills a child, whether it is asked
//! to stop or killed.
//!
//! ADR 0090's step 3 replaces this file. Each program is born in a Job
//! Object of its own, and ending that kills what the program started too.
//! With no TERM, a program on pipes is asked to stop by its stdin closing,
//! which its module does (a Harness's adapter stops on it), and a
//! terminal's program by its ConPTY closing (step 7).

use super::Pipes;
use std::io;
use std::process::ExitStatus;
use tokio::process::{Child, Command};

/// A program on Windows, for now a child alone.
#[derive(Debug)]
pub(super) struct Process {
    child: Child,
}

impl Process {
    /// Starts `command`, killed once let go of.
    pub(super) fn spawn(mut command: Command) -> io::Result<Process> {
        let child = command.kill_on_drop(true).spawn()?;
        Ok(Process { child })
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

    pub(super) fn ask_to_stop(&mut self) {
        let _ = self.child.start_kill();
    }

    pub(super) fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}
