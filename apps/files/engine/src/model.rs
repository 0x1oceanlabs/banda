//! The files module's words on the wire.

use banda_kernel::Participant;
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
    /// Why `files.write` would not write it; none when it would.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub locked: Option<Locked>,
}

/// Why Files writes no file at a path, though it reads it (ADR 0073,
/// decision 8).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Locked {
    /// It is inside a `.git` folder, which is git's own.
    Git,
    /// It is in Banda's settings folder, `~/.config/banda`, whose files
    /// the settings Pane changes (ADR 0016).
    Settings,
    /// The system lets this user not write it, or not make a file in its
    /// folder.
    Denied,
}

/// What `files.write` asks: a file's new text, saved only over the text
/// it was made from.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct WriteAsk {
    /// As `files.list` reads its `dir`.
    pub path: String,
    pub text: String,
    /// The hash `files.read` gave of the text this one was made from;
    /// none for a file that must not be there yet.
    pub base: Option<String>,
}

/// What `files.write` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Written {
    /// The file holds the text now, written or held already: its hash,
    /// the next write's base.
    Written { hash: String },
    /// The file is not at `base` any more, so nothing was written.
    Moved {
        /// Its hash now; none when it is gone.
        hash: Option<String>,
        /// Who put it there, when that was a `files.write` the engine
        /// heard since it started.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<Participant>,
    },
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

/// The Person's own places, as `files.places` answers: the home folder,
/// and its Desktop and Downloads where the system names them and they are
/// there (the XDG user dirs on Linux, the standard folders on macOS).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Places {
    pub home: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub desktop: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub downloads: Option<String>,
}

/// What `files.opened` asks: a file the Person opened, as `files.list`
/// reads its `dir`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct OpenedAsk {
    pub path: String,
}

/// What `files.recent` asks.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct RecentAsk {
    /// The most files: 20 unless said, 100 at most.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub limit: Option<u32>,
}

/// A file the Person opened, as `files.recent` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Opened {
    /// Absolute, its links followed.
    pub path: String,
    /// When it was last opened, in ms since the Unix epoch.
    #[ts(type = "number")]
    pub last: i64,
    /// How many times it was opened.
    pub count: u32,
}

/// What `files.archive` asks: a zip, a tar, a gzipped tar or a 7z, as
/// `files.list` reads its `dir`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct ArchiveAsk {
    pub path: String,
}

/// What kind of archive a file is, by its first bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Packing {
    Zip,
    Tar,
    /// A tar in gzip.
    TarGz,
    /// One file in gzip, not a tar.
    Gz,
    #[serde(rename = "7z")]
    SevenZ,
}

/// What an archive holds, as `files.archive` answers: its names only,
/// never what they hold, and nothing taken out.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Archive {
    /// Absolute, its links followed.
    pub path: String,
    pub packing: Packing,
    /// In the order the archive holds them, at most 10 000.
    pub entries: Vec<Packed>,
    /// Whether it holds more than are listed.
    pub truncated: bool,
}

/// One name in an archive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Packed {
    /// As the archive writes it, `/` between names: only text, never a
    /// path on this disk, so `../x` or `/etc/x` is shown as it is.
    pub path: String,
    pub folder: bool,
    /// Its size in bytes, taken out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub size: Option<u64>,
    /// Its size in bytes, packed, where the archive says it per name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub packed: Option<u64>,
    /// When it last changed, in ms since the Unix epoch. A zip's own time
    /// names no zone, and is read as UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub modified: Option<i64>,
}

/// What `files.sheet` asks: a workbook (xlsx, xlsm, xlsb, xls, ods), and
/// which of its sheets; the first unless said.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct SheetAsk {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sheet: Option<String>,
}

/// One sheet of a workbook, as `files.sheet` answers: its cells as text,
/// as the sheet shows them, from its first cell that holds something.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Sheet {
    /// Absolute, its links followed.
    pub path: String,
    /// Every sheet's name, in the workbook's order.
    pub sheets: Vec<String>,
    /// The sheet these rows are of.
    pub sheet: String,
    /// At most 10 000 rows of at most 500 cells; a date as
    /// `2026-11-06 12:30:00`.
    pub rows: Vec<Vec<String>>,
    /// Whether it holds more rows or cells than are here.
    pub truncated: bool,
}

