//! A program on a terminal on the host (ADR 0090, decision 3). On Unix the
//! terminal is a PTY, which `pty-process` opens and starts the program on
//! the other end of, as the leader of a session of its own; the module
//! holds the port's own handle on it ([`Pty`]). Windows has none yet: a
//! ConPTY comes with ADR 0090's step 7.

#[cfg(unix)]
use banda_kernel::PtyControl;
use banda_kernel::{Program, Pty, PtySize, Started};
use std::io;

#[cfg(unix)]
pub(crate) fn start(program: &Program, size: PtySize) -> io::Result<(Started, Pty)> {
    let (pty, pts) = pty_process::open().map_err(plain)?;
    let control = Control(rustix::io::fcntl_dupfd_cloexec(&pty, 0)?);
    control.resize(size)?;
    let mut command = pty_process::Command::new(&program.program).args(&program.args);
    if let Some(cwd) = &program.cwd {
        command = command.current_dir(cwd);
    }
    for name in &program.unset {
        command = command.env_remove(name);
    }
    let child = command.envs(&program.env).spawn(pts).map_err(plain)?;
    let (output, input) = pty.into_split();
    let pty = Pty {
        output: Box::new(output),
        input: Box::new(input),
        control: std::sync::Arc::new(control),
    };
    Ok((Started::on_terminal(child), pty))
}

#[cfg(not(unix))]
pub(crate) fn start(program: &Program, _: PtySize) -> io::Result<(Started, Pty)> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        format!(
            "{} could not start: terminals are not on Windows yet (ADR 0090, step 7).",
            program.program
        ),
    ))
}

/// The PTY itself, by a descriptor of its own: no program started after
/// it gets a copy, as one without close-on-exec would give each.
#[cfg(unix)]
struct Control(std::os::fd::OwnedFd);

#[cfg(unix)]
impl PtyControl for Control {
    fn resize(&self, size: PtySize) -> io::Result<()> {
        let size = pty_process::Size::new(size.rows, size.cols).into();
        Ok(rustix::termios::tcsetwinsize(&self.0, size)?)
    }

    fn front(&self) -> Option<u32> {
        let group = rustix::termios::tcgetpgrp(&self.0).ok()?;
        u32::try_from(group.as_raw_pid()).ok()
    }
}

#[cfg(unix)]
fn plain(error: pty_process::Error) -> io::Error {
    match error {
        pty_process::Error::Io(error) => error,
        pty_process::Error::Rustix(errno) => errno.into(),
        other => io::Error::other(other.to_string()),
    }
}
