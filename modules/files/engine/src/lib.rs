//! The files module: any folder, as a Finder shows it (ADR 0073).
//!
//! The engine reads the disk and watches what is shown: one folder's
//! names (`list`), what some paths are (`stat`), a file's text (`read`),
//! fuzzy paths under a folder (`find`), and what changed in the folders a
//! Pane shows (`watch`). Each path goes through the kernel's path guard,
//! [`Reach`]: a relative one starts at the Project's folder, the Person
//! may name any, and an Agent's call reaches only inside the Project's
//! folder. These only read; writing comes later (decisions 8 and 10).

pub mod model;

mod find;
mod list;
mod read;

use banda_kernel::{Call, Changed, Module, Reach, Refusal, Right, Stream};
use model::{FindAsk, Found, ListAsk, Listing, ReadAsk, Stat, StatAsk, Text, WatchAsk, Watched};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Default)]
pub struct Files {
    walks: Arc<find::Walks>,
}

impl Files {
    pub fn new() -> Self {
        Self::default()
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
        /// with its whole size and, read whole, its hash.
        call read(ReadAsk) -> Text, Read;
        /// Fuzzy paths of the files under a folder, the Project's unless
        /// asked, leaving out what `.gitignore` does.
        call find(FindAsk) -> Found, Read;
        /// What changed in some folders, from now on: first that they are
        /// watched, then each folder whose names changed.
        stream watch(WatchAsk) -> Watched, Read;
    }
}

#[async_trait::async_trait]
impl Module for Files {
    fn name(&self) -> &'static str {
        "files"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
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

/// A path as a caller reads it.
fn shown(path: &Path) -> String {
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
        let text = blocking(move || read::read(&path, upto)).await?;
        text.map_err(|e| amiss(&ask.path, &e))
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
        let walks = self.walks.clone();
        let query = ask.query;
        blocking(move || {
            let walked = walks.of(&dir);
            Found {
                dir: shown(&dir),
                paths: find::matching(&walked, &query, limit),
                cut: walked.cut,
            }
        })
        .await
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
            let mut first = vec![Watched::Watching { dirs: watched }];
            if !limited.is_empty() {
                first.push(Watched::Limit { dirs: limited });
            }
            for piece in first {
                if !send(&say, &piece).await {
                    return;
                }
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
