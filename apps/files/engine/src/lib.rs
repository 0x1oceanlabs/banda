//! The files module: any folder, as a Finder shows it (ADR 0073).
//!
//! The engine reads the disk and watches what is shown: one folder's
//! names (`list`), what some paths are (`stat`), a file's text (`read`),
//! fuzzy paths under a folder (`find`), and what changed in the folders a
//! Pane shows (`watch`). For the previewers it lists what an archive
//! holds (`archive`) and reads a workbook's sheet (`sheet`), and finds
//! words in files (`search`). It writes a file's text only over the text
//! it was read at (`write`), and makes, renames, moves, copies and sends
//! to the system's Trash what is at a path (`make`, `rename`, `move`,
//! `copy`, `trash`), each answering what undoes it; it lists the Trash,
//! puts back from it and deletes there for good (`trashed`, `restore`,
//! `delete`, `empty`). Nothing in `.git` nor in Banda's settings folder
//! is changed. It makes a file's small picture (`thumb`), says what a path
//! is at length (`info`) and counts what a folder holds (`size`). Each path goes through the kernel's path guard, [`Reach`]:
//! a relative one starts at the Project's folder, the Person may name any,
//! and an Agent's call reaches only inside the Project's folder.
//!
//! It also keeps what the Person opened (`opened`, `recent`), which Files
//! lists and `find` raises, and answers the Person's places (`places`).
//! What Files shows, its pinned places too, is `files.toml` (`settings`).

pub mod model;
pub mod settings;

mod archive;
mod find;
mod info;
mod list;
mod ops;
mod places;
mod read;
mod recent;
mod search;
mod sheet;
pub mod thumb;
mod trashcan;
mod write;