/// What `files.make` asks: a new empty file or folder, by its name in a
/// folder, as `files.list` reads its `dir`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct MakeAsk {
    pub dir: String,
    pub name: String,
    pub kind: Making,
}

/// What `files.make` makes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Making {
    #[default]
    File,
    Folder,
}

/// What `files.rename` asks: a new name for what is at `path`, in the
/// same folder. A link is renamed, not what it leads to.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct RenameAsk {
    pub path: String,
    pub name: String,
}

/// What `files.move` and `files.copy` ask: these paths into a folder.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct MoveAsk {
    pub paths: Vec<String>,
    pub dir: String,
    /// What to do where a name is taken in the folder: ask unless said.
    #[serde(default)]
    pub clash: Clash,
    /// What to do with each path whose name is taken, by the path as
    /// asked; the rest as `clash` says.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    #[ts(optional, as = "Option<std::collections::BTreeMap<String, Clash>>")]
    pub answers: std::collections::BTreeMap<String, Clash>,
    /// Names the job, so `files.cancel` can stop it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub job: Option<String>,
}

/// What to do with a path whose name is taken in the folder it goes to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "files/")]
pub enum Clash {
    /// Do nothing yet, and say which names are taken.
    #[default]
    Ask,
    /// What is there goes to the Trash, and this takes its place.
    Replace,
    /// This takes the next free name: `name 2.ext`.
    KeepBoth,
    /// This one is left where it is.
    Skip,
}

/// One piece of `files.move` or `files.copy`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Job {
    /// Asked to ask, these names are taken, and nothing was done.
    Clashes { clashes: Vec<Clashing> },
    /// How far the bytes are copied: it comes only when there are bytes
    /// to copy, at most ten times a second.
    Progress {
        #[ts(type = "number")]
        done: u64,
        #[ts(type = "number")]
        of: u64,
        /// The name copied now.
        name: String,
    },
    /// It ended: what was done, also when it stopped or failed on the way.
    Done(Done),
}

/// A path whose name is taken in the folder it goes to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Clashing {
    /// As it was asked.
    pub path: String,
    pub name: String,
    /// Whether what is there is a folder.
    pub folder: bool,
}

/// What an operation did, and what undoes it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Done {
    /// Where each thing is now: made, renamed, moved, copied or put back.
    pub paths: Vec<String>,
    /// What was asked and left where it is, as a clash skipped.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub skipped: Vec<String>,
    /// What undoes it, in order: none where nothing can, as a Trash on
    /// macOS, whose Finder puts back.
    pub undo: Vec<Step>,
    /// It was stopped before its end: `paths` says how far it went.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub stopped: bool,
    /// Why it failed on the way, after what `paths` says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub failed: Option<String>,
}

/// One step of an undo: a command of Files', with what it is asked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Step {
    /// `files.rename`.
    Rename { path: String, name: String },
    /// `files.move`, asking where a name is taken.
    Move { paths: Vec<String>, dir: String },
    /// `files.trash`.
    Trash { paths: Vec<String> },
    /// `files.restore`.
    Restore { items: Vec<String> },
}

/// What `files.cancel` asks: the job to stop.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct CancelAsk {
    pub job: String,
}

/// What `files.trash` asks: paths, each moved to the system's Trash. A
/// link goes there, not what it leads to.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct TrashAsk {
    pub paths: Vec<String>,
}

/// What `files.restore` and `files.delete` ask: items of the system's
/// Trash, by their ids, as `files.trashed` lists them.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct ItemsAsk {
    pub items: Vec<String>,
}

/// The system's Trash, as `files.trashed` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Trashcan {
    /// What it holds, the latest first; none where the system lets no app
    /// list it, as on macOS, whose Finder keeps it.
    pub items: Option<Vec<Trashed>>,
}

/// One item of the system's Trash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Trashed {
    /// The system's own name for it: on Linux, its `.trashinfo` file.
    pub id: String,
    pub name: String,
    /// The folder it came from, whole.
    pub from: String,
    /// When it was put there, in ms since the Unix epoch.
    #[ts(type = "number")]
    pub when: i64,
    pub folder: bool,
    /// Its size in bytes, for a file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub size: Option<u64>,
}

