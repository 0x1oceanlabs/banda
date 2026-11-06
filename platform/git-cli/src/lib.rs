//! How Banda starts the `git` program in a folder: for its own
//! bookkeeping ([`bookkeeping`]), or for an act a Participant asked for
//! ([`asked`]).
//!
//! Bookkeeping is what Banda runs by itself: a status, a diff, a
//! checkpoint under Banda's own refs, a watch and the fetch it runs, a
//! log, an ignore check, a remote's address. A repository's hooks and
//! config are its Project's, which an Agent may write, so Banda's own git
//! runs no program they name: no hook, no file system monitor, no filter
//! or diff driver, no signature check, and none of the repository's own
//! network commands. The rest of the Person's config holds: their name,
//! the remotes, and the credential helpers and ssh of their own config,
//! system and global.
//!
//! An act asked for, as a commit, a push, a pull or a switch, runs as the
//! Person's own git does: hooks, filters, signing and all.
//!
//! Either way git asks nothing on a terminal, takes no optional lock, so
//! a read beside the Person's own git never takes `.git/index.lock`,
//! speaks in C's words, and takes nothing from the engine's environment
//! that points it at another repository, as when the engine runs inside
//! a git hook.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// What git would take from the engine's environment that points it at
/// another repository.
const ELSEWHERE: [&str; 4] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"];

/// What a bookkeeping git takes from nowhere but its own arguments: the
/// config given to a git the engine runs inside, and an external diff.
const INHERITED: [&str; 3] = [
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_EXTERNAL_DIFF",
];

/// What a bookkeeping git runs with besides, as nobody waits on it: no
/// password asked, by git, a credential manager or ssh.
const UNASKED: [(&str, &str); 4] = [
    ("GCM_INTERACTIVE", "never"),
    ("GIT_ASKPASS", ""),
    ("SSH_ASKPASS", ""),
    ("SSH_ASKPASS_REQUIRE", "never"),
];

/// What every bookkeeping git runs with, whatever the repository says: no
/// hook, as there is none at `/dev/null/<name>` on Linux or macOS; no file
/// system monitor; no signature checked as a log reads; no `ext::`
/// remote, which is a command; no submodule fetched, as each has config
/// of its own; and no gc nor maintenance after it, which run hooks of
/// their own.
const ALWAYS: [(&str, &str); 7] = [
    ("core.hooksPath", "/dev/null"),
    ("core.fsmonitor", "false"),
    ("log.showSignature", "false"),
    ("protocol.ext.allow", "never"),
    ("fetch.recurseSubmodules", "false"),
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
];

/// The config that names a program a bookkeeping git may run, by git's
/// lowercase names: every filter driver and hook, a diff driver's text
/// conversion and command, the external diff, the command that lists an
/// alternate's refs, and the network's ssh command, proxy and credential
/// helpers.
const NAMING: &str = r"^filter\.|^hook\.|^diff\..+\.(textconv|command)$|^diff\.external$|^core\.(sshcommand|gitproxy|alternaterefscommand)$|^credential\..*helper$";

/// How long the config is read at most.
const READING: Duration = Duration::from_secs(10);

/// What a fetch Banda runs by itself takes after `fetch`: git's own
/// upload-pack. A remote's `uploadpack` is the first git reads, so no
/// `-c` overrides the repository's.
pub const FETCH: [&str; 1] = ["--upload-pack=git-upload-pack"];

/// git in `dir` for an act a Participant asked for, as the Person's own
/// git runs it. Its args, stdio and the rest are the caller's.
pub fn asked(dir: &Path) -> Command {
    let mut git = Command::new("git");
    git.current_dir(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    for name in ELSEWHERE {
        git.env_remove(name);
    }
    git
}

/// git in `dir` for Banda's own bookkeeping, which runs no program the
/// repository names. The repository's config is read first, for the
/// names of its drivers and hooks; when it cannot be read, as when it is
/// malformed or past [`READING`], no git starts. Its args, stdio and the
/// rest are the caller's.
pub async fn bookkeeping(dir: &Path) -> io::Result<Command> {
    let listed = tokio::time::timeout(READING, configured(dir))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "git's config took too long"))??;
    let Overrides { config, env } = overrides(&listed)?;
    let mut git = own(dir);
    git.arg("--no-pager");
    for (key, value) in config {
        git.arg("-c").arg(os([key, b"=".to_vec(), value].concat())?);
    }
    git.envs(env);
    Ok(git)
}

/// git in `dir` as every bookkeeping git starts, before its config.
fn own(dir: &Path) -> Command {
    let mut git = asked(dir);
    for name in INHERITED {
        git.env_remove(name);
    }
    git.envs(UNASKED);
    git
}

