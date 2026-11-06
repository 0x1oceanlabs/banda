#![allow(dead_code)]

//! The test world: a kernel with the files module, a Project in a
//! throwaway folder, and calls as the Person and as an Agent.

use banda_files::Files;
use banda_kernel::{
    AgentId, Caller, CommandId, Kernel, Participant, PersonId, ProjectId, Refusal, Stream,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;

pub struct World {
    pub kernel: Arc<Kernel>,
    pub owner: PersonId,
    pub project: ProjectId,
    pub folder: PathBuf,
    pub root: tempfile::TempDir,
}

impl World {
    pub async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let config = root.path().join("config");
        let files = Files::new().config_in(config).thumbs_in(
            root.path().join(".cache"),
            Some(root.path().join(".thumbnails")),
        );
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(files)
            .open()
            .await
            .unwrap();
        let made = (kernel.call(
            Participant::Person(owner),
            "projects.create",
            None,
            Some(CommandId::new()),
            json!({ "name": "Work" }),
        ))
        .await
        .unwrap();
        let project: ProjectId = serde_json::from_value(made["id"].clone()).unwrap();
        let folder = kernel.project(project).await.unwrap().folder();
        let folder = folder.canonicalize().unwrap();
        World {
            kernel,
            owner,
            project,
            folder,
            root,
        }
    }

    pub fn write(&self, path: &str, text: &str) {
        let path = self.folder.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Banda's settings folder, as the engine gives it the module.
    pub fn config(&self) -> PathBuf {
        self.root.path().join("config")
    }

    /// Banda's cache of files' small pictures.
    pub fn cache(&self) -> PathBuf {
        self.root.path().join(".cache")
    }

    /// freedesktop's cache of them, as the engine is given it.
    pub fn shared(&self) -> PathBuf {
        self.root.path().join(".thumbnails")
    }

    /// A folder beside the Project's, outside it.
    pub fn outside(&self) -> PathBuf {
        let outside = self.root.path().canonicalize().unwrap().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        outside
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        (self.kernel)
            .call(person, method, Some(self.project), None, params)
            .await
    }

    /// The call as an Agent's, whose pass walls it in the Project.
    pub async fn call_as_agent(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let agent = Caller {
            participant: Participant::Agent(AgentId::new()),
            only: Some(self.project),
        };
        self.kernel.call(agent, method, None, None, params).await
    }

    pub async fn ask<T: DeserializeOwned>(&self, method: &str, params: Value) -> T {
        serde_json::from_value(self.call(method, params).await.unwrap()).unwrap()
    }

    /// The Agent's command, which its pass walls in the Project.
    pub async fn command_as_agent(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let agent = Caller {
            participant: Participant::Agent(AgentId::new()),
            only: Some(self.project),
        };
        (self.kernel)
            .call(agent, method, None, Some(CommandId::new()), params)
            .await
    }

    /// The Person's command, as the window sends it, with an ID of its own.
    pub async fn command(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        (self.kernel)
            .call(
                person,
                method,
                Some(self.project),
                Some(CommandId::new()),
                params,
            )
            .await
    }

    /// A stream asked as the Person: refused before it starts, or its
    /// first piece.
    pub async fn first(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        let mut stream = (self.kernel)
            .stream(person, method, Some(self.project), params)
            .await?;
        Ok(stream.recv().await.unwrap_or(Value::Null))
    }

    /// A stream asked as an Agent, whose pass walls it in the Project.
    pub async fn stream_as_agent(&self, method: &str, params: Value) -> Result<Stream, Refusal> {
        let agent = Caller {
            participant: Participant::Agent(AgentId::new()),
            only: Some(self.project),
        };
        self.kernel.stream(agent, method, None, params).await
    }
}
