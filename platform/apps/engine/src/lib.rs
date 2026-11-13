//! The apps module: the Apps on this machine.
//!
//! - `apps.describe` answers every App and platform part this engine
//!   runs, each with its methods (ADR 0082, decision 2): Banda's own, as
//!   the engine's scan of their manifests found them, then the installed
//!   Apps it serves. The engine's `welcome` lists the same Apps by their
//!   versions, and its stream `machine.apps` says the list again as it
//!   changes.
//! - `apps.install` installs an App from a folder, which a Person's Agent
//!   writes (ADR 0126): it reads the folder and checks it
//!   ([`folder::Folder`]), copies it into Banda's data
//!   ([`installed::Installed`]), and adds it to the running engine, in the
//!   place of the one installed before. `apps.installed` lists them and
//!   `apps.remove` takes one away.
//! - `apps.export` streams what an App keeps in a Project, its events and
//!   its tables, as lines anyone can read (ADR 0085, decision 10).
//!
//! It is a module of the machine: an App is installed on a machine, and
//! keeps its data in each Project (ADR 0085, decision 5). An Agent's pass
//! reaches its methods, and installs only from a folder inside its own
//! Project: there is no click, for the App runs as the Person's user, as
//! the Agent's shell does (what we build, Decided).
//!
//! The kernel takes each installed App as a module of its own
//! ([`served::Served`]), whose calls go to the App's worker ([`worker`]):
//! those installed before, as the engine builds it ([`Apps::at_start`]),
//! and each as it is installed, through the kernel's
//! [`Registry`](banda_kernel::Registry). An install is staged, taken and
//! then kept, in that order: the engine runs no copy it did not take, and
//! one it refused leaves the App as it ran.

pub mod folder;
pub mod installed;
pub mod new;
pub mod served;
mod worker;

use banda_kernel::host::Node;
use banda_kernel::{
    App, AppMethods, Call, Code, Kind, Module, Nothing, ProjectId, Reach, Refusal, Registry, Right,
    Scope, Stream, TurnedOff, now_ms,
};
use folder::Folder;
use installed::{Install as Kept, Installed, InstalledFrom};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use served::{Served, Turns};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use ts_rs::TS;

/// The apps module.
#[derive(Clone)]
pub struct Apps {
    /// Banda's own Apps and parts, which the engine was built with.
    own: Arc<[AppMethods]>,
    installed: Installed,
    /// How it adds an installed App to the running engine; with none, an
    /// App is installed and runs nothing.
    registry: Option<Registry>,
    /// The Node an App's worker runs on; none where this machine has none.
    node: Option<Node>,
    /// How long an App's method has to answer.
    answers_within: Duration,
    serving: Arc<Serving>,
}

/// The installed Apps the engine serves now.
#[derive(Default)]
struct Serving {
    /// Each as `apps.describe` lists it, in the order they were added.
    apps: Mutex<Vec<AppMethods>>,
    /// The turns of each App's commands, by its id: they outlive the
    /// module that serves it, so one put in its place keeps to them.
    turns: Mutex<HashMap<String, Turns>>,
    /// Banda's loop for a worker, a file written once.
    runner: OnceLock<PathBuf>,
}

/// The folder to install an App from.
#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "apps/")]
pub struct Install {
    /// The App's folder: absolute, or from the Project's folder for an
    /// Agent.
    pub folder: String,
}

/// An installed App to remove.
#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "apps/")]
pub struct Remove {
    /// Its id, as `clients`.
    pub id: String,
}

/// The App to export, and the Project whose data of it.
#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "apps/")]
pub struct Export {
    pub project: ProjectId,
    /// The App's id, as `clients`: one installed from a folder, one of
    /// Banda's own, or one removed whose data stays.
    pub app: String,
}

