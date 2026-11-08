//! A repository as the methods read it: its top folder, `HEAD`, its
//! default branch, and the base a branch left, as T3 Code resolves them
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 1).

use crate::model::Commit;
use crate::parse::{self, Porcelain};
use crate::run::{Failure, Opts, Ran, Reason, git};
use banda_kernel::{Environment, ModuleProject, Refusal};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

/// The branches tried, after `origin/HEAD`'s, as the default.
const DEFAULTS: [&str; 2] = ["main", "master"];

/// The tree with nothing in it, in a repository of SHA-1 objects.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// A repository, at its top folder: every git runs there, so every path
/// is from the top.
#[derive(Clone)]
pub struct Repo {
    pub top: PathBuf,
    /// Its objects are named by SHA-1, as all but a few are.
    sha1: bool,
    /// Where the acts the Person asks for run: its Project's environment
    /// (ADR 0084, decision 8).
    environment: Arc<dyn Environment>,
}

/// A ref found, as a base the branch is compared with: its name and its
/// full ref.
#[derive(Clone)]
pub struct Found {
    pub name: String,
    pub full: String,
}

/// The repository's default branch: its name, and where it is compared
/// with ([`Repo::default_branch`]).
pub struct DefaultBranch {
    pub name: String,
    pub tip: Option<Found>,
}

impl Repo {
    /// The repository `project`'s folder is in, or none when git knows no
    /// repository there.
    pub async fn find(project: &ModuleProject) -> Result<Option<Repo>, Failure> {
        // Its objects' format first: the top is the rest, whatever its name.
        let ran = git(
            &project.folder(),
            ["rev-parse", "--show-object-format", "--show-toplevel"],
            Opts::default(),
        )
        .await?;
        if ran.success {
            let text = ran.text();
            let (format, top) = text.split_once('\n').unwrap_or(("", &text));
            return Ok(Some(Repo {
                top: PathBuf::from(top),
                sha1: format == "sha1",
                environment: project.environment(),
            }));
        }
        match ran.reason() {
            Reason::NotRepository => Ok(None),
            _ => Err(ran.failure()),
        }
    }

    /// The repository `project`'s folder is in, or the refusal of every
    /// method but `status`.
    pub async fn open(project: &ModuleProject) -> Result<Repo, Refusal> {
        Repo::find(project)
            .await?
            .ok_or_else(|| Failure(Reason::NotRepository).into())
    }

