//! Whether a folder looks like code the Person did not write (ADR 0083,
//! decision 5; ADR 0084, decision 13): what Add Project asks by, and what
//! decides a new Project's trust when nobody said. A look is a few `stat`s,
//! small reads of the repository's own files, and at most one `gh` that
//! says which GitHub account it is signed in to on this computer. It runs
//! no git, and nothing the folder names. It reads only regular files, a
//! bounded start of each, so whatever the folder holds, a look ends.

use crate::ProjectId;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use ts_rs::TS;

/// Whether a folder looks like code the Person did not write, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Foreign {
    /// One reason or more: Add Project asks, and a Project added with no
    /// word of its trust is not trusted.
    pub foreign: bool,
    pub why: Vec<ForeignWhy>,
    /// The Project the folder already is, as `projects.foreign` says:
    /// Add Project asks nothing of it, since it keeps its own trust.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project: Option<ProjectId>,
}

/// One reason a folder looks like another's code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ForeignWhy {
    /// Its repository was cloned from `from`, such as
    /// `github.com/owner/repo`, not known to be the Person's.
    Cloned { from: String },
    /// Its remote `remote` is `at`, on GitHub under another account than
    /// the one `gh` is signed in to.
    Remote { remote: String, at: String },
    /// It, or a folder above it in its repository, holds `name`, which a
    /// Harness loads (`.claude/`, `.codex/`, `.mcp.json`) or a container is
    /// made from (`.devcontainer/`, `.devcontainer.json`).
    Holds { name: String },
}

/// What a folder holds that a Harness loads, or a container is made from.
const HELD: [&str; 5] = [
    ".claude",
    ".codex",
    ".mcp.json",
    ".devcontainer",
    ".devcontainer.json",
];

/// The most of a repository's config read; the rest is not looked at.
const CONFIG_LIMIT: u64 = 1 << 20;

/// The most of HEAD's log read, for its first line.
const LOG_LIMIT: u64 = 64 * 1024;

/// The most of a `.git` file or a `commondir` read: one path.
const PATH_LIMIT: u64 = 4096;

/// How long `gh` may take to say its account.
const GH_LIMIT: Duration = Duration::from_secs(2);

/// Looks at `folder`, resolved. One not made yet holds nothing itself:
/// what it would load comes from the folders above it in its repository.
pub(crate) async fn look(folder: &Path) -> Foreign {
    let folder = folder.to_owned();
    let found = tokio::task::spawn_blocking(move || Found::in_folder(&folder, home().as_deref()))
        .await
        .unwrap_or_default();
    let login = match found.on_github() {
        true => github_login().await,
        false => None,
    };
    found.why(login.as_deref())
}

fn home() -> Option<PathBuf> {
    dirs::home_dir().and_then(|home| dunce::canonicalize(home).ok())
}

/// The GitHub account `gh` is signed in to on this computer, as its own
/// config says, with no network: none without `gh`, signed out, or slow.
async fn github_login() -> Option<String> {
    // A `gh` that is not installed is not found, and nothing runs.
    let mut gh = crate::host::own("gh").ok()?;
    gh.args(["config", "get", "user", "--host", "github.com"])
        .current_dir("/")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let output = tokio::time::timeout(GH_LIMIT, gh.output())
        .await
        .ok()?
        .ok()?;
    let login = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (output.status.success() && !login.is_empty()).then_some(login)
}

/// Where a remote's URL points: a host and the account that owns it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct At {
    host: String,
    owner: String,
    repo: Option<String>,
}

impl At {
    /// The place a URL names on a network; none for a path on this
    /// computer. Its user and password are left out.
    fn of(url: &str) -> Option<At> {
        let url = url.trim();
        let (authority, path) = match url.split_once("://") {
            Some((scheme, _)) if scheme.eq_ignore_ascii_case("file") => return None,
            Some((_, rest)) => rest.split_once('/')?,
            // `[user@]host:path`, as scp writes it, with no slash before
            // the colon; anything else is a path.
            None => url
                .split_once(':')
                .filter(|(host, _)| !host.contains('/'))?,
        };
        let host = authority.rsplit('@').next()?.split(':').next()?;
        let mut parts = path.split('/').filter(|part| !part.is_empty());
        let owner = parts.next()?;
        let repo = parts.next().map(|repo| repo.trim_end_matches(".git"));
        (!host.is_empty()).then(|| At {
            host: host.to_ascii_lowercase(),
            owner: owner.to_owned(),
            repo: repo.map(str::to_owned),
        })
    }

    fn on_github(&self) -> bool {
        self.host == "github.com"
    }

