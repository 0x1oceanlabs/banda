//! The `local` environment (ADR 0084, decision 1): a program runs on the
//! host, as the engine's own child, with the engine's environment less
//! what it takes away and plus what it adds.

use banda_kernel::{Environment, Input, Program};
use std::io;
use std::process::Stdio;
use tokio::process::Child;

/// Runs a Project's programs on the host.
#[derive(Clone, Copy, Debug, Default)]
pub struct Local;

impl Environment for Local {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Child> {
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
