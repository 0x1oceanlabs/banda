use crate::access::{self, Caller, Right};
use crate::cursors;
use crate::environment::{Environment, Nowhere};
use crate::foreign::{self, Foreign};
use crate::methods::{Asks, Kind, Nothing, Tool, needs_command_id};
use crate::module::{Call, Module, Scope, Stream, Wall};
use crate::outbox::Boot;
use crate::passes::{self, Audience, Passes};
use crate::project::{self, GONE, Manifest, Project, Said, SaidBy, Shared, UNFINISHED};
use crate::sign::{self, Kept, Picked, Sign, SignPick};
use crate::store::{Answer, Begun};
use crate::window::Window;
use crate::{AgentId, CommandId, Error, Named, Participant, PersonId, ProjectId, Refusal};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc, watch};
use ts_rs::TS;

/// The Projects of this machine and the modules that serve them.
pub struct Kernel {
    root: PathBuf,
    /// `projects/` in the engine's data: one folder per Project.
    projects_data: PathBuf,
    owner: PersonId,
    /// This boot of the engine. Outbox rows the engine claimed under another
    /// boot were cut short by a restart; workers' leases run on its clock.
    boot: Boot,
    modules: Arc<[Arc<dyn Module>]>,
    /// The modules each Project runs: those of the Project's scope.
    in_projects: Arc<[Arc<dyn Module>]>,
    projects: Projects,
    /// Held while a Project is added, so one folder never becomes two.
    adding: tokio::sync::Mutex<()>,
    /// This machine's scope (ADR 0025, decision 1): a store and a log like
    /// a Project's, for the modules of the machine. None while no module is.
    machine: Option<Arc<Project>>,
    passes: Arc<Passes>,
    /// The road from a module to the window (ADR 0029).
    window: Arc<Window>,
    /// Where the Projects' programs run (ADR 0084).
    environment: Arc<dyn Environment>,
    /// The tools of the modules in Projects, made once as it opens.
    tools: Vec<Tool>,
    /// What this host is called and drawn by, as it is now; none when the
    /// engine names it nothing.
    named: Option<watch::Receiver<Named>>,
}

/// One of a session's queues of commands, by the scope they run in
/// ([`Kernel::queue`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Queue {
    Machine,
    Project(ProjectId),
}

/// Every Project the engine knows. The machine's own scope holds them too,
/// so a module of the machine can count them (ADR 0040, decision 3).
pub(crate) type Projects = Arc<RwLock<BTreeMap<ProjectId, Entry>>>;

/// A Project the engine knows: open, or waiting for its folder.
#[derive(Clone)]
pub(crate) enum Entry {
    Open(Arc<Project>),
    /// Its folder was gone as the engine started (ADR 0026, decision 6):
    /// listed, `missing`, but not open, until the Person locates it.
    Missing {
        data: PathBuf,
        manifest: Box<Manifest>,
    },
}

impl Entry {
    fn summary(&self) -> ProjectSummary {
        match self {
            Entry::Open(project) => project.summary(),
            Entry::Missing { manifest, .. } => manifest.summary(true),
        }
    }

    fn scratch(&self) -> bool {
        match self {
            Entry::Open(project) => project.scratch(),
            Entry::Missing { manifest, .. } => manifest.scratch,
        }
    }

    fn folder(&self) -> PathBuf {
        match self {
            Entry::Open(project) => project.folder(),
            Entry::Missing { manifest, .. } => manifest.folder.clone(),
        }
    }

    /// Where Banda keeps the Project's data.
    fn data(&self) -> PathBuf {
        match self {
            Entry::Open(project) => project.data().to_owned(),
            Entry::Missing { data, .. } => data.clone(),
        }
    }

