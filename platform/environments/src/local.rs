//! The `local` environment (ADR 0084, decision 1): a program runs on the
//! host, as the engine's own child, with the engine's environment less
//! what it takes away and plus what it adds.
//!
//! A program says whose it is ([`Whose`]): a Harness's is one to start
//! behind the fence (ADR 0083, decision 1), and a terminal is the
//! Person's, outside it. So a terminal's program starts only on a terminal,
//! and one to fence never does.

use banda_kernel::{Environment, Input, Program, Pty, PtySize, Started, Whose};
use std::io;
use std::process::Stdio;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows::command;

/// Runs a Project's programs on the host.
#[derive(Clone, Copy, Debug, Default)]
pub struct Local;

impl Environment for Local {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Started> {
        if program.whose() == Whose::Terminal {
            return Err(refused(
                program,
                "on pipes: a terminal's program starts on a terminal",
            ));
        }
        let mut command = command(program)?;
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
            .stderr(Stdio::piped());
        Started::spawn(command)
    }

    fn pty(&self, program: &Program, size: PtySize) -> io::Result<(Started, Pty)> {
        if program.whose().fenced() {
            let why = "on a terminal: a Harness's program starts only behind the fence";
            return Err(refused(program, why));
        }
        crate::pty::start(program, size)
    }
}

/// The command that starts `program`, by its name: Unix finds it on the
/// PATH it is given. Windows' own search would look on past PATH, so there
/// it is found first (`local/windows.rs`).
#[cfg(not(windows))]
fn command(program: &Program) -> io::Result<tokio::process::Command> {
    Ok(tokio::process::Command::new(&program.program))
}

/// Why `program` did not start where it was asked to.
fn refused(program: &Program, why: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!("{} could not start {why}.", program.program),
    )
}
