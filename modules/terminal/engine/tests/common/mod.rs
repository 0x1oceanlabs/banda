//! What every test of the terminal module shares: a kernel with the
//! module, a Space, and what its terminals say.
// Each test file uses some of these.
#![allow(dead_code)]

use banda_kernel::{CommandId, Kernel, Participant, PersonId, SpaceId, Stream};
use banda_terminal::Terminals;
use banda_terminal::model::{Piece, TerminalId};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

pub struct World {
    pub kernel: Arc<Kernel>,
    pub owner: PersonId,
    pub space: SpaceId,
    _root: tempfile::TempDir,
}

impl World {
    pub async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(Terminals::new())
            .open()
            .await
            .unwrap();
        let space = kernel
            .call(
                Participant::Person(owner),
                "spaces.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let space = serde_json::from_value(space["id"].clone()).unwrap();
        World {
            kernel,
            owner,
            space,
            _root: root,
        }
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, banda_kernel::Refusal> {
        self.call_in(self.space, method, params).await
    }

    pub async fn call_in(
        &self,
        space: SpaceId,
        method: &str,
        params: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        let person = Participant::Person(self.owner);
        self.kernel
            .call(person, method, Some(space), None, params)
            .await
    }

    pub async fn another_space(&self) -> SpaceId {
        let person = Participant::Person(self.owner);
        let space = self
            .kernel
            .call(
                person,
                "spaces.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Other" }),
            )
            .await
            .unwrap();
        serde_json::from_value(space["id"].clone()).unwrap()
    }

    /// Opens a terminal running `sh -c script`.
    pub async fn run(&self, script: &str) -> TerminalId {
        let terminal = TerminalId::new();
        self.open(terminal, script).await.unwrap();
        terminal
    }

    pub async fn open(
        &self,
        terminal: TerminalId,
        script: &str,
    ) -> Result<Value, banda_kernel::Refusal> {
        let open = json!({
            "terminal": terminal, "program": "sh", "args": ["-c", script],
            "size": { "cols": 100, "rows": 30 },
        });
        self.call("terminal.open", open).await
    }

    /// `space`'s servers, as the bar's widget hears them (ADR 0044).
    pub async fn ports(&self, space: SpaceId) -> Stream {
        let person = Participant::Person(self.owner);
        (self.kernel)
            .stream(person, "terminal.ports", Some(space), json!({}))
            .await
            .unwrap()
    }

    pub async fn watch(&self, terminal: TerminalId) -> Stream {
        let person = Participant::Person(self.owner);
        self.kernel
            .stream(
                person,
                "terminal.watch",
                Some(self.space),
                json!({ "terminal": terminal }),
            )
            .await
            .unwrap()
    }
}

/// What the stream says until `done` holds for the screen so far, and
/// how it ended, if it did.
pub async fn until(stream: &mut Stream, done: impl Fn(&str) -> bool) -> (String, Option<Piece>) {
    let mut screen = String::new();
    loop {
        match piece(stream).await {
            Some(Piece::Snapshot { history, .. }) => screen = history,
            Some(Piece::Output { text }) => screen.push_str(&text),
            Some(Piece::Resized { .. } | Piece::Titled { .. }) => {}
            ended @ (Some(Piece::Exited { .. }) | None) => return (screen, ended),
        }
        if done(&screen) {
            return (screen, None);
        }
    }
}

/// What the stream says next; `None` once it ended.
pub async fn piece(stream: &mut Stream) -> Option<Piece> {
    tokio::time::timeout(Duration::from_secs(5), stream.recv())
        .await
        .expect("the terminal said something in time")
        .map(|v| serde_json::from_value::<Piece>(v).unwrap())
}

/// The next piece the stream says that `wanted` holds for.
pub async fn next(stream: &mut Stream, wanted: impl Fn(&Piece) -> bool) -> Option<Piece> {
    loop {
        let piece = piece(stream).await;
        if piece.as_ref().is_none_or(&wanted) {
            return piece;
        }
    }
}
