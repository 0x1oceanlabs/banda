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
use std::fmt::Display;
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch};

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
    /// One Thread's Space in No Space (ADR 0046): its folder is under
    /// `scratch/`, and it has no name until the Person makes a Space of it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub scratch: bool,
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
            scratch: false,
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
            scratch: self.scratch,
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

/// What a Space shares with the engine and every other Space.
pub(crate) struct Shared {
    pub owner: PersonId,
    pub passes: Arc<Passes>,
    pub window: Arc<Window>,
    /// This machine's scope; none for the machine itself.
    pub machine: Option<Arc<Space>>,
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
    /// How far each module reacting to the log has reacted: see
    /// [`ModuleSpace::react`].
    reactions: std::sync::Mutex<Vec<watch::Receiver<i64>>>,
    /// This machine's scope, which its modules may hear (ADR 0040,
    /// decision 3); none for the machine itself, or with no module of it.
    machine: Option<Arc<Space>>,
    /// Dropped with the Space: what hears the machine for it ends then.
    open: watch::Sender<()>,
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

    /// `data` is the Space's `spaces/<id>/`, and `manifest` the one there,
    /// which names the folder.
    pub(crate) async fn open(
        data: PathBuf,
        manifest: Manifest,
        modules: Arc<[Arc<dyn Module>]>,
        engine: Shared,
        boot: &str,
    ) -> Result<Arc<Space>, Error> {
        let Shared {
            owner,
            passes,
            window,
            machine,
        } = engine;
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
            reactions: Default::default(),
            machine,
            open: watch::Sender::new(()),
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

    /// Whether it is one Thread's Space, in No Space (ADR 0046).
    pub fn scratch(&self) -> bool {
        self.manifest.lock().unwrap().scratch
    }

    pub fn summary(&self) -> SpaceSummary {
        self.manifest.lock().unwrap().summary(false)
    }

    /// Changes its `space.json` with `change`, and keeps it once written.
    pub(crate) fn change(&self, change: impl FnOnce(&mut Manifest)) -> Result<SpaceSummary, Error> {
        (self.manifest.lock().unwrap()).change_in(&self.data, change)?;
        Ok(self.summary())
    }

    /// The log's position now.
    async fn head(&self) -> Result<i64, Error> {
        self.store.read(|sql| Ok(events::head(sql)?)).await
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

    /// Events after `after` that match `filter`; as a module's reaction,
    /// the effects that wait for reactions wait for it too (see
    /// [`ModuleSpace::react`]).
    pub(crate) fn hear(
        self: &Arc<Self>,
        after: i64,
        filter: EventFilter,
        reaction_of: Option<&'static str>,
    ) -> Heard {
        let handled = reaction_of.map(|_| {
            let (handled, reaction) = watch::channel(after);
            let mut reactions = self.reactions.lock().unwrap();
            // One whose Heard is gone reacts no more.
            reactions.retain(|reaction| reaction.has_changed().is_ok());
            reactions.push(reaction);
            handled
        });
        // Listening before the log is read, nothing falls between the two.
        Heard {
            live: self.subscribe(),
            space: Arc::downgrade(self),
            module: reaction_of,
            filter,
            last: after,
            given: after,
            handled,
            read: Default::default(),
            caught_up: false,
            from: None,
        }
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

/// A module's events as they are committed: see [`ModuleSpace::committed`].
pub struct Committed {
    events: broadcast::Receiver<Arc<Event>>,
    filter: EventFilter,
}

impl Committed {
    /// Returns once one is committed, or when some were missed, so the
    /// caller reads again. Once the Space closes it never returns: the
    /// caller bounds the wait.
    pub async fn next(&mut self) {
        loop {
            match self.events.recv().await {
                Ok(event) if self.filter.matches(&event) => return,
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => return,
                Err(broadcast::error::RecvError::Closed) => std::future::pending().await,
            }
        }
    }
}

/// Events of any module as they are committed, from a place in the log
/// on: see [`ModuleSpace::react`]. It holds the Space only while it reads
/// the log, so a removed Space still goes.
pub struct Heard {
    space: std::sync::Weak<Space>,
    /// The module whose reaction it is.
    module: Option<&'static str>,
    live: broadcast::Receiver<Arc<Event>>,
    filter: EventFilter,
    /// The last event heard.
    last: i64,
    /// The last event given.
    given: i64,
    /// Where it says how far it has reacted, when it reacts.
    handled: Option<watch::Sender<i64>>,
    /// Read from the log and not yet given.
    read: std::collections::VecDeque<Event>,
    /// The log is read up to the live events.
    caught_up: bool,
    /// Whether the Space of the module that hears is open, when it hears
    /// another's log: it ends as that Space closes. A watch, not that
    /// Space's log, which would wake it at each of its events.
    from: Option<watch::Receiver<()>>,
}

/// How many events one read of the log takes.
const PAGE: usize = 500;

impl Heard {
    /// The next event, in the log's order; none once the Space is gone.
    /// Falling behind the live events, it reads the log again, so none is
    /// missed. Asking for the next says the last one given is handled.
    pub async fn next(&mut self) -> Result<Option<Event>, Error> {
        self.reacted(self.given);
        loop {
            if self
                .from
                .as_ref()
                .is_some_and(|from| from.has_changed().is_err())
            {
                return Ok(self.end());
            }
            if let Some(event) = self.read.pop_front() {
                self.given = event.seq;
                return Ok(Some(event));
            }
            if !self.caught_up {
                let Some(space) = self.space.upgrade() else {
                    return Ok(None);
                };
                let page = space
                    .events_after(self.last, self.filter.clone(), PAGE)
                    .await?;
                self.caught_up = page.len() < PAGE;
                if let Some(last) = page.last() {
                    self.last = last.seq;
                }
                self.read.extend(page);
                continue;
            }
            let heard = match &mut self.from {
                Some(from) => tokio::select! {
                    heard = self.live.recv() => heard,
                    _ = from.changed() => return Ok(self.end()),
                },
                None => self.live.recv().await,
            };
            match heard {
                Ok(event) if event.seq > self.last => {
                    self.last = event.seq;
                    if self.filter.matches(&event) {
                        self.given = event.seq;
                        return Ok(Some(Event::clone(&event)));
                    }
                }
                Ok(_) => {}
                // Back to the log for what went by.
                Err(broadcast::error::RecvError::Lagged(_)) => self.caught_up = false,
                Err(broadcast::error::RecvError::Closed) => return Ok(None),
            }
            // Everything up to the last heard is handled: the log's events
            // were given, and the others are not its to react to.
            self.reacted(self.last);
        }
    }

    /// The Space it hears, while it is open, as the module reacting sees
    /// it.
    pub fn space(&self) -> Option<ModuleSpace> {
        Some(self.space.upgrade()?.module(self.module?))
    }

    /// Its hearing Space closed: it reacts no more, so no one waits on it.
    fn end(&mut self) -> Option<Event> {
        self.handled = None;
        None
    }

    /// Says it has reacted to every event up to `seq`.
    fn reacted(&self, seq: i64) {
        if let Some(handled) = &self.handled {
            handled.send_if_modified(|was| {
                let further = seq > *was;
                if further {
                    *was = seq;
                }
                further
            });
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
    /// Space (ADR 0029, decision 2): a call's, or the module's own work, as
    /// sharing asks the window to post what waits (ADR 0039).
    pub async fn ask_window(
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

    /// This module's events of `kinds` about `subject`, from now on, as
    /// each is committed: a module waits on them for what was written, in
    /// place of reading again. Made before the read it waits after, so
    /// nothing committed between the two is missed.
    pub fn committed(&self, subject: impl Display, kinds: &[&str]) -> Committed {
        Committed {
            events: self.space.subscribe(),
            filter: EventFilter {
                module: Some(self.module.to_owned()),
                subject: Some(subject.to_string()),
                kinds: Some(kinds.iter().map(|&kind| kind.to_owned()).collect()),
            },
        }
    }

    /// Every module's stored events after `after` that match `filter`, at
    /// most `limit`.
    pub async fn events_after(
        &self,
        after: i64,
        filter: EventFilter,
        limit: usize,
    ) -> Result<Vec<Event>, Error> {
        self.space.events_after(after, filter, limit).await
    }

    /// Every module's events that match `filter`, after `after` in the
    /// log, and then each as it is committed: how a module reacts to what
    /// another did, as git keeps a checkpoint as a turn starts (ADR 0034).
    /// An effect that waits for the reactions ([`ModuleSpace::reacted`])
    /// waits until it has handled each one before.
    pub fn react(&self, after: i64, filter: EventFilter) -> Heard {
        self.space.hear(after, filter, Some(self.module))
    }

    /// This machine's events that match `filter`, from now on, and then
    /// each as it is committed: how a module of a Space reacts to what
    /// this computer did, as `agents` lets go of its Harness processes
    /// after a sign-in (ADR 0040, decision 3). The machine's
    /// [`ModuleSpace::reacted`] waits for it too. It only hears: its
    /// [`Heard::space`] is none, so it never writes the machine's log. It
    /// ends as this Space closes. None for a module of the machine, or
    /// while the engine has none.
    pub async fn react_to_machine(&self, filter: EventFilter) -> Result<Option<Heard>, Error> {
        let Some(machine) = &self.space.machine else {
            return Ok(None);
        };
        let mut heard = machine.hear(machine.head().await?, filter, Some(self.module));
        // It only hears: there is no machine's Space of its module to give.
        heard.module = None;
        heard.from = Some(self.space.open.subscribe());
        Ok(Some(heard))
    }

    /// Waits until every module reacting to the log has handled what is
    /// in it now, at most `within`, and says whether they all did: an
    /// effect about to change the world lets them react first, as an
    /// Agent's turn lets git keep the work tree as it began.
    pub async fn reacted(&self, within: Duration) -> bool {
        let Ok(at) = self.at().await else {
            return false;
        };
        let reactions = {
            let mut reactions = self.space.reactions.lock().unwrap();
            // One whose Heard is gone reacts no more.
            reactions.retain(|reaction| reaction.has_changed().is_ok());
            reactions.clone()
        };
        let all = async {
            for mut reaction in reactions {
                let _ = reaction.wait_for(|handled| *handled >= at).await;
            }
        };
        tokio::time::timeout(within, all).await.is_ok()
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

    /// The log position now: what a view read now is current at, for an
    /// answer read outside the Space's data, as git's.
    pub async fn at(&self) -> Result<i64, Error> {
        self.space.head().await
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
