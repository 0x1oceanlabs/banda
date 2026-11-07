//! How Banda starts the `git` program in a folder: for its own
//! bookkeeping ([`bookkeeping`]), on the host, or for an act the Person
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
//! Person's config holds: their name, the remotes, what they ignore.
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
//!
//! An act the Person asked for, as a commit, a push, a pull or a switch,
//! runs as their own git does: hooks, filters, signing and all.
//!
//! Either way git asks nothing on a terminal, takes no optional lock, so
//! a read beside the Person's own git never takes `.git/index.lock`,
//! speaks in C's words, and takes nothing from the engine's environment
//! that points it at another repository, as when the engine runs inside
//! a git hook.

use banda_kernel::Program;
use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
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

/// The transports a fetch Banda runs by itself goes over: git's own, and
/// none a repository's config names a helper for.
const TRANSPORTS: &str = "file:git:http:https:ssh";

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
/// repository says, besides its hook events: no hooks folder, as there is
/// none at `/dev/null/<name>` on Linux or macOS; no file system monitor,
/// by an empty value, as a git before 2.36 runs the program `false` names; no
/// signature checked as a log reads; no external diff, which a diff asked
/// for git's own patch skips and any other fails on; a submodule's change
/// as its commits, not its diff, which runs in the submodule; no command
/// that lists an alternate's refs; no submodule fetched, as each has
/// config of its own; and no gc nor maintenance after it.
const ALWAYS: [(&str, &str); 9] = [
    ("core.hooksPath", "/dev/null"),
    ("core.fsmonitor", ""),
    ("log.showSignature", "false"),
    ("diff.external", ""),
    ("diff.submodule", "short"),
    ("core.alternateRefsCommand", ""),
    ("fetch.recurseSubmodules", "false"),
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
];

/// What the config is read for first, by git's lowercase names: every
/// filter driver, diff driver's text conversion and command, and hook it
/// names; the Person's own ssh command and credential helpers; and
/// [`PROBE`].
const NAMING: &str = r"^filter\.|^diff\..+\.(textconv|command)$|^hook\.|^core\.sshcommand$|^credential\..*helper$|^banda\.probe$";

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
/// own git runs it: the program for the Project's environment to start,
/// as every git starts but for its bookkeeping. Its stdio and the rest
/// are the caller's.
pub fn asked<I, S>(dir: &Path, args: I) -> Program
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    Program {
        program: "git".to_owned(),
        args: args
            .into_iter()
            .map(|arg| arg.as_ref().to_owned())
            .collect(),
        env: (EVERY.iter())
            .map(|&(name, value)| (name.to_owned(), value.to_owned()))
            .collect(),
        unset: ELSEWHERE.map(str::to_owned).to_vec(),
        cwd: Some(dir.to_owned()),
    }
}

/// git in `dir` running `args`, which name its subcommand, for Banda's
/// own bookkeeping: it runs no program the repository names (the crate's
/// doc says how far that holds). A fetch is the one that reaches a
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
    let listed = tokio::time::timeout(READING, configured(dir))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "git's config took too long"))??;
    let config = overrides(&listed, std::env::var_os("GIT_SSH").as_deref())?;
    let mut git = own(dir);
    git.env("GIT_CONFIG_COUNT", config.len().to_string());
    for (at, (key, value)) in config.into_iter().enumerate() {
        git.env(format!("GIT_CONFIG_KEY_{at}"), os(key)?)
            .env(format!("GIT_CONFIG_VALUE_{at}"), os(value)?);
    }
    let mut args: Vec<OsString> = args.into_iter().map(|a| a.as_ref().to_owned()).collect();
    if let Some(at) = subcommand(&args).filter(|at| args[*at] == "fetch") {
        if !lazy_fetch_off().await? {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "git takes no GIT_NO_LAZY_FETCH: Banda's own fetch needs git 2.45 or later, \
                 or a release of 2.39 to 2.44 from May 2024 on",
            ));
        }
        args.insert(at + 1, UPLOAD_PACK.into());
        git.env("GIT_ALLOW_PROTOCOL", TRANSPORTS);
    }
    git.args(args);
    Ok(git)
}

/// git in `dir` as every git starts: as [`EVERY`] says, taking nothing
/// [`ELSEWHERE`], and stopped once its caller lets go of it.
fn base(dir: &Path) -> Command {
    let mut git = Command::new("git");
    git.current_dir(dir).envs(EVERY).kill_on_drop(true);
    for name in ELSEWHERE {
        git.env_remove(name);
    }
    git
}

