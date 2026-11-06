//! The files module: any folder, as a Finder shows it (ADR 0073).
//!
//! The engine reads the disk and watches what is shown: one folder's
//! names (`list`), what some paths are (`stat`), a file's text (`read`),
//! fuzzy paths under a folder (`find`), and what changed in the folders a
//! Pane shows (`watch`). For the previewers it lists what an archive
//! holds (`archive`) and reads a workbook's sheet (`sheet`). It writes a
//! file's text only over the text it was read at (`write`), never in
//! `.git` nor in Banda's settings folder. Each path goes through the
//! kernel's path guard, [`Reach`]: a relative one starts at the Project's
//! folder, the Person may name any, and an Agent's call reaches only
//! inside the Project's folder.
//!
//! It also keeps what the Person opened (`opened`, `recent`), which Files
//! lists and `find` raises, and answers the Person's places (`places`).
//! What Files shows, its pinned places too, is `files.toml` (`settings`).

pub mod model;
pub mod settings;

mod archive;
mod find;
mod list;
mod places;
mod read;
mod recent;
mod sheet;
mod write;

use banda_kernel::{Call, Changed, Module, Nothing, Participant, Reach, Refusal, Right, Stream};
use model::{
    Archive, ArchiveAsk, FindAsk, Found, ListAsk, Listing, Locked, Opened, OpenedAsk, Places,
    ReadAsk, RecentAsk, Sheet, SheetAsk, Stat, StatAsk, Text, WatchAsk, Watched, WriteAsk, Written,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}

/// Now, in ms since the Unix epoch.
fn now() -> i64 {
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
    since.map_or(0, |since| {
        i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
    })
}

/// A path as a caller reads it.
pub(crate) fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// A refusal for what the disk said about `asked`.
fn amiss(asked: &str, error: &std::io::Error) -> Refusal {
    use std::io::ErrorKind::*;
    match error.kind() {
        NotFound => Refusal::not_found(format!("{asked} is not there.")),
        NotADirectory => Refusal::invalid(format!("{asked} is not a folder.")),
        IsADirectory => Refusal::invalid(format!("{asked} is a folder.")),
        PermissionDenied => Refusal::forbidden(format!("{asked} may not be read.")),
        _ => Refusal::conflict(format!("{asked} could not be read: {error}.")),
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
        Unwritten::Io(error) => {
            Refusal::conflict(format!("{asked} could not be written: {error}."))
        }
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

/// Says `piece`; false once no one hears.
async fn send(say: &tokio::sync::mpsc::Sender<Value>, piece: &Watched) -> bool {
    match serde_json::to_value(piece) {
        Ok(piece) => say.send(piece).await.is_ok(),
        Err(_) => false,
    }
}
