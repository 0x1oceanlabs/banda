//! How Banda starts the `git` program in a folder: for its own
//! bookkeeping ([`bookkeeping`]), on the host and behind the fence where
//! it holds (ADR 0083), or for an act the Person
//! asked for ([`asked`]), which its Project's environment starts (ADR
//! 0084, decision 8).
//!
//! Bookkeeping is what Banda runs by itself: a status, a diff, a
//! checkpoint under Banda's own refs, a watch and the fetch it runs, a
//! log, an ignore check, a remote's address. A repository's hooks and
//! config are its Project's, which an Agent may write, so Banda's own git
//! runs no program they name. Whatever the repository says, it runs no
//! hook of any event, no file system monitor, no pager, no external diff,
//! no command that lists an alternate's refs, no signature check, no gc
//! and no maintenance; it fetches no object it lacks, and reaches no
//! remote but in a fetch, which goes over git's own transports with git's
//! own upload-pack, the Person's own ssh and credential helpers, and no
//! proxy command. Every filter driver, diff driver and hook that git's
//! config names as it is read just before is blanked too. The rest of the
//! Person's config holds: their name, the remotes, what they ignore;
//! where the guard holds, of the home's only what Banda carries over.
//!
//! It needs git 2.31 or later: on an older one, none starts. A fetch
//! needs one that takes `GIT_NO_LAZY_FETCH` too, 2.45 or later or a
//! release of 2.39 to 2.44 from May 2024 on: on another, no fetch starts.
//!
//! What this holds only with its callers, or not at all:
//! - Filter drivers are blanked by the names the config held as it was
//!   read, just before git starts. Diff drivers and hooks need no name: a
//!   diff asks for git's own patch (`--no-ext-diff --no-textconv`), and
//!   every hook event is off.
//! - A submodule's own config is not read, so a status or a diff looks
//!   into no submodule's work tree (`--ignore-submodules=dirty`).
//! - A blanked filter leaves a file's bytes as they are on disk, so what
//!   keeps objects leaves out each file whose `filter` is set or has a
//!   value (`git check-attr`).
//! - A fetch takes the Person's own ssh command and credential helpers,
//!   never the repository's, so one that needs the repository's fails.
//!   Where the fence holds, it takes only the system's, and ssh reads no
//!   config of the Person's (ADR 0083, F0-3a).
//! - Where the guard holds, git reads none of the home's config but the
//!   values Banda carries over by name (what the Person ignores, how
//!   line ends read, the folders they trust), and a fetch reaches only
//!   remotes over the network unless the fence holds too.
//! - A fetch from github.com over https may sign in with the Person's
//!   token, which Banda reads itself ([`signed_fetch`]): into a
//!   repository of Banda's own, whose config only Banda writes and which
//!   borrows the Project's objects, with git's tracing off, and from there
//!   into the Project's with no token.
//!
//! An act the Person asked for, as a commit, a push, a pull or a switch,
//! runs as their own git does: hooks, filters, signing and all.
//!
//! Either way git asks nothing on a terminal, takes no optional lock, so
//! a read beside the Person's own git never takes `.git/index.lock`,
//! speaks in C's words, and takes nothing from the engine's environment
//! that points it at another repository, as when the engine runs inside
//! a git hook.

use banda_kernel::{Program, Started};
use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime};
use tokio::process::Command;

/// What git would take from the engine's environment that points it at
/// another repository or another config (`git rev-parse
/// --local-env-vars`), and an external diff.
const ELSEWHERE: [&str; 16] = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    "GIT_EXTERNAL_DIFF",
];

/// What every git runs with: in C's words, asking nothing on a terminal
/// and taking no optional lock.
const EVERY: [(&str, &str); 3] = [
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GIT_TERMINAL_PROMPT", "0"),
    ("LC_ALL", "C"),
];

/// What every bookkeeping git runs with besides, whatever the repository
/// says: no password asked, by git, a credential manager or ssh; no proxy
/// command; no object it lacks fetched; and no remote reached, whatever
/// `protocol.*` allows, but by a fetch ([`TRANSPORTS`]).
const UNASKED: [(&str, &str); 7] = [
    ("GCM_INTERACTIVE", "never"),
    ("GIT_ASKPASS", ""),
    ("SSH_ASKPASS", ""),
    ("SSH_ASKPASS_REQUIRE", "never"),
    ("GIT_PROXY_COMMAND", ""),
    ("GIT_NO_LAZY_FETCH", "1"),
    ("GIT_ALLOW_PROTOCOL", ""),
];

/// What every bookkeeping git runs with besides: no trace of git's own
/// written anywhere, whatever a config of the home's says
/// (`trace2.*Target`).
const UNTRACED: [(&str, &str); 3] = [
    ("GIT_TRACE2", "0"),
    ("GIT_TRACE2_EVENT", "0"),
    ("GIT_TRACE2_PERF", "0"),
];

/// The transports a fetch Banda runs by itself goes over: git's own, and
/// none a repository's config names a helper for.
const TRANSPORTS: &str = "file:git:http:https:ssh";

/// The transports where the fence holds and Banda's own git runs outside
/// it, as where the fence was set up and failed: none to a repository on
/// this disk, which git would read on the host as well.
const REMOTE_TRANSPORTS: &str = "git:http:https:ssh";

/// The one transport of a fetch that signs in ([`signed_fetch`]).
const SIGNED_TRANSPORT: &str = "https";

/// What a bookkeeping git reads for its home's config where the fence
/// holds: none, as the home's is an Agent's to write as much as a
/// repository's is ([`carried`] says what is kept of it).
const NO_HOME_CONFIG: (&str, &str) = ("GIT_CONFIG_GLOBAL", "/dev/null");

/// What a fetch Banda runs by itself takes after `fetch`: git's own
/// upload-pack. A remote's `uploadpack` is the first git reads, so no
/// config overrides the repository's.
const UPLOAD_PACK: &str = "--upload-pack=git-upload-pack";

/// Every hook event githooks(5) names: each is off, whatever hooks it
/// has in a hooks folder or in git's config.
const EVENTS: [&str; 28] = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-receive",
    "update",
    "proc-receive",
    "post-receive",
    "post-update",
    "reference-transaction",
    "push-to-checkout",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "fsmonitor-watchman",
    "p4-changelist",
    "p4-prepare-changelist",
    "p4-post-changelist",
    "p4-pre-submit",
    "post-index-change",
];