    /// The picture its sign keeps, found or picked.
    fn picture(&self) -> Option<Kept> {
        match self {
            Entry::Open(project) => project.picture(),
            Entry::Missing { manifest, .. } => manifest.picture.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectSummary {
    pub id: ProjectId,
    pub name: String,
    /// Where the Project's folder is on this machine.
    pub folder: String,
    /// Pinned Projects come first in the Project pickers.
    pub pinned: bool,
    /// Hidden from the Project pickers; its Threads and files are kept.
    pub archived: bool,
    /// Its Agents see the other Projects' Panes (ADR 0032). Only the Person
    /// sets it.
    pub sees_others: bool,
    /// One Thread's Project, in No Project (ADR 0046): its name is empty, and
    /// the Project pickers leave it out.
    pub scratch: bool,
    /// Its folder was gone as the engine started: none of its Threads
    /// open until the Person locates it (`projects.locate`).
    pub missing: bool,
    /// What stands for it beside its name (ADR 0070).
    pub sign: Sign,
    /// Its Harnesses load the settings, hooks and MCP servers its folder
    /// names for them; while it is not trusted, only the Person's own (ADR
    /// 0083, decision 5). Only the Person changes it (`projects.trust`).
    pub trusted: bool,
    /// The Person said they trust it: in the trust step as they added it,
    /// or with `projects.trust` later. One trusted only as nothing marked it
    /// foreign was not said so. Its Harnesses' programs get the Person's
    /// GitHub token only then, as `GH_TOKEN` (ADR 0083).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub trust_said: bool,
}

pub struct KernelBuilder {
    root: PathBuf,
    data: PathBuf,
    owner: PersonId,
    modules: Vec<Arc<dyn Module>>,
    machine: Option<PathBuf>,
    environment: Arc<dyn Environment>,
    passes: Option<PathBuf>,
    pass_term: std::time::Duration,
    named: Option<watch::Receiver<Named>>,
}

impl KernelBuilder {
    pub fn module(mut self, module: impl Module) -> Self {
        self.modules.push(Arc::new(module));
        self
    }

    /// The folder that keeps this machine's scope, made on first use: the
    /// engine's state folder's `machine`. A module of the machine needs it.
    pub fn machine(mut self, folder: impl Into<PathBuf>) -> Self {
        self.machine = Some(folder.into());
        self
    }

    /// Where every Project's programs run, and the machine's (ADR 0084):
    /// with none, the kernel's modules start no program.
    pub fn environment(mut self, environment: impl Environment) -> Self {
        self.environment = Arc::new(environment);
        self
    }

    /// The file that keeps this host's passes, hashed: the engine's state
    /// folder's `passes.sqlite3`. Without it, the data folder's.
    pub fn passes(mut self, file: impl Into<PathBuf>) -> Self {
        self.passes = Some(file.into());
        self
    }

    /// How long a pass lasts past the last renewal of the session that
    /// held it, instead of an hour ([`passes::TERM`]).
    pub fn pass_term(mut self, term: std::time::Duration) -> Self {
        self.pass_term = term;
        self
    }

    /// What this host is called and drawn by, as it is each time a client
    /// says `hello` or hears `machine.named`: the module that names it
    /// keeps it current.
    pub fn named(mut self, named: watch::Receiver<Named>) -> Self {
        self.named = Some(named);
        self
    }

    /// Opens every Project the data holds, once the old Projects under the root
    /// have moved theirs out (ADR 0026). A Project that fails to open is
    /// logged and left closed, so it cannot keep the others shut.
    pub async fn open(self) -> Result<Arc<Kernel>, Error> {
        for (index, module) in self.modules.iter().enumerate() {
            let name = module.name();
            let valid = !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase());
            if !valid || OWN.contains(&name) || name == crate::store::KERNEL {
                return Err(
                    Refusal::invalid(format!("\"{name}\" cannot be a module's name.")).into(),
                );
            }
            if self.modules[..index].iter().any(|m| m.name() == name) {
                return Err(Refusal::invalid(format!("Two modules are named \"{name}\".")).into());
            }
        }
        crate::tables::check(&self.modules)?;
        std::fs::create_dir_all(&self.root)?;
        let projects_data = self.data.join("projects");
        crate::old::from_spaces(&self.data, &projects_data, self.machine.as_deref());
        std::fs::create_dir_all(&projects_data)?;
        crate::old::move_out(&self.root, &projects_data);
        let (of_machine, in_projects): (Vec<_>, Vec<_>) =
            (self.modules.iter().cloned()).partition(|module| module.scope() == Scope::Machine);
        let boot = Boot::new();
        let passes_file = (self.passes.clone()).unwrap_or_else(|| self.data.join(PASSES));
        let term = self.pass_term;
        let passes = tokio::task::spawn_blocking(move || Passes::open(&passes_file, term))
            .await
            .map_err(|_| Error::Closed)??;
        tokio::spawn(passes::renewing(Arc::downgrade(&passes)));
        let window = Arc::<Window>::default();
        let projects = Projects::default();
        let machine = if of_machine.is_empty() {
            None
        } else {
            let folder = self.machine.as_ref().ok_or_else(|| {
                Refusal::invalid("A module of this machine needs the machine's folder.")
            })?;
            // Its data is its folder: it holds no work of its own.
            let manifest = match Manifest::read(folder) {
                Ok(manifest) => manifest,
                Err(_) => {
                    let author = Participant::Person(self.owner);
                    let made = Manifest::new(folder, "machine", author, CommandId::new());
                    std::fs::create_dir_all(folder)?;
                    made.write(folder)?;
                    made
                }
            };
            let (modules, data) = (of_machine.into(), folder.clone());
            let engine = Shared {
                owner: self.owner,
                passes: passes.clone(),
                window: window.clone(),
                environment: self.environment.clone(),
                machine: None,
                projects: Some(Arc::downgrade(&projects)),
            };
            Some(Project::open(data, manifest, modules, engine, &boot).await?)
        };
        let kernel = Arc::new(Kernel {
            root: self.root,
            projects_data,
            owner: self.owner,
            boot,
            tools: self.modules.iter().flat_map(|m| m.tools()).collect(),
            modules: self.modules.into(),
            in_projects: in_projects.into(),
            projects,
            adding: Default::default(),
            machine,
            passes,
            window,
            environment: self.environment,
            named: self.named,
        });
        let mut found: Vec<PathBuf> = std::fs::read_dir(&kernel.projects_data)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        found.sort();
        // The Projects here when the fence came: their trust is said once,
        // for the store, and never for one found later.
        let upgrading = crate::old::upgrading(&self.data);
        let mut folders: HashMap<PathBuf, PathBuf> = Default::default();
        for data in found {
            let name = data.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(UNFINISHED) || name.ends_with(GONE) {
                // Cut short while it was written, it never was a Project; or
                // it was removed before its data was all gone.
                let _ = std::fs::remove_dir_all(&data);
                continue;
            }
            // A Space's files take their names first; left as they were, the
            // Project waits for the next start (ADR 0069, for good).
            let mut manifest =
                match crate::old::rename_files(&data).and_then(|()| Manifest::read(&data)) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        tracing::error!(data = %data.display(), %error, "a Project did not open");
                        continue;
                    }
                };
            if upgrading {
                crate::old::said_before_fence(&data, &mut manifest);
            }
            if let Some(kept) = folders.get(&manifest.folder) {
                tracing::warn!(
                    folder = %manifest.folder.display(),
                    kept = %kept.display(),
                    skipped = %data.display(),
                    "two Projects name the same folder; the second stays closed"
                );
                continue;
            }
            folders.insert(manifest.folder.clone(), data.clone());
            if !manifest.folder.is_dir() {
                tracing::warn!(
                    folder = %manifest.folder.display(),
                    "a Project's folder is gone; it waits to be located"
                );
                let id = manifest.id;
                let missing = Entry::Missing {
                    data,
                    manifest: Box::new(manifest),
                };
                kernel.projects.write().await.insert(id, missing);
                continue;
            }
            match kernel.open_project(data.clone(), manifest).await {
                Ok(project) => {
                    let id = project.id();
                    kernel
                        .projects
                        .write()
                        .await
                        .insert(id, Entry::Open(project));
                }
                Err(error) => {
                    tracing::error!(data = %data.display(), %error, "a Project did not open")
                }
            }
        }
        if upgrading {
            crate::old::upgraded(&self.data);
        }
        kernel.find_signs();
        Ok(kernel)
    }
}

crate::methods! {
    Kernel(Own<'_>) as "ProjectsMethods" in "./" {
        /// This computer's Projects.
        call list(Nothing) -> Vec<ProjectSummary>, Read;
        /// Makes a Project: a new folder under the root, by its name. A
        /// scratch one, for a Thread in No Project, takes no name: its folder
        /// is new under `scratch/`, and it is trusted. A named one is
        /// trusted as `trusted` says, or else unless its folder looks
        /// foreign (`projects.foreign`).
        command create(CreateProject) -> ProjectSummary, Manage;
        /// Adds a folder as a Project. A folder that already is one answers
        /// that Project, back from the archive if it was there. A new one is
        /// trusted as `trusted` says, or else unless its folder looks
        /// foreign (`projects.foreign`).
        command add(AddProject) -> ProjectSummary, Manage;
        /// The folders that match a path as it is typed, for the field
        /// that picks a Project's folder. Only the owner browses.
        call browse(Browse) -> Browsed, Manage;
        /// Whether a folder looks foreign, and why, for Add Project to ask
        /// whether to trust it (ADR 0084, decision 13); one not made yet,
        /// as it will be. It names the Project the folder already is.
        call foreign(OneFolder) -> Foreign, Manage;
        /// Trusts a Project, or takes its trust back, from its Harnesses'
        /// next turn. Only the Person trusts; a scratch Project always is.
        command trust(TrustProject) -> ProjectSummary, Manage;
        /// Renames, pins or archives a Project, lets its Agents see the
        /// other Projects' Panes, or makes a Project of a scratch one, named.
        command update(UpdateProject) -> ProjectSummary, Manage;
        /// Names the folder a missing Project's work is in now, and opens
        /// the Project there.
        command locate(LocateProject) -> ProjectSummary, Manage;
        /// Forgets a Project and deletes its Threads; its folder and the
        /// files in it stay as they are.
        command remove(OneProject) -> (), Manage;
        /// The tools an Agent may call, from the methods of the modules.
        call tools(Nothing) -> Vec<Tool>, Read;
        /// The picture a Project's sign shows, as a `data:` URL; none when
        /// it shows none (ADR 0070). A window keeps it by the sign's version
        /// (`sign.text`) and asks again only when that changes.
        call sign(OneProject) -> Option<String>, Read;
        /// Looks in a Project's folder for its sign's picture again.
        command find_sign(OneProject) -> ProjectSummary, Manage;
    }
}

