//! The workspaces module through the kernel, as a window and the CLI use
//! it: in this machine's scope, its arrangement read at the log's position
//! and each change said in one event.

use banda_kernel::{
    AgentId, Answer, Caller, Code, CommandId, Kernel, Participant, PersonId, ProjectId, Refusal,
};
use banda_workspaces::Workspaces;
use banda_workspaces::model::{ColumnId, PaneId, Seed, WorkspaceId};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

struct Machine {
    kernel: Arc<Kernel>,
    owner: PersonId,
}

impl Machine {
    async fn open(root: &Path, owner: PersonId) -> Machine {
        // As the engine builds it, from the window parts (ADR 0065,
        // decision 7).
        let workspaces = Workspaces::new().grouped_kinds(["agents.thread"]);
        let kernel = Kernel::builder(root.join("projects"), root.join("data"), owner)
            .machine(root.join("state/machine"))
            .module(workspaces)
            .open()
            .await
            .unwrap();
        Machine { kernel, owner }
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        self.command_as(CommandId::new(), method, params).await
    }

    /// A command the Person sends under the ID `command`.
    async fn command_as(
        &self,
        command: CommandId,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        let answer = self.answer(command, method, params);
        answer.await.map(|answer| answer.value)
    }

    /// As `command_as`, with where the kernel says the command stands in
    /// the log: the event it wrote, none when it wrote none.
    async fn answer(
        &self,
        command: CommandId,
        method: &str,
        params: Value,
    ) -> Result<Answer, Refusal> {
        let person = Participant::Person(self.owner);
        self.kernel
            .answer(person, method, None, Some(command), params)
            .await
    }

    /// A command by an Agent whose pass is for `project`.
    async fn agent(
        &self,
        agent: AgentId,
        project: ProjectId,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        self.agent_as(CommandId::new(), agent, project, method, params)
            .await
    }

    /// As `agent`, under the ID `command`.
    async fn agent_as(
        &self,
        command: CommandId,
        agent: AgentId,
        project: ProjectId,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        let answer = self.agent_answer(command, agent, project, method, params);
        answer.await.map(|answer| answer.value)
    }

    /// As `agent_as`, with where the kernel says the command stands in the
    /// log, as `answer`.
    async fn agent_answer(
        &self,
        command: CommandId,
        agent: AgentId,
        project: ProjectId,
        method: &str,
        params: Value,
    ) -> Result<Answer, Refusal> {
        let caller = Caller {
            participant: Participant::Agent(agent),
            only: Some(project),
        };
        self.kernel
            .answer(caller, method, None, Some(command), params)
            .await
    }

