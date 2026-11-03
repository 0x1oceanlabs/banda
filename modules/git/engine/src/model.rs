//! The git module's words on the wire.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The Space's folder as git sees it, as `git.status` answers.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Status {
    /// The Space's event position as this was read: a Pane follows the
    /// events after it, and reads this again after a turn ends.
    #[ts(type = "number")]
    pub at: i64,
    /// Whether the folder is in a git repository; the rest is empty when
    /// it is not.
    pub repo: bool,
    /// The branch checked out; none when `HEAD` is detached.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// The commit `HEAD` is; none before the first commit.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    /// The branch's upstream, as `origin/main`.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// How many commits the branch has that its upstream does not, as git
    /// last fetched it; with an upstream only.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ahead: Option<u32>,
    /// How many commits its upstream has that the branch does not.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behind: Option<u32>,
    /// The repository's default branch, as `main`: `origin/HEAD`'s, or
    /// `main`, or `master`, the first that is there.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    /// What changed against `HEAD`, in the index and the work tree, by
    /// path.
    pub files: Vec<Changed>,
    /// The lines added in all of them.
    pub added: u32,
    /// The lines removed in all of them.
    pub removed: u32,
}

/// A file that changed against `HEAD`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Changed {
    /// From the repository's top, with `/` between names. An untracked
    /// folder git has not looked into ends with `/`.
    pub path: String,
    /// Where a renamed file was.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: Change,
    /// Whether its change is in the index: all of it (`true`), none of it
    /// (`false`), or a part (none).
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staged: Option<bool>,
    /// Lines added; 0 for an untracked or a binary file.
    pub added: u32,
    /// Lines removed.
    pub removed: u32,
}

/// How a file changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "git/")]
pub enum Change {
    Added,
    Modified,
    Deleted,
    Renamed,
    /// Not in the index, nor ignored.
    Untracked,
    /// Both sides of a merge changed it, and it waits to be resolved.
    Conflicted,
}

/// What a diff compares (ADR 0034, decision 2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "git/")]
pub enum Scope {
    /// The work tree, untracked files too, against where the branch left
    /// `base`: the default branch when none is given ("Automatic").
    Changes {
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        base: Option<String>,
    },
    /// The work tree, untracked files too, against `HEAD`.
    Uncommitted,
    /// The work tree, untracked files too, against the index: what is not
    /// staged yet, as the Codex app's.
    Unstaged,
    /// The index against `HEAD`: what a commit would take.
    Staged,
    /// One commit against its first parent; the first commit against
    /// nothing.
    Commit { sha: String },
    /// What a turn of an Agent's changed: the work tree as the turn began
    /// against how it ended, or against now while it runs. Only a turn
    /// with a checkpoint has it.
    Turn { thread: String, turn: String },
}

/// What `git.diff` is asked.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct DiffAsk {
    pub scope: Scope,
    /// Changes in whitespace alone are no changes (`--ignore-all-space`).
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    pub ignore_whitespace: bool,
    /// Only these files, by their path or where they were before a rename:
    /// their lines and patch alone, each patch cut at 1 MiB, as a Pane
    /// loads a file it shows.
    #[serde(default)]
    #[ts(optional)]
    pub files: Option<Vec<String>>,
}

/// A diff: every file it holds, and its patch.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Diff {
    /// The Space's event position as this was read: a Pane follows the
    /// events after it, and reads this again after a turn ends.
    #[ts(type = "number")]
    pub at: i64,
    /// What Changes compared against: the base and where the branch left
    /// it. None for the other scopes, or when no base was found and the
    /// work tree was compared with `HEAD`.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<Base>,
    /// Every file that changed, whole even when the patch is cut; without
    /// untracked files when there are more than 5000 of them.
    pub files: Vec<FileDiff>,
    /// A unified diff with `a/` and `b/` prefixes, as git prints it.
    pub patch: String,
    /// The patch was cut, after the last file that fit in 120 000 bytes or
    /// at 1 MiB of a file asked by name; or untracked files were left out.
    pub truncated: bool,
}

/// The base Changes compared against.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Base {
    /// The ref, as `main` or `origin/main`.
    pub name: String,
    /// The commit where the branch left it: their merge base.
    pub sha: String,
}

/// One file of a diff, as `--numstat` counts it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct FileDiff {
    pub path: String,
    /// Where a renamed file was.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub added: u32,
    pub removed: u32,
    /// Git compares it as bytes, not lines: both counts are 0.
    pub binary: bool,
}

/// What `git.refs` is asked.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct RefsAsk {
    /// Only the branches whose name holds it, in any case.
    #[serde(default)]
    #[ts(optional)]
    pub query: Option<String>,
}

/// A branch, here or on a remote.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Ref {
    /// `main`, or `origin/main` for a remote's.
    pub name: String,
    pub remote: bool,
    /// The branch checked out.
    pub current: bool,
    /// The default branch, or a remote's copy of it.
    pub default: bool,
}

/// What `git.commits` is asked.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct CommitsAsk {
    /// The ref the branch left; the default branch when none is given.
    #[serde(default)]
    #[ts(optional)]
    pub base: Option<String>,
}

/// A commit on the branch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Commit {
    pub sha: String,
    /// Its sha as short as git keeps it unique.
    pub short: String,
    /// Its message's first line, at most 300 characters.
    pub subject: String,
    pub author: String,
    /// When it was committed, in seconds since 1970.
    #[ts(type = "number")]
    pub time: i64,
}

/// What `git.contents` is asked: a file of a diff.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct ContentsAsk {
    pub scope: Scope,
    pub path: String,
    /// Where it was before a rename: the old side is read there.
    #[serde(default)]
    #[ts(optional)]
    pub old_path: Option<String>,
}

/// A file's text before and after, to show the lines a diff leaves out.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct Contents {
    /// Before: none when the file was not there.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    /// After: none when it is gone.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new: Option<String>,
    /// A side is binary or past 1 MiB, and neither is sent.
    pub too_large: bool,
}

/// What `git.stage`, `git.unstage` and `git.revert` change: files whole,
/// or the lines of one hunk of one file. Stage and revert take the work
/// tree against the index (Unstaged); unstage the index against `HEAD`
/// (Staged).
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct ChangeAsk {
    /// The files, by their path from the top; a renamed one by where it
    /// was too.
    pub files: Vec<String>,
    /// Only these lines of the one file in `files`.
    #[serde(default)]
    #[ts(optional)]
    pub hunk: Option<HunkAsk>,
}

/// A hunk of a file as the Diff drew it: its lines on either side, and
/// the file's objects from the patch's `index` line, so that nothing is
/// changed when the file has changed since. What changed in these lines
/// is taken, whitespace too, though the Diff hid it.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "git/")]
pub struct HunkAsk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// The file's object before and after, as short as the patch has it.
    pub old_id: String,
    pub new_id: String,
}
