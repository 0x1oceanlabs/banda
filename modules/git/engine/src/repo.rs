//! A repository as the methods read it: its top folder, `HEAD`, its
//! default branch, and the base a branch left, as T3 Code resolves them
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 1).

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
        index: Option<&Path>,
    ) -> Result<Ran, Failure> {
        let args = [
            &["--literal-pathspecs"][..],
            args,
            &["--pathspec-from-file=-", "--pathspec-file-nul"],
        ]
        .concat();
        let opts = Opts {
            index,
            stdin: Some(paths.join("\0").into_bytes()),
            ..Opts::default()
        };
        self.run(args, opts).await
    }

    /// Whether a git that only answers yes or no, as `show-ref --quiet`,
    /// says yes.
    async fn yes<I, S>(&self, args: I) -> Result<bool, Failure>
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

    /// The remote whose branches count: `origin`, or else the first.
    pub async fn primary_remote(&self) -> Result<Option<String>, Failure> {
        let ran = self.run(["remote"], Opts::default()).await?;
        let text = ran.text();
        let remotes: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
        Ok(remotes
            .iter()
            .find(|r| **r == "origin")
            .or(remotes.first())
            .map(|r| r.to_string()))
    }

    async fn has_ref(&self, full: &str) -> Result<bool, Failure> {
        self.yes(["show-ref", "--verify", "--quiet", full]).await
    }

    /// The default branch's name, as `main`: the primary remote's
    /// `HEAD`, or `main`, or `master`, the first that is here or on that
    /// remote. T3 Code never reads `init.defaultBranch`, and nor does this.
    pub async fn default_branch(&self) -> Result<Option<String>, Failure> {
        let remote = self.primary_remote().await?;
        self.default_on(remote.as_deref()).await
    }

    /// The default branch's name with the primary remote already known.
    pub async fn default_on(&self, remote: Option<&str>) -> Result<Option<String>, Failure> {
        if let Some(name) = self.remote_head(remote).await? {
            return Ok(Some(name));
        }
        for name in DEFAULTS {
            if self.has_ref(&format!("refs/heads/{name}")).await? {
                return Ok(Some(name.to_owned()));
            }
            if let Some(remote) = remote
                && self
                    .has_ref(&format!("refs/remotes/{remote}/{name}"))
                    .await?
            {
                return Ok(Some(name.to_owned()));
            }
        }
        Ok(None)
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
    /// branch, the primary remote's copy first, or the branch's upstream
    /// when the default is the branch checked out. None when Automatic
    /// finds nothing.
    pub async fn base(&self, asked: Option<&str>) -> Result<Option<Found>, Refusal> {
        if let Some(asked) = asked {
            return Ok(Some(self.asked_base(asked).await?));
        }
        let remote = self.primary_remote().await?;
        let branch = self.branch().await?;
        let mut names: Vec<String> = Vec::new();
        names.extend(self.remote_head(remote.as_deref()).await?);
        for name in DEFAULTS {
            if !names.iter().any(|n| n == name) {
                names.push(name.to_owned());
            }
        }
        for name in names {
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
            if let Some(remote) = &remote {
                let full = format!("refs/remotes/{remote}/{name}");
                if self.has_ref(&full).await? {
                    return Ok(Some(Found {
                        name: format!("{remote}/{name}"),
                        full,
                    }));
                }
            }
            let full = format!("refs/heads/{name}");
            if self.has_ref(&full).await? {
                return Ok(Some(Found { name, full }));
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