use banda_kernel::{
    Call, Changed, Code, Kind, Module, Nothing, Participant, Reach, Refusal, Right, Stream, host,
};
use model::{
    Archive, ArchiveAsk, CancelAsk, Counted, Done, FindAsk, Found, Info, InfoAsk, ItemsAsk, Job,
    ListAsk, Listing, Locked, MakeAsk, Making, MoveAsk, Opened, OpenedAsk, Places, ReadAsk,
    RecentAsk, RenameAsk, SearchAsk, Searched, Sheet, SheetAsk, SizeAsk, Stat, StatAsk, Step, Text,
    Thumb, ThumbAsk, TrashAsk, Trashcan, WatchAsk, Watched, WriteAsk, Written,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// The module's settings file in `~/.config/banda` (ADR 0016): what Files
/// shows, which the look resolves for the window (ADR 0073, decision 13).
pub const SETTINGS: [banda_look::SettingsFile; 1] =
    [banda_look::SettingsFile::of::<settings::FilesSettings>()];

/// The files `files.recent` answers unless asked otherwise, and the most.
const RECENT: u32 = 20;
const RECENT_MOST: u32 = 100;

/// How many files the engine remembers who wrote last.
const WROTE: usize = 256;

#[derive(Default)]
pub struct Files {
    walks: Arc<find::Walks>,
    /// Banda's settings folder, where Files writes nothing (ADR 0073,
    /// decision 8).
    config: Option<PathBuf>,
    /// Who wrote each file last through `files.write`, and its hash then,
    /// so a write refused can say who moved the file.
    wrote: Arc<Mutex<HashMap<PathBuf, (String, Participant)>>>,
    /// The moves and copies running that a caller named, each with what
    /// stops it.
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Where files' small pictures are kept, and how many are made at
    /// once.
    thumbs: Arc<thumb::Thumbs>,
}

impl Files {
    pub fn new() -> Self {
        Self::default()
    }

    /// Banda's settings live in `config`: Files reads them, and leaves
    /// writing them to the settings Pane (ADR 0016).
    pub fn config_in(self, config: PathBuf) -> Self {
        Self {
            config: Some(config),
            ..self
        }
    }

    /// Files' small pictures are kept in `cache`, Banda's, and read from
    /// and put in `shared`, freedesktop's, where there is one.
    pub fn thumbs_in(self, cache: PathBuf, shared: Option<PathBuf>) -> Self {
        Self {
            thumbs: Arc::new(thumb::Thumbs::new(Some(cache), shared)),
            ..self
        }
    }
}

banda_kernel::methods! {
    Files(Call) as "FilesMethods" in "files/" {
        /// One folder's names, folders first: each one's kind, size, time,
        /// whether git ignores it and whether it is hidden.
        call list(ListAsk) -> Listing, Read;
        /// What each path is, or none for one that is gone.
        call stat(StatAsk) -> Vec<Option<Stat>>, Read;
        /// A file's text, up to 1 MiB unless asked, or that it is binary,
        /// with its whole size, and, read whole, its hash; and why it may
        /// not be written, if so.
        call read(ReadAsk) -> Text, Read;
        /// Writes a file's text, only while the file is at `base`, the hash
        /// `files.read` gave, or, with none, is not there. When it moved,
        /// nothing is written, and the answer says its hash now. Never in
        /// `.git`, nor Banda's settings.
        command write(WriteAsk) -> Written, Write;
        /// Fuzzy paths of the files under a folder, the Project's unless
        /// asked, leaving out what `.gitignore` does.
        call find(FindAsk) -> Found, Read;
        /// What changed in some folders, from now on: first that they are
        /// watched, then each folder whose names changed.
        stream watch(WatchAsk) -> Watched, Read;
        /// The Person's home, and its Desktop and Downloads where the
        /// system names them and they are there.
        call places(Nothing) -> Places, Read;
        /// Says the Person opened a file, so Recent lists it and `find`
        /// raises it.
        command opened(OpenedAsk) -> (), Write;
        /// The files opened lately, the latest first, those still there.
        call recent(RecentAsk) -> Vec<Opened>, Read;
        /// The names a zip, a tar, a gzipped tar or a 7z holds, at most
        /// 10 000, each only as text: nothing is taken out.
        call archive(ArchiveAsk) -> Archive, Read;
        /// A workbook's sheet as rows of text, at most 10 000, with every
        /// sheet's name.
        call sheet(SheetAsk) -> Sheet, Read;
        /// Makes an empty file or folder by its name in a folder, never
        /// over one there; to undo, it goes to the Trash.
        command make(MakeAsk) -> Done, Write;
        /// Renames what is at a path, in its folder: never over another,
        /// but a name that only changes case on a disk that does not tell
        /// case apart.
        command rename(RenameAsk) -> Done, Write;
        /// Moves paths into a folder: within a disk a rename, else a copy
        /// that then removes the first. Where a name is taken it asks
        /// first, or replaces (what was there goes to the Trash), keeps
        /// both (`name 2.ext`) or skips, as asked. It says how far a copy
        /// is, stops when `files.cancel` or the caller lets go, and ends
        /// saying what it did and what undoes it.
        stream r#move(MoveAsk) -> Job, Write;
        /// Copies paths into a folder, as `move` moves them: a folder with
        /// all it holds, a link as a link; into its own folder, beside
        /// itself.
        stream copy(MoveAsk) -> Job, Write;
        /// Stops a move or a copy that named its job: what it left half
        /// done is removed, and it says what it did.
        command cancel(CancelAsk) -> (), Write;
        /// Sends paths to the system's Trash, and answers how to put them
        /// back, where the system lets an app (not on macOS).
        command trash(TrashAsk) -> Done, Write;
        /// What the system's Trash holds, the latest first, with where
        /// each came from; an Agent's call, what came from its Project.
        /// None on macOS, whose Finder keeps it.
        call trashed(Nothing) -> Trashcan, Read;
        /// Puts items of the Trash back where they came from.
        command restore(ItemsAsk) -> Done, Write;
        /// Deletes items of the Trash for good: only there.
        command delete(ItemsAsk) -> u32, Write;
        /// Deletes all the Trash holds for good; an Agent's call, what came
        /// from its Project.
        command empty(Nothing) -> u32, Write;
        /// Finds words, or a pattern, in the files under a folder, the
        /// Project's unless asked, leaving out what `.gitignore` does and
        /// binary files: each file's lines as they are found, at most 100
        /// a file, until the most lines asked; then how many.
        stream search(SearchAsk) -> Searched, Read;
        /// A file's small picture, its longest side the size asked or the
        /// next made: freedesktop's where the desktop made one, else made
        /// from a picture `image` reads; none for anything else.
        call thumb(ThumbAsk) -> Option<Thumb>, Read;
        /// What a path is at length: its kind, type, size, times,
        /// permissions and owner, where a link leads, a picture's size and
        /// EXIF, and the last commit that changed it.
        call info(InfoAsk) -> Info, Read;
        /// What a folder holds, counted: how far it is as it goes, then
        /// that it is done. Letting go of the stream stops it.
        stream size(SizeAsk) -> Counted, Read;
    }
}

#[async_trait::async_trait]
impl Module for Files {
    fn name(&self) -> &'static str {
        "files"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[recent::MIGRATION]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}

/// Now, in ms since the Unix epoch.
fn now() -> i64 {
    ms(std::time::SystemTime::now()).unwrap_or(i64::MAX)
}

/// A time in ms since the Unix epoch; none before it.
pub(crate) fn ms(time: std::time::SystemTime) -> Option<i64> {
    let since = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}

/// git running `args` in `dir` as Files runs it: Banda's own
/// (`banda_git_cli`), its stderr unheard; none when it cannot start. Its
/// stdin and its stdout are the caller's.
pub(crate) async fn git_in<I, S>(dir: &Path, args: I) -> Option<tokio::process::Command>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut git = banda_git_cli::bookkeeping(dir, args).await.ok()?;
    git.stderr(std::process::Stdio::null());
    Some(git)
}

