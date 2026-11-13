//! A Project is any folder on this machine (ADR 0005, decision 6; ADR 0026):
//! the folder holds the work alone, and what Banda keeps for it lives in
//! the engine's data, in `projects/<id>/`: `project.json`, which names the
//! folder, the SQLite, the lock, and the modules' files.

use crate::cursors::{Cursor, Listener};
use crate::environment::Environment;
use crate::events::{self, Event, EventFilter};
use crate::kernel::Entry;
use crate::module::Module;
use crate::outbox::{self, Boot, Claim, Lease, Outcome};
use crate::passes::{Pass, Passes};
use crate::sign::{self, Kept, Picked, Sign};
use crate::store::{Receipt, Store};
use crate::tables::Tables;
use crate::window::Window;
use crate::{
    AgentId, CommandId, Error, Participant, PersonId, ProjectId, ProjectSummary, Refusal, Tx,
    now_ms,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Display;
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

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
    /// The Person said they trust it, as they added it or later
    /// ([`ProjectSummary::trust_said`]); one trusted only as nothing marked
    /// it foreign was not said so.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub trust_said: bool,
    /// Who said it, and when, where it is said: the Person, or the upgrade
    /// that brought the fence, for a Project trusted before it. None where
    /// it was said before this was kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub said: Option<Said>,
    /// Which [`VERSION`] wrote it: none in a manifest from before the fence,
    /// whose trust the upgrade says once ([`crate::old::said_before_fence`]).
    #[serde(default)]
    pub version: u32,
}

/// The version of the manifests this engine writes: 1 from the fence on
/// (ADR 0083, F0-3).
pub(crate) const VERSION: u32 = 1;

/// Who said the Person trusts a Project, and when ([`Manifest::said`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Said {
    pub by: SaidBy,
    /// When, in ms since the epoch.
    pub at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SaidBy {
    /// The Person: in the trust step as they added it, or with
    /// `projects.trust`.
    Person,
    /// The upgrade that brought the fence, once, for a Project that was
    /// trusted then (Roma, 2026-11-08).
    Upgrade,
}

impl Said {
    /// Said by `by`, now.
    pub fn now(by: SaidBy) -> Said {
        Said { by, at: now_ms() }
    }
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
            trust_said: false,
            said: None,
            version: VERSION,
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
            trust_said: !self.untrusted && self.trust_said,
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
    crate::host::rename(Path::new(&aside), path)
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
        crate::host::rename(&unfinished, &data)?;
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
    /// Held to read while a call runs in it, and to write while its folder
    /// moves: shared, so a call that reaches it from another Project holds
    /// it too ([`Call::other`](crate::Call::other)).
    pub(crate) moving: Arc<tokio::sync::RwLock<()>>,
    /// Held to read by a call that reaches it from another Project, and to
    /// write as it is removed: its data is put away only once what such a
    /// call brought it has landed ([`Call::other`](crate::Call::other)).
    pub(crate) reached: Arc<tokio::sync::RwLock<()>>,
    /// `projects/<id>/` in the engine's data.
    data: PathBuf,
    /// Its `project.json`, as the Person changes its name, pin and archive.
    /// Its ID stays fixed; a promotion may move its folder.
    manifest: std::sync::Mutex<Manifest>,
    /// Where its data went once it was removed: deleted as it closes.
    removed: std::sync::Mutex<Option<PathBuf>>,
    owner: PersonId,
    store: Store,
    /// The modules that run here: [`Project::modules`].
    modules: std::sync::RwLock<Arc<[Arc<dyn Module>]>>,
    passes: Arc<Passes>,
    window: Arc<Window>,
    environment: Arc<dyn Environment>,
    /// How far each module's listener of this log has reacted, by its
    /// key: see [`ModuleProject::listen`].
    reactions: std::sync::Mutex<HashMap<String, Reaction>>,
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

