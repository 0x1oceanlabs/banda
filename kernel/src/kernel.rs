use crate::access::{self, Caller, Right};
use crate::methods::{Asks, Nothing, Tool};
use crate::module::{Call, Module, Scope, Stream, Wall};
use crate::passes::Passes;
use crate::space::{GONE, Manifest, Space, UNFINISHED};
use crate::{AgentId, CommandId, Error, Participant, PersonId, Refusal, SpaceId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use ts_rs::TS;

/// The Spaces of this machine and the modules that serve them.
pub struct Kernel {
    root: PathBuf,
    /// `spaces/` in the engine's data: one folder per Space.
    spaces_data: PathBuf,
    owner: PersonId,
    /// This boot of the engine. Outbox rows claimed under another boot were
    /// cut short by a restart.
    boot: String,
    modules: Arc<[Arc<dyn Module>]>,
    /// The modules each Space runs: those of the Space's scope.
    in_spaces: Arc<[Arc<dyn Module>]>,
    spaces: RwLock<BTreeMap<SpaceId, Arc<Space>>>,
    /// Held while a Space is added, so one folder never becomes two.
    adding: tokio::sync::Mutex<()>,
    /// This machine's scope (ADR 0025, decision 1): a store and a log like
    /// a Space's, for the modules of the machine. None while no module is.
    machine: Option<Arc<Space>>,
    passes: Arc<Passes>,
    /// The tools of the modules in Spaces, made once as it opens.
    tools: Vec<Tool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpaceSummary {
    pub id: SpaceId,
    pub name: String,
    /// Where the Space's folder is on this machine.
    pub folder: String,
    /// Pinned Spaces come first in the Space pickers.
    pub pinned: bool,
    /// Hidden from the Space pickers; its Threads and files are kept.
    pub archived: bool,
    /// Its Agents see the other Spaces' Panes (ADR 0029). Only the Person
    /// sets it.
    pub sees_others: bool,
}

pub struct KernelBuilder {
    root: PathBuf,
    data: PathBuf,
    owner: PersonId,
    modules: Vec<Arc<dyn Module>>,
    machine: Option<PathBuf>,
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

    /// Opens every Space the data holds, once the old Spaces under the root
    /// have moved theirs out (ADR 0026). A Space that fails to open is
    /// logged and left closed, so it cannot keep the others shut.
    pub async fn open(self) -> Result<Arc<Kernel>, Error> {
        for (index, module) in self.modules.iter().enumerate() {
            let name = module.name();
            let valid = !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase());
            if !valid || name == "spaces" || name == crate::store::KERNEL {
                return Err(
                    Refusal::invalid(format!("\"{name}\" cannot be a module's name.")).into(),
                );
            }
            if self.modules[..index].iter().any(|m| m.name() == name) {
                return Err(Refusal::invalid(format!("Two modules are named \"{name}\".")).into());
            }
        }
        std::fs::create_dir_all(&self.root)?;
        let spaces_data = self.data.join("spaces");
        std::fs::create_dir_all(&spaces_data)?;
        crate::old::move_out(&self.root, &spaces_data);
        let (of_machine, in_spaces): (Vec<_>, Vec<_>) =
            (self.modules.iter().cloned()).partition(|module| module.scope() == Scope::Machine);
        let boot = uuid::Uuid::now_v7().to_string();
        let passes = Arc::<Passes>::default();
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
            let opened = Space::open(data, manifest, self.owner, modules, passes.clone(), &boot);
            Some(opened.await?)
        };
        let kernel = Arc::new(Kernel {
            root: self.root,
            spaces_data,
            owner: self.owner,
            boot,
            tools: self.modules.iter().flat_map(|m| m.tools()).collect(),
            modules: self.modules.into(),
            in_spaces: in_spaces.into(),
            spaces: RwLock::new(BTreeMap::new()),
            adding: Default::default(),
            machine,
            passes,
        });
        let mut found: Vec<PathBuf> = std::fs::read_dir(&kernel.spaces_data)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        found.sort();
        let mut folders: HashMap<PathBuf, PathBuf> = Default::default();
        for data in found {
            let name = data.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(UNFINISHED) || name.ends_with(GONE) {
                // Cut short while it was written, it never was a Space; or
                // it was removed before its data was all gone.
                let _ = std::fs::remove_dir_all(&data);
                continue;
            }
            let manifest = match Manifest::read(&data) {
                Ok(manifest) => manifest,
                Err(error) => {
                    tracing::error!(data = %data.display(), %error, "a Space did not open");
                    continue;
                }
            };
            if let Some(kept) = folders.get(&manifest.folder) {
                tracing::warn!(
                    folder = %manifest.folder.display(),
                    kept = %kept.display(),
                    skipped = %data.display(),
                    "two Spaces name the same folder; the second stays closed"
                );
                continue;
            }
            folders.insert(manifest.folder.clone(), data.clone());
            match kernel.open_space(data.clone(), manifest).await {
                Ok(space) => {
                    kernel.spaces.write().await.insert(space.id(), space);
                }
                Err(error) => {
                    tracing::error!(data = %data.display(), %error, "a Space did not open")
                }
            }
        }
        Ok(kernel)
    }
}

