//! `git.status`: the branch and what changed against `HEAD`, as T3 Code
//! reads them (`docs/research/2026-11-02-t3-code-git-backend.md`,
//! section 2), each untracked file with its lines, as the Diff's
//! Uncommitted shows them.

use crate::Repositories;
use crate::index::added;
use crate::model::{Change, Status};
use crate::parse;
use crate::repo::{Found, Repo};
use crate::run::{Failure, Opts};
use banda_kernel::Refusal;
use std::collections::HashMap;

/// The status of the repository `found` for a folder, read after the
/// Space's event `at`: `repo: false` when none was, with why when git
/// could not look, as in a repository another user owns. Its untracked
/// files are read again only where they changed since a status of the
/// repository counted them (`repositories`).
pub async fn read(
    found: Result<Option<Repo>, Failure>,
    at: i64,
    repositories: &Repositories,
) -> Result<Status, Failure> {
    let problem = match found {
        Ok(Some(repo)) => return of(repo, at, repositories).await,
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
async fn of(repo: Repo, at: i64, repositories: &Repositories) -> Result<Status, Failure> {
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
    // The untracked files the Diff takes in, with their lines: past so
    // many, none.
    let shared = repositories.of(&repo.top).counted;
    let counted = async {
        let new = (said.files.iter())
            .filter(|f| f.status == Change::Untracked)
            .map(|f| f.path.clone())
            .collect();
        let before = std::mem::take(&mut *lock(&shared));
        Ok::<_, Failure>(match added(&repo, new, said.head.is_some()).await? {
            Some(new) => before.count(repo.top.clone(), new).await,
            None => Default::default(),
        })
    };
    let (numstat, remote, counted) = futures::join!(numstat, remote, counted);
    let (remote, default_branch, ahead_of_default) = remote?;
    let counted = counted?;
    let mut counts: HashMap<String, (u32, u32)> = parse::numstat(&numstat?.stdout)
        .into_iter()
        .map(|f| (f.path, (f.added, f.removed)))
        .collect();
    let mut files = said.files;
    for file in &mut files {
        (file.added, file.removed) = match file.status {
            Change::Untracked => (counted.lines(&file.path), 0),
            _ => counts.remove(&file.path).unwrap_or_default(),
        };
    }
    *lock(&shared) = counted;
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
        added: files.iter().map(|f| f.added).sum(),
        removed: files.iter().map(|f| f.removed).sum(),
        files,
    })
}

/// The lock of what a repository's status counted, even when a read that
/// held it panicked.
fn lock<T>(shared: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