    async fn project(&self, name: &str) -> ProjectId {
        let made = self.command("projects.create", json!({ "name": name }));
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

/// The answer to a command that changed nothing: it said nothing, so the
/// kernel gives it no place in the log (#880).
fn unplaced(value: Value) -> Answer {
    Answer { value, at: None }
}

/// Every Pane of `workspaces`, as `list` and `panes` say them, from the top
/// down and from the left.
fn panes(workspaces: &Value) -> Vec<Value> {
    let workspaces = workspaces.as_array().unwrap().iter();
    let columns = workspaces.flat_map(|w| w["columns"].as_array().unwrap());
    let panes = columns.flat_map(|c| c["panes"].as_array().unwrap());
    panes.cloned().collect()
}

#[tokio::test]
async fn the_arrangement_is_kept_said_in_events_and_survives_a_restart() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let machine = Machine::open(root.path(), owner).await;
    let project = ProjectId::new();

    // It starts as one empty workspace, whose ID holds from the first read.
    let first = machine.list().await;
    assert_eq!(first["workspaces"].as_array().unwrap().len(), 1);
    assert_eq!(machine.list().await["workspaces"], first["workspaces"]);
    let bottom = first["workspaces"][0]["id"].clone();

    let pane = json!({ "project": project, "kind": "browser.browser", "args": { "url": "a" } });
    let open = |pane| machine.answer(CommandId::new(), "workspaces.open", pane);
    let Answer { value: opened, at } = open(pane.clone()).await.unwrap();
    assert_eq!(opened["new"], true);
    // Shown already: it is named, and nothing changes or is said.
    let same = json!({ "pane": opened["pane"], "new": false });
    assert_eq!(open(pane).await.unwrap(), unplaced(same));

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
    // A change is answered where its event stands, so a window draws it
    // first.
    assert_eq!(at, Some(1));
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
            { "id": PaneId::new(), "project": ProjectId::new(), "kind": "agents.threads", "args": {} }
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
async fn an_agent_arranges_its_own_projects_panes_and_sees_the_others_when_let() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let (work, home) = (machine.project("Work").await, machine.project("Home").await);
    let page = |project, url| json!({ "project": project, "kind": "browser.browser", "args": { "url": url } });
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

    // Behind the wall, it sees its own Project's Panes only, with their args.
    let seen = as_agent("workspaces.panes", json!({})).await.unwrap();
    let only = panes(&seen);
    assert_eq!(only.len(), 1);
    assert_eq!(only[0]["args"]["url"], "mine");
    assert_eq!(only[0]["yours"], false);
    // Nothing beside another Project's Pane while the wall stands.
    let beside = |pane: &Value| json!({ "pane": pane, "side": "right" });
    let thread = json!({ "thread": uuid::Uuid::now_v7() });
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
    assert_eq!(refused.unwrap_err().code, Code::Forbidden);
    // A browser opens at a web address, never at the Person's files, and
    // its tabs are the Person's to give.
    for (args, code) in [
        (json!({ "url": "file:///etc/passwd" }), Code::Invalid),
        (json!({}), Code::Invalid),
        (json!({ "tabs": [], "shown": 0 }), Code::Forbidden),
        (
            json!({ "url": "https://a.test", "tabs": [] }),
            Code::Forbidden,
        ),
    ] {
        let browser = json!({ "kind": "browser.browser", "args": args });
        let refused = as_agent("workspaces.open_pane", browser).await;
        assert_eq!(refused.unwrap_err().code, code);
    }
    // A Person arranges with their own methods.
    let by_person = machine.command(
        "workspaces.open_pane",
        json!({ "kind": "agents.thread", "args": {} }),
    );
    assert_eq!(by_person.await.unwrap_err().code, Code::Invalid);

    // The Person lets the Project see the others: their outline, no args.
    let let_see = json!({ "project": work, "sees_others": true });
    machine.command("projects.update", let_see).await.unwrap();
    let all = panes(&as_agent("workspaces.panes", json!({})).await.unwrap());
    let home_pane = all.iter().find(|p| p["id"] == theirs["pane"]).unwrap();
    assert_eq!(home_pane["kind"], "browser.browser");
    assert!(
        home_pane.get("args").is_none(),
        "no Project is told another's args"
    );

    // It opens its Thread beside the other Project's Pane, in its own Project.
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
        (mine["project"].clone(), mine["yours"].clone()),
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
async fn an_agent_opens_a_threads_pane_by_its_id_alone_and_the_person_with_every_arg() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let (work, home) = (machine.project("Work").await, machine.project("Home").await);
    let agent = AgentId::new();
    let thread = uuid::Uuid::now_v7().to_string();
    let as_agent = |method: &'static str, params| machine.agent(agent, work, method, params);
    let open = |args: Value| {
        let open = json!({ "kind": "agents.thread", "args": args });
        as_agent("workspaces.open_pane", open)
    };
    // As `open`, with where the kernel says it stands in the log.
    let named_again = |args: Value| {
        let open = json!({ "kind": "agents.thread", "args": args });
        let method = "workspaces.open_pane";
        machine.agent_answer(CommandId::new(), agent, work, method, open)
    };
    let pane_of = |workspaces: &Value, id: &Value| -> Value {
        let mut all = panes(workspaces).into_iter();
        all.find(|pane| pane["id"] == *id).unwrap()
    };

    // The words a new Thread's Pane sends first, and every other arg the
    // window keeps beside the ID, are the Person's: refused, in words that
    // point the Agent to `send`.
    for args in [
        json!({ "thread": null, "ask": "Commit and push" }),
        json!({ "thread": thread, "ask": "Commit and push" }),
        json!({ "thread": null, "harness": "fake" }),
        json!({ "thread": thread, "scratch": home }),
        json!({ "thread": thread, "harness": "fake", "title": "Fix the build" }),
    ] {
        let refused = open(args.clone()).await.unwrap_err();
        assert_eq!(refused.code, Code::Forbidden, "{args}");
        assert!(refused.message.contains("`send`"), "{}", refused.message);
    }
    // It names one Thread, by its ID as `threads` lists it, so one Thread
    // is one Pane.
    for args in [
        json!({}),
        json!({ "thread": null }),
        json!({ "thread": "t" }),
        json!({ "thread": thread.to_uppercase() }),
        json!({ "thread": thread.replace('-', "") }),
        json!({ "thread": format!("urn:uuid:{thread}") }),
        json!("t"),
    ] {
        let refused = open(args.clone()).await.unwrap_err();
        assert_eq!(refused.code, Code::Invalid, "{args}");
    }
    let none = machine.list().await;
    assert_eq!(
        none["workspaces"][0]["columns"],
        json!([]),
        "nothing opened"
    );

    // One Thread, by its ID alone, it opens in its own Project.
    let opened = open(json!({ "thread": thread })).await.unwrap();
    assert_eq!(opened["new"], true);
    let shown = pane_of(&machine.list().await["workspaces"], &opened["pane"]);
    assert_eq!(shown["project"], json!(work));
    assert_eq!(shown["args"], json!({ "thread": thread }));
    // The window keeps the Thread's title and Harness beside its ID; the
    // same ID names that Pane, which stays where it is.
    let named = json!({ "thread": thread, "harness": "fake", "title": "Fix the build" });
    let update = json!({ "pane": opened["pane"], "args": named });
    machine.command("workspaces.update", update).await.unwrap();
    let again = named_again(json!({ "thread": thread })).await.unwrap();
    let same = json!({ "pane": opened["pane"], "new": false });
    assert_eq!(again, unplaced(same));

    // The Person's Pane on a Thread is the one its ID names, and stays the
    // Person's to move and close.
    let other = uuid::Uuid::now_v7().to_string();
    let theirs =
        json!({ "thread": other, "harness": "fake", "title": "Release", "details": false });
    let shows = json!({ "project": work, "kind": "agents.thread", "args": theirs });
    let person = machine.command("workspaces.open", shows).await.unwrap();
    let named = named_again(json!({ "thread": other })).await.unwrap();
    let same = json!({ "pane": person["pane"], "new": false });
    assert_eq!(named, unplaced(same));
    let seen = as_agent("workspaces.panes", json!({})).await.unwrap();
    assert_eq!(pane_of(&seen, &person["pane"])["yours"], false);
    let close = as_agent("workspaces.close_own", json!({ "pane": person["pane"] }));
    assert_eq!(close.await.unwrap_err().code, Code::Forbidden);

    // The Person keeps every arg: a new Thread with the words it starts
    // with, in any Project.
    let asked = json!({ "thread": null, "harness": "fake", "title": "", "ask": "Commit and push" });
    let shows = json!({ "project": home, "kind": "agents.thread", "args": asked });
    let person = machine.command("workspaces.open", shows).await.unwrap();
    assert_eq!(person["new"], true);
    let kept = pane_of(&machine.list().await["workspaces"], &person["pane"]);
    assert_eq!(
        (kept["project"].clone(), kept["args"].clone()),
        (json!(home), asked)
    );
}

#[tokio::test]
async fn a_threads_pane_an_agent_opened_keeps_no_words_to_send() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let project = ProjectId::new();
    let thread = |by: Option<AgentId>, title: &str| {
        let args =
            json!({ "thread": null, "harness": "fake", "title": title, "ask": "Commit and push" });
        json!({ "id": PaneId::new(), "project": project, "kind": "agents.thread", "args": args, "by": by })
    };
    let kept = json!({ "workspaces": [{ "id": WorkspaceId::new(), "columns": [{
        "id": ColumnId::new(),
        "panes": [thread(Some(AgentId::new()), "Its"), thread(None, "Mine")],
    }] }] });
    machine.command("workspaces.take", kept).await.unwrap();
    let asks = |list: &Value| -> Vec<(Value, Value)> {
        let all = panes(&list["workspaces"]).into_iter();
        all.map(|pane| (pane["args"]["title"].clone(), pane["args"]["ask"].clone()))
            .collect()
    };

