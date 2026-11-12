//! Running the `git` program, as T3 Code does
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 0).
//!
//! Every git the module runs goes through [`git`], in the folder it is
//! given: Banda's own bookkeeping, on the host and behind the fence where
//! it holds, which runs no program the repository names, unless it is an
//! act the Person asked for ([`Opts::asked`]), which runs as their own
//! git, hooks and all, in the Project's environment (`banda_git_cli` says
//! how far each holds; ADR 0084, decision 8). Only a Person asks for one:
//! the methods that run an act need `Right::Run`, which no Agent holds.
//! Either takes no optional lock, so a status read beside the Person's
//! own git never takes `.git/index.lock`, and asks nothing. At most eight run at once; each
//! is stopped after 30 seconds, or [`LONG`] for an act, with SIGTERM first
//! so it takes its lock files away, or on Windows killed, the index lock
//! of an act that takes one taken away after it ([`Left`]); its output is
//! cut at a cap, which it says. What git writes on stderr can hold a
//! remote's credentials, so it goes to the engine's log only, and a caller
//! hears a [`Reason`]; a line a caller follows has its credentials taken
//! out ([`redact`]).

use banda_kernel::{Environment, Input, Program, Refusal, Started};
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Semaphore, mpsc};

/// How long one git may run.
const TIME: Duration = Duration::from_secs(30);
/// How long an act asked for may run: a commit and its hooks, a push, a
/// pull, a checkout of many files.
pub const LONG: Duration = Duration::from_secs(10 * 60);
/// How long a git asked to stop has to end before it is killed.
const STOPPING: Duration = Duration::from_secs(2);
/// How long an act that found the index lock held waits before each try
/// again ([`tries_again`]), about a second and a half in all: another
/// git holds it a moment, as an editor's `status` beside the Person does.
const LOCKED: [Duration; 5] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
    Duration::from_millis(800),
];
/// How long the pipes are read on after git ended: a child it left, as a
/// hook's, may hold them open.
const LEFT_OPEN: Duration = Duration::from_secs(1);
/// How many gits of [`Pool::Shared`] run at once, in every Project
/// together.
static RUNNING: Semaphore = Semaphore::const_new(8);
/// The most of stdout a git keeps unless asked otherwise: 16 MiB, as T3
/// Code gives its diff and status metadata.
const OUTPUT: usize = 16 * 1024 * 1024;
/// The most of stderr kept for the log.
const STDERR: usize = 64 * 1024;

/// Whether a git waits its turn among the [`RUNNING`] ones.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Pool {
    /// It waits its turn: a read, done in a moment.
    #[default]
    Shared,
    /// It runs at once, beside them, as T3 Code's long ones do: an act,
    /// whose hook may run for minutes, or a fetch, which keeps no read
    /// waiting either.
    Long,
}

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
    pub pool: Pool,
    /// It is an act the Person asked for, as a commit or a push, which
    /// runs as their own git in this, its Project's environment; with
    /// none, it is Banda's own bookkeeping, on the host, behind the fence
    /// where it holds.
    pub asked: Option<&'a dyn Environment>,
    /// What Banda's own fetch signs in to its remote with, where it may,
    /// and the objects its own repository borrows, which is the folder
    /// `git` runs in ([`banda_git_cli::signed_fetch`]).
    pub signed: Option<(&'a Path, &'a banda_git_cli::SignIn)>,
    /// Folders the fence hides that a bookkeeping git reads, where it
    /// starts behind it, as Banda's own repository a fetch takes from.
    pub reads: &'a [PathBuf],
}

impl<'a> Opts<'a> {
    /// For an act the Person asked for, as a commit, a push or a stage: it
    /// runs as their own git, hooks and all, in `environment`, for up to
    /// [`LONG`], beside the reads.
    pub fn asked(environment: &'a dyn Environment) -> Self {
        Opts {
            time: Some(LONG),
            pool: Pool::Long,
            asked: Some(environment),
            ..Opts::default()
        }
    }
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