/// One piece of an App's export: lines of one file of it, `app.json`,
/// `events.ndjson` or `<table>.ndjson`; or, last, `done`, with how many
/// lines each file has. An export with no `done` was cut short.
#[derive(Debug, Serialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "apps/")]
pub enum ExportPiece {
    Lines {
        file: String,
        #[ts(type = "Array<unknown>")]
        lines: Vec<Value>,
    },
    Done {
        #[ts(type = "Record<string, number>")]
        done: Value,
    },
}

/// An App installed on this machine from a folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "apps/")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    /// What it is for, in words.
    pub about: String,
    pub version: String,
    /// The major of the App API it is written to.
    pub api: u32,
    #[serde(flatten)]
    #[ts(flatten)]
    pub installed: InstalledFrom,
    /// Whether this engine serves the version installed.
    pub runs: bool,
}

/// What an install answers: the App as installed, and where it is off.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "apps/")]
pub struct Installing {
    #[serde(flatten)]
    #[ts(flatten)]
    pub app: InstalledApp,
    /// The Projects it is turned off in, each with why: its tables there
    /// did not come up to date. The others have it.
    pub off: Vec<TurnedOff>,
}

banda_kernel::methods! {
    Apps(Call) as "AppsMethods" in "apps/" {
        /// Each App this engine runs, and each part of the platform: its
        /// id, its version, the major of the App API it is written to, and
        /// the methods its engine part gives, `<id>.<name>`, each with its
        /// kind, the right it needs, whether it reads or acts, and what it
        /// does.
        call describe(Nothing) -> Vec<AppMethods>, Read, pass;
        /// The Apps installed on this machine from a folder, by id: each
        /// with its version, where it was installed from and when, and
        /// whether this engine serves that version.
        call installed(Nothing) -> Vec<InstalledApp>, Read, pass;
        /// Installs the App in a folder on this machine, or installs it
        /// again after a change: reads its app.toml, methods.json,
        /// migrations and entry and tries its steps, says what is wrong
        /// in them, copies the folder into Banda's data, and adds it to
        /// the running engine.
        /// Every Project of this machine gets it at once, each with its
        /// own tables, and its methods are Agents' tools from then. A
        /// Project where its tables did not come up to date is answered in
        /// `off`, with why: there it is turned off, and the rest have it.
        /// Refused, the App installed before goes on as it ran.
        command install(Install) -> Installing, Write, pass;
        /// Removes an App installed from a folder: it runs nothing from
        /// then. What it kept in each Project stays there, and installing
        /// it again brings it back.
        command remove(Remove) -> (), Write, pass;
        /// What an App keeps in a Project, as lines anyone can read (ADR
        /// 0085, decision 10), in pieces, each the lines of one file of
        /// the export: first `app.json`, with its ledger and each table's
        /// CREATE, then its events in the log's order, then each of its
        /// tables, a row a line by column; and last `done`, with each
        /// file's count of lines. It reads the data whether the engine
        /// runs the App or not. The Person's alone: it is all the App
        /// holds.
        stream export(Export) -> ExportPiece, Manage, read;
    }
}

impl Apps {
    /// The module over Banda's `own` Apps and parts, with the installed
    /// Apps in `folder`: Banda's data's `apps`.
    pub fn new(own: Vec<AppMethods>, folder: impl Into<PathBuf>) -> Apps {
        Apps {
            own: own.into(),
            installed: Installed::in_folder(folder),
            registry: None,
            node: None,
            answers_within: worker::ANSWERS_WITHIN,
            serving: Default::default(),
        }
    }

    /// The module, adding each installed App to the engine `registry` is
    /// bound to, and running its worker on `node`.
    pub fn serving(mut self, registry: Registry, node: Option<Node>) -> Apps {
        (self.registry, self.node) = (Some(registry), node);
        self
    }

    /// The module, whose Apps' methods have `within` to answer in.
    pub fn answering_within(mut self, within: Duration) -> Apps {
        self.answers_within = within;
        self
    }