/// Who calls one of the kernel's own methods, and under which command.
struct Own<'a> {
    participant: Participant,
    method: &'a str,
    only: Option<ProjectId>,
    command: Option<CommandId>,
}

impl Asks for Own<'_> {
    fn command_id(&self) -> Result<CommandId, Refusal> {
        self.command.ok_or_else(|| needs_command_id(self.method))
    }
}

#[derive(Deserialize, TS)]
struct CreateProject {
    /// The Project's name, and its folder's. None for a scratch Project.
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    /// A Project for one Thread in No Project (ADR 0046).
    #[serde(default)]
    #[ts(optional)]
    scratch: Option<bool>,
    /// Whether it is trusted (`ProjectSummary`); a new folder is, unless
    /// said or its folder looks foreign. A scratch Project always is.
    #[serde(default)]
    #[ts(optional)]
    trusted: Option<bool>,
}

#[derive(Deserialize, TS)]
struct AddProject {
    /// Absolute, or from the home folder: `~/code/app`.
    folder: String,
    /// The folder's name when none is given.
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    /// Makes the folder, and the folders above it, when it does not exist.
    #[serde(default)]
    #[ts(optional)]
    create: Option<bool>,
    /// Whether it is trusted (`ProjectSummary`). Not said, a folder that
    /// already is a Project keeps its own, and of another, one that looks
    /// foreign is not trusted.
    #[serde(default)]
    #[ts(optional)]
    trusted: Option<bool>,
}

#[derive(Deserialize, TS)]
struct Browse {
    /// The path as typed: absolute, or from the home folder. One that ends
    /// in `/` lists that folder; another lists the folders beside it whose
    /// names start with its last part.
    partial: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Browsed {
    /// The folder the entries are in.
    pub parent: String,
    /// Whether the path as typed is a folder already: "Add" it, or else
    /// "Create & Add".
    pub exists: bool,
    /// Its subfolders that match, by name. Hidden ones only once a dot is
    /// typed.
    pub entries: Vec<BrowsedFolder>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct BrowsedFolder {
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, TS)]
struct UpdateProject {
    project: ProjectId,
    #[serde(default)]
    #[ts(optional)]
    name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pinned: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    archived: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    sees_others: Option<bool>,
    /// `false` makes a Project of a scratch one, which needs a name then.
    /// No Project takes no Project back.
    #[serde(default)]
    #[ts(optional)]
    scratch: Option<bool>,
    /// Move a scratch Project's folder here when promoting it. Omit to keep it.
    #[serde(default)]
    #[ts(optional)]
    folder: Option<String>,
    /// The sign the Person picks; `null` goes back to what Banda finds
    /// (ADR 0070).
    #[serde(default, deserialize_with = "present")]
    #[ts(optional = nullable, as = "Option<SignPick>")]
    sign: Option<Option<SignPick>>,
}

/// A key given, `null` too, as `Some`; left out, `None`, by `default`.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, TS)]
struct LocateProject {
    project: ProjectId,
    /// Where its folder is now: absolute, or from the home folder.
    folder: String,
}

#[derive(Deserialize, TS)]
struct OneProject {
    project: ProjectId,
}

#[derive(Deserialize, TS)]
struct OneFolder {
    /// Absolute, or from the home folder.
    folder: String,
}

#[derive(Deserialize, TS)]
struct TrustProject {
    project: ProjectId,
    trusted: bool,
}

/// The most folders `projects.browse` answers.
const BROWSED: usize = 200;

/// The file that keeps the passes when the engine names none.
const PASSES: &str = "passes.sqlite3";

/// Why the scratch Project of a Thread in No Project is never untrusted.
const SCRATCH_TRUSTED: &str = "A Thread in No Project is trusted: its folder is Banda's own.";

/// Where the scratch Projects' folders go, under the root (ADR 0046).
const SCRATCH: &str = "scratch";

/// A pass is for its Project, so it stops at this machine's scope but for
/// the tools (ADR 0032).
fn outside_machine() -> Refusal {
    Refusal::forbidden("An Agent's pass is for its Project, not this machine.")
}

/// The prefixes of the kernel's own methods, which no module takes:
/// `projects.*`, and the window's road (ADR 0029, decision 2).
const OWN: [&str; 2] = ["projects", "window"];

/// What a pick makes of a Project's sign, and the picture it keeps in
/// `data` when it picks one: checked and kept before the manifest names it.
fn picked(data: &Path, pick: SignPick) -> Result<(Picked, Option<Kept>), Refusal> {
    let plain = |text: &str, what: &str, most: usize| -> Result<String, Refusal> {
        let text = text.trim();
        match text.chars().count() {
            0 => Err(Refusal::invalid(format!("A sign's {what} is not empty."))),
            n if n > most => Err(Refusal::invalid(format!(
                "A sign's {what} is at most {most} long."
            ))),
            _ => Ok(text.to_owned()),
        }
    };
    Ok(match pick {
        SignPick::Emoji { emoji } => (
            Picked::Emoji {
                emoji: plain(&emoji, "emoji", 8)?,
            },
            None,
        ),
        SignPick::Icon { icon, color } => {
            let icon = plain(&icon, "icon", 40)?;
            let lucide = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
            if !icon.chars().all(lucide) {
                return Err(Refusal::invalid(
                    "A sign's icon is a Lucide name, as pen-line.",
                ));
            }
            (Picked::Icon { icon, color }, None)
        }
        SignPick::Letters { letters, color } => {
            let letters = plain(&letters, "letters", 2)?.to_uppercase();
            (Picked::Letters { letters, color }, None)
        }
        SignPick::Picture { picture, kind } => {
            let bytes = sign::decoded(&picture).map_err(Refusal::invalid)?;
            sign::fits(kind, &bytes).map_err(Refusal::invalid)?;
            let kept = sign::keep(data, kind, &bytes, None).map_err(Error::from)?;
            (Picked::Picture { picture: true }, Some(kept))
        }
    })
}

/// A method of the kernel's own `projects.*` without its prefix, or of
/// `spaces.*`, their name before ADR 0069 (grace).
fn own_method(method: &str) -> Option<&str> {
    (method.strip_prefix("projects.")).or_else(|| method.strip_prefix("spaces."))
}

/// The stream of what this host is called and drawn by (ADR 0095,
/// decision 2): a stream of the machine's, as `window.requests` is, so it
/// is there whatever modules run.
const NAMED: &str = "machine.named";

/// What `named` is now, then again each time it changes, until the one
/// who hears it stops.
fn named_stream(mut named: watch::Receiver<Named>) -> Stream {
    let (send, hear) = mpsc::channel(1);
    tokio::spawn(async move {
        loop {
            let now = serde_json::to_value(&*named.borrow_and_update());
            let Ok(now) = now else { break };
            if send.send(now).await.is_err() {
                break;
            }
            tokio::select! {
                changed = named.changed() => if changed.is_err() { break },
                () = send.closed() => break,
            }
        }
    });
    hear
}

fn no_method(method: &str) -> Refusal {
    Refusal::invalid(format!("There is no method \"{method}\"."))
}

impl Kernel {
    /// `root` is where a new Project's folder goes (`~/Banda` by default),
    /// and `data` where Banda keeps the Projects' own data
    /// (`~/.local/share/banda`, ADR 0026). `owner` is the Person who owns
    /// this computer's Projects.
    pub fn builder(
        root: impl Into<PathBuf>,
        data: impl Into<PathBuf>,
        owner: PersonId,
    ) -> KernelBuilder {
        KernelBuilder {
            root: root.into(),
            data: data.into(),
            owner,
            modules: Vec::new(),
            machine: None,
            environment: Arc::new(Nowhere),
            passes: None,
            pass_term: passes::TERM,
            named: None,
        }
    }

