//! The pulls module's words (ADR 0076): a pull request linked to a Thread,
//! what GitHub last said of it, what it needs and whose turn it is.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A pull request, by where it lives: `github.com`, `owner/name`, `595`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct PullRef {
    pub host: String,
    /// `owner/name`.
    pub repo: String,
    pub number: u32,
}

impl PullRef {
    /// Its page: `https://github.com/owner/name/pull/595`.
    pub fn url(&self) -> String {
        format!("https://{}/{}/pull/{}", self.host, self.repo, self.number)
    }
}

/// Who linked a pull request to a Thread.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum By {
    /// The Person, by its URL or number.
    Person,
    /// Create PR in the Thread's details.
    Created,
    /// The Thread's Agent: its own `gh pr create`, or its tool.
    Agent,
}

impl By {
    pub(crate) fn word(self) -> &'static str {
        match self {
            By::Person => "person",
            By::Created => "created",
            By::Agent => "agent",
        }
    }

    pub(crate) fn from_word(word: &str) -> By {
        match word {
            "created" => By::Created,
            "agent" => By::Agent,
            _ => By::Person,
        }
    }

    /// It was made in the Thread, which works on it (ADR 0076, decision 4).
    pub fn made(self) -> bool {
        self != By::Person
    }
}

/// Open, closed, or merged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum State {
    Open,
    Closed,
    Merged,
}

/// Its checks, summed up (ADR 0076, decision 2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum Checks {
    /// Any failed or was cancelled.
    Failing,
    /// None failed, and some still run.
    Running,
    /// None failed or runs, and some passed.
    Passing,
}

/// How many of its checks passed, failed and run, a re-run counted once.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct Counted {
    pub passed: u32,
    pub failed: u32,
    pub running: u32,
    /// Every check, the skipped and neutral too.
    pub total: u32,
}

/// What its reviewers decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum Review {
    Approved,
    ChangesRequested,
    /// A review the branch's rules ask for, not given yet.
    Required,
}

/// What GitHub said of a pull request, the last time it was read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct Snapshot {
    pub state: State,
    pub draft: bool,
    pub title: String,
    pub head: String,
    pub base: String,
    /// None when it has no checks.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checks: Option<Checks>,
    pub counted: Counted,
    /// None when no review is asked for or given.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<Review>,
    /// A review is asked of the Person's account.
    pub asked_of_you: bool,
    /// It conflicts with its base.
    pub conflicts: bool,
    /// GitHub merges it once it may.
    pub auto_merge: bool,
    pub additions: u32,
    pub deletions: u32,
    /// When it last changed on GitHub, in ms since the epoch.
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<i64>,
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<i64>,
    /// When Banda read it.
    #[ts(type = "number")]
    pub synced_at: i64,
}

/// What a pull request needs, the most urgent first (ADR 0076, decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum Need {
    Conflicts,
    Changes,
    Failing,
    /// Passing, approved or no review asked, not a draft.
    Ready,
    Review,
    Running,
    Draft,
    Merged,
    Closed,
}

/// Whose turn it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "pulls/")]
pub enum Turn {
    /// The Person's: to merge, to review, to mend.
    Person,
    /// An Agent's: its Thread works on it, or will be told.
    Agent,
    /// Its checks run, a review is asked of someone else, or GitHub merges
    /// it by itself.
    Waiting,
    /// Merged or closed.
    Landed,
}

/// A pull request linked to the Project's Threads, as a list shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct Pull {
    #[serde(flatten)]
    pub pull: PullRef,
    pub url: String,
    /// The Threads that link it, the first linked first.
    pub threads: Vec<String>,
    /// The Thread that works on it: the one that made it, or else the last
    /// that linked it.
    pub owner: String,
    /// How it came to its owner.
    pub by: By,
    /// Banda watches it for its owner (ADR 0076, decision 4): on for one
    /// made in a Thread.
    pub auto_fix: bool,
    /// None until it was read.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Snapshot>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub need: Option<Need>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<Turn>,
}

/// The Project's pull requests, the most urgent first.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct Listed {
    pub pulls: Vec<Pull>,
    /// Why GitHub could not be read, in plain words: no `gh`, no sign-in.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing: Option<String>,
    /// When GitHub was last read for the Project.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<i64>,
}

/// A pull request linked to a Thread, or let go of.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "pulls/")]
pub struct Linked {
    pub thread: String,
    #[serde(flatten)]
    pub pull: PullRef,
    pub url: String,
    pub by: By,
}

/// What `link` and `unlink` are asked.
#[derive(Clone, Debug, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "pulls/")]
pub struct LinkAsk {
    /// Its URL, or `#42` for one of the Project's own repository.
    pub pull: String,
    /// The Thread; an Agent's own when it asks, so it leaves it out.
    #[serde(default)]
    #[ts(optional)]
    pub thread: Option<String>,
}

/// What `list_thread` is asked.
#[derive(Clone, Debug, Default, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "pulls/")]
pub struct ThreadAsk {
    /// The Thread; an Agent's own when it asks, so it leaves it out.
    #[serde(default)]
    #[ts(optional)]
    pub thread: Option<String>,
}