    /// Each installed App, as the module the kernel takes for it as it is
    /// built ([`KernelBuilder::added`](banda_kernel::KernelBuilder::added)):
    /// those installed before this start. One that does not fit is logged
    /// and left out: an id or a tool's name that what runs already has.
    /// The copies no install names go, as no worker reads one yet.
    pub fn at_start(&self) -> Vec<(Served, App)> {
        self.installed.sweep();
        let mut made = Vec::new();
        for Kept { app, copy, .. } in self.installed.list() {
            let id = app.id.clone();
            match self.served(app, &copy) {
                Ok((served, described)) => {
                    made.push((served, described.app.clone()));
                    self.serving.apps.lock().unwrap().push(described);
                }
                Err(refusal) => {
                    tracing::error!(app = id, why = %refusal.message, "an installed App is not served");
                }
            }
        }
        made
    }

    /// The module that serves `app` from `copy`, and the App as
    /// `apps.describe` lists it; refused when it does not fit beside what
    /// runs.
    fn served(&self, app: Folder, copy: &Path) -> Result<(Served, AppMethods), Refusal> {
        self.fits(&app)?;
        let described = AppMethods {
            app: App {
                id: app.id.clone(),
                version: app.version.clone(),
                api: app.api,
            },
            methods: app.described(),
        };
        let turns = {
            let mut turns = self.serving.turns.lock().unwrap();
            turns.entry(app.id.clone()).or_default().clone()
        };
        let runner = (self.serving.runner).get_or_init(|| self.installed.runner());
        let served = Served::new(app, copy, runner, self.node.clone(), turns)
            .answering_within(self.answers_within);
        Ok((served, described))
    }

    /// Adds `app` to the running engine from its `copy`, in the place of
    /// the one of its id served before: the Projects it is turned off in,
    /// with why. With no engine to add it to, it is installed and no more.
    async fn serve(&self, app: Folder, copy: &Path) -> Result<Vec<TurnedOff>, Refusal> {
        let Some(registry) = &self.registry else {
            return Ok(Vec::new());
        };
        let (served, described) = self.served(app, copy)?;
        let off = registry.add(served, described.app.clone()).await?;
        let mut apps = self.serving.apps.lock().unwrap();
        apps.retain(|had| had.app.id != described.app.id);
        apps.push(described);
        Ok(off)
    }

    /// What this engine runs: Banda's own Apps and parts, then the
    /// installed Apps it serves.
    fn runs(&self) -> Vec<AppMethods> {
        let served = self.serving.apps.lock().unwrap();
        self.own.iter().chain(served.iter()).cloned().collect()
    }

    fn listed(&self, app: &Folder, installed: InstalledFrom) -> InstalledApp {
        let served = self.serving.apps.lock().unwrap();
        let runs =
            (served.iter()).any(|run| run.app.id == app.id && run.app.version == app.version);
        InstalledApp {
            id: app.id.clone(),
            name: app.name.clone(),
            about: app.about.clone(),
            version: app.version.clone(),
            api: app.api,
            installed,
            runs,
        }
    }

    /// Refuses an App whose id one of Banda's own has, or whose tools
    /// another App that runs has, in words for its author, before
    /// anything is copied; and an installed App that would stop the
    /// engine's start. The kernel holds the same as it takes one. An
    /// installed App is installed again over itself.
    fn fits(&self, app: &Folder) -> Result<(), Refusal> {
        if self.own.iter().any(|run| run.app.id == app.id) {
            return Err(Refusal::conflict(format!(
                "The id {} is taken on this machine: pick another in app.toml.",
                app.id
            )));
        }
        let served = self.serving.apps.lock().unwrap();
        let tools: Vec<&str> = (self.own.iter().chain(served.iter()))
            .filter(|run| run.app.id != app.id)
            .flat_map(|run| run.methods.iter().filter_map(|method| method.tool))
            .collect();
        for tool in app.tools() {
            if tools.contains(&tool.name.as_str()) {
                return Err(Refusal::conflict(format!(
                    "An Agent's tool is named {} already: name the method {} otherwise, or give it \"tool\": false.",
                    tool.name, tool.method
                )));
            }
        }
        Ok(())
    }

