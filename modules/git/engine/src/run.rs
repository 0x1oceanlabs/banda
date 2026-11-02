//! Running the `git` program, as T3 Code does
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 0).
//!
//! Every git the module runs goes through [`git`]: in the folder it is
//! given, with no prompts and no optional locks, so a status read beside
//! the Person's own git never takes `.git/index.lock`; at most eight at
//! once; stopped after 30 seconds; its output cut at a cap, which it says.
//! What git writes on stderr can hold a remote's credentials, so it goes
//! to the engine's log only, and a caller hears a [`Reason`].

use banda_kernel::Refusal;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::Semaphore;

/// How long one git may run.
const TIME: Duration = Duration::from_secs(30);
/// How many gits run at once, in every Space together.
static RUNNING: Semaphore = Semaphore::const_new(8);
/// The most of stdout a git keeps unless asked otherwise: 16 MiB, as T3
/// Code gives its diff and status metadata.
const OUTPUT: usize = 16 * 1024 * 1024;
/// The most of stderr kept for the log.
const STDERR: usize = 64 * 1024;

/// The environment git would otherwise take from the engine's and that
/// would point it elsewhere, as when the engine runs inside a git hook.
const ELSEWHERE: [&str; 4] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"];

/// How a git runs, beyond its arguments.
#[derive(Default)]
pub struct Opts<'a> {
    /// The most of stdout kept; [`OUTPUT`] when `None`.
    pub cap: Option<usize>,
    /// What git reads on stdin.
    pub stdin: Option<Vec<u8>>,
    /// Another index than the repository's own (`GIT_INDEX_FILE`).
    pub index: Option<&'a Path>,
}

/// What a git that ran said.
pub struct Ran {
    pub stdout: Vec<u8>,
    /// Its stdout went past the cap and was cut there; git was stopped.
    pub truncated: bool,
    /// It exited with 0, or was stopped at the cap.
    pub success: bool,
    stderr: Vec<u8>,
    args: String,
}

impl Ran {
    /// This, when git succeeded; else why not, with its stderr logged.
    pub fn checked(self) -> Result<Ran, Failure> {
        if self.success {
            return Ok(self);
        }
        Err(self.failure())
    }

    /// Why it failed, with its stderr logged.
    pub fn failure(&self) -> Failure {
        let stderr = String::from_utf8_lossy(&self.stderr);
        let reason = Reason::of(&stderr);
        tracing::warn!(args = %self.args, ?reason, stderr = %stderr.trim(), "git failed");
        Failure(reason)
    }

    /// Why it failed, unlogged, for a failure that is an answer, as "not
    /// a repository" is to `status`.
    pub fn reason(&self) -> Reason {
        Reason::of(&String::from_utf8_lossy(&self.stderr))
    }

    /// It wrote nothing on stderr.
    pub fn quiet(&self) -> bool {
        self.stderr.iter().all(u8::is_ascii_whitespace)
    }

    /// Its stdout as text, a line's end trimmed.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).trim_end().to_owned()
    }
}

/// Why a git failed, as a caller hears it: never its own words.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// The folder is in no repository.
    NotRepository,
    /// Another git holds a lock: `index.lock`, `config.lock`.
    Locked,
    /// A ref, commit or object it was given is not there.
    BadRef,
    /// It ran past [`TIME`] and was stopped.
    TimedOut,
    /// Anything else, which only the log tells.
    Other,
}

impl Reason {
    /// The reason in what git wrote on stderr, from its `fatal:` and
    /// `error:` lines alone.
    fn of(stderr: &str) -> Reason {
        let said: Vec<String> = stderr
            .lines()
            .filter(|line| line.starts_with("fatal:") || line.starts_with("error:"))
            .map(str::to_lowercase)
            .collect();
        let says = |words: &[&str]| {
            said.iter()
                .any(|line| words.iter().any(|w| line.contains(w)))
        };
        if says(&["not a git repository"]) {
            Reason::NotRepository
        } else if says(&[".lock': file exists", "index.lock", "config.lock"]) {
            Reason::Locked
        } else if says(&[
            "bad revision",
            "bad object",
            "unknown revision",
            "ambiguous argument",
            "not a valid object name",
            "invalid object name",
            "not a valid commit",
            "needed a single revision",
            "does not exist in",
            "exists on disk, but not in",
        ]) {
            Reason::BadRef
        } else {
            Reason::Other
        }
    }
}

