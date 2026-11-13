//! The apps module: the Apps on this machine.
//!
//! - `apps.describe` answers every App and platform part this engine
//!   runs, each with its methods (ADR 0082, decision 2), as the engine's
//!   scan of their manifests found them; the engine's `welcome` lists the
//!   same Apps by their versions.
//! - `apps.install` installs an App from a folder, which a Person's Agent
//!   writes (ADR 0126): it reads the folder and checks it
//!   ([`folder::Folder`]), then copies it into Banda's data
//!   ([`installed::Installed`]). `apps.installed` lists them and
//!   `apps.remove` takes one away.
//!
//! It is a module of the machine: an App is installed on a machine, and
//! keeps its data in each Project (ADR 0085, decision 5). An Agent's pass
//! reaches its methods, and installs only from a folder inside its own
//! Project: there is no click, for the App runs as the Person's user, as
//! the Agent's shell does (what we build, Decided).
//!
//! An installed App runs from the engine's next start: the engine takes
//! each as a module of its own ([`served::Served`], [`Apps::serving`]),
//! whose calls go to the App's worker ([`worker`]).

pub mod folder;
pub mod installed;
pub mod new;
pub mod served;
mod worker;

use banda_kernel::host::Node;
use banda_kernel::{
    App, AppMethods, Call, Kind, Module, Nothing, Reach, Refusal, Right, Scope, now_ms,
};
use folder::Folder;
use installed::{Installed, InstalledFrom};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use served::Served;
use std::path::PathBuf;
use ts_rs::TS;

/// The apps module.
#[derive(Clone)]
pub struct Apps {
    /// What this engine runs, as it started: Banda's own Apps and parts,
    /// then the installed Apps it serves.
    runs: Vec<AppMethods>,
    /// How many of `runs` are Banda's own, which come first.
    own: usize,
    installed: Installed,
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
    /// Whether this engine serves the version installed: false from an
    /// install until the engine starts again.
    pub runs: bool,
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
        /// whether this engine runs that version yet.
        call installed(Nothing) -> Vec<InstalledApp>, Read, pass;
        /// Installs the App in a folder on this machine, or installs it
        /// again after a change: reads its app.toml, methods.json,
        /// migrations and entry, says what is wrong in them, and copies
        /// the folder into Banda's data. Every Project of this machine
        /// gets it, each with its own tables. It runs from the engine's
        /// next start.
        command install(Install) -> InstalledApp, Write, pass;
        /// Removes an App installed from a folder. What it kept in each
        /// Project stays there, and installing it again brings it back.
        command remove(Remove) -> (), Write, pass;
    }
}

impl Apps {
    /// The module over what this engine `runs`, with the installed Apps in
    /// `folder`: Banda's data's `apps`.
    pub fn new(runs: Vec<AppMethods>, folder: impl Into<PathBuf>) -> Apps {
        Apps {
            own: runs.len(),
            runs,
            installed: Installed::in_folder(folder),
        }
    }

    /// The module, and each installed App this engine serves, as a module
    /// of its own for the kernel: run by its worker on `node`, or
    /// installed and not running where this machine has none. An App whose
    /// id or tools what runs already has taken is logged and left out.
    pub fn serving(mut self, node: Option<Node>) -> (Apps, Vec<Served>) {
        let runner = self.installed.runner();
        let mut served = Vec::new();
        for (app, _) in self.installed.list() {
            if let Err(refusal) = self.fits(&app) {
                tracing::error!(app = app.id, why = %refusal.message, "an installed App is not served");
                continue;
            }
            let described = AppMethods {
                app: App {
                    id: app.id.clone(),
                    version: app.version.clone(),
                    api: app.api,
                },
                methods: app.described(),
            };
            self.runs.push(described);
            let copy = self.installed.copy_of(&app.id);
            served.push(Served::new(app, &copy, &runner, node.clone()));
        }
        (self, served)
    }

    /// What this engine runs: Banda's own Apps and parts, then the
    /// installed Apps it serves.
    pub fn runs(&self) -> &[AppMethods] {
        &self.runs
    }

    fn listed(&self, app: &Folder, installed: InstalledFrom) -> InstalledApp {
        let runs =
            (self.runs.iter()).any(|run| run.app.id == app.id && run.app.version == app.version);
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
    /// another App that runs has. An installed App is installed again over
    /// itself.
    fn fits(&self, app: &Folder) -> Result<(), Refusal> {
        if self.runs[..self.own].iter().any(|run| run.app.id == app.id) {
            return Err(Refusal::conflict(format!(
                "The id {} is taken on this machine: pick another in app.toml.",
                app.id
            )));
        }
        let tools: Vec<&str> = (self.runs.iter())
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
        Ok(self.runs.clone())
    }

    async fn installed(&self, _: Call, _: Nothing) -> Result<Vec<InstalledApp>, Refusal> {
        let installed = self.installed.clone();
        let listed = tokio::task::spawn_blocking(move || installed.list()).await;
        let listed = listed.map_err(|_| Refusal::internal())?;
        Ok(listed
            .into_iter()
            .map(|(app, installed)| self.listed(&app, installed))
            .collect())
    }

    async fn install(&self, call: Call, params: Install) -> Result<InstalledApp, Refusal> {
        // An Agent installs from its own Project's folder; the Person,
        // from any folder they name whole.
        let from = Reach::of_machine(&call, &params.folder).await?.into_path();
        let installed = InstalledFrom {
            from,
            by: call.participant(),
            project: call.wall().map(|wall| wall.project),
            at: now_ms(),
        };
        let (apps, placed) = (self.clone(), installed.clone());
        let read = tokio::task::spawn_blocking(move || {
            let app = Folder::read(&placed.from)?;
            apps.fits(&app)?;
            apps.installed.install(&app, &placed)?;
            Ok::<_, Refusal>(app)
        });
        let app = read.await.map_err(|_| Refusal::internal())??;
        let listed = self.listed(&app, installed);
        // The fact that it was installed commits with the command's
        // receipt: a resend copies nothing again.
        let (author, said) = (call.participant(), listed.clone());
        call.command(move |tx| {
            tx.emit("installed", 1, Some(&said.id), author, &said)?;
            Ok(())
        })
        .await?;
        Ok(listed)
    }

    async fn remove(&self, call: Call, params: Remove) -> Result<(), Refusal> {
        let (installed, id) = (self.installed.clone(), params.id.clone());
        let removed = tokio::task::spawn_blocking(move || installed.remove(&id)).await;
        removed.map_err(|_| Refusal::internal())??;
        let author = call.participant();
        call.command(move |tx| {
            let removed = serde_json::json!({ "id": params.id });
            tx.emit("removed", 1, Some(&params.id), author, &removed)?;
            Ok(())
        })
        .await
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
}