/// The config of `dir` that [`NAMING`] matches, as `git config
/// --show-scope -z` lists it.
async fn configured(dir: &Path) -> io::Result<Vec<u8>> {
    let read = own(dir)
        .args(["--no-pager", "config", "--show-scope", "-z", "--get-regexp"])
        .arg(NAMING)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await?;
    match read.status.code() {
        Some(0) => Ok(read.stdout),
        // None is set.
        Some(1) => Ok(Vec::new()),
        _ => {
            let said = String::from_utf8_lossy(&read.stderr);
            Err(io::Error::other(format!(
                "git could not read its config: {}",
                said.trim()
            )))
        }
    }
}

/// What a bookkeeping git overrides: config, as `-c` takes it, and
/// environment.
#[derive(Debug, Default, PartialEq)]
struct Overrides {
    config: Vec<(Vec<u8>, Vec<u8>)>,
    env: Vec<(&'static str, &'static str)>,
}

/// What a bookkeeping git overrides, after the config [`configured`]
/// read. Every filter driver is blanked and need not run; every diff
/// driver's text conversion and command, the external diff and the
/// command that lists an alternate's refs are blanked, so a git that
/// would run one fails instead; every hook git's config names is off. A
/// network command the repository's own config names, not the Person's
/// (system or global), gives way: its ssh command to the Person's, or
/// `ssh`; its credential helpers to the Person's alone; its proxy to
/// none.
fn overrides(listed: &[u8]) -> io::Result<Overrides> {
    let (mut filters, mut diffs, mut hooks) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let (mut external, mut alternates) = (false, false);
    let (mut ssh, mut helpers, mut proxy) = (false, false, false);
    let mut persons_ssh: Option<&[u8]> = None;
    let mut persons_helpers: Vec<(&[u8], &[u8])> = Vec::new();
    let mut fields = listed.split(|b| *b == 0);
    while let Some(scope) = fields.next().filter(|scope| !scope.is_empty()) {
        let entry = fields.next().ok_or_else(unreadable)?;
        let (key, value) = match entry.iter().position(|b| *b == b'\n') {
            Some(at) => (&entry[..at], &entry[at + 1..]),
            None => (entry, &b""[..]),
        };
        let persons = scope == b"system" || scope == b"global";
        let (first, last) = (dot(key, false)?, dot(key, true)?);
        let (section, variable) = (&key[..first], &key[last + 1..]);
        let sub = (first < last).then(|| key[first + 1..last].to_vec());
        match (section, sub, variable) {
            (b"filter", Some(driver), _) => {
                filters.insert(driver);
            }
            (b"diff", Some(driver), _) => {
                diffs.insert(driver);
            }
            (b"diff", None, b"external") => external = true,
            (b"hook", Some(name), _) => {
                hooks.insert(name);
            }
            (b"core", None, b"alternaterefscommand") => alternates = true,
            (b"core", None, b"sshcommand") if persons => persons_ssh = Some(value),
            (b"core", None, b"sshcommand") => ssh = true,
            (b"core", None, b"gitproxy") => proxy |= !persons,
            (b"credential", _, b"helper") if persons => persons_helpers.push((key, value)),
            (b"credential", _, b"helper") => helpers = true,
            _ => {}
        }
    }
    let mut config: Vec<(Vec<u8>, Vec<u8>)> = (ALWAYS.iter())
        .map(|(key, value)| (key.as_bytes().to_vec(), value.as_bytes().to_vec()))
        .collect();
    let mut set = |parts: &[&[u8]], value: &[u8]| config.push((parts.concat(), value.to_vec()));
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
    if external {
        set(&[b"diff.external"], b"");
    }
    for name in &hooks {
        set(&[b"hook.", name, b".enabled"], b"false");
    }
    if alternates {
        set(&[b"core.alternateRefsCommand"], b"");
    }
    if ssh {
        set(&[b"core.sshCommand"], persons_ssh.unwrap_or(b"ssh"));
    }
    if helpers {
        // An empty helper empties the list git has read so far.
        set(&[b"credential.helper"], b"");
        for (key, value) in persons_helpers {
            set(&[key], value);
        }
    }
    // `-c` cuts its name at the first `=`.
    if config.iter().any(|(key, _)| key.contains(&b'=')) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "git's config names a driver, hook or helper with an `=`, which -c cannot override",
        ));
    }
    let mut env = Vec::new();
    if proxy {
        // It wins over the config, whose first match would.
        env.push(("GIT_PROXY_COMMAND", ""));
    }
    Ok(Overrides { config, env })
}

/// Where `key`'s first or last dot is.
fn dot(key: &[u8], last: bool) -> io::Result<usize> {
    let at = match last {
        true => key.iter().rposition(|b| *b == b'.'),
        false => key.iter().position(|b| *b == b'.'),
    };
    at.ok_or_else(unreadable)
}

fn unreadable() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "git's config was not as read")
}

/// `bytes` as an argument.
#[cfg(unix)]
fn os(bytes: Vec<u8>) -> io::Result<OsString> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(bytes))
}

