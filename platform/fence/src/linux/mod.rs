//! The fence on Linux: user, mount, IPC and PID namespaces, and Landlock's
//! scopes where the kernel has them.

mod launch;
mod plan;
mod probe;
mod sys;

use crate::{Probe, Sealed, Spec};
use launch::{Exec, Failed};
use std::ffi::OsString;
use std::panic::AssertUnwindSafe;
use std::process::ExitCode;

/// Where an environment starts the launcher: the program running now, the
/// engine, even when its file on disk was replaced since it started.
pub const LAUNCHER: &str = "/proc/self/exe";

/// The launcher's arguments, after its program's own: the spec's fd, then
/// the program and its arguments.
pub fn argv(spec: &Sealed, program: &str, args: &[String]) -> Vec<OsString> {
    let mut argv: Vec<OsString> = vec![
        "fence".into(),
        "--spec-fd".into(),
        spec.number().to_string().into(),
        "--".into(),
        program.into(),
    ];
    argv.extend(args.iter().map(OsString::from));
    argv
}

/// Hands `spec` to the launcher `command` starts: its memfd stays open
/// across exec in that one child, by the number [`argv`] gives it, and is
/// closed in this process once `command` is dropped.
#[allow(unsafe_code)]
pub fn attach(command: &mut std::process::Command, spec: Sealed) {
    use std::os::unix::process::CommandExt;
    let Sealed(memfd) = spec;
    let kept = move || -> std::io::Result<()> {
        rustix::io::fcntl_setfd(&memfd, rustix::io::FdFlags::empty())?;
        Ok(())
    };
    // SAFETY: the hook runs in the child between fork and exec, and makes
    // one fcntl call, which is async-signal-safe: it allocates nothing and
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
/// said why on stderr; otherwise it exits as the program did, a signal
/// `n` as `128 + n`. It writes nothing on stdout, which is the program's.
/// It closes every fd its starter left open but the three streams.
pub fn launch(spec_fd: i32, program: &[OsString], own_build: &str) -> ExitCode {
    let fenced = || -> Result<Failed, Failed> {
        let spec = take(spec_fd, own_build).map_err(Failed::setup)?;
        sys::close_all_but(None).map_err(|error| {
            Failed::setup(format!("closing what the program is not given: {error}"))
        })?;
        let exec = Exec::new(program, spec.cwd.as_deref())?;
        launch::setup(&spec)?;
        Ok(launch::start(exec, None))
    };
    let failed = match std::panic::catch_unwind(AssertUnwindSafe(fenced)) {
        Ok(Ok(failed) | Err(failed)) => failed,
        Err(_) => Failed::setup("the launcher stopped on a fault of its own"),
    };
    launch::tell(None, &failed);
    ExitCode::from(crate::UNSET)
}

/// `banda fence --probe`: whether the fence holds over `spec` here, from
/// doing it: each step set up for real, checked from inside, and
/// `program` (which must end well at once, by its path) run behind it.
pub fn probe(spec: &Spec, program: &[OsString]) -> Probe {
    probe::probe(spec, program)
}
