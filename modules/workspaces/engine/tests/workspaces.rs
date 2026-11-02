//! The workspaces module through the kernel, as a window and the CLI use
//! it: in this machine's scope, its arrangement read at the log's position
//! and each change said in one event.

use banda_kernel::{Code, CommandId, Kernel, Participant, PersonId, Refusal, SpaceId};
use banda_workspaces::Workspaces;
use banda_workspaces::model::{ColumnId, PaneId, WorkspaceId};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

struct Machine {
    kernel: Arc<Kernel>,
    owner: PersonId,
}

impl Machine {
    async fn open(root: &Path, owner: PersonId) -> Machine {
        let kernel = Kernel::builder(root.join("spaces"), root.join("data"), owner)
            .machine(root.join("state/machine"))
            .module(Workspaces::new())
            .open()
            .await
            .unwrap();
        Machine { kernel, owner }
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        let command = Some(CommandId::new());
        self.kernel
            .call(person, method, None, command, params)
            .await
    }

    async fn list(&self) -> Value {
        let person = Participant::Person(self.owner);
        let arranged = self
            .kernel
            .call(person, "workspaces.list", None, None, json!({}));
        arranged.await.unwrap()
    }

    async fn events(&self) -> Vec<(String, Value)> {
        let machine = self.kernel.machine().unwrap();
        let person = Participant::Person(self.owner);
        let log = self.kernel.follow(person, machine).await.unwrap();
        let events = log.events_after(0, Default::default(), 100).await.unwrap();
        events.into_iter().map(|e| (e.kind, e.payload)).collect()
    }
}

#[tokio::test]
async fn the_arrangement_is_kept_said_in_events_and_survives_a_restart() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let machine = Machine::open(root.path(), owner).await;
    let space = SpaceId::new();

    // It starts as one empty workspace, whose ID holds from the first read.
    let first = machine.list().await;
    assert_eq!(first["workspaces"].as_array().unwrap().len(), 1);
    assert_eq!(machine.list().await["workspaces"], first["workspaces"]);
    let bottom = first["workspaces"][0]["id"].clone();

    let pane = json!({ "space": space, "kind": "browser.browser", "args": { "url": "a" } });
    let opened = machine
        .command("workspaces.open", pane.clone())
        .await
        .unwrap();
    assert_eq!(opened["new"], true);
    // Shown already: it is named, and nothing changes or is said.
    let again = machine.command("workspaces.open", pane).await.unwrap();
    assert_eq!(again, json!({ "pane": opened["pane"], "new": false }));

    let arranged = machine.list().await;
    let workspaces = arranged["workspaces"].as_array().unwrap();
    assert_eq!(workspaces.len(), 2);
    assert_eq!(workspaces[0]["id"], bottom);
    let shown = &workspaces[0]["columns"][0]["panes"][0];
    assert_eq!(shown["id"], opened["pane"]);
    assert_eq!(shown["kind"], "browser.browser");

    // New args say only those; a column's width says the whole again.
    let args = json!({ "pane": opened["pane"], "args": { "url": "b" } });
    machine
        .command("workspaces.update", args.clone())
        .await
        .unwrap();
    machine
        .command("workspaces.update", args.clone())
        .await
        .unwrap();
    let column = workspaces[0]["columns"][0]["id"].clone();
    let size = json!({ "column": column, "width": "1/2" });
    machine.command("workspaces.size", size).await.unwrap();
    let events = machine.events().await;
    let kinds: Vec<&str> = events.iter().map(|(kind, _)| kind.as_str()).collect();
    assert_eq!(kinds, ["opened", "updated", "sized"]);
    assert_eq!(events[0].1["workspaces"], arranged["workspaces"]);
    assert_eq!(events[1].1, args);
    let now = machine.list().await;
    assert_eq!(events[2].1["workspaces"], now["workspaces"]);
    assert_eq!(now["workspaces"][0]["columns"][0]["width"], "1/2");

    // A wrong one is refused, and changes nothing.
    let gone = json!({ "pane": PaneId::new() });
    let refused = machine.command("workspaces.close", gone).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);

    drop(machine);
    let machine = Machine::open(root.path(), owner).await;
    assert_eq!(machine.list().await["workspaces"], now["workspaces"]);
}

#[tokio::test]
async fn a_windows_arrangement_is_taken_once() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let workspace = WorkspaceId::new();
    let window = json!({ "workspaces": [{
        "id": workspace,
        "columns": [{ "id": ColumnId::new(), "width": "1/2", "panes": [
            { "id": PaneId::new(), "space": SpaceId::new(), "kind": "agents.threads", "args": {} }
        ] }]
    }] });
    machine
        .command("workspaces.take", window.clone())
        .await
        .unwrap();
    let arranged = machine.list().await;
    assert_eq!(arranged["workspaces"][0]["id"], json!(workspace));
    assert_eq!(arranged["workspaces"][0]["columns"][0]["width"], "1/2");
    assert_eq!(arranged["workspaces"].as_array().unwrap().len(), 2);

    let twice = machine
        .command("workspaces.take", window)
        .await
        .unwrap_err();
    assert_eq!(twice.code, Code::Conflict);
    assert_eq!(machine.list().await, arranged);
}
