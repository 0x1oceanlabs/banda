//! A Project is any folder on this machine (ADR 0005, decision 6; ADR 0026):
//! the folder holds the work alone, and what Banda keeps for it lives in
//! the engine's data, in `projects/<id>/`: `project.json`, which names the
//! folder, the SQLite, the lock, and the modules' files.

use crate::environment::Environment;
use crate::events::{self, Event, EventFilter};
use crate::kernel::Entry;
use crate::module::Module;
use crate::outbox::{self, Boot, Claim, Lease, Outcome};
use crate::passes::{Pass, Passes};
use crate::sign::{self, Kept, Picked, Sign};
use crate::store::{Receipt, Store};
use crate::window::Window;
use crate::{
    AgentId, CommandId, Error, Participant, PersonId, ProjectId, ProjectSummary, Refusal, Tx,
    now_ms,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::Display;
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::sync::{broadcast, watch};

pub(crate) const MANIFEST: &str = "project.json";
pub(crate) const LOCK: &str = "project.lock";
const DATABASE: &str = "project.sqlite3";
/// A Project's data while it is being written, before it is renamed into
/// place: the engine opens none of these, and clears them.
pub(crate) const UNFINISHED: &str = ".new";
/// A removed Project's data until it is deleted: the engine opens none of
/// these either, and clears them.
pub(crate) const GONE: &str = ".gone";

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Manifest {
    pub id: ProjectId,
    pub name: String,
    /// The Project's folder, absolute. Empty in a manifest from before
    /// ADR 0026, which sat in the folder itself.
    #[serde(default)]
    pub folder: PathBuf,
    pub author: Participant,
    /// The command that made it: the same command again gets this Project.
    pub command: CommandId,
    pub created_at: i64,
    /// Pinned Projects come first in the Project pickers (ADR 0026).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// Hidden from the Project pickers; its Threads and files are kept.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub archived: bool,
    /// Its Agents see the other Projects' Panes, as their Person let them
    /// (ADR 0032).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sees_others: bool,
    /// One Thread's Project in No Project (ADR 0046): its folder is under
    /// `scratch/`, and it has no name until the Person makes a Project of it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub scratch: bool,
    /// What the Person picked as its sign (ADR 0070); none for a picture
    /// Banda found, or letters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign: Option<Picked>,
    /// The picture kept beside it as `sign.<ext>`, found or picked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<Kept>,
    /// The Person does not trust it ([`ProjectSummary::trusted`]). A
    /// manifest that does not say is trusted, as every one from before is.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub untrusted: bool,
}

impl Manifest {
    /// A new Project's manifest, for its folder `folder`.
    pub fn new(folder: &Path, name: &str, author: Participant, command: CommandId) -> Manifest {
        Manifest {
            id: ProjectId::new(),
            name: name.to_owned(),
            folder: folder.to_owned(),
            author,
            command,
            created_at: now_ms(),
            pinned: false,
            archived: false,
            sees_others: false,
            scratch: false,
            sign: None,
            picture: None,
            untrusted: false,
        }
    }

    /// What the window lists of it; `missing` when its folder is gone.
    pub fn summary(&self, missing: bool) -> ProjectSummary {
        ProjectSummary {
            id: self.id,
            name: self.name.clone(),
            folder: self.folder.display().to_string(),
            pinned: self.pinned,
            archived: self.archived,
            sees_others: self.sees_others,
            scratch: self.scratch,
            missing,
            sign: Sign::of(&self.name, self.sign.as_ref(), self.picture.as_ref()),
            trusted: !self.untrusted,
        }
    }

    pub fn read(data: &Path) -> Result<Manifest, Error> {
        let mut manifest: Manifest = serde_json::from_slice(&std::fs::read(data.join(MANIFEST))?)?;
        let journal = data.join("move.json");
        if journal.exists() {
            let next: Manifest = serde_json::from_slice(&std::fs::read(&journal)?)?;
            if !manifest.folder.exists() && next.folder.is_dir() {
                next.write(data)?;
                manifest = next;
            }
            std::fs::remove_file(journal)?;
        }
        Ok(manifest)
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
        Ok(write_whole(
            &data.join(MANIFEST),
            &serde_json::to_vec_pretty(self)?,
        )?)
    }
}

/// Writes `bytes` to `path` whole or not at all: beside it first, then
/// renamed into place.
pub(crate) fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut aside = path.as_os_str().to_owned();
    aside.push(UNFINISHED);
    std::fs::write(&aside, bytes)?;
    std::fs::rename(&aside, path)
}