/// A git that failed, and why.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Failure(pub Reason);

impl From<Failure> for Refusal {
    fn from(Failure(reason): Failure) -> Refusal {
        match reason {
            Reason::NotRepository => Refusal::conflict(NOT_A_REPOSITORY),
            Reason::Locked => Refusal::conflict(
                "Another git holds this repository's lock: try again in a moment.",
            ),
            Reason::BadRef => {
                Refusal::not_found("That branch, commit or file is not in this repository.")
            }
            Reason::TimedOut => {
                Refusal::conflict("Git ran longer than 30 seconds and was stopped.")
            }
            Reason::Other => {
                Refusal::conflict("Git could not read this; the engine's log says why.")
            }
        }
    }
}

/// What the git methods but `status` say in a folder git does not know.
const NOT_A_REPOSITORY: &str = "This Space's folder is not a git repository.";

/// Runs `git args` in `folder`. A git that exits with another code than 0
/// is no error here: [`Ran::checked`] makes it one, and a probe such as
/// `show-ref --quiet` reads [`Ran::success`].
pub async fn git<I, S>(folder: &Path, args: I, opts: Opts<'_>) -> Result<Ran, Failure>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let args: Vec<_> = args.into_iter().map(|a| a.as_ref().to_owned()).collect();
    let said = args
        .iter()
        .map(|a| a.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    let _turn = RUNNING
        .acquire()
        .await
        .expect("the semaphore is never closed");
    let mut command = tokio::process::Command::new("git");
    command
        .args(&args)
        .current_dir(folder)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(match opts.stdin {
            Some(_) => Stdio::piped(),
            None => Stdio::null(),
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for name in ELSEWHERE {
        command.env_remove(name);
    }
    if let Some(index) = opts.index {
        command.env("GIT_INDEX_FILE", index);
    }
    let mut child = command.spawn().map_err(|error| {
        tracing::warn!(%error, args = %said, "git did not start");
        Failure(Reason::Other)
    })?;
    let cap = opts.cap.unwrap_or(OUTPUT);
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let ran = async {
        let feed = async {
            if let (Some(mut stdin), Some(bytes)) = (stdin, opts.stdin) {
                // A git that stops reading early says why on stderr.
                let _ = stdin.write_all(&bytes).await;
            }
        };
        let read = async {
            let (stdout, truncated) = capped(stdout, cap, false).await;
            if truncated {
                // It has more to say than is kept: stop it, so its stderr
                // ends too.
                let _ = child.start_kill();
            }
            (stdout, truncated)
        };
        let ((stdout, truncated), (stderr, _), ()) =
            tokio::join!(read, capped(stderr, STDERR, true), feed);
        let exited = child.wait().await;
        let success = truncated || exited.is_ok_and(|status| status.success());
        Ran {
            stdout,
            truncated,
            success,
            stderr,
            args: said.clone(),
        }
    };
    match tokio::time::timeout(TIME, ran).await {
        Ok(ran) => Ok(ran),
        Err(_) => {
            tracing::warn!(args = %said, "git ran past its time and was stopped");
            Err(Failure(Reason::TimedOut))
        }
    }
}

/// Up to `cap` bytes of `from`, and whether it had more. Past the cap it
/// stops reading, or with `drain` reads on to the end and keeps none of it.
async fn capped(mut from: impl AsyncRead + Unpin, cap: usize, drain: bool) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut more = false;
    let mut chunk = vec![0; 64 * 1024];
    loop {
        let n = match from.read(&mut chunk).await {
            Ok(0) | Err(_) => return (kept, more),
            Ok(n) => n,
        };
        let room = cap - kept.len();
        kept.extend_from_slice(&chunk[..n.min(room)]);
        if n > room {
            more = true;
            if !drain {
                return (kept, more);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_reads_as_a_reason_from_its_fatal_and_error_lines() {
        let not = "fatal: not a git repository (or any of the parent directories): .git\n";
        assert_eq!(Reason::of(not), Reason::NotRepository);
        let locked = "fatal: Unable to create '/r/.git/index.lock': File exists.\n";
        assert_eq!(Reason::of(locked), Reason::Locked);
        let bad = "fatal: bad revision 'nope'\n";
        assert_eq!(Reason::of(bad), Reason::BadRef);
        assert_eq!(Reason::of("hint: not a git repository\n"), Reason::Other);
        assert_eq!(Reason::of("fatal: Authentication failed\n"), Reason::Other);
    }
}