/// What `files.search` asks: words, or a pattern, in the files under a
/// folder.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct SearchAsk {
    /// The folder to look under; the Project's when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dir: Option<String>,
    pub query: String,
    /// The query is a regular expression, as ripgrep reads one.
    #[serde(default)]
    pub regex: bool,
    /// Its letters' case counts.
    #[serde(default)]
    pub case: bool,
    /// It matches whole words only.
    #[serde(default)]
    pub word: bool,
    /// The most matches in all: 2 000 unless said, 10 000 at most.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub limit: Option<u32>,
}

/// One piece of `files.search`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "files/")]
pub enum Searched {
    /// One file's matching lines, at most 100.
    File {
        /// From the folder, with `/` between names.
        path: String,
        lines: Vec<Matched>,
        /// It holds more than these.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(as = "Option<bool>", optional)]
        more: bool,
    },
    /// It ended: the files and lines found; `cut` once the most were.
    Done { files: u32, lines: u32, cut: bool },
}

/// A line that matches.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Matched {
    /// From 1.
    pub line: u32,
    /// The line, or about 300 characters of a long one around its first
    /// match, `…` where it is cut.
    pub text: String,
    /// Where it matches in `text`, as JavaScript counts a string's
    /// characters (UTF-16), the first and the one after the last.
    pub ranges: Vec<(u32, u32)>,
}

/// What `files.thumb` asks: a file, and how big its picture is drawn, its
/// longest side in px.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct ThumbAsk {
    pub path: String,
    /// 64, 128, 256 or 512: one between is made the next of them.
    pub size: u32,
}

/// A file's small picture, as `files.thumb` answers when it has one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Thumb {
    /// Its kind: `image/png`.
    pub mime: String,
    /// Its bytes, in base64.
    pub data: String,
    pub width: u32,
    pub height: u32,
}

/// What `files.info` asks: a path, as `files.list` reads its `dir`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct InfoAsk {
    pub path: String,
}

/// What a path is, at length, for Files' info (ADR 0073, step F6). A
/// link's facts are what it leads to, when it leads somewhere.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Info {
    /// Absolute: the path itself, a link not followed.
    pub path: String,
    /// The path itself: a link is a link.
    pub kind: Kind,
    /// Where a link leads, as it is written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub link: Option<String>,
    /// A link that leads nowhere.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub dangling: bool,
    /// Its kind of content, by its extension, else its first bytes; none
    /// for a folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mime: Option<String>,
    /// A file's size in bytes; a folder's is `files.size`'s to count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub size: Option<u64>,
    /// How many names a folder holds, its hidden ones too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub items: Option<u32>,
    /// When it was made, where the system keeps it; in ms since the Unix
    /// epoch, as the rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub created: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub modified: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub accessed: Option<i64>,
    /// Its permissions, as `chmod` writes them: `0o644`; none where the
    /// system has no such bits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mode: Option<u32>,
    /// Its owner and group, by name, or by number where none is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<String>,
    /// A picture's size in px, as it shows, turned as its EXIF says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub picture: Option<Picture>,
    /// What a camera wrote in a picture.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exif: Option<Exif>,
    /// The last commit that changed it, in a git repository.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commit: Option<Commit>,
}

/// A picture's size in px.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Picture {
    pub width: u32,
    pub height: u32,
}

/// What a camera wrote in a picture's EXIF, as words: each only when it
/// is there. Its place is text, never a map.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Exif {
    /// Its maker and model: `Fujifilm X-T4`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub camera: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lens: Option<String>,
    /// When it was taken, as the camera's clock said: `2026-05-04 18:30:12`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub taken: Option<String>,
    /// How it was exposed: `1/250 s · f/2.8 · ISO 400 · 35 mm`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exposure: Option<String>,
    /// Where: `48.85837° N, 2.29448° E`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub place: Option<String>,
}

/// A commit, as Files' info names the last one that changed a file.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Commit {
    pub hash: String,
    pub author: String,
    /// When it was written, in ms since the Unix epoch.
    #[ts(type = "number")]
    pub when: i64,
    pub subject: String,
}

/// What `files.size` asks: a folder whose size is counted.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct SizeAsk {
    pub path: String,
}

/// A piece of `files.size`: what it counted so far, and whether it is
/// done.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "files/")]
pub struct Counted {
    /// The bytes of the files under it, a link's own, not what it leads
    /// to.
    #[ts(type = "number")]
    pub bytes: u64,
    #[ts(type = "number")]
    pub files: u64,
    pub done: bool,
}
