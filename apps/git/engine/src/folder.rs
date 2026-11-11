//! The folder's work goes with a Thread to another machine (ADR 0116,
//! decision 8): what the folder holds that is not committed, as a
//! snapshot commit in a git bundle, with no push and no remote.
//!
//! The Thread's machine keeps the work tree as a checkpoint is kept
//! ([`crate::checkpoint::capture`]), under `refs/banda/moves/<thread>`,
//! and writes a bundle of it without the commits the other machine has
//! ([`pack`]), in the Project's data beside the Thread's artefact:
//! `moves/<move>.bundle`, which the window carries in pieces as it
//! carries the Thread. The other machine takes the bundle's objects and
//! puts its folder as the old one was ([`unpack`]): the same branch at
//! the same commit, the snapshot's changes not committed. Only into a
//! folder that is free ([`folder_for`]): one with changes of its own
//! refuses, and so does a branch of that name that went another way.
//!
//! The snapshot and the bundle are Banda's own git, which runs no hook
//! and no filter; putting the folder as it was is an act the Person asked
//! for, and runs as their own git does.

use crate::checkpoint;
use crate::model::{FolderAsk, FolderFor, PackFolder, PackedFolder, UnpackFolder};
use crate::repo::Repo;
use crate::run::Opts;
use banda_kernel::{Call, Error, ModuleProject, Refusal};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Where a move's snapshot is kept.
const ROOT: &str = "refs/banda/moves";

/// The most tips a folder names of itself.
const TIPS: usize = 200;

pub fn person_only(call: &Call) -> Result<(), Refusal> {
    if call.participant().agent().is_some() {
        return Err(Refusal::forbidden(
            "Only a Person moves a Thread to another machine.",
        ));
    }
    Ok(())
}

/// The ref a Thread's snapshot is kept under: named by the Thread's ID
/// alone, letters, digits and dashes.
fn reference(thread: &str) -> Result<String, Refusal> {
    let id = !thread.is_empty()
        && thread
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    match id {
        true => Ok(format!("{ROOT}/{thread}")),
        false => Err(Refusal::invalid("A Thread is named by its ID.")),
    }
}

/// A commit named whole, in hex: never an option, a ref or a range.
fn commit(name: &str) -> bool {
    matches!(name.len(), 40 | 64) && name.chars().all(|c| c.is_ascii_hexdigit())
}

/// A move's bundle in the Project's data, as the Thread's machine wrote
/// it, or as it was carried here.
fn bundle(project: &ModuleProject, id: &str, carried: bool) -> Result<PathBuf, Refusal> {
    let named = id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if !named {
        return Err(Refusal::invalid("That is no move's ID."));
    }
    let name = match carried {
        true => format!("{id}.bundle.part"),
        false => format!("{id}.bundle"),
    };
    Ok(project.data().join("moves").join(name))
}

async fn sha256(path: PathBuf) -> Result<(u64, String), Error> {
    let read = tokio::task::spawn_blocking(move || {
        let (mut file, mut hash) = (std::fs::File::open(&path)?, Sha256::new());
        let size = std::io::copy(&mut file, &mut hash)?;
        let hex = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        Ok::<_, std::io::Error>((size, hex))
    });
    Ok(read.await.map_err(std::io::Error::other)??)
}

/// What this Project's folder is to a move: whether it is a repository,
/// its own tips, which of `commits` it has, and whether it is free.
pub async fn folder_for(
    project: &ModuleProject,
    busy: bool,
    FolderAsk { commits }: FolderAsk,
) -> Result<FolderFor, Refusal> {
    let Some(repo) = Repo::find(project).await? else {
        return Ok(FolderFor {
            git: false,
            free: true,
            tips: Vec::new(),
            has: Vec::new(),
        });
    };
    let mut has = Vec::new();
    for named in commits.iter().filter(|named| commit(named)).take(TIPS) {
        let known = format!("{named}^{{commit}}");
        let there = ["rev-parse", "--verify", "--quiet", known.as_str()];
        if repo.verified(there).await?.is_some() {
            has.push(named.clone());
        }
    }
    let listed = ["for-each-ref", "--format=%(objectname)", "refs/remotes"];
    let listed = repo.run(listed, Opts::default()).await?.text();
    let mut tips: Vec<String> = repo.head().await?.into_iter().collect();
    for tip in listed.lines() {
        if tips.len() < TIPS && !tips.iter().any(|known| known == tip) {
            tips.push(tip.to_owned());
        }
    }
    let free = !busy && repo.porcelain().await?.files.is_empty();
    Ok(FolderFor {
        git: true,
        free,
        tips,
        has,
    })
}

