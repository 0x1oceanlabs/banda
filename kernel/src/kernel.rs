use crate::access::{self, Caller, Right};
use crate::methods::{Asks, Nothing, Tool};
use crate::module::{Call, Module, Scope, Stream};
use crate::passes::Passes;
use crate::space::{Manifest, Space, UNFINISHED};
use crate::{AgentId, CommandId, Error, Participant, PersonId, Refusal, SpaceId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
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
            tools: in_spaces.iter().flat_map(|m| m.tools()).collect(),
            modules: self.modules.into(),
            in_spaces: in_spaces.into(),
            spaces: RwLock::new(BTreeMap::new()),
            machine,
            passes,
        });
        let mut found: Vec<PathBuf> = std::fs::read_dir(&kernel.spaces_data)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        found.sort();
        let mut folders: std::collections::HashMap<PathBuf, PathBuf> = Default::default();
        for data in found {
            let name = data.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(UNFINISHED) {
                // Cut short while it was written: it never was a Space.
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
        /// The tools an Agent may call, from the methods of the modules in
        /// Spaces.
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

/// A pass is for its Space, so it stops at this machine's scope: what an
/// Agent may do with the workspaces comes with its tools (ADR 0025, step 3).
fn outside_machine(only: Option<SpaceId>) -> Result<(), Refusal> {
    match only {
        Some(_) => Err(Refusal::forbidden(
            "An Agent's pass is for its Space, not this machine.",
        )),
        None => Ok(()),
    }
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
        let space = self.place(&**module, method, space, only).await?;
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
                let call = Call::new(participant, scope, method.to_owned(), command);
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
        let space = self.place(&**module, method, Some(space), only).await?;
        access::decide(&participant, right, space.owner())?;
        let call = Call::new(
            participant,
            space.module(module.name()),
            method.to_owned(),
            None,
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
                outside_machine(only)?;
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
    /// names, or its caller's pass names, behind the Space wall.
    async fn place(
        &self,
        module: &dyn Module,
        method: &str,
        named: Option<SpaceId>,
        only: Option<SpaceId>,
    ) -> Result<Arc<Space>, Refusal> {
        if module.scope() == Scope::Space {
            let id = named.or(only);
            access::within(only, id)?;
            let id = id.ok_or_else(|| Refusal::invalid(format!("{method} needs a Space.")))?;
            return self.space(id).await;
        }
        let machine = (self.machine.as_ref())
            .ok_or_else(|| Refusal::not_found("This engine has no machine's scope."))?;
        if named.is_some_and(|id| id != machine.id()) {
            return Err(Refusal::invalid(format!(
                "{method} is this machine's: it names no Space."
            )));
        }
        outside_machine(only)?;
        Ok(machine.clone())
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

    async fn create_space(
        &self,
        name: &str,
        author: Participant,
        command: CommandId,
    ) -> Result<SpaceSummary, Refusal> {
        let name = Space::plain_name(name)?;
        let folder = self.root.join(name);
        match std::fs::create_dir(&folder) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // The same command again: the Space it made.
                let folder = std::fs::canonicalize(&folder).map_err(Error::from)?;
                let spaces = self.spaces.read().await;
                return match spaces.values().find(|s| s.folder() == folder) {
                    Some(made) if made.command() == command => Ok(made.summary()),
                    _ => Err(Refusal::conflict(format!(
                        "A folder named \"{name}\" already exists in this place."
                    ))),
                };
            }
            Err(error) => return Err(Error::from(error).into()),
        }
        let made = std::fs::canonicalize(&folder)
            .map_err(Error::from)
            .and_then(|folder| Space::create(&self.spaces_data, &folder, name, author, command));
        let (data, manifest) = match made {
            Ok(made) => made,
            Err(error) => {
                // Take back the folder this call made, while it is empty.
                let _ = std::fs::remove_dir(&folder);
                return Err(error.into());
            }
        };
        let space = self.open_space(data, manifest).await?;
        let summary = space.summary();
        self.spaces.write().await.insert(space.id(), space);
        Ok(summary)
    }
}

/// Reads a method's parameters. Unknown fields are ignored, so an older
/// engine accepts a newer window's call (ADR 0002, decision 8).
pub fn decode<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Refusal> {
    serde_json::from_value(params)
        .map_err(|e| Refusal::invalid(format!("The call's parameters do not fit: {e}.")))
}