crate::methods! {
    Kernel(Own<'_>) as "SpacesMethods" in "./" {
        /// This computer's Spaces.
        call list(Nothing) -> Vec<SpaceSummary>, Read;
        /// Makes a Space: a new folder under the root, by its name.
        command create(CreateSpace) -> SpaceSummary, Manage;
        /// Adds a folder as a Space. A folder that already is one answers
        /// that Space, back from the archive if it was there.
        command add(AddSpace) -> SpaceSummary, Manage;
        /// The folders that match a path as it is typed, for the field
        /// that picks a Space's folder. Only the owner browses.
        call browse(Browse) -> Browsed, Manage;
        /// Renames, pins or archives a Space, or lets its Agents see the
        /// other Spaces' Panes.
        command update(UpdateSpace) -> SpaceSummary, Manage;
        /// Forgets a Space and deletes its Threads; its folder and the
        /// files in it stay as they are.
        command remove(OneSpace) -> (), Manage;
        /// The tools an Agent may call, from the methods of the modules.
        call tools(Nothing) -> Vec<Tool>, Read;
    }
}

/// Who calls one of the kernel's own methods, and under which command.
struct Own<'a> {
    participant: Participant,
    method: &'a str,
    only: Option<SpaceId>,
    command: Option<CommandId>,
}

impl Asks for Own<'_> {
    fn command_id(&self) -> Result<CommandId, Refusal> {
        self.command.ok_or_else(|| {
            Refusal::invalid(format!(
                "{} is a command and needs a command ID.",
                self.method
            ))
        })
    }
}

#[derive(Deserialize, TS)]
struct CreateSpace {
    name: String,
}

