//! `git.diff` and `git.contents`: what a scope changed, as T3 Code's
//! review diff reads it (`docs/research/2026-11-02-t3-code-git-backend.md`,
//! section 1).

use crate::checkpoint::{self, When};
use crate::model::{Base, Contents, ContentsAsk, Diff, DiffAsk, FileDiff, Scope};
use crate::parse;
use crate::repo::{Repo, pathspec, plain_path};
use crate::run::{Failure, Opts};
use banda_kernel::Refusal;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// The arguments every diff takes: renames found, no colour, none of the
/// Person's diff drivers or text conversions, and the `a/` and `b/`
/// prefixes a patch reader expects.
const DIFF: [&str; 8] = [
    "diff",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--minimal",
];
/// The most of a whole diff's patch sent.
pub const PATCH: usize = 120_000;
/// The most of one file's patch, or one side of a file, sent.
pub const FILE: usize = 1024 * 1024;
/// The most untracked files a diff takes in; past it, none.
pub const UNTRACKED: usize = 5000;

/// What a scope compares, once its refs are resolved.
pub(crate) struct Sides {
    /// The commit or tree on the old side; the index when none.
    from: Option<String>,
    /// The commit on the new side; the work tree or the index when none.
    to: Option<String>,
    /// The new side is the index (`--cached`).
    cached: bool,
    base: Option<Base>,
}

/// Whether a scope's new side is the work tree; none for a turn's, which
/// is while the turn runs.
fn work_tree(scope: &Scope) -> Option<bool> {
    match scope {
        Scope::Changes { .. } | Scope::Uncommitted | Scope::Unstaged => Some(true),
        Scope::Staged | Scope::Commit { .. } => Some(false),
        Scope::Turn { .. } => None,
    }
}

/// The sides of `scope`, with `head` the commit `HEAD` is.
pub(crate) async fn sides(
    repo: &Repo,
    scope: &Scope,
    head: Option<&str>,
) -> Result<Sides, Refusal> {
    let tree = |from: String| Sides {
        from: Some(from),
        to: None,
        cached: false,
        base: None,
    };
    Ok(match scope {
        Scope::Changes { base } => {
            let found = match head {
                Some(_) => repo.base(base.as_deref()).await?,
                None => None,
            };
            let at = match &found {
                Some(found) => repo.merge_base(found).await?,
                None => None,
            };
            match (found, at) {
                (Some(found), Some(sha)) => Sides {
                    base: Some(Base {
                        name: found.name,
                        sha: sha.clone(),
                    }),
                    ..tree(sha)
                },
                _ => tree(repo.head_or_empty(head).await?),
            }
        }
        Scope::Uncommitted => tree(repo.head_or_empty(head).await?),
        Scope::Unstaged => Sides {
            from: None,
            to: None,
            cached: false,
            base: None,
        },
        Scope::Staged => Sides {
            cached: true,
            ..tree(repo.head_or_empty(head).await?)
        },
        Scope::Commit { sha } => {
            let commit = repo.commit(sha).await?;
            let from = match repo.parent(&commit).await? {
                Some(parent) => parent,
                None => repo.empty_tree().await?,
            };
            Sides {
                to: Some(commit),
                ..tree(from)
            }
        }
        Scope::Turn { thread, turn } => {
            let kept = |side| async move {
                checkpoint::find(repo, &checkpoint::reference(thread, turn, side)?).await
            };
            let (before, after) = futures::join!(kept(When::Before), kept(When::After));
            let Some(before) = before? else {
                return Err(Refusal::not_found("Banda kept no checkpoint of this turn."));
            };
            Sides {
                to: after?,
                ..tree(before)
            }
        }
    })
}