/// A path as a caller reads it.
pub(crate) fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// A refusal for a failure of the disk that may pass, as a full disk or a
/// busy file: a command's receipt does not keep it, so a resend may go
/// through (ADR 0082, decision 4).
fn failed(message: String) -> Refusal {
    Refusal::new(Code::Internal, message)
}

/// A refusal for what the disk said about `asked`.
fn amiss(asked: &str, error: &std::io::Error) -> Refusal {
    use std::io::ErrorKind::*;
    match error.kind() {
        NotFound => Refusal::not_found(format!("{asked} is not there.")),
        NotADirectory => Refusal::invalid(format!("{asked} is not a folder.")),
        IsADirectory => Refusal::invalid(format!("{asked} is a folder.")),
        PermissionDenied => Refusal::forbidden(format!("{asked} may not be read.")),
        _ => failed(format!("{asked} could not be read: {error}.")),
    }
}

/// A refusal for why what is at `asked` was not changed.
fn unchanged(asked: &str, error: &std::io::Error) -> Refusal {
    use std::io::ErrorKind::*;
    if let Some(why) = windows_refused(asked, error) {
        return why;
    }
    match error.kind() {
        AlreadyExists | DirectoryNotEmpty => {
            Refusal::conflict(format!("{asked} is already there."))
        }
        PermissionDenied | ReadOnlyFilesystem => {
            Refusal::forbidden(format!("{asked} may not be changed."))
        }
        NotFound | NotADirectory | IsADirectory => amiss(asked, error),
        _ => failed(format!("{asked} could not be changed: {error}.")),
    }
}

/// Why Windows refused to change what is at `asked`, where Unix would
/// not have, in plain words (ADR 0090, decision 3): a link, which Windows
/// makes only in Developer Mode or for an admin
/// (`ERROR_PRIVILEGE_NOT_HELD`); a file another program has open
/// (`ERROR_SHARING_VIOLATION`, `ERROR_LOCK_VIOLATION`); a folder a program
/// works in, which Windows will not move nor remove.
fn windows_refused(asked: &str, error: &std::io::Error) -> Option<Refusal> {
    let why = match error.raw_os_error().filter(|_| cfg!(windows))? {
        1314 => format!(
            "Windows makes a link such as {asked} only in Developer Mode, or for an \
             administrator: turn Developer Mode on in Windows' settings, then try again."
        ),
        32 | 33 => format!(
            "Another program has {asked} open, and Windows will not change it until that \
             program lets it go."
        ),
        _ => return None,
    };
    Some(Refusal::conflict(why))
}

/// What is at `asked` itself, not where its link leads: its folder goes
/// through the guard, then its name. On Windows a name it refuses is
/// refused here too, as `.git.` opens `.git`; and an entry there is named
/// as the system names it, as `GIT~1`, a short name, is `.git`, so the
/// fence sees what the name opens.
fn entry(call: &Call, asked: &str) -> Result<PathBuf, Refusal> {
    let path = Path::new(asked);
    let (Some(name), Some(folder)) = (path.file_name(), path.parent()) else {
        return Err(Refusal::invalid(format!(
            "{asked} names no file nor folder."
        )));
    };
    if let Some(why) = host::refused_name(&name.to_string_lossy()) {
        return Err(Refusal::invalid(format!("{asked}: {why}")));
    }
    Ok(long_named(Reach::of(call, folder)?.into_path().join(name)))
}

