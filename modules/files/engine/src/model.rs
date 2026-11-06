//! The files module's words on the wire.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a name in a folder is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Kind {
    File,
    Folder,
    /// A symbolic link; [`Entry::to_folder`] says where it leads.
    Link,
}

/// What `files.list` asks: one folder, from the Project's folder when it is
/// relative. The Person may name any folder; an Agent, only one inside the
/// Project's.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct ListAsk {
    /// `""` is the Project's folder.
    #[serde(default)]
    pub dir: String,
}

/// One folder, as `files.list` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Listing {
    /// The folder, absolute, its links followed.
    pub dir: String,
    /// Whether it is the Project's folder or inside it.
    pub inside: bool,
    /// Folders first, then the rest, each by name as a person reads it:
    /// `2` before `10`, any case.
    pub entries: Vec<Entry>,
}

/// One name in a folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
    /// A link that leads to a folder, which opens as one.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub to_folder: bool,
    /// Its size in bytes, for a file or a link to one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub size: Option<u64>,
    /// When it last changed, in ms since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub modified: Option<i64>,
    /// What git ignores, in a folder git knows: shown greyed, not hidden.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub ignored: bool,
    /// A dotfile, shown only when hidden files are.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub hidden: bool,
}

/// What `files.stat` asks: paths, each as `files.list` reads its `dir`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct StatAsk {
    pub paths: Vec<String>,
}

/// What a path is, as `files.stat` answers for each path; none for one
/// that is gone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Stat {
    /// Absolute, its links followed.
    pub path: String,
    /// A file or a folder: the path's links are followed.
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub modified: Option<i64>,
    /// Its kind of content, as `text/markdown`: by its extension, else by
    /// its first bytes. None for a folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mime: Option<String>,
}

/// What `files.read` asks.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct ReadAsk {
    pub path: String,
    /// The most bytes to read: 1 MiB unless said, 16 MiB at most.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub upto: Option<u64>,
}

/// A file's text, as `files.read` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Text {
    /// Absolute, its links followed.
    pub path: String,
    /// Its text, or its first `upto` bytes of it, never cut inside a
    /// character; none when it is binary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
    /// Whether it holds a NUL in its first 8 KiB, or is not UTF-8.
    pub binary: bool,
    /// Whether it is longer than what was read.
    pub truncated: bool,
    /// Its whole size in bytes.
    #[ts(type = "number")]
    pub bytes: u64,
    /// The SHA-256 of all of it, in hex, when it was read whole: a write
    /// says it saves over this, so one that changed since is not lost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hash: Option<String>,
}

/// What `files.find` asks.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct FindAsk {
    /// The folder to look under; the Project's when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dir: Option<String>,
    /// Letters in order, fuzzy: `mrs` finds `src/main.rs`.
    pub query: String,
    /// The most paths: 50 unless said, 200 at most.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub limit: Option<u32>,
}

/// What `files.find` found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Found {
    /// The folder looked under: absolute, its links followed.
    pub dir: String,
    /// Files under it, as paths from it with `/` between names, best
    /// first: a match in a file's name before one in its folders.
    pub paths: Vec<String>,
    /// Whether the folder held more files than are looked through, so
    /// some were not.
    pub cut: bool,
}

/// What `files.watch` asks: the folders a Pane shows.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct WatchAsk {
    pub dirs: Vec<String>,
}

/// One piece of `files.watch`. The folders are named as they were asked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Watched {
    /// The first piece: these folders are watched from now on.
    Watching { dirs: Vec<String> },
    /// The system has no watch left for these folders, so their changes
    /// are not heard: raise inotify's `max_user_watches`. It comes once,
    /// right after `watching`.
    Limit { dirs: Vec<String> },
    /// These folders' listings changed: list them again.
    Changed { dirs: Vec<String> },
    /// The system lost track of changes: list every folder again.
    Rescan { dirs: Vec<String> },
}