    pub fn owner(&self) -> PersonId {
        self.owner
    }

    /// The names of the modules this engine runs: what a window may use.
    pub fn modules(&self) -> Vec<&'static str> {
        self.modules.iter().map(|m| m.name()).collect()
    }

    /// The Agent a pass names and the Project it works in, when the API
    /// takes it, or `None`.
    pub fn holder(&self, pass: &str) -> Option<(AgentId, ProjectId)> {
        self.passes.holder(pass, Audience::Ws)
    }

    /// The engine stops: the passes its sessions hold get a whole term, for
    /// the sessions that go on past the restart, and none is revoked as
    /// what holds it goes from here on (ADR 0083, decision 2).
    pub fn stopping(&self) {
        self.passes.stopping();
    }

    /// Routes a call: `projects.*` to the kernel, `<module>.*` to that module
    /// in the given Project. Every method passes the Project wall and the
    /// access decision first. A caller with a pass that names no Project
    /// calls in its own. See [`Kernel::answer`] for a command's receipt.
    pub async fn call(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Value, Refusal> {
        let answer = self.answer(caller, method, project, command, params);
        answer.await.map(|answer| answer.value)
    }

    /// Routes a call as [`Kernel::call`] does, and answers a module's
    /// command with its place in the log, `at`.
    ///
    /// Every command keeps a receipt, whatever its handler does (ADR 0082,
    /// decision 4):
    ///
    /// - It is written before the handler runs, and keeps the answer once
    ///   it ends, so a resend gets that answer and runs nothing again. A
    ///   resend while the command runs waits, and gets what the run answers.
    /// - It keeps a hash of the params. The same ID from someone else, for
    ///   another method or with other params, is refused as `conflict`.
    /// - It keeps a value or a final refusal (`Code::is_final`). After a
    ///   passing refusal it is forgotten, so a resend runs, unless the
    ///   command's change was written: then it answers `may_have_run`.
    /// - A run cut short, by a crash or by a caller that went away, leaves
    ///   it unanswered. A resend then gets `may_have_run`, kept as any
    ///   answer is, as the handler may have acted outside the store before
    ///   it ended.
    /// - `at` is a seq of the log of the scope the command ran in: the
    ///   log's head as its change committed, its last fact if it wrote
    ///   one; or, for a command that wrote no change, the log's head as
    ///   its answer was kept. A view current at `at` shows what the
    ///   command did. A refusal carries none: what a run wrote before it
    ///   was refused comes through the log alone. A resend gets the same
    ///   `at`. The router runs a session's commands to one scope in the
    ///   order sent ([`api`](crate::api)), so their `at`s go in that order
    ///   too, but for one that runs on ([`Module::runs_on`]) or hung.
    /// - A receipt is kept thirty days past its last write, as its command
    ///   began or was answered, and while its command runs, however long.
    ///   A resend comes within seven days of the first send, so each finds
    ///   its receipt. Past them the same ID runs as a new command. Today
    ///   those seven days are a convention of Banda's clients; the host
    ///   will check them, refusing a command past its `not_after` (ADR
    ///   0082, decisions 4 and 16), and nothing here checks it yet.
    ///
    /// A `call` keeps no receipt, whatever it changes, so `banda mcp`
    /// never sends one again ([`Tool::kind`](crate::Tool)). The kernel's own
    /// `projects.*` commands are not yet among these: they leave the
    /// kernel with A1 and A2 of the architecture vision.
    pub async fn answer(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Answer, Refusal> {
        let plain = |value| Answer { value, at: None };
        let Caller { participant, only } = caller.into();
        if let Some(own) = method.strip_prefix("window.")
            && let Some(right) = Window::right(own)
        {
            access::decide(&participant, right, self.owner)?;
            return self.window.call(participant, own, params).await.map(plain);
        }
        if let Some(own) = own_method(method)
            && let Some(right) = Self::method_right(own)
        {
            access::within(only, project.or(only))?;
            access::decide(&participant, right, self.owner)?;
            let ask = Own {
                participant,
                method,
                only,
                command,
            };
            return self.dispatch(ask, own, params).await.map(plain);
        }
        let (module, rest, right) = self.method(method)?;
        let kind = module.kind(rest).ok_or_else(|| no_method(method))?;
        let (project, wall) = self.place(&**module, method, project, only).await?;
        let _moving = project.moving.read().await;
        let scope = project.module(module.name());
        if kind != Kind::Command {
            access::decide(&participant, right, project.owner())?;
            let call = Call::new(participant, scope, method.to_owned(), None, wall);
            return module.call(call, rest, params).await.map(plain);
        }
        let command = command.ok_or_else(|| needs_command_id(method))?;
        let receipt = scope.receipt(command, method, participant, &params);
        let running = match project.store().begin(receipt.clone()).await? {
            Begun::Run(running) => running,
            Begun::Answered(answer) => return answer,
        };
        // A refusal made before the handler runs is the command's answer
        // too (ADR 0002, decision 2).
        let answer = match access::decide(&participant, right, project.owner()) {
            Ok(()) => {
                let call = Call::new(participant, scope, method.to_owned(), Some(receipt), wall);
                module.call(call, rest, params).await
            }
            Err(refusal) => Err(refusal),
        };
        project.store().settle(running, answer).await
    }

    /// The queue the router keeps a call from one session in, so the
    /// session's commands to one scope commit in the order sent (ADR 0082,
    /// decision 4): a command's scope, this machine's or a Project's. The
    /// kernel's own `projects.*` are this machine's. `None` for a call or a
    /// stream, which runs as it arrives, as does a command that runs on
    /// ([`Module::runs_on`]). `None` too for what will be refused: a
    /// method there is not, or a Project there is not or outside the
    /// caller's pass, so a client makes no queue, which lasts as long as
    /// its connection, for a Project of its choosing.
    pub(crate) fn queue(
        &self,
        caller: Caller,
        method: &str,
        project: Option<ProjectId>,
    ) -> Option<Queue> {
        if let Some(own) = own_method(method)
            && let Some(kind) = Self::method_kind(own)
        {
            return (kind == Kind::Command).then_some(Queue::Machine);
        }
        let (module, rest, _) = self.method(method).ok()?;
        if module.kind(rest)? != Kind::Command || module.runs_on(rest) {
            return None;
        }
        if module.scope() == Scope::Machine {
            return Some(Queue::Machine);
        }
        let id = project.or(caller.only)?;
        // While the list of Projects changes, a Project goes unchecked.
        let known = (self.projects.try_read()).map_or(true, |all| all.contains_key(&id));
        let within = caller.only.is_none_or(|only| only == id);
        (known && within).then_some(Queue::Project(id))
    }

    /// Opens a module's stream in a Project, or this machine's for a module
    /// of the machine, which names none, once the access decision allows
    /// it. `window.requests` and `machine.named` name none either.
    pub async fn stream(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        project: Option<ProjectId>,
        params: Value,
    ) -> Result<Stream, Refusal> {
        let Caller { participant, only } = caller.into();
        if let Some(own) = method.strip_prefix("window.")
            && let Some(right) = Window::right(own)
        {
            access::decide(&participant, right, self.owner)?;
            return self.window.stream(participant, own, params).await;
        }
        if method == NAMED
            && let Some(named) = &self.named
        {
            access::decide(&participant, Right::Read, self.owner)?;
            return Ok(named_stream(named.clone()));
        }
        let (module, rest, right) = self.method(method)?;
        let (project, wall) = self.place(&**module, method, project, only).await?;
        access::decide(&participant, right, project.owner())?;
        let call = Call::new(
            participant,
            project.module(module.name()),
            method.to_owned(),
            None,
            wall,
        );
        module.stream(call, rest, params).await
    }

    /// The module of `method`, the method without its prefix, and the
    /// right it needs.
    fn method<'a>(&self, method: &'a str) -> Result<(&Arc<dyn Module>, &'a str, Right), Refusal> {
        let (prefix, rest) = method.split_once('.').ok_or_else(|| no_method(method))?;
        let module = self
            .modules
            .iter()
            .find(|m| m.name() == prefix)
            .ok_or_else(|| no_method(method))?;
        let right = module.right(rest).ok_or_else(|| no_method(method))?;
        Ok((module, rest, right))
    }

    /// The Project `caller` follows, once the Project wall and the access
    /// decision allow it.
    pub async fn follow(
        &self,
        caller: impl Into<Caller>,
        project: ProjectId,
    ) -> Result<Arc<Project>, Refusal> {
        let Caller { participant, only } = caller.into();
        let project = match &self.machine {
            Some(machine) if machine.id() == project => {
                // Its log holds every Project's Panes: no pass follows it.
                if only.is_some() {
                    return Err(outside_machine());
                }
                machine.clone()
            }
            _ => {
                access::within(only, Some(project))?;
                self.project(project).await?
            }
        };
        access::decide(&participant, Right::Read, project.owner())?;
        Ok(project)
    }

    /// The ID a window follows this machine's modules by, as a Project's;
    /// none while no module is the machine's. Their streams name it, or
    /// no Project at all.
    pub fn machine(&self) -> Option<ProjectId> {
        self.machine.as_ref().map(|machine| machine.id())
    }

    /// This boot of the engine: another after a restart, which ended every
    /// session of the last.
    pub fn boot(&self) -> &str {
        self.boot.id()
    }

    /// Whether the fence around a Harness's programs holds where the
    /// Projects' programs run, as their environment found it (ADR 0083).
    pub fn fence(&self) -> crate::Fence {
        self.environment.fence()
    }

    /// What this host is called and drawn by now; none when the engine
    /// names it nothing.
    pub fn named(&self) -> Option<Named> {
        (self.named.as_ref()).map(|named| named.borrow().clone())
    }

    /// Where a method of `module` runs. A module of the machine runs in
    /// this machine's scope, and its method names no Project, or the
    /// machine's own ID, as a stream does. Any other runs in the Project it
    /// names, or its caller's pass names, behind the Project wall. A pass
    /// reaches the machine only through its tools, which are handed the
    /// wall they see behind (ADR 0032).
    async fn place(
        &self,
        module: &dyn Module,
        method: &str,
        named: Option<ProjectId>,
        only: Option<ProjectId>,
    ) -> Result<(Arc<Project>, Option<Wall>), Refusal> {
        if module.scope() == Scope::Project {
            let id = named.or(only);
            access::within(only, id)?;
            let id = id.ok_or_else(|| Refusal::invalid(format!("{method} needs a Project.")))?;
            let project = self.project(id).await?;
            // A pass's call is walled in its Project, as the path guard
            // reads it.
            let wall = only.map(|project_id| Wall {
                project: project_id,
                sees_others: project.sees_others(),
            });
            return Ok((project, wall));
        }
        let machine = (self.machine.as_ref())
            .ok_or_else(|| Refusal::not_found("This engine has no machine's scope."))?;
        if named.is_some_and(|id| id != machine.id()) {
            return Err(Refusal::invalid(format!(
                "{method} is this machine's: it names no Project."
            )));
        }
        let wall = match only {
            None => None,
            Some(project) if self.tools.iter().any(|tool| tool.method == method) => {
                let sees_others = self.project(project).await?.sees_others();
                Some(Wall {
                    project,
                    sees_others,
                })
            }
            Some(_) => return Err(outside_machine()),
        };
        Ok((machine.clone(), wall))
    }

    pub async fn project(&self, id: ProjectId) -> Result<Arc<Project>, Refusal> {
        match self.projects.read().await.get(&id) {
            Some(Entry::Open(project)) => Ok(project.clone()),
            Some(Entry::Missing { manifest, .. }) => Err(Refusal::not_found(format!(
                "The folder of the Project \"{}\", {}, is gone: locate it first.",
                manifest.name,
                manifest.folder.display()
            ))),
            None => Err(no_project()),
        }
    }

    /// Every Project, the missing too.
    pub async fn projects(&self) -> Vec<ProjectSummary> {
        let projects = self.projects.read().await;
        let mut summaries: Vec<_> = projects.values().map(Entry::summary).collect();
        sign::lettered(&mut summaries);
        summaries
    }

    /// `one` as `projects` lists it: its letters told apart from the
    /// others' (ADR 0070, decision 2).
    async fn lettered(&self, one: ProjectSummary) -> ProjectSummary {
        let all = self.projects().await;
        all.into_iter().find(|p| p.id == one.id).unwrap_or(one)
    }

    /// Looks for the sign of each open Project, as the engine starts, one
    /// after another, beside everything else (ADR 0070, decision 2). It
    /// holds neither the kernel nor a Project but while it looks, so a
    /// kernel that closes lets go of them at once.
    fn find_signs(self: &Arc<Self>) {
        // Nothing else holds the list as the kernel opens.
        let Ok(projects) = self.projects.try_read() else {
            return;
        };
        let open: Vec<std::sync::Weak<Project>> = (projects.values())
            .filter_map(|entry| match entry {
                Entry::Open(project) => Some(Arc::downgrade(project)),
                Entry::Missing { .. } => None,
            })
            .collect();
        drop(projects);
        let kernel = Arc::downgrade(self);
        tokio::spawn(async move {
            for project in open {
                if kernel.strong_count() == 0 {
                    return;
                }
                // The Project is held only to read and to write, not while
                // its folder is read.
                let Some((folder, name)) = project.upgrade().and_then(|p| p.sign_wanted()) else {
                    continue;
                };
                let found = tokio::task::spawn_blocking(move || sign::find(&folder, &name)).await;
                let (Ok(found), Some(project)) = (found, project.upgrade()) else {
                    continue;
                };
                if let Err(error) = project.keep_sign(found) {
                    tracing::warn!(%error, "a Project's sign was not kept");
                }
            }
        });
    }

    /// Looks for `summary`'s Project's sign now, as one is added or named.
    async fn find_sign_now(&self, summary: ProjectSummary) -> Result<ProjectSummary, Refusal> {
        let Ok(project) = self.project(summary.id).await else {
            return Ok(self.lettered(summary).await);
        };
        let found = tokio::task::spawn_blocking(move || project.find_sign()).await;
        let summary = found.map_err(|_| Refusal::internal())??;
        Ok(self.lettered(summary).await)
    }

    async fn open_project(&self, data: PathBuf, manifest: Manifest) -> Result<Arc<Project>, Error> {
        let engine = Shared {
            owner: self.owner,
            passes: self.passes.clone(),
            window: self.window.clone(),
            environment: self.environment.clone(),
            machine: self.machine.clone(),
            projects: None,
        };
        let modules = self.in_projects.clone();
        Project::open(data, manifest, modules, engine, &self.boot).await
    }

    async fn list(&self, ask: Own<'_>, _: Nothing) -> Result<Vec<ProjectSummary>, Refusal> {
        let mut projects = self.projects().await;
        // A pass sees only its own Project (ADR 0019, decision 2).
        projects.retain(|summary| access::within(ask.only, Some(summary.id)).is_ok());
        Ok(projects)
    }

    async fn tools(&self, _: Own<'_>, _: Nothing) -> Result<Vec<Tool>, Refusal> {
        Ok(self.tools.clone())
    }

    async fn create(&self, ask: Own<'_>, create: CreateProject) -> Result<ProjectSummary, Refusal> {
        let (author, command) = (ask.participant, ask.command_id()?);
        match (create.name, create.scratch == Some(true)) {
            (None, true) if create.trusted == Some(false) => Err(Refusal::invalid(SCRATCH_TRUSTED)),
            (None, true) => self.create_scratch(author, command).await,
            // A new folder holds no picture to find.
            (Some(name), false) => {
                let made = self
                    .create_project(&name, create.trusted, author, command)
                    .await?;
                Ok(self.lettered(made).await)
            }
            (Some(_), true) => Err(Refusal::invalid(
                "A scratch Project has no name until it becomes a Project.",
            )),
            (None, false) => Err(Refusal::invalid("A Project needs a name.")),
        }
    }

    /// A Project for one Thread in No Project: a new folder
    /// `scratch/<date>-<id8>` under the root, by the command, and no name. The same command
    /// again gets the Project it made.
    async fn create_scratch(
        &self,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let projects = self.projects.read().await;
        let made = projects.values().find_map(|entry| match entry {
            Entry::Open(project) if project.command() == command => Some(project.summary()),
            _ => None,
        });
        drop(projects);
        if let Some(made) = made {
            return Ok(made);
        }
        // A UUIDv7 ends in its random part.
        let id = command.to_string();
        let date = crate::utc_date(crate::now_ms());
        let folder = (self.root.join(SCRATCH)).join(format!("{date}-{}", &id[id.len() - 8..]));
        std::fs::create_dir_all(&folder).map_err(Error::from)?;
        let placed = async {
            let mut manifest = Manifest::new(&folder_found(&folder)?, "", author, command);
            manifest.scratch = true;
            self.place_project(manifest).await
        }
        .await;
        if placed.is_err() {
            let _ = std::fs::remove_dir(&folder);
        }
        placed
    }

    /// `projects.add` of a new folder `~/Banda/<name>`; one already there
    /// is refused, unless this command made its Project.
    async fn create_project(
        &self,
        name: &str,
        trusted: Option<bool>,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let name = Project::plain_name(name)?;
        let folder = self.root.join(name);
        if let Ok(canonical) = dunce::canonicalize(&folder) {
            return match self.at(&canonical).await {
                Some(Entry::Open(made)) if made.command() == command => Ok(made.summary()),
                _ => Err(Refusal::conflict(format!(
                    "A folder named \"{name}\" already exists in this place."
                ))),
            };
        }
        self.add_at(&folder, Some(name), true, trusted, author, command)
            .await
    }

    async fn add(&self, ask: Own<'_>, add: AddProject) -> Result<ProjectSummary, Refusal> {
        let command = ask.command_id()?;
        let folder = from_home(&add.folder)?;
        let create = add.create == Some(true);
        let added = (self.add_at(
            &folder,
            add.name.as_deref(),
            create,
            add.trusted,
            ask.participant,
            command,
        ))
        .await?;
        self.find_sign_now(added).await
    }

    /// Adds `folder` as a Project, made first if `create` says so; the
    /// Project it already is comes back from the archive instead. A folder
    /// this call made is taken back when the Project is not. A Project is
    /// trusted as `trusted` says. Not said, a Project that already was
    /// keeps its own, and a new one is trusted unless its folder looks
    /// foreign: one this call made, by the repository it is in.
    async fn add_at(
        &self,
        folder: &Path,
        name: Option<&str>,
        create: bool,
        trusted: Option<bool>,
        author: Participant,
        command: CommandId,
    ) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let made = create && !folder.exists();
        if made {
            std::fs::create_dir_all(folder).map_err(Error::from)?;
        }
        let added = async {
            let canonical = folder_found(folder)?;
            let already = match self.at(&canonical).await {
                Some(Entry::Open(project)) => Some(match project.summary().archived {
                    true => project.change(|manifest| manifest.archived = false)?,
                    false => project.summary(),
                }),
                // Its missing folder is back: the Project opens there again.
                Some(Entry::Missing { manifest, .. }) => {
                    Some(self.open_missing(manifest.id, &canonical).await?)
                }
                None => None,
            };
            if let Some(already) = already {
                return match trusted {
                    Some(trusted)
                        if trusted != already.trusted || trusted != already.trust_said =>
                    {
                        self.trusting(already.id, trusted).await
                    }
                    _ => Ok(already),
                };
            }
            let named = canonical.file_name().map(|n| n.to_string_lossy());
            let name = match (name, &named) {
                (Some(name), _) => name,
                (None, Some(named)) => named,
                (None, None) => "/",
            };
            let name = Project::name_of(name)?;
            let said = trusted == Some(true);
            let trusted = match trusted {
                Some(trusted) => trusted,
                None => !foreign::look(&canonical).await.foreign,
            };
            let mut manifest = Manifest::new(&canonical, name, author, command);
            manifest.untrusted = !trusted;
            manifest.trust_said = said;
            manifest.said = said.then(|| Said::now(SaidBy::Person));
            self.place_project(manifest).await
        }
        .await;
        if made && added.is_err() {
            let _ = std::fs::remove_dir(folder);
        }
        added
    }