/// What a module of the machine counts in every Project's log: see
/// [`ModuleProject::tally`].
#[derive(Clone, Debug, Default)]
pub struct Tally {
    pub module: String,
    pub kind: String,
    /// The payload's field it counts by; none counts them all as one.
    pub by: Option<String>,
    /// From when, and till when, in ms since the epoch.
    pub from: i64,
    pub to: i64,
}

/// What a Project shares with the engine and every other Project.
pub(crate) struct Shared {
    pub owner: PersonId,
    pub passes: Arc<Passes>,
    pub window: Arc<Window>,
    /// Where its programs run (ADR 0084).
    pub environment: Arc<dyn Environment>,
    /// This machine's scope; none for the machine itself.
    pub machine: Option<Arc<Project>>,
    /// Every Project, for the machine itself only: weak, as each Project holds
    /// the machine.
    pub projects: Option<std::sync::Weak<RwLock<BTreeMap<ProjectId, Entry>>>>,
}

/// Puts a Project's data in place as `projects/<id>/`, whole or not at all:
/// `fill` writes it into a folder aside, the manifest joins it, and that
/// folder is renamed into place. Answers where it is.
pub(crate) fn place(
    projects: &Path,
    manifest: &Manifest,
    fill: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<PathBuf, Error> {
    let data = projects.join(manifest.id.to_string());
    let unfinished = projects.join(format!("{}{UNFINISHED}", manifest.id));
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

pub struct Project {
    id: ProjectId,
    pub(crate) moving: tokio::sync::RwLock<()>,
    /// `projects/<id>/` in the engine's data.
    data: PathBuf,
    /// Its `project.json`, as the Person changes its name, pin and archive.
    /// Its ID stays fixed; a promotion may move its folder.
    manifest: std::sync::Mutex<Manifest>,
    /// Where its data went once it was removed: deleted as it closes.
    removed: std::sync::Mutex<Option<PathBuf>>,
    owner: PersonId,
    store: Store,
    modules: Arc<[Arc<dyn Module>]>,
    passes: Arc<Passes>,
    window: Arc<Window>,
    environment: Arc<dyn Environment>,
    /// How far each module reacting to the log has reacted: see
    /// [`ModuleProject::react`].
    reactions: std::sync::Mutex<Vec<watch::Receiver<i64>>>,
    /// This machine's scope, which its modules may hear (ADR 0040,
    /// decision 3); none for the machine itself, or with no module of it.
    machine: Option<Arc<Project>>,
    /// Every Project of this machine, for the machine's own scope, whose
    /// modules count them: none for a Project. Weak, as each Project holds the
    /// machine.
    projects: Option<std::sync::Weak<RwLock<BTreeMap<ProjectId, Entry>>>>,
    /// Dropped with the Project: what hears the machine for it ends then.
    open: watch::Sender<()>,
    /// The engine's run that opened it: it owns the effects the engine runs,
    /// and its clock times the workers' leases.
    boot: Boot,
    /// Held while the Project is open, so one engine at a time writes it.
    _lock: File,
}

impl Project {
    /// A Project's name, which the Person may change: it names no folder.
    pub(crate) fn name_of(name: &str) -> Result<&str, Refusal> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 64 || name.contains(char::is_control) {
            return Err(Refusal::invalid("A Project's name is 1 to 64 characters."));
        }
        Ok(name)
    }

    /// The name as a Project's folder takes it.
    pub(crate) fn plain_name(name: &str) -> Result<&str, Refusal> {
        crate::plain_name(name).ok_or_else(|| {
            Refusal::invalid(
                "A Project's name is 1 to 64 characters, with no slashes and no leading dot.",
            )
        })
    }

    /// `data` is the Project's `projects/<id>/`, and `manifest` the one there,
    /// which names the folder.
    pub(crate) async fn open(
        data: PathBuf,
        manifest: Manifest,
        modules: Arc<[Arc<dyn Module>]>,
        engine: Shared,
        boot: &Boot,
    ) -> Result<Arc<Project>, Error> {
        let Shared {
            owner,
            passes,
            window,
            environment,
            machine,
            projects,
        } = engine;
        let folder = manifest.folder.clone();
        if !folder.is_dir() {
            return Err(Refusal::not_found(format!(
                "The Project's folder {} is not there.",
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
        let project = Arc::new(Project {
            id: manifest.id,
            moving: Default::default(),
            data,
            manifest: std::sync::Mutex::new(manifest),
            removed: Default::default(),
            owner,
            store,
            modules,
            passes,
            window,
            environment,
            reactions: Default::default(),
            machine,
            projects,
            open: watch::Sender::new(()),
            boot: boot.clone(),
            _lock: lock,
        });
        outbox::recover(&project).await?;
        // Each module picks up its work before any effect runs, so what it
        // finds is what the last boot left.
        for module in project.modules.iter() {
            module.opened(project.module(module.name())).await?;
        }
        tokio::spawn(outbox::work(Arc::downgrade(&project)));
        Ok(project)
    }

    pub fn id(&self) -> ProjectId {
        self.id
    }

    pub fn folder(&self) -> PathBuf {
        self.manifest.lock().unwrap().folder.clone()
    }

    /// What Banda keeps for this Project, outside its folder.
    pub fn data(&self) -> &Path {
        &self.data
    }

    /// The command that made it.
    pub(crate) fn command(&self) -> CommandId {
        self.manifest.lock().unwrap().command
    }

    /// Its data, now at `data`, is deleted once the last holder lets go
    /// of the Project: its turns and terminals have stopped.
    pub(crate) fn delete_when_closed(&self, data: PathBuf) {
        *self.removed.lock().unwrap() = Some(data);
    }

    pub fn owner(&self) -> PersonId {
        self.owner
    }

    /// Whether its Agents see the other Projects' Panes (ADR 0032).
    pub fn sees_others(&self) -> bool {
        self.manifest.lock().unwrap().sees_others
    }

    /// Whether it is one Thread's Project, in No Project (ADR 0046).
    pub fn scratch(&self) -> bool {
        self.manifest.lock().unwrap().scratch
    }

    /// Whether the Person trusts it ([`ProjectSummary::trusted`]).
    pub fn trusted(&self) -> bool {
        !self.manifest.lock().unwrap().untrusted
    }

    pub fn summary(&self) -> ProjectSummary {
        self.manifest.lock().unwrap().summary(false)
    }

    /// Looks in its folder for its sign's picture again (ADR 0070, decision
    /// 2), and keeps what it finds, or lets go of what it found before.
    pub(crate) fn find_sign(&self) -> Result<ProjectSummary, Error> {
        match self.sign_wanted() {
            Some((folder, name)) => self.keep_sign(sign::find(&folder, &name)),
            None => Ok(self.summary()),
        }
    }

    /// Where to look for its sign's picture, and for which name; none when
    /// it is not looked for: a picture the Person picked stays, and No
    /// Project's has none.
    pub(crate) fn sign_wanted(&self) -> Option<(PathBuf, String)> {
        let manifest = self.manifest.lock().unwrap();
        let picked = matches!(manifest.sign, Some(Picked::Picture { .. }));
        (!manifest.scratch && !picked).then(|| (manifest.folder.clone(), manifest.name.clone()))
    }

    /// Keeps `found` as its sign's picture, or lets go of the one found
    /// before; nothing is written when it is the same.
    pub(crate) fn keep_sign(&self, found: Option<sign::Found>) -> Result<ProjectSummary, Error> {
        let before = self.manifest.lock().unwrap().picture.clone();
        let same = |found: &sign::Found| {
            before.as_ref().is_some_and(|kept| {
                kept.found.as_deref() == Some(&found.path)
                    && kept.version == sign::version(&found.bytes)
            })
        };
        let kept = match found {
            Some(found) if same(&found) => return Ok(self.summary()),
            Some(found) => Some(sign::keep(
                &self.data,
                found.kind,
                &found.bytes,
                Some(found.path),
            )?),
            None if before.as_ref().is_none_or(|kept| kept.found.is_none()) => {
                return Ok(self.summary());
            }
            None => {
                sign::forget(&self.data);
                None
            }
        };
        self.change(|manifest| manifest.picture = kept)
    }

    /// The picture its sign keeps, found or picked.
    pub(crate) fn picture(&self) -> Option<Kept> {
        self.manifest.lock().unwrap().picture.clone()
    }

    /// Changes its `project.json` with `change`, and keeps it once written.
    pub(crate) fn change(
        &self,
        change: impl FnOnce(&mut Manifest),
    ) -> Result<ProjectSummary, Error> {
        (self.manifest.lock().unwrap()).change_in(&self.data, change)?;
        Ok(self.summary())
    }

    /// Journal the next manifest before renaming. A restart finishes a move
    /// whose rename succeeded before the manifest could be written.
    pub(crate) fn move_to(
        &self,
        target: &Path,
        change: impl FnOnce(&mut Manifest),
    ) -> Result<ProjectSummary, Error> {
        let mut manifest = self.manifest.lock().unwrap();
        let mut next = manifest.clone();
        change(&mut next);
        let journal = self.data.join("move.json");
        let pending = self.data.join("move.pending");
        let file = std::fs::File::create(&pending)?;
        serde_json::to_writer(&file, &next)?;
        file.sync_all()?;
        std::fs::rename(pending, &journal)?;
        if let Err(error) = rustix::fs::renameat_with(
            rustix::fs::CWD,
            &manifest.folder,
            rustix::fs::CWD,
            target,
            rustix::fs::RenameFlags::NOREPLACE,
        ) {
            std::fs::remove_file(&journal)?;
            return Err(
                Refusal::conflict(format!("The folder could not be moved: {error}")).into(),
            );
        }
        // The journal is authoritative if writing project.json fails. Keep the
        // live path correct too; a retry must never create another Project.
        *manifest = next;
        manifest.write(&self.data)?;
        std::fs::remove_file(journal)?;
        Ok(manifest.summary(false))
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
    /// [`ModuleProject::react`]).
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
            project: Arc::downgrade(self),
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

    /// This Project as one module sees it.
    pub(crate) fn module(self: &Arc<Self>, module: &'static str) -> ModuleProject {
        ModuleProject {
            project: self.clone(),
            module,
        }
    }

    pub(crate) fn store(&self) -> &Store {
        &self.store
    }

    pub(crate) fn modules(&self) -> &[Arc<dyn Module>] {
        &self.modules
    }

    pub(crate) fn boot(&self) -> &Boot {
        &self.boot
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
            Err(Refusal::conflict("This Project is open in another Banda.").into())
        }
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        // Wake the worker so it sees the Project is gone and ends.
        self.store.outbox_signal().notify_one();
        if let Some(data) = self.removed.get_mut().unwrap().take() {
            let delete = move || {
                if let Err(error) = std::fs::remove_dir_all(&data) {
                    let data = data.display();
                    tracing::warn!(%data, %error, "a removed Project's data was not deleted");
                }
            };
            match tokio::runtime::Handle::try_current() {
                Ok(runtime) => drop(runtime.spawn_blocking(delete)),
                Err(_) => delete(),
            }
        }
    }
}

/// A module's events as they are committed: see [`ModuleProject::committed`].
pub struct Committed {
    events: broadcast::Receiver<Arc<Event>>,
    filter: EventFilter,
}

impl Committed {
    /// Returns once one is committed, or when some were missed, so the
    /// caller reads again. Once the Project closes it never returns: the
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
/// on: see [`ModuleProject::react`]. It holds the Project only while it reads
/// the log, so a removed Project still goes.
pub struct Heard {
    project: std::sync::Weak<Project>,
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
    /// Whether the Project of the module that hears is open, when it hears
    /// another's log: it ends as that Project closes. A watch, not that
    /// Project's log, which would wake it at each of its events.
    from: Option<watch::Receiver<()>>,
}

/// How many events one read of the log takes.
const PAGE: usize = 500;

impl Heard {
    /// The next event, in the log's order; none once the Project is gone.
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
                let Some(project) = self.project.upgrade() else {
                    return Ok(None);
                };
                let page = project
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

    /// The Project it hears, while it is open, as the module reacting sees
    /// it.
    pub fn project(&self) -> Option<ModuleProject> {
        Some(self.project.upgrade()?.module(self.module?))
    }

    /// Its hearing Project closed: it reacts no more, so no one waits on it.
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

/// A Project as one module sees it: it writes under that module's name, so
/// it emits only that module's events.
#[derive(Clone)]
pub struct ModuleProject {
    project: Arc<Project>,
    module: &'static str,
}

impl ModuleProject {
    pub fn id(&self) -> ProjectId {
        self.project.id
    }

    /// The Project's work folder. A module of this machine gets the
    /// machine's state folder: no work of a Person's is there.
    pub fn folder(&self) -> PathBuf {
        self.project.folder()
    }

    /// Where this module may keep files of its own for the Project, outside
    /// its folder: `projects/<id>/`, beside the Project's SQLite.
    pub fn data(&self) -> &Path {
        &self.project.data
    }

    pub fn owner(&self) -> PersonId {
        self.project.owner
    }

    /// Whether the Person trusts the Project now
    /// ([`ProjectSummary::trusted`]);
    /// [`Module::trust_changed`](crate::Module::trust_changed) tells when it
    /// changes.
    pub fn trusted(&self) -> bool {
        self.project.trusted()
    }

    /// Where the Project's programs run (ADR 0084): a module starts each
    /// one there, never by itself. The machine's scope has the engine's,
    /// for what its modules start.
    pub fn environment(&self) -> Arc<dyn Environment> {
        self.project.environment.clone()
    }

    /// A new pass that names `agent` in this Project, and works only in it:
    /// for a session's `banda mcp` and shell, or for the shells of a Harness
    /// process's Agents (ADR 0019, decision 2). Its session holds it, and
    /// lets it go as it ends: dropped, it is revoked.
    pub fn pass(&self, agent: AgentId) -> Result<Pass, Error> {
        self.project.passes.issue(agent, self.project.id)
    }

    /// Asks the window `what`, under this module's name, for `by` in this
    /// Project (ADR 0029, decision 2): a call's, or the module's own work, as
    /// sharing asks the window to post what waits (ADR 0039).
    pub async fn ask_window(
        &self,
        by: Participant,
        what: &str,
        params: Value,
        within: Duration,
    ) -> Result<Value, Refusal> {
        let method = format!("{}.{what}", self.module);
        let window = &self.project.window;
        (window.ask(method, self.project.id, by, params, within)).await
    }

    /// Watches `dirs`, each by itself, until the [`Watch`](crate::Watch)
    /// is dropped: the engine's one watcher, shared by every module (ADR
    /// 0073, decision 14). Fails only when the system gives no watcher.
    pub fn watch(&self, dirs: impl IntoIterator<Item = PathBuf>) -> std::io::Result<crate::Watch> {
        crate::watching::watch(dirs)
    }

    /// Whether a window is open to ask: a module's own work that only a
    /// window does, or that only a window shows, waits for one.
    pub fn window_open(&self) -> bool {
        self.project.window.open()
    }

    /// Takes for `worker`, a worker outside the engine, the first ready
    /// effect of this module's `kinds` queued for one
    /// ([`Tx::enqueue_for_worker`]): due, and the first of its key, with
    /// nothing of its key running. Its lease lasts `term`, at most
    /// [`LONGEST_LEASE`](crate::LONGEST_LEASE): the worker renews it before
    /// it runs out, and settles the effect under its claim. One that runs
    /// out is cut short, as a restart cuts the engine's own runs
    /// ([`Module::on_restart`](crate::Module::on_restart)). None when
    /// nothing is ready (ADR 0082, A6).
    pub async fn lease(
        &self,
        worker: &str,
        kinds: &[&str],
        term: Duration,
    ) -> Result<Option<Lease>, Error> {
        outbox::lease(&self.project, self.module, worker, kinds, term).await
    }

    /// Renews the lease of `claim` for `term` from now. Refused as
    /// `conflict` once the effect was taken again, after its lease ran out,
    /// or settled: its worker stops, and writes nothing.
    pub async fn renew(&self, claim: Claim, term: Duration) -> Result<(), Refusal> {
        outbox::renew(&self.project, self.module, claim, term).await
    }

    /// Settles a run a worker held under `claim`, as a run in the engine
    /// ends: done, with what this module writes of it; to retry, as its
    /// kind's [`Retry`](crate::Retry) says; or failed. Refused as
    /// `conflict`, writing nothing, once the effect was taken again, after
    /// its lease ran out, or settled. A write that fails leaves the lease
    /// as it was, for the worker to finish again.
    pub async fn finish(&self, claim: Claim, outcome: Outcome) -> Result<(), Refusal> {
        outbox::finish_leased(&self.project, self.module, claim, outcome).await
    }

    /// One change in one transaction, outside any command: what a module
    /// writes as its effects run. Its events go out after commit.
    pub async fn write<T: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.project.store.write(self.module, change).await
    }

    /// This module's events of `kinds` about `subject`, from now on, as
    /// each is committed: a module waits on them for what was written, in
    /// place of reading again. Made before the read it waits after, so
    /// nothing committed between the two is missed.
    pub fn committed(&self, subject: impl Display, kinds: &[&str]) -> Committed {
        Committed {
            events: self.project.subscribe(),
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
        self.project.events_after(after, filter, limit).await
    }

    /// The log's position as it stood at `at`, in ms since the epoch: its
    /// last event made before then, or 0. With [`ModuleProject::events_after`],
    /// what the log took in a span of time.
    pub async fn position_at(&self, at: i64) -> Result<i64, Error> {
        (self.project.store)
            .read(move |sql| Ok(events::position_at(sql, at)?))
            .await
    }

    /// The newest of every module's stored events before `before` in the
    /// log that matches `filter`.
    pub async fn event_before(
        &self,
        before: i64,
        filter: EventFilter,
    ) -> Result<Option<Event>, Error> {
        (self.project.store)
            .read(move |sql| Ok(events::before(sql, before, &filter)?))
            .await
    }

    /// Every module's events that match `filter`, after `after` in the
    /// log, and then each as it is committed: how a module reacts to what
    /// another did, as git keeps a checkpoint as a turn starts (ADR 0034).
    /// An effect that waits for the reactions ([`ModuleProject::reacted`])
    /// waits until it has handled each one before.
    pub fn react(&self, after: i64, filter: EventFilter) -> Heard {
        self.project.hear(after, filter, Some(self.module))
    }

    /// This machine's events that match `filter`, from now on, and then
    /// each as it is committed: how a module of a Project reacts to what
    /// this computer did, as `agents` lets go of its Harness processes
    /// after a sign-in (ADR 0040, decision 3). The machine's
    /// [`ModuleProject::reacted`] waits for it too. It only hears: its
    /// [`Heard::project`] is none, so it never writes the machine's log. It
    /// ends as this Project closes. None for a module of the machine, or
    /// while the engine has none.
    pub async fn react_to_machine(&self, filter: EventFilter) -> Result<Option<Heard>, Error> {
        let Some(machine) = &self.project.machine else {
            return Ok(None);
        };
        let mut heard = machine.hear(machine.head().await?, filter, Some(self.module));
        // It only hears: there is no machine's Project of its module to give.
        heard.module = None;
        heard.from = Some(self.project.open.subscribe());
        Ok(Some(heard))
    }

    /// How many Projects this machine has, the missing too. None for a
    /// module of a Project.
    pub async fn projects(&self) -> Option<usize> {
        Some(
            self.project
                .projects
                .as_ref()?
                .upgrade()?
                .read()
                .await
                .len(),
        )
    }

    /// How many events of `tally.module`'s `tally.kind` every open Project's
    /// log took in `tally.from..tally.to`, in ms since the epoch, by the
    /// text of their payload's `tally.by` field, or `""` without one. Only
    /// these numbers cross the wall, for a module of the machine, which
    /// never hears a Project's log (ADR 0040, decision 3, as ADR 0039 amends
    /// it): no Project, subject, author or word. So `by` names a field whose
    /// values are a few names, such as a Harness's. None for a module of
    /// a Project.
    pub async fn tally(&self, tally: Tally) -> Result<Option<BTreeMap<String, u64>>, Error> {
        let Some(projects) = self.project.projects.as_ref().and_then(|s| s.upgrade()) else {
            return Ok(None);
        };
        let by = tally.by.clone().unwrap_or_default();
        if !by.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            return Err(Refusal::invalid("A tally is by a plain field of the payload.").into());
        }
        let open: Vec<Arc<Project>> = (projects.read().await.values())
            .filter_map(|entry| match entry {
                Entry::Open(project) => Some(project.clone()),
                Entry::Missing { .. } => None,
            })
            .collect();
        // The payload itself is no text: all of it counts as one.
        let path = match by.as_str() {
            "" => "$".to_owned(),
            by => format!("$.{by}"),
        };
        let mut all = BTreeMap::new();
        for project in open {
            let (tally, path) = (tally.clone(), path.clone());
            let read = move |sql: &rusqlite::Connection| Ok(events::tally(sql, &tally, &path)?);
            for (by, count) in project.store.read(read).await? {
                *all.entry(by).or_default() += count;
            }
        }
        Ok(Some(all))
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
            let mut reactions = self.project.reactions.lock().unwrap();
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

    /// A read on the Project's reader connection.
    pub async fn read<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.project.store.read(query).await
    }

    /// Reads a view together with the log position it is current at, in one
    /// read transaction. A window shows the view, then follows the events
    /// after that position (ADR 0002, decision 5).
    pub async fn view<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<(i64, T), Error> {
        self.project
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
    /// answer read outside the Project's data, as git's.
    pub async fn at(&self) -> Result<i64, Error> {
        self.project.head().await
    }

    /// The receipt of `command`, made by `author` for `method` with
    /// `params`.
    pub(crate) fn receipt(
        &self,
        command: CommandId,
        method: &str,
        author: Participant,
        params: &Value,
    ) -> Receipt {
        Receipt {
            command,
            module: self.module,
            method: method.to_owned(),
            author,
            params: Receipt::hash(params),
        }
    }

    pub(crate) async fn command<T: Send + 'static>(
        &self,
        receipt: Receipt,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Refusal> {
        self.project.store.command(receipt, change).await
    }
}