/// What every bookkeeping git is configured with, whatever the
/// repository says, besides its hook events and its hooks folder
/// ([`no_hooks`]): no file system monitor, by an empty value, as a git
/// before 2.36 runs the program `false` names; no
/// signature checked as a log reads; no external diff, which a diff asked
/// for git's own patch skips and any other fails on; a submodule's change
/// as its commits, not its diff, which runs in the submodule; no command
/// that lists an alternate's refs; no submodule fetched, as each has
/// config of its own; no gc nor maintenance after it; and [`LONG_PATHS`].
const ALWAYS: [(&str, &str); 9] = [
    LONG_PATHS,
    ("core.fsmonitor", ""),
    ("log.showSignature", "false"),
    ("diff.external", ""),
    ("diff.submodule", "short"),
    ("core.alternateRefsCommand", ""),
    ("fetch.recurseSubmodules", "false"),
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
];

/// Paths longer than Windows' old limit of 260, as a deep `node_modules`
/// has: Git for Windows takes none without it, and every other git ignores
/// it. An act gets it on Windows alone.
const LONG_PATHS: (&str, &str) = ("core.longpaths", "true");

/// The hooks folder of a bookkeeping git, where it finds none: on Linux
/// and macOS `/dev/null`, where no folder can be. Git for Windows reads
/// that as `\dev\null` on the current drive, which anyone may make, so
/// there it is an empty folder of Banda's own: the one the engine named as
/// it started ([`no_hooks_in`]), in its state; else `banda-no-hooks` in
/// the temporary folder, emptied as it is first named (ADR 0090, decision
/// 3).
#[cfg(not(windows))]
fn no_hooks() -> io::Result<Vec<u8>> {
    Ok(b"/dev/null".to_vec())
}

#[cfg(windows)]
fn no_hooks() -> io::Result<Vec<u8>> {
    let folder = match NO_HOOKS.get() {
        Some(folder) => folder,
        None => {
            let folder = std::env::temp_dir().join("banda-no-hooks");
            emptied(&folder)?;
            NO_HOOKS.get_or_init(|| folder)
        }
    };
    let text = folder.to_str().map(|text| text.as_bytes().to_vec());
    text.ok_or_else(unreadable)
}

/// The empty folder [`no_hooks`] names on Windows.
#[cfg(windows)]
static NO_HOOKS: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Makes `folder` the hooks folder of every bookkeeping git on Windows,
/// made there and emptied: the engine names one in its state as it
/// starts, before any git.
#[cfg(windows)]
pub fn no_hooks_in(folder: &Path) -> io::Result<()> {
    emptied(folder)?;
    let _ = NO_HOOKS.set(folder.to_owned());
    Ok(())
}

/// Makes `folder`, empty.
#[cfg(windows)]
fn emptied(folder: &Path) -> io::Result<()> {
    match std::fs::remove_dir_all(folder) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    std::fs::create_dir_all(folder)
}

/// What the config is read for first, by git's lowercase names: every
/// filter driver, diff driver's text conversion and command, and hook it
/// names; the Person's own ssh command and credential helpers; what is
/// kept of the home's where the fence holds ([`CARRIED`]); and [`PROBE`].
const NAMING: &str = r"^filter\.|^diff\..+\.(textconv|command)$|^hook\.|^core\.sshcommand$|^credential\..*helper$|^core\.(excludesfile|attributesfile|autocrlf|eol)$|^safe\.directory$|^banda\.probe$";

/// What is kept of the home's config where the fence holds and git reads
/// none of it, as git's lowercase names: what the Person ignores and how
/// their files' attributes and line ends read, which change what a status
/// says, and the folders they trust that another user owns. Each names a
/// file to read, or a word, and no program.
const CARRIED: [&str; 5] = [
    "core.excludesfile",
    "core.attributesfile",
    "core.autocrlf",
    "core.eol",
    "safe.directory",
];

/// A setting the config read is given through its environment, as every
/// override after it is (`GIT_CONFIG_COUNT`): a git that does not list it
/// back, one older than 2.31, would take none of them, so none starts.
const PROBE: &str = "banda.probe";

/// How long the config is read at most, and how long git is asked
/// whether it takes `GIT_NO_LAZY_FETCH`.
const READING: Duration = Duration::from_secs(10);

/// An object no repository holds.
const LACKED: &str = "0123456789abcdef0123456789abcdef01234567";

/// git in `dir` running `args` for an act the Person asked for, as their
/// own git runs it: a [`Program`] for the Project's environment to start,
/// outside the fence (ADR 0083, decision 1).
pub fn asked<I, S>(dir: &Path, args: I) -> Program
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args = args.into_iter().map(|arg| arg.as_ref().to_owned());
    let mut program = Program::act("git", args.collect());
    program.env = (EVERY.iter())
        .map(|&(name, value)| (name.to_owned(), value.to_owned()))
        .collect();
    program.unset = ELSEWHERE.map(str::to_owned).to_vec();
    #[cfg(windows)]
    program.env.extend(
        [
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_CONFIG_KEY_0", LONG_PATHS.0),
            ("GIT_CONFIG_VALUE_0", LONG_PATHS.1),
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned())),
    );
    program.cwd = Some(dir.to_owned());
    program
}

/// git in `dir` running `args`, which name its subcommand, for Banda's
/// own bookkeeping: it runs no program the repository names (the crate's
/// doc says how far that holds), and where the fence holds it starts
/// behind it ([`banda_kernel::host::books`]), so what it runs all the same
/// reaches no more than an Agent does. A fetch is the one that reaches a
/// remote, over git's own transports with git's own upload-pack, and only
/// on a git that takes `GIT_NO_LAZY_FETCH` ([`lazy_fetch_off`]). The
/// repository's config is read first, for the names of its drivers and
/// hooks and the Person's own network config; when it cannot be read, as
/// when it is malformed, past [`READING`] or git is too old, no git
/// starts. Its stdio and the rest are the caller's.
pub async fn bookkeeping<I, S>(dir: &Path, args: I) -> io::Result<Command>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    bookkeeping_reading(dir, args, &[]).await
}

