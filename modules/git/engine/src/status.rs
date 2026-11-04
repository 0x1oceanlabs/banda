//! `git.status`: the branch and what changed against `HEAD`, as T3 Code
//! reads them (`docs/research/2026-11-02-t3-code-git-backend.md`,
//! section 2).

use crate::model::Status;
use crate::parse;
use crate::repo::Repo;
use crate::run::{Failure, Opts};
use banda_kernel::Refusal;
use std::collections::HashMap;
use std::path::Path;

/// The folder's status, read after the Space's event `at`; `repo: false`
/// in a folder git does not know.
pub async fn status(folder: &Path, at: i64) -> Result<Status, Failure> {
    read(Repo::find(folder).await, at).await
}

/// The status of the repository `found` for a folder, read after the
/// Space's event `at`: `repo: false` when none was, with why when git
/// could not look, as in a repository another user owns.
pub async fn read(found: Result<Option<Repo>, Failure>, at: i64) -> Result<Status, Failure> {
    let problem = match found {
        Ok(Some(repo)) => return of(repo, at).await,
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
async fn of(repo: Repo, at: i64) -> Result<Status, Failure> {
    let said = repo.porcelain().await?;
    let against = match &said.head {
        Some(head) => head.clone(),
        None => repo.empty_tree().await?,
    };
    // Plumbing, as T3 Code: a porcelain diff writes the index even with
    // GIT_OPTIONAL_LOCKS=0.
    let counted = repo.run(
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
        let default = repo.default_on(remote.as_deref()).await?;
        Ok::<_, Failure>((remote, default))
    };
    let (counted, remote) = futures::join!(counted, remote);
    let (remote, default_branch) = remote?;
    let counts: HashMap<String, (u32, u32)> = parse::numstat(&counted?.stdout)
        .into_iter()
        .map(|f| (f.path, (f.added, f.removed)))
        .collect();
    let ahead_of_default = match (&said.upstream, &said.head, &default_branch) {
        (None, Some(_), Some(default)) => {
            ahead_of(&repo, remote.as_deref(), default, said.branch.as_deref()).await?
        }
        _ => None,
    };
    let mut files = said.files;
    for file in &mut files {
        (file.added, file.removed) = counts.get(&file.path).copied().unwrap_or_default();
    }
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

/// How many commits `HEAD` has that `default` does not: the remote's copy
/// of it, else the one here unless it is the branch checked out. None
/// when neither is there to count from.
async fn ahead_of(
    repo: &Repo,
    remote: Option<&str>,
    default: &str,
    branch: Option<&str>,
) -> Result<Option<u32>, Failure> {
    let mut tips = Vec::new();
    tips.extend(remote.map(|remote| format!("refs/remotes/{remote}/{default}")));
    if branch != Some(default) {
        tips.push(format!("refs/heads/{default}"));
    }
    for tip in tips {
        if !repo.has_ref(&tip).await? {
            continue;
        }
        let range = format!("{tip}..HEAD");
        let counted = repo
            .run(
                ["rev-list", "--count", range.as_str(), "--"],
                Opts::default(),
            )
            .await?;
        return Ok(counted.text().parse().ok());
    }
    Ok(None)
}
