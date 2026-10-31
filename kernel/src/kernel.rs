use crate::access::{self, Right};
use crate::module::{Call, Module};
use crate::space::Space;
use crate::{Actor, CommandId, Error, PersonId, Refusal, SpaceId};
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
    /// This run of the engine. Outbox rows claimed by another run were cut
    /// short by a restart.
    run: String,
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
            run: uuid::Uuid::now_v7().to_string(),
            modules: self.modules.into(),
            spaces: RwLock::new(BTreeMap::new()),
        });
        let mut folders: Vec<PathBuf> = std::fs::read_dir(&kernel.root)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| Space::is_space(path))
            .collect();
        folders.sort();
        for folder in folders {
            match Space::open(
                folder.clone(),
                kernel.owner,
                kernel.modules.clone(),
                &kernel.run,
            )
            .await
            {
                Ok(space) => kernel.insert(space).await,
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

    /// Routes a call: `spaces.*` to the kernel, `<module>.*` to that module
    /// in the given Space.
    pub async fn call(
        &self,
        actor: Actor,
        method: &str,
        space: Option<SpaceId>,
        command: Option<CommandId>,
        params: Value,
    ) -> Result<Value, Refusal> {
        if let Some(own) = Method::parse(method) {
            access::decide(&actor, own.right(), self.owner)?;
            return match own {
                Method::ListSpaces => {
                    Ok(serde_json::to_value(self.spaces().await).map_err(Error::from)?)
                }
                Method::CreateSpace => {
                    let params: CreateSpace = decode(params)?;
                    Ok(serde_json::to_value(self.create_space(&params.name).await?)
                        .map_err(Error::from)?)
                }
            };
        }
        let (prefix, rest) = method
            .split_once('.')
            .ok_or_else(|| Refusal::invalid(format!("There is no method \"{method}\".")))?;
        let module = self
            .modules
            .iter()
            .find(|m| m.name() == prefix)
            .ok_or_else(|| Refusal::invalid(format!("There is no method \"{method}\".")))?;
        let space = self
            .space(space.ok_or_else(|| Refusal::invalid(format!("{method} needs a Space.")))?)
            .await?;
        let call = Call::new(
            actor,
            space.module(module.name()),
            method.to_owned(),
            command,
        );
        module.call(call, rest, params).await
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

    async fn create_space(&self, name: &str) -> Result<SpaceSummary, Refusal> {
        let name = name.trim();
        let plain = !name.is_empty()
            && name.chars().count() <= 64
            && !name.starts_with('.')
            && !name.contains(['/', '\\', '\0'])
            && name != "..";
        if !plain {
            return Err(Refusal::invalid(
                "A Space's name is 1 to 64 characters, with no slashes and no leading dot.",
            ));
        }
        let folder = self.root.join(name);
        Space::create(&folder, name)?;
        let space = Space::open(folder, self.owner, self.modules.clone(), &self.run).await?;
        let summary = space.summary();
        self.insert(space).await;
        Ok(summary)
    }

    async fn insert(&self, space: Arc<Space>) {
        let mut spaces = self.spaces.write().await;
        if let Some(existing) = spaces.get(&space.id()) {
            tracing::warn!(
                kept = %existing.folder().display(),
                skipped = %space.folder().display(),
                "two folders hold the same Space; the second stays closed"
            );
            return;
        }
        spaces.insert(space.id(), space);
    }
}

/// Reads a method's parameters. Unknown fields are ignored, so an older
/// engine accepts a newer window's call (ADR 0002, decision 8).
pub fn decode<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, Refusal> {
    serde_json::from_value(params)
        .map_err(|e| Refusal::invalid(format!("The call's parameters do not fit: {e}.")))
}