/// `path`, when it is there and no link, with the name Windows keeps for
/// it, not a short one it was asked by; as it is elsewhere.
fn long_named(path: PathBuf) -> PathBuf {
    let plain = |path: &Path| std::fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_symlink());
    if !cfg!(windows) || !plain(&path) {
        return path;
    }
    match dunce::canonicalize(&path)
        .ok()
        .as_deref()
        .and_then(Path::file_name)
    {
        Some(name) => path.with_file_name(name),
        None => path,
    }
}

/// Whether a path is one `call` may take from the Trash or put there:
/// any, or one in the Project's folder for an Agent.
fn reached(call: &Call) -> impl Fn(&Path) -> bool + Send + 'static {
    let walled = call.wall().map(|_| {
        let folder = call.project().folder();
        dunce::canonicalize(&folder).unwrap_or(folder)
    });
    move |path: &Path| {
        walled
            .as_ref()
            .is_none_or(|folder| host::within(path, folder))
    }
}

/// A refusal for why `asked` was not written.
fn unwritten(asked: &str, why: write::Unwritten) -> Refusal {
    use write::Unwritten;
    match why {
        Unwritten::Locked(Locked::Git) => Refusal::forbidden(format!(
            "{asked} is in .git, which is git's own: Files writes nothing there."
        )),
        Unwritten::Locked(Locked::Settings) => Refusal::forbidden(format!(
            "{asked} is one of Banda's settings, which Settings changes."
        )),
        Unwritten::Locked(Locked::Denied) => {
            Refusal::forbidden(format!("{asked} may not be written."))
        }
        Unwritten::Link => Refusal::forbidden(format!(
            "{asked} is a link that leads nowhere: Files writes no file through it."
        )),
        Unwritten::NoFolder => {
            Refusal::not_found(format!("The folder {asked} goes in is not there."))
        }
        Unwritten::Io(error) if error.kind() == std::io::ErrorKind::IsADirectory => {
            Refusal::invalid(format!("{asked} is a folder."))
        }
        Unwritten::Io(error) => failed(format!("{asked} could not be written: {error}.")),
    }
}

/// Runs a read of the disk off the engine's threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Refusal> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| Refusal::internal())
}

impl Files {
    /// Refuses `path`, as `asked`, when it is in `.git` or in Banda's
    /// settings; and, where it would go, when it holds the settings.
    fn fence(&self, path: &Path, asked: &str, goes: bool) -> Result<(), Refusal> {
        let config = self.config.as_deref();
        if let Some(why) = write::fenced(path, config) {
            return Err(unwritten(asked, write::Unwritten::Locked(why)));
        }
        let holds = |config: &Path| {
            host::within(config, path)
                || dunce::canonicalize(config).is_ok_and(|real| host::within(&real, path))
        };
        if goes && config.is_some_and(holds) {
            return Err(Refusal::forbidden(format!(
                "{asked} holds Banda's settings, which stay where they are."
            )));
        }
        Ok(())
    }

    async fn list(&self, call: Call, ask: ListAsk) -> Result<Listing, Refusal> {
        let reach = Reach::of(&call, &ask.dir)?;
        let dir = reach.path().to_path_buf();
        let read = blocking({
            let dir = dir.clone();
            move || list::read(&dir)
        });
        let mut entries = read.await?.map_err(|e| amiss(&ask.dir, &e))?;
        list::mark_ignored(&dir, &mut entries).await;
        list::sort(&mut entries);
        Ok(Listing {
            dir: shown(&dir),
            inside: reach.inside(),
            entries,
        })
    }

    async fn stat(&self, call: Call, ask: StatAsk) -> Result<Vec<Option<Stat>>, Refusal> {
        let paths = (ask.paths.iter())
            .map(|path| Reach::of(&call, path).map(Reach::into_path))
            .collect::<Result<Vec<PathBuf>, Refusal>>()?;
        blocking(move || paths.iter().map(|path| read::stat(path)).collect()).await
    }

    async fn read(&self, call: Call, ask: ReadAsk) -> Result<Text, Refusal> {
        let path = Reach::of(&call, &ask.path)?.into_path();
        let upto = ask.upto.unwrap_or(read::UPTO);
        let config = self.config.clone();
        let text = blocking(move || {
            let mut text = read::read(&path, upto)?;
            text.locked = write::locked(&path, config.as_deref());
            Ok(text)
        });
        text.await?.map_err(|e| amiss(&ask.path, &e))
    }