/// [`bookkeeping`], with `reads`, folders the fence hides, opened to it to
/// read where it starts behind the fence: a repository of Banda's own
/// that a fetch takes from ([`signed_fetch`]).
pub async fn bookkeeping_reading<I, S>(
    dir: &Path,
    args: I,
    reads: &[PathBuf],
) -> io::Result<Command>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let listed = tokio::time::timeout(READING, configured(dir))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "git's config took too long"))??;
    let mut args: Vec<OsString> = args.into_iter().map(|a| a.as_ref().to_owned()).collect();
    let fetch = subcommand(&args).filter(|at| args[*at] == "fetch");
    let git_ssh = std::env::var_os("GIT_SSH");
    let guarded = banda_kernel::host::guarded();
    let config = overrides(&listed, git_ssh.as_deref(), guarded)?;
    let mut git = own(dir, guarded)?;
    configure(&mut git, config)?;
    if let Some(at) = fetch {
        lazy_fetch_needed().await?;
        args.insert(at + 1, UPLOAD_PACK.into());
        let fenced = banda_kernel::host::books_fenced();
        git.env("GIT_ALLOW_PROTOCOL", transports(guarded, fenced));
    }
    git.args(args);
    banda_kernel::host::books(git, reads)
}

/// The transports a bookkeeping fetch goes over: every one of git's own,
/// but where the fence holds (`guarded`) and git runs outside it
/// (`fenced` not), none to a repository on this disk.
fn transports(guarded: bool, fenced: bool) -> &'static str {
    match guarded && !fenced {
        true => REMOTE_TRANSPORTS,
        false => TRANSPORTS,
    }
}

/// What a fetch signs in to a remote on github.com with, over https: the
/// Person's token, which Banda reads itself, never through a helper a
/// config names (ADR 0083). It goes to the remote at `url` alone, as its
/// `http.<url>.extraHeader` ([`signed_fetch`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignIn {
    /// The remote's address, as git reaches it: `https://github.com/…`.
    pub url: String,
    /// The account's login, when known.
    pub user: Option<String>,
    pub token: String,
}

/// Whether `url` is a repository on github.com over https, which a fetch
/// may sign in to ([`SignIn`]).
pub fn on_github(url: &str) -> bool {
    const GITHUB: &str = "https://github.com/";
    url.get(..GITHUB.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(GITHUB))
        && url.len() > GITHUB.len()
        && url.bytes().all(|b| b.is_ascii_graphic())
}

/// git running `args`, a fetch from `sign_in`'s remote that signs in with
/// the Person's token, into a repository of Banda's own at `shadow`,
/// which borrows the objects of the repository whose objects are in
/// `objects` (`objects/info/alternates`), so it fetches only what that one
/// lacks. Banda makes it, writes its whole config and keeps it in its own
/// state, which the fence hides: the git that holds the token reads no
/// config an Agent writes, neither the home's nor a repository's, and no
/// hook, so nothing an Agent wrote changes where the token goes or how
/// the remote's certificate is checked; only the system's config holds. It
/// goes over https alone, asks for nothing, and traces nothing. It starts
/// on the host: a bookkeeping fetch of the repository's own then takes
/// what it fetched from `shadow`, behind the fence where it holds
/// ([`bookkeeping_reading`]), with no token.
pub async fn signed_fetch<I, S>(
    shadow: &Path,
    objects: &Path,
    args: I,
    sign_in: &SignIn,
) -> io::Result<Command>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    if !on_github(&sign_in.url) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Banda's own fetch signs in only to github.com over https",
        ));
    }
    let args: Vec<OsString> = args.into_iter().map(|a| a.as_ref().to_owned()).collect();
    if subcommand(&args).is_none_or(|at| args[at] != "fetch") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "only a fetch signs in",
        ));
    }
    lazy_fetch_needed().await?;
    shadow_made(shadow, objects)?;
    let mut git = base(shadow)?;
    git.arg("--no-pager")
        .envs(UNASKED)
        .envs(UNTRACED)
        .envs([NO_HOME_CONFIG])
        .env("GIT_ALLOW_PROTOCOL", SIGNED_TRANSPORT)
        .arg("--git-dir")
        .arg(shadow);
    let mut config = always()?;
    let mut set = |key: Vec<u8>, value: &[u8]| config.push((key, value.to_vec()));
    set(b"credential.helper".to_vec(), b"");
    let header = [b"http.", sign_in.url.as_bytes(), b".extraHeader"].concat();
    set(header.clone(), b"");
    set(header, authorization(sign_in).as_bytes());
    configure(&mut git, config)?;
    git.args(args);
    Ok(git)
}

/// Makes the repository of Banda's own at `shadow` ([`signed_fetch`]),
/// or makes it again: bare, its config Banda's alone, its objects
/// borrowed from `objects`, and its own folder this user's alone.
fn shadow_made(shadow: &Path, objects: &Path) -> io::Result<()> {
    let mut folders = std::fs::DirBuilder::new();
    folders.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut folders, 0o700);
    for folder in ["objects/info", "refs/heads", "refs/remotes"] {
        folders.create(shadow.join(folder))?;
    }
    let objects = objects.to_str().filter(|text| !text.contains('\n'));
    let objects = objects.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the repository's objects are where git names no alternate",
        )
    })?;
    std::fs::write(shadow.join("HEAD"), "ref: refs/heads/main\n")?;
    std::fs::write(
        shadow.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
    )?;
    std::fs::write(
        shadow.join("objects/info/alternates"),
        format!("{objects}\n"),
    )
}

/// The lock file git takes on the index as it changes it, for the
/// repository `dir` is in, or on `index` when one is named
/// (`GIT_INDEX_FILE`, from `dir`): `index.lock` beside it. None when `dir`
/// is in no repository.
pub fn index_lock(dir: &Path, index: Option<&Path>) -> Option<PathBuf> {
    let index = match index {
        Some(index) => dir.join(index),
        None => git_dir(dir)?.join("index"),
    };
    let mut lock = index.into_os_string();
    lock.push(".lock");
    Some(lock.into())
}

/// The folder git keeps the repository `dir` is in: the nearest `.git`
/// folder, or the folder the nearest `.git` file names, as a worktree's
/// and a submodule's do.
fn git_dir(dir: &Path) -> Option<PathBuf> {
    for folder in dir.ancestors() {
        let dot = folder.join(".git");
        let Ok(meta) = std::fs::metadata(&dot) else {
            continue;
        };
        if meta.is_dir() {
            return Some(dot);
        }
        let text = std::fs::read_to_string(&dot).ok()?;
        let named = text.lines().next()?.strip_prefix("gitdir:")?.trim();
        return Some(folder.join(named));
    }
    None
}