    /// Whether `login`, the Person's GitHub account, owns it.
    fn of_login(&self, login: Option<&str>) -> bool {
        self.on_github() && login.is_some_and(|login| login.eq_ignore_ascii_case(&self.owner))
    }

    fn shown(&self) -> String {
        match &self.repo {
            Some(repo) => format!("{}/{}/{repo}", self.host, self.owner),
            None => format!("{}/{}", self.host, self.owner),
        }
    }
}

/// What a folder shows of whose it is, before the Person's account is known.
#[derive(Debug, Default)]
struct Found {
    /// Where its repository was cloned from, when that was a network.
    cloned: Option<At>,
    /// Its repository's remotes on a network, by name.
    remotes: Vec<(String, At)>,
    /// What it holds of [`HELD`].
    holds: Vec<String>,
}

impl Found {
    /// Reads `folder` and the repository it is in, found in it or above
    /// it short of `home`. What a Harness loads, it finds in the folder or
    /// above it up to the repository's top.
    fn in_folder(folder: &Path, home: Option<&Path>) -> Found {
        let repository = repository(folder, home);
        let top = repository.as_ref().map_or(folder, |(top, _)| top.as_path());
        let looked: Vec<&Path> = (folder.ancestors())
            .take_while(|dir| dir.starts_with(top))
            .collect();
        let holds = (HELD.iter())
            .filter(|name| {
                (looked.iter()).any(|dir| std::fs::symlink_metadata(dir.join(name)).is_ok())
            })
            .map(|name| (*name).to_owned())
            .collect();
        let Some((_, common)) = repository else {
            return Found {
                holds,
                ..Found::default()
            };
        };
        Found {
            cloned: cloned_from(&common).as_deref().and_then(At::of),
            remotes: (remotes(&common).into_iter())
                .filter_map(|(name, url)| Some((name, At::of(&url)?)))
                .collect(),
            holds,
        }
    }

    /// Whether the Person's GitHub account decides anything here.
    fn on_github(&self) -> bool {
        let mut places = self
            .cloned
            .iter()
            .chain(self.remotes.iter().map(|(_, at)| at));
        places.any(At::on_github)
    }

    /// Why it looks foreign, `login` being the Person's GitHub account
    /// when known. A clone from a network is foreign unless that account
    /// owns it; a remote is, when it is on GitHub and that account is
    /// known and does not own it.
    fn why(self, login: Option<&str>) -> Foreign {
        let mut why = Vec::new();
        let cloned = (self.cloned).filter(|from| !from.of_login(login));
        if let Some(from) = &cloned {
            why.push(ForeignWhy::Cloned { from: from.shown() });
        }
        for (remote, at) in self.remotes {
            let another = at.on_github() && login.is_some() && !at.of_login(login);
            if another && cloned.as_ref() != Some(&at) {
                let at = at.shown();
                why.push(ForeignWhy::Remote { remote, at });
            }
        }
        let holds = self
            .holds
            .into_iter()
            .map(|name| ForeignWhy::Holds { name });
        why.extend(holds);
        Foreign {
            foreign: !why.is_empty(),
            why,
            project: None,
        }
    }
}

/// The repository `folder` is in, as git finds it: the folder that holds
/// its `.git`, and its common folder, that `.git` or, for a worktree or a
/// submodule, the one its `.git` file leads to. None short of `home`, so a
/// repository of the home folder is no other folder's.
fn repository(folder: &Path, home: Option<&Path>) -> Option<(PathBuf, PathBuf)> {
    let top = folder
        .ancestors()
        .take_while(|dir| *dir == folder || Some(*dir) != home)
        .find(|dir| std::fs::symlink_metadata(dir.join(".git")).is_ok())?;
    let dot_git = top.join(".git");
    let repo_dir = match dot_git.is_file() {
        false => dot_git,
        true => {
            let file = start_of(&dot_git, PATH_LIMIT)?;
            top.join(file.strip_prefix("gitdir:")?.trim())
        }
    };
    let common = match start_of(&repo_dir.join("commondir"), PATH_LIMIT) {
        Some(common) => repo_dir.join(common.trim()),
        None => repo_dir,
    };
    Some((top.to_owned(), common))
}

