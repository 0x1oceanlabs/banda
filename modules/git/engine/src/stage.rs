//! `git.stage`, `git.unstage` and `git.revert`: what the next commit takes,
//! and the work tree put back, a hunk, a file or the whole diff at a time,
//! as the Codex app's review pane does (ADR 0034, decision 2).
//!
//! Stage and revert take the work tree against the index (the Unstaged
//! scope), unstage the index against `HEAD` (Staged). A hunk is the lines
//! the Diff drew: git diffs the file again with no context, takes every
//! change in those lines and applies just those, so a hunk drawn with
//! whitespace hidden takes its whitespace along, and a hunk of a renamed
//! file changes its lines alone, never the rename. Nothing is changed
//! when the file is no longer as the Diff drew it.

use crate::diff::{sides, untracked};
use crate::model::{ChangeAsk, HunkAsk, Scope};
use crate::repo::{Repo, pathspec, plain_paths};
use crate::run::{Opts, Reason, git};
use banda_kernel::Refusal;
use std::collections::HashSet;

/// What is done to the files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Into the index from the work tree.
    Stage,
    /// Out of the index, back to `HEAD`.
    Unstage,
    /// The work tree back to the index; an untracked file goes.
    Revert,
}

/// What a hunk no longer as the Diff drew it says.
const MOVED: &str = "This changed since the Diff was read: look again.";

/// Does `act` to `ask`'s files, or to the lines of its hunk.
pub async fn change(repo: &Repo, act: Act, ask: ChangeAsk) -> Result<(), Refusal> {
    let files = plain_paths(&ask.files)?;
    match (ask.hunk, files.as_slice()) {
        (_, []) => Err(Refusal::invalid("Name the files to change.")),
        (None, files) => whole(repo, act, files).await,
        (Some(hunk), files) => lines(repo, act, files, hunk).await,
    }
}

/// `args` on the files, given as they are.
async fn on(repo: &Repo, args: &[&str], files: &[&str]) -> Result<(), Refusal> {
    repo.run_on_paths(args, files, Opts::writes()).await?;
    Ok(())
}

/// Does `act` to the files whole.
async fn whole(repo: &Repo, act: Act, files: &[&str]) -> Result<(), Refusal> {
    match act {
        Act::Stage => on(repo, &["add", "--all"], files).await,
        // Before the first commit, `reset` empties the index of them.
        Act::Unstage => on(repo, &["reset", "--quiet"], files).await,
        Act::Revert => {
            let untracked: HashSet<String> = untracked(repo).await?.into_iter().collect();
            let (gone, tracked): (Vec<&str>, Vec<&str>) =
                files.iter().partition(|path| untracked.contains(**path));
            if !tracked.is_empty() {
                on(repo, &["checkout", "--quiet"], &tracked).await?;
            }
            gone.into_iter().try_for_each(|path| remove(repo, path))
        }
    }
}

/// Removes an untracked file: a file or a link inside the repository,
/// never a folder.
fn remove(repo: &Repo, path: &str) -> Result<(), Refusal> {
    let file = repo.top.join(path);
    match std::fs::symlink_metadata(&file) {
        Ok(about) if !about.is_dir() => std::fs::remove_file(&file).map_err(|error| {
            tracing::warn!(%error, path, "an untracked file could not be removed");
            Refusal::conflict(format!("{path} could not be removed."))
        }),
        _ => Ok(()),
    }
}

/// Does `act` to the changes in the hunk's lines of the one file.
async fn lines(repo: &Repo, act: Act, files: &[&str], hunk: HunkAsk) -> Result<(), Refusal> {
    // The scope the Diff drew it in, diffed again with no context.
    let scope = match act {
        Act::Unstage => Scope::Staged,
        Act::Stage | Act::Revert => Scope::Unstaged,
    };
    let head = repo.head().await?;
    let sides = sides(repo, &scope, head.as_deref()).await?;
    let mut args = sides.args(false, &["--full-index", "--unified=0"]);
    args.extend(files.iter().map(|path| pathspec(path)));
    let diffed = repo.run(args, Opts::default()).await?;
    let patch = String::from_utf8_lossy(&diffed.stdout);
    let picked = pick(&patch, &hunk).ok_or_else(|| Refusal::conflict(MOVED))?;
    let mut apply = vec!["apply", "--unidiff-zero"];
    match act {
        Act::Stage => apply.push("--cached"),
        Act::Unstage => apply.extend(["--cached", "--reverse"]),
        Act::Revert => apply.push("--reverse"),
    }
    let opts = Opts {
        stdin: Some(picked.into_bytes()),
        ..Opts::writes()
    };
    let applied = git(&repo.top, apply, opts).await?;
    if applied.success {
        return Ok(());
    }
    // Locked is worth trying again; anything else is a file changed since.
    Err(match applied.failure() {
        failure if failure.0 == Reason::Locked => failure.into(),
        _ => Refusal::conflict(MOVED),
    })
}

/// The patch of one file with no context cut to the changes in `hunk`'s
/// lines: none when the file is not the one the Diff drew, or nothing
/// changed there.
fn pick(patch: &str, hunk: &HunkAsk) -> Option<String> {
    let first = patch.find("\n@@ ")? + 1;
    let (header, hunks) = patch.split_at(first);
    if header.matches("diff --git ").count() != 1 || !same_objects(header, hunk) {
        return None;
    }
    let mut picked = lines_alone(header)?;
    let mut taken = false;
    // A change is in the hunk when some of its lines are, on a side.
    let within = |(start, lines): (u32, u32), (from, count): (u32, u32)| {
        lines > 0 && start < from + count.max(1) && from < start + lines
    };
    for part in split_hunks(hunks) {
        let (old, new) = range(part)?;
        if within(old, (hunk.old_start, hunk.old_lines))
            || within(new, (hunk.new_start, hunk.new_lines))
        {
            picked.push_str(part);
            taken = true;
        }
    }
    taken.then_some(picked)
}

