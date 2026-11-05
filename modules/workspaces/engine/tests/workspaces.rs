//! The workspaces module through the kernel, as a window and the CLI use
//! it: in this machine's scope, its arrangement read at the log's position
//! and each change said in one event.

use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, Participant, PersonId, Refusal, SpaceId,
};
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

    /// A command by an Agent whose pass is for `space`.
    async fn agent(
        &self,
        agent: AgentId,
        space: SpaceId,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        let caller = Caller {
            participant: Participant::Agent(agent),
            only: Some(space),
        };
        let command = Some(CommandId::new());
        self.kernel
            .call(caller, method, None, command, params)
            .await
    }

    async fn space(&self, name: &str) -> SpaceId {
        let made = self.command("spaces.create", json!({ "name": name }));
        serde_json::from_value(made.await.unwrap()["id"].clone()).unwrap()
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
    let same = json!({ "pane": opened["pane"], "new": false, "at": null });
    assert_eq!(again, same);

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
    // A change answers where its event stands, so a window draws it first.
    assert_eq!(opened["at"], json!(1));
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

#[tokio::test]
async fn an_agent_arranges_its_own_spaces_panes_and_sees_the_others_when_let() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let (work, home) = (machine.space("Work").await, machine.space("Home").await);
    let page =
        |space, url| json!({ "space": space, "kind": "browser.browser", "args": { "url": url } });
    let theirs = machine
        .command("workspaces.open", page(home, "secret"))
        .await
        .unwrap();
    let person = machine
        .command("workspaces.open", page(work, "mine"))
        .await
        .unwrap();
    let agent = AgentId::new();
    let as_agent = |method: &'static str, params| machine.agent(agent, work, method, params);

    // Behind the wall, it sees its own Space's Panes only, with their args.
    let seen = as_agent("workspaces.panes", json!({})).await.unwrap();
    let panes = |seen: &Value| -> Vec<Value> {
        let workspaces = seen.as_array().unwrap().iter();
        let columns = workspaces.flat_map(|w| w["columns"].as_array().unwrap().clone());
        columns
            .flat_map(|c| c["panes"].as_array().unwrap().clone())
            .collect()
    };
    let only = panes(&seen);
    assert_eq!(only.len(), 1);
    assert_eq!(only[0]["args"]["url"], "mine");
    assert_eq!(only[0]["yours"], false);
    // Nothing beside another Space's Pane while the wall stands.
    let beside = |pane: &Value| json!({ "pane": pane, "side": "right" });
    let thread = json!({ "thread": "t" });
    let hidden = as_agent(
        "workspaces.open_pane",
        json!({ "kind": "agents.thread", "args": thread, "beside": beside(&theirs["pane"]) }),
    );
    assert_eq!(hidden.await.unwrap_err().code, Code::NotFound);
    // Any other method of the machine stays past the wall.
    let list = as_agent("workspaces.list", json!({})).await;
    assert_eq!(list.unwrap_err().code, Code::Forbidden);
    // A terminal runs as the Person: an Agent opens none.
    let terminal = json!({ "kind": "terminal.terminal", "args": {} });
    let refused = as_agent("workspaces.open_pane", terminal).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
    // A browser opens at a web address, never at the Person's files.
    for args in [
        json!({ "url": "file:///etc/passwd" }),
        json!({ "tabs": [], "shown": 0 }),
    ] {
        let browser = json!({ "kind": "browser.browser", "args": args });
        let refused = as_agent("workspaces.open_pane", browser).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid);
    }
    // A Person arranges with their own methods.
    let by_person = machine.command(
        "workspaces.open_pane",
        json!({ "kind": "agents.thread", "args": {} }),
    );
    assert_eq!(by_person.await.unwrap_err().code, Code::Invalid);

    // The Person lets the Space see the others: their outline, no args.
    let let_see = json!({ "space": work, "sees_others": true });
    machine.command("spaces.update", let_see).await.unwrap();
    let all = panes(&as_agent("workspaces.panes", json!({})).await.unwrap());
    let home_pane = all.iter().find(|p| p["id"] == theirs["pane"]).unwrap();
    assert_eq!(home_pane["kind"], "browser.browser");
    assert!(
        home_pane.get("args").is_none(),
        "no Project is told another's args"
    );

    // It opens its Thread beside the other Space's Pane, in its own Space.
    let opened = as_agent(
        "workspaces.open_pane",
        json!({ "kind": "agents.thread", "args": thread, "beside": beside(&theirs["pane"]) }),
    )
    .await
    .unwrap();
    assert_eq!(opened["new"], true);
    let arranged = machine.list().await;
    let kept = arranged.to_string();
    assert!(
        kept.contains(&agent.to_string()),
        "the engine keeps who opened it"
    );
    let mine = panes(&as_agent("workspaces.panes", json!({})).await.unwrap());
    let mine = mine.iter().find(|p| p["id"] == opened["pane"]).unwrap();
    assert_eq!(
        (mine["space"].clone(), mine["yours"].clone()),
        (json!(work), json!(true))
    );

    // It moves and closes what it opened, and nothing else.
    let moving = |pane: &Value| json!({ "pane": pane, "beside": beside(&person["pane"]) });
    as_agent("workspaces.move_own", moving(&opened["pane"]))
        .await
        .unwrap();
    let not_its = as_agent(
        "workspaces.move_own",
        json!({ "pane": person["pane"], "beside": beside(&opened["pane"]) }),
    );
    assert_eq!(not_its.await.unwrap_err().code, Code::Forbidden);
    let other = as_agent("workspaces.close_own", json!({ "pane": theirs["pane"] }));
    assert_eq!(other.await.unwrap_err().code, Code::Forbidden);
    let another = machine.agent(
        AgentId::new(),
        work,
        "workspaces.close_own",
        json!({ "pane": opened["pane"] }),
    );
    assert_eq!(another.await.unwrap_err().code, Code::Forbidden);
    as_agent("workspaces.close_own", json!({ "pane": opened["pane"] }))
        .await
        .unwrap();
    assert_eq!(
        panes(&as_agent("workspaces.panes", json!({})).await.unwrap()).len(),
        2
    );
}