    /// The Project whose folder is `folder`, absolute and resolved: open, or
    /// missing it.
    async fn at(&self, folder: &Path) -> Option<Entry> {
        let projects = self.projects.read().await;
        (projects.values())
            .find(|s| crate::host::same(&s.folder(), folder))
            .cloned()
    }

    /// Makes the data of a new Project, whose folder exists, opens it and
    /// lists it.
    async fn place_project(&self, manifest: Manifest) -> Result<ProjectSummary, Refusal> {
        let data = project::place(&self.projects_data, &manifest, |_| Ok(()))?;
        let project = match self.open_project(data.clone(), manifest).await {
            Ok(project) => project,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&data);
                return Err(error.into());
            }
        };
        let summary = project.summary();
        self.projects
            .write()
            .await
            .insert(project.id(), Entry::Open(project));
        Ok(summary)
    }

    /// Opens the missing Project `id` at `folder`, written into its
    /// `project.json`; as it was if it does not open.
    async fn open_missing(&self, id: ProjectId, folder: &Path) -> Result<ProjectSummary, Refusal> {
        let entry = self.projects.read().await.get(&id).cloned();
        let Some(Entry::Missing { data, manifest }) = entry else {
            self.project(id).await?;
            return Err(Refusal::conflict("The Project's folder is not missing."));
        };
        let mut found = manifest.clone();
        found.folder = folder.to_owned();
        found.write(&data)?;
        let project = match self.open_project(data.clone(), *found).await {
            Ok(project) => project,
            Err(error) => {
                let _ = manifest.write(&data);
                return Err(error.into());
            }
        };
        let summary = project.summary();
        let mut projects = self.projects.write().await;
        // Removed while it opened: it stays removed.
        if !matches!(projects.get(&id), Some(Entry::Missing { .. })) {
            return Err(no_project());
        }
        projects.insert(id, Entry::Open(project));
        Ok(summary)
    }

    async fn browse(&self, _: Own<'_>, Browse { partial }: Browse) -> Result<Browsed, Refusal> {
        // By the text: a path ends its `.` and `..` as it reads, not as typed.
        let partial = partial.trim();
        let (parent, prefix) = match partial.rsplit_once('/') {
            Some(("", prefix)) => ("/", prefix),
            Some(split) => split,
            None => (partial, ""),
        };
        let (parent, prefix) = (from_home(parent)?, prefix.to_owned());
        let typed = from_home(partial)?;
        let parent_shown = parent.display().to_string();
        let (exists, entries) =
            tokio::task::spawn_blocking(move || (typed.is_dir(), subfolders(&parent, &prefix)))
                .await
                .map_err(|_| Error::Closed)?;
        Ok(Browsed {
            parent: parent_shown,
            exists,
            entries,
        })
    }

    async fn foreign(
        &self,
        _: Own<'_>,
        OneFolder { folder }: OneFolder,
    ) -> Result<Foreign, Refusal> {
        let folder = folder_to_be(&from_home(&folder)?)?;
        let mut foreign = foreign::look(&folder).await;
        foreign.project = self.at(&folder).await.map(|entry| entry.summary().id);
        Ok(foreign)
    }

    /// Changes whether the Person trusts a Project. It waits for a Project
    /// being added or located, as `update` does, so its manifest has one
    /// writer at a time.
    async fn trust(&self, _: Own<'_>, trust: TrustProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let summary = self.trusting(trust.project, trust.trusted).await?;
        Ok(self.lettered(summary).await)
    }

    /// Sets whether the Person trusts `project`, missing or open, and tells
    /// its modules when it changed, so what runs under the old trust goes.
    /// Who calls holds `adding`.
    async fn trusting(&self, project: ProjectId, trusted: bool) -> Result<ProjectSummary, Refusal> {
        let untrusted = !trusted;
        let mut projects = self.projects.write().await;
        let entry = projects.get_mut(&project).ok_or_else(no_project)?;
        if untrusted && entry.scratch() {
            return Err(Refusal::invalid(SCRATCH_TRUSTED));
        }
        // Trusting it is saying so; not trusting it unsays it.
        let said = |manifest: &mut Manifest| {
            manifest.untrusted = untrusted;
            manifest.trust_said = trusted;
            manifest.said = trusted.then(|| Said::now(SaidBy::Person));
        };
        let (summary, changed) = match entry {
            Entry::Open(open) => {
                let changed = open.trust_said() != trusted || open.trusted() != trusted;
                let summary = open.change(said)?;
                (summary, changed.then(|| open.clone()))
            }
            Entry::Missing { data, manifest } => {
                manifest.change_in(data, said)?;
                (manifest.summary(true), None)
            }
        };
        drop(projects);
        if let Some(project) = changed {
            for module in project.modules() {
                module.trust_changed(project.module(module.name())).await;
            }
        }
        Ok(summary)
    }

    async fn update(&self, _: Own<'_>, update: UpdateProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let name = update.name.as_deref().map(Project::name_of).transpose()?;
        let target = update.folder.as_deref().map(from_home).transpose()?;
        let mut projects = self.projects.write().await;
        let Some(entry) = projects.get_mut(&update.project) else {
            return Err(no_project());
        };
        // A scratch Project has no name; a Project has one.
        let was = entry.scratch();
        match (was, update.scratch.unwrap_or(was), name.is_some()) {
            (false, true, _) => {
                return Err(Refusal::invalid(
                    "A Project does not go back to No Project.",
                ));
            }
            (true, true, true) => {
                return Err(Refusal::invalid(
                    "A Thread in No Project has no name until it becomes a Project.",
                ));
            }
            (true, false, false) => {
                return Err(Refusal::invalid(
                    "A Project made of a Thread in No Project needs a name.",
                ));
            }
            _ => {}
        }
        if target.is_some() && update.scratch != Some(false) {
            return Err(Refusal::invalid(
                "A folder move must make a Project from a Thread in No Project.",
            ));
        }
        let opened = match entry {
            Entry::Open(project) => Some(project.clone()),
            _ => None,
        };
        let _moving = match (&opened, &target) {
            (Some(project), Some(_)) => Some(project.moving.try_write().map_err(|_| {
                Refusal::conflict(
                    "Another operation is using this Project. Try moving it again when it finishes.",
                )
            })?),
            _ => None,
        };
        let old = entry.folder();
        let target = if let Some(target) = target {
            let parent = target
                .parent()
                .ok_or_else(|| Refusal::invalid("Choose a folder with a parent."))?;
            let parent = folder_found(parent)?;
            let leaf = target
                .file_name()
                .ok_or_else(|| Refusal::invalid("Choose a folder name."))?;
            Some(parent.join(leaf))
        } else {
            None
        };
        let relocating = (target.as_ref()).filter(|target| !crate::host::same(target, &old));
        if let Some(target) = relocating {
            if !was {
                return Err(Refusal::invalid(
                    "Only a Thread in No Project can move its folder this way.",
                ));
            }
            if std::fs::symlink_metadata(target).is_ok() {
                return Err(Refusal::conflict(
                    "The destination already exists. Choose a new folder.",
                ));
            }
            let project = opened
                .as_ref()
                .ok_or_else(|| Refusal::conflict("Locate the missing folder before moving it."))?;
            for module in project.modules() {
                module.can_move(project.module(module.name())).await?;
            }
            for module in project.modules() {
                module.moving(project.module(module.name())).await;
            }
        }
        // A picked picture is kept before the manifest names it.
        let data = entry.data();
        let back_to_found = matches!(update.sign, Some(None));
        let find_again = name.is_some() || back_to_found;
        let picked = (update.sign.flatten())
            .map(|pick| picked(&data, pick))
            .transpose()?;
        let change = |manifest: &mut Manifest| {
            if let Some((sign, picture)) = picked {
                manifest.sign = Some(sign);
                if picture.is_some() {
                    manifest.picture = picture;
                }
            }
            // A picture picked by hand goes; one Banda found stays.
            if back_to_found {
                manifest.sign = None;
                if (manifest.picture)
                    .take_if(|kept| kept.found.is_none())
                    .is_some()
                {
                    sign::forget(&data);
                }
            }
            if let Some(target) = &target {
                manifest.folder = target.clone();
            }
            if let Some(name) = name {
                manifest.name = name.to_owned();
            }
            if let Some(pinned) = update.pinned {
                manifest.pinned = pinned;
            }
            if let Some(archived) = update.archived {
                manifest.archived = archived;
            }
            if let Some(sees_others) = update.sees_others {
                manifest.sees_others = sees_others;
            }
            if let Some(scratch) = update.scratch {
                manifest.scratch = scratch;
            }
        };
        // A missing Project keeps its name, pin and archive too.
        let result = match entry {
            Entry::Open(project) => match relocating {
                Some(target) => project.move_to(target, change),
                None => project.change(change),
            },
            Entry::Missing { data, manifest } => manifest
                .change_in(data, change)
                .map(|()| manifest.summary(true)),
        };
        drop(projects);
        let summary = result?;
        if find_again {
            self.find_sign_now(summary).await
        } else {
            Ok(self.lettered(summary).await)
        }
    }

    async fn sign(
        &self,
        _: Own<'_>,
        OneProject { project }: OneProject,
    ) -> Result<Option<String>, Refusal> {
        let entry = self.projects.read().await.get(&project).cloned();
        let entry = entry.ok_or_else(no_project)?;
        Ok((entry.picture()).and_then(|kept| sign::data_url(&entry.data(), &kept)))
    }

    async fn find_sign(
        &self,
        _: Own<'_>,
        OneProject { project }: OneProject,
    ) -> Result<ProjectSummary, Refusal> {
        let summary = self.project(project).await?.summary();
        self.find_sign_now(summary).await
    }

    /// Opens a missing Project at the folder its work is in now, written
    /// into its `project.json`. A folder that already is another Project is
    /// refused.
    async fn locate(&self, _: Own<'_>, locate: LocateProject) -> Result<ProjectSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let folder = folder_found(&from_home(&locate.folder)?)?;
        if let Some(other) = self.at(&folder).await
            && other.summary().id != locate.project
        {
            let name = other.summary().name;
            return Err(Refusal::conflict(format!(
                "{} already is the Project \"{name}\".",
                folder.display()
            )));
        }
        let located = self.open_missing(locate.project, &folder).await?;
        self.find_sign_now(located).await
    }

    /// Takes the Project out of the list at once, and its data out of the
    /// engine's sight: `<id>.gone`, deleted once nothing holds the Project,
    /// or else on the next start. Its modules stop what runs there first,
    /// and their places in this machine's log go.
    /// A Project that is already gone is what was asked for.
    async fn remove(&self, _: Own<'_>, OneProject { project }: OneProject) -> Result<(), Refusal> {
        let Some(entry) = self.projects.write().await.remove(&project) else {
            return Ok(());
        };
        if let Some(machine) = &self.machine
            && let Err(error) = cursors::forget(machine, project).await
        {
            tracing::warn!(%error, "a removed Project's places in the machine's log stayed");
        }
        let gone = self.projects_data.join(format!("{project}{GONE}"));
        let project = match entry {
            Entry::Open(project) => project,
            // Nothing of it is open: its data goes now.
            Entry::Missing { data, .. } => {
                let away = put_away(&data, gone);
                tokio::task::spawn_blocking(move || crate::host::remove_all(&away));
                return Ok(());
            }
        };
        project.delete_when_closed(put_away(project.data(), gone));
        // What acts for it stops reaching Banda.
        self.passes.revoke_project(project.id());
        for module in project.modules() {
            module.closing(project.module(module.name())).await;
        }
        Ok(())
    }
}

