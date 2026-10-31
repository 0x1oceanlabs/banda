//! A Space is a folder you can see (ADR 0001, decision 5): the work's files,
//! plus `.bandaso/` with the Space's SQLite. Copying the folder moves the
//! Space.

use crate::events::{self, Event, EventFilter};
use crate::module::Module;
use crate::outbox;
use crate::store::{Receipt, Store};
use crate::{CommandId, Error, Participant, PersonId, Refusal, SpaceId, SpaceSummary, Tx, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

/// The folder inside a Space that Bandaso keeps for itself.
pub(crate) const DATA: &str = ".bandaso";
const MANIFEST: &str = "space.json";
const DATABASE: &str = "space.sqlite3";
const LOCK: &str = "space.lock";

#[derive(Serialize, Deserialize)]
struct Manifest {
    id: SpaceId,
    name: String,
    author: Participant,
    /// The command that made it: the same command again gets this Space.
    command: CommandId,
    created_at: i64,
}

impl Manifest {
    fn read(folder: &Path) -> Result<Manifest, Error> {
        Ok(serde_json::from_slice(&std::fs::read(
            folder.join(DATA).join(MANIFEST),
        )?)?)
    }
}

pub struct Space {
    id: SpaceId,
    name: String,
    folder: PathBuf,
    owner: PersonId,
    store: Store,
    modules: Arc<[Arc<dyn Module>]>,
    /// Held while the Space is open, so one engine at a time writes it.
    _lock: File,
}

impl Space {
    /// The name as a Space's folder takes it.
    pub(crate) fn plain_name(name: &str) -> Result<&str, Refusal> {
        crate::plain_name(name).ok_or_else(|| {
            Refusal::invalid(
                "A Space's name is 1 to 64 characters, with no slashes and no leading dot.",
            )
        })
    }

    /// Makes a new Space's folder, which must not exist yet. When it exists
    /// and `command` made it, this is the same command again: the answer is
    /// that Space's ID.
    pub(crate) fn create(
        folder: &Path,
        name: &str,
        author: Participant,
        command: CommandId,
    ) -> Result<Created, Error> {
        let manifest = Manifest {
            id: SpaceId::new(),
            name: name.to_owned(),
            author,
            command,
            created_at: now_ms(),
        };
        let bytes = serde_json::to_vec_pretty(&manifest)?;
        match std::fs::create_dir(folder) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return match Manifest::read(folder) {
                    Ok(made) if made.command == command => Ok(Created::Earlier(made.id)),
                    _ => Err(Refusal::conflict(format!(
                        "A folder named \"{name}\" already exists in this place."
                    ))
                    .into()),
                };
            }
            Err(error) => return Err(error.into()),
        }
        let data = folder.join(DATA);
        let temporary = data.join(format!("{MANIFEST}.new"));
        let written = std::fs::create_dir(&data)
            .and_then(|()| std::fs::write(&temporary, bytes))
            .and_then(|()| std::fs::rename(&temporary, data.join(MANIFEST)));
        if let Err(error) = written {
            // Take back only what this call made, and only while empty.
            let _ = std::fs::remove_file(&temporary);
            let _ = std::fs::remove_dir(&data);
            let _ = std::fs::remove_dir(folder);
            return Err(error.into());
        }
        Ok(Created::New)
    }

    /// The ID of the Space in `folder`, or `None` when it holds none.
    pub(crate) fn id_of(folder: &Path) -> Option<SpaceId> {
        Manifest::read(folder).ok().map(|m| m.id)
    }

    /// Opens a Space: its lock, its database, the settling of what a
    /// restart cut short, its outbox worker, then each module's `opened`.
    pub(crate) async fn open(
        folder: PathBuf,
        owner: PersonId,
        modules: Arc<[Arc<dyn Module>]>,
        boot: &str,
    ) -> Result<Arc<Space>, Error> {
        let manifest = Manifest::read(&folder)?;
        let lock = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(folder.join(DATA).join(LOCK))?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => {
                return Err(Refusal::conflict("This Space is open in another Bandaso.").into());
            }
            Err(TryLockError::Error(error)) => return Err(error.into()),
        }
        let ledgers: Vec<_> = modules.iter().map(|m| (m.name(), m.migrations())).collect();
        let path = folder.join(DATA).join(DATABASE);
        let store = tokio::task::spawn_blocking(move || Store::open(&path, &ledgers))
            .await
            .map_err(|_| Error::Closed)??;
        let space = Arc::new(Space {
            id: manifest.id,
            name: manifest.name,
            folder,
            owner,
            store,
            modules,
            _lock: lock,
        });
        outbox::recover(&space, boot).await?;
        tokio::spawn(outbox::work(Arc::downgrade(&space), boot.to_owned()));
        for module in space.modules.iter() {
            module.opened(space.module(module.name())).await?;
        }
        Ok(space)
    }

    pub fn id(&self) -> SpaceId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn folder(&self) -> &Path {
        &self.folder
    }

    pub fn owner(&self) -> PersonId {
        self.owner
    }

    pub fn summary(&self) -> SpaceSummary {
        SpaceSummary {
            id: self.id,
            name: self.name.clone(),
            folder: self.folder.display().to_string(),
        }
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

/// What [`Space::create`] did.
pub(crate) enum Created {
    New,
    /// The same command made this Space before.
    Earlier(SpaceId),
}

impl Drop for Space {
    fn drop(&mut self) {
        // Wake the worker so it sees the Space is gone and ends.
        self.store.outbox_signal().notify_one();
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

    pub fn folder(&self) -> &Path {
        &self.space.folder
    }

    pub fn owner(&self) -> PersonId {
        self.space.owner
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
