//! The `local` environment (ADR 0084, decision 1): a program runs on the
//! host, as the engine's own child, with the engine's environment less
//! what it takes away and plus what it adds.
//!
//! A program says whose it is ([`Whose`]): a Harness's is one to start
//! behind the fence (ADR 0083, decision 1), and a terminal is the
//! Person's, outside it. So a terminal's program starts only on a terminal,
//! and one to fence never does.

use banda_kernel::{Environment, Input, Program, Whose};
use std::io;
use std::process::Stdio;
use tokio::process::Child;

/// Runs a Project's programs on the host.
#[derive(Clone, Copy, Debug, Default)]
pub struct Local;

impl Environment for Local {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Child> {
        if program.whose() == Whose::Terminal {
            return Err(refused(
                program,
                "on pipes: a terminal's program starts on a terminal",
            ));
        }
        let mut command = tokio::process::Command::new(&program.program);
        command.args(&program.args);
        if let Some(cwd) = &program.cwd {
            command.current_dir(cwd);
        }
        for name in &program.unset {
            command.env_remove(name);
        }
        command
            .envs(&program.env)
            .stdin(match input {
                Input::Null => Stdio::null(),
                Input::Piped => Stdio::piped(),
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true);
        command.spawn()
    }

    fn pty(&self, program: &Program, pts: pty_process::Pts) -> io::Result<Child> {
        if program.whose().fenced() {
            let why = "on a terminal: a Harness's program starts only behind the fence";
            return Err(refused(program, why));
        }
        let mut command = pty_process::Command::new(&program.program).args(&program.args);
        if let Some(cwd) = &program.cwd {
            command = command.current_dir(cwd);
        }
        for name in &program.unset {
            command = command.env_remove(name);
        }
        command
            .envs(&program.env)
            .spawn(pts)
            .map_err(|error| match error {
                pty_process::Error::Io(error) => error,
                pty_process::Error::Rustix(errno) => errno.into(),
                other => io::Error::other(other.to_string()),
            })
    }
}

/// Why `program` did not start where it was asked to.
fn refused(program: &Program, why: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("{} could not start {why}.", program.program),
    )
}