impl Sides {
    /// `git diff`'s arguments for these sides with `flags`, before `--`
    /// and the paths.
    pub(crate) fn args(&self, whitespace: bool, flags: &[&str]) -> Vec<String> {
        let mut args: Vec<String> = DIFF.map(str::to_owned).into();
        if whitespace {
            args.push("--ignore-all-space".into());
        }
        args.extend(flags.iter().map(|f| f.to_string()));
        if self.cached {
            args.push("--cached".into());
        }
        args.extend(self.from.clone());
        args.extend(self.to.clone());
        args.push("--".into());
        args
    }
}

/// What `ask` compares, read after the Space's event `at`.
pub async fn diff(repo: &Repo, ask: DiffAsk, at: i64) -> Result<Diff, Refusal> {
    let head = repo.head().await?;
    // The work tree has the untracked files too, as added.
    let committed = head.is_some();
    let scratch = |work_tree: bool| async move {
        match work_tree {
            true => Scratch::with_untracked(repo, committed).await,
            false => Ok(Scratch::none()),
        }
    };
    let (sides, scratch) = match work_tree(&ask.scope) {
        Some(work_tree) => {
            let both = futures::join!(sides(repo, &ask.scope, head.as_deref()), scratch(work_tree));
            (both.0?, both.1?)
        }
        None => {
            let sides = sides(repo, &ask.scope, head.as_deref()).await?;
            let scratch = scratch(sides.to.is_none()).await?;
            (sides, scratch)
        }
    };
    let opts = |cap| Opts {
        cap,
        index: scratch.index.as_deref(),
        ..Opts::default()
    };
    let whitespace = ask.ignore_whitespace;
    let counted = repo.run(sides.args(whitespace, &["--numstat", "-z"]), opts(None));
    let mut truncated = scratch.left_out;
    let (files, patch) = match &ask.files {
        Some(asked) => {
            let mut files = parse::numstat(&counted.await?.stdout);
            files.retain(|f| {
                asked.contains(&f.path) || f.old_path.as_ref().is_some_and(|o| asked.contains(o))
            });
            let patches = files.iter().map(|file| {
                let mut args = sides.args(whitespace, &["--patch"]);
                args.extend(paths_of(file));
                repo.run(args, opts(Some(FILE)))
            });
            let mut patch = String::new();
            for ran in futures::future::join_all(patches).await {
                let ran = ran?;
                truncated |= ran.truncated;
                patch.push_str(&String::from_utf8_lossy(&ran.stdout));
            }
            (files, patch)
        }
        None => {
            let patched = repo.run(sides.args(whitespace, &["--patch"]), opts(Some(PATCH)));
            let (counted, patched) = futures::join!(counted, patched);
            let (counted, ran) = (counted?, patched?);
            truncated |= ran.truncated;
            let kept = match ran.truncated {
                true => whole_files(&ran.stdout),
                false => &ran.stdout[..],
            };
            let patch = String::from_utf8_lossy(kept).into_owned();
            (parse::numstat(&counted.stdout), patch)
        }
    };
    Ok(Diff {
        at,
        base: sides.base,
        files,
        patch,
        truncated,
    })
}

/// A file's paths for git: where it is, and where it was before a rename
/// so git still finds the rename.
fn paths_of(file: &FileDiff) -> Vec<String> {
    std::iter::once(&file.path)
        .chain(&file.old_path)
        .map(|p| pathspec(p))
        .collect()
}

/// A cut patch up to the last file that fit whole; the lines that fit,
/// when not even the first did.
fn whole_files(patch: &[u8]) -> &[u8] {
    let starts = |at: usize| patch[at..].starts_with(b"diff --git ");
    let last = (1..patch.len())
        .rev()
        .find(|&at| patch[at - 1] == b'\n' && starts(at));
    match last {
        Some(at) => &patch[..at],
        None => match patch.iter().rposition(|b| *b == b'\n') {
            Some(at) => &patch[..=at],
            None => &[],
        },
    }
}

/// An index of the diff's own, so untracked files show as added without
/// the repository's index being written, as T3 Code does: a copy of it
/// with the untracked files added as intents (`add --intent-to-add`).
struct Scratch {
    _folder: Option<tempfile::TempDir>,
    index: Option<PathBuf>,
    /// There were more untracked files than [`UNTRACKED`], and none was
    /// taken in.
    left_out: bool,
}

