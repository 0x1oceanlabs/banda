//! Adding a module to the running engine (ADR 0126, decision 5): an App
//! from outside the build, which a module of the platform reads from a
//! folder and hands the kernel as a [`Module`]. The engine makes one
//! [`Registry`], gives it to the kernel as it builds it
//! ([`KernelBuilder::registry`](crate::KernelBuilder::registry)) and to
//! the module that adds, and the kernel binds it as it opens.
//!
//! A module added so is one of the Projects' scope, with a name no module
//! the engine was built with has and tools no other module has. Every open
//! Project takes it at once: its tables come up to date there, or it is
//! turned off there alone, as when a Project opens. Adding one of a name
//! added before puts it in that one's place, Project by Project, each
//! once the calls the old one runs there have ended. Only what was added
//! is replaced or taken away; the engine names those it starts with
//! ([`KernelBuilder::added`](crate::KernelBuilder::added)).
//!
//! What the kernel ends for a module it lets go of is its calls. A module
//! added so keeps no work of its own between them: it queues no effect,
//! opens no stream and starts nothing as it opens, for the kernel would
//! not end those. An App's worker module is such a one.

use crate::kernel::{Entry, Kernel, Runs};
use crate::module::{Module, Scope};
use crate::{App, ProjectId, Refusal, module_name};
use std::sync::{Arc, OnceLock, Weak};

/// The handle that adds modules to a running kernel.
#[derive(Clone, Default)]
pub struct Registry(Arc<OnceLock<Weak<Kernel>>>);

/// A Project a module added to the running engine is turned off in, and
/// why, in words.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct TurnedOff {
    pub project: ProjectId,
    pub why: String,
}

impl Registry {
    pub fn new() -> Registry {
        Registry::default()
    }

    /// Binds it to `kernel`, as the kernel opens.
    pub(crate) fn bind(&self, kernel: &Arc<Kernel>) {
        let _ = self.0.set(Arc::downgrade(kernel));
    }

    fn kernel(&self) -> Result<Arc<Kernel>, Refusal> {
        (self.0.get().and_then(Weak::upgrade))
            .ok_or_else(|| Refusal::conflict("This engine takes no App while it runs."))
    }

    /// Adds `module` to the running engine as the App `app`, which its
    /// `welcome` lists from now, or puts it in the place of the one of
    /// its name added before. Each open Project takes it; those it is
    /// turned off in are answered, with why.
    pub async fn add(&self, module: impl Module, app: App) -> Result<Vec<TurnedOff>, Refusal> {
        self.kernel()?.add_module(Arc::new(module), app).await
    }

    /// Takes the module `name`, added before, out of the running engine.
    /// What it kept in each Project stays.
    pub async fn remove(&self, name: &str) -> Result<(), Refusal> {
        self.kernel()?.remove_module(name).await
    }
}

impl Kernel {
    async fn add_module(
        &self,
        module: Arc<dyn Module>,
        app: App,
    ) -> Result<Vec<TurnedOff>, Refusal> {
        let name = module.name();
        // No Project is added meanwhile, nor another module.
        let _adding = self.adding.lock().await;
        let runs = self.runs();
        let replaces = runs.added.contains(&name);
        if !replaces && runs.modules.iter().any(|had| had.name() == name) {
            return Err(Refusal::conflict(format!(
                "The id {name} is taken on this machine."
            )));
        }
        let others = runs.without(name);
        admits(&others, &*module, &app)?;
        // The Projects first, so no call reaches it where its tables are
        // not yet its own. What goes wrong in one turns it off there, and
        // the rest take it: it is added whole, or refused above.
        let mut off = Vec::new();
        for project in self.open_projects().await {
            if let Some(why) = project.add(&module).await {
                off.push(TurnedOff {
                    project: project.id(),
                    why,
                });
            }
        }
        self.runs.send_replace(Arc::new(others.with(module, app)));
        Ok(off)
    }

    /// Every Project open now.
    async fn open_projects(&self) -> Vec<Arc<crate::Project>> {
        (self.projects.read().await.values())
            .filter_map(|entry| match entry {
                Entry::Open(project) => Some(project.clone()),
                Entry::Missing { .. } => None,
            })
            .collect()
    }

    async fn remove_module(&self, name: &str) -> Result<(), Refusal> {
        let _adding = self.adding.lock().await;
        let runs = self.runs();
        if !runs.added.contains(&name) {
            return Err(Refusal::not_found(format!(
                "No App named {name} was added to this engine."
            )));
        }
        self.runs.send_replace(Arc::new(runs.without(name)));
        // From now no call finds it; each Project lets go of it once the
        // calls it runs there have ended.
        for project in self.open_projects().await {
            project.remove(name).await;
        }
        Ok(())
    }
}

/// Refuses `module`, to be listed as `app`, unless it may be added beside
/// what `others` run: a module of the Projects' scope, by a name the
/// kernel does not keep, with tools no other module has.
pub(crate) fn admits(others: &Runs, module: &dyn Module, app: &App) -> Result<(), Refusal> {
    let name = module.name();
    if module.scope() != Scope::Project || !module.legacy_prefixes().is_empty() {
        return Err(Refusal::invalid(format!(
            "{name} cannot be added: only a module of the Projects' scope is, with no legacy prefix."
        )));
    }
    if !module_name(name) || app.id != name {
        return Err(Refusal::invalid(format!(
            "\"{name}\" cannot be the name of the App {}.",
            app.id
        )));
    }
    let tools = module.tools();
    let taken = (others.tools.iter()).find(|had| tools.iter().any(|tool| tool.name == had.name));
    match taken {
        Some(taken) => Err(Refusal::conflict(format!(
            "An Agent's tool is named {} already.",
            taken.name
        ))),
        None => Ok(()),
    }
}
