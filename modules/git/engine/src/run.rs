//! Running the `git` program, as T3 Code does
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 0).
//!
//! Every git the module runs goes through [`git`]: in the folder it is
//! given, with no prompts and no optional locks, so a status read beside
//! the Person's own git never takes `.git/index.lock`; at most eight at
//! once; stopped after 30 seconds, or the time a command that writes is
//! given; its output cut at a cap, which it says. What git writes on
//! stderr can hold a remote's credentials, so it goes to the engine's log
//! only, and a caller hears a [`Reason`]; a line a caller follows has its
//! credentials taken out ([`redact`]).

use banda_kernel::Refusal;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Semaphore, mpsc};

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
    /// How long it may run; [`TIME`] when `None`.
    pub time: Option<Duration>,
    /// More of git's environment, as `GIT_TRACE2_EVENT`.
    pub env: &'a [(&'a str, &'a OsStr)],
    /// Hears each line git and its hooks write on stderr as it comes,
    /// its credentials taken out.
    pub lines: Option<mpsc::UnboundedSender<String>>,
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

    /// The last line it wrote on stderr that is not a hint, its
    /// credentials taken out: what a hook or a remote said as it failed.
    pub fn last_line(&self) -> Option<String> {
        String::from_utf8_lossy(&self.stderr)
            .lines()
            .map(str::trim)
            .rfind(|l| !l.is_empty() && !l.starts_with("hint:"))
            .map(redact)
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
    /// The remote has commits the branch lacks, and refused the push.
    Rejected,
    /// The branch and its upstream both have commits the other lacks.
    Diverged,
    /// The remote would not let git in.
    Unauthorized,
    /// A switch or a pull would lose changes in the work tree.
    WouldLose,
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
            "would be overwritten by checkout",
            "would be removed by checkout",
        ]) {
            Reason::WouldLose
        } else if says(&["not possible to fast-forward", "diverging branches"]) {
            Reason::Diverged
        } else if says(&["failed to push some refs"])
            && ["(fetch first)", "(non-fast-forward)"]
                .iter()
                .any(|w| stderr.contains(w))
        {
            Reason::Rejected
        } else if says(&[
            "authentication failed",
            "could not read username",
            "permission denied (publickey",
            "could not read from remote repository",
            "repository not found",
        ]) {
            Reason::Unauthorized
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
            Reason::TimedOut => Refusal::conflict("Git ran past its time and was stopped."),
            Reason::Rejected => {
                Refusal::conflict("The remote has commits this branch lacks: pull them first.")
            }
            Reason::Diverged => Refusal::conflict(
                "This branch and its upstream both have commits the other lacks: rebase or merge first.",
            ),
            Reason::Unauthorized => Refusal::conflict(
                "Git could not sign in to the remote, or it is not there: try git in a terminal.",
            ),
            Reason::WouldLose => Refusal::conflict(
                "This would lose changes in some files: commit or stash them first.",
            ),
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
    command.envs(opts.env.iter().copied());
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
        let stderr = capped_lines(stderr, STDERR, opts.lines.as_ref());
        let ((stdout, truncated), (stderr, _), ()) = tokio::join!(read, stderr, feed);
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
    match tokio::time::timeout(opts.time.unwrap_or(TIME), ran).await {
        Ok(ran) => Ok(ran),
        Err(_) => {
            tracing::warn!(args = %said, "git ran past its time and was stopped");
            Err(Failure(Reason::TimedOut))
        }
    }
}

/// Up to `cap` bytes of `from`, read to its end, and whether it had more;
/// each line said to `lines` as it comes, past the cap too.
async fn capped_lines(
    from: impl AsyncRead + Unpin,
    cap: usize,
    lines: Option<&mpsc::UnboundedSender<String>>,
) -> (Vec<u8>, bool) {
    let Some(lines) = lines else {
        return capped(from, cap, true).await;
    };
    let mut from = tokio::io::BufReader::new(from);
    let mut kept = Vec::new();
    let mut more = false;
    let mut line = Vec::new();
    loop {
        line.clear();
        // A line ends at `\n`; one a progress meter redraws with `\r`
        // comes whole once it ends.
        match tokio::io::AsyncBufReadExt::read_until(&mut from, b'\n', &mut line).await {
            Ok(0) | Err(_) => return (kept, more),
            Ok(_) => {}
        }
        let room = cap - kept.len();
        kept.extend_from_slice(&line[..line.len().min(room)]);
        more |= line.len() > room;
        let text = String::from_utf8_lossy(&line);
        if let Some(last) = text.split('\r').map(str::trim).rfind(|l| !l.is_empty()) {
            let _ = lines.send(redact(last));
        }
    }
}

/// `line` with the credentials a URL in it holds taken out:
/// `https://ann:token@host/` says `https://host/`.
pub fn redact(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("://") {
        let (before, after) = rest.split_at(at + 3);
        out.push_str(before);
        let end = after
            .find(|c: char| c == '/' || c.is_whitespace())
            .unwrap_or(after.len());
        let host = &after[..end];
        out.push_str(host.rsplit_once('@').map_or(host, |(_, host)| host));
        rest = &after[end..];
    }
    out.push_str(rest);
    out
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
        let auth = "fatal: Authentication failed for 'https://x/'\n";
        assert_eq!(Reason::of(auth), Reason::Unauthorized);
        let rejected = " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'x'\n";
        assert_eq!(Reason::of(rejected), Reason::Rejected);
        assert_eq!(Reason::of("hint: something\n"), Reason::Other);
    }

    #[test]
    fn a_line_loses_the_credentials_its_urls_hold() {
        assert_eq!(
            redact("To https://ann:ghp_x@github.com/a/b.git and ssh://git@host:22/c"),
            "To https://github.com/a/b.git and ssh://host:22/c"
        );
        assert_eq!(redact("no url here"), "no url here");
    }
}
