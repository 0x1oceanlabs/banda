//! The sharing module through the kernel, as a client uses it: in this
//! machine's scope, nothing shared and no ID until the file turns
//! something on, a new ID only for the Person, and none kept once all of
//! it is off again.

use banda_kernel::{CommandId, Kernel, Participant, PersonId, ProjectId};
use banda_sharing::post::Post;
use banda_sharing::{Never, Sharing};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::sync::{mpsc, oneshot};

/// One event posted, and how the stand-in for PostHog answers it.
struct Posted {
    event: Value,
    answer: oneshot::Sender<Result<(), String>>,
}

impl Posted {
    /// PostHog took it.
    fn took(self) {
        let _ = self.answer.send(Ok(()));
    }
}

/// A stand-in for PostHog, which hands each post to the test and waits
/// for its answer.
struct PostHog(mpsc::UnboundedSender<Posted>);

#[async_trait::async_trait]
impl Post for PostHog {
    async fn post(&self, event: &str) -> Result<(), String> {
        let (answer, answered) = oneshot::channel();
        let event = serde_json::from_str(event).map_err(|e| e.to_string())?;
        (self.0.send(Posted { event, answer })).map_err(|_| "no test hears".to_owned())?;
        answered.await.map_err(|_| "no answer".to_owned())?
    }
}

/// What hears the posts of [`PostHog`].
type Posts = mpsc::UnboundedReceiver<Posted>;

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    let sharing = Sharing::new(root.join("config"), root.join("state"));
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(sharing.never(Never::Checkout))
        .open()
        .await
        .unwrap()
}

async fn state(kernel: &Kernel, owner: PersonId) -> Value {
    let person = Participant::Person(owner);
    let call = kernel.call(person, "sharing.state", None, None, json!({}));
    call.await.unwrap()
}

fn share(root: &Path, text: &str) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    std::fs::write(root.join("config/sharing.toml"), text).unwrap();
}

#[tokio::test]
async fn an_id_is_made_as_sharing_turns_on_and_erased_as_it_turns_off() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;

    let nothing = state(&kernel, owner).await;
    assert_eq!(
        nothing,
        json!({
            "problems": false, "usage": false, "id": null,
            "never": "checkout", "sent": [],
        })
    );

    share(root.path(), "problems = true\n");
    let on = state(&kernel, owner).await;
    assert_eq!(on["problems"], true);
    let id = on["id"].as_str().unwrap().to_owned();
    assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 4);
    // Kept while anything is shared.
    share(root.path(), "usage = true\n");
    assert_eq!(state(&kernel, owner).await["id"], id);

    // Only the Person makes a new one.
    let new_id = |who| {
        let command = Some(CommandId::new());
        kernel.call(who, "sharing.new_id", None, command, json!({}))
    };
    let agent = Participant::Agent(banda_kernel::AgentId::new());
    assert!(new_id(agent).await.is_err());
    let anew = new_id(Participant::Person(owner)).await.unwrap();
    let other = anew["id"].as_str().unwrap();
    assert_ne!(other, id);
    assert_eq!(state(&kernel, owner).await["id"], other);

    // All of it off: the ID goes, and turned on again, it is another.
    share(root.path(), "");
    assert_eq!(state(&kernel, owner).await["id"], Value::Null);
    assert!(!root.path().join("state/sharing-id").exists());
    assert!(new_id(Participant::Person(owner)).await.is_err());
    share(root.path(), "problems = true\n");
    let again = state(&kernel, owner).await;
    assert_ne!(again["id"], other);
    assert_ne!(again["id"], id);
}

/// A Banda that sends, with the problems module whose Problems it hears.
async fn sending(root: &Path, owner: PersonId, never: Option<Never>) -> (Arc<Kernel>, Posts) {
    banda(root, owner, never, None, Vec::new()).await
}

/// A Banda that sends to a stand-in for PostHog, with the problems
/// module, `says` beside it, and its days told by `clock` when there is
/// one.
async fn banda(
    root: &Path,
    owner: PersonId,
    never: Option<Never>,
    clock: Option<Arc<AtomicI64>>,
    says: Vec<Says>,
) -> (Arc<Kernel>, Posts) {
    let (posting, posts) = mpsc::unbounded_channel();
    let mut sharing = Sharing::new(root.join("config"), root.join("state"))
        .channel("dev")
        .posting(PostHog(posting));
    if let Some(why) = never {
        sharing = sharing.never(why);
    }
    if let Some(clock) = clock {
        sharing = sharing.clock(move || clock.load(Ordering::SeqCst));
    }
    let mut kernel = Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(banda_problems::Problems::new(
            root.join("state/problems"),
            root.join("state/logs"),
        ));
    for one in says {
        kernel = kernel.module(one);
    }
    (kernel.module(sharing).open().await.unwrap(), posts)
}

