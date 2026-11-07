//! The window's socket on Windows: a named pipe, in the machine's one
//! namespace of pipes (ADR 0090, decision 5). Node makes it with Windows'
//! default access list, which lets no other account write to it
//! (engine/tests/windows.rs holds to that).

use crate::Failure;
use crate::places::FOLDER;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The window's pipe for the state folder `state`: one for each Banda and
/// each state folder, as the socket is. Its name is a hash of the folder,
/// read as Windows reads a path: with either separator, with or without
/// one at its end, in any case.
pub fn pipe(state: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let folder: PathBuf = state.components().collect();
    let hash = Sha256::digest(folder.to_string_lossy().to_lowercase().as_bytes());
    let short: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!(r"\\.\pipe\{FOLDER}-window-{short}").into()
}

/// One line to the window's pipe, and its line back within `answer`. The
/// pipe opens as a file, at no level of impersonation, so a pipe another
/// account made in its name never acts as the Person.
pub fn knock(pipe: &Path, message: &Value, answer: Duration) -> Result<String, Failure> {
    use std::os::windows::fs::OpenOptionsExt;
    const SECURITY_ANONYMOUS: u32 = 0;
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_PIPE_BUSY: i32 = 231;
    let open = || {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .security_qos_flags(SECURITY_ANONYMOUS)
            .open(pipe)
    };
    // Each of the pipe's open ends may be taken for a moment, by another
    // `banda menu`.
    let mut tries = 0;
    let mut stream = loop {
        match open() {
            Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) && tries < 50 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(20));
            }
            opened => break opened,
        }
    }
    .map_err(|error| {
        Failure::Broken(if error.raw_os_error() == Some(ERROR_ACCESS_DENIED) {
            "Banda's window does not let this program in: it may run as administrator, or as \
             another user."
                .into()
        } else {
            "Banda's window is not open.".into()
        })
    })?;
    writeln!(stream, "{message}").map_err(Failure::broken)?;
    // A file has no read timeout: the answer is read aside and waited for.
    let (answered, heard) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let read = BufReader::new(stream).read_line(&mut line).map(|_| line);
        let _ = answered.send(read);
    });
    heard
        .recv_timeout(answer)
        .unwrap_or_else(|_| Err(std::io::ErrorKind::TimedOut.into()))
        .map_err(|error| Failure::Broken(format!("Banda's window did not answer: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_state_folder_has_one_pipe_however_its_path_is_written() {
        let named = pipe(Path::new(r"C:\Users\Ro\AppData\Local\banda\state"));
        for same in [
            r"C:\Users\Ro\AppData\Local\banda\state\",
            "c:/users/ro/appdata/local/BANDA/state",
        ] {
            assert_eq!(pipe(Path::new(same)), named, "{same}");
        }
        assert_ne!(
            pipe(Path::new(r"C:\Users\Ro\AppData\Local\banda\other")),
            named
        );
        let name = named.to_str().unwrap();
        let hash = name
            .strip_prefix(&format!(r"\\.\pipe\{FOLDER}-window-"))
            .unwrap_or_else(|| panic!("{name}"));
        assert!(
            hash.len() == 16 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "{name}"
        );
    }
}