    async fn write(&self, call: Call, ask: WriteAsk) -> Result<Written, Refusal> {
        let path = Reach::of(&call, &ask.path)?.into_path();
        let config = self.config.clone();
        let saved = blocking({
            let path = path.clone();
            move || write::write(&path, &ask.text, ask.base.as_deref(), config.as_deref())
        });
        let saved = saved.await?.map_err(|why| unwritten(&ask.path, why))?;
        let mut wrote = self.wrote.lock().unwrap();
        Ok(match saved {
            write::Saved::Holds { hash, wrote: true } => {
                if wrote.len() >= WROTE {
                    wrote.clear();
                }
                wrote.insert(path, (hash.clone(), call.participant()));
                Written::Written { hash }
            }
            write::Saved::Holds { hash, wrote: false } => Written::Written { hash },
            write::Saved::Moved { hash } => {
                let by = (wrote.get(&path))
                    .filter(|(was, _)| hash.as_ref() == Some(was))
                    .map(|(_, by)| *by);
                Written::Moved { hash, by }
            }
        })
    }

    async fn find(&self, call: Call, ask: FindAsk) -> Result<Found, Refusal> {
        let asked = ask.dir.unwrap_or_default();
        let dir = Reach::of(&call, &asked)?.into_path();
        if !dir.is_dir() {
            let shown = if asked.is_empty() {
                "The Project's folder"
            } else {
                &asked
            };
            return Err(Refusal::not_found(format!(
                "{shown} is not a folder there."
            )));
        }
        let limit = ask.limit.unwrap_or(find::LIMIT).clamp(1, find::MOST) as usize;
        let opened = (call.project())
            .read(|sql| recent::latest(sql, None))
            .await?;
        let raised = recent::raised(&opened, &dir, now());
        let walks = self.walks.clone();
        let query = ask.query;
        blocking(move || {
            let walked = walks.of(&dir);
            Found {
                dir: shown(&dir),
                paths: find::matching(&walked, &query, limit, &raised),
                cut: walked.cut,
            }
        })
        .await
    }

    async fn places(&self, _call: Call, _: Nothing) -> Result<Places, Refusal> {
        let places = blocking(places::here).await?;
        places.ok_or_else(|| Refusal::not_found("This user has no home folder."))
    }

    async fn opened(&self, call: Call, ask: OpenedAsk) -> Result<(), Refusal> {
        let path = shown(Reach::of(&call, &ask.path)?.path());
        call.command(move |tx| recent::open(tx.sql(), &path, tx.now()))
            .await
    }

    async fn recent(&self, call: Call, ask: RecentAsk) -> Result<Vec<Opened>, Refusal> {
        let limit = ask.limit.unwrap_or(RECENT).clamp(1, RECENT_MOST) as usize;
        let opened = (call.project())
            .read(|sql| recent::latest(sql, None))
            .await?;
        // Those gone since are left out, not forgotten: one may come back.
        blocking(move || {
            (opened.into_iter())
                .filter(|file| Path::new(&file.path).exists())
                .take(limit)
                .collect()
        })
        .await
    }

    async fn archive(&self, call: Call, ask: ArchiveAsk) -> Result<Archive, Refusal> {
        let path = Reach::of(&call, &ask.path)?.into_path();
        match blocking(move || archive::read(&path)).await? {
            Ok(archive) => Ok(archive),
            Err(archive::Unread::Io(error)) => Err(amiss(&ask.path, &error)),
            Err(archive::Unread::Bad(why)) => Err(Refusal::invalid(format!(
                "{} is no archive Files can list: {why}.",
                ask.path
            ))),
        }
    }

    async fn sheet(&self, call: Call, ask: SheetAsk) -> Result<Sheet, Refusal> {
        let path = Reach::of(&call, &ask.path)?.into_path();
        let named = ask.sheet.clone();
        let read = blocking(move || sheet::read(&path, named.as_deref())).await?;
        read.map_err(|why| {
            Refusal::invalid(format!("{} cannot be read as a workbook: {why}.", ask.path))
        })
    }