/// The start of the regular file at `path`, at most `limit` bytes. None
/// for anything else: a pipe or a device is never opened to wait on, and
/// what is opened is checked again, as it is, before it is read.
fn start_of(path: &Path, limit: u64) -> Option<String> {
    #[cfg(not(unix))]
    if !on_a_drive(path) {
        return None;
    }
    if !std::fs::metadata(path).ok()?.is_file() {
        return None;
    }
    #[cfg(unix)]
    let file = {
        use rustix::fs::{Mode, OFlags};
        let flags = OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOCTTY | OFlags::CLOEXEC;
        std::fs::File::from(rustix::fs::open(path, flags, Mode::empty()).ok()?)
    };
    // A pipe or a device on Windows has a path of its own, never on a
    // drive, so what is on one opens without waiting.
    #[cfg(not(unix))]
    let file = std::fs::File::open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(limit).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Whether `path` is on one of this computer's drives, as `C:\x` or
/// `\\?\C:\x`: not a share, which a look would send the Person's
/// sign-in to, nor a pipe or a device, as `\\.\pipe\x`.
#[cfg(not(unix))]
fn on_a_drive(path: &Path) -> bool {
    use std::path::{Component, Prefix};
    match path.components().next() {
        Some(Component::Prefix(prefix)) => {
            matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        }
        _ => false,
    }
}

/// The URL the repository was cloned from, as the first line of HEAD's
/// log says: `clone: from <url>`.
fn cloned_from(common: &Path) -> Option<String> {
    let log = start_of(&common.join("logs").join("HEAD"), LOG_LIMIT)?;
    let (_, said) = log.lines().next()?.split_once('\t')?;
    Some(said.trim().strip_prefix("clone: from ")?.trim().to_owned())
}

/// The remotes the repository's config names, with their URLs.
fn remotes(common: &Path) -> Vec<(String, String)> {
    let Some(config) = start_of(&common.join("config"), CONFIG_LIMIT) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut remote: Option<String> = None;
    for line in config.lines().map(str::trim) {
        if let Some(section) = line.strip_prefix('[') {
            let section = section.split(']').next().unwrap_or_default().trim();
            remote = (section.split_once(char::is_whitespace))
                .filter(|(kind, _)| kind.eq_ignore_ascii_case("remote"))
                .map(|(_, name)| name.trim().trim_matches('"').to_owned());
            continue;
        }
        let Some(name) = &remote else { continue };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("url") {
            let url = value.trim().trim_matches('"').to_owned();
            found.push((name.clone(), url));
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(host: &str, owner: &str, repo: &str) -> Option<At> {
        Some(At {
            host: host.into(),
            owner: owner.into(),
            repo: Some(repo.into()),
        })
    }

    #[test]
    fn a_remote_s_url_names_its_host_and_owner_and_never_its_password() {
        let tool = at("github.com", "someone", "tool");
        for url in [
            "https://github.com/someone/tool.git",
            "https://me:secret@GitHub.com/someone/tool",
            "git@github.com:someone/tool.git",
            "ssh://git@github.com:22/someone/tool.git",
        ] {
            assert_eq!(At::of(url), tool, "{url}");
        }
        let shown = At::of("https://me:secret@github.com/someone/tool").unwrap();
        assert_eq!(shown.shown(), "github.com/someone/tool");
        for path in ["/home/me/tool", "../tool", "file:///home/me/tool", "tool"] {
            assert_eq!(At::of(path), None, "a path on this computer: {path}");
        }
    }

    /// A repository in `folder`, cloned from `from` when given, with
    /// `remotes`, as git leaves one.
    fn repo(folder: &Path, from: Option<&str>, remotes: &[(&str, &str)]) {
        let git = folder.join(".git");
        std::fs::create_dir_all(git.join("logs")).unwrap();
        if let Some(from) = from {
            let line = format!(
                "0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 Me <me@example.com> 1700000000 +0100\tclone: from {from}\n"
            );
            std::fs::write(git.join("logs/HEAD"), line).unwrap();
        }
        let mut config = String::from("[core]\n\tbare = false\n");
        for (name, url) in remotes {
            config.push_str(&format!(
                "[remote \"{name}\"]\n\turl = {url}\n\tfetch = +refs/heads/*:refs/remotes/{name}/*\n"
            ));
        }
        config.push_str("[branch \"main\"]\n\tremote = origin\n");
        std::fs::write(git.join("config"), config).unwrap();
    }

    fn reasons(folder: &Path, login: Option<&str>) -> Vec<ForeignWhy> {
        Found::in_folder(folder, None).why(login).why
    }

    #[test]
    fn a_clone_from_a_network_is_foreign_unless_the_persons_account_owns_it() {
        let dir = tempfile::tempdir().unwrap();
        let theirs = "https://github.com/someone/tool.git";
        repo(dir.path(), Some(theirs), &[("origin", theirs)]);
        let cloned = ForeignWhy::Cloned {
            from: "github.com/someone/tool".into(),
        };
        assert_eq!(
            reasons(dir.path(), None),
            std::slice::from_ref(&cloned),
            "with no account known"
        );
        assert_eq!(
            reasons(dir.path(), Some("me")),
            [cloned],
            "its remote says no more than its clone"
        );
        assert_eq!(reasons(dir.path(), Some("Someone")), []);

        let local = tempfile::tempdir().unwrap();
        repo(local.path(), Some("/home/me/tool"), &[]);
        assert_eq!(reasons(local.path(), None), [], "a clone of a folder here");
    }

    #[test]
    fn a_remote_is_foreign_when_another_github_account_owns_it() {
        let dir = tempfile::tempdir().unwrap();
        repo(
            dir.path(),
            None,
            &[
                ("origin", "git@github.com:me/app.git"),
                ("upstream", "https://github.com/someone/app"),
                ("mirror", "https://gitlab.com/someone/app"),
            ],
        );
        let found = Found::in_folder(dir.path(), None);
        assert!(found.on_github(), "the Person's account decides");
        assert_eq!(
            found.why(Some("me")).why,
            [ForeignWhy::Remote {
                remote: "upstream".into(),
                at: "github.com/someone/app".into(),
            }]
        );
        assert_eq!(reasons(dir.path(), None), [], "no account to tell by");
    }

    #[test]
    fn what_a_harness_loads_or_a_container_is_made_from_is_foreign() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!Found::in_folder(dir.path(), None).why(None).foreign);
        std::fs::create_dir(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".mcp.json"), "{}").unwrap();
        std::fs::create_dir(dir.path().join(".devcontainer")).unwrap();
        let looked = Found::in_folder(dir.path(), None).why(None);
        assert!(looked.foreign);
        let names: Vec<_> = (looked.why.iter())
            .map(|why| match why {
                ForeignWhy::Holds { name } => name.as_str(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(names, [".claude", ".mcp.json", ".devcontainer"]);
    }

    #[test]
    fn a_folder_in_a_repository_is_looked_at_by_that_repository_short_of_home() {
        let home = tempfile::tempdir().unwrap();
        let theirs = "https://github.com/someone/tool";
        repo(home.path(), Some(theirs), &[]);
        let below = home.path().join("code/app");
        std::fs::create_dir_all(&below).unwrap();
        let found = Found::in_folder(&below, Some(home.path()));
        assert_eq!(found.cloned, None, "the home folder's repository");
        let found = Found::in_folder(&below, None);
        assert_eq!(found.cloned, At::of(theirs), "the repository above it");

        // A worktree's `.git` is a file, and its config is the main one's.
        let worktree = home.path().join("worktree");
        let repo_dir = home.path().join(".git/worktrees/one");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(repo_dir.join("commondir"), "../..\n").unwrap();
        let gitdir = format!("gitdir: {}\n", repo_dir.display());
        std::fs::write(worktree.join(".git"), gitdir).unwrap();
        let found = Found::in_folder(&worktree, Some(home.path()));
        assert_eq!(found.cloned, At::of(theirs));
    }

    #[test]
    fn what_a_harness_loads_counts_up_to_the_repository_s_top_and_no_further() {
        let home = tempfile::tempdir().unwrap();
        let above = home.path().join("code");
        let top = above.join("app");
        let below = top.join("modules/one");
        std::fs::create_dir_all(&below).unwrap();
        repo(&top, None, &[]);
        std::fs::create_dir(top.join(".codex")).unwrap();
        std::fs::write(above.join(".mcp.json"), "{}").unwrap();
        let found = Found::in_folder(&below, Some(home.path()));
        assert_eq!(found.holds, [".codex"]);

        let alone = above.join("alone");
        std::fs::create_dir(&alone).unwrap();
        let found = Found::in_folder(&alone, Some(home.path()));
        assert!(found.holds.is_empty(), "a folder in no repository: its own");
    }

    #[cfg(unix)]
    #[test]
    fn a_repository_s_file_that_is_no_regular_file_is_passed_over() {
        let dir = tempfile::tempdir().unwrap();
        let theirs = "https://github.com/someone/tool";
        repo(dir.path(), Some(theirs), &[("origin", theirs)]);
        let git = dir.path().join(".git");
        for file in ["config", "logs/HEAD"] {
            std::fs::remove_file(git.join(file)).unwrap();
            let made = std::process::Command::new("mkfifo")
                .arg(git.join(file))
                .status()
                .unwrap();
            assert!(made.success());
        }
        std::os::unix::fs::symlink("/dev/zero", git.join("commondir")).unwrap();
        let found = Found::in_folder(dir.path(), None);
        assert_eq!((found.cloned, found.remotes), (None, Vec::new()));
        assert_eq!(start_of(&git.join("commondir"), 16), None);
    }
}