    // Its words are the Person's alone to give, whenever the Pane was
    // kept; the Person's own stay.
    let only = [
        (json!("Its"), Value::Null),
        (json!("Mine"), json!("Commit and push")),
    ];
    assert_eq!(asks(&machine.list().await), only);
}

#[tokio::test]
async fn an_agent_opens_the_diff_and_a_file_with_the_args_that_choose_what_they_show() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let work = machine.project("Work").await;
    let as_agent = |kind: &str, args: Value| {
        let open = json!({ "kind": kind, "args": args });
        machine.agent(AgentId::new(), work, "workspaces.open_pane", open)
    };

    // Staging, reverting and saving wait for the Person's click and typing.
    let staged = json!({ "scope": { "kind": "staged" }, "file": "src/main.rs", "view": {} });
    let at = json!({ "path": "README.md", "line": 3, "wrap": true, "source": true, "edit": true });
    for (kind, args) in [("git.diff", staged), ("files.file", at)] {
        let opened = as_agent(kind, args).await.unwrap();
        assert_eq!(opened["new"], true, "{kind}");
    }
}

#[tokio::test]
async fn an_agent_sees_of_a_browser_only_the_tabs_its_projects_agents_opened() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let (work, home) = (machine.project("Work").await, machine.project("Home").await);
    let tab = |id: &str, agents: Option<ProjectId>| {
        let mut tab = json!({ "id": id, "url": format!("https://example.com/{id}"), "title": id });
        if let Some(project) = agents {
            tab["agents"] = json!(project);
        }
        tab
    };
    let browser = |args| json!({ "project": work, "kind": "browser.browser", "args": args });
    let mixed = json!({
        "tabs": [tab("person", None), tab("a", Some(work)), tab("home", Some(home)), tab("b", Some(work))],
        "shown": 3,
    });
    machine
        .command("workspaces.open", browser(mixed.clone()))
        .await
        .unwrap();
    let address = json!({ "url": "https://example.com/opened" });
    machine
        .command("workspaces.open", browser(address.clone()))
        .await
        .unwrap();
    let args = |seen: &Value| -> Vec<Value> {
        let workspaces = seen.as_array().unwrap().iter();
        let columns = workspaces.flat_map(|w| w["columns"].as_array().unwrap().clone());
        let panes = columns.flat_map(|c| c["panes"].as_array().unwrap().clone());
        panes.map(|pane| pane["args"].clone()).collect()
    };

    // Behind the wall, a browser's tabs are its Project's Agents' alone,
    // the one shown among them; an address alone is an Agent's own.
    let seen = machine.agent(AgentId::new(), work, "workspaces.panes", json!({}));
    let seen = args(&seen.await.unwrap());
    let theirs = json!({ "tabs": [tab("a", Some(work)), tab("b", Some(work))], "shown": 1 });
    assert_eq!(seen.len(), 2);
    assert!(seen.contains(&theirs), "{seen:?}");
    assert!(seen.contains(&address), "{seen:?}");
    // The Person sees every tab.
    let person = args(
        &machine
            .command("workspaces.panes", json!({}))
            .await
            .unwrap(),
    );
    assert!(person.contains(&mixed), "{person:?}");
}

