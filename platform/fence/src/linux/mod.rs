//! The fence on Linux: user, mount, IPC and PID namespaces, and Landlock's
//! scopes where the kernel has them.

mod launch;
mod plan;
mod probe;
mod sys;

use crate::{Probe, Sealed, Spec};
use launch::{Exec, Failed};
use rustix::fd::{AsRawFd, OwnedFd};
use std::ffi::OsString;
use std::io::{self, Read};
use std::panic::AssertUnwindSafe;
use std::process::ExitCode;
use std::time::{Duration, Instant};

/// Where an environment starts the launcher: the program running now, the
/// engine, even when its file on disk was replaced since it started.
pub const LAUNCHER: &str = "/proc/self/exe";

/// The launcher's arguments, after its program's own: the spec's fd, the
/// fd it says how its start went on when it has one, then the program and
/// its arguments.
pub fn argv<S: AsRef<std::ffi::OsStr>>(
    spec: &Sealed,
    status: Option<&Tells>,
    program: impl AsRef<std::ffi::OsStr>,
    args: &[S],
) -> Vec<OsString> {
    let mut argv: Vec<OsString> = vec![
        "fence".into(),
        "--spec-fd".into(),
        spec.number().to_string().into(),
    ];
    if let Some(Tells(status)) = status {
        argv.extend(["--status-fd".into(), status.as_raw_fd().to_string().into()]);
    }
    argv.extend(["--".into(), program.as_ref().to_owned()]);
    argv.extend(args.iter().map(|arg| arg.as_ref().to_owned()));
    argv
}

/// The end of a pipe a launcher says on whether its program started: its
/// starter hands it over with [`attach`].
#[derive(Debug)]
pub struct Tells(OwnedFd);

/// The end of that pipe its starter keeps, and reads with
/// [`Hears::started`].
#[derive(Debug)]
pub struct Hears(OwnedFd);

/// A pipe for a launcher to say on whether its program started.
pub fn status() -> io::Result<(Hears, Tells)> {
    let (hear, tell) = rustix::pipe::pipe_with(rustix::pipe::PipeFlags::CLOEXEC)?;
    Ok((Hears(hear), Tells(tell)))
}

impl Hears {
    /// Waits for the launcher to start its program, up to `within`: the
    /// pipe ends with nothing said once the program runs, and says why
    /// when the fence was not set up or the program did not start. Its
    /// starter must have let go of its own [`Tells`] (dropped the command
    /// it was attached to) before it waits. Past `within` it waits no
    /// more, and says nothing went wrong.
    pub fn started(self, within: Duration) -> io::Result<()> {
        let Hears(hear) = self;
        let until = Instant::now() + within;
        let mut said = Vec::new();
        let mut pipe = std::fs::File::from(hear);
        loop {
            let left = until.saturating_duration_since(Instant::now());
            let left = rustix::event::Timespec {
                tv_sec: i64::try_from(left.as_secs()).unwrap_or(i64::MAX),
                tv_nsec: left.subsec_nanos().into(),
            };
            let mut polled = [rustix::event::PollFd::new(
                &pipe,
                rustix::event::PollFlags::IN,
            )];
            match rustix::event::poll(&mut polled, Some(&left)) {
                Ok(0) => return Ok(()),
                Ok(_) => {}
                Err(rustix::io::Errno::INTR) => continue,
                Err(error) => return Err(error.into()),
            }
            let mut chunk = [0u8; 4096];
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => said.extend_from_slice(&chunk[..read]),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error),
            }
        }
        let failed = (said.split(|byte| *byte == b'\n'))
            .filter_map(|line| serde_json::from_slice::<probe::Said>(line).ok())
            .find_map(|said| match said {
                probe::Said::Failed { words, .. } => Some(words),
                probe::Said::Held(_) => None,
            });
        match failed {
            Some(words) => Err(io::Error::other(format!("banda fence: {words}"))),
            None => Ok(()),
        }
    }
}

/// Hands `spec`, and the end of the pipe it says on when there is one, to
/// the launcher `command` starts: each stays open across exec in that one
/// child, by the number [`argv`] gives it, and is closed in this process
/// once `command` is dropped.
#[allow(unsafe_code)]
pub fn attach(command: &mut std::process::Command, spec: Sealed, status: Option<Tells>) {
    use std::os::unix::process::CommandExt;
    let Sealed(memfd) = spec;
    let kept = move || -> std::io::Result<()> {
        rustix::io::fcntl_setfd(&memfd, rustix::io::FdFlags::empty())?;
        if let Some(Tells(status)) = &status {
            rustix::io::fcntl_setfd(status, rustix::io::FdFlags::empty())?;
        }
        Ok(())
    };
    // SAFETY: the hook runs in the child between fork and exec, and makes
    // fcntl calls, which are async-signal-safe: it allocates nothing and
    // takes no lock.
    unsafe { command.pre_exec(kept) };
}

/// The spec on the fd `number`, which must be sealed and of this build,
/// `own_build`; the fd is closed once it is read. A process takes its spec
/// once, as it starts, before it opens any fd of its own.
pub fn take(number: i32, own_build: &str) -> Result<Spec, String> {
    let memfd =
        sys::inherited(number).map_err(|error| format!("no spec on fd {number}: {error}"))?;
    let spec = Spec::read(memfd)?;
    if spec.build != own_build {
        return Err(format!(
            "the spec is of another build of banda ({}, this is {own_build}): start the fence \
             from the engine that runs",
            spec.build
        ));
    }
    Ok(spec)
}

/// `banda fence`: sets the fence up as the spec on fd `spec_fd` says and
/// runs `program` (its path or name, then its arguments) behind it. It
/// returns only when the fence could not be set up, having run nothing and
/// said why on the pipe `status_fd` when there is one ([`Hears`]), else on
/// stderr; otherwise it exits as the program did, a signal `n` as
/// `128 + n`, or once its starter ended. It writes nothing on stdout, which
/// is the program's. It closes every fd its starter left open but the
/// three streams and `status_fd`, which it lets go of once the program
/// runs.
pub fn launch(
    spec_fd: i32,
    status_fd: Option<i32>,
    program: &[OsString],
    own_build: &str,
) -> ExitCode {
    let mut status: Option<OwnedFd> = None;
    let fenced = || -> Result<Failed, Failed> {
        if let Some(number) = status_fd {
            let taken = sys::status(number).map_err(|error| {
                Failed::setup(format!("no status pipe on fd {number}: {error}"))
            })?;
            status = Some(taken);
        }
        let spec = take(spec_fd, own_build).map_err(Failed::setup)?;
        sys::close_all_but(status.as_ref()).map_err(|error| {
            Failed::setup(format!("closing what the program is not given: {error}"))
        })?;
        let exec = Exec::new(program, spec.cwd.as_deref())?;
        let fenced = launch::setup(&spec)?;
        Ok(launch::start(exec, fenced.starter, &mut status))
    };
    let failed = match std::panic::catch_unwind(AssertUnwindSafe(fenced)) {
        Ok(Ok(failed) | Err(failed)) => failed,
        Err(_) => Failed::setup("the launcher stopped on a fault of its own"),
    };
    launch::tell(status.as_ref(), &failed);
    ExitCode::from(crate::UNSET)
}

/// `banda fence --probe`: whether the fence holds over `spec` here, from
/// doing it: each step set up for real, checked from inside, and
/// `program` (which must end well at once, by its path) run behind it.
pub fn probe(spec: &Spec, program: &[OsString]) -> Probe {
    probe::probe(spec, program)
}