impl Scratch {
    fn none() -> Scratch {
        Scratch {
            _folder: None,
            index: None,
            left_out: false,
        }
    }

    /// The scratch index with the untracked files; `head` says whether
    /// the repository has a commit yet.
    async fn with_untracked(repo: &Repo, head: bool) -> Result<Scratch, Refusal> {
        let mut untracked = untracked(repo).await?;
        if untracked.len() > UNTRACKED {
            return Ok(Scratch {
                left_out: true,
                ..Scratch::none()
            });
        }
        if head && !untracked.is_empty() {
            // A file whose removal is staged is untracked too: it stays
            // removed, not added again.
            let removed = repo
                .run(
                    [
                        "diff",
                        "--cached",
                        "--name-only",
                        "--diff-filter=D",
                        "-z",
                        "HEAD",
                        "--",
                    ],
                    Opts::default(),
                )
                .await?;
            let removed = String::from_utf8_lossy(&removed.stdout);
            let removed: HashSet<&str> = removed.split('\0').collect();
            untracked.retain(|path| !removed.contains(path.as_str()));
        }
        if untracked.is_empty() {
            return Ok(Scratch::none());
        }
        let (folder, index) = own_index(repo).await?;
        let args = [
            &INDEX[..],
            &["-c", "core.preloadIndex=false", "add", "--intent-to-add"],
        ]
        .concat();
        let paths: Vec<&str> = untracked.iter().map(String::as_str).collect();
        repo.run_on_paths(&args, &paths, Some(&index)).await?;
        Ok(Scratch {
            _folder: Some(folder),
            index: Some(index),
            left_out: false,
        })
    }
}

/// The files git does not track and does not ignore.
pub async fn untracked(repo: &Repo) -> Result<Vec<String>, Refusal> {
    let listed = repo
        .run(
            ["ls-files", "--others", "--exclude-standard", "-z", "--"],
            Opts::default(),
        )
        .await?;
    let listed = String::from_utf8_lossy(&listed.stdout);
    Ok(listed
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .collect())
}

/// What every index of the engine's own is written with, as T3 Code's:
/// whole, and with no file system monitor's help.
pub const INDEX: [&str; 6] = [
    "-c",
    "core.splitIndex=false",
    "-c",
    "splitIndex.sharedIndexExpire=never",
    "-c",
    "core.fsmonitor=false",
];

/// A copy of the repository's index in a folder of its own, whole, which
/// a git given it writes in place of the Person's (`GIT_INDEX_FILE`). The
/// copy keeps what the index knows of each file, so git reads again only
/// those changed. It goes with the folder.
pub async fn own_index(repo: &Repo) -> Result<(tempfile::TempDir, PathBuf), Refusal> {
    let folder = tempfile::Builder::new()
        .prefix("banda-git-index-")
        .tempdir()
        .map_err(|error| {
            tracing::warn!(%error, "no folder for an index of the engine's");
            Refusal::internal()
        })?;
    let index = folder.path().join("index");
    let own = repo
        .run(["rev-parse", "--git-path", "index"], Opts::default())
        .await?;
    copy_index(&repo.top.join(own.text()), &index)?;
    if index.exists() {
        let args = [&INDEX[..], &["update-index", "--no-split-index"]].concat();
        let opts = Opts {
            index: Some(&index),
            ..Opts::default()
        };
        repo.run(args, opts).await?;
    }
    Ok((folder, index))
}