async fn record(kernel: &Kernel, owner: PersonId, function: &str) {
    let record = json!({
        "source": "page",
        "kind": "TypeError",
        "message": "cannot open '/home/roma/notes.md'",
        "frames": [{ "file": "client/web/src/browser/Tabs.tsx", "function": function, "line": 41 }],
    });
    let person = Participant::Person(owner);
    let command = Some(CommandId::new());
    let call = kernel.call(person, "problems.record", None, command, record);
    call.await.unwrap();
}

/// The events kept, once there are `count`.
async fn kept(kernel: &Kernel, owner: PersonId, count: usize) -> Vec<Value> {
    for _ in 0..200 {
        let sent = state(kernel, owner).await["sent"]
            .as_array()
            .unwrap()
            .clone();
        if sent.len() >= count {
            return sent;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("{count} events were not kept");
}

#[tokio::test]
async fn a_problem_goes_once_a_day_from_the_host_while_problems_are_shared() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    share(root.path(), "problems = true\n");
    // No window: the engine posts itself.
    let (kernel, mut posts) = sending(root.path(), owner, None).await;

    record(&kernel, owner, "Tabs").await;
    let posted = posts.recv().await.unwrap();
    let event = &posted.event;
    assert_eq!(event["event"], "$exception");
    let id = state(&kernel, owner).await["id"].clone();
    assert_eq!(event["distinct_id"], id);
    let said = &event["properties"];
    assert_eq!(said["$exception_list"][0]["value"], "cannot open '<path>'");
    assert_eq!(said["channel"], "dev");
    // What goes is what was kept first.
    let sent = kept(&kernel, owner, 1).await;
    assert_eq!(sent[0]["event"], "$exception");
    assert_eq!(sent[0]["sent"], Value::Null);
    let json: Value = serde_json::from_str(sent[0]["json"].as_str().unwrap()).unwrap();
    assert_eq!(&json, event);

    posted.took();
    for _ in 0..200 {
        if !state(&kernel, owner).await["sent"][0]["sent"].is_null() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(state(&kernel, owner).await["sent"][0]["sent"].is_number());

    // The same fault again today makes nothing more; another fault goes.
    record(&kernel, owner, "Tabs").await;
    record(&kernel, owner, "Bar").await;
    let posted = posts.recv().await.unwrap();
    let frames = &posted.event["properties"]["$exception_list"][0]["stacktrace"];
    assert_eq!(frames["frames"][0]["function"], "Bar");
    assert_eq!(kept(&kernel, owner, 2).await.len(), 2);
    // One PostHog did not take waits, and goes again.
    let _ = posted.answer.send(Err("PostHog answered 503".into()));

    // Off: no more, and what waits is dropped.
    share(root.path(), "problems = false\nusage = true\n");
    record(&kernel, owner, "Baz").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let sent = state(&kernel, owner).await["sent"].clone();
    assert!(
        sent.as_array()
            .unwrap()
            .iter()
            .all(|one| !one["about"].as_str().unwrap().contains("Baz"))
    );
}

#[tokio::test]
async fn a_banda_that_never_sends_makes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    share(root.path(), "problems = true\nusage = true\n");
    let (kernel, mut posts) = sending(root.path(), owner, Some(Never::Run)).await;
    record(&kernel, owner, "Tabs").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state(&kernel, owner).await["sent"], json!([]));
    assert!(posts.try_recv().is_err(), "nothing posted");
}

/// Stands in for the agents of a Project and the workspaces of the machine:
/// it says what they would, a Thread started and a Pane opened.
struct Says {
    name: &'static str,
    scope: banda_kernel::Scope,
}

#[async_trait::async_trait]
impl banda_kernel::Module for Says {
    fn name(&self) -> &'static str {
        self.name
    }

    fn scope(&self) -> banda_kernel::Scope {
        self.scope
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, _: &str) -> Option<banda_kernel::Right> {
        Some(banda_kernel::Right::Write)
    }

    fn kind(&self, _: &str) -> Option<banda_kernel::Kind> {
        Some(banda_kernel::Kind::Command)
    }

    /// `say` emits `{ kind, payload }`.
    async fn call(
        &self,
        call: banda_kernel::Call,
        _: &str,
        params: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        let author = call.participant();
        call.command(move |tx| {
            let kind = params["kind"].as_str().unwrap_or_default();
            tx.emit(kind, 1, None, author, &params["payload"])?;
            Ok(Value::Null)
        })
        .await
    }
}

