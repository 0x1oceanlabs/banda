//! `git.status`: the branch and what changed against `HEAD`, as T3 Code
//! reads them (`docs/research/2026-11-02-t3-code-git-backend.md`,
//! section 2), untracked files counted with their lines, as the Diff's
//! Uncommitted shows them.

use crate::index::{UNTRACKED, untracked};
use crate::lines::Counted;
use crate::model::{Change, Changed, Status};
use crate::parse;
use crate::repo::{Found, Repo};
use crate::run::{Failure, Opts};
use banda_kernel::Refusal;
use std::collections::HashMap;
use std::path::Path;

/// The folder's status, read after the Space's event `at`; `repo: false`
/// in a folder git does not know.
pub async fn status(folder: &Path, at: i64) -> Result<Status, Failure> {
    read(Repo::find(folder).await, at, &mut Counted::default()).await
}

/// The status of the repository `found` for a folder, read after the
/// Space's event `at`: `repo: false` when none was, with why when git
/// could not look, as in a repository another user owns. The untracked
/// files are read again only where they changed since `counted`, which
/// then holds them as they are now.
pub async fn read(
    found: Result<Option<Repo>, Failure>,
    at: i64,
    counted: &mut Counted,
) -> Result<Status, Failure> {
    let problem = match found {
        Ok(Some(repo)) => return of(repo, at, counted).await,
        Ok(None) => None,
        // One that passes, as a lock held, is an error: the window keeps
        // what it showed.
        Err(failure) if !failure.0.lasting() => return Err(failure),
        Err(failure) => Some(Refusal::from(failure).message),
    };
    Ok(Status {
        at,
        problem,
        ..Status::default()
    })
}

/// The status of `repo`, read after the Space's event `at`.
async fn of(repo: Repo, at: i64, counted: &mut Counted) -> Result<Status, Failure> {
    let said = repo.porcelain().await?;
    let against = repo.head_or_empty(said.head.as_deref()).await?;
    // Plumbing, as T3 Code: a porcelain diff writes the index even with
    // GIT_OPTIONAL_LOCKS=0.
    let numstat = repo.run(
        [
            "diff-index",
            "-M",
            "--numstat",
            "-z",
            against.as_str(),
            "--",
        ],
        Opts::default(),
    );
    let remote = async {
        let remote = repo.primary_remote().await?;
        let default = repo
            .default_branch(remote.as_deref(), said.branch.as_deref())
            .await?;
        // A branch never pushed: how far it is past the default.
        let tip = default.as_ref().and_then(|default| default.tip.as_ref());
        let ahead = match (&said.upstream, &said.head, tip) {
            (None, Some(_), Some(tip)) => ahead_of(&repo, tip).await?,
            _ => None,
        };
        Ok::<_, Failure>((remote, default.map(|default| default.name), ahead))
    };
    let new = new_files(&repo, &said.files);
    let (numstat, remote, new) = futures::join!(numstat, remote, new);
    let (remote, default_branch, ahead_of_default) = remote?;
    let new = new?;
    // Past so many, as the Diff leaves them out, their lines are not read.
    let lines = match new.len() <= UNTRACKED {
        true => {
            let (now, lines) = std::mem::take(counted)
                .count(repo.top.clone(), new.clone())
                .await;
            *counted = now;
            lines
        }
        false => vec![0; new.len()],
    };
    let mut counts: HashMap<String, (u32, u32)> = parse::numstat(&numstat?.stdout)
        .into_iter()
        .map(|f| (f.path, (f.added, f.removed)))
        .collect();
    let mut files = said.files;
    for file in &mut files {
        (file.added, file.removed) = counts.remove(&file.path).unwrap_or_default();
    }
    let changed = with_new(&mut files, &new, &lines);
    Ok(Status {
        at,
        repo: true,
        problem: None,
        branch: said.branch,
        head: said.head,
        ahead: said.upstream.as_ref().and(said.ahead),
        behind: said.upstream.as_ref().and(said.behind),
        upstream: said.upstream,
        remote,
        default_branch,
        ahead_of_default,
        changed,
        added: files.iter().map(|f| f.added).sum(),
        removed: files.iter().map(|f| f.removed).sum(),
        files,
    })
}

/// The untracked files among `files`, each file of an untracked folder
/// too: git is asked to list them only when there is such a folder.
async fn new_files(repo: &Repo, files: &[Changed]) -> Result<Vec<String>, Failure> {
    let new = || files.iter().filter(|f| f.status == Change::Untracked);
    match new().any(|f| f.path.ends_with('/')) {
        true => untracked(repo).await,
        false => Ok(new().map(|f| f.path.clone()).collect()),
    }
}

/// Puts each untracked file's `lines` in `files`, an untracked folder's
/// the sum of its files' in `new`; and says how many files changed, each
/// file of such a folder counted.
fn with_new(files: &mut [Changed], new: &[String], lines: &[u32]) -> u32 {
    let by_path: HashMap<&str, u32> = new
        .iter()
        .map(String::as_str)
        .zip(lines.iter().copied())
        .collect();
    let mut changed = 0;
    for file in files.iter_mut() {
        let (count, sum) = match (file.status, file.path.ends_with('/')) {
            (Change::Untracked, true) => by_path
                .iter()
                .filter(|(path, _)| path.starts_with(&file.path))
                .fold((0, 0), |(count, sum), (_, lines)| (count + 1, sum + lines)),
            (Change::Untracked, false) => {
                (1, by_path.get(file.path.as_str()).copied().unwrap_or(0))
            }
            _ => {
                changed += 1;
                continue;
            }
        };
        file.added = sum;
        changed += count.max(1);
    }
    changed
}

/// How many commits `HEAD` has that the default branch's `tip` does not.
async fn ahead_of(repo: &Repo, tip: &Found) -> Result<Option<u32>, Failure> {
    let range = format!("{}..HEAD", tip.full);
    let counted = repo
        .run(
            ["rev-list", "--count", range.as_str(), "--"],
            Opts::default(),
        )
        .await?;
    Ok(counted.text().parse().ok())
}
