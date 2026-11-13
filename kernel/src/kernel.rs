//! The kernel: the Projects of this machine and the modules that serve
//! them. It routes each call (`router.rs`), opens the scopes and their
//! stores (`scopes.rs`), and serves its own `projects.*` (`projects.rs`).

use crate::access::Caller;
use crate::apps::App;
use crate::environment::Environment;
use crate::methods::Tool;
use crate::module::{Module, Stream};
use crate::outbox::Boot;
use crate::passes::{Audience, Passes};
use crate::project::{Manifest, Project};
use crate::sign::{self, Kept, Sign};
use crate::window::Window;
use crate::{AgentId, Named, PersonId, ProjectId, Refusal};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{RwLock, watch};
use ts_rs::TS;

/// The Projects of this machine and the modules that serve them.
pub struct Kernel {
    pub(crate) root: PathBuf,
    /// `projects/` in the engine's data: one folder per Project.
    pub(crate) projects_data: PathBuf,
    pub(crate) owner: PersonId,
    /// This boot of the engine. Outbox rows the engine claimed under another
    /// boot were cut short by a restart; workers' leases run on its clock.
    pub(crate) boot: Boot,
    pub(crate) modules: Arc<[Arc<dyn Module>]>,
    /// The modules each Project runs: those of the Project's scope.
    pub(crate) in_projects: Arc<[Arc<dyn Module>]>,
    pub(crate) projects: Projects,
    /// Held while a Project is added, so one folder never becomes two.
    pub(crate) adding: tokio::sync::Mutex<()>,
    /// This machine's scope (ADR 0025, decision 1): a store and a log like
    /// a Project's, for the modules of the machine. None while no module is.
    pub(crate) machine: Option<Arc<Project>>,
    pub(crate) passes: Arc<Passes>,
    /// The road from a module to the window (ADR 0029).
    pub(crate) window: Arc<Window>,
    /// Where the Projects' programs run (ADR 0084).
    pub(crate) environment: Arc<dyn Environment>,
    /// The tools of the modules in Projects, made once as it opens.
    pub(crate) tools: Vec<Tool>,
    /// What this host is called and drawn by, as it is now; none when the
    /// engine names it nothing.
    pub(crate) named: Option<watch::Receiver<Named>>,
    /// What opens a `machine.power` stream; none when the engine says no
    /// power.
    pub(crate) power: Option<PowerStreams>,
    /// The Apps this engine runs, as the engine handed them.
    pub(crate) apps: Vec<App>,
}

/// What opens a `machine.power` stream, each time a client hears it.
pub(crate) type PowerStreams = Arc<dyn Fn() -> Stream + Send + Sync>;

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
    pub(crate) fn summary(&self) -> ProjectSummary {
        match self {
            Entry::Open(project) => project.summary(),
            Entry::Missing { manifest, .. } => manifest.summary(true),
        }
    }

    pub(crate) fn scratch(&self) -> bool {
        match self {
            Entry::Open(project) => project.scratch(),
            Entry::Missing { manifest, .. } => manifest.scratch,
        }
    }

    pub(crate) fn folder(&self) -> PathBuf {
        match self {
            Entry::Open(project) => project.folder(),
            Entry::Missing { manifest, .. } => manifest.folder.clone(),
        }
    }

    /// Where Banda keeps the Project's data.
    pub(crate) fn data(&self) -> PathBuf {
        match self {
            Entry::Open(project) => project.data().to_owned(),
            Entry::Missing { data, .. } => data.clone(),
        }
    }

    /// The picture its sign keeps, found or picked.
    pub(crate) fn picture(&self) -> Option<Kept> {
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

/// A key given, `null` too, as `Some`; left out, `None`, by `default`: a
/// field a call or a fact may clear.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

impl Kernel {
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

    /// Who calls with a pass, when the API takes it, or `None`: its Agent,
    /// walled in its Project, and the Thread whose session it was made
    /// for, as the store keeps them (ADR 0083, decision 2).
    pub fn caller(&self, pass: &str) -> Option<Caller> {
        let holder = self.passes.named(pass, Audience::Ws)?;
        Some(Caller {
            thread: holder.thread,
            runs: holder.runs,
            ..Caller::agent(holder.agent, holder.project)
        })
    }

    /// The engine stops: the passes its sessions hold get a whole term, for
    /// the sessions that go on past the restart, and none is revoked as
    /// what holds it goes from here on (ADR 0083, decision 2).
    pub fn stopping(&self) {
        self.passes.stopping();
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

    /// The Apps this engine runs, as its `welcome` lists them.
    pub fn apps(&self) -> Vec<App> {
        self.apps.clone()
    }

    pub async fn project(&self, id: ProjectId) -> Result<Arc<Project>, Refusal> {
        open_in(&self.projects, id).await
    }

    /// Every Project, the missing too.
    pub async fn projects(&self) -> Vec<ProjectSummary> {
        let projects = self.projects.read().await;
        let mut summaries: Vec<_> = projects.values().map(Entry::summary).collect();
        sign::lettered(&mut summaries);
        summaries
    }
}

/// The Project `id` of `projects`, while it is open: one whose folder is
/// gone waits to be located.
pub(crate) async fn open_in(projects: &Projects, id: ProjectId) -> Result<Arc<Project>, Refusal> {
    match projects.read().await.get(&id) {
        Some(Entry::Open(project)) => Ok(project.clone()),
        Some(Entry::Missing { manifest, .. }) => Err(Refusal::not_found(format!(
            "The folder of the Project \"{}\", {}, is gone: locate it first.",
            manifest.name,
            manifest.folder.display()
        ))),
        None => Err(no_project()),
    }
}

pub(crate) fn no_project() -> Refusal {
    Refusal::not_found("There is no such Project on this computer.")
}

/// Reads a method's parameters. Unknown fields are ignored, so an older
/// engine accepts a newer window's call (ADR 0002, decision 8).
pub fn decode<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Refusal> {
    serde_json::from_value(params)
        .map_err(|e| Refusal::invalid(format!("The call's parameters do not fit: {e}.")))
}
