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