/// How much earlier than a git's start its lock may say it was made: the
/// disk's clock ticks more coarsely than the engine's.
const TICK: Duration = Duration::from_millis(100);

/// Removes `lock` ([`index_lock`]), which a git that was killed left
/// behind, if it is there and was made since `started`, as that git
/// started: a lock older than it is another git's. On Windows git is
/// killed, never asked to stop first, so it never takes its lock away
/// itself (ADR 0090, decision 3). When it was made is the later of its
/// creation and its last write: NTFS gives a file made where one was just
/// removed the creation time of the one before. A lock still held, by the
/// real git behind Git for Windows' launcher as its Job Object ends, or
/// by an antivirus reading it, is tried again for a few seconds
/// ([`banda_kernel::host::remove_left`]). Says whether it removed it.
pub fn remove_stale_lock(lock: &Path, started: SystemTime) -> bool {
    let made = std::fs::symlink_metadata(lock).and_then(|meta| {
        let modified = meta.modified()?;
        Ok(meta
            .created()
            .map_or(modified, |created| created.max(modified)))
    });
    let since = started.checked_sub(TICK).unwrap_or(started);
    made.is_ok_and(|made| made >= since) && banda_kernel::host::remove_left(lock).is_ok()
}

/// git in `dir` as every git starts: as [`EVERY`] says, taking nothing
/// [`ELSEWHERE`], found as the host finds the engine's own programs, and
/// stopped once its caller lets go of it ([`banda_kernel::host::own`]).
fn base(dir: &Path) -> io::Result<Command> {
    let mut git = banda_kernel::host::own("git")?;
    git.current_dir(dir).envs(EVERY);
    for name in ELSEWHERE {
        git.env_remove(name);
    }
    Ok(git)
}

/// git in `dir` as every bookkeeping git reads its config: asking
/// nothing and tracing nothing ([`UNASKED`], [`UNTRACED`]).
fn reading(dir: &Path) -> io::Result<Command> {
    let mut git = base(dir)?;
    git.arg("--no-pager").envs(UNASKED).envs(UNTRACED);
    Ok(git)
}

/// git in `dir` as every bookkeeping git starts, before its config: as
/// [`reading`] starts it, and where the fence holds (`guarded`) reading
/// none of the home's config ([`NO_HOME_CONFIG`]).
fn own(dir: &Path, guarded: bool) -> io::Result<Command> {
    let mut git = reading(dir)?;
    if guarded {
        git.envs([NO_HOME_CONFIG]);
    }
    Ok(git)
}

/// `config` given to `git` as `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and
/// `GIT_CONFIG_VALUE_<n>` take it: after every config git reads, so it
/// wins over each.
fn configure(git: &mut Command, config: Vec<(Vec<u8>, Vec<u8>)>) -> io::Result<()> {
    git.env("GIT_CONFIG_COUNT", config.len().to_string());
    for (at, (key, value)) in config.into_iter().enumerate() {
        git.env(format!("GIT_CONFIG_KEY_{at}"), os(key)?)
            .env(format!("GIT_CONFIG_VALUE_{at}"), os(value)?);
    }
    Ok(())
}

/// Fails when git would fetch an object it lacks for a fetch Banda runs
/// by itself ([`lazy_fetch_off`]).
async fn lazy_fetch_needed() -> io::Result<()> {
    match lazy_fetch_off().await? {
        true => Ok(()),
        false => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "git takes no GIT_NO_LAZY_FETCH: Banda's own fetch needs git 2.45 or later, \
             or a release of 2.39 to 2.44 from May 2024 on",
        )),
    }
}

/// Whether git takes `GIT_NO_LAZY_FETCH`, as it says by starting no other
/// git as it reads an object it lacks, in a repository of its own whose
/// objects a remote that no transport reaches lends. A read reaches no
/// remote to fetch one from, while a fetch does. Once known, it is known
/// for the engine's life.
async fn lazy_fetch_off() -> io::Result<bool> {
    static KNOWN: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();
    let asked = || async {
        tokio::time::timeout(READING, starts_no_lazy_fetch())
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "git took too long"))?
    };
    KNOWN.get_or_try_init(asked).await.copied()
}