    /// Why the remote refused a push, its credentials taken out: the last
    /// line its hook said (`remote: …`) and the reason on the ref's
    /// `! [remote rejected] main -> main (…)` line; none when it said
    /// neither.
    pub fn refused(&self) -> Option<String> {
        let stderr = String::from_utf8_lossy(&self.stderr);
        let lines: Vec<&str> = stderr.lines().map(str::trim).collect();
        let why = (lines.iter())
            .filter(|l| l.starts_with("! [remote rejected]") || l.starts_with("! [rejected]"))
            .find_map(|l| Some(l.rsplit_once('(')?.1.strip_suffix(')')?.to_owned()));
        let said = (lines.iter())
            .filter_map(|l| l.strip_prefix("remote:"))
            .map(str::trim)
            .rfind(|l| !l.is_empty());
        let said = match (said, why) {
            (Some(said), Some(why)) => format!("{said} ({why})"),
            (Some(said), None) => said.to_owned(),
            (None, Some(why)) => format!("the remote refused it ({why})"),
            (None, None) => return None,
        };
        Some(redact(&said))
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

/// Why a git failed, as a caller hears it: never its own words, but the
/// names of a branch and a folder.
#[derive(Clone, Debug, PartialEq, Eq)]
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
    /// The branch a switch asked for is checked out in another work tree
    /// of the repository's, at `folder`.
    CheckedOut { branch: String, folder: String },
    /// Another user owns the repository, and git does not trust it
    /// (`safe.directory`).
    Untrusted,
    /// Anything else, which only the log tells.
    Other,
}

impl Reason {
    /// Whether it stays till the Person changes something, unlike a lock
    /// held or a remote out of reach: the status says it then.
    pub fn lasting(&self) -> bool {
        matches!(self, Reason::Untrusted)
    }

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
        } else if let Some(reason) = checked_out(stderr) {
            reason
        } else if says(&["detected dubious ownership"]) {
            Reason::Untrusted
        } else if says(&[".lock': file exists", "index.lock", "config.lock"]) {
            Reason::Locked
        } else if says(&[
            "would be overwritten by checkout",
            "would be removed by checkout",
            "would be overwritten by merge",
            "would be removed by merge",
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

/// The branch and the other work tree in git's `fatal: 'topic' is already
/// used by worktree at '/w'`, or before git 2.42 `is already checked out
/// at '/w'`.
fn checked_out(stderr: &str) -> Option<Reason> {
    stderr.lines().find_map(|line| {
        let said = line.strip_prefix("fatal: '")?;
        let (branch, rest) = said.split_once('\'')?;
        let folder = [
            " is already used by worktree at '",
            " is already checked out at '",
        ]
        .iter()
        .find_map(|words| rest.strip_prefix(words))?;
        Some(Reason::CheckedOut {
            branch: branch.to_owned(),
            folder: folder.strip_suffix('\'')?.to_owned(),
        })
    })
}

/// A git that failed, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
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
            Reason::CheckedOut { branch, folder } => Refusal::conflict(format!(
                "{branch} is checked out in another worktree at {folder}."
            )),
            Reason::Untrusted => Refusal::conflict(UNTRUSTED),
            Reason::Other => {
                Refusal::conflict("Git could not read this; the engine's log says why.")
            }
        }
    }
}

/// What the git methods but `status` say in a folder git does not know.
const NOT_A_REPOSITORY: &str = "This Project's folder is not a git repository.";
/// What they say, and `status` too, in a repository git does not trust.
const UNTRUSTED: &str = "Git does not trust this folder, as another user owns it: add it to git's safe.directory to use it here.";

/// Runs `git args` in `folder`. A git that exits with another code than 0
/// is no error here: [`Ran::checked`] makes it one, and a probe such as
/// `show-ref --quiet` reads [`Ran::success`]. An act asked for that found
/// the index lock held by another git, and so did nothing, runs again
/// after a moment, [`LOCKED`] times at most ([`tries_again`]).
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
    let waits: &[Duration] = if opts.asked.is_some() && tries_again(&args) {
        &LOCKED
    } else {
        &[]
    };
    let mut waits = waits.iter();
    loop {
        let ran = once(folder, &args, &said, &opts).await?;
        match waits.next() {
            Some(wait) if !ran.success && ran.reason() == Reason::Locked => {
                tracing::info!(args = %said, "another git holds the index lock: trying again");
                tokio::time::sleep(*wait).await;
            }
            _ => return Ok(ran),
        }
    }
}