/// `bytes` as an argument: text only, off Unix.
#[cfg(not(unix))]
fn os(bytes: Vec<u8>) -> io::Result<OsString> {
    String::from_utf8(bytes)
        .map(OsString::from)
        .map_err(|_| unreadable())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A listing as `git config --show-scope -z` writes it.
    fn listing(entries: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut listed = Vec::new();
        for (scope, key, value) in entries {
            listed.extend_from_slice(format!("{scope}\0{key}\n{value}\0").as_bytes());
        }
        listed
    }

    /// The `-c` pairs past [`ALWAYS`], as text.
    fn set(overrides: &Overrides) -> Vec<(String, String)> {
        let text = |bytes: &[u8]| String::from_utf8(bytes.to_vec()).unwrap();
        overrides.config[ALWAYS.len()..]
            .iter()
            .map(|(key, value)| (text(key), text(value)))
            .collect()
    }

    fn pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        let owned = |(key, value): &(&str, &str)| (key.to_string(), value.to_string());
        pairs.iter().map(owned).collect()
    }

    #[test]
    fn with_no_config_named_only_what_always_holds_is_set() {
        let none = overrides(b"").unwrap();
        assert_eq!(none.config.len(), ALWAYS.len());
        assert!(none.env.is_empty());
    }

    #[test]
    fn every_filter_and_diff_driver_and_hook_named_anywhere_is_blanked() {
        let listed = listing(&[
            ("global", "filter.lfs.process", "git-lfs filter-process"),
            ("local", "filter.lfs.required", "true"),
            ("local", "filter.Keys.clean", "./clean"),
            ("local", "diff.pdf.textconv", "pdftotext"),
            ("local", "diff.ext.command", "./diff"),
            ("local", "diff.external", "./diff"),
            ("worktree", "hook.lint.command", "./lint"),
            ("worktree", "hook.lint.event", "reference-transaction"),
            ("local", "core.alternaterefscommand", "./refs"),
        ]);
        let named = overrides(&listed).unwrap();
        assert_eq!(
            set(&named),
            pairs(&[
                ("filter.Keys.clean", ""),
                ("filter.Keys.smudge", ""),
                ("filter.Keys.process", ""),
                ("filter.Keys.required", "false"),
                ("filter.lfs.clean", ""),
                ("filter.lfs.smudge", ""),
                ("filter.lfs.process", ""),
                ("filter.lfs.required", "false"),
                ("diff.ext.textconv", ""),
                ("diff.ext.command", ""),
                ("diff.pdf.textconv", ""),
                ("diff.pdf.command", ""),
                ("diff.external", ""),
                ("hook.lint.enabled", "false"),
                ("core.alternateRefsCommand", ""),
            ])
        );
    }

    #[test]
    fn the_network_keeps_the_persons_own_ssh_and_helpers_not_the_repositorys() {
        let listed = listing(&[
            ("global", "credential.https://github.com.helper", ""),
            ("global", "credential.https://github.com.helper", "!gh auth"),
            ("global", "core.sshcommand", "ssh -i ~/.ssh/work"),
            ("local", "credential.helper", "./steal"),
            ("local", "core.sshcommand", "./ssh"),
            ("local", "core.gitproxy", "./proxy"),
        ]);
        let named = overrides(&listed).unwrap();
        assert_eq!(
            set(&named),
            pairs(&[
                ("core.sshCommand", "ssh -i ~/.ssh/work"),
                ("credential.helper", ""),
                ("credential.https://github.com.helper", ""),
                ("credential.https://github.com.helper", "!gh auth"),
            ])
        );
        assert_eq!(named.env, [("GIT_PROXY_COMMAND", "")]);

        // With none of the Person's own, git's own ssh.
        let listed = listing(&[("local", "core.sshcommand", "./ssh")]);
        let named = overrides(&listed).unwrap();
        assert_eq!(set(&named), pairs(&[("core.sshCommand", "ssh")]));
    }

    #[test]
    fn the_persons_own_network_config_alone_is_left_as_it_is() {
        let listed = listing(&[
            ("system", "credential.helper", "osxkeychain"),
            ("global", "core.sshcommand", "ssh -i ~/.ssh/work"),
            ("global", "core.gitproxy", "proxy for example.com"),
        ]);
        let named = overrides(&listed).unwrap();
        assert!(set(&named).is_empty());
        assert!(named.env.is_empty());
    }

    #[test]
    fn a_name_that_has_an_equals_sign_is_refused() {
        let listed = listing(&[("local", "filter.a=b.clean", "./clean")]);
        assert!(overrides(&listed).is_err());
    }

    #[test]
    fn a_listing_cut_short_is_refused() {
        assert!(overrides(b"local\0").is_err());
        assert!(overrides(b"local\0nodot\nx\0").is_err());
    }
}