    /// How an act the Person asks for runs here: in its Project's
    /// environment ([`Opts::asked`]).
    pub fn asked(&self) -> Opts<'_> {
        Opts::asked(&*self.environment)
    }

    /// Runs git at the top, and fails when git does.
    pub async fn run<I, S>(&self, args: I, opts: Opts<'_>) -> Result<Ran, Failure>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        git(&self.top, args, opts).await?.checked()
    }

    /// Runs `args`, git's options and a command that reads pathspecs, on
    /// `paths` given on stdin as they are, no glob nor magic: as many as
    /// there are, and any name.
    pub async fn run_on_paths(
        &self,
        args: &[&str],
        paths: &[&str],
        opts: Opts<'_>,
    ) -> Result<Ran, Failure> {
        let args = [
            &["--literal-pathspecs"][..],
            args,
            &["--pathspec-from-file=-", "--pathspec-file-nul"],
        ]
        .concat();
        let opts = Opts {
            stdin: Some(paths.join("\0").into_bytes()),
            ..opts
        };
        self.run(args, opts).await
    }

    /// Whether a git that only answers yes or no, as `show-ref --quiet`,
    /// says yes.
    pub async fn yes<I, S>(&self, args: I) -> Result<bool, Failure>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        Ok(git(&self.top, args, Opts::default()).await?.success)
    }

    /// What a `--verify --quiet` git prints, or none when it says no.
    pub async fn verified<I, S>(&self, args: I) -> Result<Option<String>, Failure>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let ran = git(&self.top, args, Opts::default()).await?;
        Ok((ran.success && !ran.stdout.is_empty()).then(|| ran.text()))
    }

    /// The commit `HEAD` is; none before the first commit.
    pub async fn head(&self) -> Result<Option<String>, Failure> {
        self.verified(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
            .await
    }

    /// The branch checked out; none when `HEAD` is detached.
    pub async fn branch(&self) -> Result<Option<String>, Failure> {
        self.verified(["symbolic-ref", "--quiet", "--short", "HEAD"])
            .await
    }

    /// The tree with nothing in it, which a first commit and a repository
    /// with no commits are compared with: known for SHA-1, else asked.
    pub async fn empty_tree(&self) -> Result<String, Failure> {
        if self.sha1 {
            return Ok(EMPTY_TREE.to_owned());
        }
        let opts = Opts {
            stdin: Some(Vec::new()),
            ..Opts::default()
        };
        let ran = self
            .run(["hash-object", "-t", "tree", "--stdin"], opts)
            .await?;
        Ok(ran.text())
    }

    /// `head`, or the empty tree before the first commit.
    pub async fn head_or_empty(&self, head: Option<&str>) -> Result<String, Failure> {
        match head {
            Some(head) => Ok(head.to_owned()),
            None => self.empty_tree().await,
        }
    }

    /// The repository's remotes, by name.
    pub async fn remotes(&self) -> Result<Vec<String>, Failure> {
        let ran = self.run(["remote"], Opts::default()).await?;
        Ok(ran
            .text()
            .lines()
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect())
    }

    /// The remote whose branches count: `origin`, or else the first.
    pub async fn primary_remote(&self) -> Result<Option<String>, Failure> {
        let mut remotes = self.remotes().await?;
        Ok(match remotes.iter().position(|r| r == "origin") {
            Some(origin) => Some(remotes.swap_remove(origin)),
            None => remotes.into_iter().next(),
        })
    }

    /// A config value, as `branch.main.remote`; none when it is not set.
    /// Whether its objects are named by SHA-1, as all but a few are.
    pub fn sha1(&self) -> bool {
        self.sha1
    }

    /// The repository at `top`, of SHA-1 objects, whose acts run on the
    /// host: for a test of what reads it.
    #[cfg(test)]
    pub fn at(top: PathBuf) -> Repo {
        Repo {
            top,
            sha1: true,
            environment: Arc::new(banda_environments::Local),
        }
    }

    pub async fn config(&self, key: &str) -> Result<Option<String>, Failure> {
        self.verified(["config", "--get", key]).await
    }

    /// The commit `HEAD` is, as `git.commits` says one.
    pub async fn said_head(&self) -> Result<Commit, Failure> {
        let ran = self
            .run(["log", "-1", "-z", parse::LOG_FORMAT], Opts::default())
            .await?;
        parse::log(&ran.stdout).pop().ok_or(Failure(Reason::BadRef))
    }

    /// The branch, its upstream and what changed, as
    /// `status --porcelain=2 --branch` says them, each untracked file of
    /// its own, as a diff takes them in, and a submodule changed when its
    /// commit is (`banda_git_cli`). Ahead and behind read only the refs git
    /// has already fetched.
    pub async fn porcelain(&self) -> Result<Porcelain, Failure> {
        let said = self
            .run(
                [
                    "status",
                    "--porcelain=2",
                    "--branch",
                    "--untracked-files=all",
                    "--ignore-submodules=dirty",
                    "-z",
                ],
                Opts::default(),
            )
            .await?;
        Ok(parse::porcelain(&said.stdout))
    }

    /// The branches here, by name, as `main` and `fix/login`.
    pub async fn branches(&self) -> Result<Vec<String>, Failure> {
        let ran = self
            .run(
                ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"],
                Opts::default(),
            )
            .await?;
        Ok(ran.text().lines().map(str::to_owned).collect())
    }

    /// The refs of `full` names that are here, each with the ref it names
    /// when it is a symbolic one, as `origin/HEAD`: all asked at once. A
    /// symbolic ref that names nothing is not there.
    async fn refs_there(&self, full: &[&str]) -> Result<HashMap<String, String>, Failure> {
        if full.is_empty() {
            return Ok(HashMap::new());
        }
        let mut args = vec!["for-each-ref", "--format=%(refname)%09%(symref)"];
        args.extend(full);
        let ran = self.run(args, Opts::default()).await?;
        // A name is a pattern to git: only the refs named count. The
        // text's end is trimmed, and with it the last ref's tab.
        Ok(ran
            .text()
            .lines()
            .map(|line| line.split_once('\t').unwrap_or((line, "")))
            .filter(|(name, _)| full.contains(name))
            .map(|(name, to)| (name.to_owned(), to.to_owned()))
            .collect())
    }

    /// The first of `refs` that is here; none when none is.
    pub async fn first_there(&self, refs: Vec<Found>) -> Result<Option<Found>, Failure> {
        let full: Vec<&str> = refs.iter().map(|r| r.full.as_str()).collect();
        let there = self.refs_there(&full).await?;
        Ok(refs.into_iter().find(|r| there.contains_key(&r.full)))
    }

    /// The default branch, with the primary `remote` known, the one rule
    /// for it: its name is what that remote's `HEAD` names, or `main`, or
    /// `master`, the first that is here or on that remote; T3 Code never
    /// reads `init.defaultBranch`, and nor does this. It is compared with
    /// that remote's copy, or else the branch here, but not when it is
    /// the `branch` checked out, which is no base of its own. Looked up
    /// in one git, and one more when the remote's `HEAD` names another.
    pub async fn default_branch(
        &self,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<Option<DefaultBranch>, Failure> {
        let head = remote.map(|remote| format!("refs/remotes/{remote}/HEAD"));
        let homes = |name: &str| {
            let mut homes: Vec<Found> = Vec::new();
            homes.extend(remote.map(|remote| Found {
                name: format!("{remote}/{name}"),
                full: format!("refs/remotes/{remote}/{name}"),
            }));
            homes.push(Found {
                name: name.to_owned(),
                full: format!("refs/heads/{name}"),
            });
            homes
        };
        let mut asked: Vec<String> = head.iter().cloned().collect();
        for name in DEFAULTS {
            asked.extend(homes(name).into_iter().map(|home| home.full));
        }
        let names: Vec<&str> = asked.iter().map(String::as_str).collect();
        let mut there = self.refs_there(&names).await?;
        let prefix = format!("refs/remotes/{}/", remote.unwrap_or_default());
        let named = (head.as_ref())
            .and_then(|head| there.get(head))
            .and_then(|to| to.strip_prefix(&prefix))
            .map(str::to_owned);
        let name = match named {
            Some(name) => {
                if !DEFAULTS.contains(&name.as_str()) {
                    let full: Vec<String> = homes(&name).into_iter().map(|h| h.full).collect();
                    let full: Vec<&str> = full.iter().map(String::as_str).collect();
                    there = self.refs_there(&full).await?;
                }
                name
            }
            None => {
                let here = |name: &str| homes(name).iter().any(|h| there.contains_key(&h.full));
                match DEFAULTS.into_iter().find(|name| here(name)) {
                    Some(name) => name.to_string(),
                    None => return Ok(None),
                }
            }
        };
        let checked_out = branch == Some(name.as_str());
        let tip = homes(&name)
            .into_iter()
            .filter(|home| !(checked_out && home.full.starts_with("refs/heads/")))
            .find(|home| there.contains_key(&home.full));
        Ok(Some(DefaultBranch { name, tip }))
    }

    /// The base a branch is compared with: `asked`, as a branch here, a
    /// remote's branch or any commit; or else ("Automatic") the default
    /// branch where [`Repo::default_branch`] finds it, or the branch's
    /// upstream when the default is the branch checked out. None when
    /// Automatic finds nothing.
    pub async fn base(&self, asked: Option<&str>) -> Result<Option<Found>, Refusal> {
        if let Some(asked) = asked {
            return Ok(Some(self.asked_base(asked).await?));
        }
        let (remote, branch) = futures::join!(self.primary_remote(), self.branch());
        let (remote, branch) = (remote?, branch?);
        let Some(default) = self
            .default_branch(remote.as_deref(), branch.as_deref())
            .await?
        else {
            return Ok(None);
        };
        if branch.as_deref() == Some(default.name.as_str()) {
            let upstream = format!("{}@{{upstream}}", default.name);
            let full = self
                .verified([
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    "--symbolic-full-name",
                    &upstream,
                ])
                .await?;
            if let Some(full) = full {
                return Ok(Some(Found {
                    name: short(&full),
                    full,
                }));
            }
        }
        Ok(default.tip)
    }

    async fn asked_base(&self, asked: &str) -> Result<Found, Refusal> {
        if asked.is_empty() || asked.starts_with('-') {
            return Err(Refusal::invalid("A base is a branch or a commit."));
        }
        if asked.starts_with("refs/") {
            return Ok(Found {
                name: short(asked),
                full: asked.to_owned(),
            });
        }
        let found = self.first_there(branch_refs(asked)).await?;
        Ok(found.unwrap_or(Found {
            name: asked.to_owned(),
            full: asked.to_owned(),
        }))
    }

    /// Where `HEAD` left `base`: their merge base. None when they share no
    /// commit.
    pub async fn merge_base(&self, base: &Found) -> Result<Option<String>, Refusal> {
        let ran = git(
            &self.top,
            ["merge-base", "--end-of-options", base.full.as_str(), "HEAD"],
            Opts::default(),
        )
        .await?;
        if ran.success {
            return Ok(Some(ran.text()));
        }
        // It exits with 1, saying nothing, when there is no merge base.
        match ran.reason() {
            Reason::Other if ran.quiet() => Ok(None),
            _ => Err(ran.failure().into()),
        }
    }

    /// The commit `sha` names, in full.
    pub async fn commit(&self, sha: &str) -> Result<String, Refusal> {
        let hex = sha.chars().all(|c| c.is_ascii_hexdigit());
        if !hex || !(4..=64).contains(&sha.len()) {
            return Err(Refusal::invalid("A commit is named by its sha."));
        }
        let peeled = format!("{sha}^{{commit}}");
        self.verified([
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &peeled,
        ])
        .await?
        .ok_or_else(|| Failure(Reason::BadRef).into())
    }

    /// A commit's first parent; none for a first commit.
    pub async fn parent(&self, commit: &str) -> Result<Option<String>, Failure> {
        // Its own `parent` lines, so a shallow clone's graft does not make
        // a commit look like a first one, as T3 Code reads them.
        let ran = self
            .run(["cat-file", "commit", commit], Opts::default())
            .await?;
        let text = String::from_utf8_lossy(&ran.stdout);
        Ok(text
            .lines()
            .take_while(|line| !line.is_empty())
            .find_map(|line| line.strip_prefix("parent "))
            .map(str::to_owned))
    }
}

/// The one of `branches` that keeps a branch `name` from being made: one
/// of that name, or one whose name is a folder of it or in it, as `fix`
/// is to `fix/login`, which git keeps as files and folders. None when
/// `name` is free.
pub fn in_way<'a>(branches: &'a [String], name: &str) -> Option<&'a str> {
    let inside = |outer: &str, inner: &str| {
        inner
            .strip_prefix(outer)
            .is_some_and(|rest| rest.starts_with('/'))
    };
    branches
        .iter()
        .map(String::as_str)
        .find(|b| *b == name || inside(b, name) || inside(name, b))
}