/// What [`lazy_fetch_off`] asks git, in a folder of its own, its trace
/// read for a git it started (`GIT_TRACE2_EVENT`).
async fn starts_no_lazy_fetch() -> io::Result<bool> {
    let folder = tempfile::Builder::new()
        .prefix("banda-git-lazy-")
        .tempdir()?;
    let repo = folder.path().join("repo");
    for made in ["objects", "refs"] {
        std::fs::create_dir_all(repo.join(made))?;
    }
    std::fs::write(repo.join("HEAD"), "ref: refs/heads/main\n")?;
    std::fs::write(
        repo.join("config"),
        "[core]\n\trepositoryformatversion = 1\n\tbare = true\n\
         [extensions]\n\tpartialclone = none\n\
         [remote \"none\"]\n\turl = ./none\n",
    )?;
    let trace = folder.path().join("trace");
    let mut probe = reading(folder.path())?;
    probe
        .arg("--git-dir")
        .arg(&repo)
        .args(["cat-file", "-e", LACKED])
        .env("GIT_TRACE2_EVENT", &trace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Started::spawn(probe)?.wait().await?;
    let traced = std::fs::read_to_string(&trace)?;
    Ok(!traced.is_empty() && !traced.contains("\"child_start\""))
}

/// Where the subcommand is in `args`: the first that is no option, past
/// each `-c`'s value. Another option's value that stands apart, as `-C`'s,
/// is taken for it, so a fetch behind one reaches no remote.
fn subcommand(args: &[OsString]) -> Option<usize> {
    let mut at = 0;
    while let Some(arg) = args.get(at) {
        match arg.as_encoded_bytes() {
            b"-c" => at += 2,
            option if option.starts_with(b"-") => at += 1,
            _ => return Some(at),
        }
    }
    None
}

/// The config of `dir` that [`NAMING`] matches, as `git config
/// --show-scope -z` lists it.
async fn configured(dir: &Path) -> io::Result<Vec<u8>> {
    let mut read = reading(dir)?;
    read.env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", PROBE)
        .env("GIT_CONFIG_VALUE_0", "true")
        .args(["config", "--show-scope", "-z", "--get-regexp", NAMING])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let read = Started::spawn(read)?.wait_with_output().await?;
    match read.status.code() {
        // 1: none is set, as only a git that took no probe says.
        Some(0 | 1) => Ok(read.stdout),
        _ => {
            let said = String::from_utf8_lossy(&read.stderr);
            Err(io::Error::other(format!(
                "git could not read its config: {}",
                said.trim()
            )))
        }
    }
}

/// What a bookkeeping git is configured with, as `GIT_CONFIG_KEY_<n>` and
/// `GIT_CONFIG_VALUE_<n>` take it, after the config [`configured`] read;
/// `git_ssh` is the engine's `GIT_SSH`. `guarded` says that the fence
/// holds ([`banda_kernel::host::guard`]): then git reads none of the
/// home's config ([`own`]), which is not taken as the Person's own, no more
/// than the repository's, and only what [`CARRIED`] names of it is given
/// back.
///
/// First [`always`]. Then the Person's own network: their ssh command,
/// from their config (system, or global where not `guarded`), else
/// `GIT_SSH`'s program, else `ssh` (their `GIT_SSH_COMMAND` wins over it
/// as it is), which reads no config in the home where `guarded`; and
/// their credential helpers alone. Then what the config names: every
/// filter driver blanked, which need not run; every diff driver's text
/// conversion and command blanked, so a git that would run one fails
/// instead; and every hook off.
fn overrides(
    listed: &[u8],
    git_ssh: Option<&OsStr>,
    guarded: bool,
) -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
    let (mut filters, mut diffs, mut hooks) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let mut persons_ssh: Option<&[u8]> = None;
    let mut persons_helpers: Vec<(&[u8], &[u8])> = Vec::new();
    let mut carried: Vec<(&[u8], &[u8])> = Vec::new();
    let mut probed = false;
    let mut fields = listed.split(|b| *b == 0);
    while let Some(scope) = fields.next().filter(|scope| !scope.is_empty()) {
        let entry = fields.next().ok_or_else(unreadable)?;
        let (key, value) = match entry.iter().position(|b| *b == b'\n') {
            Some(at) => (&entry[..at], &entry[at + 1..]),
            None => (entry, &b""[..]),
        };
        let persons = scope == b"system" || (scope == b"global" && !guarded);
        let first = key.iter().position(|b| *b == b'.').ok_or_else(unreadable)?;
        let last = key.iter().rposition(|b| *b == b'.').unwrap_or(first);
        let (section, variable) = (&key[..first], &key[last + 1..]);
        let sub = (first < last).then(|| &key[first + 1..last]);
        match (section, sub, variable) {
            (b"filter", Some(driver), _) => {
                filters.insert(driver);
            }
            (b"diff", Some(driver), _) => {
                diffs.insert(driver);
            }
            (b"hook", Some(name), _) => {
                hooks.insert(name);
            }
            (b"core", None, b"sshcommand") if persons => persons_ssh = Some(value),
            (b"credential", _, b"helper") if persons => persons_helpers.push((key, value)),
            (b"banda", None, b"probe") => probed |= scope == b"command",
            _ if guarded && scope == b"global" && CARRIED.iter().any(|c| c.as_bytes() == key) => {
                carried.push((key, value));
            }
            _ => {}
        }
    }
    if !probed {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "git took no config from its environment: Banda's own git needs git 2.31 or later",
        ));
    }
    let mut config = always()?;
    let mut set = |parts: &[&[u8]], value: &[u8]| config.push((parts.concat(), value.to_vec()));
    let ssh = match (persons_ssh, git_ssh) {
        (Some(command), _) => command.to_vec(),
        (None, Some(program)) if !program.is_empty() => quoted(program.as_encoded_bytes()),
        (None, _) if guarded => b"ssh -F none".to_vec(),
        (None, _) => b"ssh".to_vec(),
    };
    set(&[b"core.sshCommand"], &ssh);
    // An empty helper empties the list git has read so far.
    set(&[b"credential.helper"], b"");
    for (key, value) in persons_helpers {
        set(&[key], value);
    }
    for (key, value) in carried {
        set(&[key], value);
    }
    for driver in &filters {
        for variable in [&b".clean"[..], b".smudge", b".process"] {
            set(&[b"filter.", driver, variable], b"");
        }
        set(&[b"filter.", driver, b".required"], b"false");
    }
    for driver in &diffs {
        set(&[b"diff.", driver, b".textconv"], b"");
        set(&[b"diff.", driver, b".command"], b"");
    }
    for name in &hooks {
        set(&[b"hook.", name, b".enabled"], b"false");
    }
    Ok(config)
}

/// What every git Banda runs by itself is configured with, whatever any
/// config says: its hooks folder where none is ([`no_hooks`]), [`ALWAYS`],
/// and every hook event off.
fn always() -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
    let mut config = vec![(b"core.hooksPath".to_vec(), no_hooks()?)];
    for (key, value) in ALWAYS {
        config.push((key.as_bytes().to_vec(), value.as_bytes().to_vec()));
    }
    for event in EVENTS {
        let key = [b"hook.", event.as_bytes(), b".enabled"].concat();
        config.push((key, b"false".to_vec()));
    }
    Ok(config)
}

/// The header a fetch signs in with: HTTP's basic scheme, the account's
/// login, or a name GitHub takes for any, and the token.
fn authorization(sign_in: &SignIn) -> String {
    use base64::Engine;
    let user = sign_in.user.as_deref().unwrap_or("x-access-token");
    let pair = format!("{user}:{}", sign_in.token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(pair);
    format!("Authorization: Basic {encoded}")
}

/// `program` as one word of a command the shell runs.
fn quoted(program: &[u8]) -> Vec<u8> {
    let mut word = vec![b'\''];
    for byte in program {
        match byte {
            b'\'' => word.extend_from_slice(b"'\\''"),
            _ => word.push(*byte),
        }
    }
    word.push(b'\'');
    word
}

fn unreadable() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "git's config was not as read")
}

/// `bytes` as an argument or a variable's value.
#[cfg(unix)]
fn os(bytes: Vec<u8>) -> io::Result<OsString> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(bytes))
}

