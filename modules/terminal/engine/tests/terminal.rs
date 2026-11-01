//! The terminal module through the kernel, as a window uses it: a program
//! starts on a PTY, prints, reads what is typed, and ends.

use bandaso_kernel::{AgentId, Code, CommandId, Kernel, Participant, PersonId, SpaceId, Stream};
use bandaso_terminal::Terminals;
use bandaso_terminal::model::{Piece, TerminalId};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    space: SpaceId,
    _root: tempfile::TempDir,
}

impl World {
    async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let kernel = Kernel::builder(root.path(), owner)
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

    async fn call(&self, method: &str, params: Value) -> Result<Value, bandaso_kernel::Refusal> {
        let person = Participant::Person(self.owner);
        self.kernel
            .call(person, method, Some(self.space), None, params)
            .await
    }

    /// Opens a terminal running `sh -c script`.
    async fn run(&self, script: &str) -> TerminalId {
        let terminal = TerminalId::new();
        let open = json!({
            "terminal": terminal, "program": "sh", "args": ["-c", script],
            "size": { "cols": 100, "rows": 30 },
        });
        self.call("terminal.open", open).await.unwrap();
        terminal
    }

    async fn watch(&self, terminal: TerminalId) -> Stream {
        let person = Participant::Person(self.owner);
        self.kernel
            .stream(
                person,
                "terminal.watch",
                self.space,
                json!({ "terminal": terminal }),
            )
            .await
            .unwrap()
    }
}

/// What the stream says until `done` holds for the screen so far, and
/// how it ended, if it did.
async fn until(stream: &mut Stream, done: impl Fn(&str) -> bool) -> (String, Option<Piece>) {
    let mut screen = String::new();
    loop {
        let piece = tokio::time::timeout(Duration::from_secs(5), stream.recv())
            .await
            .expect("the terminal said something in time")
            .map(|v| serde_json::from_value::<Piece>(v).unwrap());
        match piece {
            Some(Piece::Snapshot { history, .. }) => screen = history,
            Some(Piece::Output { text }) => screen.push_str(&text),
            ended @ (Some(Piece::Exited { .. }) | None) => return (screen, ended),
        }
        if done(&screen) {
            return (screen, None);
        }
    }
}

#[tokio::test]
async fn a_program_prints_reads_what_is_typed_and_ends() {
    let world = World::new().await;
    let terminal = world
        .run("printf 'name? '; read name; echo \"hello $name\"; exit 3")
        .await;
    let mut watching = world.watch(terminal).await;
    let (screen, _) = until(&mut watching, |s| s.contains("name? ")).await;
    assert!(screen.contains("name? "), "{screen:?}");
    world
        .call(
            "terminal.write",
            json!({ "terminal": terminal, "data": "Ann\r" }),
        )
        .await
        .unwrap();
    let (screen, ended) = until(&mut watching, |_| false).await;
    assert!(screen.contains("hello Ann"), "{screen:?}");
    let Some(Piece::Exited { ended }) = ended else {
        panic!("it ended: {ended:?}")
    };
    assert_eq!(ended.code, Some(3));

    // A window that opens it later sees the same screen, and how it ended.
    let mut later = world.watch(terminal).await;
    let Some(Piece::Snapshot { history, ended, .. }) = later
        .recv()
        .await
        .map(|v| serde_json::from_value(v).unwrap())
    else {
        panic!("a snapshot first")
    };
    assert!(history.contains("hello Ann"));
    assert_eq!(ended.and_then(|e| e.code), Some(3));
}

#[tokio::test]
async fn a_closed_terminal_stops_its_program_and_every_watch() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let mut watching = world.watch(terminal).await;
    until(&mut watching, |s| s.contains("started")).await;
    world
        .call("terminal.close", json!({ "terminal": terminal }))
        .await
        .unwrap();
    let (_, ended) = until(&mut watching, |_| false).await;
    assert!(ended.is_none(), "the watch ended");
    let gone = world
        .call(
            "terminal.write",
            json!({ "terminal": terminal, "data": "x" }),
        )
        .await
        .unwrap_err();
    assert_eq!(gone.code, Code::NotFound);
}

#[tokio::test]
async fn only_a_person_runs_a_terminal() {
    let world = World::new().await;
    let open = json!({ "terminal": TerminalId::new(), "program": "true" });
    let agent = Participant::Agent(AgentId::new());
    let refused = world
        .kernel
        .call(agent, "terminal.open", Some(world.space), None, open)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let tiny = json!({ "terminal": TerminalId::new(), "size": { "cols": 0, "rows": 0 } });
    let refused = world.call("terminal.open", tiny).await.unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}