/// Keeps the folder as it is now as `thread`'s snapshot, and writes move
/// `id`'s bundle of it without the commits of `have`.
pub async fn pack(
    project: &ModuleProject,
    PackFolder { id, thread, have }: PackFolder,
) -> Result<PackedFolder, Refusal> {
    let repo = Repo::open(project).await?;
    let (reference, path) = (reference(&thread)?, bundle(project, &id, false)?);
    let Some(head) = repo.head().await? else {
        return Err(Refusal::conflict(
            "This folder has no commit yet, so its work stays here.",
        ));
    };
    let branch = repo.branch().await?;
    let changed = repo.porcelain().await?.files.len();
    // One kept before is not this folder as it is now.
    let _ = repo
        .run(["update-ref", "-d", reference.as_str()], Opts::default())
        .await;
    checkpoint::capture(&repo, &reference).await?;
    if checkpoint::find(&repo, &reference).await?.is_none() {
        return Err(Refusal::conflict(
            "This folder has too many files that are new or changed to go along: commit \
             them, or move the Thread alone.",
        ));
    }
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(Error::from)?;
    }
    let mut args = vec!["bundle".to_owned(), "create".to_owned()];
    args.push(path.display().to_string());
    args.push(reference.clone());
    for known in have.iter().filter(|named| commit(named)).take(TIPS) {
        let named = format!("{known}^{{commit}}");
        let here = ["rev-parse", "--verify", "--quiet", named.as_str()];
        if repo.verified(here).await?.is_some() {
            args.push(format!("^{known}"));
        }
    }
    repo.run(args, Opts::default()).await?;
    let (size, sha256) = sha256(path).await?;
    Ok(PackedFolder {
        branch,
        head,
        changed: u32::try_from(changed).unwrap_or(u32::MAX),
        size,
        sha256,
    })
}

/// Takes the bundle carried here as move `id`, and puts this folder as
/// the one it comes from was: `branch` at `head`, the snapshot's changes
/// not committed.
pub async fn unpack(
    project: &ModuleProject,
    UnpackFolder {
        id,
        thread,
        branch,
        head,
        sha256: sha,
    }: UnpackFolder,
) -> Result<(), Refusal> {
    let repo = Repo::open(project).await?;
    let (reference, path) = (reference(&thread)?, bundle(project, &id, true)?);
    if !commit(&head) {
        return Err(Refusal::invalid("A commit is named whole."));
    }
    if let Some(branch) = &branch {
        crate::act::ref_name(branch)?;
    }
    if !repo.porcelain().await?.files.is_empty() {
        return Err(not_free(project));
    }
    let not_whole = || Refusal::conflict("The folder's work did not come whole: carry it again.");
    match sha256(path.clone()).await {
        Ok((_, found)) if found.eq_ignore_ascii_case(&sha) => {}
        _ => return Err(not_whole()),
    }
    let taken = repo
        .run(
            ["bundle", "unbundle", &path.display().to_string()],
            Opts::default(),
        )
        .await
        .map_err(|_| {
            Refusal::conflict(
                "This folder lacks commits the work was made on: fetch the branch here, then \
                 move the Thread.",
            )
        })?
        .text();
    let snapshot = (taken.lines())
        .find_map(|line| line.strip_suffix(reference.as_str()))
        .map(|sha| sha.trim().to_owned())
        .filter(|sha| commit(sha))
        .ok_or_else(not_whole)?;
    if repo.parent(&snapshot).await?.as_deref() != Some(head.as_str()) {
        return Err(not_whole());
    }
    repo.run(
        ["update-ref", reference.as_str(), snapshot.as_str()],
        Opts::default(),
    )
    .await?;
    if let Some(branch) = &branch {
        went_another_way(&repo, branch, &head).await?;
    }
    let checkout = match &branch {
        Some(branch) => vec!["checkout", "--quiet", "-B", branch.as_str(), head.as_str()],
        None => vec!["checkout", "--quiet", "--detach", head.as_str()],
    };
    repo.run([&checkout[..], &["--"]].concat(), repo.asked())
        .await?;
    repo.run(
        ["read-tree", "-u", "--reset", snapshot.as_str()],
        repo.asked(),
    )
    .await?;
    repo.run(["reset", "--quiet", head.as_str()], repo.asked())
        .await?;
    if let Err(error) = std::fs::remove_file(&path) {
        tracing::warn!(%error, "a move's bundle could not be taken away");
    }
    Ok(())
}

fn not_free(project: &ModuleProject) -> Refusal {
    Refusal::conflict(format!(
        "{} has changes that are not committed: commit or stash them there, then move the \
         Thread.",
        project.name()
    ))
}

/// Refuses a `branch` here that is not on the way to `head`: its commits
/// would be left by a checkout that moves it.
async fn went_another_way(repo: &Repo, branch: &str, head: &str) -> Result<(), Refusal> {
    let named = format!("refs/heads/{branch}");
    let there = ["rev-parse", "--verify", "--quiet", named.as_str()];
    let Some(tip) = repo.verified(there).await? else {
        return Ok(());
    };
    let on_the_way = ["merge-base", "--is-ancestor", tip.as_str(), head];
    if tip == head || repo.yes(on_the_way).await? {
        return Ok(());
    }
    Err(Refusal::conflict(format!(
        "The branch {branch} went another way in this folder: move the Thread once they \
         agree."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commit_is_named_whole_and_a_snapshot_by_its_threads_id() {
        assert!(commit(&"a".repeat(40)) && commit(&"0".repeat(64)));
        assert!(!commit("HEAD") && !commit("--all") && !commit(&"g".repeat(40)));
        assert_eq!(reference("t-1").unwrap(), "refs/banda/moves/t-1");
        assert!(reference("../heads/main").is_err() && reference("").is_err());
    }
}