#[tokio::test]
async fn the_workspaces_set_aside_stay_and_come_back_after_the_ones_there_are() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let machine = Machine::open(root.path(), owner).await;
    let project = ProjectId::new();
    let open = |url: &str| json!({ "project": project, "kind": "browser.browser", "args": { "url": url } });

    // Nothing to set aside: nothing changes or is said. The answer is
    // still `{}`, which a window takes as done, never null.
    let nothing = machine.answer(CommandId::new(), "workspaces.set_aside", json!({}));
    assert_eq!(nothing.await.unwrap(), unplaced(json!({})));
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

#[tokio::test]
async fn a_pane_opened_grouped_is_a_group_from_its_opening_only() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let project = ProjectId::new();
    let open = json!({
        "project": project,
        "kind": "git.diff",
        "args": { "scope": { "kind": "changes" } },
        "grouped": true,
    });
    let column = |list: &Value| list["workspaces"][0]["columns"][0].clone();

    // Opened grouped, its column is a Group of its own at once.
    machine
        .command("workspaces.open", open.clone())
        .await
        .unwrap();
    let shown = column(&machine.list().await);
    assert!(shown["group"].is_string());

    // Taken out, it stays out: opened again, the one shown is only named.
    let out = json!({ "column": shown["id"], "toward": "right" });
    machine.command("workspaces.regroup", out).await.unwrap();
    machine.command("workspaces.open", open).await.unwrap();
    assert_eq!(column(&machine.list().await)["group"], Value::Null);
}