    /// The name as a Project's folder takes it; on Windows, not one that
    /// Windows refuses for a folder.
    pub(crate) fn plain_name(name: &str) -> Result<&str, Refusal> {
        let plain = crate::plain_name(name).ok_or_else(|| {
            Refusal::invalid(
                "A Project's name is 1 to 64 characters, with no slashes and no leading dot.",
            )
        })?;
        match crate::host::refused_name(plain) {
            Some(why) => Err(Refusal::invalid(why)),
            None => Ok(plain),
        }
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
        let tables: Vec<_> = modules.iter().map(|m| Tables::of(&**m)).collect();
        let path = data.join(DATABASE);
        let store = tokio::task::spawn_blocking(move || Store::open(&path, &tables))
            .await
            .map_err(|_| Error::Closed)??;
        for off in store.off() {
            tracing::error!(
                module = off.module, data = %data.display(), why = %off.words(),
                "a module is turned off in a Project: its tables did not come up to date"
            );
        }
        // The window stands on the machine's modules, so its scope opens
        // with all of them or not at all, before any of them is told.
        if projects.is_some()
            && let Some(off) = store.off().first()
        {
            let words = format!("{} did not start. {}", off.module, off.words());
            return Err(Refusal::conflict(words).into());
        }
        // What is turned off here runs nothing here: no call, no effect,
        // no listener, and it is told of nothing.
        let modules: Arc<[_]> = (modules.iter())
            .filter(|module| store.off_of(module.name()).is_none())
            .cloned()
            .collect();
        let project = Arc::new(Project {
            id: manifest.id,
            moving: Default::default(),
            reached: Default::default(),
            data,
            manifest: std::sync::Mutex::new(manifest),
            removed: Default::default(),
            owner,
            store,
            modules: std::sync::RwLock::new(modules),
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
        for module in project.modules().iter() {
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

    /// Whether it was removed, and is deleted as it closes.
    pub(crate) fn removed(&self) -> bool {
        self.removed.lock().unwrap().is_some()
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

    /// Whether the Person said they trust it
    /// ([`ProjectSummary::trust_said`]).
    pub fn trust_said(&self) -> bool {
        let manifest = self.manifest.lock().unwrap();
        !manifest.untrusted && manifest.trust_said
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
        drop(file);
        crate::host::rename(&pending, &journal)?;
        // No watch holds the folder as it moves: Windows moves no folder
        // that one holds, and elsewhere one would hear it by its old name.
        let released = crate::watching::let_go_under(&manifest.folder);
        if let Err(error) = crate::host::move_folder(&manifest.folder, target) {
            // It stayed, and is watched again.
            drop(released);
            std::fs::remove_file(&journal)?;
            return Err(
                Refusal::conflict(format!("The folder could not be moved: {error}")).into(),
            );
        }
        released.moved();
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

    /// The listener `key` of this log, handled up to `after`: an effect
    /// that waits for the reactions ([`ModuleProject::reacted`]) waits for
    /// it until its sender says it handled more, or is dropped, or `home`,
    /// the Project of the module that listens, closes. Refused as
    /// `conflict` while another listener hears this log under its key.
    pub(crate) fn listening(
        &self,
        key: &str,
        after: i64,
        home: Option<watch::Receiver<()>>,
    ) -> Result<watch::Sender<i64>, Refusal> {
        let mut reactions = self.reactions.lock().unwrap();
        reactions.retain(|_, reaction| reaction.live());
        if reactions.contains_key(key) {
            return Err(Refusal::conflict(format!(
                "The listener {key} hears this log already: one name is one listener."
            )));
        }
        let (handled, reaction) = watch::channel(after);
        let reaction = Reaction {
            handled: reaction,
            home,
        };
        reactions.insert(key.to_owned(), reaction);
        Ok(handled)
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

    /// The modules that run here now: every one of its scope but those
    /// turned off here ([`Project::available`]).
    pub(crate) fn modules(&self) -> Arc<[Arc<dyn Module>]> {
        self.modules.read().unwrap().clone()
    }

    /// The module `name` as this Project runs it now; none when it is
    /// turned off here, or was taken away. One put in another's place
    /// while the engine runs is each Project's as that Project took it,
    /// so a call here never runs the old one over tables the new one's
    /// steps changed.
    pub(crate) fn serving(&self, name: &str) -> Option<Arc<dyn Module>> {
        let here = self.modules.read().unwrap();
        here.iter().find(|had| had.name() == name).cloned()
    }

    /// Takes `module`, added while the engine runs, or put in the place of
    /// the one of its name: its tables come up to date here
    /// ([`Store::add`]), and it is told it opened, as when the Project
    /// does. One it replaces has ended its calls here first, and none
    /// begins meanwhile: a module new here waits for nothing. Why it is
    /// turned off here, when its tables do not come up to date or it does
    /// not open.
    pub(crate) async fn add(self: &Arc<Self>, module: &Arc<dyn Module>) -> Option<String> {
        let name = module.name();
        let _still = match self.serving(name) {
            Some(_) => Some(self.moving.write().await),
            None => None,
        };
        let taken = async {
            if let Some(off) = self.store.add(Tables::of(&**module)).await? {
                return Ok::<_, Error>(Some(off.words()));
            }
            module.opened(self.module(name)).await?;
            Ok(None)
        };
        let off = match taken.await {
            Ok(off) => off,
            Err(error) => Some(Refusal::from(error).message),
        };
        let mut modules = self.modules.write().unwrap();
        let others = modules.iter().filter(|had| had.name() != name).cloned();
        match &off {
            None => {
                *modules = others.chain([module.clone()]).collect();
                // What waited while it was off, or not there, may run.
                self.store.outbox_signal().notify_one();
            }
            Some(why) => {
                *modules = others.collect();
                tracing::error!(
                    module = name, project = %self.id, why,
                    "a module added is turned off in a Project"
                );
            }
        }
        off
    }

    /// Lets go of the module `name`, taken away while the engine runs,
    /// once its calls here have ended: it runs nothing here from then,
    /// and what it kept stays.
    pub(crate) async fn remove(&self, name: &str) {
        let _still = self.moving.write().await;
        let mut modules = self.modules.write().unwrap();
        *modules = (modules.iter())
            .filter(|had| had.name() != name)
            .cloned()
            .collect();
    }

    /// Refuses `app_unavailable`, with why, when `module` is turned off
    /// here: its tables did not come up to date as this opened.
    pub(crate) fn available(&self, module: &str) -> Result<(), Refusal> {
        match self.store.off_of(module) {
            None => Ok(()),
            Some(off) => Err(Refusal::app_unavailable(format!(
                "{module} is turned off in this Project. {}",
                off.words()
            ))),
        }
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
                if let Err(error) = crate::host::remove_all(&data) {
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

/// How far one listener of a Project's log has reacted, while it listens.
struct Reaction {
    handled: watch::Receiver<i64>,
    /// Whether the Project of the module that listens is open, when it
    /// hears another scope's log.
    home: Option<watch::Receiver<()>>,
}

impl Reaction {
    /// It reacts no more once its listener is gone or ended, or the
    /// Project of its module closed.
    fn live(&self) -> bool {
        self.handled.has_changed().is_ok()
            && (self.home.as_ref()).is_none_or(|home| home.has_changed().is_ok())
    }
}

/// A Project as one module sees it: it writes under that module's name, so
/// it emits only that module's events.
#[derive(Clone)]
pub struct ModuleProject {
    project: Arc<Project>,
    module: &'static str,
}

/// A [`ModuleProject`] held weakly ([`ModuleProject::downgrade`]): it
/// keeps no Project open.
#[derive(Clone)]
pub struct WeakModuleProject {
    project: std::sync::Weak<Project>,
    module: &'static str,
}

impl WeakModuleProject {
    /// The Project as its module sees it, while it is open.
    pub fn upgrade(&self) -> Option<ModuleProject> {
        Some(ModuleProject {
            project: self.project.upgrade()?,
            module: self.module,
        })
    }
}

impl ModuleProject {
    pub fn id(&self) -> ProjectId {
        self.project.id
    }

    /// This Project held weakly, for what a module keeps of it past one
    /// call, in a task or a cache of its own. A strong hold there keeps the
    /// Project open after it is removed or let go of, its store, its lock
    /// and its listeners too, until the engine stops.
    pub fn downgrade(&self) -> WeakModuleProject {
        WeakModuleProject {
            project: Arc::downgrade(&self.project),
            module: self.module,
        }
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

    /// Whether the Person said they trust the Project
    /// ([`ProjectSummary::trust_said`]): only then do its Harnesses' programs
    /// get the Person's GitHub token (ADR 0083).
    pub fn trust_said(&self) -> bool {
        self.project.trust_said()
    }

    /// The Project's name as the Person sees it; empty for one in No
    /// Project.
    pub fn name(&self) -> String {
        self.project.manifest.lock().unwrap().name.clone()
    }

    /// Whether it is one Thread's Project, in No Project (ADR 0046).
    pub fn scratch(&self) -> bool {
        self.project.scratch()
    }

    /// The same module in `other`, as a call that reaches it from this
    /// Project sees it ([`Call::other`](crate::Call::other)).
    /// Refused when the module is turned off there.
    pub(crate) fn beside(&self, other: Arc<Project>) -> Result<ModuleProject, Refusal> {
        other.available(self.module)?;
        Ok(ModuleProject {
            project: other,
            module: self.module,
        })
    }

    /// Where the Project's programs run (ADR 0084): a module starts each
    /// one there, never by itself. The machine's scope has the engine's,
    /// for what its modules start.
    pub fn environment(&self) -> Arc<dyn Environment> {
        self.project.environment.clone()
    }

    /// A new pass that names `agent` in this Project, and works only in it:
    /// for a session's `banda mcp` and shell, which names the session's
    /// `thread`, or for the shells of a Harness process's Agents, which
    /// names none (ADR 0019, decision 2; ADR 0083, decision 2). A call
    /// under it reads the Thread as [`Call::thread`](crate::Call::thread),
    /// and what `runs` the process or session, an Agent's Harness entry,
    /// as [`Call::runs`](crate::Call::runs). Its session holds it, and
    /// lets it go as it ends: dropped, it is revoked.
    pub fn pass(
        &self,
        agent: AgentId,
        thread: Option<Uuid>,
        runs: Option<&str>,
    ) -> Result<Pass, Error> {
        self.project
            .passes
            .issue(agent, self.project.id, thread, runs)
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

    /// This module's listener `name` of this scope's log: every module's
    /// events that match `filter`, from where it last acked, and then each
    /// as it is committed (ADR 0082, decision 6). How a module reacts to
    /// what another did, as git keeps a checkpoint as a turn starts (ADR
    /// 0034). A listener new to the log hears from now on. Its reaction
    /// acks each fact in the transaction that writes it
    /// ([`Listener::ack`]), so it runs once; or, its work outside the
    /// store, once that is done ([`Listener::ack_through`]), so after a
    /// crash it may run again, and looks before it acts. After a restart
    /// it hears again only what it did not ack. An effect that waits for
    /// the reactions ([`ModuleProject::reacted`]) waits until it has
    /// handled each one before. `name` is lowercase letters, digits and
    /// dashes, fixed in the module's code, and names what it does: another
    /// name is another listener, which starts from the head. A second
    /// listener under a name that hears already is refused as `conflict`.
    pub async fn listen(&self, name: &'static str, filter: EventFilter) -> Result<Listener, Error> {
        self.listen_from(name, filter, None).await
    }

    /// [`ModuleProject::listen`], begun at `carried` when the listener has
    /// no cursor yet: where the module heard up to with a cursor of its
    /// own, from before the kernel kept them, so no fact is heard twice or
    /// lost as it moves over.
    pub async fn listen_from(
        &self,
        name: &'static str,
        filter: EventFilter,
        carried: Option<i64>,
    ) -> Result<Listener, Error> {
        let cursor = Cursor::new(self.module, name, self.project.id, None)?;
        Listener::begin(&self.project, cursor, filter, carried, None).await
    }

    /// This module's listener `name` of this machine's log: its events that
    /// match `filter`, as [`ModuleProject::listen`] hears this scope's. How
    /// a module of a Project reacts to what this computer did, as `agents`
    /// lets go of its Harness processes after a sign-in (ADR 0040, decision
    /// 3). Its cursor is kept in the machine's store, beside the log it
    /// reads, so what it writes in this Project goes through
    /// [`Listener::once`], and work outside any store acks by itself. The
    /// machine's [`ModuleProject::reacted`] waits for it. It ends as this
    /// Project closes, and its cursor goes as this Project is removed.
    /// None for a module of the machine, or while the engine has none.
    pub async fn listen_to_machine(
        &self,
        name: &'static str,
        filter: EventFilter,
    ) -> Result<Option<Listener>, Error> {
        let Some(machine) = &self.project.machine else {
            return Ok(None);
        };
        let cursor = Cursor::new(self.module, name, machine.id, Some(&self.project))?;
        let home = Some(self.project.open.subscribe());
        let listener = Listener::begin(machine, cursor, filter, None, home).await?;
        Ok(Some(listener))
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
        let reactions: Vec<_> = {
            let mut reactions = self.project.reactions.lock().unwrap();
            reactions.retain(|_, reaction| reaction.live());
            let handled = reactions.values().map(|reaction| &reaction.handled);
            handled.cloned().collect()
        };
        let all = async {
            for mut reaction in reactions {
                let _ = reaction.wait_for(|handled| *handled >= at).await;
            }
        };
        tokio::time::timeout(within, all).await.is_ok()
    }

    /// A read of this module's own tables, on the Project's reader
    /// connection: SQL that reaches another table is refused.
    pub async fn read<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.project.store.read_as(self.module, query).await
    }

    /// Reads a view of this module's own tables together with the log
    /// position it is current at, in one read transaction. A window shows
    /// the view, then follows the events after that position (ADR 0002,
    /// decision 5).
    pub async fn view<T: Send + 'static>(
        &self,
        query: impl FnOnce(&rusqlite::Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<(i64, T), Error> {
        self.project.store.view(self.module, query).await
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
