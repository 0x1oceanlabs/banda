//! Indexes of the engine's own, so the Person's is never written: the
//! diff's, which takes the untracked files in as added, and the one a
//! checkpoint is made through.

use crate::repo::{Repo, scratch};
use crate::run::Opts;
use banda_kernel::Refusal;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// The most untracked files a diff takes in; past it, none.
pub const UNTRACKED: usize = 5000;

/// An index of the diff's own, so untracked files show as added without
/// the repository's index being written, as T3 Code does: a copy of it
/// with the untracked files added as intents (`add --intent-to-add`).
pub struct Scratch {
    _folder: Option<tempfile::TempDir>,
    pub index: Option<PathBuf>,
    /// There were more untracked files than [`UNTRACKED`], and none was
    /// taken in.
    pub left_out: bool,
}

impl Scratch {
    pub fn none() -> Scratch {
        Scratch {
            _folder: None,
            index: None,
            left_out: false,
        }
    }

    /// The scratch index with the untracked files; `head` says whether
    /// the repository has a commit yet.
    pub async fn with_untracked(repo: &Repo, head: bool) -> Result<Scratch, Refusal> {
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
        let opts = Opts {
            index: Some(&index),
            ..Opts::default()
        };
        repo.run_on_paths(&args, &paths, opts).await?;
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
    let folder = scratch("banda-git-index-")?;
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
        tracing::warn!(%error, "an index of the engine's own could not be copied");
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
