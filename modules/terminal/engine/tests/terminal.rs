//! The terminal module through the kernel, as a window uses it: a program
//! starts on a PTY, prints, reads what is typed, and ends.

use banda_kernel::{AgentId, Code, CommandId, Kernel, Participant, PersonId, SpaceId, Stream};
use banda_terminal::Terminals;
use banda_terminal::model::{Piece, TerminalId};
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

    async fn call(&self, method: &str, params: Value) -> Result<Value, banda_kernel::Refusal> {
        self.call_in(self.space, method, params).await
    }

    async fn call_in(
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

    async fn another_space(&self) -> SpaceId {
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
    async fn run(&self, script: &str) -> TerminalId {
        let terminal = TerminalId::new();
        self.open(terminal, script).await.unwrap();
        terminal
    }

    async fn open(
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
            Some(Piece::Resized { .. }) => {}
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

#[tokio::test]
async fn a_window_resizes_a_terminal_and_every_watcher_hears_it() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let mut watching = world.watch(terminal).await;
    until(&mut watching, |s| s.contains("started")).await;
    let size = json!({ "cols": 120, "rows": 40 });
    world
        .call(
            "terminal.resize",
            json!({ "terminal": terminal, "size": size }),
        )
        .await
        .unwrap();
    let heard = tokio::time::timeout(Duration::from_secs(5), watching.recv())
        .await
        .unwrap()
        .map(|v| serde_json::from_value::<Piece>(v).unwrap());
    let Some(Piece::Resized { size }) = heard else {
        panic!("it heard the size: {heard:?}")
    };
    assert_eq!((size.cols, size.rows), (120, 40));
    world
        .call("terminal.close", json!({ "terminal": terminal }))
        .await
        .unwrap();
}

#[tokio::test]
async fn opening_a_terminal_whose_program_ended_runs_it_again() {
    let world = World::new().await;
    let script = "n=$(cat runs 2>/dev/null || echo 0); n=$((n+1)); echo $n > runs; echo run $n";
    let terminal = world.run(script).await;
    let mut watching = world.watch(terminal).await;
    let (screen, ended) = until(&mut watching, |_| false).await;
    assert!(screen.contains("run 1"), "{screen:?}");
    assert!(matches!(ended, Some(Piece::Exited { .. })), "{ended:?}");

    world.open(terminal, script).await.unwrap();
    let mut again = world.watch(terminal).await;
    let (screen, _) = until(&mut again, |s| s.contains("run 2")).await;
    assert!(screen.contains("run 2"), "{screen:?}");
    // What watched the first run ends with it.
    let (_, ended) = until(&mut watching, |_| false).await;
    assert!(ended.is_none(), "the old watch ended: {ended:?}");
}

#[tokio::test]
async fn a_terminal_belongs_to_its_space() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let other = world.another_space().await;
    let closing = json!({ "terminal": terminal });
    world
        .call_in(other, "terminal.close", closing.clone())
        .await
        .unwrap();
    let open = json!({ "terminal": terminal, "program": "true" });
    let taken = world
        .call_in(other, "terminal.open", open)
        .await
        .unwrap_err();
    assert_eq!(taken.code, Code::Conflict);
    // It still runs in its own Space.
    let typed = json!({ "terminal": terminal, "data": "x" });
    world.call("terminal.write", typed).await.unwrap();
    world.call("terminal.close", closing).await.unwrap();
}
