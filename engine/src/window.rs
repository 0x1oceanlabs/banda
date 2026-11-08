//! The window's socket, where `banda menu [route]` asks Banda's window to
//! open its menu (ADR 0017): a Unix socket in the state folder, or on
//! Windows a named pipe named for it (`window/windows.rs`, ADR 0090,
//! decision 5). The window listens there while it is open
//! (client/desktop/src/door.ts). One JSON line goes in, and one line comes
//! back: `ok`, or what went wrong.

use crate::Failure;
use crate::places::Places;
use serde_json::{Value, json};
use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

#[cfg(windows)]
mod windows;

/// How long the window has to answer.
const ANSWER: Duration = Duration::from_secs(5);

/// Where the window listens while it is open, for the state folder
/// `state`.
#[cfg(unix)]
pub fn place(state: &Path) -> std::path::PathBuf {
    state.join("window.sock")
}

#[cfg(windows)]
pub use windows::pipe as place;

/// Asks the window to open its menu at `route`, and hears `ok` back.
pub fn menu(route: String) -> ExitCode {
    let told =
        Places::from_env().and_then(|places| tell(&places.window(), &json!({ "menu": route })));
    match told {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.exit(),
    }
}

fn tell(at: &Path, message: &Value) -> Result<(), Failure> {
    match knock(at, message)?.trim() {
        "ok" => Ok(()),
        other => Err(Failure::Broken(format!("Banda's window said: {other}"))),
    }
}

/// One line to the window's socket, and its line back.
#[cfg(unix)]
fn knock(socket: &Path, message: &Value) -> Result<String, Failure> {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;
    let mut stream = UnixStream::connect(socket).map_err(|_| {
        // Behind the fence an Agent's `banda` reaches no window (ADR 0083).
        let under_a_pass = std::env::var_os(banda_kernel::ENGINE_VARIABLE).is_some();
        Failure::Broken(match under_a_pass {
            true => "Banda's window is not open, or out of an Agent's reach behind the fence: \
                     tell your Person where to go in it."
                .into(),
            false => "Banda's window is not open.".into(),
        })
    })?;
    stream
        .set_read_timeout(Some(ANSWER))
        .map_err(Failure::broken)?;
    writeln!(stream, "{message}").map_err(Failure::broken)?;
    let mut answer = String::new();
    BufReader::new(stream)
        .read_line(&mut answer)
        .map_err(|error| Failure::Broken(format!("Banda's window did not answer: {error}")))?;
    Ok(answer)
}

#[cfg(windows)]
fn knock(pipe: &Path, message: &Value) -> Result<String, Failure> {
    windows::knock(pipe, message, ANSWER)
}