/// A file's patch header as one of its lines alone: a rename's or a
/// copy's is made a change of the file where it is now, so the hunk
/// applied, or applied in reverse, leaves the file where it is. None when
/// git named no new side.
fn lines_alone(header: &str) -> Option<String> {
    const MOVES: [&str; 8] = [
        "similarity index ",
        "dissimilarity index ",
        "rename from ",
        "rename to ",
        "copy from ",
        "copy to ",
        "old mode ",
        "new mode ",
    ];
    let moved = header.lines().any(|line| {
        ["rename from ", "copy from "]
            .iter()
            .any(|m| line.starts_with(m))
    });
    if !moved {
        return Some(header.to_owned());
    }
    // Its name as git wrote it after `+++ `: `b/path`, or quoted.
    let new = header.lines().find_map(|line| line.strip_prefix("+++ "))?;
    let old = match new.strip_prefix("\"b/") {
        Some(path) => format!("\"a/{path}"),
        None => format!("a/{}", new.strip_prefix("b/")?),
    };
    let mut alone = String::new();
    for line in header.lines() {
        let line = match line {
            line if line.starts_with("diff --git ") => format!("diff --git {old} {new}"),
            line if line.starts_with("--- ") => format!("--- {old}"),
            line if MOVES.iter().any(|m| line.starts_with(m)) => continue,
            line => line.to_owned(),
        };
        alone.push_str(&line);
        alone.push('\n');
    }
    Some(alone)
}

/// Whether the patch's `index` line names the objects the Diff drew.
fn same_objects(header: &str, hunk: &HunkAsk) -> bool {
    let Some(line) = header.lines().find_map(|line| line.strip_prefix("index ")) else {
        return false;
    };
    let ids = line.split(' ').next().unwrap_or_default();
    let Some((old, new)) = ids.split_once("..") else {
        return false;
    };
    let short = |id: &str| id.len() >= 7 && id.bytes().all(|b| b.is_ascii_hexdigit());
    short(&hunk.old_id)
        && short(&hunk.new_id)
        && old.starts_with(&hunk.old_id)
        && new.starts_with(&hunk.new_id)
}

/// Each hunk of a file's patch, its `@@` line and lines.
fn split_hunks(hunks: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = hunks.match_indices("\n@@ ").map(|(at, _)| at + 1).collect();
    starts.insert(0, 0);
    starts.push(hunks.len());
    starts.windows(2).map(|w| &hunks[w[0]..w[1]]).collect()
}

/// A hunk's `@@ -a,b +c,d @@` line read, as each side's first line and
/// count: a count left out is 1.
fn range(hunk: &str) -> Option<((u32, u32), (u32, u32))> {
    let line = hunk.lines().next()?.strip_prefix("@@ -")?;
    let (old, rest) = line.split_once(" +")?;
    let new = rest.split_once(" @@")?.0;
    let side = |side: &str| -> Option<(u32, u32)> {
        match side.split_once(',') {
            Some((start, lines)) => Some((start.parse().ok()?, lines.parse().ok()?)),
            None => Some((side.parse().ok()?, 1)),
        }
    };
    Some((side(old)?, side(new)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCH: &str = "diff --git a/f b/f\n\
        index 97b3d1a0000000000000000000000000000000aa..3e913d0000000000000000000000000000000000bb 100644\n\
        --- a/f\n\
        +++ b/f\n\
        @@ -2 +2 @@\n\
        -2\n\
        +two\n\
        @@ -12,0 +13 @@\n\
        +new\n";

    fn hunk(old: (u32, u32), new: (u32, u32)) -> HunkAsk {
        HunkAsk {
            old_start: old.0,
            old_lines: old.1,
            new_start: new.0,
            new_lines: new.1,
            old_id: "97b3d1a".into(),
            new_id: "3e913d0".into(),
        }
    }

    #[test]
    fn a_hunk_takes_the_changes_in_its_lines_alone() {
        let first = pick(PATCH, &hunk((1, 5), (1, 5))).unwrap();
        assert!(first.contains("+two") && !first.contains("+new"));
        let second = pick(PATCH, &hunk((10, 3), (11, 4))).unwrap();
        assert!(second.contains("+new") && !second.contains("+two"));
        assert!(second.starts_with("diff --git a/f b/f\nindex "));
    }

    #[test]
    fn a_hunk_of_a_renamed_file_leaves_it_where_it_is() {
        let renamed = PATCH.replace(
            "diff --git a/f b/f\nindex ",
            "diff --git a/old b/f\nsimilarity index 80%\nrename from old\nrename to f\nindex ",
        );
        let renamed = renamed.replace("--- a/f\n", "--- a/old\n");
        let picked = pick(&renamed, &hunk((1, 5), (1, 5))).unwrap();
        assert!(picked.starts_with("diff --git a/f b/f\nindex "), "{picked}");
        assert!(
            picked.contains("\n--- a/f\n+++ b/f\n@@ -2 +2 @@\n"),
            "{picked}"
        );
        assert!(
            !picked.contains("rename") && !picked.contains("+new"),
            "{picked}"
        );
    }

    #[test]
    fn a_hunk_of_a_file_changed_since_takes_nothing() {
        let mut moved = hunk((1, 5), (1, 5));
        moved.new_id = "1234567".into();
        assert!(pick(PATCH, &moved).is_none());
        assert!(pick(PATCH, &hunk((30, 3), (31, 3))).is_none());
        assert!(pick("", &hunk((1, 5), (1, 5))).is_none());
    }
}