fn no_project() -> Refusal {
    Refusal::not_found("There is no such Project on this computer.")
}

/// Moves a removed Project's `data` out of the engine's sight, to `gone`;
/// answers where it is now, in place if it would not move.
fn put_away(data: &Path, gone: PathBuf) -> PathBuf {
    match crate::host::rename(data, &gone) {
        Ok(()) => gone,
        Err(error) => {
            let shown = data.display();
            tracing::warn!(data = %shown, %error, "a removed Project's data stayed in place");
            data.to_owned()
        }
    }
}

/// The folder at `folder`, resolved: refused when there is none.
fn folder_found(folder: &Path) -> Result<PathBuf, Refusal> {
    let canonical = match dunce::canonicalize(folder) {
        Ok(canonical) => canonical,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let there = format!("There is no folder {}.", folder.display());
            return Err(Refusal::not_found(there));
        }
        Err(error) => return Err(Error::from(error).into()),
    };
    if !canonical.is_dir() {
        let what = format!("{} is not a folder.", folder.display());
        return Err(Refusal::invalid(what));
    }
    Ok(canonical)
}

/// The folder at `folder`, resolved; or, when it is not made yet, where it
/// will be: the nearest folder above it, resolved, with the rest as given.
fn folder_to_be(folder: &Path) -> Result<PathBuf, Refusal> {
    let Some(there) = (folder.ancestors()).find(|dir| dir.exists()) else {
        return folder_found(folder);
    };
    match folder.strip_prefix(there) {
        Ok(rest) if !rest.as_os_str().is_empty() => Ok(folder_found(there)?.join(rest)),
        _ => folder_found(folder),
    }
}

