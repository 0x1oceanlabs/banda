//! A Space is any folder on this machine (ADR 0005, decision 6; ADR 0026):
//! the folder holds the work alone, and what Banda keeps for it lives in
//! the engine's data, in `spaces/<id>/`: `space.json`, which names the
//! folder, the SQLite, the lock, and the modules' files.

use crate::events::{self, Event, EventFilter};
use crate::module::Module;
use crate::outbox;
use crate::passes::Passes;
use crate::store::{Receipt, Store};
use crate::window::Window;
use crate::{
    AgentId, CommandId, Error, Participant, PersonId, Refusal, SpaceId, SpaceSummary, Tx, now_ms,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

pub(crate) const MANIFEST: &str = "space.json";
pub(crate) const LOCK: &str = "space.lock";
const DATABASE: &str = "space.sqlite3";
/// A Space's data while it is being written, before it is renamed into
/// place: the engine opens none of these, and clears them.
pub(crate) const UNFINISHED: &str = ".new";
/// A removed Space's data until it is deleted: the engine opens none of
/// these either, and clears them.
pub(crate) const GONE: &str = ".gone";

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Manifest {
    pub id: SpaceId,
    pub name: String,
    /// The Space's folder, absolute. Empty in a manifest from before
    /// ADR 0026, which sat in the folder itself.
    #[serde(default)]
    pub folder: PathBuf,
    pub author: Participant,
    /// The command that made it: the same command again gets this Space.
    pub command: CommandId,
    pub created_at: i64,
    /// Pinned Spaces come first in the Space pickers (ADR 0026).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// Hidden from the Space pickers; its Threads and files are kept.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub archived: bool,
    /// Its Agents see the other Spaces' Panes, as their Person let them
    /// (ADR 0032).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sees_others: bool,
}

impl Manifest {
    /// A new Space's manifest, for its folder `folder`.
    pub fn new(folder: &Path, name: &str, author: Participant, command: CommandId) -> Manifest {
        Manifest {
            id: SpaceId::new(),
            name: name.to_owned(),
            folder: folder.to_owned(),
            author,
            command,
            created_at: now_ms(),
            pinned: false,
            archived: false,
            sees_others: false,
        }
    }

    /// What the window lists of it; `missing` when its folder is gone.
    pub fn summary(&self, missing: bool) -> SpaceSummary {
        SpaceSummary {
            id: self.id,
            name: self.name.clone(),
            folder: self.folder.display().to_string(),
            pinned: self.pinned,
            archived: self.archived,
            sees_others: self.sees_others,
            missing,
        }
    }

    pub fn read(data: &Path) -> Result<Manifest, Error> {
        Ok(serde_json::from_slice(&std::fs::read(
            data.join(MANIFEST),
        )?)?)
    }

    /// Changes it with `change`, kept only once it is written to `data`.
    pub fn change_in(
        &mut self,
        data: &Path,
        change: impl FnOnce(&mut Manifest),
    ) -> Result<(), Error> {
        let mut changed = self.clone();
        change(&mut changed);
        changed.write(data)?;
        *self = changed;
        Ok(())
    }

    /// Writes it whole or not at all: beside, then renamed over the old.
    pub fn write(&self, data: &Path) -> Result<(), Error> {
        let aside = data.join(format!("{MANIFEST}{UNFINISHED}"));
        std::fs::write(&aside, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&aside, data.join(MANIFEST))?;
        Ok(())
    }
}

/// Puts a Space's data in place as `spaces/<id>/`, whole or not at all:
/// `fill` writes it into a folder aside, the manifest joins it, and that
/// folder is renamed into place. Answers where it is.
pub(crate) fn place(
    spaces: &Path,
    manifest: &Manifest,
    fill: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<PathBuf, Error> {
    let data = spaces.join(manifest.id.to_string());
    let unfinished = spaces.join(format!("{}{UNFINISHED}", manifest.id));
    let placed = (|| {
        if unfinished.exists() {
            std::fs::remove_dir_all(&unfinished)?;
        }
        std::fs::create_dir_all(&unfinished)?;
        fill(&unfinished)?;
        manifest.write(&unfinished)?;
        std::fs::rename(&unfinished, &data)?;
        Ok::<_, Error>(())
    })();
    if let Err(error) = placed {
        let _ = std::fs::remove_dir_all(&unfinished);
        return Err(error);
    }
    Ok(data)
}

pub struct Space {
    id: SpaceId,
    folder: PathBuf,
    /// `spaces/<id>/` in the engine's data.
    data: PathBuf,
    /// Its `space.json`, as the Person changes its name, pin and archive.
    /// Its ID and folder never change while it is open.
    manifest: std::sync::Mutex<Manifest>,
    /// Where its data went once it was removed: deleted as it closes.
    removed: std::sync::Mutex<Option<PathBuf>>,
    owner: PersonId,
    store: Store,
    modules: Arc<[Arc<dyn Module>]>,
    passes: Arc<Passes>,
    window: Arc<Window>,
    /// Held while the Space is open, so one engine at a time writes it.
    _lock: File,
}

impl Space {
    /// A Space's name, which the Person may change: it names no folder.
    pub(crate) fn name_of(name: &str) -> Result<&str, Refusal> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 64 || name.contains(char::is_control) {
            return Err(Refusal::invalid("A Space's name is 1 to 64 characters."));
        }
        Ok(name)
    }

    /// The name as a Space's folder takes it.
    pub(crate) fn plain_name(name: &str) -> Result<&str, Refusal> {
        crate::plain_name(name).ok_or_else(|| {
            Refusal::invalid(
                "A Space's name is 1 to 64 characters, with no slashes and no leading dot.",
            )
        })
    }

    /// Makes a Space's data in `spaces` for the folder `folder`, which
    /// exists. Answers where it is, and its manifest.
    pub(crate) fn create(
        spaces: &Path,
        folder: &Path,
        name: &str,
        author: Participant,
        command: CommandId,
    ) -> Result<(PathBuf, Manifest), Error> {
        let manifest = Manifest::new(folder, name, author, command);
        let data = place(spaces, &manifest, |_| Ok(()))?;
        Ok((data, manifest))
    }

    /// `data` is the Space's `spaces/<id>/`, and `manifest` the one there,
    /// which names the folder.
    pub(crate) async fn open(
        data: PathBuf,
        manifest: Manifest,
        owner: PersonId,
        modules: Arc<[Arc<dyn Module>]>,
        passes: Arc<Passes>,
        window: Arc<Window>,
        boot: &str,
    ) -> Result<Arc<Space>, Error> {
        let folder = manifest.folder.clone();
        if !folder.is_dir() {
            return Err(Refusal::not_found(format!(
                "The Space's folder {} is not there.",
                folder.display()
            ))
            .into());
        }
        let lock = locked(&data.join(LOCK))?;
        let ledgers: Vec<_> = modules.iter().map(|m| (m.name(), m.migrations())).collect();
        let path = data.join(DATABASE);
        let store = tokio::task::spawn_blocking(move || Store::open(&path, &ledgers))
            .await
            .map_err(|_| Error::Closed)??;
        let space = Arc::new(Space {
            id: manifest.id,
            folder,
            data,
            manifest: std::sync::Mutex::new(manifest),
            removed: Default::default(),
            owner,
            store,
            modules,
            passes,
            window,
            _lock: lock,
        });
        outbox::recover(&space, boot).await?;
        // Each module picks up its work before any effect runs, so what it
        // finds is what the last boot left.
        for module in space.modules.iter() {
            module.opened(space.module(module.name())).await?;
        }
        tokio::spawn(outbox::work(Arc::downgrade(&space), boot.to_owned()));
        Ok(space)
    }

    pub fn id(&self) -> SpaceId {
        self.id
    }

    pub fn folder(&self) -> &Path {
        &self.folder
    }

    /// What Banda keeps for this Space, outside its folder.
    pub fn data(&self) -> &Path {
        &self.data
    }

    /// The command that made it.
    pub(crate) fn command(&self) -> CommandId {
        self.manifest.lock().unwrap().command
    }

    /// Its data, now at `data`, is deleted once the last holder lets go
    /// of the Space: its turns and terminals have stopped.
    pub(crate) fn delete_when_closed(&self, data: PathBuf) {
        *self.removed.lock().unwrap() = Some(data);
    }

    pub fn owner(&self) -> PersonId {
        self.owner
    }

    /// Whether its Agents see the other Spaces' Panes (ADR 0032).
    pub fn sees_others(&self) -> bool {
        self.manifest.lock().unwrap().sees_others
    }

    pub fn summary(&self) -> SpaceSummary {
        self.manifest.lock().unwrap().summary(false)
    }

    /// Changes its `space.json` with `change`, and keeps it once written.
    pub(crate) fn change(&self, change: impl FnOnce(&mut Manifest)) -> Result<SpaceSummary, Error> {
        (self.manifest.lock().unwrap()).change_in(&self.data, change)?;
        Ok(self.summary())
    }

    /// Committed events from now on, in order.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Event>> {
        self.store.subscribe()
    }

    /// Stored events after `after` that match `filter`, at most `limit`.
    pub async fn events_after(
        &self,
        after: i64,
        filter: EventFilter,
        limit: usize,
    ) -> Result<Vec<Event>, Error> {
        self.store
            .read(move |sql| Ok(events::after(sql, after, &filter, limit)?))
            .await
    }

    /// This Space as one module sees it.
    pub(crate) fn module(self: &Arc<Self>, module: &'static str) -> ModuleSpace {
        ModuleSpace {
            space: self.clone(),
            module,
        }
    }

    pub(crate) fn store(&self) -> &Store {
        &self.store
    }

    pub(crate) fn modules(&self) -> &[Arc<dyn Module>] {
        &self.modules
    }
}

