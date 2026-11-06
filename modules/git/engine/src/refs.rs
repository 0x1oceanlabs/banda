//! `git.refs` and `git.commits`: the branches to pick a base from, and the
//! commits a branch has since it left its base, as T3 Code lists them
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, sections 1 and 3).

use crate::model::{Commit, CommitsAsk, Ref, RefsAsk};
use crate::parse;
use crate::repo::Repo;
use crate::run::Opts;
use banda_kernel::Refusal;

/// The most branches listed, of this repository's and of remotes' each.
pub const REFS: usize = 100;
/// The most commits listed.
pub const COMMITS: usize = 100;

/// The branches here and on remotes, the one checked out first, then the
/// default, then by their last commit, newest first.
pub async fn refs(repo: &Repo, RefsAsk { query }: RefsAsk) -> Result<Vec<Ref>, Refusal> {
    let listed = repo.run(
        [
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%09%(refname)%09%(symref)",
            "refs/heads",
            "refs/remotes",
        ],
        Opts::default(),
    );
    let remote = repo.primary_remote().await?;
    let default = repo.default_branch(remote.as_deref(), None);
    let (listed, default) = futures::join!(listed, default);
    let (listed, default) = (listed?, default?.map(|default| default.name));
    let remote_default = match (&remote, &default) {
        (Some(remote), Some(default)) => Some(format!("{remote}/{default}")),
        _ => None,
    };
    let query = query.map(|q| q.to_lowercase());
    let text = listed.text();
    let mut refs: Vec<Ref> = text
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let (head, name) = (fields.next()?, fields.next()?);
            let symref = fields.next().unwrap_or_default();
            // `origin/HEAD` names another branch.
            if !symref.is_empty() {
                return None;
            }
            let (name, remote) = match name.strip_prefix("refs/heads/") {
                Some(name) => (name, false),
                None => (name.strip_prefix("refs/remotes/")?, true),
            };
            let default = match remote {
                false => default.as_deref() == Some(name),
                true => remote_default.as_deref() == Some(name),
            };
            Some(Ref {
                name: name.to_owned(),
                remote,
                current: head == "*",
                default,
            })
        })
        .filter(|r| {
            query
                .as_ref()
                .is_none_or(|q| r.name.to_lowercase().contains(q))
        })
        .collect();
    refs.sort_by_key(|r| (!r.current, !r.default));
    let (mut here, mut there) = (0, 0);
    refs.retain(|r| {
        let count = if r.remote { &mut there } else { &mut here };
        *count += 1;
        *count <= REFS
    });
    Ok(refs)
}

/// The commits on the branch since it left `base`, or the default
/// branch, newest first; none when no base is found.
pub async fn commits(repo: &Repo, CommitsAsk { base }: CommitsAsk) -> Result<Vec<Commit>, Refusal> {
    if repo.head().await?.is_none() {
        return Ok(Vec::new());
    }
    let Some(found) = repo.base(base.as_deref()).await? else {
        return Ok(Vec::new());
    };
    let Some(since) = repo.merge_base(&found).await? else {
        return Ok(Vec::new());
    };
    let most = format!("--max-count={COMMITS}");
    let range = format!("{since}..HEAD");
    let listed = repo
        .run(
            [
                "log",
                "-z",
                "--no-notes",
                parse::LOG_FORMAT,
                &most,
                &range,
                "--",
            ],
            Opts::default(),
        )
        .await?;
    Ok(parse::log(&listed.stdout))
}