/// `bytes` as an argument or a variable's value: text only, off Unix.
#[cfg(not(unix))]
fn os(bytes: Vec<u8>) -> io::Result<OsString> {
    String::from_utf8(bytes)
        .map(OsString::from)
        .map_err(|_| unreadable())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A listing as `git config --show-scope -z` writes it, the probe
    /// first.
    fn listing(entries: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut listed = b"command\0banda.probe\ntrue\0".to_vec();
        for (scope, key, value) in entries {
            listed.extend_from_slice(format!("{scope}\0{key}\n{value}\0").as_bytes());
        }
        listed
    }

    /// The settings past what always holds, as text.
    fn set(config: &[(Vec<u8>, Vec<u8>)]) -> Vec<(String, String)> {
        let text = |bytes: &[u8]| String::from_utf8(bytes.to_vec()).unwrap();
        // The hooks folder, what always holds, and every hook event.
        config[1 + ALWAYS.len() + EVENTS.len()..]
            .iter()
            .map(|(key, value)| (text(key), text(value)))
            .collect()
    }

    #[test]
    fn the_index_lock_is_beside_the_index_of_the_repository_or_the_one_named() {
        let folder = tempfile::tempdir().unwrap();
        let (repository, inner) = (folder.path().join("r"), folder.path().join("r/src/deep"));
        std::fs::create_dir_all(repository.join(".git")).unwrap();
        std::fs::create_dir_all(&inner).unwrap();
        let lock = repository.join(".git").join("index.lock");
        assert_eq!(index_lock(&inner, None), Some(lock));
        // A worktree's `.git` is a file naming its own folder.
        let tree = folder.path().join("tree");
        std::fs::create_dir_all(&tree).unwrap();
        let own = repository.join(".git/worktrees/tree");
        let named = format!("gitdir: {}\n", own.display());
        std::fs::write(tree.join(".git"), named).unwrap();
        assert_eq!(index_lock(&tree, None), Some(own.join("index.lock")));
        // One named, from the folder.
        let named = index_lock(&inner, Some(Path::new("next.index")));
        assert_eq!(named, Some(inner.join("next.index.lock")));
        assert_eq!(index_lock(folder.path(), None), None, "in no repository");
    }

    #[test]
    fn only_a_lock_made_since_the_git_started_is_removed() {
        let folder = tempfile::tempdir().unwrap();
        let lock = folder.path().join("index.lock");
        std::fs::write(&lock, "").unwrap();
        let later = SystemTime::now() + Duration::from_secs(60);
        assert!(!remove_stale_lock(&lock, later), "another's, from before");
        assert!(lock.exists());
        let before = SystemTime::now() - Duration::from_secs(60);
        assert!(remove_stale_lock(&lock, before));
        assert!(!lock.exists());
        assert!(!remove_stale_lock(&lock, before), "gone already");
    }

    fn pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        let owned = |(key, value): &(&str, &str)| (key.to_string(), value.to_string());
        pairs.iter().map(owned).collect()
    }

    #[test]
    fn with_nothing_named_what_always_holds_is_set_and_the_network_is_the_persons() {
        let config = overrides(&listing(&[]), None, false).unwrap();
        let text = |bytes: &[u8]| String::from_utf8(bytes.to_vec()).unwrap();
        let keys: Vec<String> = config.iter().map(|(key, _)| text(key)).collect();
        assert!(keys.contains(&"core.hooksPath".to_owned()));
        for event in EVENTS {
            assert!(keys.contains(&format!("hook.{event}.enabled")), "{event}");
        }
        assert_eq!(
            set(&config),
            pairs(&[("core.sshCommand", "ssh"), ("credential.helper", "")])
        );
    }

    #[test]
    fn a_git_that_took_no_config_from_its_environment_starts_none() {
        assert!(overrides(b"", None, false).is_err());
        let older = b"local\0filter.x.clean\n./clean\0";
        assert!(overrides(older, None, false).is_err());
        // The Person's own of that name is no probe.
        assert!(overrides(b"global\0banda.probe\ntrue\0", None, false).is_err());
    }

    #[test]
    fn every_filter_and_diff_driver_and_hook_named_anywhere_is_blanked() {
        let listed = listing(&[
            ("global", "filter.lfs.process", "git-lfs filter-process"),
            ("local", "filter.lfs.required", "true"),
            ("local", "filter.Keys.clean", "./clean"),
            ("local", "filter.a=b.clean", "./clean"),
            ("local", "diff.pdf.textconv", "pdftotext"),
            ("local", "diff.ext.command", "./diff"),
            ("worktree", "hook.lint.command", "./lint"),
            ("worktree", "hook.lint.event", "reference-transaction"),
            ("local", "hook.a.b.command", "./b"),
        ]);
        let config = overrides(&listed, None, false).unwrap();
        assert_eq!(
            set(&config)[2..],
            pairs(&[
                ("filter.Keys.clean", ""),
                ("filter.Keys.smudge", ""),
                ("filter.Keys.process", ""),
                ("filter.Keys.required", "false"),
                ("filter.a=b.clean", ""),
                ("filter.a=b.smudge", ""),
                ("filter.a=b.process", ""),
                ("filter.a=b.required", "false"),
                ("filter.lfs.clean", ""),
                ("filter.lfs.smudge", ""),
                ("filter.lfs.process", ""),
                ("filter.lfs.required", "false"),
                ("diff.ext.textconv", ""),
                ("diff.ext.command", ""),
                ("diff.pdf.textconv", ""),
                ("diff.pdf.command", ""),
                ("hook.a.b.enabled", "false"),
                ("hook.lint.enabled", "false"),
            ])
        );
    }

    #[test]
    fn the_network_keeps_the_persons_own_ssh_and_helpers_not_the_repositorys() {
        let listed = listing(&[
            ("global", "credential.https://github.com.helper", ""),
            ("global", "credential.https://github.com.helper", "!gh auth"),
            ("system", "core.sshcommand", "ssh -i ~/.ssh/old"),
            ("global", "core.sshcommand", "ssh -i ~/.ssh/work"),
            ("local", "credential.helper", "./steal"),
            ("local", "core.sshcommand", "./ssh"),
        ]);
        let config = overrides(&listed, Some(OsStr::new("/usr/bin/plink")), false).unwrap();
        assert_eq!(
            set(&config),
            pairs(&[
                ("core.sshCommand", "ssh -i ~/.ssh/work"),
                ("credential.helper", ""),
                ("credential.https://github.com.helper", ""),
                ("credential.https://github.com.helper", "!gh auth"),
            ])
        );

        // With none in the Person's config, the program of their GIT_SSH,
        // which the repository's would win over.
        let listed = listing(&[("local", "core.sshcommand", "./ssh")]);
        let config = overrides(&listed, Some(OsStr::new("/opt/my ssh/it's")), false).unwrap();
        assert_eq!(
            set(&config)[0],
            pairs(&[("core.sshCommand", r"'/opt/my ssh/it'\''s'")])[0]
        );
    }

    #[test]
    fn where_the_fence_holds_the_homes_config_names_no_program_of_the_network() {
        let listed = listing(&[
            ("global", "credential.https://github.com.helper", "!gh auth"),
            ("global", "core.sshcommand", "ssh -i ~/.ssh/work"),
            ("system", "credential.helper", "libsecret"),
        ]);
        let config = overrides(&listed, None, true).unwrap();
        assert_eq!(
            set(&config),
            pairs(&[
                ("core.sshCommand", "ssh -F none"),
                ("credential.helper", ""),
                ("credential.helper", "libsecret"),
            ])
        );
        // The system's ssh command, and the engine's GIT_SSH, still hold.
        let listed = listing(&[("system", "core.sshcommand", "ssh -i /etc/k")]);
        let config = overrides(&listed, None, true).unwrap();
        assert_eq!(
            set(&config)[0],
            pairs(&[("core.sshCommand", "ssh -i /etc/k")])[0]
        );
        let config = overrides(&listing(&[]), Some(OsStr::new("/usr/bin/plink")), true).unwrap();
        assert_eq!(
            set(&config)[0],
            pairs(&[("core.sshCommand", "'/usr/bin/plink'")])[0]
        );
    }

    #[test]
    fn a_listing_cut_short_is_refused() {
        let cut = [listing(&[]), b"local\0".to_vec()].concat();
        assert!(overrides(&cut, None, false).is_err());
        let dotless = [listing(&[]), b"local\0nodot\nx\0".to_vec()].concat();
        assert!(overrides(&dotless, None, false).is_err());
    }

    #[tokio::test]
    async fn a_fetch_alone_reaches_a_remote_and_with_gits_own_upload_pack() {
        let env = |git: &Command, name: &str| {
            let named = git.as_std().get_envs().find(|(key, _)| *key == name);
            named.and_then(|(_, value)| value.map(OsStr::to_owned))
        };
        let args = |git: &Command| -> Vec<OsString> {
            git.as_std().get_args().map(OsStr::to_owned).collect()
        };
        let dir = tempfile::tempdir().unwrap();
        let fetch = ["-c", "a.b=c", "fetch", "--quiet", "--", "up"];
        let fetch = bookkeeping(dir.path(), fetch).await.unwrap();
        let read = bookkeeping(dir.path(), ["status"]).await.unwrap();
        assert_eq!(
            args(&fetch),
            [
                "--no-pager",
                "-c",
                "a.b=c",
                "fetch",
                UPLOAD_PACK,
                "--quiet",
                "--",
                "up"
            ]
        );
        let allowed = env(&fetch, "GIT_ALLOW_PROTOCOL");
        assert_eq!(allowed.as_deref(), Some(OsStr::new(TRANSPORTS)));
        assert_eq!(args(&read), ["--no-pager", "status"]);
        let allowed = env(&read, "GIT_ALLOW_PROTOCOL");
        assert_eq!(allowed.as_deref(), Some(OsStr::new("")));
    }

    #[tokio::test]
    async fn this_git_fetches_no_object_it_lacks_when_told_not_to() {
        assert!(lazy_fetch_off().await.unwrap());
    }

    #[test]
    fn every_git_takes_nothing_from_the_engine_that_points_it_elsewhere() {
        let own = base(Path::new(".")).unwrap();
        let asked = asked(Path::new("."), ["status"]);
        for name in ELSEWHERE {
            let named = own.as_std().get_envs().find(|(key, _)| *key == name);
            assert_eq!(named, Some((OsStr::new(name), None)), "{name}");
            assert!(asked.unset.iter().any(|unset| unset == name), "{name}");
            // On Windows an act's own config, `core.longpaths`, goes in
            // the place of what the engine's said.
            let own_config = cfg!(windows) && name == "GIT_CONFIG_COUNT";
            assert_eq!(asked.env.contains_key(name), own_config, "{name}");
        }
        if cfg!(windows) {
            assert_eq!(asked.env["GIT_CONFIG_KEY_0"], LONG_PATHS.0);
            assert_eq!(asked.env["GIT_CONFIG_VALUE_0"], LONG_PATHS.1);
        }
        for (name, value) in EVERY {
            let named = own.as_std().get_envs().find(|(key, _)| *key == name);
            assert_eq!(named, Some((OsStr::new(name), Some(OsStr::new(value)))));
            assert_eq!(asked.env.get(name).map(String::as_str), Some(value));
        }
    }

    #[test]
    fn where_the_fence_holds_git_reads_no_home_config_but_what_it_ignores_and_trusts() {
        let listed = listing(&[
            ("global", "core.excludesfile", "~/.gitignore_global"),
            ("global", "safe.directory", "/srv/a"),
            ("global", "safe.directory", "/srv/b"),
            ("global", "core.autocrlf", "input"),
            ("local", "core.excludesfile", "./mine"),
            ("system", "core.attributesfile", "/etc/attributes"),
        ]);
        let config = overrides(&listed, None, true).unwrap();
        assert_eq!(
            set(&config)[2..],
            pairs(&[
                ("core.excludesfile", "~/.gitignore_global"),
                ("safe.directory", "/srv/a"),
                ("safe.directory", "/srv/b"),
                ("core.autocrlf", "input"),
            ])
        );
        // Where the fence does not hold, git reads the home's itself.
        let config = overrides(&listed, None, false).unwrap();
        assert_eq!(set(&config).len(), 2);
        let guarded = own(Path::new("."), true).unwrap();
        let unguarded = own(Path::new("."), false).unwrap();
        let env = |git: &Command, name: &str| {
            let named = git.as_std().get_envs().find(|(key, _)| *key == name);
            named.and_then(|(_, value)| value.map(OsStr::to_owned))
        };
        assert_eq!(
            env(&guarded, "GIT_CONFIG_GLOBAL").as_deref(),
            Some(OsStr::new("/dev/null"))
        );
        assert_eq!(env(&unguarded, "GIT_CONFIG_GLOBAL"), None);
        for git in [&guarded, &unguarded] {
            for (name, value) in UNTRACED {
                assert_eq!(env(git, name).as_deref(), Some(OsStr::new(value)), "{name}");
            }
        }
        // A fetch reaches no repository on this disk where git runs
        // outside the fence that holds.
        assert_eq!(transports(true, false), REMOTE_TRANSPORTS);
        assert_eq!(transports(true, true), TRANSPORTS);
        assert_eq!(transports(false, false), TRANSPORTS);
        assert!(!REMOTE_TRANSPORTS.split(':').any(|t| t == "file"));
    }

    fn sign_in(url: &str) -> SignIn {
        SignIn {
            url: url.to_owned(),
            user: Some("octo".to_owned()),
            token: "gho_t".to_owned(),
        }
    }

    #[test]
    fn a_fetch_signs_in_with_the_persons_token_as_github_takes_it() {
        let url = "https://github.com/o/r.git";
        // octo:gho_t
        assert_eq!(
            authorization(&sign_in(url)),
            "Authorization: Basic b2N0bzpnaG9fdA=="
        );
        let anyone = SignIn {
            user: None,
            ..sign_in(url)
        };
        assert_eq!(
            authorization(&anyone),
            "Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hvX3Q="
        );
        assert!(on_github(url));
        for elsewhere in [
            "http://github.com/o/r",
            "https://github.com.example/o/r",
            "https://user@github.com/o/r",
            "git@github.com:o/r.git",
            "https://github.com/",
            "https://github.com/o/r\n.git",
        ] {
            assert!(!on_github(elsewhere), "{elsewhere}");
        }
    }

    /// The variables `git` is given, as text.
    fn given(git: &Command) -> Vec<(String, Option<String>)> {
        let text = |value: &OsStr| value.to_string_lossy().into_owned();
        (git.as_std().get_envs())
            .map(|(key, value)| (text(key), value.map(text)))
            .collect()
    }

    #[tokio::test]
    async fn a_fetch_that_signs_in_reads_no_config_but_the_systems_and_banda_s_own() {
        let t = tempfile::tempdir().unwrap();
        let (shadow, objects) = (
            t.path().join("state/fetch"),
            t.path().join("p/.git/objects"),
        );
        std::fs::create_dir_all(&objects).unwrap();
        let url = "https://github.com/o/r.git";
        let args = [
            "fetch",
            "--quiet",
            "--",
            url,
            "+refs/heads/main:refs/remotes/origin/main",
        ];
        let git = signed_fetch(&shadow, &objects, args, &sign_in(url))
            .await
            .unwrap();
        let given = given(&git);
        let value = |name: &str| {
            let found = given.iter().find(|(key, _)| key == name);
            found.and_then(|(_, value)| value.clone())
        };
        assert_eq!(value("GIT_CONFIG_GLOBAL").as_deref(), Some("/dev/null"));
        assert_eq!(value("GIT_ALLOW_PROTOCOL").as_deref(), Some("https"));
        for (name, off) in UNTRACED {
            assert_eq!(value(name).as_deref(), Some(off), "{name}");
        }
        let headers: Vec<&str> = (given.iter())
            .filter_map(|(_, value)| value.as_deref())
            .filter(|value| value.starts_with("Authorization:"))
            .collect();
        assert_eq!(headers, ["Authorization: Basic b2N0bzpnaG9fdA=="]);
        let args: Vec<OsString> = git.as_std().get_args().map(OsStr::to_owned).collect();
        let named = [
            OsStr::new("--no-pager"),
            OsStr::new("--git-dir"),
            shadow.as_os_str(),
        ];
        assert_eq!(args[..3], named);
        assert_eq!(args[3], "fetch");
        // Banda's own repository, which borrows the Project's objects.
        let alternates = std::fs::read_to_string(shadow.join("objects/info/alternates"));
        assert_eq!(alternates.unwrap(), format!("{}\n", objects.display()));
        let config = std::fs::read_to_string(shadow.join("config")).unwrap();
        assert!(config.contains("bare = true"), "{config}");
        // Only a fetch, and only from github.com.
        let status = signed_fetch(&shadow, &objects, ["status"], &sign_in(url)).await;
        assert!(status.is_err());
        let other = sign_in("https://example.com/o/r.git");
        assert!(signed_fetch(&shadow, &objects, args, &other).await.is_err());
    }

    #[tokio::test]
    async fn a_fetch_that_signs_in_traces_nothing_a_config_of_the_home_asks() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let trace = t.path().join("trace");
        std::fs::write(
            home.join(".gitconfig"),
            // As git's config reads a `\`: on Windows, a path's own.
            format!(
                "[trace2]\n\tnormalTarget = {}\n",
                trace.display().to_string().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        let (shadow, objects) = (t.path().join("fetch"), t.path().join("objects"));
        std::fs::create_dir_all(&objects).unwrap();
        let url = "https://github.com/o/r.git";
        let fetch = ["fetch", "--", url];
        let git = signed_fetch(&shadow, &objects, fetch, &sign_in(url))
            .await
            .unwrap();
        // The fetch's own environment, asked only for a config in Banda's
        // repository: a git reads its config and traces as it starts.
        let ran = |dropped: &[&str]| {
            let _ = std::fs::remove_file(&trace);
            let mut read = std::process::Command::new("git");
            for (name, value) in given(&git) {
                match value {
                    Some(value) if !dropped.contains(&name.as_str()) => read.env(name, value),
                    _ => read.env_remove(name),
                };
            }
            read.env("HOME", &home)
                .env_remove("XDG_CONFIG_HOME")
                .arg("--git-dir")
                .arg(&shadow)
                .args(["config", "core.bare"])
                .output()
                .unwrap();
            trace.exists()
        };
        assert!(!ran(&[]), "the fetch traced as the home's config asks");
        // Without what the fetch is given, git traces as that config asks:
        // the test sees what it means to.
        assert!(ran(&[
            "GIT_CONFIG_GLOBAL",
            "GIT_TRACE2",
            "GIT_TRACE2_EVENT",
            "GIT_TRACE2_PERF",
        ]));
    }
}