/// `~` or `~/…` from the home folder; any other path must be absolute.
fn from_home(path: &str) -> Result<PathBuf, Refusal> {
    let home = || dirs::home_dir().ok_or_else(|| Refusal::not_found("There is no home folder."));
    let path = match path.trim() {
        "~" => home()?,
        path => match path.strip_prefix("~/") {
            // `~/~/x` is a path typed again over the field's `~/`: no
            // folder named `~` is made of it.
            Some(rest) if rest == "~" || rest.starts_with("~/") => {
                return Err(Refusal::invalid(format!("{path} starts at ~ twice.")));
            }
            Some(rest) => home()?.join(rest),
            None => PathBuf::from(path),
        },
    };
    if !path.is_absolute() {
        return Err(Refusal::invalid(format!(
            "{} is not a whole path: start it at / or ~.",
            path.display()
        )));
    }
    Ok(path)
}

/// The subfolders of `parent` whose names start with `prefix`, any case,
/// by name; hidden ones only when `prefix` starts with a dot. A folder
/// that cannot be read has none.
fn subfolders(parent: &Path, prefix: &str) -> Vec<BrowsedFolder> {
    let Ok(read) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    let prefix = prefix.to_lowercase();
    let mut entries: Vec<BrowsedFolder> = read
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let shown = name.to_lowercase().starts_with(&prefix)
                && (prefix.starts_with('.') || !name.starts_with('.'));
            if !shown {
                return None;
            }
            // The listing says what each is; only a link is looked through.
            let path = entry.path();
            let kind = entry.file_type().ok()?;
            let folder = kind.is_dir() || (kind.is_symlink() && path.is_dir());
            folder.then(|| BrowsedFolder {
                path: path.display().to_string(),
                name,
            })
        })
        .collect();
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    entries.truncate(BROWSED);
    entries
}

/// Reads a method's parameters. Unknown fields are ignored, so an older
/// engine accepts a newer window's call (ADR 0002, decision 8).
pub fn decode<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Refusal> {
    serde_json::from_value(params)
        .map_err(|e| Refusal::invalid(format!("The call's parameters do not fit: {e}.")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_from_home_starts_at_it_once() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(from_home("~/code").unwrap(), home.join("code"));
        assert_eq!(from_home("~").unwrap(), home);
        assert!(from_home("~/~/code").is_err());
        assert!(from_home("~/~").is_err());
        assert!(from_home("code").is_err());
    }
}