/// The seed of the command sent under `command`.
fn seed(command: CommandId) -> Seed {
    Seed::of(&command.to_string())
}

/// The column of `list`'s workspaces that shows the Pane `pane`.
fn column_of(list: &Value, pane: &Value) -> Value {
    let workspaces = list["workspaces"].as_array().unwrap().iter();
    let mut columns = workspaces.flat_map(|w| w["columns"].as_array().unwrap());
    let shows = |c: &&Value| {
        c["panes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == *pane)
    };
    columns.find(shows).unwrap().clone()
}

/// The Group of the column that shows `pane`; null when it is in none.
fn group_of(list: &Value, pane: &Value) -> Value {
    column_of(list, pane)["group"].clone()
}

#[tokio::test]
async fn a_thread_opens_as_a_group_of_its_own_as_its_kind_says() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let project = ProjectId::new();
    let thread =
        |id: &str| json!({ "project": project, "kind": "agents.thread", "args": { "thread": id } });

    // `grouped` left out, as the CLI sends it: the kind says it.
    let command = CommandId::new();
    let opened = machine
        .command_as(command, "workspaces.open", thread("a"))
        .await
        .unwrap();
    let list = machine.list().await;
    assert_eq!(
        group_of(&list, &opened["pane"]),
        json!(seed(command).group())
    );
    // `false` keeps it out.
    let mut out = thread("b");
    out["grouped"] = json!(false);
    let opened = machine.command("workspaces.open", out).await.unwrap();
    assert_eq!(
        group_of(&machine.list().await, &opened["pane"]),
        Value::Null
    );
    // Another kind opens in none.
    let diff = json!({ "project": project, "kind": "git.diff", "args": { "scope": { "kind": "changes" } } });
    let opened = machine.command("workspaces.open", diff).await.unwrap();
    assert_eq!(
        group_of(&machine.list().await, &opened["pane"]),
        Value::Null
    );
}

#[tokio::test]
async fn a_thread_an_agent_opens_is_a_group_of_its_own_from_its_opening_only() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let work = machine.project("Work").await;
    let agent = AgentId::new();
    let thread = json!({ "kind": "agents.thread", "args": { "thread": uuid::Uuid::now_v7() } });
    let open_pane = |command, params| {
        machine.agent_answer(command, agent, work, "workspaces.open_pane", params)
    };

    // Its column is a Group of its own at once, and the event says so.
    let asked = CommandId::new();
    let Answer { value: opened, .. } = open_pane(asked, thread.clone()).await.unwrap();
    let list = machine.list().await;
    let column = column_of(&list, &opened["pane"]);
    assert_eq!(column["group"], json!(seed(asked).group()));
    let (kind, said) = machine.events().await.pop().unwrap();
    assert_eq!(kind, "opened");
    assert_eq!(said["workspaces"], list["workspaces"]);

    // Taken out, it stays out: asked again, the one shown is only named,
    // and nothing is said.
    let out = json!({ "column": column["id"], "toward": "right" });
    machine.command("workspaces.regroup", out).await.unwrap();
    let said = machine.events().await;
    let again = open_pane(CommandId::new(), thread).await.unwrap();
    let same = json!({ "pane": opened["pane"], "new": false });
    assert_eq!(again, unplaced(same));
    assert_eq!(
        group_of(&machine.list().await, &opened["pane"]),
        Value::Null
    );
    assert_eq!(machine.events().await, said);
}