/// Runs `git args` in `folder` once, `said` being its arguments as text.
async fn once(
    folder: &Path,
    args: &[OsString],
    said: &str,
    opts: &Opts<'_>,
) -> Result<Ran, Failure> {
    let _turn = match opts.pool {
        Pool::Shared => Some(
            RUNNING
                .acquire()
                .await
                .expect("the semaphore is never closed"),
        ),
        Pool::Long => None,
    };
    let did_not_start = |error: std::io::Error| {
        tracing::warn!(%error, args = %said, "git did not start");
        Failure(Reason::Other)
    };
    let feeds = opts.stdin.is_some();
    let left = (cfg!(windows) && opts.asked.is_some() && takes_index(args))
        .then(|| Left::of(folder, opts.index));
    // Stopped through its handle either way, which stops the hooks it runs
    // too. `opts`'s index and variables go over git's own, last.
    let mut started = match opts.asked {
        Some(environment) => {
            let act = program(folder, args, opts).map_err(did_not_start)?;
            let input = if feeds { Input::Piped } else { Input::Null };
            environment.spawn(&act, input).map_err(did_not_start)?
        }
        None => {
            let command = match opts.signed {
                Some((objects, sign_in)) => {
                    banda_git_cli::signed_fetch(folder, objects, args, sign_in).await
                }
                None => banda_git_cli::bookkeeping_reading(folder, args, opts.reads).await,
            };
            let mut command = command.map_err(did_not_start)?;
            command
                .stdin(if feeds { Stdio::piped() } else { Stdio::null() })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(index) = opts.index {
                command.env("GIT_INDEX_FILE", index);
            }
            command.envs(opts.env.iter().copied());
            Started::spawn(command).map_err(did_not_start)?
        }
    };
    let time = opts.time.unwrap_or(TIME);
    let cap = opts.cap.unwrap_or(OUTPUT);
    let stdin = started.stdin.take();
    let (Some(stdout), Some(stderr)) = (started.stdout.take(), started.stderr.take()) else {
        tracing::warn!(args = %said, "git started without its pipes");
        return Err(Failure(Reason::Other));
    };
    let mut running = Running {
        started: Some(started),
        ended: false,
        left,
    };
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let ran = async {
        let feeding = async {
            if let (Some(mut stdin), Some(bytes)) = (stdin, opts.stdin.as_deref()) {
                // A git that stops reading early says why on stderr.
                let _ = stdin.write_all(bytes).await;
            }
        };
        let reading = capped(stdout, cap, false, &mut out);
        let hearing = capped_lines(stderr, STDERR, opts.lines.as_ref(), &mut err);
        tokio::pin!(feeding, reading, hearing);
        let (mut fed, mut read, mut heard, mut truncated) = (false, false, false, false);
        // It ends as git does, not as its pipes do.
        let exited = loop {
            tokio::select! {
                () = &mut feeding, if !fed => fed = true,
                more = &mut reading, if !read => {
                    read = true;
                    if more {
                        // It has more to say than is kept: stop it, so its
                        // stderr ends too.
                        truncated = true;
                        running.terminate();
                    }
                }
                () = &mut hearing, if !heard => heard = true,
                exited = running.wait() => break exited,
            }
        };
        let rest = async {
            let more = async { !read && reading.await };
            let ended = async {
                if !heard {
                    hearing.await
                }
            };
            tokio::join!(more, ended).0
        };
        truncated |= tokio::time::timeout(LEFT_OPEN, rest).await.unwrap_or(false);
        let success = truncated || exited.is_ok_and(|status| status.success());
        (truncated, success)
    };
    let Ok((truncated, success)) = tokio::time::timeout(time, ran).await else {
        tracing::warn!(args = %said, "git ran past its time and was stopped");
        running.stop().await;
        return Err(Failure(Reason::TimedOut));
    };
    Ok(Ran {
        stdout: out,
        truncated,
        success,
        stderr: err,
        args: said.to_owned(),
    })
}

/// The act `args` asks for in `folder`, as its Project's environment
/// starts it: `opts`'s index and variables over git's own. Its arguments
/// and variables are text, as the methods' params are.
fn program(folder: &Path, args: &[OsString], opts: &Opts) -> io::Result<Program> {
    let text = |said: &OsStr| {
        let text = said.to_str().map(str::to_owned);
        text.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "git takes text here"))
    };
    let args = (args.iter())
        .map(|arg| text(arg))
        .collect::<io::Result<Vec<_>>>()?;
    let mut act = banda_git_cli::asked(folder, args);
    if let Some(index) = opts.index {
        act.env
            .insert("GIT_INDEX_FILE".to_owned(), text(index.as_os_str())?);
    }
    for (name, value) in opts.env {
        act.env.insert((*name).to_owned(), text(value)?);
    }
    Ok(act)
}