/// Copies the repository's index to `to`, with its time cut to the second,
/// so git's check for files changed in the same second as the index still
/// holds. No index yet is an empty one, and `to` stays absent.
fn copy_index(from: &Path, to: &Path) -> Result<(), Refusal> {
    let failed = |error: std::io::Error| {
        tracing::warn!(%error, "a diff's index could not be copied");
        Refusal::internal()
    };
    let Ok(about) = std::fs::metadata(from) else {
        return Ok(());
    };
    std::fs::copy(from, to).map_err(failed)?;
    let time = about.modified().map_err(failed)?;
    let seconds = time
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| std::time::Duration::from_secs(d.as_secs()))
        .unwrap_or_default();
    let file = std::fs::File::options()
        .write(true)
        .open(to)
        .map_err(failed)?;
    file.set_modified(std::time::UNIX_EPOCH + seconds)
        .map_err(failed)
}

/// A file's text before and after the scope, to show what a diff leaves
/// out between its hunks.
pub async fn contents(repo: &Repo, ask: ContentsAsk) -> Result<Contents, Refusal> {
    let path = plain_path(&ask.path)?;
    let old_path = match &ask.old_path {
        Some(old) => plain_path(old)?,
        None => path,
    };
    let head = repo.head().await?;
    let sides = sides(repo, &ask.scope, head.as_deref()).await?;
    // The empty tree, before the first commit, holds no file.
    let old = blob(
        repo,
        format!("{}:{old_path}", sides.from.as_deref().unwrap_or(":0")),
    );
    let new = async {
        match (&sides.to, sides.cached) {
            (Some(commit), _) => blob(repo, format!("{commit}:{path}")).await,
            (None, true) => blob(repo, format!(":0:{path}")).await,
            (None, false) => Ok(on_disk(repo, path)),
        }
    };
    let (old, new) = futures::join!(old, new);
    let (old, new) = (old?, new?);
    Ok(match (old, new) {
        (Side::TooLarge, _) | (_, Side::TooLarge) => Contents {
            too_large: true,
            ..Contents::default()
        },
        (old, new) => Contents {
            old: old.text(),
            new: new.text(),
            too_large: false,
        },
    })
}

/// One side of a file.
enum Side {
    Missing,
    Text(String),
    /// Binary, or past [`FILE`].
    TooLarge,
}

impl Side {
    fn of(bytes: &[u8], cut: bool) -> Side {
        match cut || bytes.contains(&0) {
            true => Side::TooLarge,
            false => Side::Text(String::from_utf8_lossy(bytes).into_owned()),
        }
    }

    fn text(self) -> Option<String> {
        match self {
            Side::Text(text) => Some(text),
            _ => None,
        }
    }
}

/// The file `rev:path` names, as git keeps it: missing when it is not
/// there, or is a folder.
async fn blob(repo: &Repo, named: String) -> Result<Side, Failure> {
    let opts = Opts {
        cap: Some(FILE),
        ..Opts::default()
    };
    let read = crate::run::git(&repo.top, ["cat-file", "blob", named.as_str()], opts).await?;
    Ok(match read.success {
        true => Side::of(&read.stdout, read.truncated),
        false => Side::Missing,
    })
}

/// The file in the work tree: a plain file inside the repository only.
fn on_disk(repo: &Repo, path: &str) -> Side {
    let file = repo.top.join(path);
    let inside = match (file.canonicalize(), repo.top.canonicalize()) {
        (Ok(file), Ok(top)) => file.starts_with(top),
        _ => false,
    };
    let Ok(about) = std::fs::symlink_metadata(&file) else {
        return Side::Missing;
    };
    if !inside || !about.is_file() {
        return Side::Missing;
    }
    if about.len() > FILE as u64 {
        return Side::TooLarge;
    }
    match std::fs::read(&file) {
        Ok(bytes) => Side::of(&bytes, false),
        Err(_) => Side::Missing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cut_patch_keeps_the_files_that_fit_whole() {
        let patch = b"diff --git a/x b/x\n+one\ndiff --git a/y b/y\n+tw";
        assert_eq!(whole_files(patch), b"diff --git a/x b/x\n+one\n");
        assert_eq!(
            whole_files(b"diff --git a/x b/x\n+on"),
            b"diff --git a/x b/x\n"
        );
    }
}
