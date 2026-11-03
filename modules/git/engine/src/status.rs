//! `git.status`: the branch and what changed against `HEAD`, as T3 Code
//! reads them (`docs/research/2026-11-02-t3-code-git-backend.md`,
//! section 2).

use crate::model::Status;
use crate::parse;
use crate::repo::Repo;
use crate::run::{Failure, Opts};
use std::collections::HashMap;
use std::path::Path;

/// The folder's status, read after the Space's event `at`; `repo: false`
/// in a folder git does not know.
pub async fn status(folder: &Path, at: i64) -> Result<Status, Failure> {
    let Some(repo) = Repo::find(folder).await? else {
        return Ok(Status {
            at,
            ..Status::default()
        });
    };
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
    let mut files = said.files;
    for file in &mut files {
        (file.added, file.removed) = counts.get(&file.path).copied().unwrap_or_default();
    }
    Ok(Status {
        at,
        repo: true,
        branch: said.branch,
        head: said.head,
        ahead: said.upstream.as_ref().and(said.ahead),
        behind: said.upstream.as_ref().and(said.behind),
        upstream: said.upstream,
        remote,
        default_branch,
        added: files.iter().map(|f| f.added).sum(),
        removed: files.iter().map(|f| f.removed).sum(),
        files,
    })
}