#[tokio::test]
async fn the_workspaces_set_aside_stay_and_come_back_after_the_ones_there_are() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let machine = Machine::open(root.path(), owner).await;
    let space = SpaceId::new();
    let open =
        |url: &str| json!({ "space": space, "kind": "browser.browser", "args": { "url": url } });

    // Nothing to set aside: nothing changes or is said.
    let nothing = machine
        .command("workspaces.set_aside", json!({}))
        .await
        .unwrap();
    assert_eq!(nothing["at"], Value::Null);
    assert_eq!(machine.list().await["aside"], Value::Null);

    machine.command("workspaces.open", open("a")).await.unwrap();
    machine.command("workspaces.open", open("b")).await.unwrap();
    let before = machine.list().await["workspaces"].clone();
    machine
        .command("workspaces.set_aside", json!({}))
        .await
        .unwrap();
    let aside = machine.list().await;
    assert_eq!(aside["aside"], json!({ "workspaces": 1, "panes": 2 }));
    let empty = aside["workspaces"].as_array().unwrap();
    assert_eq!(empty.len(), 1);
    assert!(empty[0]["columns"].as_array().unwrap().is_empty());
    // The event says the arrangement after it and what is aside.
    let (kind, said) = machine.events().await.pop().unwrap();
    assert_eq!(kind, "set_aside");
    assert_eq!(said["aside"], aside["aside"]);
    assert_eq!(said["workspaces"], aside["workspaces"]);

    // Kept across a restart.
    drop(machine);
    let machine = Machine::open(root.path(), owner).await;
    assert_eq!(machine.list().await["aside"]["panes"], 2);

    // Work goes on; what comes back goes after it, a Pane shown in both
    // once.
    machine.command("workspaces.open", open("c")).await.unwrap();
    machine.command("workspaces.open", open("a")).await.unwrap();
    machine
        .command("workspaces.bring_back", json!({}))
        .await
        .unwrap();
    let back = machine.list().await;
    assert_eq!(back["aside"], Value::Null);
    let urls: Vec<Value> = back["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|w| w["columns"].as_array().unwrap().clone())
        .flat_map(|c| c["panes"].as_array().unwrap().clone())
        .map(|p| p["args"]["url"].clone())
        .collect();
    assert_eq!(urls, [json!("c"), json!("a"), json!("b")]);
    assert_eq!(back["workspaces"][1]["id"], before[0]["id"]);
    let last = back["workspaces"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert!(last["columns"].as_array().unwrap().is_empty());
    let (kind, said) = machine.events().await.pop().unwrap();
    assert_eq!(kind, "brought_back");
    assert_eq!(said["aside"], Value::Null);
}
