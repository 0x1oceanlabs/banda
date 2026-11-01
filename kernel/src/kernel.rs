use crate::access::{self, Caller, Right};
use crate::methods::{Asks, Nothing, Tool};
use crate::module::{Call, Module, Stream};
use crate::passes::Passes;
use crate::space::{Created, Space};
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
    owner: PersonId,
    /// This boot of the engine. Outbox rows claimed under another boot were
    /// cut short by a restart.
    boot: String,
    modules: Arc<[Arc<dyn Module>]>,
    spaces: RwLock<BTreeMap<SpaceId, Arc<Space>>>,
    passes: Arc<Passes>,
    /// Every module's tools, made once as it opens.
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
    owner: PersonId,
    modules: Vec<Arc<dyn Module>>,
}

impl KernelBuilder {
    pub fn module(mut self, module: impl Module) -> Self {
        self.modules.push(Arc::new(module));
        self
    }

    /// Opens every Space under the root. A Space that fails to open is
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
        let kernel = Arc::new(Kernel {
            root: self.root,
            owner: self.owner,
            boot: uuid::Uuid::now_v7().to_string(),
            tools: self.modules.iter().flat_map(|m| m.tools()).collect(),
            modules: self.modules.into(),
            spaces: RwLock::new(BTreeMap::new()),
            passes: Arc::default(),
        });
        let mut folders: Vec<PathBuf> = std::fs::read_dir(&kernel.root)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        folders.sort();
        for folder in folders {
            let Some(id) = Space::id_of(&folder) else {
                continue;
            };
            if let Ok(kept) = kernel.space(id).await {
                tracing::warn!(
                    kept = %kept.folder().display(),
                    skipped = %folder.display(),
                    "two folders hold the same Space; the second stays closed"
                );
                continue;
            }
            match kernel.open_space(folder.clone()).await {
                Ok(space) => {
                    kernel.spaces.write().await.insert(space.id(), space);
                }
                Err(error) => {
                    tracing::error!(folder = %folder.display(), %error, "a Space did not open")
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
        /// Makes a Space: its folder under the root, by its name.
        command create(CreateSpace) -> SpaceSummary, Manage;
        /// The tools an Agent may call, from every module's methods.
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

fn no_method(method: &str) -> Refusal {
    Refusal::invalid(format!("There is no method \"{method}\"."))
}

impl Kernel {
    /// `root` holds the Spaces' folders (`~/Banda` by default). `owner`
    /// is the Person who owns this computer's Spaces.
    pub fn builder(root: impl Into<PathBuf>, owner: PersonId) -> KernelBuilder {
        KernelBuilder {
            root: root.into(),
            owner,
            modules: Vec::new(),
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
        let space = space.or(only);
        access::within(only, space)?;
        if let Some(own) = method.strip_prefix("spaces.")
            && let Some(right) = Self::method_right(own)
        {
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
        let space = self
            .space(space.ok_or_else(|| Refusal::invalid(format!("{method} needs a Space.")))?)
            .await?;
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
        access::within(only, Some(space))?;
        let (module, rest, right) = self.method(method)?;
        let space = self.space(space).await?;
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
        access::within(only, Some(space))?;
        let space = self.space(space).await?;
        access::decide(&participant, Right::Read, space.owner())?;
        Ok(space)
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

    async fn open_space(&self, folder: PathBuf) -> Result<Arc<Space>, Error> {
        let (modules, passes) = (self.modules.clone(), self.passes.clone());
        Space::open(folder, self.owner, modules, passes, &self.boot).await
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
        match Space::create(&folder, name, author, command)? {
            Created::Earlier(id) => Ok(self.space(id).await?.summary()),
            Created::New => {
                let space = self.open_space(folder).await?;
                let summary = space.summary();
                self.spaces.write().await.insert(space.id(), space);
                Ok(summary)
            }
        }
    }
}

/// Reads a method's parameters. Unknown fields are ignored, so an older
/// engine accepts a newer window's call (ADR 0002, decision 8).
pub fn decode<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Refusal> {
    serde_json::from_value(params)
        .map_err(|e| Refusal::invalid(format!("The call's parameters do not fit: {e}.")))
}