#[tokio::test]
async fn a_thread_an_agent_puts_beside_a_pane_keeps_to_the_group_there() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let work = machine.project("Work").await;
    let agent = AgentId::new();
    let as_agent = |params| machine.agent(agent, work, "workspaces.open_pane", params);
    let thread = |beside: Value| {
        let args = json!({ "thread": uuid::Uuid::now_v7() });
        json!({ "kind": "agents.thread", "args": args, "beside": beside })
    };
    let page = json!({ "project": work, "kind": "browser.browser", "args": { "url": "a" } });
    let person = machine.command("workspaces.open", page).await.unwrap();

    // Under the Person's Pane, in its column: that column makes no Group.
    let below = json!({ "pane": person["pane"], "side": "below" });
    let opened = as_agent(thread(below)).await.unwrap();
    let list = machine.list().await;
    assert_eq!(
        column_of(&list, &opened["pane"])["id"],
        column_of(&list, &person["pane"])["id"]
    );
    assert_eq!(group_of(&list, &person["pane"]), Value::Null);

    // Between two columns of a Group, it is a member of that Group, not a
    // Group of its own.
    let first = machine
        .command(
            "workspaces.open",
            json!({ "project": work, "kind": "agents.thread", "args": { "thread": "first" } }),
        )
        .await
        .unwrap();
    let deck = json!({
        "project": work,
        "kind": "git.diff",
        "args": { "scope": { "kind": "changes" } },
        "place": { "to": "group", "pane": first["pane"] },
    });
    let diff = machine.command("workspaces.open", deck).await.unwrap();
    let list = machine.list().await;
    let theirs = group_of(&list, &first["pane"]);
    assert!(theirs.is_string());
    assert_eq!(group_of(&list, &diff["pane"]), theirs);
    let right = json!({ "pane": first["pane"], "side": "right" });
    let opened = as_agent(thread(right)).await.unwrap();
    let list = machine.list().await;
    assert_eq!(group_of(&list, &opened["pane"]), theirs);
    let columns = &list["workspaces"][0]["columns"];
    let order: Vec<Value> = (columns.as_array().unwrap().iter())
        .map(|c| c["panes"][0]["id"].clone())
        .collect();
    assert_eq!(
        order[order.len() - 3..],
        [
            first["pane"].clone(),
            opened["pane"].clone(),
            diff["pane"].clone()
        ]
    );
}

#[tokio::test]
async fn another_kind_an_agent_opens_goes_where_a_pane_with_no_place_goes() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let work = machine.project("Work").await;
    let agent = AgentId::new();
    let as_agent = |params| machine.agent(agent, work, "workspaces.open_pane", params);
    let thread = json!({ "kind": "agents.thread", "args": { "thread": uuid::Uuid::now_v7() } });
    as_agent(thread).await.unwrap();

    // The Diff: last on the workspace, in no Group.
    let diff = json!({ "kind": "git.diff", "args": { "scope": { "kind": "changes" } } });
    let opened = as_agent(diff).await.unwrap();
    let list = machine.list().await;
    let columns = list["workspaces"][0]["columns"].as_array().unwrap();
    let last = columns.last().unwrap();
    assert_eq!(last["panes"][0]["id"], opened["pane"]);
    assert_eq!(last["group"], Value::Null);
}