/// A git running, with the hooks it runs. Let go before it ended, as when
/// its call is, it is stopped as [`Running::stop`] stops it, meanwhile.
struct Running {
    /// Taken only as it is stopped.
    started: Option<Started>,
    ended: bool,
    /// What an act killed on Windows leaves behind; none elsewhere.
    left: Option<Left>,
}

impl Running {
    fn started(&mut self) -> &mut Started {
        self.started.as_mut().expect("there till it is stopped")
    }

    async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        let exited = self.started().wait().await;
        self.ended = exited.is_ok();
        if self.ended
            && let Some(left) = self.left.take_if(|left| left.killed)
        {
            left.cleared().await;
        }
        exited
    }

    /// Asks it and its hooks to stop: SIGTERM on Unix, on which git takes
    /// its lock files away, as `index.lock`. Windows has no signals: there
    /// it is killed with all it ran, and leaves its lock behind ([`Left`]).
    fn terminate(&mut self) {
        if let Some(left) = &mut self.left {
            left.killed = true;
        }
        self.started().ask_to_stop();
    }

    /// Stops it and its hooks, and waits till it has. A git that ended
    /// by itself took its own lock away: one there now is another's.
    async fn stop(mut self) {
        let left = self.left.take().filter(|_| !self.ended);
        if let Some(started) = self.started.take() {
            stopped(started, left).await;
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let Some(started) = self.started.take() else {
            return;
        };
        if self.ended {
            return;
        }
        // With no runtime to stop it in, it is killed as it is let go of.
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            drop(runtime.spawn(stopped(started, self.left.take())));
        }
    }
}

/// Stops a git and its hooks: asked first, killed if it has not ended
/// soon after. On Windows it is killed at once, and its lock is taken
/// away after it ([`Left`]).
async fn stopped(mut started: Started, left: Option<Left>) {
    let _ = started.stop(STOPPING).await;
    if let Some(left) = left {
        left.cleared().await;
    }
}

/// The git command `args` run, the first of them that is no option, past
/// each `-c`'s value, and the arguments after it.
fn command(args: &[OsString]) -> Option<(&str, &[OsString])> {
    let mut at = 0;
    while let Some(arg) = args.get(at) {
        match arg.as_encoded_bytes() {
            b"-c" => at += 2,
            option if option.starts_with(b"-") => at += 1,
            _ => return Some((arg.to_str()?, &args[at + 1..])),
        }
    }
    None
}

/// Whether git `args` may take the repository's index lock: an act that
/// changes the index, or the work tree through it. A push, a config or an
/// init takes none, so one killed leaves no lock of its own, and any lock
/// there is another git's.
fn takes_index(args: &[OsString]) -> bool {
    const TAKING: [&str; 15] = [
        "add",
        "checkout",
        "cherry-pick",
        "commit",
        "merge",
        "mv",
        "pull",
        "rebase",
        "reset",
        "restore",
        "revert",
        "rm",
        "stash",
        "switch",
        "update-index",
    ];
    match command(args) {
        // `apply` changes the index only when told to.
        Some(("apply", rest)) => rest.iter().any(|arg| arg == "--cached" || arg == "--index"),
        Some((command, _)) => TAKING.contains(&command),
        None => false,
    }
}

/// Whether git `args`, an act that found the index lock held, did nothing
/// and may simply run again: one that takes the lock before it changes
/// anything, a hook's commit too, which takes it before the hook runs. A
/// pull, a merge, a rebase, a cherry-pick, a revert or a stash go in
/// steps, and are left to the Person to try again.
fn tries_again(args: &[OsString]) -> bool {
    const AT_ONCE: [&str; 9] = [
        "add", "apply", "checkout", "commit", "mv", "reset", "restore", "rm", "switch",
    ];
    takes_index(args) && command(args).is_some_and(|(command, _)| AT_ONCE.contains(&command))
}

/// The index lock an act takes, which one killed on Windows leaves behind
/// (ADR 0090, decision 3): removed once it ended, if it is still there and
/// was made since it started, tried for a few seconds while the rest of
/// its Job Object ends. Only for an act that takes the lock
/// ([`takes_index`]). Banda's own git takes none on the repository's
/// index: it takes no optional lock, and writes a scratch index of its
/// own.
#[derive(Debug)]
struct Left {
    folder: PathBuf,
    index: Option<PathBuf>,
    started: SystemTime,
    /// It was killed, never asked to stop.
    killed: bool,
}