    async fn watch(&self, call: Call, ask: WatchAsk) -> Result<Stream, Refusal> {
        // Each folder as the system names it, and as it was asked.
        let mut asked: HashMap<PathBuf, Vec<String>> = HashMap::new();
        for dir in ask.dirs {
            let path = Reach::of(&call, &dir)?.into_path();
            asked.entry(path).or_default().push(dir);
        }
        let paths: Vec<PathBuf> = asked.keys().cloned().collect();
        let named = move |dirs: &[PathBuf]| -> Vec<String> {
            let mut names: Vec<String> = (dirs.iter())
                .filter_map(|dir| asked.get(dir))
                .flatten()
                .cloned()
                .collect();
            names.sort();
            names
        };
        let mut watch = (call.project())
            .watch(paths)
            .map_err(|e| Refusal::conflict(format!("Folders cannot be watched here: {e}.")))?;
        let (say, heard) = tokio::sync::mpsc::channel(16);
        let watched = named(watch.watched());
        let limited = named(watch.limited());
        tokio::spawn(async move {
            if !send(&say, &Watched::Watching { dirs: watched }).await
                || (!limited.is_empty() && !send(&say, &Watched::Limit { dirs: limited }).await)
            {
                return;
            }
            loop {
                let changed = tokio::select! {
                    changed = watch.next() => changed,
                    () = say.closed() => return,
                };
                let piece = match changed {
                    None => return,
                    Some(Changed::Dirs(dirs)) => Watched::Changed { dirs: named(&dirs) },
                    Some(Changed::Again(dirs)) => Watched::Rescan { dirs: named(&dirs) },
                };
                if !send(&say, &piece).await {
                    return;
                }
            }
        });
        Ok(heard)
    }
}

impl Files {
    async fn make(&self, call: Call, ask: MakeAsk) -> Result<Done, Refusal> {
        if let Some(why) = ops::misnamed(&ask.name) {
            return Err(Refusal::invalid(why));
        }
        let path = Reach::of(&call, &ask.dir)?.into_path().join(&ask.name);
        let named = shown(&path);
        self.fence(&path, &named, false)?;
        let folder = ask.kind == Making::Folder;
        let made = blocking({
            let path = path.clone();
            move || ops::make(&path, folder)
        });
        made.await?.map_err(|e| unchanged(&named, &e))?;
        Ok(Done {
            paths: vec![named.clone()],
            undo: vec![Step::Trash { paths: vec![named] }],
            ..Done::default()
        })
    }