    async fn describe(&self, _: Call, _: Nothing) -> Result<Vec<AppMethods>, Refusal> {
        Ok(self.runs())
    }

    async fn installed(&self, _: Call, _: Nothing) -> Result<Vec<InstalledApp>, Refusal> {
        let installed = self.installed.clone();
        let listed = tokio::task::spawn_blocking(move || installed.list()).await;
        let listed = listed.map_err(|_| Refusal::internal())?;
        Ok(listed
            .into_iter()
            .map(|kept| self.listed(&kept.app, kept.from))
            .collect())
    }

    async fn install(&self, call: Call, params: Install) -> Result<Installing, Refusal> {
        // An Agent installs from its own Project's folder; the Person,
        // from any folder they name whole.
        let from = Reach::of_machine(&call, &params.folder).await?.into_path();
        let from = InstalledFrom {
            from,
            by: call.participant(),
            project: call.wall().map(|wall| wall.project),
            at: now_ms(),
        };
        // Staged: read, checked and copied to a folder of its own.
        let (apps, staging) = (self.clone(), from.clone());
        let staged = tokio::task::spawn_blocking(move || {
            let app = Folder::read(&staging.from)?;
            apps.fits(&app)?;
            // Its steps are tried before anything is copied, so a step
            // that fails leaves the App installed before as it runs.
            app.tried()?;
            let copy = apps.installed.stage(&app, &staging)?;
            Ok::<_, Refusal>((app, copy))
        });
        let (app, copy) = staged.await.map_err(|_| Refusal::internal())??;
        // Taken by the engine from there, then kept; refused, the copy
        // goes, and the App is as it was.
        let taken = match self.serve(app.clone(), &copy).await {
            Ok(off) => (self.installed.commit(&app, &from, &copy)).map(|()| off),
            Err(refusal) => Err(refusal),
        };
        let off = taken.inspect_err(|_| self.installed.discard(&copy))?;
        let answer = Installing {
            app: self.listed(&app, from),
            off,
        };
        // The fact that it was installed commits with the command's
        // receipt: a resend copies nothing again.
        let (author, said) = (call.participant(), answer.app.clone());
        call.command(move |tx| {
            tx.emit("installed", 1, Some(&said.id), author, &said)?;
            Ok(())
        })
        .await?;
        Ok(answer)
    }

    async fn remove(&self, call: Call, params: Remove) -> Result<(), Refusal> {
        // Its record first: from here it is not installed, whatever
        // follows.
        let (installed, id) = (self.installed.clone(), params.id.clone());
        let removed = tokio::task::spawn_blocking(move || installed.remove(&id)).await;
        removed.map_err(|_| Refusal::internal())??;
        self.serving
            .apps
            .lock()
            .unwrap()
            .retain(|had| had.app.id != params.id);
        // One the engine never took, installed and not served, has only
        // its record and its copies to lose.
        if let Some(registry) = &self.registry {
            match registry.remove(&params.id).await {
                Err(refusal) if refusal.code != Code::NotFound => return Err(refusal),
                _ => {}
            }
        }
        // Its copies last, when its worker has let go of them.
        let (installed, id) = (self.installed.clone(), params.id.clone());
        let _ = tokio::task::spawn_blocking(move || installed.clear(&id)).await;
        let author = call.participant();
        call.command(move |tx| {
            let removed = serde_json::json!({ "id": params.id });
            tx.emit("removed", 1, Some(&params.id), author, &removed)?;
            Ok(())
        })
        .await
    }

    async fn export(&self, _: Call, params: Export) -> Result<Stream, Refusal> {
        let registry = (self.registry.as_ref())
            .ok_or_else(|| Refusal::conflict("This engine exports no App's data."))?;
        registry.export(params.project, &params.app).await
    }
}

#[async_trait::async_trait]
impl Module for Apps {
    fn name(&self) -> &'static str {
        "apps"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    fn passes_reach(&self, method: &str) -> bool {
        Self::method_passes(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}