/// Takes the lock at `path`, which one engine at a time holds.
pub(crate) fn locked(path: &Path) -> Result<File, Error> {
    let lock = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)?;
    match lock.try_lock() {
        Ok(()) => Ok(lock),
        Err(TryLockError::WouldBlock) => {
            Err(Refusal::conflict("This Space is open in another Banda.").into())
        }
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

impl Drop for Space {
    fn drop(&mut self) {
        // Wake the worker so it sees the Space is gone and ends.
        self.store.outbox_signal().notify_one();
        if let Some(data) = self.removed.get_mut().unwrap().take() {
            let delete = move || {
                if let Err(error) = std::fs::remove_dir_all(&data) {
                    let data = data.display();
                    tracing::warn!(%data, %error, "a removed Space's data was not deleted");
                }
            };
            match tokio::runtime::Handle::try_current() {
                Ok(runtime) => drop(runtime.spawn_blocking(delete)),
                Err(_) => delete(),
            }
        }
    }
}

/// A Space as one module sees it: it writes under that module's name, so
/// it emits only that module's events.
#[derive(Clone)]
pub struct ModuleSpace {
    space: Arc<Space>,
    module: &'static str,
}

impl ModuleSpace {
    pub fn id(&self) -> SpaceId {
        self.space.id
    }

    /// The Space's work folder. A module of this machine gets the
    /// machine's state folder: no work of a Person's is there.
    pub fn folder(&self) -> &Path {
        &self.space.folder
    }

    /// Where this module may keep files of its own for the Space, outside
    /// its folder: `spaces/<id>/`, beside the Space's SQLite.
    pub fn data(&self) -> &Path {
        &self.space.data
    }

    pub fn owner(&self) -> PersonId {
        self.space.owner
    }

    /// The pass that names `agent` in this Space, for its session to reach
    /// the engine through `banda mcp` (ADR 0019, decision 2).
    pub fn pass(&self, agent: AgentId) -> Result<String, Error> {
        self.space.passes.issue(agent, self.space.id)
    }

    /// Asks the window `what`, under this module's name, for `by` in this
    /// Space (ADR 0029, decision 2).
    pub(crate) async fn ask_window(
        &self,
        by: Participant,
        what: &str,
        params: Value,
        within: Duration,
    ) -> Result<Value, Refusal> {
        let method = format!("{}.{what}", self.module);
        let window = &self.space.window;
        (window.ask(method, self.space.id, by, params, within)).await
    }

    /// One change in one transaction, outside any command: what a module
    /// writes as its effects run. Its events go out after commit.
    pub async fn write<T: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.space.store.write(self.module, change).await
    }

    /// A read on the Space's reader connection.
    pub async fn read<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.space.store.read(query).await
    }

    /// Reads a view together with the log position it is current at, in one
    /// read transaction. A window shows the view, then follows the events
    /// after that position (ADR 0002, decision 5).
    pub async fn view<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<(i64, T), Error> {
        self.space
            .store
            .read(|sql| {
                // Ends when dropped, even if the query panics.
                let snapshot = sql.unchecked_transaction()?;
                let at = events::head(&snapshot)?;
                Ok((at, query(&snapshot)?))
            })
            .await
    }

    /// The receipt of `command`, made by `author` for `method`.
    pub(crate) fn receipt(&self, command: CommandId, method: &str, author: Participant) -> Receipt {
        Receipt {
            command,
            module: self.module,
            method: method.to_owned(),
            author,
        }
    }

    pub(crate) async fn command(
        &self,
        command: CommandId,
        method: &str,
        author: Participant,
        change: impl FnOnce(&mut Tx<'_>) -> Result<Value, Error> + Send + 'static,
    ) -> Result<Value, Refusal> {
        let receipt = self.receipt(command, method, author);
        self.space.store.command(receipt, change).await
    }
}