#[tokio::test]
async fn a_panes_id_comes_from_the_command_that_opens_it() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let work = machine.project("Work").await;
    let page = json!({ "project": work, "kind": "browser.browser", "args": { "url": "a" } });

    // The window's: the Pane, and the empty workspace under it.
    let first = CommandId::new();
    let opened = machine
        .command_as(first, "workspaces.open", page.clone())
        .await
        .unwrap();
    assert_eq!(opened["pane"], json!(seed(first).pane()));
    let arranged = machine.list().await;
    assert_eq!(arranged["workspaces"][1]["id"], json!(seed(first).bottom()));
    // Opened again, under another command, it is another Pane.
    let again = CommandId::new();
    let mut twice = page;
    twice["again"] = json!(true);
    let other = machine
        .command_as(again, "workspaces.open", twice)
        .await
        .unwrap();
    assert_eq!(other["pane"], json!(seed(again).pane()));
    assert_ne!(other["pane"], opened["pane"]);

    // An Agent's, as its tool sends it.
    let agent = AgentId::new();
    let asked = CommandId::new();
    let thread = json!({ "thread": uuid::Uuid::now_v7() });
    let by_agent = machine
        .agent_as(
            asked,
            agent,
            work,
            "workspaces.open_pane",
            json!({ "kind": "agents.thread", "args": thread }),
        )
        .await
        .unwrap();
    assert_eq!(by_agent["pane"], json!(seed(asked).pane()));
}

#[tokio::test]
async fn a_command_sent_again_answers_as_the_first_and_makes_nothing_twice() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let open = json!({
        "project": ProjectId::new(),
        "kind": "terminal.terminal",
        "args": {},
        "again": true,
    });
    let command = CommandId::new();
    let first = machine
        .command_as(command, "workspaces.open", open.clone())
        .await
        .unwrap();
    let arranged = machine.list().await;
    let again = machine
        .command_as(command, "workspaces.open", open)
        .await
        .unwrap();
    assert_eq!(again, first);
    assert_eq!(machine.list().await, arranged);
    assert_eq!(panes(&arranged["workspaces"]).len(), 1);
    assert_eq!(machine.events().await.len(), 1);
}

#[tokio::test]
async fn a_command_whose_ids_are_taken_is_refused_and_changes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let project = ProjectId::new();
    // Past its receipt, what a command made is still on the workspaces:
    // here a window's arrangement holds it.
    let command = CommandId::new();
    let window = json!({ "workspaces": [{
        "id": WorkspaceId::new(),
        "columns": [{ "id": ColumnId::new(), "panes": [
            { "id": seed(command).pane(), "project": project, "kind": "a.a", "args": {} }
        ] }]
    }] });
    machine.command("workspaces.take", window).await.unwrap();
    let arranged = machine.list().await;
    let said = machine.events().await.len();

    let open = json!({ "project": project, "kind": "b.b", "args": {} });
    let refused = machine
        .command_as(command, "workspaces.open", open)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert_eq!(machine.list().await, arranged);
    assert_eq!(machine.events().await.len(), said);
}

#[tokio::test]
async fn ids_kept_before_go_on_working() {
    let root = tempfile::tempdir().unwrap();
    let machine = Machine::open(root.path(), PersonId::new()).await;
    let project = ProjectId::new();
    // IDs made before they came from commands: UUIDv7s.
    let (workspace, column) = (WorkspaceId::new(), ColumnId::new());
    let (one, two) = (PaneId::new(), PaneId::new());
    let pane = |id: PaneId, n: u32| json!({ "id": id, "project": project, "kind": "a.a", "args": { "n": n } });
    let window = json!({ "workspaces": [{
        "id": workspace,
        "columns": [{ "id": column, "panes": [pane(one, 1), pane(two, 2)] }]
    }] });
    machine.command("workspaces.take", window).await.unwrap();

    // A Pane moves by its ID, a column takes a width by its, and the
    // Pane that moved out, in a column of a derived ID, closes by its.
    let right = json!({ "pane": two, "place": { "to": "beside", "pane": one, "side": "right" } });
    machine
        .command("workspaces.move_pane", right)
        .await
        .unwrap();
    let size = json!({ "column": column, "width": "1/3" });
    machine.command("workspaces.size", size).await.unwrap();
    machine
        .command("workspaces.close", json!({ "pane": two }))
        .await
        .unwrap();
    let arranged = machine.list().await;
    let kept = &arranged["workspaces"][0];
    assert_eq!(kept["id"], json!(workspace));
    assert_eq!(kept["columns"][0]["id"], json!(column));
    assert_eq!(kept["columns"][0]["width"], "1/3");
    let shown = panes(&arranged["workspaces"]);
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0]["id"], json!(one));
}
