//! A Space is a folder you can see (ADR 0001, decision 5): the work's files,
//! plus `.bandaso/` with the Space's SQLite. Copying the folder moves the
//! Space.

use crate::events::{self, Event, EventFilter};
use crate::module::Module;
use crate::outbox;
use crate::store::Store;
use crate::{CommandId, Error, PersonId, Refusal, SpaceId, SpaceSummary, Tx, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

/// The folder inside a Space that Bandaso keeps for itself.
pub(crate) const DATA: &str = ".bandaso";
const MANIFEST: &str = "space.json";
const DATABASE: &str = "space.sqlite3";

#[derive(Serialize, Deserialize)]
struct Manifest {
    id: SpaceId,
    name: String,
    created_at: i64,
}

pub struct Space {
    id: SpaceId,
    name: String,
    folder: PathBuf,
    owner: PersonId,
    store: Store,
    modules: Arc<[Arc<dyn Module>]>,
}

impl Space {
    /// Makes a new Space's folder. The folder must not exist yet.
    pub(crate) fn create(folder: &Path, name: &str) -> Result<(), Error> {
        if folder.exists() {
            return Err(Refusal::conflict(format!(
                "A folder named \"{name}\" already exists in this place."
            ))
            .into());
        }
        let data = folder.join(DATA);
        std::fs::create_dir_all(&data)?;
        let manifest = Manifest {
            id: SpaceId::new(),
            name: name.to_owned(),
            created_at: now_ms(),
        };
        let temporary = data.join(format!("{MANIFEST}.new"));
        std::fs::write(&temporary, serde_json::to_vec_pretty(&manifest)?)?;
        std::fs::rename(temporary, data.join(MANIFEST))?;
        Ok(())
    }

    /// Whether `folder` holds a Space.
    pub(crate) fn is_space(folder: &Path) -> bool {
        folder.join(DATA).join(MANIFEST).is_file()
    }

    /// Opens a Space: its database, the settling of what a restart cut short,
    /// its outbox worker, then each module's `opened`.
    pub(crate) async fn open(
        folder: PathBuf,
        owner: PersonId,
        modules: Arc<[Arc<dyn Module>]>,
        run: &str,
    ) -> Result<Arc<Space>, Error> {
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(folder.join(DATA).join(MANIFEST))?)?;
        let ledgers: Vec<_> = modules.iter().map(|m| (m.name(), m.migrations())).collect();
        let path = folder.join(DATA).join(DATABASE);
        let store = tokio::task::spawn_blocking(move || Store::open(&path, &ledgers))
            .await
            .map_err(|_| Error::WriterGone)??;
        let space = Arc::new(Space {
            id: manifest.id,
            name: manifest.name,
            folder,
            owner,
            store,
            modules,
        });
        outbox::recover(&space, run).await?;
        tokio::spawn(outbox::work(Arc::downgrade(&space), run.to_owned()));
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

    pub fn summary(&self) -> SpaceSummary {
        SpaceSummary {
            id: self.id,
            name: self.name.clone(),
            folder: self.folder.display().to_string(),
        }
    }

    /// This Space as one module sees it.
    pub fn module(self: &Arc<Self>, module: &'static str) -> ModuleSpace {
        ModuleSpace {
            space: self.clone(),
            module,
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

    pub(crate) fn store(&self) -> &Store {
        &self.store
    }

    pub(crate) fn modules(&self) -> &[Arc<dyn Module>] {
        &self.modules
    }
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

    /// One change in one transaction. Its events go out after commit.
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
                sql.execute_batch("BEGIN")?;
                let read = events::head(sql)
                    .map_err(Error::from)
                    .and_then(|at| Ok((at, query(sql)?)));
                sql.execute_batch("COMMIT")?;
                read
            })
            .await
    }

    pub(crate) async fn command(
        &self,
        command: CommandId,
        method: &str,
        change: impl FnOnce(&mut Tx<'_>) -> Result<Value, Error> + Send + 'static,
    ) -> Result<Value, Refusal> {
        self.space
            .store
            .command(self.module, command, method.to_owned(), change)
            .await
    }
}