/// git in `dir` as every bookkeeping git starts, before its config.
fn own(dir: &Path) -> Command {
    let mut git = base(dir);
    git.arg("--no-pager").envs(UNASKED);
    git
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
    own(folder.path())
        .arg("--git-dir")
        .arg(&repo)
        .args(["cat-file", "-e", LACKED])
        .env("GIT_TRACE2_EVENT", &trace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
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
    let read = own(dir)
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", PROBE)
        .env("GIT_CONFIG_VALUE_0", "true")
        .args(["config", "--show-scope", "-z", "--get-regexp", NAMING])
        .stdin(Stdio::null())
        .output()
        .await?;
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
/// `git_ssh` is the engine's `GIT_SSH`.
///
/// First [`ALWAYS`], and every hook event off. Then the Person's own
/// network: their ssh command, from their config (system or global), else
/// `GIT_SSH`'s program, else `ssh` (their `GIT_SSH_COMMAND` wins over it
/// as it is); and their credential helpers alone. Then what the config
/// names: every filter driver blanked, which need not run; every diff
/// driver's text conversion and command blanked, so a git that would run
/// one fails instead; and every hook off.
fn overrides(listed: &[u8], git_ssh: Option<&OsStr>) -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
    let (mut filters, mut diffs, mut hooks) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let mut persons_ssh: Option<&[u8]> = None;
    let mut persons_helpers: Vec<(&[u8], &[u8])> = Vec::new();
    let mut probed = false;
    let mut fields = listed.split(|b| *b == 0);
    while let Some(scope) = fields.next().filter(|scope| !scope.is_empty()) {
        let entry = fields.next().ok_or_else(unreadable)?;
        let (key, value) = match entry.iter().position(|b| *b == b'\n') {
            Some(at) => (&entry[..at], &entry[at + 1..]),
            None => (entry, &b""[..]),
        };
        let persons = scope == b"system" || scope == b"global";
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
            _ => {}
        }
    }
    if !probed {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "git took no config from its environment: Banda's own git needs git 2.31 or later",
        ));
    }
    let mut config: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    let mut set = |parts: &[&[u8]], value: &[u8]| config.push((parts.concat(), value.to_vec()));
    for (key, value) in ALWAYS {
        set(&[key.as_bytes()], value.as_bytes());
    }
    for event in EVENTS {
        set(&[b"hook.", event.as_bytes(), b".enabled"], b"false");
    }
    let ssh = match (persons_ssh, git_ssh) {
        (Some(command), _) => command.to_vec(),
        (None, Some(program)) if !program.is_empty() => quoted(program.as_encoded_bytes()),
        (None, _) => b"ssh".to_vec(),
    };
    set(&[b"core.sshCommand"], &ssh);
    // An empty helper empties the list git has read so far.
    set(&[b"credential.helper"], b"");
    for (key, value) in persons_helpers {
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
        config[ALWAYS.len() + EVENTS.len()..]
            .iter()
            .map(|(key, value)| (text(key), text(value)))
            .collect()
    }

    fn pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        let owned = |(key, value): &(&str, &str)| (key.to_string(), value.to_string());
        pairs.iter().map(owned).collect()
    }

    #[test]
    fn with_nothing_named_what_always_holds_is_set_and_the_network_is_the_persons() {
        let config = overrides(&listing(&[]), None).unwrap();
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
        assert!(overrides(b"", None).is_err());
        let older = b"local\0filter.x.clean\n./clean\0";
        assert!(overrides(older, None).is_err());
        // The Person's own of that name is no probe.
        assert!(overrides(b"global\0banda.probe\ntrue\0", None).is_err());
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
        let config = overrides(&listed, None).unwrap();
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
        let config = overrides(&listed, Some(OsStr::new("/usr/bin/plink"))).unwrap();
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
        let config = overrides(&listed, Some(OsStr::new("/opt/my ssh/it's"))).unwrap();
        assert_eq!(
            set(&config)[0],
            pairs(&[("core.sshCommand", r"'/opt/my ssh/it'\''s'")])[0]
        );
    }

    #[test]
    fn a_listing_cut_short_is_refused() {
        let cut = [listing(&[]), b"local\0".to_vec()].concat();
        assert!(overrides(&cut, None).is_err());
        let dotless = [listing(&[]), b"local\0nodot\nx\0".to_vec()].concat();
        assert!(overrides(&dotless, None).is_err());
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
        let own = base(Path::new("."));
        let asked = asked(Path::new("."), ["status"]);
        for name in ELSEWHERE {
            let named = own.as_std().get_envs().find(|(key, _)| *key == name);
            assert_eq!(named, Some((OsStr::new(name), None)), "{name}");
            assert!(asked.unset.iter().any(|unset| unset == name), "{name}");
            assert!(!asked.env.contains_key(name), "{name}");
        }
        for (name, value) in EVERY {
            let named = own.as_std().get_envs().find(|(key, _)| *key == name);
            assert_eq!(named, Some((OsStr::new(name), Some(OsStr::new(value)))));
            assert_eq!(asked.env.get(name).map(String::as_str), Some(value));
        }
    }
}
