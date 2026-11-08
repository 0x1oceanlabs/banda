//! How `local` starts a program on Windows (ADR 0090, decision 3): found
//! as the host finds one (`host::command_on`), with `PATHEXT`'s
//! extensions, so `npx` is `npx.cmd`, and never under `WindowsApps`; on the
//! PATH the program names, else the host's as it is now, the registry's
//! with it, so a CLI installed while the engine runs is found. The program
//! is given that PATH, unless it names its own or takes PATH away.
//!
//! One not found does not start: Windows' own search would look on, in
//! the engine's folder, the system's and `WindowsApps` among the rest.

use banda_kernel::{Program, host};
use std::ffi::OsString;
use std::io;
use tokio::process::Command;

/// The command that starts `program`, found as the host finds one. The
/// program's own variables go over its PATH, and its `unset` takes it away.
pub(super) fn command(program: &Program) -> io::Result<Command> {
    let named = host::named(&program.env, "PATH").map(|key| OsString::from(&program.env[key]));
    host::command_on(&program.program, named.unwrap_or_else(host::path))
}
