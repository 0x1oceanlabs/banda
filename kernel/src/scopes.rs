//! The scopes: the kernel built and opened, with the machine's scope and
//! every Project the data holds, and where a module's method runs.

use crate::access;
use crate::apps::App;
use crate::environment::{Environment, Nowhere};
use crate::kernel::{Entry, Kernel, PowerStreams, Projects, Runs};
use crate::module::{Module, Scope, Stream, Wall};
use crate::outbox::Boot;
use crate::passes::{self, Passes};
use crate::project::{GONE, Manifest, Project, Shared, UNFINISHED};
use crate::registry::Registry;
use crate::window::Window;
use crate::{CommandId, Error, Named, Participant, PersonId, ProjectId, Refusal};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;

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
    power: Option<PowerStreams>,
    apps: Vec<App>,
    registry: Option<Registry>,
    /// The names of the modules it opens with that may be replaced or
    /// taken away while it runs.
    added: Vec<&'static str>,
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

    /// What opens each `machine.power` stream a client hears: this host's
    /// battery and why it is held awake, now and then as they change (ADR
    /// 0097). The module that reads them reads only while one is heard.
    pub fn power(mut self, stream: impl Fn() -> Stream + Send + Sync + 'static) -> Self {
        self.power = Some(Arc::new(stream));
        self
    }

    /// The Apps this engine runs, as the engine's scan of their manifests
    /// found them: the `welcome` lists them (ADR 0082, decision 14). With
    /// none, it lists none.
    pub fn apps(mut self, apps: Vec<App>) -> Self {
        self.apps = apps;
        self
    }

    /// A module the kernel opens with that its [`Registry`] may replace or
    /// take away while it runs, listed as the App `app`: an App from
    /// outside the build, installed before this start. Refused as the
    /// kernel opens when it could not be added while it runs.
    pub fn added(mut self, module: impl Module, app: App) -> Self {
        self.added.push(module.name());
        self.apps.push(app);
        self.modules.push(Arc::new(module));
        self
    }

    /// The handle through which a module of the platform adds a module to
    /// this kernel while it runs, an App's from outside the build: bound to
    /// the kernel as it opens. With none, its modules are those it opens
    /// with.
    pub fn registry(mut self, registry: Registry) -> Self {
        self.registry = Some(registry);
        self
    }

    /// Opens every Project the data holds, once the old Projects under the root
    /// have moved theirs out (ADR 0026). A Project that fails to open is
    /// logged and left closed, so it cannot keep the others shut.
    pub async fn open(self) -> Result<Arc<Kernel>, Error> {
        for (index, module) in self.modules.iter().enumerate() {
            let name = module.name();
            if self.modules[..index].iter().any(|m| m.name() == name) {
                return Err(Refusal::invalid(format!("Two modules are named \"{name}\".")).into());
            }
        }
        let of_machine = |module: &&Arc<dyn Module>| {
            module.scope() == Scope::Machine && self.added.contains(&module.name())
        };
        if let Some(module) = self.modules.iter().find(of_machine) {
            let name = module.name();
            return Err(Refusal::invalid(format!(
                "{name} is a module of the machine: it is not one to replace while the engine runs."
            ))
            .into());
        }
        crate::tables::check(&self.modules)?;
        std::fs::create_dir_all(&self.root)?;
        let projects_data = self.data.join("projects");
        crate::old::from_spaces(&self.data, &projects_data, self.machine.as_deref());
        std::fs::create_dir_all(&projects_data)?;
        crate::old::move_out(&self.root, &projects_data);
        let of_machine: Vec<_> = (self.modules.iter())
            .filter(|module| module.scope() == Scope::Machine)
            .cloned()
            .collect();
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
            runs: watch::Sender::new(Arc::new(Runs::of(
                self.modules.clone(),
                self.apps,
                self.added,
            ))),
            projects,
            adding: Default::default(),
            machine,
            passes,
            window,
            environment: self.environment,
            named: self.named,
            power: self.power,
        });
        if let Some(registry) = &self.registry {
            registry.bind(&kernel);
        }
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

/// The file that keeps the passes when the engine names none.
const PASSES: &str = "passes.sqlite3";

/// A pass is for its Project, so it stops at this machine's scope but for
/// the tools (ADR 0032).
pub(crate) fn outside_machine() -> Refusal {
    Refusal::forbidden("An Agent's pass is for its Project, not this machine.")
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
            power: None,
            apps: Vec::new(),
            registry: None,
            added: Vec::new(),
        }
    }

    /// Where a method of `module` runs. A module of the machine runs in
    /// this machine's scope, and its method names no Project, or the
    /// machine's own ID, as a stream does. Any other runs in the Project it
    /// names, or its caller's pass names, behind the Project wall. A pass
    /// reaches the machine only through its tools, and what the module
    /// says passes reach ([`Module::passes_reach`]), which are handed the
    /// wall they see behind (ADR 0032).
    pub(crate) async fn place(
        &self,
        module: &dyn Module,
        method: &str,
        rest: &str,
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
            Some(project)
                if self.runs().tools.iter().any(|tool| tool.method == method)
                    || module.passes_reach(rest) =>
            {
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

    pub(crate) async fn open_project(
        &self,
        data: PathBuf,
        manifest: Manifest,
    ) -> Result<Arc<Project>, Error> {
        let engine = Shared {
            owner: self.owner,
            passes: self.passes.clone(),
            window: self.window.clone(),
            environment: self.environment.clone(),
            machine: self.machine.clone(),
            projects: None,
        };
        let modules = self.runs().in_projects.clone();
        Project::open(data, manifest, modules, engine, &self.boot).await
    }
}