#[derive(Deserialize, TS)]
struct AddSpace {
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
struct UpdateSpace {
    space: SpaceId,
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
}

#[derive(Deserialize, TS)]
struct OneSpace {
    space: SpaceId,
}

/// The most folders `spaces.browse` answers.
const BROWSED: usize = 200;

/// A pass is for its Space, so it stops at this machine's scope but for
/// the tools (ADR 0029).
fn outside_machine() -> Refusal {
    Refusal::forbidden("An Agent's pass is for its Space, not this machine.")
}

fn no_method(method: &str) -> Refusal {
    Refusal::invalid(format!("There is no method \"{method}\"."))
}

impl Kernel {
    /// `root` is where a new Space's folder goes (`~/Banda` by default),
    /// and `data` where Banda keeps the Spaces' own data
    /// (`~/.local/share/banda`, ADR 0026). `owner` is the Person who owns
    /// this computer's Spaces.
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
        }
    }

    pub fn owner(&self) -> PersonId {
        self.owner
    }

    /// The names of the modules this engine runs: what a window may use.
    pub fn modules(&self) -> Vec<&'static str> {
        self.modules.iter().map(|m| m.name()).collect()
    }

    /// The Agent a pass names and the Space it works in, or `None`.
    pub fn holder(&self, pass: &str) -> Option<(AgentId, SpaceId)> {
        self.passes.holder(pass)
    }

    /// Routes a call: `spaces.*` to the kernel, `<module>.*` to that module
    /// in the given Space. Every method passes the Space wall and the
    /// access decision first. A caller with a pass that names no Space
    /// calls in its own.
    pub async fn call(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        space: Option<SpaceId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Value, Refusal> {
        let Caller { participant, only } = caller.into();
        if let Some(own) = method.strip_prefix("spaces.")
            && let Some(right) = Self::method_right(own)
        {
            access::within(only, space.or(only))?;
            access::decide(&participant, right, self.owner)?;
            let ask = Own {
                participant,
                method,
                only,
                command,
            };
            return self.dispatch(ask, own, params).await;
        }
        let (module, rest, right) = self.method(method)?;
        let (space, wall) = self.place(&**module, method, space, only).await?;
        let scope = space.module(module.name());
        // A read is not a command: it keeps no receipt, so its ID is free.
        let command = command.filter(|_| right != Right::Read);
        let receipt = command.map(|command| scope.receipt(command, method, participant));
        if let Some(receipt) = &receipt {
            let earlier = space.store().answered(receipt.clone()).await?;
            if let Some(answer) = earlier {
                return answer;
            }
        }
        let answer = match access::decide(&participant, right, space.owner()) {
            Ok(()) => {
                let call = Call::new(participant, scope, method.to_owned(), command, wall);
                module.call(call, rest, params).await
            }
            Err(refusal) => Err(refusal),
        };
        // A refusal made before the command ran is its answer too (ADR
        // 0002, decision 2). The store keeps it only if nothing answered.
        if let (Some(receipt), Err(refusal)) = (receipt, &answer) {
            space.store().refused(receipt, refusal.clone()).await?;
        }
        answer
    }

    /// Opens a module's stream in a Space, once the access decision
    /// allows it.
    pub async fn stream(
        &self,
        caller: impl Into<Caller>,
        method: &str,
        space: SpaceId,
        params: Value,
    ) -> Result<Stream, Refusal> {
        let Caller { participant, only } = caller.into();
        let (module, rest, right) = self.method(method)?;
        let (space, wall) = self.place(&**module, method, Some(space), only).await?;
        access::decide(&participant, right, space.owner())?;
        let call = Call::new(
            participant,
            space.module(module.name()),
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

    /// The Space `caller` follows, once the Space wall and the access
    /// decision allow it.
    pub async fn follow(
        &self,
        caller: impl Into<Caller>,
        space: SpaceId,
    ) -> Result<Arc<Space>, Refusal> {
        let Caller { participant, only } = caller.into();
        let space = match &self.machine {
            Some(machine) if machine.id() == space => {
                // Its log holds every Space's Panes: no pass follows it.
                if only.is_some() {
                    return Err(outside_machine());
                }
                machine.clone()
            }
            _ => {
                access::within(only, Some(space))?;
                self.space(space).await?
            }
        };
        access::decide(&participant, Right::Read, space.owner())?;
        Ok(space)
    }

    /// The ID a window follows and streams this machine's modules by, as
    /// a Space's; none while no module is the machine's.
    pub fn machine(&self) -> Option<SpaceId> {
        self.machine.as_ref().map(|machine| machine.id())
    }

    /// Where a method of `module` runs. A module of the machine runs in
    /// this machine's scope, and its method names no Space, or the
    /// machine's own ID, as a stream does. Any other runs in the Space it
    /// names, or its caller's pass names, behind the Space wall. A pass
    /// reaches the machine only through its tools, which are handed the
    /// wall they see behind (ADR 0029).
    async fn place(
        &self,
        module: &dyn Module,
        method: &str,
        named: Option<SpaceId>,
        only: Option<SpaceId>,
    ) -> Result<(Arc<Space>, Option<Wall>), Refusal> {
        if module.scope() == Scope::Space {
            let id = named.or(only);
            access::within(only, id)?;
            let id = id.ok_or_else(|| Refusal::invalid(format!("{method} needs a Space.")))?;
            return Ok((self.space(id).await?, None));
        }
        let machine = (self.machine.as_ref())
            .ok_or_else(|| Refusal::not_found("This engine has no machine's scope."))?;
        if named.is_some_and(|id| id != machine.id()) {
            return Err(Refusal::invalid(format!(
                "{method} is this machine's: it names no Space."
            )));
        }
        let wall = match only {
            None => None,
            Some(space) if self.tools.iter().any(|tool| tool.method == method) => {
                let sees_others = self.space(space).await?.sees_others();
                Some(Wall { space, sees_others })
            }
            Some(_) => return Err(outside_machine()),
        };
        Ok((machine.clone(), wall))
    }

    pub async fn space(&self, id: SpaceId) -> Result<Arc<Space>, Refusal> {
        self.spaces
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| Refusal::not_found("There is no such Space on this computer."))
    }

    pub async fn spaces(&self) -> Vec<SpaceSummary> {
        self.spaces
            .read()
            .await
            .values()
            .map(|s| s.summary())
            .collect()
    }

    async fn open_space(&self, data: PathBuf, manifest: Manifest) -> Result<Arc<Space>, Error> {
        let (modules, passes) = (self.in_spaces.clone(), self.passes.clone());
        Space::open(data, manifest, self.owner, modules, passes, &self.boot).await
    }

    async fn list(&self, ask: Own<'_>, _: Nothing) -> Result<Vec<SpaceSummary>, Refusal> {
        let mut spaces = self.spaces().await;
        // A pass sees only its own Space (ADR 0019, decision 2).
        spaces.retain(|summary| access::within(ask.only, Some(summary.id)).is_ok());
        Ok(spaces)
    }

    async fn tools(&self, _: Own<'_>, _: Nothing) -> Result<Vec<Tool>, Refusal> {
        Ok(self.tools.clone())
    }

    async fn create(
        &self,
        ask: Own<'_>,
        CreateSpace { name }: CreateSpace,
    ) -> Result<SpaceSummary, Refusal> {
        self.create_space(&name, ask.participant, ask.command_id()?)
            .await
    }

    /// `spaces.add` of a new folder `~/Banda/<name>`; one already there
    /// is refused, unless this command made its Space.
    async fn create_space(
        &self,
        name: &str,
        author: Participant,
        command: CommandId,
    ) -> Result<SpaceSummary, Refusal> {
        let name = Space::plain_name(name)?;
        let folder = self.root.join(name);
        if let Ok(canonical) = std::fs::canonicalize(&folder) {
            return match self.at(&canonical).await {
                Some(made) if made.command() == command => Ok(made.summary()),
                _ => Err(Refusal::conflict(format!(
                    "A folder named \"{name}\" already exists in this place."
                ))),
            };
        }
        self.add_at(&folder, Some(name), true, author, command)
            .await
    }

    async fn add(&self, ask: Own<'_>, add: AddSpace) -> Result<SpaceSummary, Refusal> {
        let command = ask.command_id()?;
        let folder = from_home(&add.folder)?;
        let create = add.create == Some(true);
        (self.add_at(
            &folder,
            add.name.as_deref(),
            create,
            ask.participant,
            command,
        ))
        .await
    }

    /// Adds `folder` as a Space, made first if `create` says so; the
    /// Space it already is comes back from the archive instead. A folder
    /// this call made is taken back when the Space is not.
    async fn add_at(
        &self,
        folder: &Path,
        name: Option<&str>,
        create: bool,
        author: Participant,
        command: CommandId,
    ) -> Result<SpaceSummary, Refusal> {
        let _adding = self.adding.lock().await;
        let made = create && !folder.exists();
        if made {
            std::fs::create_dir_all(folder).map_err(Error::from)?;
        }
        let added = async {
            let canonical = match std::fs::canonicalize(folder) {
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
            if let Some(space) = self.at(&canonical).await {
                return match space.summary().archived {
                    true => Ok(space.change(|manifest| manifest.archived = false)?),
                    false => Ok(space.summary()),
                };
            }
            let named = canonical.file_name().map(|n| n.to_string_lossy());
            let name = match (name, &named) {
                (Some(name), _) => name,
                (None, Some(named)) => named,
                (None, None) => "/",
            };
            let name = Space::name_of(name)?;
            self.place_space(&canonical, name, author, command).await
        }
        .await;
        if made && added.is_err() {
            let _ = std::fs::remove_dir(folder);
        }
        added
    }

    /// The open Space whose folder is `folder`, absolute and resolved.
    async fn at(&self, folder: &Path) -> Option<Arc<Space>> {
        let spaces = self.spaces.read().await;
        spaces.values().find(|s| s.folder() == folder).cloned()
    }

    /// Makes the data of a new Space for `folder`, opens it and lists it.
    async fn place_space(
        &self,
        folder: &Path,
        name: &str,
        author: Participant,
        command: CommandId,
    ) -> Result<SpaceSummary, Refusal> {
        let (data, manifest) = Space::create(&self.spaces_data, folder, name, author, command)?;
        let space = match self.open_space(data.clone(), manifest).await {
            Ok(space) => space,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&data);
                return Err(error.into());
            }
        };
        let summary = space.summary();
        self.spaces.write().await.insert(space.id(), space);
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

    async fn update(&self, _: Own<'_>, update: UpdateSpace) -> Result<SpaceSummary, Refusal> {
        let name = update.name.as_deref().map(Space::name_of).transpose()?;
        let space = self.space(update.space).await?;
        Ok(space.change(|manifest| {
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
        })?)
    }

    /// Takes the Space out of the list at once, and its data out of the
    /// engine's sight: `<id>.gone`, deleted once nothing holds the Space,
    /// or else on the next start. Its modules stop what runs there first.
    /// A Space that is already gone is what was asked for.
    async fn remove(&self, _: Own<'_>, OneSpace { space }: OneSpace) -> Result<(), Refusal> {
        let Some(space) = self.spaces.write().await.remove(&space) else {
            return Ok(());
        };
        let gone = self.spaces_data.join(format!("{}{GONE}", space.id()));
        match std::fs::rename(space.data(), &gone) {
            Ok(()) => space.delete_when_closed(gone),
            Err(error) => {
                let data = space.data().display();
                tracing::warn!(%data, %error, "a removed Space's data stayed in place");
                space.delete_when_closed(space.data().to_owned());
            }
        }
        for module in space.modules() {
            module.closing(space.module(module.name())).await;
        }
        Ok(())
    }
}

/// `~` or `~/…` from the home folder; any other path must be absolute.
fn from_home(path: &str) -> Result<PathBuf, Refusal> {
    let home = || dirs::home_dir().ok_or_else(|| Refusal::not_found("There is no home folder."));
    let path = match path.trim() {
        "~" => home()?,
        path => match path.strip_prefix("~/") {
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
