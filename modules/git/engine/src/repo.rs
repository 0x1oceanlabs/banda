//! A repository as the methods read it: its top folder, `HEAD`, its
//! default branch, and the base a branch left, as T3 Code resolves them
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 1).

use crate::model::Commit;
use crate::parse::{self, Porcelain};
use crate::run::{Failure, Opts, Ran, Reason, git};
use banda_kernel::Refusal;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// The branches tried, after `origin/HEAD`'s, as the default.
const DEFAULTS: [&str; 2] = ["main", "master"];

/// A repository, at its top folder: every git runs there, so every path
/// is from the top.
pub struct Repo {
    pub top: PathBuf,
}

/// A base the branch is compared with: its name and its full ref.
pub struct Found {
    pub name: String,
    pub full: String,
}

impl Repo {
    /// The repository `folder` is in, or none when git knows no
    /// repository there.
    pub async fn find(folder: &Path) -> Result<Option<Repo>, Failure> {
        let ran = git(folder, ["rev-parse", "--show-toplevel"], Opts::default()).await?;
        if ran.success {
            return Ok(Some(Repo {
                top: PathBuf::from(ran.text()),
            }));
        }
        match ran.reason() {
            Reason::NotRepository => Ok(None),
            _ => Err(ran.failure()),
        }
    }

    /// The repository `folder` is in, or the refusal of every method but
    /// `status`.
    pub async fn open(folder: &Path) -> Result<Repo, Refusal> {
        Repo::find(folder)
            .await?
            .ok_or_else(|| Failure(Reason::NotRepository).into())
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
    /// with no commits are compared with.
    pub async fn empty_tree(&self) -> Result<String, Failure> {
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
    /// `status --porcelain=2 --branch` says them. Ahead and behind read
    /// only the refs git has already fetched.
    pub async fn porcelain(&self) -> Result<Porcelain, Failure> {
        let said = self
            .run(
                ["status", "--porcelain=2", "--branch", "-z"],
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

    /// Whether the ref `full` is here, as `refs/heads/main`.
    pub async fn has_ref(&self, full: &str) -> Result<bool, Failure> {
        self.yes(["show-ref", "--verify", "--quiet", full]).await
    }

    /// Whether the branch `name` is here, as `main`.
    pub async fn has_branch(&self, name: &str) -> Result<bool, Failure> {
        self.has_ref(&format!("refs/heads/{name}")).await
    }

    /// The default branch's name, as `main`, with the primary remote
    /// known: that remote's `HEAD`, or `main`, or `master`, the first that
    /// is here or on that remote. T3 Code never reads
    /// `init.defaultBranch`, and nor does this.
    pub async fn default_on(&self, remote: Option<&str>) -> Result<Option<String>, Failure> {
        if let Some(name) = self.remote_head(remote).await? {
            return Ok(Some(name));
        }
        for name in DEFAULTS {
            if self.default_tip(remote, name, None).await?.is_some() {
                return Ok(Some(name.to_owned()));
            }
        }
        Ok(None)
    }

    /// The names the default branch may have, in the order tried: what
    /// `remote`'s `HEAD` names, then `main`, then `master`.
    async fn default_names(&self, remote: Option<&str>) -> Result<Vec<String>, Failure> {
        let mut names: Vec<String> = Vec::new();
        names.extend(self.remote_head(remote).await?);
        for name in DEFAULTS {
            if !names.iter().any(|n| n == name) {
                names.push(name.to_owned());
            }
        }
        Ok(names)
    }

    /// Where the default branch `name` is, the one rule for it: `remote`'s
    /// copy first, else the branch here, but not when it is
    /// `checked_out`, as a branch is no base of its own. None when neither
    /// is there. [`Repo::base`] compares with it and the status counts
    /// from it; [`Repo::default_on`] only asks whether it is there.
    pub async fn default_tip(
        &self,
        remote: Option<&str>,
        name: &str,
        checked_out: Option<&str>,
    ) -> Result<Option<Found>, Failure> {
        let mut tips = Vec::new();
        tips.extend(remote.map(|remote| Found {
            name: format!("{remote}/{name}"),
            full: format!("refs/remotes/{remote}/{name}"),
        }));
        if checked_out != Some(name) {
            tips.push(Found {
                name: name.to_owned(),
                full: format!("refs/heads/{name}"),
            });
        }
        if tips.is_empty() {
            return Ok(None);
        }
        // Which of them are there, at once.
        let mut args = vec!["for-each-ref", "--format=%(refname)"];
        args.extend(tips.iter().map(|tip| tip.full.as_str()));
        let there = self.run(args, Opts::default()).await?.text();
        Ok(tips
            .into_iter()
            .find(|tip| there.lines().any(|line| line == tip.full)))
    }

    /// The branch `remote`'s `HEAD` names, as `main`.
    async fn remote_head(&self, remote: Option<&str>) -> Result<Option<String>, Failure> {
        let Some(remote) = remote else {
            return Ok(None);
        };
        let head = format!("refs/remotes/{remote}/HEAD");
        let to = self
            .verified(["symbolic-ref", "--quiet", head.as_str()])
            .await?;
        let prefix = format!("refs/remotes/{remote}/");
        Ok(to
            .as_deref()
            .and_then(|to| to.strip_prefix(&prefix))
            .map(str::to_owned))
    }

    /// The base a branch is compared with: `asked`, as a branch here, a
    /// remote's branch or any commit; or else ("Automatic") the default
    /// branch where [`Repo::default_tip`] finds it, or the branch's
    /// upstream when the default is the branch checked out. None when
    /// Automatic finds nothing.
    pub async fn base(&self, asked: Option<&str>) -> Result<Option<Found>, Refusal> {
        if let Some(asked) = asked {
            return Ok(Some(self.asked_base(asked).await?));
        }
        let remote = self.primary_remote().await?;
        let branch = self.branch().await?;
        for name in self.default_names(remote.as_deref()).await? {
            if branch.as_deref() == Some(name.as_str()) {
                let upstream = format!("{name}@{{upstream}}");
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
                continue;
            }
            let found = self
                .default_tip(remote.as_deref(), &name, branch.as_deref())
                .await?;
            if found.is_some() {
                return Ok(found);
            }
        }
        Ok(None)
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
        for full in [
            format!("refs/heads/{asked}"),
            format!("refs/remotes/{asked}"),
        ] {
            if self.has_ref(&full).await? {
                return Ok(Found {
                    name: asked.to_owned(),
                    full,
                });
            }
        }
        Ok(Found {
            name: asked.to_owned(),
            full: asked.to_owned(),
        })
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

/// Why a commit is not made of files with no changes: the button's
/// commit and the prompt for its message say the same.
pub fn nothing_to_commit() -> Refusal {
    Refusal::conflict("Nothing to commit: those files have no changes.")
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