/// The refs `name` may be, the first first: a branch here, as `main`, or
/// a remote's, as `origin/main`.
pub fn branch_refs(name: &str) -> Vec<Found> {
    ["heads", "remotes"]
        .map(|kind| Found {
            name: name.to_owned(),
            full: format!("refs/{kind}/{name}"),
        })
        .into()
}

/// A ref's name without `refs/heads/` or `refs/remotes/`.
fn short(full: &str) -> String {
    full.strip_prefix("refs/heads/")
        .or_else(|| full.strip_prefix("refs/remotes/"))
        .unwrap_or(full)
        .to_owned()
}

/// A path git takes as it is, from the top: no glob, no magic.
pub fn pathspec(path: &str) -> String {
    format!(":(top,literal){path}")
}

/// Each of `paths`, when each is a file's path from the top that stays
/// inside it.
pub fn plain_paths(paths: &[String]) -> Result<Vec<&str>, Refusal> {
    paths.iter().map(|path| plain_path(path)).collect()
}

/// The files a commit of chosen files takes, when it chose some; all
/// when `files` is None.
pub fn chosen(files: &Option<Vec<String>>) -> Result<Option<Vec<&str>>, Refusal> {
    match files {
        Some(files) if files.is_empty() => {
            Err(Refusal::invalid("A commit of chosen files needs one."))
        }
        Some(files) => Ok(Some(plain_paths(files)?)),
        None => Ok(None),
    }
}

/// A folder of the engine's own, gone when it is dropped.
pub fn scratch(prefix: &str) -> Result<tempfile::TempDir, Refusal> {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .map_err(|error| {
            tracing::warn!(%error, "no folder of the engine's own");
            Refusal::internal()
        })
}

/// `path`, when it is a file's path from the top that stays inside it.
pub fn plain_path(path: &str) -> Result<&str, Refusal> {
    let inside = !path.is_empty()
        && !path.contains('\0')
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    match inside {
        true => Ok(path),
        false => Err(Refusal::invalid(
            "A path is a file's, from the repository's top folder.",
        )),
    }
}