const DAY: i64 = 24 * 60 * 60 * 1000;

/// A clock that starts `offset` ms from now, for a test to move.
fn clock(offset: i64) -> Arc<AtomicI64> {
    Arc::new(AtomicI64::new(banda_kernel::now_ms() + offset))
}

/// The agents of a Project, and the workspaces of the machine, as `Says`.
fn agents() -> Says {
    Says {
        name: "agents",
        scope: banda_kernel::Scope::Project,
    }
}

fn workspaces() -> Says {
    Says {
        name: "workspaces",
        scope: banda_kernel::Scope::Machine,
    }
}

/// Has `module` say `kind` with `payload`, in `project` or the machine's.
async fn say(
    kernel: &Kernel,
    owner: PersonId,
    project: Option<ProjectId>,
    module: &str,
    kind: &str,
    payload: Value,
) {
    let (method, command) = (format!("{module}.say"), Some(CommandId::new()));
    let params = json!({ "kind": kind, "payload": payload });
    let person = Participant::Person(owner);
    kernel
        .call(person, &method, project, command, params)
        .await
        .unwrap();
}

/// The workspaces after a Pane of `kind` opened in `project`.
fn opened(kind: &str, project: &str) -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    let pane = json!({ "id": id, "kind": kind, "project": project, "args": {} });
    let column = json!({ "id": uuid::Uuid::new_v4(), "panes": [pane] });
    json!({ "workspaces": [{ "id": uuid::Uuid::new_v4(), "columns": [column] }] })
}

#[tokio::test]
async fn a_day_goes_once_it_ends_with_what_every_project_counted() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    share(root.path(), "usage = true\n");
    // Usage was on all of today: it turned on yesterday.
    let now = clock(-DAY);
    let says = vec![agents(), workspaces()];
    let (kernel, mut posts) = banda(root.path(), owner, None, Some(now.clone()), says).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let mut projects: Vec<ProjectId> = Vec::new();
    for name in ["Work", "Home"] {
        let params = json!({ "name": name });
        let made = kernel.call(
            person,
            "projects.create",
            None,
            Some(CommandId::new()),
            params,
        );
        projects.push(serde_json::from_value(made.await.unwrap()["id"].clone()).unwrap());
    }
    let started = |harness: &str| json!({ "title": "secret", "harness": harness });
    say(
        &kernel,
        owner,
        Some(projects[0]),
        "agents",
        "thread.started",
        started("claude"),
    )
    .await;
    say(
        &kernel,
        owner,
        Some(projects[1]),
        "agents",
        "thread.started",
        started("codex"),
    )
    .await;
    say(
        &kernel,
        owner,
        Some(projects[1]),
        "agents",
        "turn.started",
        json!({ "turn": "t" }),
    )
    .await;
    let shown = opened("agents.thread", &projects[0].to_string());
    say(&kernel, owner, None, "workspaces", "opened", shown).await;

    // A day later, today has ended: it goes as it is heard, once.
    now.store(banda_kernel::now_ms() + DAY, Ordering::SeqCst);
    record(&kernel, owner, "Tabs").await;
    let posted = posts.recv().await.unwrap();
    let event = &posted.event;
    assert_eq!(event["event"], "day");
    assert_eq!(event["distinct_id"], state(&kernel, owner).await["id"]);
    let said = &event["properties"];
    assert_eq!(said["threads"], json!({ "claude": 1, "codex": 1 }));
    assert_eq!(said["turns"], 1);
    assert_eq!(said["panes"], json!({ "agents.thread": 1 }));
    assert_eq!(
        (&said["projects"], &said["workspaces"]),
        (&json!(2), &json!(1))
    );
    assert!(!event.to_string().contains("secret"));
    assert_eq!(kept(&kernel, owner, 1).await[0]["event"], "day");
    posted.took();
    record(&kernel, owner, "Bar").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        state(&kernel, owner).await["sent"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn a_day_before_usage_turned_on_is_not_counted() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    share(root.path(), "usage = true\n");
    // Turned on now: today is not whole, so tomorrow sends nothing of it.
    let now = clock(0);
    let (kernel, _posts) = banda(
        root.path(),
        owner,
        None,
        Some(now.clone()),
        vec![workspaces()],
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let project = ProjectId::new().to_string();
    say(
        &kernel,
        owner,
        None,
        "workspaces",
        "opened",
        opened("terminal.terminal", &project),
    )
    .await;
    now.store(banda_kernel::now_ms() + DAY, Ordering::SeqCst);
    record(&kernel, owner, "Tabs").await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert_eq!(state(&kernel, owner).await["sent"], json!([]));
}
