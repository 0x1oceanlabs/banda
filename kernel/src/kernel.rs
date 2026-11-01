use crate::access::{self, Right};
use crate::module::{Call, Module, Stream};
use crate::space::{Created, Space};
use crate::{CommandId, Error, Participant, PersonId, Refusal, SpaceId};
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
            modules: self.modules.into(),
            spaces: RwLock::new(BTreeMap::new()),
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

/// The kernel's own methods, each with the right it needs.
enum Method {
    ListSpaces,
    CreateSpace,
}

impl Method {
    fn parse(name: &str) -> Option<Method> {
        match name {
            "spaces.list" => Some(Method::ListSpaces),
            "spaces.create" => Some(Method::CreateSpace),
            _ => None,
        }
    }

    fn right(&self) -> Right {
        match self {
            Method::ListSpaces => Right::Read,
            Method::CreateSpace => Right::Manage,
        }
    }
}

#[derive(Deserialize)]
struct CreateSpace {
    name: String,
}

fn no_method(method: &str) -> Refusal {
    Refusal::invalid(format!("There is no method \"{method}\"."))
}

impl Kernel {
    /// `root` holds the Spaces' folders (`~/Bandaso` by default). `owner`
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

    /// Routes a call: `spaces.*` to the kernel, `<module>.*` to that module
    /// in the given Space. Every method passes the access decision first.
    pub async fn call(
        &self,
        participant: Participant,
        method: &str,
        space: Option<SpaceId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Value, Refusal> {
        if let Some(own) = Method::parse(method) {
            access::decide(&participant, own.right(), self.owner)?;
            return match own {
                Method::ListSpaces => {
                    Ok(serde_json::to_value(self.spaces().await).map_err(Error::from)?)
                }
                Method::CreateSpace => {
                    let command = command.ok_or_else(|| {
                        Refusal::invalid("spaces.create is a command and needs a command ID.")
                    })?;
                    let CreateSpace { name } = decode(params)?;
                    let created = self.create_space(&name, participant, command).await?;
                    Ok(serde_json::to_value(created).map_err(Error::from)?)
                }
            };
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
        participant: Participant,
        method: &str,
        space: SpaceId,
        params: Value,
    ) -> Result<Stream, Refusal> {
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
        Space::open(folder, self.owner, self.modules.clone(), &self.boot).await
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