impl Left {
    /// What an act about to start in `folder`, on `index` when one is
    /// named, may leave behind.
    fn of(folder: &Path, index: Option<&Path>) -> Left {
        Left {
            folder: folder.to_owned(),
            index: index.map(Path::to_owned),
            started: SystemTime::now(),
            killed: false,
        }
    }

    /// Removes its lock, once the git that was killed ended.
    async fn cleared(self) {
        let removed = tokio::task::spawn_blocking(move || {
            let lock = banda_git_cli::index_lock(&self.folder, self.index.as_deref())?;
            banda_git_cli::remove_stale_lock(&lock, self.started).then_some(lock)
        });
        if let Ok(Some(lock)) = removed.await {
            tracing::info!(lock = %lock.display(), "a killed git's lock was removed");
        }
    }
}

/// Up to `cap` bytes of `from` into `kept`, read to its end; each line
/// said to `lines` as it comes, past the cap too.
async fn capped_lines(
    from: impl AsyncRead + Unpin,
    cap: usize,
    lines: Option<&mpsc::UnboundedSender<String>>,
    kept: &mut Vec<u8>,
) {
    let Some(lines) = lines else {
        capped(from, cap, true, kept).await;
        return;
    };
    let mut from = tokio::io::BufReader::new(from);
    let mut line = Vec::new();
    loop {
        line.clear();
        // A line ends at `\n`; one a progress meter redraws with `\r`
        // comes whole once it ends.
        match tokio::io::AsyncBufReadExt::read_until(&mut from, b'\n', &mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let room = cap - kept.len();
        kept.extend_from_slice(&line[..line.len().min(room)]);
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

/// Up to `cap` bytes of `from` into `kept`, and whether it had more.
/// Past the cap it stops reading, or with `drain` reads on to the end and
/// keeps none of it. What it read stays in `kept` if it is dropped.
async fn capped(
    mut from: impl AsyncRead + Unpin,
    cap: usize,
    drain: bool,
    kept: &mut Vec<u8>,
) -> bool {
    let mut more = false;
    let mut chunk = vec![0; 64 * 1024];
    loop {
        let n = match from.read(&mut chunk).await {
            Ok(0) | Err(_) => return more,
            Ok(n) => n,
        };
        let room = cap - kept.len();
        kept.extend_from_slice(&chunk[..n.min(room)]);
        if n > room {
            more = true;
            if !drain {
                return more;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use banda_environments::Local;

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
        let pull = "error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\n";
        assert_eq!(Reason::of(pull), Reason::WouldLose);
        let owned = "fatal: detected dubious ownership in repository at '/r'\n";
        assert_eq!(Reason::of(owned), Reason::Untrusted);
        let topic = |folder: &str| Reason::CheckedOut {
            branch: "topic".into(),
            folder: folder.into(),
        };
        let used = "fatal: 'topic' is already used by worktree at '/w x'\n";
        assert_eq!(Reason::of(used), topic("/w x"));
        let older = "fatal: 'topic' is already checked out at '/w'\n";
        assert_eq!(Reason::of(older), topic("/w"));
    }

    /// A repository in a folder of its own, its one file committed and
    /// changed since, with `hook` as its pre-commit hook.
    #[cfg(unix)]
    fn with_hook(hook: &str) -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            let ran = std::process::Command::new("git")
                .args(args)
                .current_dir(folder.path())
                .output()
                .unwrap();
            assert!(ran.status.success(), "{args:?}");
        };
        run(&["init", "--quiet"]);
        run(&["config", "user.name", "Ann"]);
        run(&["config", "user.email", "ann@example.com"]);
        run(&["config", "commit.gpgsign", "false"]);
        std::fs::write(folder.path().join("a.txt"), "one\n").unwrap();
        run(&["add", "a.txt"]);
        run(&["commit", "--quiet", "-m", "first"]);
        let file = folder.path().join(".git/hooks/pre-commit");
        std::fs::write(&file, hook).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(folder.path().join("a.txt"), "two\n").unwrap();
        folder
    }

    #[cfg(unix)]
    const COMMIT: [&str; 4] = ["commit", "--quiet", "-am", "second"];

    #[cfg(unix)]
    #[tokio::test]
    async fn a_git_past_its_time_is_stopped_and_takes_its_lock_away() {
        let folder = with_hook("#!/bin/sh\nsleep 30\n");
        let began = std::time::Instant::now();
        let opts = Opts {
            time: Some(Duration::from_secs(1)),
            ..Opts::asked(&Local)
        };
        let ran = git(folder.path(), COMMIT, opts).await;
        assert_eq!(ran.err(), Some(Failure(Reason::TimedOut)));
        assert!(began.elapsed() < Duration::from_secs(10));
        assert!(!folder.path().join(".git/index.lock").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_git_ends_as_it_exits_though_its_hook_left_a_child_with_its_stderr() {
        let folder = with_hook("#!/bin/sh\nsleep 30 >&2 &\necho checked >&2\n");
        let began = std::time::Instant::now();
        let ran = git(folder.path(), COMMIT, Opts::asked(&Local))
            .await
            .unwrap();
        assert!(ran.success);
        assert!(began.elapsed() < Duration::from_secs(10));
        assert_eq!(ran.last_line().as_deref(), Some("checked"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_act_asked_for_runs_the_hooks_and_bandas_own_git_runs_none() {
        let folder = with_hook("#!/bin/sh\necho checked >&2\nexit 1\n");
        let asked = git(folder.path(), COMMIT, Opts::asked(&Local))
            .await
            .unwrap();
        assert!(!asked.success);
        assert_eq!(asked.last_line().as_deref(), Some("checked"));
        let own = git(folder.path(), COMMIT, Opts::default()).await.unwrap();
        assert!(own.success && own.quiet());
    }

    #[test]
    fn only_an_act_that_changes_the_index_may_leave_its_lock() {
        let takes = |args: &[&str]| {
            let args: Vec<OsString> = args.iter().map(OsString::from).collect();
            takes_index(&args)
        };
        assert!(takes(&["commit", "--quiet", "--file=-"]));
        assert!(takes(&["--literal-pathspecs", "add", "--all"]));
        assert!(takes(&["-c", "core.preloadIndex=false", "add"]));
        assert!(takes(&["checkout", "--quiet", "-b", "topic", "--"]));
        assert!(takes(&["apply", "--unidiff-zero", "--cached"]));
        assert!(!takes(&["apply", "--unidiff-zero", "--reverse"]));
        assert!(!takes(&[
            "push",
            "--quiet",
            "--",
            "origin",
            "HEAD:refs/heads/a"
        ]));
        assert!(!takes(&["config", "branch.a.remote", "origin"]));
        assert!(!takes(&["init", "--quiet"]));
        assert!(!takes(&["-c", "commit", "status"]));
    }

    #[test]
    fn only_an_act_that_takes_the_lock_before_it_changes_anything_tries_again() {
        let tries = |args: &[&str]| {
            let args: Vec<OsString> = args.iter().map(OsString::from).collect();
            tries_again(&args)
        };
        assert!(tries(&["apply", "--unidiff-zero", "--cached"]));
        assert!(tries(&["commit", "--quiet", "--file=-"]));
        assert!(tries(&["--literal-pathspecs", "add", "--all"]));
        assert!(tries(&[
            "-c",
            "core.preloadIndex=false",
            "reset",
            "--quiet"
        ]));
        assert!(!tries(&["apply", "--unidiff-zero", "--reverse"]));
        assert!(!tries(&["pull", "--quiet"]));
        assert!(!tries(&["rebase", "main"]));
        assert!(!tries(&["stash", "push"]));
        assert!(!tries(&["push", "--quiet", "--", "origin", "HEAD"]));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_act_waits_out_a_lock_another_git_holds_a_moment() {
        let folder = with_hook("#!/bin/sh\n");
        let lock = folder.path().join(".git/index.lock");
        std::fs::write(&lock, "").unwrap();
        let freed = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            std::fs::remove_file(lock).unwrap();
        });
        let ran = git(folder.path(), ["add", "a.txt"], Opts::asked(&Local))
            .await
            .unwrap();
        freed.await.unwrap();
        assert!(ran.success);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_act_whose_lock_stays_held_says_so_after_its_tries() {
        let folder = with_hook("#!/bin/sh\n");
        std::fs::write(folder.path().join(".git/index.lock"), "").unwrap();
        let began = std::time::Instant::now();
        let ran = git(folder.path(), ["add", "a.txt"], Opts::asked(&Local))
            .await
            .unwrap();
        assert!(!ran.success);
        assert_eq!(ran.reason(), Reason::Locked);
        assert!(began.elapsed() >= LOCKED.iter().sum());
        // Banda's own git does not wait for it.
        let began = std::time::Instant::now();
        let own = git(folder.path(), ["add", "a.txt"], Opts::default())
            .await
            .unwrap();
        assert_eq!(own.reason(), Reason::Locked);
        assert!(began.elapsed() < LOCKED[0] * 4);
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