    async fn rename(&self, call: Call, ask: RenameAsk) -> Result<Done, Refusal> {
        if let Some(why) = ops::misnamed(&ask.name) {
            return Err(Refusal::invalid(why));
        }
        let from = entry(&call, &ask.path)?;
        let to = from.with_file_name(&ask.name);
        self.fence(&from, &ask.path, true)?;
        self.fence(&to, &ask.name, false)?;
        let was = (from.file_name())
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let renamed = blocking({
            let (from, to) = (from.clone(), to.clone());
            move || {
                if !ops::there(&from) {
                    return Err(std::io::ErrorKind::NotFound.into());
                }
                if from == to {
                    Ok(())
                } else if ops::same_but_case(&from, &to) {
                    std::fs::rename(&from, &to)
                } else {
                    ops::rename_new(&from, &to)
                }
            }
        });
        renamed.await?.map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => unchanged(&ask.name, &e),
            _ => unchanged(&ask.path, &e),
        })?;
        let now = shown(&to);
        let undo = if from == to {
            Vec::new()
        } else {
            vec![Step::Rename {
                path: now.clone(),
                name: was,
            }]
        };
        Ok(Done {
            paths: vec![now],
            undo,
            ..Done::default()
        })
    }

    async fn r#move(&self, call: Call, ask: MoveAsk) -> Result<Stream, Refusal> {
        self.job(call, ask, false).await
    }

    async fn copy(&self, call: Call, ask: MoveAsk) -> Result<Stream, Refusal> {
        self.job(call, ask, true).await
    }

    /// A move or a copy: checked and planned before it is heard, then run
    /// off the engine's threads, saying how far it is.
    async fn job(&self, call: Call, ask: MoveAsk, copy: bool) -> Result<Stream, Refusal> {
        let dir = Reach::of(&call, &ask.dir)?.into_path();
        self.fence(&dir, &ask.dir, false)?;
        let mut sources = Vec::new();
        for asked in &ask.paths {
            let from = entry(&call, asked)?;
            // What a copy takes is only read.
            if !copy {
                self.fence(&from, asked, true)?;
            }
            sources.push((asked.clone(), from));
        }
        let planned = blocking({
            let (dir, asked_dir) = (dir.clone(), ask.dir.clone());
            let (clash, answers) = (ask.clash, ask.answers.clone());
            move || -> Result<_, Refusal> {
                if !dir.is_dir() {
                    return Err(Refusal::not_found(format!(
                        "{asked_dir} is not a folder there."
                    )));
                }
                for (asked, from) in &sources {
                    if !ops::there(from) {
                        return Err(Refusal::not_found(format!("{asked} is not there.")));
                    }
                    if !from.is_symlink() && from.is_dir() && host::within(&dir, from) {
                        return Err(Refusal::invalid(format!("{asked} cannot go into itself.")));
                    }
                }
                Ok(ops::plan(&sources, &dir, copy, clash, &answers))
            }
        });
        let planned = planned.await??;
        let (say, heard) = tokio::sync::mpsc::channel(16);
        let plan = match planned {
            Ok(plan) => plan,
            Err(clashes) => {
                let _ = send(&say, &Job::Clashes { clashes }).await;
                return Ok(heard);
            }
        };
        let stop = Arc::new(AtomicBool::new(false));
        let jobs = self.jobs.clone();
        if let Some(job) = &ask.job {
            (jobs.lock().unwrap()).insert(job.clone(), stop.clone());
        }
        let job = ask.job;
        tokio::task::spawn_blocking(move || {
            let mut tell = |piece: Job| {
                if let Ok(piece) = serde_json::to_value(piece) {
                    let _ = say.blocking_send(piece);
                }
            };
            let stopped = || stop.load(Ordering::Relaxed) || say.is_closed();
            let mut run = ops::Run {
                stop: &stopped,
                tell: &mut tell,
            };
            let done = ops::run(plan, copy, &mut run);
            if let Some(job) = job {
                jobs.lock().unwrap().remove(&job);
            }
            tell(Job::Done(done));
        });
        Ok(heard)
    }

    async fn cancel(&self, _call: Call, ask: CancelAsk) -> Result<(), Refusal> {
        if let Some(stop) = self.jobs.lock().unwrap().get(&ask.job) {
            stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    async fn trash(&self, call: Call, ask: TrashAsk) -> Result<Done, Refusal> {
        let mut paths = Vec::new();
        for asked in &ask.paths {
            let path = entry(&call, asked)?;
            self.fence(&path, asked, true)?;
            paths.push(path);
        }
        let put = blocking(move || {
            if let Some(gone) = paths.iter().find(|path| !ops::there(path)) {
                return Err(Refusal::not_found(format!("{} is not there.", shown(gone))));
            }
            let since = trashcan::now();
            let put = trashcan::put(&paths);
            Ok((trashcan::ids(&paths[..put.went], since), put))
        });
        let (ids, put) = put.await??;
        if put.went == 0
            && let Some(why) = put.failed
        {
            return Err(Refusal::conflict(why));
        }
        let undo = if ids.is_empty() {
            Vec::new()
        } else {
            vec![Step::Restore { items: ids }]
        };
        Ok(Done {
            undo,
            failed: put.failed,
            ..Done::default()
        })
    }

    async fn trashed(&self, call: Call, _: Nothing) -> Result<Trashcan, Refusal> {
        let reached = reached(&call);
        let items = blocking(move || trashcan::list(reached)).await?;
        let items =
            items.map_err(|why| Refusal::conflict(format!("The Trash cannot be read: {why}")))?;
        Ok(Trashcan { items })
    }

    async fn restore(&self, call: Call, ask: ItemsAsk) -> Result<Done, Refusal> {
        let reached = reached(&call);
        let back = blocking(move || trashcan::restore(&ask.items, reached)).await?;
        let back: Vec<String> = back
            .map_err(Refusal::conflict)?
            .iter()
            .map(|path| shown(path))
            .collect();
        Ok(Done {
            undo: vec![Step::Trash {
                paths: back.clone(),
            }],
            paths: back,
            ..Done::default()
        })
    }

    async fn delete(&self, call: Call, ask: ItemsAsk) -> Result<u32, Refusal> {
        let reached = reached(&call);
        let gone = blocking(move || trashcan::purge(Some(&ask.items), reached)).await?;
        Ok(u32::try_from(gone.map_err(Refusal::conflict)?).unwrap_or(u32::MAX))
    }

    async fn empty(&self, call: Call, _: Nothing) -> Result<u32, Refusal> {
        let reached = reached(&call);
        let gone = blocking(move || trashcan::purge(None, reached)).await?;
        Ok(u32::try_from(gone.map_err(Refusal::conflict)?).unwrap_or(u32::MAX))
    }

    async fn search(&self, call: Call, ask: SearchAsk) -> Result<Stream, Refusal> {
        let asked = ask.dir.clone().unwrap_or_default();
        let dir = Reach::of(&call, &asked)?.into_path();
        if !dir.is_dir() {
            return Err(Refusal::not_found(format!(
                "{asked} is not a folder there."
            )));
        }
        if ask.query.is_empty() {
            return Err(Refusal::invalid("Search for what?"));
        }
        let matcher = search::matcher(&ask)
            .map_err(|why| Refusal::invalid(format!("The pattern does not read: {why}")))?;
        let limit = ask.limit.unwrap_or(search::LIMIT).clamp(1, search::MOST) as usize;
        let (say, heard) = tokio::sync::mpsc::channel(16);
        tokio::task::spawn_blocking(move || {
            search::search(&dir, &matcher, limit, &mut |piece: Searched| {
                serde_json::to_value(piece).is_ok_and(|piece| say.blocking_send(piece).is_ok())
            });
        });
        Ok(heard)
    }
}

impl Files {
    async fn thumb(&self, call: Call, ask: ThumbAsk) -> Result<Option<Thumb>, Refusal> {
        let path = Reach::of(&call, &ask.path)?.into_path();
        let size = thumb::made_at(ask.size);
        let thumbs = self.thumbs.clone();
        let looked = blocking({
            let thumbs = thumbs.clone();
            move || thumbs.look(&path, size)
        });
        let file = match looked.await? {
            thumb::Looked::Done(png) => return Ok(png.map(thumb::Png::answer)),
            thumb::Looked::Make(file) => file,
        };
        let _turn = (thumbs.decoding.acquire().await).map_err(|_| Refusal::internal())?;
        let made = blocking({
            let thumbs = thumbs.clone();
            move || thumbs.make(&file, size)
        });
        Ok(made.await?.map(thumb::Png::answer))
    }

    async fn info(&self, call: Call, ask: InfoAsk) -> Result<Info, Refusal> {
        let own = entry(&call, &ask.path)?;
        let real = Reach::of(&call, &ask.path)?.into_path();
        let facts = blocking({
            let (own, real) = (own.clone(), real.clone());
            move || info::facts(&own, &real)
        });
        // The disk's facts and git's last commit, side by side.
        let (facts, commit) = tokio::join!(facts, info::last_commit(&real));
        let mut info = facts?.map_err(|e| amiss(&ask.path, &e))?;
        info.commit = commit.filter(|_| !info.dangling);
        Ok(info)
    }

    async fn size(&self, call: Call, ask: SizeAsk) -> Result<Stream, Refusal> {
        let dir = Reach::of(&call, &ask.path)?.into_path();
        if !dir.is_dir() {
            return Err(Refusal::invalid(format!("{} is not a folder.", ask.path)));
        }
        let (say, heard) = tokio::sync::mpsc::channel(4);
        tokio::task::spawn_blocking(move || {
            info::count(&dir, &mut |counted| {
                serde_json::to_value(counted).is_ok_and(|piece| say.blocking_send(piece).is_ok())
            });
        });
        Ok(heard)
    }
}

/// Says `piece`; false once no one hears.
async fn send(say: &tokio::sync::mpsc::Sender<Value>, piece: &impl serde::Serialize) -> bool {
    match serde_json::to_value(piece) {
        Ok(piece) => say.send(piece).await.is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind::*};

    #[test]
    fn a_disk_failure_that_may_pass_is_not_kept_on_a_receipt() {
        for kind in [StorageFull, ResourceBusy, Interrupted, TimedOut, Other] {
            let passing = [
                amiss("a.txt", &Error::from(kind)),
                unchanged("a.txt", &Error::from(kind)),
                unwritten("a.txt", write::Unwritten::Io(Error::from(kind))),
            ];
            for refusal in passing {
                assert!(!refusal.code.is_final(), "{kind:?}: {refusal:?}");
            }
        }
        for kind in [NotFound, AlreadyExists, PermissionDenied] {
            let refusal = unchanged("a.txt", &Error::from(kind));
            assert!(refusal.code.is_final(), "{kind:?}: {refusal:?}");
        }
    }
}
