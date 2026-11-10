//! The agents module through the kernel's interface, with the fake agent
//! from `tools/fake-agent` as the Harness: a real process speaking ACP.

use banda_agents::model::{
    Body, Choice, Exit, Failure, ItemId, Mode, OptionValue, QuestionState, Settings, StepState,
    ThreadList, ThreadView, ToolContent, ToolKind, ToolStatus, TurnId, TurnState, Wake,
};
use banda_agents::{Agents, Pipe, chosen_modes};
#[cfg(unix)]
use banda_environments::How;
use banda_environments::{Asks, Local, Recorded};
use banda_harnesses::{Cli, Harness, Harnesses, HarnessesModule, account_changed};
#[cfg(unix)]
use banda_kernel::Whose;
use banda_kernel::{
    AgentId, Caller, Code, CommandId, EventFilter, Fence, FenceLayer, FenceWhy, Holes, Kernel,
    Participant, PersonId, ProjectId, Working,
};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Builds the fake agent once, next to this test's own binary.
fn fake_agent() -> PathBuf {
    static BUILT: OnceLock<PathBuf> = OnceLock::new();
    BUILT
        .get_or_init(|| {
            let status = std::process::Command::new(env!("CARGO"))
                .args(["build", "-q", "-p", "banda-fake-agent"])
                .status()
                .expect("cargo runs");
            assert!(status.success(), "the fake agent builds");
            let deps = std::env::current_exe().unwrap();
            let profile = deps.parent().and_then(Path::parent).unwrap();
            profile.join("banda-fake-agent")
        })
        .clone()
}

/// The fence as it holds whole.
fn holds() -> Fence {
    Fence::holds(vec![FenceLayer::Namespaces, FenceLayer::Landlock], false)
}

fn harnesses() -> Harnesses {
    harnesses_with(&[])
}

/// The fake agent as the only Harness, started with `env`.
fn harnesses_with(env: &[(&str, &str)]) -> Harnesses {
    Harnesses::new(vec![fake_with(env)])
}

/// The fake agent's Harness entry, started with `env`.
fn fake_with(env: &[(&str, &str)]) -> Harness {
    Harness {
        id: "fake".into(),
        name: "Fake".into(),
        short: None,
        command: fake_agent().display().to_string(),
        enabled: true,
        retired: None,
        args: Vec::new(),
        env: env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        cli: None,
        of: None,
        kind: Default::default(),
        mark: None,
        icon: None,
        colour: None,
        shadows: None,
        carried: None,
        record: None,
        cwd: None,
        holes: Holes::default(),
        credentials: Default::default(),
    }
}

/// A module as the agents module hears its notices: `say { thread,
/// notice }` writes its fact, as git's `git.acted` when a step its card
/// asked for is done, or the browser's `browser.lent` when the Person lends
/// a Thread a tab.
struct Telling(&'static str, &'static str);

#[async_trait::async_trait]
impl banda_kernel::Module for Telling {
    fn name(&self) -> &'static str {
        self.0
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

    async fn call(
        &self,
        call: banda_kernel::Call,
        _: &str,
        told: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        let (by, kind) = (call.participant(), self.1);
        call.command(move |tx| {
            let thread = told["thread"].as_str();
            tx.emit(kind, 1, thread, by, &told)?;
            Ok(())
        })
        .await?;
        Ok(Value::Null)
    }
}

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    /// What a new Thread starts on.
    harness: String,
}

impl World {
    async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
        World::open_with(root, owner, Agents::new(harnesses())).await
    }

    /// A kernel with the machine, its module `harnesses` on the same list
    /// as `agents`, `agents`, and git as it tells of its card.
    async fn open_with(root: &Path, owner: PersonId, agents: Agents) -> Arc<Kernel> {
        World::open_asked(root, owner, agents).await.0
    }

    /// As [`World::open_with`], and what its environment, the host's, is
    /// asked to start.
    async fn open_asked(root: &Path, owner: PersonId, agents: Agents) -> (Arc<Kernel>, Asks) {
        World::open_fenced(root, owner, agents, holds()).await
    }

    /// As [`World::open_asked`], its environment saying `fence` of the
    /// fence: these tests' own say it holds whole, as it does where Banda
    /// lets a new Thread start in Full access (ADR 0083).
    async fn open_fenced(
        root: &Path,
        owner: PersonId,
        agents: Agents,
        fence: Fence,
    ) -> (Arc<Kernel>, Asks) {
        let environment = Recorded::new(Local).saying(fence);
        let asks = environment.asks();
        let kernel = Kernel::builder(root, root.join(".data"), owner)
            .machine(root.join(".machine"))
            .environment(environment)
            .module(HarnessesModule::new(agents.harnesses()))
            .module(agents)
            .module(Telling("git", "git.acted"))
            .module(Telling("browser", "browser.lent"))
            .open()
            .await
            .unwrap();
        (kernel, asks)
    }

    async fn new(root: &Path) -> World {
        World::new_with(root, Agents::new(harnesses())).await
    }

    async fn new_with(root: &Path, agents: Agents) -> World {
        World::new_on(root, agents, "fake").await
    }

    /// A Project whose new Threads start on `harness`.
    async fn new_on(root: &Path, agents: Agents, harness: &str) -> World {
        let owner = PersonId::new();
        let kernel = World::open_with(root, owner, agents).await;
        World::in_a_project(kernel, owner, harness).await
    }

    /// A new Project of `kernel`, whose new Threads start on `harness`.
    async fn in_a_project(kernel: Arc<Kernel>, owner: PersonId, harness: &str) -> World {
        let person = Participant::Person(owner);
        let project = kernel
            .call(
                person,
                "projects.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let project: ProjectId = serde_json::from_value(project["id"].clone()).unwrap();
        World {
            kernel,
            owner,
            project,
            harness: harness.to_owned(),
        }
    }

    fn person(&self) -> Participant {
        Participant::Person(self.owner)
    }

    /// An Agent. What the kernel refuses an Agent, it refuses whichever
    /// Thread the Agent works in.
    fn agent(&self) -> Participant {
        Participant::Agent(AgentId::new())
    }

    async fn call(
        &self,
        who: Participant,
        method: &str,
        params: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        self.call_in(Some(self.project), who, method, params).await
    }

    /// Calls `method` in `project`, or on the machine.
    async fn call_in(
        &self,
        project: Option<ProjectId>,
        who: Participant,
        method: &str,
        params: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        let command = Some(CommandId::new());
        self.kernel
            .call(who, method, project, command, params)
            .await
    }

    async fn send(&self, thread: Option<&Value>, text: &str) -> Value {
        let mut params = json!({ "text": text });
        match thread {
            Some(thread) => params["thread"] = thread.clone(),
            None => params["harness"] = json!(self.harness),
        }
        self.call(self.person(), "agents.send", params)
            .await
            .unwrap()
    }

    async fn thread(&self, thread: &Value) -> ThreadView {
        let view = self
            .kernel
            .call(
                self.person(),
                "agents.thread",
                Some(self.project),
                None,
                json!({ "thread": thread }),
            )
            .await
            .unwrap();
        let view: ThreadView = serde_json::from_value(view).unwrap();
        self.checkpoint(&view).await;
        view
    }

    /// With `BANDA_CHECKPOINTS` set, writes there each change a test reads
    /// of a Thread: the view it read before, the facts after that, and the
    /// view it reads now. The Pane's tests apply those facts to the first
    /// view and must get this one (ADR 0014, decision 3).
    async fn checkpoint(&self, view: &ThreadView) {
        static LAST: Mutex<BTreeMap<String, (usize, ThreadView)>> = Mutex::new(BTreeMap::new());
        let Some(folder) = std::env::var_os("BANDA_CHECKPOINTS") else {
            return;
        };
        let thread = view.thread.id.to_string();
        let (n, start) = {
            let mut last = LAST.lock().unwrap();
            let Some((n, before)) = last.get_mut(&thread) else {
                last.insert(thread, (0, view.clone()));
                return;
            };
            if before.at == view.at {
                return;
            }
            *n += 1;
            (*n, std::mem::replace(before, view.clone()))
        };
        let filter = EventFilter {
            module: Some("agents".to_owned()),
            subject: Some(thread.clone()),
            kinds: None,
        };
        let project = self.kernel.project(self.project).await.unwrap();
        let events: Vec<_> = project
            .events_after(start.at, filter, usize::MAX)
            .await
            .unwrap()
            .into_iter()
            .filter(|event| event.seq <= view.at)
            .collect();
        let checkpoint = json!({ "start": start, "events": events, "end": view });
        let path = Path::new(&folder).join(format!("{thread}-{n}.json"));
        std::fs::write(path, serde_json::to_vec(&checkpoint).unwrap()).unwrap();
    }

    async fn threads(&self) -> ThreadList {
        let list = self
            .kernel
            .call(
                self.person(),
                "agents.threads",
                Some(self.project),
                None,
                json!({}),
            )
            .await
            .unwrap();
        serde_json::from_value(list).unwrap()
    }

    /// Waits up to ten seconds for the Thread to satisfy `check`.
    async fn until(&self, thread: &Value, check: impl Fn(&ThreadView) -> bool) -> ThreadView {
        self.until_within(Duration::from_secs(10), thread, check)
            .await
    }

    async fn until_within(
        &self,
        limit: Duration,
        thread: &Value,
        check: impl Fn(&ThreadView) -> bool,
    ) -> ThreadView {
        let tries = limit.as_millis() / 10;
        for _ in 0..tries {
            let view = self.thread(thread).await;
            if check(&view) {
                return view;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "the Thread never got there: {:#?}",
            self.thread(thread).await
        );
    }
}

fn state(view: &ThreadView, turn: &Value) -> Option<TurnState> {
    view.turns
        .iter()
        .find(|t| serde_json::to_value(t.id).unwrap() == *turn)
        .map(|t| t.state)
}

/// Who opened `turn`, and from which other Thread, as the module keeps it
/// in the Project's database: the window does not read it.
fn opened(root: &Path, turn: &Value) -> (String, Option<String>) {
    let sql = rusqlite::Connection::open(project_data(root).join("project.sqlite3")).unwrap();
    sql.query_row(
        "SELECT opener, from_thread FROM agents_turns WHERE id = ?1",
        [turn.as_str().unwrap()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn texts(view: &ThreadView) -> Vec<String> {
    view.items
        .iter()
        .map(|item| match &item.body {
            Body::Message { text, images, .. } if images.is_empty() => format!("message: {text}"),
            Body::Message { text, images, .. } => {
                format!("message: {text} + {} image(s)", images.len())
            }
            Body::Thought { text } => format!("thought: {text}"),
            Body::Tool { title, status, .. } => format!("tool: {title} ({status:?})"),
            Body::Question { title, state, .. } => format!("question: {title} ({state:?})"),
            Body::Notice { text } => format!("notice: {text}"),
            Body::Plan { steps } => format!("plan: {} steps", steps.len()),
            Body::Moved { from, to, how } => format!("moved: {from} → {to} {how:?}"),
            Body::Visual { title, height, .. } => format!("visual: {title} ({height}px)"),
            Body::Issue { title, state, .. } => format!("issue: {title} ({state:?})"),
        })
        .collect()
}

/// The fake agent's answer to "which session": its session and process.
fn session_of(view: &ThreadView) -> (String, String) {
    let reply = texts(view)
        .into_iter()
        .rev()
        .find_map(|t| t.strip_prefix("message: Session ").map(str::to_owned))
        .expect("the agent named its session");
    let (session, process) = reply.split_once(" in process ").unwrap();
    (session.to_owned(), process.to_owned())
}

/// Sends "which session" in `thread` and waits for the answer.
async fn ask_session(world: &World, thread: Option<&Value>) -> (Value, (String, String)) {
    let sent = world.send(thread, "which session").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    (sent["thread"].clone(), session_of(&view))
}

/// A session may read the files Banda keeps for the Project's messages,
/// which are in the Project's data, not its folder (ADR 0026).
#[tokio::test]
async fn a_session_may_read_the_files_kept_for_its_messages() {
    let root = tempfile::tempdir().unwrap();
    let roots = root.path().join("roots.json");
    let agents = Agents::new(harnesses_with(&[(
        "FAKE_AGENT_ROOTS",
        roots.to_str().unwrap(),
    )]));
    let world = World::new_with(root.path(), agents).await;
    ask_session(&world, None).await;
    let given: Vec<PathBuf> = serde_json::from_slice(&std::fs::read(&roots).unwrap()).unwrap();
    assert_eq!(given, [project_data(root.path()).join("files")]);
}

#[tokio::test]
async fn a_message_gets_the_agents_reply() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "hello there").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(view.thread.title, "hello there");
    assert_eq!(
        texts(&view),
        [
            "message: hello there",
            "thought: Reading the request.",
            "message: You said: hello there",
        ]
    );
    assert!(matches!(view.items[2].author, Participant::Agent(_)));
    // The turn keeps the account it ran on, its Thread's (ADR 0078).
    assert_eq!(view.turns[0].harness.as_deref(), Some("fake"));

    let project = world.kernel.project(world.project).await.unwrap();
    let events = (project.events_after(0, Default::default(), 100).await).unwrap();
    let started = events.iter().find(|e| e.kind == "turn.started").unwrap();
    assert_eq!(started.payload["harness"], "fake", "the fact says it too");
    let mut kinds: Vec<String> = events.into_iter().map(|e| e.kind).collect();
    // The Harness says its slash commands as its session opens: in the
    // turn's first offer, or in another later, as it is quick.
    let mut offered = false;
    kinds.retain(|kind| kind != "thread.offered" || !std::mem::replace(&mut offered, true));
    assert_eq!(
        kinds,
        [
            "thread.started",
            "message.posted",
            "turn.started",
            "thread.offered",
            "thought.grew",
            "reply.grew",
            "turn.ended",
        ]
    );
}

#[tokio::test]
async fn an_account_counts_its_threads_now_its_last_turn_and_its_turns_since() {
    let root = tempfile::tempdir().unwrap();
    let second = Harness {
        id: "fake-b".into(),
        ..fake_with(&[])
    };
    let agents = Agents::new(Harnesses::new(vec![fake_with(&[]), second]));
    let world = World::new_with(root.path(), agents).await;
    let done = async |sent: Value| {
        world
            .until(&sent["thread"], |v| {
                state(v, &sent["turn"]) == Some(TurnState::Done)
            })
            .await
    };
    let first = world.send(None, "one").await;
    done(first.clone()).await;
    done(world.send(Some(&first["thread"]), "two").await).await;
    let on_b = json!({ "harness": "fake-b", "text": "three" });
    let other = world
        .call(world.person(), "agents.send", on_b)
        .await
        .unwrap();
    let view = done(other.clone()).await;
    // An archived Thread is not one of the account's now; its turns count.
    world
        .archive(world.person(), &other["thread"], true)
        .await
        .unwrap();

    let accounts = async |since: i64| {
        let asked = json!({ "since": since });
        let uses = world.call(world.person(), "agents.accounts", asked).await;
        let uses = uses.unwrap();
        let uses = uses.as_array().unwrap().clone();
        uses.into_iter()
            .map(|u| {
                let name = u["harness"].as_str().unwrap().to_owned();
                (
                    name,
                    u["threads"].clone(),
                    u["turns"].clone(),
                    u["last"].clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    let all = accounts(0).await;
    let names: Vec<_> = all.iter().map(|(name, ..)| name.as_str()).collect();
    assert_eq!(names, ["fake", "fake-b"]);
    assert_eq!((&all[0].1, &all[0].2), (&json!(1), &json!(2)));
    assert_eq!((&all[1].1, &all[1].2), (&json!(0), &json!(1)));
    let began = view.turns[0].started.unwrap();
    assert_eq!(all[1].3, json!(began), "its latest turn began then");

    let later = accounts(began + 60_000).await;
    assert_eq!(later[0].2, json!(0), "no turn began since");
    assert_eq!(later[0].1, json!(1), "its Threads stay");
}

#[tokio::test]
async fn a_question_waits_for_a_person_and_offers_every_answer_of_the_harness() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "please ask first").await;
    let view = world
        .until(&sent["thread"], |v| {
            v.items.iter().any(|i| {
                matches!(
                    i.body,
                    Body::Question {
                        state: QuestionState::Open,
                        ..
                    }
                )
            })
        })
        .await;
    let question = view.items.last().unwrap();
    let Body::Question { title, choices, .. } = &question.body else {
        panic!("a Question")
    };
    assert_eq!(title, "Run a check");
    let ids: Vec<_> = choices.iter().map(|c| (c.id.as_str(), c.always)).collect();
    assert_eq!(ids, [("allow", false), ("always", true), ("reject", false)]);

    let by_agent = world
        .call(
            world.agent(),
            "agents.answer",
            json!({ "item": question.id, "choice": "allow" }),
        )
        .await;
    assert_eq!(by_agent.unwrap_err().code, Code::Forbidden);
    let unknown = world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question.id, "choice": "maybe" }),
        )
        .await;
    assert_eq!(unknown.unwrap_err().code, Code::Invalid);
    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question.id, "choice": "always" }),
        )
        .await
        .unwrap();

    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(
        texts(&view),
        [
            "message: please ask first",
            "tool: Run a check (Done)",
            "question: Run a check (Answered)",
            "message: The check passed.",
        ]
    );
}

#[tokio::test]
async fn the_list_says_where_each_threads_work_stands() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "please ask first").await;
    let view = world.until(&sent["thread"], asking).await;
    let (question, _) = open(&view).unwrap();
    let turn = serde_json::from_value(sent["turn"].clone()).unwrap();
    let listed = world.threads().await.threads.remove(0);
    let latest = listed.latest.clone().unwrap();
    assert_eq!((latest.turn, latest.state), (turn, TurnState::Running));
    assert!(latest.began > 0, "it says when it began");
    assert_eq!(listed.message.as_deref(), Some("please ask first"));
    let asking: Vec<_> = listed.asking.iter().map(|a| a.item).collect();
    assert_eq!(asking, [question], "it waits for its Person");
    assert!(!listed.asking[0].title.is_empty(), "and says what it asks");

    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question, "choice": "allow" }),
        )
        .await
        .unwrap();
    world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    let listed = world.threads().await.threads.remove(0);
    assert_eq!(listed.latest.map(|l| l.state), Some(TurnState::Done));
    assert!(listed.asking.is_empty(), "the answer was all it asked");
}

/// Each turn that runs counts in the engine's count of what is at work,
/// which keeps the machine awake: one that waits for a message, and one
/// that waits on its Person's Question, until each ends (ADR 0097,
/// decision 1).
#[tokio::test]
async fn a_turn_counts_as_at_work_while_it_waits_on_its_person_until_it_ends() {
    let root = tempfile::tempdir().unwrap();
    let working = Working::new();
    let mut count = working.count();
    let agents = Agents::new(harnesses()).counted_in(working);
    let world = World::new_with(root.path(), agents).await;
    assert_eq!(*count.borrow_and_update(), 0);

    let waits = world.send(None, "wait").await;
    world
        .until(&waits["thread"], |v| {
            texts(v).contains(&"message: Waiting.".to_owned())
        })
        .await;
    let asks = world.send(None, "please ask first").await;
    let view = world.until(&asks["thread"], asking).await;
    let (question, _) = open(&view).unwrap();
    assert_eq!(*count.borrow_and_update(), 2, "both run, waiting");

    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question, "choice": "allow" }),
        )
        .await
        .unwrap();
    let at_most = |n: usize| {
        let mut count = count.clone();
        async move {
            let counted = count.wait_for(|count| *count <= n);
            tokio::time::timeout(Duration::from_secs(10), counted)
                .await
                .expect("the count falls")
                .map(|count| *count)
                .unwrap()
        }
    };
    assert_eq!(at_most(1).await, 1, "the answered turn ended");
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": waits["turn"] }),
        )
        .await
        .unwrap();
    assert_eq!(at_most(0).await, 0, "the stopped one too");
    let view = world.thread(&asks["thread"]).await;
    assert_eq!(state(&view, &asks["turn"]), Some(TurnState::Done));
}

#[tokio::test]
async fn a_turn_its_harness_cancels_unasked_fails_rather_than_stops() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "quit now").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Failed)
        })
        .await;
    assert_eq!(
        view.turns[0].reason.as_deref(),
        Some("The Harness ended the turn by itself.")
    );
}

#[tokio::test]
async fn turns_wait_in_order_and_stop_before_or_while_they_run() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let slow = world.send(None, "slow please").await;
    let waiting = world.send(Some(&slow["thread"]), "hello").await;
    let view = world
        .until(&slow["thread"], |v| {
            state(v, &slow["turn"]) == Some(TurnState::Running)
        })
        .await;
    assert_eq!(state(&view, &waiting["turn"]), Some(TurnState::Queued));

    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": waiting["turn"] }),
        )
        .await
        .unwrap();
    let view = world.thread(&slow["thread"]).await;
    assert_eq!(
        state(&view, &waiting["turn"]),
        Some(TurnState::Stopped),
        "a waiting turn stops at once"
    );

    world
        .until(&slow["thread"], |v| {
            texts(v).iter().any(|t| t.starts_with("message: 0 "))
        })
        .await;
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": slow["turn"] }),
        )
        .await
        .unwrap();
    let view = world
        .until(&slow["thread"], |v| {
            state(v, &slow["turn"]) == Some(TurnState::Stopped)
        })
        .await;
    let replies = texts(&view);
    assert!(
        replies.iter().all(|t| !t.contains("You said")),
        "the stopped turn never ran: {replies:?}"
    );
}

#[tokio::test]
async fn a_harness_that_dies_fails_its_turn_and_the_next_turn_starts_it_again() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let crash = world.send(None, "crash now").await;
    let view = world
        .until(&crash["thread"], |v| {
            state(v, &crash["turn"]) == Some(TurnState::Failed)
        })
        .await;
    assert_eq!(view.turns[0].failure, Some(Failure::HarnessStopped));
    assert_eq!(
        view.turns[0].reason.as_deref(),
        Some("Fake stopped while it worked.")
    );

    let again = world.send(Some(&crash["thread"]), "hello again").await;
    let view = world
        .until(&crash["thread"], |v| {
            state(v, &again["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(
        texts(&view).last().unwrap(),
        "message: You said: hello again"
    );
}

#[test]
fn a_thread_on_a_harness_this_computer_lacks_fails_plainly() {
    let root = tempfile::tempdir().unwrap();
    let runtime = || tokio::runtime::Runtime::new().unwrap();
    let first = runtime();
    let (owner, project, thread) = first.block_on(async {
        let world = World::new(root.path()).await;
        let params = json!({ "harness": "elsewhere", "text": "hello" });
        let refused = world
            .call(world.person(), "agents.send", params)
            .await
            .unwrap_err();
        assert_eq!(
            refused.message,
            "This computer has no Harness named \"elsewhere\"."
        );
        let (thread, _) = world.finish(None, "hello").await;
        (world.owner, world.project, thread)
    });
    first.shutdown_timeout(Duration::from_secs(5));
    runtime().block_on(async {
        // The machine's list lost the Harness the Thread started on.
        let none = Agents::new(Harnesses::new(Vec::new()));
        let kernel = World::open_with(root.path(), owner, none).await;
        let world = World {
            kernel,
            owner,
            project,
            harness: "fake".to_owned(),
        };
        let sent = world.send(Some(&thread), "again").await;
        let view = world
            .until(&thread, |v| {
                state(v, &sent["turn"]) == Some(TurnState::Failed)
            })
            .await;
        assert_eq!(
            view.turns[1].reason.as_deref(),
            Some("This computer has no Harness named \"fake\".")
        );
    });
}

#[test]
fn a_restart_interrupts_the_turn_it_cut_short_and_closes_its_question() {
    let root = tempfile::tempdir().unwrap();
    let runtime = || tokio::runtime::Runtime::new().unwrap();

    let before = runtime();
    let (owner, project, thread, turn) = before.block_on(async {
        let world = World::new(root.path()).await;
        let sent = world.send(None, "ask before you check").await;
        world
            .until(&sent["thread"], |v| {
                v.items
                    .iter()
                    .any(|i| matches!(i.body, Body::Question { .. }))
            })
            .await;
        (
            world.owner,
            world.project,
            sent["thread"].clone(),
            sent["turn"].clone(),
        )
    });
    // The engine stops: its tasks end and the Harness's process goes.
    before.shutdown_timeout(Duration::from_secs(5));

    runtime().block_on(async {
        let kernel = World::open(root.path(), owner).await;
        let view = kernel
            .call(
                Participant::Person(owner),
                "agents.thread",
                Some(project),
                None,
                json!({ "thread": thread }),
            )
            .await
            .unwrap();
        let view: ThreadView = serde_json::from_value(view).unwrap();
        assert_eq!(state(&view, &turn), Some(TurnState::Interrupted));
        assert!(matches!(
            view.items.last().unwrap().body,
            Body::Question {
                state: QuestionState::Closed,
                ..
            }
        ));
    });
}

#[tokio::test]
async fn threads_of_one_agent_run_side_by_side() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let slow = world.send(None, "slow please").await;
    world
        .until(&slow["thread"], |v| {
            state(v, &slow["turn"]) == Some(TurnState::Running)
        })
        .await;
    let other = world.send(None, "hello").await;
    world
        .until(&other["thread"], |v| {
            state(v, &other["turn"]) == Some(TurnState::Done)
        })
        .await;
    let view = world.thread(&slow["thread"]).await;
    assert_eq!(
        state(&view, &slow["turn"]),
        Some(TurnState::Running),
        "the other Thread did not wait for the slow one"
    );
}

#[tokio::test]
async fn threads_on_one_harness_share_its_process() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, (first, process)) = ask_session(&world, None).await;
    let (_, (second, same)) = ask_session(&world, None).await;
    assert_ne!(first, second, "each Thread has its own session");
    assert_eq!(process, same, "in one process");
}

/// Restarts the engine between `before` and `after`, as the restart test
/// does: the first runtime's tasks end and the Harness's process goes.
fn across_a_restart<T>(
    root: &Path,
    agents: impl Fn() -> Agents,
    before: impl AsyncFnOnce(&World) -> T,
    after: impl AsyncFnOnce(&World, T),
) {
    let runtime = || tokio::runtime::Runtime::new().unwrap();
    let first = runtime();
    let (owner, project, harness, kept) = first.block_on(async {
        let world = World::new_with(root, agents()).await;
        let kept = before(&world).await;
        (world.owner, world.project, world.harness.clone(), kept)
    });
    first.shutdown_timeout(Duration::from_secs(5));
    runtime().block_on(async {
        let kernel = World::open_with(root, owner, agents()).await;
        let world = World {
            kernel,
            owner,
            project,
            harness,
        };
        after(&world, kept).await;
    });
}

/// As [`across_a_restart`], the engine's fence `fences.0` before and
/// `fences.1` after.
fn across_a_restart_fenced<T>(
    root: &Path,
    agents: impl Fn() -> Agents,
    fences: (Fence, Fence),
    before: impl AsyncFnOnce(&World) -> T,
    after: impl AsyncFnOnce(&World, T),
) {
    let runtime = || tokio::runtime::Runtime::new().unwrap();
    let first = runtime();
    let (owner, project, harness, kept) = first.block_on(async {
        let world = fenced_world(root, agents(), fences.0).await;
        let kept = before(&world).await;
        (world.owner, world.project, world.harness.clone(), kept)
    });
    first.shutdown_timeout(Duration::from_secs(5));
    runtime().block_on(async {
        let (kernel, _) = World::open_fenced(root, owner, agents(), fences.1).await;
        let world = World {
            kernel,
            owner,
            project,
            harness,
        };
        after(&world, kept).await;
    });
}

#[test]
fn a_thread_continues_its_session_after_a_restart() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart(
        root.path(),
        || Agents::new(harnesses()),
        async |world| ask_session(world, None).await,
        async |world, (thread, (session, process))| {
            let (_, (again, other)) = ask_session(world, Some(&thread)).await;
            assert_ne!(process, other, "a new process");
            assert_eq!(session, again, "continues the Thread's session");
            let view = world.thread(&thread).await;
            assert!(
                texts(&view).iter().all(|t| !t.starts_with("notice:")),
                "and says nothing about it: {:?}",
                texts(&view)
            );
            assert_eq!(
                slash_commands(&view),
                ["review", "compact"],
                "a resumed session, which has not said its slash commands, keeps the Thread's"
            );
        },
    );
}

#[test]
fn a_harness_that_lost_the_session_starts_afresh_and_says_so() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart(
        root.path(),
        || Agents::new(harnesses_with(&[("FAKE_AGENT_FORGETS", "1")])),
        async |world| ask_session(world, None).await,
        async |world, (thread, (session, _))| {
            let (_, (again, _)) = ask_session(world, Some(&thread)).await;
            assert_ne!(session, again, "a new session");
            let view = world.thread(&thread).await;
            assert!(
                texts(&view).iter().any(|t| t
                    == "notice: Fake could not pick up this Thread's earlier conversation, \
                        so it starts afresh and does not remember what was said before."),
                "and the Thread says so: {:?}",
                texts(&view)
            );
        },
    );
}

#[tokio::test]
async fn an_idle_harness_is_let_go_and_its_threads_resume() {
    let root = tempfile::tempdir().unwrap();
    let agents = Agents::new(harnesses()).idle_after(Duration::from_millis(100));
    let world = World::new_with(root.path(), agents).await;
    let (thread, (session, process)) = ask_session(&world, None).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let (_, (again, other)) = ask_session(&world, Some(&thread)).await;
    assert_ne!(process, other, "the idle process was let go");
    assert_eq!(session, again, "and the Thread resumed its session");
}

/// The `banda` an Agent runs in its shell acts under a pass walled to its
/// Project: its process's, the same through the process's restarts, and
/// a Thread's session's own, new each time it opens, which its request
/// hands Claude Code's adapter for the session's shell. The session's
/// names its Thread; the process's, which every Thread's shell shares,
/// names none (ADR 0083, decision 2).
#[tokio::test]
async fn an_agents_shell_gets_a_pass_walled_to_its_project() {
    let root = tempfile::tempdir().unwrap();
    let shells = root.path().join("shells.json");
    let engine = "ws://127.0.0.1:4000/ws";
    let pipe = Pipe {
        program: PathBuf::from("/bin/banda"),
        engine: engine.to_owned(),
    };
    let fake = harnesses_with(&[("FAKE_AGENT_SHELLS", shells.to_str().unwrap())]);
    let agents = (Agents::new(fake).piped(pipe)).idle_after(Duration::from_millis(100));
    let world = World::new_with(root.path(), agents).await;
    let told = || -> Value {
        let told = serde_json::from_slice(&std::fs::read(&shells).unwrap()).unwrap();
        std::fs::remove_file(&shells).unwrap();
        told
    };
    let walled = |variables: &Value| {
        assert_eq!(variables["BANDA_ENGINE"], engine);
        let pass = variables["BANDA_TOKEN"].as_str().expect("a pass");
        let (_, project) = world.kernel.holder(pass).expect("the engine knows it");
        assert_eq!(project, world.project, "its Project's");
        pass.to_owned()
    };
    let thread_of = |pass: &str| json!(world.kernel.caller(pass).and_then(|caller| caller.thread));

    let (thread, (opened_as, _)) = ask_session(&world, None).await;
    let opened = told();
    let process = walled(&opened["process"]);
    let session = walled(&opened["session"]);
    assert_ne!(session, process, "a Thread's session has its own");
    assert_eq!(thread_of(&session), thread, "which names its Thread");
    assert_eq!(thread_of(&process), Value::Null, "and the process's none");

    // A session aside, as for a title, is no Thread's: its shell has the
    // process's.
    world.suggest_title(&thread).await.unwrap();
    let aside = told();
    assert_eq!(walled(&aside["process"]), process);
    assert_eq!(aside["session"], Value::Null);

    tokio::time::sleep(Duration::from_millis(600)).await;
    let (_, (resumed_as, _)) = ask_session(&world, Some(&thread)).await;
    assert_eq!(resumed_as, opened_as, "the Thread resumed its session");
    let resumed = told();
    assert_eq!(
        walled(&resumed["process"]),
        process,
        "kept through a restart"
    );
    let again = walled(&resumed["session"]);
    assert_ne!(again, session, "a session opened again gets a new one");
    assert_eq!(thread_of(&again), thread, "for the same Thread");
}

/// Sends `text` in a new Thread and waits for its turn to fail.
async fn failing(world: &World, text: &str) -> (Value, ThreadView) {
    let sent = world.send(None, text).await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Failed)
        })
        .await;
    (sent, view)
}

#[tokio::test]
async fn a_failed_turn_says_what_kind_of_failure_it_was() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    for (text, failure, reason) in [
        (
            "sign in please",
            Failure::SignIn,
            "Fake needs you to sign in.",
        ),
        ("fail now", Failure::Provider, "Fake reported an error."),
        (
            "quit now",
            Failure::Provider,
            "The Harness ended the turn by itself.",
        ),
    ] {
        let (_, view) = failing(&world, text).await;
        assert_eq!(view.turns[0].failure, Some(failure), "{text}");
        assert_eq!(view.turns[0].reason.as_deref(), Some(reason), "{text}");
    }
}

#[tokio::test]
async fn a_usage_limit_says_when_it_resets() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = failing(&world, "over the limit").await;
    let Some(Failure::UsageLimit { until: Some(until) }) = view.turns[0].failure else {
        panic!("a usage limit with its reset: {:?}", view.turns[0]);
    };
    let in_an_hour = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        + 3_600_000;
    assert!((until - in_an_hour).abs() < 60_000, "{until}");
    assert_eq!(
        view.turns[0].reason.as_deref(),
        Some("You've hit your limit."),
        "in the Harness's own words"
    );
}

#[tokio::test]
async fn a_notice_from_the_harness_joins_the_thread() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "warn me").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(
        texts(&view)[1..],
        [
            "notice: The model is busy. The Harness tries again.",
            "thought: Reading the request.",
            "message: You said: warn me",
        ]
    );
}

/// What git did from a Thread's card, as a commit: the Thread shows it at
/// once, and its Agent reads it before its next message, and again in a
/// turn of that message tried again.
#[tokio::test]
async fn what_git_did_from_the_card_shows_at_once_and_goes_before_the_next_prompt() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let committed = "Committed 1 file on main: “Add a” (abc1234).";
    let acted = json!({ "thread": thread, "notice": committed });
    world.call(world.person(), "git.say", acted).await.unwrap();
    let view = world
        .until(&thread, |v| last_reply(v) == format!("notice: {committed}"))
        .await;
    assert_eq!(view.turns.len(), 1, "it starts no turn");

    // A slash command goes as it is; the next message takes it along, and
    // its turn tried again sends it again.
    let (_, view) = world.finish(Some(&thread), "/compact").await;
    assert_eq!(last_reply(&view), "message: You said: /compact");
    let sent = world.send(Some(&thread), "flaky go on").await;
    world
        .until(&thread, |v| {
            state(v, &sent["turn"]) == Some(TurnState::Failed)
        })
        .await;
    let retried = world
        .call(
            world.person(),
            "agents.retry",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| {
            state(v, &retried["turn"]) == Some(TurnState::Done)
        })
        .await;
    let said = last_reply(&view);
    assert!(
        said.starts_with("message: You said: Since your last turn, Banda told your Person this"),
        "{said}"
    );
    assert!(
        said.ends_with(&format!("\n- {committed}\n\nflaky go on")),
        "{said}"
    );
    let (_, view) = world.finish(Some(&thread), "again").await;
    assert_eq!(last_reply(&view), "message: You said: again", "only once");
}

/// A tab the Person lent the Thread, as the browser says it: the Thread
/// shows its line at once, and its Agent reads it before its next message
/// (ADR 0083, decision 4).
#[tokio::test]
async fn a_tab_lent_to_the_thread_shows_at_once_and_goes_before_the_next_prompt() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let lent = "You lent this Thread a tab · “Fix login redirect #598”";
    let told = json!({ "thread": thread, "notice": lent });
    world
        .call(world.person(), "browser.say", told)
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| last_reply(v) == format!("notice: {lent}"))
        .await;
    assert_eq!(view.turns.len(), 1, "it starts no turn");

    let (_, view) = world.finish(Some(&thread), "read the review").await;
    let said = last_reply(&view);
    assert!(
        said.starts_with("message: You said: Since your last turn, Banda told your Person this"),
        "{said}"
    );
    assert!(
        said.ends_with(&format!("\n- {lent}\n\nread the review")),
        "{said}"
    );
}

#[tokio::test]
async fn a_failed_turn_can_be_tried_again_once_it_is_the_latest() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (sent, _) = failing(&world, "flaky one").await;
    let retry = |turn: &Value| {
        world.call(
            world.person(),
            "agents.retry",
            json!({ "turn": turn.clone() }),
        )
    };
    let again = retry(&sent["turn"]).await.unwrap();
    assert_eq!(again["item"], sent["item"], "the same message");
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &again["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Failed));
    assert_eq!(opened(root.path(), &sent["turn"]).0, "person");
    assert_eq!(opened(root.path(), &again["turn"]).0, "retry");
    assert_eq!(texts(&view).last().unwrap(), "message: You said: flaky one");
    assert_eq!(
        view.items
            .iter()
            .filter(|i| matches!(i.body, Body::Message { .. }) && i.turn.is_none())
            .count(),
        1,
        "the message is not posted twice"
    );

    let twice = retry(&sent["turn"]).await.unwrap();
    assert_eq!(twice, Value::Null, "it went again already: nothing to do");
    let refused = retry(&again["turn"]).await.unwrap_err();
    assert!(refused.message.contains("failed"), "{}", refused.message);

    // A failed turn with a later one after it, which ran another message.
    let thread = &sent["thread"];
    let flaky = world.send(Some(thread), "flaky two").await;
    world
        .until(thread, |v| {
            state(v, &flaky["turn"]) == Some(TurnState::Failed)
        })
        .await;
    let later = world.send(Some(thread), "later").await;
    world
        .until(thread, |v| {
            state(v, &later["turn"]) == Some(TurnState::Done)
        })
        .await;
    let refused = retry(&flaky["turn"]).await.unwrap_err();
    assert!(refused.message.contains("latest"), "{}", refused.message);
}

/// A World whose fake agent has an account in `home`, signed out.
async fn signed_out(root: &Path, home: &Path) -> World {
    let home = home.display().to_string();
    let agents = Agents::new(harnesses_with(&[("FAKE_AGENT_HOME", &home)]));
    World::new_with(root, agents).await
}

impl World {
    /// Calls `method` of the machine's module `harnesses`.
    async fn on_machine(
        &self,
        who: Participant,
        method: &str,
        params: Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        let method = format!("harnesses.{method}");
        self.call_in(None, who, &method, params).await
    }

    async fn sign_in(&self, who: Participant, way: &str) -> Result<Value, banda_kernel::Refusal> {
        let params = json!({ "harness": "fake", "way": way });
        self.on_machine(who, "sign_in", params).await
    }

    /// Who is signed in to `harness`, as the machine says.
    async fn account_of(&self, harness: &str) -> Result<Value, banda_kernel::Refusal> {
        let params = json!({ "harness": harness });
        let accounted = self.on_machine(self.person(), "account", params).await?;
        Ok(accounted["account"].clone())
    }

    async fn account(&self) -> Value {
        self.account_of("fake").await.unwrap()
    }

    /// Tries the failed turn of `sent` again and waits for it to end:
    /// how it ended, and what was sent to try it.
    async fn retried(&self, sent: &Value) -> (TurnState, Value) {
        let params = json!({ "turn": sent["turn"] });
        let mut again = self
            .call(self.person(), "agents.retry", params)
            .await
            .unwrap();
        let view = self
            .until(&sent["thread"], |v| {
                state(v, &again["turn"])
                    .is_some_and(|s| s != TurnState::Queued && s != TurnState::Running)
            })
            .await;
        again["thread"] = sent["thread"].clone();
        (state(&view, &again["turn"]).unwrap(), again)
    }
}

#[tokio::test]
async fn a_person_signs_in_in_a_terminal_and_the_harness_starts_again() {
    let (root, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let world = signed_out(root.path(), home.path()).await;
    let (sent, view) = failing(&world, "hello").await;
    assert_eq!(view.turns[0].failure, Some(Failure::SignIn));

    let account = world.account().await;
    let ways = account["ways"].as_array().unwrap();
    assert_eq!(ways.len(), 2, "{account}");
    let terminal = &ways[0]["terminal"];
    assert_eq!(ways[0]["name"], "Fake account");
    assert_eq!(terminal["program"], fake_agent().display().to_string());
    assert_eq!(terminal["args"], json!(["--sign-in"]), "its own program");
    let home_path = home.path().display().to_string();
    assert_eq!(
        terminal["env"]["FAKE_AGENT_HOME"], home_path,
        "and its account"
    );
    assert!(
        ways[1].get("terminal").is_none(),
        "the other it does by itself"
    );

    // What a terminal does: the Person pastes the code the browser shows.
    let mut signing_in = std::process::Command::new(fake_agent())
        .arg("--sign-in")
        .env("FAKE_AGENT_HOME", &home_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    use std::io::Write as _;
    signing_in
        .stdin
        .take()
        .unwrap()
        .write_all(b"fake-code\n")
        .unwrap();
    assert!(
        signing_in.wait().unwrap().success(),
        "a right code signs in"
    );
    let (ended, again) = world.retried(&sent).await;
    assert_eq!(
        ended,
        TurnState::Failed,
        "the Harness read its account when it started"
    );
    world.sign_in(world.person(), "fake-sign-in").await.unwrap();
    let (ended, _) = world.retried(&again).await;
    assert_eq!(ended, TurnState::Done, "it starts again");
}

#[tokio::test]
async fn a_terminals_sign_in_tries_the_turn_that_needed_it_again_once() {
    let (root, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let world = signed_out(root.path(), home.path()).await;
    let (sent, _) = failing(&world, "hello").await;
    // What the way's program does in a terminal that ended with code 0.
    std::fs::write(home.path().join("signed-in"), "yes").unwrap();

    // A terminal Pane sends these once its program ended well: the sign-in
    // on the machine, then the retry in its Project (ADR 0040, decision 5).
    // Another window, or the same one after a reload, sends the same ones.
    let (signing, retrying) = (CommandId::new(), CommandId::new());
    let way = json!({ "harness": "fake", "way": "fake-sign-in" });
    let turn = json!({ "turn": sent["turn"] });
    let done = || async {
        let (kernel, who) = (&world.kernel, world.person());
        let method = "harnesses.sign_in";
        let signed = kernel.call(who, method, None, Some(signing), way.clone());
        assert_eq!(signed.await.unwrap(), Value::Null);
        let (project, method) = (Some(world.project), "agents.retry");
        kernel
            .call(who, method, project, Some(retrying), turn.clone())
            .await
    };
    let again = done().await.unwrap();
    assert_eq!(done().await.unwrap(), again, "once");
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &again["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(view.turns.len(), 2, "one turn went again");
}

#[tokio::test]
async fn a_harness_signs_in_by_itself_for_a_person_only() {
    let (root, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let world = signed_out(root.path(), home.path()).await;
    let (sent, _) = failing(&world, "hello").await;

    let agent = world.agent();
    let refused = world.sign_in(agent, "fake-browser").await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let refused = world
        .sign_in(world.person(), "elsewhere")
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    assert_eq!(refused.message, "Fake offers no such way to sign in.");

    world.sign_in(world.person(), "fake-browser").await.unwrap();
    assert_eq!(world.retried(&sent).await.0, TurnState::Done);
}

#[tokio::test]
async fn a_harness_says_who_is_signed_in_and_signs_out() {
    let (root, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let world = signed_out(root.path(), home.path()).await;
    let account = world.account().await;
    assert_eq!(account["adapter"]["name"], "banda-fake-agent", "{account}");
    assert_eq!(account["signs_out"], false, "no one to sign out");
    let no_one = &account["signed_in_as"];
    assert_eq!(no_one["signed_in"], false, "{account}");
    assert_eq!(no_one["label"], "Not logged in");

    world.sign_in(world.person(), "fake-browser").await.unwrap();
    let account = world.account().await;
    assert_eq!(account["signs_out"], true, "an account signs out");
    let signed_in = &account["signed_in_as"];
    assert_eq!(signed_in["signed_in"], true, "{signed_in}");
    assert_eq!(signed_in["label"], "Fake Pro");
    assert_eq!(signed_in["email"], "person@example.invalid");

    let sign_out = |who| world.on_machine(who, "sign_out", json!({ "harness": "fake" }));
    let refused = sign_out(world.agent()).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    sign_out(world.person()).await.unwrap();
    let account = world.account().await;
    assert_eq!(account["signed_in_as"]["signed_in"], false, "{account}");
    let (_, view) = failing(&world, "hello").await;
    assert_eq!(
        view.turns[0].failure,
        Some(Failure::SignIn),
        "it is signed out"
    );
}

#[tokio::test]
async fn a_sign_in_on_the_machine_starts_each_projects_harness_again() {
    let (root, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let world = signed_out(root.path(), home.path()).await;
    let list = world.on_machine(world.person(), "list", json!({})).await;
    assert_eq!(list.unwrap()[0]["id"], "fake");
    let (sent, view) = failing(&world, "hello").await;
    assert_eq!(view.turns[0].failure, Some(Failure::SignIn));

    let fake = json!({ "harness": "fake" });
    let accounted = world.on_machine(world.person(), "account", fake).await;
    let accounted = accounted.unwrap();
    assert!(accounted["at"].is_i64(), "{accounted}");

    world.sign_in(world.person(), "fake-browser").await.unwrap();
    let machine = world.kernel.machine().unwrap();
    let log = world.kernel.follow(world.person(), machine).await.unwrap();
    let events = log.events_after(0, account_changed(), 100).await.unwrap();
    let changed: Vec<_> = events.iter().map(|e| e.subject.as_deref()).collect();
    assert_eq!(
        changed,
        [Some("fake")],
        "the machine says the account changed"
    );
    assert_eq!(
        world.retried(&sent).await.0,
        TurnState::Done,
        "the Project's Harness started again, and read the account"
    );
}

/// The fake agent as the only Harness, running the CLI `program`.
fn with_cli(program: &str) -> Agents {
    with_cli_since(program, None)
}

/// The fake agent running the CLI `program`, which must be at least
/// `minimum`.
fn with_cli_since(program: &str, minimum: Option<&str>) -> Agents {
    Agents::new(Harnesses::new(vec![Harness {
        id: "fake".into(),
        name: "Fake".into(),
        short: None,
        command: fake_agent().display().to_string(),
        enabled: true,
        retired: None,
        args: Vec::new(),
        env: Default::default(),
        cli: Some(Cli {
            program: program.to_owned(),
            variable: "FAKE_AGENT_CLI".to_owned(),
            minimum: minimum.map(str::to_owned),
        }),
        of: None,
        kind: Default::default(),
        mark: None,
        icon: None,
        colour: None,
        shadows: None,
        carried: None,
        record: None,
        cwd: None,
        holes: Holes::default(),
        credentials: Default::default(),
    }]))
}

// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn a_harness_runs_the_persons_own_cli_and_says_its_version() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let agents = with_cli_since(&cli.display().to_string(), Some("9.9.9"));
    let world = World::new_with(root.path(), agents).await;
    let account = world.account().await;
    assert_eq!(
        account["cli"]["path"],
        cli.display().to_string(),
        "{account}"
    );
    assert_eq!(account["cli"]["version"], "9.9.9");
    assert!(account["cli"].get("outdated").is_none(), "{account}");
    let (_, view) = world.finish(None, "hello").await;
    assert_eq!(view.offer.outdated, None);
}

/// Every Harness process starts in the environment of the Project it is
/// for, and the machine's own in the engine's, never by the module itself
/// (ADR 0084, decisions 4 and 5): the Harness's program, and the CLI it
/// runs as it is asked its version. A short run apart from the Thread
/// runs in the process the Thread has. Each says it is a Harness's, to
/// start behind the fence: the Project's with its holes in it, in its
/// folder once the Person trusts it; the machine's and the CLI asked with
/// none (ADR 0083, decision 1).
// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn every_harness_process_starts_in_its_projects_environment() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let agents = with_cli_since(&cli.display().to_string(), None);
    let owner = PersonId::new();
    let (kernel, asks) = World::open_asked(root.path(), owner, agents).await;
    let world = World::in_a_project(kernel, owner, "fake").await;

    let (thread, _) = world.finish(None, "hello").await;
    let started = asks.of("banda-fake-agent");
    let [thread_s] = &started[..] else {
        panic!("one process for the Thread: {started:?}");
    };
    assert_eq!(thread_s.how, How::Spawn);
    let project = world.project.to_string();
    assert_eq!(thread_s.program.env["BANDA_PROJECT"], project);
    let opened = world.kernel.project(world.project).await.unwrap();
    assert_eq!(thread_s.program.cwd, Some(opened.folder()), "its folder");
    assert_eq!(thread_s.program.whose(), Whose::Harness);
    let holes = Holes {
        reads: vec![opened.data().join("files")],
        ..Holes::default()
    };
    assert_eq!(thread_s.program.holes(), Some(&holes), "its kept files");
    let asked_cli = asks.of("fake-cli");
    let [version] = &asked_cli[..] else {
        panic!("its CLI asked once: {asked_cli:?}");
    };
    assert_eq!(version.program.args, ["--version"]);
    assert_eq!(version.program.env["BANDA_PROJECT"], project);
    assert_eq!(version.program.whose(), Whose::HarnessProbe);
    assert_eq!(version.program.holes(), Some(&Holes::default()));

    // The machine's own process, which only says who is signed in.
    world.account().await;
    let started = asks.of("banda-fake-agent");
    assert_eq!(started.len(), 2, "{started:?}");
    let machine_s = &started[1].program;
    assert!(!machine_s.env.contains_key("BANDA_PROJECT"));
    assert_eq!(machine_s.whose(), Whose::Harness);
    let none = (machine_s.cwd.as_ref(), machine_s.holes());
    assert_eq!(none, (None, Some(&Holes::default())), "no Project's");
    assert_eq!(
        asks.of("fake-cli").len(),
        3,
        "its start and the account ask"
    );

    // A short run goes to the Thread's process, already running.
    let written = world.written(json!({ "thread": thread, "prompt": "which session" }));
    written.await.unwrap();
    assert_eq!(asks.of("banda-fake-agent").len(), 2);

    // A Project the Person has not trusted starts its process where the
    // engine runs, with the same holes as any.
    let create = json!({ "name": "Cloned", "trusted": false });
    let cloned = (world.kernel)
        .call(
            world.person(),
            "projects.create",
            None,
            Some(CommandId::new()),
            create,
        )
        .await
        .unwrap();
    let cloned = World {
        kernel: world.kernel.clone(),
        owner: world.owner,
        project: serde_json::from_value(cloned["id"].clone()).unwrap(),
        harness: world.harness.clone(),
    };
    cloned.finish(None, "hello").await;
    let started = asks.of("banda-fake-agent");
    let [.., cloned_s] = &started[..] else {
        panic!("its own process: {started:?}");
    };
    assert_eq!(started.len(), 3, "{started:?}");
    let opened = cloned.kernel.project(cloned.project).await.unwrap();
    assert!(!opened.trusted());
    assert_eq!(cloned_s.program.cwd, None, "not in its folder");
    let holes = Holes {
        reads: vec![opened.data().join("files")],
        ..Holes::default()
    };
    assert_eq!(cloned_s.program.holes(), Some(&holes));
}

/// A CLI in `folder` that says it is 9.9.9.
#[cfg(unix)]
fn fake_cli(folder: &Path) -> PathBuf {
    let cli = folder.join("fake-cli");
    std::fs::write(&cli, "#!/bin/sh\necho '9.9.9 (Fake CLI)'\n").unwrap();
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
    cli
}

// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn a_cli_older_than_its_harness_supports_runs_and_its_threads_warn() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path()).display().to_string();
    let world = World::new_with(root.path(), with_cli_since(&cli, Some("9.10.0"))).await;
    let warning = "fake-cli 9.9.9 is older than 9.10.0, which Banda's Fake adapter was \
                   built for. It still runs, but some things may not work until you update it.";
    let account = world.account().await;
    assert_eq!(account["cli"]["outdated"], warning, "{account}");
    let (thread, view) = world.finish(None, "hello").await;
    assert_eq!(view.turns[0].state, TurnState::Done, "it still runs");
    assert_eq!(view.offer.outdated.as_deref(), Some(warning));

    // The Person updates it and checks again; the Harness keeps running.
    std::fs::write(&cli, "#!/bin/sh\necho '9.10.0 (Fake CLI)'\n").unwrap();
    let account = world.account().await;
    assert_eq!(account["cli"]["version"], "9.10.0");
    assert!(account["cli"].get("outdated").is_none(), "{account}");
    let (_, view) = world.finish(Some(&thread), "hello again").await;
    assert_eq!(view.offer.outdated, None);
}

#[tokio::test]
async fn a_harness_whose_cli_is_not_installed_does_not_start() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new_with(root.path(), with_cli("banda-no-such-cli")).await;
    let refused = world.account_of("fake").await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert!(
        refused.message.contains("not installed"),
        "{}",
        refused.message
    );
    // It stays so until the Person installs it: a final refusal, which a
    // sign-in's receipt keeps (ADR 0082, decision 4).
    let refused = world.sign_in(world.person(), "fake-browser").await;
    let refused = refused.unwrap_err();
    assert_eq!(refused.code, Code::Conflict, "{refused:?}");
    assert!(refused.code.is_final());
}

/// A Harness that did not start may start when asked again: its sign-in
/// is refused as `internal`, which the receipt does not keep, so the same
/// command sent again runs (ADR 0082, decision 4).
#[tokio::test]
async fn a_sign_in_whose_harness_did_not_start_runs_when_sent_again() {
    let (root, home, bin) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    let home = home.path().display().to_string();
    let program = bin.path().join("fake-agent");
    let mut fake = fake_with(&[("FAKE_AGENT_HOME", &home)]);
    fake.command = program.display().to_string();
    let agents = Agents::new(Harnesses::new(vec![fake]));
    let world = World::new_with(root.path(), agents).await;

    let command = CommandId::new();
    let way = json!({ "harness": "fake", "way": "fake-browser" });
    let sign_in = || {
        let (kernel, who) = (&world.kernel, world.person());
        kernel.call(who, "harnesses.sign_in", None, Some(command), way.clone())
    };
    let refused = sign_in().await.unwrap_err();
    assert_eq!(refused.code, Code::Internal, "{refused:?}");
    assert!(refused.message.contains("Harness"), "{}", refused.message);

    // Its program is there now, as after an install that was still going.
    #[cfg(unix)]
    std::os::unix::fs::symlink(fake_agent(), &program).unwrap();
    // A copy, as a link on Windows needs Developer Mode; Windows starts
    // `fake-agent` as `fake-agent.exe`.
    #[cfg(windows)]
    std::fs::copy(
        fake_agent().with_extension("exe"),
        program.with_extension("exe"),
    )
    .unwrap();
    assert_eq!(sign_in().await.unwrap(), Value::Null, "it ran this time");
    let account = world.account().await;
    assert_eq!(account["signed_in_as"]["signed_in"], true, "{account}");
}

#[tokio::test]
async fn a_harness_that_does_not_report_shows_no_one() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let account = world.account().await;
    assert!(account.get("signed_in_as").is_none(), "{account}");
    assert_eq!(account["signs_out"], false);
    let refused = world
        .on_machine(world.person(), "sign_out", json!({ "harness": "fake" }))
        .await
        .unwrap_err();
    // It does not sign out from Banda for as long as it runs so.
    assert_eq!(refused.code, Code::Conflict, "{refused:?}");
}

impl World {
    async fn defaults(&self) -> Value {
        let params = json!({ "harness": self.harness });
        self.call(self.person(), "agents.defaults", params)
            .await
            .unwrap()
    }

    async fn configure(&self, thread: &Value, settings: Value) {
        self.call(
            self.person(),
            "agents.configure",
            json!({ "thread": thread, "settings": settings }),
        )
        .await
        .unwrap();
    }

    /// Sends `text` and waits for its turn to end as it did.
    async fn finish(&self, thread: Option<&Value>, text: &str) -> (Value, ThreadView) {
        let sent = self.send(thread, text).await;
        let view = self
            .until(&sent["thread"], |v| {
                state(v, &sent["turn"])
                    .is_some_and(|s| s != TurnState::Queued && s != TurnState::Running)
            })
            .await;
        (sent["thread"].clone(), view)
    }

    /// Sends `text` to a real Harness and waits, as a model may, for its
    /// turn to end done.
    async fn finish_real(&self, thread: Option<&Value>, text: &str) -> (Value, ThreadView) {
        let sent = self.send(thread, text).await;
        let view = self
            .until_within(Duration::from_secs(300), &sent["thread"], |v| {
                !ongoing(v, &sent["turn"])
            })
            .await;
        assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Done));
        (sent["thread"].clone(), view)
    }
}

fn last_reply(view: &ThreadView) -> String {
    texts(view).last().cloned().unwrap_or_default()
}

#[tokio::test]
async fn a_threads_settings_become_its_harnesss_options() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "which settings").await;
    assert_eq!(
        last_reply(&view),
        "message: Mode bypassPermissions, model fast, brief false",
        "full access is the default"
    );
    assert_eq!(view.settings, Settings::default());
    let offered: Vec<_> = view.offer.options.iter().map(|o| o.id.as_str()).collect();
    assert_eq!(
        offered,
        ["model", "effort", "fast", "brief"],
        "the mode stands for the Harness's own"
    );
    assert!(view.offer.plans);

    world
        .configure(
            &thread,
            json!({ "mode": "supervised", "options": { "model": "smart", "brief": true } }),
        )
        .await;
    let (_, view) = world.finish(Some(&thread), "which settings").await;
    assert_eq!(
        last_reply(&view),
        "message: Mode default, model smart, brief true"
    );
    assert_eq!(view.settings.mode, Mode::Supervised);
    let model = &view.offer.options[0];
    assert_eq!(model.value, OptionValue::Choice("smart".into()));

    world
        .configure(&thread, json!({ "mode": "full_access", "plan": true }))
        .await;
    let (_, view) = world.finish(Some(&thread), "which settings").await;
    assert_eq!(
        last_reply(&view),
        "message: Mode plan, model smart, brief true"
    );

    let (_, view) = world.finish(Some(&thread), "plan done").await;
    assert_eq!(last_reply(&view), "message: The plan is ready.");
    assert_eq!(
        (view.settings.mode, view.settings.plan),
        (Mode::AcceptEdits, false),
        "the Thread follows the Harness out of its plan"
    );
}

#[tokio::test]
async fn without_modes_of_its_own_a_harness_is_answered_by_the_threads_mode() {
    let root = tempfile::tempdir().unwrap();
    let agents = Agents::new(harnesses_with(&[("FAKE_AGENT_NO_MODES", "1")]));
    let world = World::new_with(root.path(), agents).await;
    let (thread, view) = world.finish(None, "please ask first").await;
    assert_eq!(
        texts(&view),
        [
            "message: please ask first",
            "tool: Run a check (Done)",
            "message: The check passed.",
        ],
        "full access allows it without a Question"
    );
    assert!(!view.offer.plans);

    world
        .configure(&thread, json!({ "mode": "supervised" }))
        .await;
    let sent = world.send(Some(&thread), "please ask first").await;
    let view = world
        .until(&thread, |v| {
            v.items.iter().any(|i| {
                matches!(
                    i.body,
                    Body::Question {
                        state: QuestionState::Open,
                        ..
                    }
                )
            })
        })
        .await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Running));
}

#[tokio::test]
async fn a_new_thread_starts_with_full_access_and_what_its_harness_offers() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let first = world.defaults().await;
    assert_eq!(first["settings"]["mode"], "full_access");
    assert_eq!(first["offer"]["options"], json!([]), "nothing offered yet");

    let params = json!({
        "harness": world.harness,
        "text": "which settings",
        "settings": { "mode": "auto", "options": { "model": "smart" } },
    });
    let sent = world
        .call(world.person(), "agents.send", params)
        .await
        .unwrap();
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(view.settings.mode, Mode::Auto);
    assert_eq!(
        last_reply(&view),
        "message: Mode auto, model smart, brief false"
    );

    let after = world.defaults().await;
    assert_eq!(after["settings"]["mode"], "full_access", "a Thread's own");
    let offered = after["offer"]["options"].as_array().unwrap();
    assert_eq!(offered[0]["id"], "model", "what the Harness offered");
    for option in offered {
        assert_eq!(
            after["settings"]["options"][option["id"].as_str().unwrap()],
            option["value"],
            "what the composer shows is what a new Thread gets"
        );
    }
    let elsewhere = world
        .call(
            world.person(),
            "agents.defaults",
            json!({ "harness": "elsewhere" }),
        )
        .await
        .unwrap_err();
    assert_eq!(elsewhere.code, Code::Invalid);
}

#[tokio::test]
async fn a_new_thread_starts_as_agents_toml_says_for_its_harness() {
    let root = tempfile::tempdir().unwrap();
    let start = "[start.fake]\nmode = \"auto\"\nmodel = \"smart\"\nnothing = true\n";
    std::fs::write(root.path().join("agents.toml"), start).unwrap();
    let agents = Agents::new(harnesses()).config_in(root.path().to_owned());
    let world = World::new_with(root.path(), agents).await;

    // Sent with no settings, as an Agent or the CLI sends: the entry's.
    let sent = world.send(None, "which settings").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(view.settings.mode, Mode::Auto);
    assert!(last_reply(&view).starts_with("message: Mode auto, model smart"));

    // The composer shows it, with only what the Harness offers.
    let defaults = world.defaults().await;
    assert_eq!(defaults["settings"]["mode"], "auto");
    assert_eq!(defaults["settings"]["options"]["model"], "smart");
    assert!(defaults["settings"]["options"].get("nothing").is_none());
}

/// A fence that does not hold, as on a system that gives no namespaces.
fn missing() -> Fence {
    Fence::missing(
        FenceWhy::NoUserNamespaces,
        "This system gives no namespaces.",
    )
}

/// A Project of an engine whose fence is `fence`.
async fn fenced_world(root: &Path, agents: Agents, fence: Fence) -> World {
    let owner = PersonId::new();
    let (kernel, _) = World::open_fenced(root, owner, agents, fence).await;
    World::in_a_project(kernel, owner, "fake").await
}

/// What `thread.configured` said why of each time Banda started the
/// Thread Supervised.
async fn started_supervised(world: &World, thread: &Value) -> Vec<Value> {
    let filter = EventFilter {
        module: Some("agents".to_owned()),
        subject: thread.as_str().map(str::to_owned),
        kinds: Some(vec!["thread.configured".to_owned()]),
    };
    let project = world.kernel.project(world.project).await.unwrap();
    let events = project.events_after(0, filter, usize::MAX).await.unwrap();
    (events.into_iter())
        .filter_map(|event| event.payload.get("supervised").cloned())
        .collect()
}

#[tokio::test]
async fn a_new_thread_starts_supervised_where_the_fence_does_not_hold_whole() {
    let partly = Fence::holds(vec![FenceLayer::Namespaces], false);
    let docker = Fence::holds(vec![FenceLayer::Namespaces, FenceLayer::Landlock], true);
    for fence in [missing(), partly, docker] {
        let root = tempfile::tempdir().unwrap();
        let world = fenced_world(root.path(), Agents::new(harnesses()), fence.clone()).await;
        let defaults = world.defaults().await;
        assert_eq!(defaults["settings"]["mode"], "supervised", "{fence:?}");
        let (thread, view) = world.finish(None, "which settings").await;
        assert_eq!(view.settings.mode, Mode::Supervised, "{fence:?}");
        assert!(last_reply(&view).starts_with("message: Mode default"));
        assert!(!view.unfenced);

        // The Person chooses Full access, knowing: it runs so.
        world
            .configure(&thread, json!({ "mode": "full_access" }))
            .await;
        let (_, view) = world.finish(Some(&thread), "which settings").await;
        assert!(view.unfenced, "{fence:?}");
        assert_eq!(view.settings.mode, Mode::FullAccess);
        assert!(last_reply(&view).starts_with("message: Mode bypassPermissions"));
        assert!(started_supervised(&world, &thread).await.is_empty());
    }
}

/// Full access in `agents.toml` is the Person's choice only as they chose
/// it in Settings, which the engine keeps: one the file says by itself,
/// written by hand or by anything else, is no one's, and where the fence
/// does not hold a new Thread starts Supervised. Where it holds, nothing
/// changes (ADR 0083, F0-3; Roma, 2026-11-08).
#[tokio::test]
async fn full_access_in_agents_toml_is_the_persons_choice_only_as_they_chose_it_in_settings() {
    let start = "[start.fake]\nmode = \"full_access\"\n";
    let agents = |root: &Path| {
        std::fs::write(root.join("agents.toml"), start).unwrap();
        let modes = root.join("state").join(chosen_modes::FILE);
        let agents = Agents::new(harnesses()).config_in(root.to_owned());
        (agents.modes_chosen_in(modes.clone()), modes)
    };
    let root = tempfile::tempdir().unwrap();
    let (unfenced, modes) = agents(root.path());
    let world = fenced_world(root.path(), unfenced, missing()).await;
    // Only the file says it.
    assert_eq!(world.defaults().await["settings"]["mode"], "supervised");
    let (_, view) = world.finish(None, "which settings").await;
    assert_eq!(view.settings.mode, Mode::Supervised);
    assert!(!view.unfenced);
    assert!(last_reply(&view).starts_with("message: Mode default"));

    // Chosen in Settings: it runs as chosen.
    chosen_modes::choose(&modes, "fake", Some(Mode::FullAccess)).unwrap();
    assert_eq!(world.defaults().await["settings"]["mode"], "full_access");
    let (_, view) = world.finish(None, "which settings").await;
    assert_eq!(view.settings.mode, Mode::FullAccess);
    assert!(view.unfenced);
    assert!(last_reply(&view).starts_with("message: Mode bypassPermissions"));

    // Another chosen there since, and the file's Full access is no one's.
    chosen_modes::choose(&modes, "fake", Some(Mode::Supervised)).unwrap();
    assert_eq!(world.defaults().await["settings"]["mode"], "supervised");

    // Where the fence holds, the file's goes as it is.
    let root = tempfile::tempdir().unwrap();
    let (fenced, _) = agents(root.path());
    let world = fenced_world(root.path(), fenced, holds()).await;
    assert_eq!(world.defaults().await["settings"]["mode"], "full_access");
    let (_, view) = world.finish(None, "which settings").await;
    assert_eq!(view.settings.mode, Mode::FullAccess);
    assert!(!view.unfenced);
}

#[test]
fn full_access_the_fence_no_longer_keeps_starts_supervised_and_says_why() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart_fenced(
        root.path(),
        || Agents::new(harnesses()),
        (holds(), missing()),
        async |world| {
            let (thread, view) = world.finish(None, "which settings").await;
            assert_eq!(view.settings.mode, Mode::FullAccess, "where it holds");
            assert!(!view.unfenced);
            thread
        },
        async |world, thread| {
            let (_, view) = world.finish(Some(&thread), "which settings").await;
            assert!(last_reply(&view).starts_with("message: Mode default"));
            assert_eq!(view.settings.mode, Mode::Supervised, "and stays so");
            let why = started_supervised(world, &thread).await;
            let fence = serde_json::to_value(missing()).unwrap();
            assert_eq!(why, [json!({ "before": false, "fence": fence })]);

            // Chosen again, knowing the fence does not hold: as chosen.
            world
                .configure(&thread, json!({ "mode": "full_access" }))
                .await;
            let (_, view) = world.finish(Some(&thread), "which settings").await;
            assert!(last_reply(&view).starts_with("message: Mode bypassPermissions"));
            assert!(view.unfenced);
            assert_eq!(started_supervised(world, &thread).await.len(), 1);
        },
    );
}

/// The Person's GitHub token and their SSH agent go to a Harness's
/// programs only in a Project the Person said they trust (ADR 0083, F0-3).
#[tokio::test]
async fn only_a_project_the_person_said_they_trust_gets_their_github_token_and_ssh_agent() {
    banda_harnesses::github::keep(Some("t0ken".to_owned()));
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let (kernel, asks) = World::open_asked(root.path(), owner, Agents::new(harnesses())).await;
    // Trusted as nothing marked it foreign, which is not said.
    let world = World::in_a_project(kernel, owner, "fake").await;
    world.finish(None, "hello").await;
    let said = (world.kernel)
        .call(
            world.person(),
            "projects.create",
            None,
            Some(CommandId::new()),
            json!({ "name": "Said", "trusted": true }),
        )
        .await
        .unwrap();
    assert_eq!(said["trust_said"], true);
    let said = World {
        kernel: world.kernel.clone(),
        owner,
        project: serde_json::from_value(said["id"].clone()).unwrap(),
        harness: world.harness.clone(),
    };
    said.finish(None, "hello").await;
    let started = asks.of("banda-fake-agent");
    let token_of = |project: ProjectId| -> Vec<Option<String>> {
        (started.iter())
            .filter(|asked| asked.program.env.get("BANDA_PROJECT") == Some(&project.to_string()))
            .map(|asked| asked.program.env.get("GH_TOKEN").cloned())
            .collect()
    };
    assert_eq!(token_of(world.project), [None]);
    assert_eq!(token_of(said.project), [Some("t0ken".to_owned())]);
    // The SSH agent: its socket bound behind the fence, and its variable
    // kept, only where trust was said.
    let agent_of = |project: ProjectId| -> Vec<(bool, bool)> {
        (started.iter())
            .filter(|asked| asked.program.env.get("BANDA_PROJECT") == Some(&project.to_string()))
            .map(|asked| {
                let bound = asked.program.holes().is_some_and(|holes| holes.ssh_agent);
                let unset = asked
                    .program
                    .unset
                    .iter()
                    .any(|name| name == "SSH_AUTH_SOCK");
                (bound, unset)
            })
            .collect()
    };
    assert_eq!(agent_of(world.project), [(false, true)]);
    assert_eq!(agent_of(said.project), [(true, false)]);
}

#[tokio::test]
async fn a_message_runs_with_the_settings_it_was_sent_with() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let slow = world.send(None, "slow please").await;
    let thread = slow["thread"].clone();
    world
        .configure(&thread, json!({ "mode": "supervised" }))
        .await;
    let supervised = world.send(Some(&thread), "which settings").await;
    let params = json!({
        "thread": thread,
        "text": "which settings",
        "settings": { "mode": "full_access" },
    });
    let full = world
        .call(world.person(), "agents.send", params)
        .await
        .unwrap();
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": slow["turn"] }),
        )
        .await
        .unwrap();
    // The stop holds the queue until the Person lets it go.
    world
        .call(world.person(), "agents.resume", json!({ "thread": thread }))
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| {
            state(v, &full["turn"]) == Some(TurnState::Done)
        })
        .await;
    let replies: Vec<_> = view
        .items
        .iter()
        .filter(|i| [&supervised["turn"], &full["turn"]].contains(&&json!(i.turn)))
        .filter(|i| matches!(i.author, Participant::Agent(_)))
        .map(|i| match &i.body {
            Body::Message { text, .. } => text.split(',').next().unwrap(),
            _ => "",
        })
        .collect();
    assert_eq!(replies, ["Mode default", "Mode bypassPermissions"]);
}

#[tokio::test]
async fn only_a_person_chooses_how_freely_an_agent_acts() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let agent = world.agent();
    let settings = json!({ "mode": "full_access" });
    let configured = world
        .call(
            agent,
            "agents.configure",
            json!({ "thread": thread, "settings": settings }),
        )
        .await;
    assert_eq!(configured.unwrap_err().code, Code::Forbidden);
    let params = json!({
        "thread": thread,
        "text": "go on",
        "settings": settings,
    });
    let sent = world.call(agent, "agents.send", params).await;
    assert_eq!(sent.unwrap_err().code, Code::Forbidden);
    // Another Thread's Agent writes with the settings the Thread has.
    let (_, other) = world.finish(None, "hi there").await;
    world
        .write(agent_of(&other), Some(&thread), "go on")
        .await
        .unwrap();
}

/// Whether the Thread waits on an open Question.
fn asking(view: &ThreadView) -> bool {
    open(view).is_some()
}

#[tokio::test]
async fn a_form_question_takes_what_the_person_fills_in() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "choose a colour").await;
    let thread = sent["thread"].clone();
    let view = world.until(&thread, asking).await;
    let question = view.items.last().unwrap();
    let Body::Question {
        title,
        choices,
        form: Some(form),
        ..
    } = &question.body
    else {
        panic!("a Question with a form: {question:?}")
    };
    assert_eq!(title, "Which colour?");
    let answers: Vec<_> = choices.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(answers, ["Submit", "Skip"]);
    let fields: Vec<_> = form.iter().map(|f| f.title.as_str()).collect();
    assert_eq!(fields, ["Colour", "Other"]);

    let answer = |choice: &str, values: Value| {
        let params = json!({ "item": question.id, "choice": choice, "values": values });
        world.call(world.person(), "agents.answer", params)
    };
    let green = answer("accept", json!({ "question_0": "Green" })).await;
    assert_eq!(
        green.unwrap_err().code,
        Code::Invalid,
        "not one of its colours"
    );
    answer("accept", json!({ "question_0": "Blue" }))
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| {
            state(v, &sent["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(last_reply(&view), "message: You chose Blue.");

    let again = world.send(Some(&thread), "choose once more").await;
    let view = world.until(&thread, asking).await;
    let skip = json!({ "item": view.items.last().unwrap().id, "choice": "decline" });
    world
        .call(world.person(), "agents.answer", skip)
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| {
            state(v, &again["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert_eq!(last_reply(&view), "message: You skipped the question.");
}

#[tokio::test]
async fn a_question_the_harness_stops_waiting_for_closes() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "choose quickly").await;
    assert!(
        matches!(
            view.items[1].body,
            Body::Question {
                state: QuestionState::Closed,
                ..
            }
        ),
        "{:?}",
        view.items[1]
    );
    assert_eq!(last_reply(&view), "message: The question was cancelled.");
}

/// The last tool call's body in a Thread.
fn last_tool(view: &ThreadView) -> &Body {
    let tool = view
        .items
        .iter()
        .rev()
        .find(|i| matches!(i.body, Body::Tool { .. }));
    &tool.expect("a tool call").body
}

#[tokio::test]
async fn the_diff_s_turn_is_what_the_turn_s_tool_calls_changed() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "edit the notes").await;
    world.finish(Some(&thread), "just answer").await;
    let listed = world
        .call(
            world.person(),
            "agents.changes",
            json!({ "thread": thread }),
        )
        .await
        .unwrap();
    assert_eq!(listed["turns"].as_array().unwrap().len(), 1, "{listed}");
    assert_eq!(listed["turns"][0]["said"], "edit the notes");
    assert_eq!(listed["turns"][0]["n"], 1);
    assert_eq!(listed["files"], json!([]));

    let turn = listed["turns"][0]["turn"].clone();
    let one = world
        .call(
            world.person(),
            "agents.changes",
            json!({ "thread": thread, "turn": turn }),
        )
        .await
        .unwrap();
    assert_eq!(
        one["files"],
        json!([{ "path": "/work/notes.md", "old": "one\ntwo\nthree\n", "new": "one\n2\nthree\nfour\n" }])
    );
    let gone = world
        .call(
            world.person(),
            "agents.changes",
            json!({ "thread": banda_kernel::ProjectId::new() }),
        )
        .await;
    assert_eq!(gone.unwrap_err().code, Code::NotFound);
}

#[tokio::test]
async fn a_tool_call_shows_its_diff_and_what_its_command_printed() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "edit the notes").await;
    let Body::Tool { content, .. } = last_tool(&view) else {
        unreachable!()
    };
    assert_eq!(
        content,
        &[ToolContent::Diff {
            path: "/work/notes.md".into(),
            old: Some("one\ntwo\nthree\n".into()),
            new: "one\n2\nthree\nfour\n".into(),
        }]
    );

    let (_, view) = world.finish(Some(&thread), "run the tests").await;
    let Body::Tool {
        status,
        content,
        output,
        ..
    } = last_tool(&view)
    else {
        unreachable!()
    };
    assert_eq!(
        (*status, content.as_slice()),
        (ToolStatus::Done, &[ToolContent::Terminal][..])
    );
    let output = output.as_ref().expect("what it printed");
    assert_eq!(output.text, "test one ... ok\ntest two ... ok\n");
    let exited = Exit {
        code: Some(0),
        signal: None,
    };
    assert_eq!((output.exit.as_ref(), output.cut), (Some(&exited), false));

    // Claude Code sends it all at the end, and may not know how it ended.
    let (_, view) = world.finish(Some(&thread), "run them at once").await;
    let Body::Tool {
        content, output, ..
    } = last_tool(&view)
    else {
        unreachable!()
    };
    assert_eq!(content, &[ToolContent::Terminal]);
    let output = output.as_ref().expect("what it printed");
    assert_eq!(output.text, "test one ... ok\ntest two ... ok\n");
    assert_eq!(output.exit, Some(Exit::default()));
    let reply = view.items.last().expect("the reply");
    assert!(
        matches!(&reply.body, Body::Message { text, .. } if text == "The tests passed."),
        "the reply after a tool call is a message of its own: {reply:?}"
    );

    let (_, view) = world.finish(Some(&thread), "run them loud").await;
    let Body::Tool { output, .. } = last_tool(&view) else {
        unreachable!()
    };
    let output = output.as_ref().expect("what it printed");
    assert_eq!(output.text.len(), 4 << 20, "the Thread keeps the start");
    assert!(output.cut && output.text.starts_with("     0 "));
    assert_eq!(output.exit.as_ref().and_then(|e| e.code), Some(0));
}

#[tokio::test]
async fn an_agents_plan_is_one_item_that_follows_its_steps() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "work in steps").await;
    assert_eq!(
        texts(&view)[1..],
        ["plan: 3 steps", "message: All three steps are done."]
    );
    let Body::Plan { steps } = &view.items[1].body else {
        unreachable!()
    };
    assert!(
        steps.iter().all(|s| s.state == StepState::Done),
        "{steps:?}"
    );
    let usage = view.usage.expect("what it used");
    assert_eq!((usage.used, usage.size), (52_000, 200_000));
    let cost = usage.cost.expect("what it cost");
    assert_eq!(
        (cost.amount.as_f64(), cost.currency.as_str()),
        (Some(0.25), "USD")
    );

    let (_, view) = world.finish(Some(&thread), "work in steps again").await;
    let plans = texts(&view)
        .iter()
        .filter(|t| t.starts_with("plan"))
        .count();
    assert_eq!(plans, 2, "each turn's plan is its own");
}

#[tokio::test]
async fn a_cleared_plan_shows_no_steps_and_none_is_made_for_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "work in steps, then clear").await;
    assert_eq!(texts(&view)[1], "plan: 0 steps");
    let (_, view) = world.finish(Some(&thread), "clear the plan").await;
    assert_eq!(texts(&view)[4..], ["message: Nothing to plan."]);
}

#[tokio::test]
async fn a_new_message_id_starts_a_new_message() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "say it twice").await;
    assert_eq!(
        texts(&view)[1..],
        ["message: First. Still first.", "message: Second."]
    );
}

#[tokio::test]
async fn what_the_agent_used_between_turns_reaches_the_thread_at_once() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "stop for later").await;
    let view = world
        .until(&thread, |v| {
            v.usage.as_ref().map(|u| u.used) == Some(150_000)
        })
        .await;
    assert_eq!(view.turns.len(), 1, "what it used opens no turn");
}

fn slash_commands(view: &ThreadView) -> Vec<&str> {
    view.offer
        .slash_commands
        .iter()
        .map(|c| c.name.as_str())
        .collect()
}

#[tokio::test]
async fn the_slash_commands_and_skills_a_harness_says_on_opening_reach_its_thread() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "hello").await;
    assert_eq!(slash_commands(&view), ["review", "compact"]);
    let review = &view.offer.slash_commands[0];
    assert_eq!(review.description, "Review the changes so far");
    assert_eq!(review.hint.as_deref(), Some("what to look at"));
    assert_eq!(view.offer.slash_commands[1].hint, None);
    let [explain] = &view.offer.skills[..] else {
        panic!("one skill: {:?}", view.offer.skills)
    };
    assert_eq!(explain.name, "explain", "its skill, named without the `$`");
    assert_eq!(explain.description, "Explain the code it is pointed at");
}

/// Claude Code says its skills as slash commands: one is a skill where
/// its `SKILL.md` is, and named with `$` it runs as Claude Code runs one,
/// `/name` starting the last text block (issue #149).
#[tokio::test]
async fn a_slash_command_with_a_skill_file_is_a_skill_that_runs_named_anywhere() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let project = world.kernel.project(world.project).await.unwrap();
    let skill = project.folder().join(".claude/skills/review");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "---\nname: review\n---\n").unwrap();
    let (thread, view) = world.finish(None, "please $review the blocks").await;
    assert_eq!(
        slash_commands(&view),
        ["review", "compact"],
        "still under `/`"
    );
    let skills: Vec<&str> = view.offer.skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(skills, ["review", "explain"], "in the order it says them");
    assert_eq!(
        texts(&view)[1..],
        ["message: Blocks: [please /review the blocks] [/review the blocks]"]
    );
    // A skill of Codex's own is not a slash command: its text goes as it is.
    let (_, view) = world.finish(Some(&thread), "$explain the blocks").await;
    assert_eq!(
        texts(&view)[3..],
        ["message: Blocks: [$explain the blocks]"]
    );
}

#[tokio::test]
async fn a_slash_command_learned_mid_reply_leaves_the_reply_whole() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "learn a new command").await;
    assert_eq!(texts(&view)[1..], ["message: Before and after."]);
    assert_eq!(slash_commands(&view), ["review", "compact", "init"]);
}

/// The start of a PNG file, as `agents.attach` checks it.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n a picture";

/// Where the Project keeps an image's bytes.
fn image_file(root: &Path, image: &Value) -> PathBuf {
    let id = image["id"].as_str().unwrap();
    project_data(root).join("images").join(id)
}

/// The data of the one Project under `root`, which the tests keep in
/// `root/.data` (ADR 0026).
fn project_data(root: &Path) -> PathBuf {
    let mut projects = std::fs::read_dir(root.join(".data/projects")).unwrap();
    let project = projects.next().unwrap().unwrap().path();
    assert!(projects.next().is_none(), "one Project");
    project
}

impl World {
    /// Adds an image of `who`'s for a message; the image as the engine
    /// keeps it, or why it would not.
    async fn attach(
        &self,
        who: Participant,
        mime: &str,
        bytes: &[u8],
        name: Option<&str>,
    ) -> Result<Value, banda_kernel::Refusal> {
        let data = BASE64.encode(bytes);
        let params = json!({ "mime": mime, "data": data, "name": name });
        self.call(who, "agents.attach", params).await
    }

    async fn send_images(&self, text: &str, images: &[&Value]) -> Value {
        let ids: Vec<&Value> = images.iter().map(|image| &image["id"]).collect();
        let params = json!({ "harness": self.harness, "text": text, "images": ids });
        self.call(self.person(), "agents.send", params)
            .await
            .unwrap()
    }

    async fn ended(&self, sent: &Value) -> ThreadView {
        self.until(&sent["thread"], |v| {
            state(v, &sent["turn"])
                .is_some_and(|s| s != TurnState::Queued && s != TurnState::Running)
        })
        .await
    }
}

#[tokio::test]
async fn a_message_carries_its_images_to_the_harness() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let shot = world
        .attach(world.person(), "image/png", PNG, Some("shot.png"))
        .await
        .unwrap();
    assert_eq!(shot["size"], PNG.len());
    // Its bytes are a file in the Project, not a row in its database.
    assert_eq!(std::fs::read(image_file(root.path(), &shot)).unwrap(), PNG);
    let sent = world.send_images("what is this", &[&shot]).await;
    let view = world.ended(&sent).await;
    assert_eq!(
        texts(&view)[..2],
        [
            "message: what is this + 1 image(s)",
            "message: I see 1 image: image/png. "
        ]
    );
    let Body::Message { images, .. } = &view.items[0].body else {
        panic!("a message first");
    };
    assert_eq!(images[0].name.as_deref(), Some("shot.png"));

    // The window reads it back to show it.
    let read = world
        .call(
            world.person(),
            "agents.image",
            json!({ "image": shot["id"] }),
        )
        .await
        .unwrap();
    let bytes = BASE64.decode(read["data"].as_str().unwrap()).unwrap();
    assert_eq!(
        (read["mime"].as_str(), bytes.as_slice()),
        (Some("image/png"), PNG)
    );
}

#[tokio::test]
async fn a_file_is_kept_in_the_project_for_a_message_to_point_at() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let data = BASE64.encode("a long text");
    let params = json!({ "name": "pasted text.txt", "data": data });
    let kept = world
        .call(world.person(), "agents.keep", params)
        .await
        .unwrap();
    let path = kept["path"].as_str().unwrap();
    assert!(Path::new(path).starts_with(project_data(root.path()).join("files")));
    assert!(Path::new(path).ends_with("pasted-text.txt"));
    let file = PathBuf::from(path);
    assert_eq!(std::fs::read_to_string(file).unwrap(), "a long text");
    // A file with no name is refused.
    let params = json!({ "name": "", "data": data });
    let refused = world.call(world.person(), "agents.keep", params).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
}

#[tokio::test]
async fn a_message_of_an_image_alone_is_named_after_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let shot = world
        .attach(world.person(), "image/png", PNG, Some("shot.png"))
        .await
        .unwrap();
    let sent = world.send_images("", &[&shot]).await;
    let view = world.ended(&sent).await;
    assert_eq!(view.thread.title, "shot.png");
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Done));
}

#[tokio::test]
async fn an_image_goes_only_as_what_it_is_and_with_one_message() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let refused = world
        .attach(world.person(), "image/jpeg", PNG, None)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
    assert!(
        world
            .attach(world.person(), "image/svg+xml", b"<svg/>", None)
            .await
            .is_err()
    );

    let shot = world
        .attach(world.person(), "image/png", PNG, None)
        .await
        .unwrap();
    let twice =
        json!({ "harness": world.harness, "text": "one", "images": [shot["id"], shot["id"]] });
    let refused = world
        .call(world.person(), "agents.send", twice)
        .await
        .unwrap_err();
    assert_eq!(refused.message, "A message carries each image once.");
    world.send_images("one", &[&shot]).await;
    let again = json!({ "harness": world.harness, "text": "two", "images": [shot["id"]] });
    let refused = world
        .call(world.person(), "agents.send", again)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid, "{refused:?}");

    // An image someone else added is not this Person's to send.
    let theirs = world
        .attach(world.agent(), "image/png", PNG, None)
        .await
        .unwrap();
    let send = json!({ "harness": world.harness, "text": "three", "images": [theirs["id"]] });
    assert!(
        world
            .call(world.person(), "agents.send", send)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn a_harness_without_images_gets_the_text_alone_and_says_so() {
    let root = tempfile::tempdir().unwrap();
    let agents = Agents::new(harnesses_with(&[("FAKE_AGENT_NO_IMAGES", "1")]));
    let world = World::new_with(root.path(), agents).await;
    let shot = world
        .attach(world.person(), "image/png", PNG, None)
        .await
        .unwrap();
    let sent = world.send_images("look", &[&shot]).await;
    let view = world.ended(&sent).await;
    assert!(
        texts(&view)
            .contains(&"notice: Fake does not take images, so it got the text alone.".to_owned()),
        "{:?}",
        texts(&view)
    );
    assert_eq!(last_reply(&view), "message: You said: look");
    assert!(view.offer.no_images, "the window offers it no images");

    let alone = world
        .attach(world.person(), "image/png", PNG, None)
        .await
        .unwrap();
    let sent = world.send_images("", &[&alone]).await;
    let view = world.ended(&sent).await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Failed));
}

#[tokio::test]
async fn an_image_whose_file_is_gone_is_left_out_and_said() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let shot = world
        .attach(world.person(), "image/png", PNG, Some("shot.png"))
        .await
        .unwrap();
    std::fs::remove_file(image_file(root.path(), &shot)).unwrap();
    let sent = world.send_images("look", &[&shot]).await;
    let view = world.ended(&sent).await;
    assert!(
        texts(&view)
            .contains(&"notice: shot.png is gone, so Fake got the message without it.".to_owned()),
        "{:?}",
        texts(&view)
    );
    assert_eq!(last_reply(&view), "message: You said: look");
}

impl World {
    /// Sends `text` into the Thread's running turn, if one runs.
    async fn steer(&self, thread: &Value, text: &str) -> Value {
        let params = json!({ "thread": thread, "text": text, "steer": true });
        self.call(self.person(), "agents.send", params)
            .await
            .unwrap()
    }

    /// Starts a turn that waits for a message sent into it.
    async fn waiting(&self, thread: Option<&Value>) -> Value {
        let sent = self.send(thread, "wait here").await;
        self.until(&sent["thread"], |v| {
            texts(v).contains(&"message: Waiting.".to_owned())
        })
        .await;
        sent
    }

    async fn on_turn(&self, method: &str, turn: &Value) -> Result<Value, banda_kernel::Refusal> {
        self.call(self.person(), method, json!({ "turn": turn }))
            .await
    }
}

fn position(view: &ThreadView, text: &str) -> usize {
    texts(view)
        .iter()
        .position(|t| t == text)
        .unwrap_or_else(|| panic!("no {text:?} in {:?}", texts(view)))
}

#[tokio::test]
async fn a_message_sent_into_a_running_turn_joins_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let steered = world.steer(&wait["thread"], "also this").await;
    assert_eq!(steered["turn"], wait["turn"], "no turn of its own");
    let view = world.ended(&wait).await;
    assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Done));
    assert_eq!(view.turns.len(), 1);
    assert_eq!(
        texts(&view),
        [
            "message: wait here",
            "message: Waiting.",
            "message: also this",
            "message: Steered: also this.",
        ],
        "what the Agent says of it reads after it"
    );
    let item = view
        .items
        .iter()
        .find(|i| serde_json::to_value(i.id).unwrap() == steered["item"])
        .unwrap();
    assert_eq!(serde_json::to_value(item.turn).unwrap(), wait["turn"]);

    let alone = world.steer(&wait["thread"], "and now").await;
    assert_ne!(
        alone["turn"], wait["turn"],
        "nothing runs: a turn of its own"
    );
    let view = world.ended(&alone).await;
    assert_eq!(last_reply(&view), "message: You said: and now");
}

#[tokio::test]
async fn a_harness_that_cannot_steer_stops_for_the_message() {
    let root = tempfile::tempdir().unwrap();
    let harnesses = harnesses_with(&[("FAKE_AGENT_NO_STEERING", "1")]);
    let world = World::new_with(root.path(), Agents::new(harnesses)).await;
    let wait = world.waiting(None).await;
    world.steer(&wait["thread"], "instead this").await;
    let view = world
        .until(&wait["thread"], |v| {
            v.turns.len() == 2 && v.turns[1].state == TurnState::Done
        })
        .await;
    assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Stopped));
    let requeued = json!(view.turns[1].id);
    assert_eq!(opened(root.path(), &requeued).0, "requeue");
    let said = "notice: Fake cannot take a message while it works, \
                so Banda stopped it to send yours.";
    assert!(position(&view, said) < position(&view, "message: instead this"));
    assert_eq!(last_reply(&view), "message: You said: instead this");
    assert!(!view.held, "a stop Banda made holds nothing");
}

#[tokio::test]
async fn a_waiting_message_changes_goes_and_waits_after_a_stop() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let thread = wait["thread"].clone();
    let second = world.send(Some(&thread), "second").await;
    let third = world.send(Some(&thread), "third").await;

    let edit = |turn: &Value, text: &str| {
        world.call(
            world.person(),
            "agents.edit",
            json!({ "turn": turn.clone(), "text": text }),
        )
    };
    edit(&second["turn"], "second, changed").await.unwrap();
    world
        .on_turn("agents.withdraw", &third["turn"])
        .await
        .unwrap();
    let refused = edit(&wait["turn"], "no").await.unwrap_err();
    assert!(refused.message.contains("taken"), "{}", refused.message);
    let refused = edit(&second["turn"], "").await.unwrap_err();
    assert_eq!(
        refused.code,
        Code::Invalid,
        "a message needs text or an image"
    );
    let view = world.thread(&thread).await;
    assert_eq!(state(&view, &second["turn"]), Some(TurnState::Queued));
    assert_eq!(state(&view, &third["turn"]), Some(TurnState::Withdrawn));

    world.on_turn("agents.stop", &wait["turn"]).await.unwrap();
    world
        .until(&thread, |v| {
            state(v, &wait["turn"]) == Some(TurnState::Stopped)
        })
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let view = world.thread(&thread).await;
    assert!(view.held, "a stop holds the queue");
    assert_eq!(state(&view, &second["turn"]), Some(TurnState::Queued));

    world
        .call(world.person(), "agents.resume", json!({ "thread": thread }))
        .await
        .unwrap();
    let view = world.ended(&second).await;
    assert!(!view.held);
    assert_eq!(last_reply(&view), "message: You said: second, changed");
    assert!(
        position(&view, "message: Waiting.") < position(&view, "message: second, changed"),
        "a message reads where its turn started: {:?}",
        texts(&view)
    );
}

#[tokio::test]
async fn a_waiting_message_sent_now_joins_the_running_turn() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let later = world.send(Some(&wait["thread"]), "now this").await;
    world.on_turn("agents.steer", &later["turn"]).await.unwrap();
    let view = world.ended(&wait).await;
    assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Done));
    assert_eq!(state(&view, &later["turn"]), Some(TurnState::Withdrawn));
    assert_eq!(last_reply(&view), "message: Steered: now this.");
    assert_eq!(
        position(&view, "message: now this") + 1,
        position(&view, "message: Steered: now this.")
    );
    let refused = world
        .on_turn("agents.steer", &later["turn"])
        .await
        .unwrap_err();
    assert!(refused.message.contains("taken"), "{}", refused.message);
}

#[tokio::test]
async fn a_waiting_message_sent_now_without_steering_gets_a_turn_of_its_own() {
    let root = tempfile::tempdir().unwrap();
    let harnesses = harnesses_with(&[("FAKE_AGENT_NO_STEERING", "1")]);
    let world = World::new_with(root.path(), Agents::new(harnesses)).await;
    let wait = world.waiting(None).await;
    let later = world.send(Some(&wait["thread"]), "now this").await;
    world.on_turn("agents.steer", &later["turn"]).await.unwrap();
    let view = world
        .until(&wait["thread"], |v| {
            v.turns.len() == 3 && v.turns[2].state == TurnState::Done
        })
        .await;
    assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Stopped));
    assert_eq!(state(&view, &later["turn"]), Some(TurnState::Withdrawn));
    assert_eq!(last_reply(&view), "message: You said: now this");
}

#[tokio::test]
async fn a_message_sent_after_a_stop_waits_and_lets_the_queue_go_on() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let thread = wait["thread"].clone();
    let second = world.send(Some(&thread), "second").await;
    world.on_turn("agents.stop", &wait["turn"]).await.unwrap();
    let third = world.steer(&thread, "third").await;
    assert_ne!(
        third["turn"], wait["turn"],
        "a stopped turn takes no message"
    );
    let view = world.ended(&third).await;
    assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Stopped));
    assert_eq!(state(&view, &second["turn"]), Some(TurnState::Done));
    assert_eq!(last_reply(&view), "message: You said: third");
    assert!(!view.held);
}

#[tokio::test]
async fn a_waiting_message_sent_now_after_a_stop_lets_the_queue_go_on() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let thread = wait["thread"].clone();
    let second = world.send(Some(&thread), "second").await;
    let third = world.send(Some(&thread), "third").await;
    world.on_turn("agents.stop", &wait["turn"]).await.unwrap();
    world.on_turn("agents.steer", &third["turn"]).await.unwrap();
    let view = world.ended(&third).await;
    assert_eq!(state(&view, &second["turn"]), Some(TurnState::Done));
    assert_eq!(state(&view, &third["turn"]), Some(TurnState::Done));
    assert!(!view.held);
}

#[tokio::test]
async fn a_harness_that_stops_holds_the_queue_and_its_turn_goes_again_first() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let wait = world.waiting(None).await;
    let thread = wait["thread"].clone();
    let crash = world.send(Some(&thread), "crash").await;
    let after = world.send(Some(&thread), "after").await;
    let taken = world.send(Some(&thread), "taken back").await;
    world.steer(&thread, "go on").await;
    world.ended(&crash).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let view = world.thread(&thread).await;
    assert_eq!(state(&view, &crash["turn"]), Some(TurnState::Failed));
    assert_eq!(state(&view, &after["turn"]), Some(TurnState::Queued));
    assert!(view.held, "a Harness that stops holds the queue");

    // A message taken back is no turn of the Thread's: the failed one is
    // still its latest, and goes again before the queue.
    world
        .on_turn("agents.withdraw", &taken["turn"])
        .await
        .unwrap();
    let again = world.on_turn("agents.retry", &crash["turn"]).await.unwrap();
    let twice = world.on_turn("agents.retry", &crash["turn"]).await;
    assert_eq!(
        twice.unwrap(),
        Value::Null,
        "a message goes again once at a time"
    );
    let view = world.ended(&again).await;
    assert_eq!(state(&view, &again["turn"]), Some(TurnState::Failed));
    assert_eq!(state(&view, &after["turn"]), Some(TurnState::Queued));

    world
        .call(world.person(), "agents.resume", json!({ "thread": thread }))
        .await
        .unwrap();
    let view = world.ended(&after).await;
    assert_eq!(last_reply(&view), "message: You said: after");
}

#[test]
fn a_restart_holds_the_queue_until_a_person_sends_again() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart(
        root.path(),
        || Agents::new(harnesses()),
        async |world| {
            let wait = world.waiting(None).await;
            let second = world.send(Some(&wait["thread"]), "second").await;
            (wait, second)
        },
        async |world, (wait, second)| {
            let thread = &wait["thread"];
            tokio::time::sleep(Duration::from_millis(300)).await;
            let view = world.thread(thread).await;
            assert_eq!(state(&view, &wait["turn"]), Some(TurnState::Interrupted));
            assert_eq!(state(&view, &second["turn"]), Some(TurnState::Queued));
            assert!(view.held, "a restart holds the queue");

            let third = world.send(Some(thread), "third").await;
            let view = world.ended(&third).await;
            assert_eq!(state(&view, &second["turn"]), Some(TurnState::Done));
            assert_eq!(last_reply(&view), "message: You said: third");
            assert!(!view.held);
        },
    );
}

/// The Agent's own turn after `sent`'s, once it shows `what`.
async fn went_on(world: &World, sent: &Value, what: &str) -> ThreadView {
    world
        .until(&sent["thread"], |v| {
            v.turns.len() == 2 && texts(v).contains(&format!("message: {what}"))
        })
        .await
}

#[tokio::test]
async fn what_a_harness_does_by_itself_shows_in_a_turn_of_the_agents_own() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background").await;
    went_on(&world, &sent, "The task finished.").await;
    let view = world
        .until(&sent["thread"], |v| v.turns[1].state == TurnState::Done)
        .await;
    assert_eq!(
        texts(&view),
        [
            "message: background",
            "message: Started a task.",
            "notice: Fake went on by itself.",
            "message: The task finished.",
        ]
    );
    let own = view.turns[1].id.to_string();
    assert_eq!(opened(root.path(), &json!(own)).0, "by_itself");
    assert_eq!(view.usage.map(|u| u.used), Some(60_000));
    let refused = world
        .on_turn("agents.retry", &json!(own))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn what_the_agent_does_at_once_after_a_turn_waits_for_that_turn_to_end() {
    for _ in 0..5 {
        let root = tempfile::tempdir().unwrap();
        let world = World::new(root.path()).await;
        let sent = world.send(None, "background soon").await;
        let view = world
            .until(&sent["thread"], |v| {
                texts(v).iter().any(|t| t.contains("The task finished."))
                    && v.turns.iter().all(|t| t.state == TurnState::Done)
            })
            .await;
        // The Harness's words reach the Thread, in whichever turn they
        // came: they may come before its turn ended, and join its reply.
        // Never with two turns running.
        assert!(view.turns.len() <= 2, "{:?}", view.turns);
    }
}

#[tokio::test]
async fn a_message_sent_while_the_agent_goes_on_by_itself_goes_at_once() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background long").await;
    let view = went_on(&world, &sent, "The task finished.").await;
    let own = json!(view.turns[1].id);
    assert_eq!(state(&view, &own), Some(TurnState::Running));
    let next = world.steer(&sent["thread"], "and this").await;
    assert_ne!(next["turn"], own, "it gets a turn of its own");
    let view = world.ended(&next).await;
    assert_eq!(state(&view, &own), Some(TurnState::Done));
    assert_eq!(last_reply(&view), "message: You said: and this");
}

#[tokio::test]
async fn a_person_stops_what_the_agent_does_by_itself() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background long").await;
    let view = went_on(&world, &sent, "The task finished.").await;
    let own = json!(view.turns[1].id);
    world.on_turn("agents.stop", &own).await.unwrap();
    world
        .until(&sent["thread"], |v| {
            state(v, &own) == Some(TurnState::Stopped)
        })
        .await;
}

#[tokio::test]
async fn what_the_agent_does_by_itself_stays_stopped_when_a_message_follows_the_stop() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background long").await;
    let view = went_on(&world, &sent, "The task finished.").await;
    let own = json!(view.turns[1].id);
    world.on_turn("agents.stop", &own).await.unwrap();
    let next = world.send(Some(&sent["thread"]), "and this").await;
    let view = world.ended(&next).await;
    assert_eq!(state(&view, &own), Some(TurnState::Stopped));
    assert_eq!(last_reply(&view), "message: You said: and this");
}

#[test]
fn a_restart_ends_what_the_agent_did_by_itself() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart(
        root.path(),
        || Agents::new(harnesses()),
        async |world| {
            let sent = world.send(None, "background long").await;
            let view = went_on(world, &sent, "The task finished.").await;
            (sent, json!(view.turns[1].id))
        },
        async |world, (sent, own)| {
            let view = world
                .until(&sent["thread"], |v| {
                    state(v, &own) == Some(TurnState::Interrupted)
                })
                .await;
            assert!(!view.held, "nothing a Person sent waits");
        },
    );
}

#[tokio::test]
async fn a_message_waits_while_the_agent_asks_in_a_turn_of_its_own() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background asks").await;
    let asking = "question: Run a check (Open)".to_owned();
    let view = world
        .until(&sent["thread"], |v| texts(v).contains(&asking))
        .await;
    let own = json!(view.turns[1].id);
    let question = view.items.last().unwrap().id;
    let next = world.steer(&sent["thread"], "and this").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let view = world.thread(&sent["thread"]).await;
    assert_eq!(
        state(&view, &next["turn"]),
        Some(TurnState::Queued),
        "it waits for the answer"
    );
    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question, "choice": "allow" }),
        )
        .await
        .unwrap();
    let view = world.ended(&next).await;
    assert_eq!(state(&view, &own), Some(TurnState::Done));
    let said = texts(&view);
    assert!(
        said.contains(&"message: The check passed.".to_owned()),
        "{said:?}"
    );
    assert_eq!(last_reply(&view), "message: You said: and this");
}

#[tokio::test]
async fn what_the_agent_does_by_itself_ends_when_it_goes_quiet_and_asks_nothing() {
    let root = tempfile::tempdir().unwrap();
    let agents = Agents::new(harnesses()).quiet_after(Duration::from_millis(300));
    let world = World::new_with(root.path(), agents).await;
    let sent = world.send(None, "background asks quiet").await;
    let asking = "question: Run a check (Open)".to_owned();
    let view = world
        .until(&sent["thread"], |v| texts(v).contains(&asking))
        .await;
    let own = json!(view.turns[1].id);
    let question = view.items.last().unwrap().id;
    tokio::time::sleep(Duration::from_millis(900)).await;
    let view = world.thread(&sent["thread"]).await;
    assert_eq!(
        state(&view, &own),
        Some(TurnState::Running),
        "a Question keeps it"
    );
    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question, "choice": "allow" }),
        )
        .await
        .unwrap();
    let view = world
        .until(&sent["thread"], |v| state(v, &own) == Some(TurnState::Done))
        .await;
    assert_eq!(last_reply(&view), "message: The check passed.");
}

#[tokio::test]
async fn a_harness_that_stops_while_the_agent_goes_on_by_itself_fails_that_turn_and_holds_the_queue()
 {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background dies").await;
    let view = world
        .until(&sent["thread"], |v| {
            v.turns.len() == 2 && v.turns[1].state == TurnState::Failed
        })
        .await;
    assert_eq!(view.turns[1].failure, Some(Failure::HarnessStopped));
    // A message that waits does not start on a Harness that just died
    // without the Person seeing it (ADR 0018, decision 4).
    assert!(view.held);
}

#[tokio::test]
async fn a_command_that_ends_after_its_turn_opens_no_turn() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "background detached").await;
    let view = world
        .until(&sent["thread"], |v| {
            v.usage.as_ref().map(|u| u.used) == Some(70_000)
        })
        .await;
    assert_eq!(view.turns.len(), 1);
    assert_eq!(
        texts(&view),
        [
            "message: background detached",
            "tool: Run the server (Done)"
        ]
    );
}

/// Starts the real Claude Code and Codex adapters on the Person's own CLIs
/// and asks what they run and who is signed in; no model is called. Run it
/// by hand: `cargo test -p banda-agents --test agents real -- --ignored
/// --nocapture`. Once `pnpm --filter @banda/harnesses-adapters build` has
/// built them, these real runs go through the adapters Banda carries, on
/// the `node` on PATH or `BANDA_NODE`, as `banda serve` finds them in a
/// checkout; without, `npx` fetches them.
#[tokio::test]
#[ignore = "starts the real adapters"]
async fn the_real_harnesses_say_what_they_run_and_who_is_signed_in() {
    let program = std::env::current_exe().unwrap();
    let here = banda_harnesses::carried::Here {
        program: &program,
        app: "banda-local",
        checkout: true,
    };
    let carried = banda_harnesses::carried::Carried::find(&here);
    println!("carried: {carried:?}");
    let known = Harnesses::known();
    known.carry(carried);
    let real = ["claude", "codex"].map(|id| known.find(id).unwrap().clone());
    let fake = Harness {
        id: "fake".into(),
        name: "Fake".into(),
        short: None,
        command: fake_agent().display().to_string(),
        enabled: true,
        retired: None,
        args: Vec::new(),
        env: Default::default(),
        cli: None,
        of: None,
        kind: Default::default(),
        mark: None,
        icon: None,
        colour: None,
        shadows: None,
        carried: None,
        record: None,
        cwd: None,
        holes: Holes::default(),
        credentials: Default::default(),
    };
    let harnesses = Harnesses::new([vec![fake], real.to_vec()].concat());
    let root = tempfile::tempdir().unwrap();
    let world = World::new_with(root.path(), Agents::new(harnesses)).await;
    for harness in ["claude", "codex"] {
        let account = world.account_of(harness).await;
        println!("{harness}: {account:#?}");
        let account = account.unwrap();
        assert!(account["cli"]["version"].is_string(), "{account}");
        assert!(account["adapter"]["version"].is_string(), "{account}");
    }
}

/// What a Person asks a real Harness in the recordings: an edit that a
/// supervised Thread asks about first, and a reply.
const EDIT: &str =
    "Add the line `pears` to the end of notes.txt, then say in one sentence what the file holds.";

/// Records the real Claude Code and Codex doing [`EDIT`] in a supervised
/// Thread, allowed once, into `tests/recordings/<harness>-edit.jsonl`,
/// with who is signed in and the Person's home folder written out. It
/// calls the models, which costs money: run it by hand when an adapter
/// changes, `cargo test -p banda-agents --test agents record --
/// --ignored --nocapture`, and read the files before committing them.
#[tokio::test]
#[ignore = "calls the real models, which costs money"]
async fn record_the_real_harnesses_editing_a_file() {
    for harness in ["claude", "codex"] {
        let (raw, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let world = World::recording(root.path(), harness, raw.path()).await;
        let view = world.edit(Duration::from_secs(300)).await;
        println!("{harness}: {:#?}", texts(&view));
        std::fs::write(recording(harness), world.scrubbed(raw.path()).await).unwrap();
    }
}

/// The files the sub-agents read in the recordings, and the line each
/// holds.
const FILES: [(&str, &str); 3] = [("a.txt", "alpha"), ("b.txt", "bravo"), ("c.txt", "charlie")];

/// A Thread of a recording: its mode, what a Person sends in it, a turn
/// each, and whether the Agent goes on by itself after the last.
struct Asked {
    mode: &'static str,
    sends: &'static [&'static str],
    goes_on: bool,
}

/// A recording of sub-agents: its file in `tests/recordings`, its
/// Harness, and its Threads, one after the other. Each Thread runs on the
/// Harness's least model and effort ([`least`]).
struct SubAgents {
    file: &'static str,
    harness: &'static str,
    threads: &'static [Asked],
}

/// What a Person asks the real Harnesses to do with sub-agents (ADR 0103,
/// step 0), as Banda runs them before it declares them.
const SUB_AGENTS: [&SubAgents; 3] = [&CLAUDE_SUB_AGENTS, &CLAUDE_WORKFLOW, &CODEX_SUB_AGENTS];

/// Claude Code's Agent tool three at once in the foreground, one in the
/// background and one that starts its own, with Full access; then one
/// whose command asks first, supervised.
const CLAUDE_SUB_AGENTS: SubAgents = SubAgents {
    file: "claude-subagents",
    harness: "claude",
    threads: &[
        Asked {
            mode: "full_access",
            sends: &[
                "Call the Agent tool three times in one message, each with \
                     run_in_background false and model haiku: one reads a.txt, one b.txt, one \
                     c.txt, and each answers with that file's first line only. Then answer \
                     with the three lines, comma-separated, and nothing else.",
                "Call the Agent tool once with run_in_background true and model haiku: it \
                     reads a.txt and answers with its first line only. Answer `started` at \
                     once; when it is done, answer with what it said, and nothing else.",
                "Call the Agent tool once with run_in_background false and model haiku, \
                     and have that sub-agent call the Agent tool itself, once, with \
                     run_in_background false and model haiku, for a sub-agent that reads \
                     b.txt and answers with its first line only. Then answer with what came \
                     back, and nothing else.",
            ],
            goes_on: false,
        },
        Asked {
            mode: "supervised",
            sends: &[
                "Call the Agent tool once with run_in_background false and model \
                          haiku: it runs `echo delta > d.txt` with Bash and answers `done`. \
                          Then answer with what it said, and nothing else.",
            ],
            goes_on: false,
        },
    ],
};

/// A small Workflow, supervised: it asks before it starts, and its second
/// agent's command asks too.
const CLAUDE_WORKFLOW: SubAgents = SubAgents {
    file: "claude-workflow",
    harness: "claude",
    threads: &[Asked {
        mode: "supervised",
        sends: &[
            "Call the Workflow tool with this script, then answer `launched` and \
                      nothing else:\n\n```js\nexport const meta = { name: 'two-agents', \
                      description: 'Read a file, write a file', phases: [{ title: 'Work' }] }\n\
                      phase('Work')\nconst lines = await parallel([\n  () => agent('Read \
                      a.txt and answer with its first line only.', { label: 'a', model: \
                      'haiku' }),\n  () => agent('Run `echo delta > d.txt` with Bash, then \
                      answer `done` only.', { label: 'd', model: 'haiku' }),\n])\nreturn \
                      lines.join(', ')\n```",
        ],
        goes_on: true,
    }],
};

/// Codex spawns two and waits for both, with Full access.
const CODEX_SUB_AGENTS: SubAgents = SubAgents {
    file: "codex-subagents",
    harness: "codex",
    threads: &[Asked {
        mode: "full_access",
        sends: &[
            "Spawn two sub-agents: one reads a.txt, one reads b.txt, and each \
                      answers with that file's first line only. Wait for both, then answer \
                      with the two lines, comma-separated, and nothing else.",
        ],
        goes_on: false,
    }],
};

/// The least model and effort `harness` offers, so a recording costs
/// little.
fn least(harness: &str) -> Value {
    match harness {
        "claude" => json!({ "model": "haiku", "effort": "low" }),
        _ => json!({ "model": "gpt-6-luna", "reasoning_effort": "low" }),
    }
}

/// Records the real Claude Code and Codex at work with sub-agents, as
/// [`SUB_AGENTS`] asks, each into its `tests/recordings/<file>.jsonl`,
/// with who is signed in and the Person's home folder written out;
/// `BANDA_RECORD=<file>` records only that one. It calls the models,
/// which costs money: run it by hand when an adapter changes,
/// `cargo test -p banda-agents --test agents
/// record_the_real_harnesses_with_sub_agents -- --ignored --nocapture`,
/// and read the files before committing them.
#[tokio::test]
#[ignore = "calls the real models, which costs money"]
async fn record_the_real_harnesses_with_sub_agents() {
    let only = std::env::var("BANDA_RECORD").ok();
    for recorded in SUB_AGENTS
        .iter()
        .filter(|r| only.as_deref().is_none_or(|o| o == r.file))
    {
        let (raw, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let world = World::recording(root.path(), recorded.harness, raw.path()).await;
        for view in world.sub_agents(recorded, Duration::from_secs(600)).await {
            println!("{}: {:#?}", recorded.file, texts(&view));
        }
        std::fs::write(
            recorded_file(recorded.file),
            world.scrubbed(raw.path()).await,
        )
        .unwrap();
    }
}

impl World {
    /// A Project whose new Threads start on the real `harness`, which
    /// writes down what it says in `raw`.
    async fn recording(root: &Path, harness: &str, raw: &Path) -> World {
        let mut entry = Harnesses::known().find(harness).unwrap().clone();
        entry.record = Some(raw.to_owned());
        let agents = Agents::new(Harnesses::new(vec![entry]));
        World::new_on(root, agents, harness).await
    }

    /// What the Harness said in `raw` while it worked, with who is signed
    /// in and the Person's home folder written out.
    async fn scrubbed(&self, raw: &Path) -> String {
        let account = self.account_of(&self.harness).await.unwrap();
        let who = &account["signed_in_as"];
        let email = who["email"]
            .as_str()
            .expect("the Harness says who is signed in");
        let home = std::env::var("HOME").unwrap();
        // Where the Person keeps a Harness's own state, when it is not
        // that Harness's default, before the home folder it may be in.
        let claude = std::env::var("CLAUDE_CONFIG_DIR").ok();
        let codex = std::env::var("CODEX_HOME").ok();
        let private = [
            (who["organization"].as_str(), "Example Org"),
            (Some(email), "person@example.invalid"),
            (claude.as_deref(), "/home/person/.claude"),
            (codex.as_deref(), "/home/person/.codex"),
            (Some(home.as_str()), "/home/person"),
        ];
        let recorded = std::fs::read_dir(raw)
            .unwrap()
            .map(|file| std::fs::read_to_string(file.unwrap().path()).unwrap())
            .find(|text| text.contains("\"session/prompt\""))
            .expect("a recording of the turn");
        let scrubbed = private
            .iter()
            .filter_map(|(was, is)| Some((was.filter(|w| !w.is_empty())?, is)))
            .fold(without_personal_setup(&recorded), |text, (was, is)| {
                text.replace(was, is)
            });
        let left = private.iter().filter_map(|(was, _)| *was);
        for was in left.filter(|was| !was.is_empty()) {
            assert!(!scrubbed.contains(was), "the recording still names it");
        }
        scrubbed
    }

    /// Has the Agent do what `recorded` asks, in [`FILES`], allowing each
    /// Question once, and waits up to `limit` for each step: each Thread
    /// as it is once it is done.
    async fn sub_agents(&self, recorded: &SubAgents, limit: Duration) -> Vec<ThreadView> {
        let project = self.kernel.project(self.project).await.unwrap();
        for (name, line) in FILES {
            std::fs::write(project.folder().join(name), format!("{line}\n")).unwrap();
        }
        let mut views = Vec::new();
        for asked in recorded.threads {
            let (first, rest) = asked.sends.split_first().unwrap();
            let params = json!({
                "text": first,
                "harness": self.harness,
                "settings": { "mode": asked.mode, "options": least(recorded.harness) },
            });
            let sent = self
                .call(self.person(), "agents.send", params)
                .await
                .unwrap();
            let thread = &sent["thread"];
            let mut view = self.allowing(thread, limit, 1).await;
            for (n, text) in rest.iter().enumerate() {
                self.send(Some(thread), text).await;
                view = self.allowing(thread, limit, n + 2).await;
            }
            if asked.goes_on {
                // The turn the Agent opens by itself.
                view = self.allowing(thread, limit, asked.sends.len() + 1).await;
            }
            views.push(view);
        }
        views
    }

    /// Allows each Question in `thread` once, until it has `turns` turns,
    /// or more if a real Harness goes on by itself, and none of them runs;
    /// waits up to `limit` for each step.
    async fn allowing(&self, thread: &Value, limit: Duration, turns: usize) -> ThreadView {
        let done = |v: &ThreadView| {
            v.turns.len() >= turns
                && v.turns
                    .iter()
                    .all(|t| !matches!(t.state, TurnState::Queued | TurnState::Running))
        };
        loop {
            let view = self
                .until_within(limit, thread, |v| open(v).is_some() || done(v))
                .await;
            let Some((question, choices)) = open(&view) else {
                return view;
            };
            let once = choices.iter().find(|c| c.allows && !c.always).unwrap();
            let answer = json!({ "item": question, "choice": once.id });
            self.call(self.person(), "agents.answer", answer)
                .await
                .unwrap();
        }
    }
}

/// Claude Code leaves plan mode by asking to, with the plan: the Question
/// carries it. It calls the model, which costs money: run it by hand when
/// the adapter changes, `cargo test -p banda-agents --test agents
/// claude_asks -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "calls the real model, which costs money"]
async fn claude_asks_to_carry_out_its_plan_with_the_plan() {
    let known = Harnesses::known();
    let agents = Agents::new(Harnesses::new(vec![known.find("claude").unwrap().clone()]));
    let root = tempfile::tempdir().unwrap();
    let world = World::new_on(root.path(), agents, "claude").await;
    let project = world.kernel.project(world.project).await.unwrap();
    std::fs::write(project.folder().join("notes.txt"), "apples\n").unwrap();
    let params = json!({
        "harness": "claude",
        "text": "Plan how to add a line \"pears\" to notes.txt, in two steps at most.",
        "settings": { "mode": "supervised", "plan": true },
    });
    let sent = world
        .call(world.person(), "agents.send", params)
        .await
        .unwrap();
    let (thread, turn) = (&sent["thread"], &sent["turn"]);
    loop {
        let view = world
            .until_within(Duration::from_secs(300), thread, |v| {
                open(v).is_some() || !ongoing(v, turn)
            })
            .await;
        let Some((question, choices)) = open(&view) else {
            panic!("the turn ended without asking: {:#?}", texts(&view));
        };
        let plan = view.items.iter().find_map(|item| match &item.body {
            Body::Question { plan, .. } if item.id == question => plan.clone(),
            _ => None,
        });
        // No to the plan ends the turn, with nothing changed.
        let choice = match &plan {
            Some(_) => choices.iter().find(|c| !c.allows).unwrap(),
            None => choices.iter().find(|c| c.allows && !c.always).unwrap(),
        };
        let answer = json!({ "item": question, "choice": choice.id });
        world
            .call(world.person(), "agents.answer", answer)
            .await
            .unwrap();
        if let Some(plan) = plan {
            println!("{plan}");
            assert!(plan.contains("pears"), "the plan is the one asked for");
            return;
        }
    }
}

/// The commands Claude Code and Codex have of their own. What else they
/// list are the Person's skills and plugins.
const OWN_COMMANDS: [&str; 8] = [
    "compact", "context", "init", "mcp", "model", "plan", "review", "status",
];

/// `recorded` without the Person's skills, plugins and agents: each list
/// of commands cut to [`OWN_COMMANDS`], and Claude Code's `agent` option
/// to its default.
fn without_personal_setup(recorded: &str) -> String {
    recorded
        .lines()
        .map(|line| {
            let mut entry: Value = serde_json::from_str(line).unwrap();
            let frame = &mut entry["frame"];
            if let Some(update) = frame.pointer_mut("/params/update")
                && update["sessionUpdate"] == "available_commands_update"
                && let Some(commands) = update.get_mut("availableCommands")
                && let Some(commands) = commands.as_array_mut()
            {
                commands.retain(|c| OWN_COMMANDS.contains(&c["name"].as_str().unwrap_or("")));
            }
            for at in ["/result/configOptions", "/params/update/configOptions"] {
                let options = frame.pointer_mut(at).and_then(Value::as_array_mut);
                for option in options.into_iter().flatten() {
                    if option["id"] == "agent"
                        && let Some(choices) = option.get_mut("options")
                        && let Some(choices) = choices.as_array_mut()
                    {
                        choices.retain(|c| c["value"] == "default");
                    }
                }
            }
            entry.to_string() + "\n"
        })
        .collect()
}

#[test]
fn the_recordings_hold_no_personal_setup() {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/recordings");
    for file in std::fs::read_dir(folder).unwrap() {
        let path = file.unwrap().path();
        if path.extension().is_none_or(|e| e != "jsonl") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let frames = |text: &str| -> Vec<Value> {
            text.lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        };
        assert_eq!(frames(&without_personal_setup(&text)), frames(&text));
        let emails: Vec<_> = text
            .split(|c: char| c == '"' || c.is_whitespace())
            .filter(|word| word.contains('@') && word.contains('.') && !word.starts_with('@'))
            .collect();
        assert!(
            emails.iter().all(|e| *e == "person@example.invalid"),
            "{emails:?}"
        );
        // Every home folder is the Person's, written out.
        let named = |rest: &str| rest.split(['/', '"', '\\']).next() == Some("person");
        assert!(
            text.split("/home/").skip(1).all(named),
            "{}",
            path.display()
        );
    }
}

/// The recording of `harness` doing [`EDIT`].
fn recording(harness: &str) -> PathBuf {
    recorded_file(&format!("{harness}-edit"))
}

/// The recording `tests/recordings/<name>.jsonl`.
fn recorded_file(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/recordings/{name}.jsonl"))
}

impl World {
    /// Has an Agent do [`EDIT`] to a notes.txt that holds "apples" in a
    /// supervised Thread, allowing each Question once, and waits up to
    /// `limit` for each step.
    async fn edit(&self, limit: Duration) -> ThreadView {
        let project = self.kernel.project(self.project).await.unwrap();
        std::fs::write(project.folder().join("notes.txt"), "apples\n").unwrap();
        let params = json!({
            "harness": self.harness,
            "text": EDIT,
            "settings": { "mode": "supervised" },
        });
        let sent = self
            .call(self.person(), "agents.send", params)
            .await
            .unwrap();
        self.allowing(&sent["thread"], limit, 1).await
    }
}

/// The Thread's open Question and its choices.
fn open(view: &ThreadView) -> Option<(ItemId, &[Choice])> {
    view.items.iter().find_map(|item| match &item.body {
        Body::Question {
            state: QuestionState::Open,
            choices,
            ..
        } => Some((item.id, choices.as_slice())),
        _ => None,
    })
}

fn ongoing(view: &ThreadView, turn: &Value) -> bool {
    matches!(
        state(view, turn),
        Some(TurnState::Queued | TurnState::Running)
    )
}

/// The fake agent playing the recording `tests/recordings/<name>.jsonl`.
fn playing(name: &str) -> Agents {
    let path = recorded_file(name);
    Agents::new(harnesses_with(&[(
        "FAKE_AGENT_REPLAY",
        path.to_str().unwrap(),
    )]))
}

impl World {
    /// [`edit`](World::edit) as the recording of `harness` says it went,
    /// and the Project's folder.
    async fn replay_edit(root: &Path, harness: &str) -> (World, ThreadView, PathBuf) {
        let world = World::new_with(root, playing(&format!("{harness}-edit"))).await;
        let view = world.edit(Duration::from_secs(10)).await;
        let project = world.kernel.project(world.project).await.unwrap();
        let folder = project.folder().to_owned();
        (world, view, folder)
    }

    /// [`sub_agents`](World::sub_agents) as its recording says it went.
    async fn replay_sub_agents(root: &Path, recorded: &SubAgents) -> Vec<ThreadView> {
        let world = World::new_with(root, playing(recorded.file)).await;
        world.sub_agents(recorded, Duration::from_secs(10)).await
    }
}

/// The replies the Agent wrote in `view`.
fn replies(view: &ThreadView) -> Vec<&str> {
    view.items
        .iter()
        .filter_map(|item| match &item.body {
            Body::Message { text, .. } if item.author.agent().is_some() => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// Before Banda declares sub-agents (ADR 0103, step 0), Claude Code's
/// Agent call is a thought titled with its task, and what its sub-agent
/// does comes flat in the parent's turn: its calls as the Agent's own,
/// stamped `_meta.claudeCode.parentToolUseId`, which the engine drops;
/// none of a sub-agent's text, so no reply is written as the parent's.
/// A nested sub-agent's own work does not come at all.
#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "the recording the fake agent replays was made on Linux: it moves the recorded folder to this one, and the rest of each path keeps its /, as no Harness on Windows says it"
)]
async fn claude_code_s_sub_agents_work_as_the_agent_s_own_and_write_no_reply_of_theirs() {
    let root = tempfile::tempdir().unwrap();
    let recorded = &CLAUDE_SUB_AGENTS;
    let views = World::replay_sub_agents(root.path(), recorded).await;
    let [full, supervised] = &views[..] else {
        panic!("one view per Thread: {}", views.len())
    };
    let sent = recorded.threads[0].sends;
    assert_eq!(
        texts(full),
        [
            format!("message: {}", sent[0]),
            "tool: Read first line of a.txt (Done)".into(),
            "tool: Read first line of b.txt (Done)".into(),
            "tool: Read first line of c.txt (Done)".into(),
            "tool: Read a.txt (Done)".into(),
            "tool: Read b.txt (1 - 1) (Done)".into(),
            "tool: Read c.txt (Done)".into(),
            "message: alpha, bravo, charlie".into(),
            format!("message: {}", sent[1]),
            "tool: Read first line of a.txt (Done)".into(),
            "message: started".into(),
            "tool: Read a.txt (Done)".into(),
            "message: alpha".into(),
            format!("message: {}", sent[2]),
            "tool: Nested agent reads b.txt first line (Done)".into(),
            "tool: Read first line of file (Done)".into(),
            "message: bravo".into(),
        ]
    );
    assert!(full.turns.iter().all(|t| t.state == TurnState::Done));
    assert_eq!(full.turns.len(), 3, "the background one held its turn");
    // Every reply is the parent's: what a sub-agent said is only in the
    // result of its Agent call.
    assert_eq!(
        replies(full),
        ["alpha, bravo, charlie", "started", "alpha", "bravo"]
    );
    let launched = full.items.iter().find_map(|item| match &item.body {
        Body::Tool {
            title,
            tool,
            content,
            ..
        } if title == "Read first line of a.txt" => Some((*tool, content.clone())),
        _ => None,
    });
    let text = |text: &str| ToolContent::Text { text: text.into() };
    assert_eq!(
        launched.unwrap(),
        (
            ToolKind::Think,
            vec![
                text("<tools-used-before-summary>Read</tools-used-before-summary>\n"),
                text("alpha")
            ]
        )
    );

    // A sub-agent's command asks as the parent's own Question.
    assert_eq!(
        texts(supervised),
        [
            format!("message: {}", recorded.threads[1].sends[0]),
            "tool: Write delta to file (Done)".into(),
            "tool: echo delta > d.txt (Done)".into(),
            "question: echo delta > d.txt (Answered)".into(),
            "message: The subagent ran `echo delta > d.txt` and replied: **done**".into(),
        ]
    );
}

/// Claude Code's Workflow call asks first, as Supervised has it, then ends
/// at once and so does the turn. A workflow agent's command asks between
/// turns as the parent's own Question, with no sign of which agent asks,
/// in a turn the Agent opens by itself; its call never ends. The
/// workflow's end is Claude's reply in that turn.
#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "the recording the fake agent replays was made on Linux: it moves the recorded folder to this one, and the rest of each path keeps its /, as no Harness on Windows says it"
)]
async fn a_claude_workflow_ends_its_turn_at_once_and_its_agent_asks_as_claude_by_itself() {
    let root = tempfile::tempdir().unwrap();
    let views = World::replay_sub_agents(root.path(), &CLAUDE_WORKFLOW).await;
    let view = &views[0];
    assert_eq!(
        texts(view),
        [
            format!("message: {}", CLAUDE_WORKFLOW.threads[0].sends[0]),
            "tool: Workflow (Done)".into(),
            "question: Workflow (Answered)".into(),
            "message: Launched.".into(),
            "notice: Fake went on by itself.".into(),
            "tool: echo delta > d.txt (Pending)".into(),
            "question: echo delta > d.txt (Answered)".into(),
            "message: The workflow finished. Both agents returned: the first line of `a.txt` \
             was `alpha`, and the write agent answered `done`."
                .into(),
        ]
    );
    assert_eq!(view.turns.len(), 2);
    assert!(view.turns.iter().all(|t| t.state == TurnState::Done));
}

/// Codex's sub-agents, before Banda declares them, are rows of their
/// start, the parent's wait and their end, with none of their work or
/// what they report.
#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "the recording the fake agent replays was made on Linux: it moves the recorded folder to this one, and the rest of each path keeps its /, as no Harness on Windows says it"
)]
async fn codex_s_sub_agents_show_as_their_start_the_wait_and_their_end() {
    let root = tempfile::tempdir().unwrap();
    let views = World::replay_sub_agents(root.path(), &CODEX_SUB_AGENTS).await;
    assert_eq!(
        texts(&views[0]),
        [
            format!("message: {}", CODEX_SUB_AGENTS.threads[0].sends[0]),
            "tool: Start subagent read_a (Done)".into(),
            "tool: Start subagent read_b (Done)".into(),
            "tool: wait (Done)".into(),
            "tool: Complete subagent read_a (Done)".into(),
            "tool: wait (Done)".into(),
            "tool: Complete subagent read_b (Done)".into(),
            "message: alpha,bravo".into(),
        ]
    );
    assert_eq!(views[0].turns[0].state, TurnState::Done);
}

#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "the recording the fake agent replays was made on Linux: it moves the recorded folder to this one, and the rest of each path keeps its /, as no Harness on Windows says it"
)]
async fn claude_code_asks_before_it_edits_and_shows_the_change() {
    let root = tempfile::tempdir().unwrap();
    let (_world, view, folder) = World::replay_edit(root.path(), "claude").await;
    assert_eq!(
        texts(&view),
        [
            format!("message: {EDIT}"),
            "tool: Read notes.txt (Done)".into(),
            "tool: Edit notes.txt (Done)".into(),
            "question: Edit notes.txt (Answered)".into(),
            "message: I added `pears` as the last line of `notes.txt`. The file now holds a \
             short list of two fruits, apples and pears, one per line."
                .into(),
        ]
    );
    assert_eq!(view.turns[0].state, TurnState::Done);
    let edit = view.items.iter().find_map(|item| match &item.body {
        Body::Tool { title, content, .. } if title == "Edit notes.txt" => Some(content),
        _ => None,
    });
    assert_eq!(
        edit.unwrap(),
        &[ToolContent::Diff {
            path: folder.join("notes.txt").display().to_string(),
            old: Some("apples".into()),
            new: "apples\npears".into(),
        }]
    );
    let Body::Question { choices, .. } = &view.items[3].body else {
        unreachable!()
    };
    let ids: Vec<_> = choices.iter().map(|c| (c.id.as_str(), c.always)).collect();
    assert_eq!(
        ids,
        [
            ("allow-once", false),
            ("allow-with-updates", true),
            ("reject", false)
        ]
    );
    assert!(slash_commands(&view).contains(&"compact"));
}

#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "the recording the fake agent replays was made on Linux: it moves the recorded folder to this one, and the rest of each path keeps its /, as no Harness on Windows says it"
)]
async fn codex_asks_before_it_runs_a_command_and_shows_what_its_commands_print() {
    let root = tempfile::tempdir().unwrap();
    let (_world, view, folder) = World::replay_edit(root.path(), "codex").await;
    let notes = folder.join("notes.txt");
    let said = texts(&view);
    assert_eq!(said.first(), Some(&format!("message: {EDIT}")));
    let asked = said
        .iter()
        .position(|t| t == "question: Run command (Answered)");
    let ran = said
        .iter()
        .position(|t| t == "tool: printf 'pears\\n' >> notes.txt (Done)");
    assert!(asked.is_some() && ran.is_some(), "{said:#?}");
    assert_eq!(
        said.last().unwrap(),
        "message: notes.txt now contains `apples` and `pears`, each on its own line."
    );
    assert_eq!(view.turns[0].state, TurnState::Done);
    let choices = view.items.iter().find_map(|item| match &item.body {
        Body::Question { choices, .. } => Some(choices),
        _ => None,
    });
    let ids: Vec<_> = choices
        .unwrap()
        .iter()
        .map(|c| (c.id.as_str(), c.always))
        .collect();
    assert_eq!(
        ids,
        [
            ("allow_once", false),
            ("accept_execpolicy_amendment", true),
            ("cancel", false)
        ]
    );
    let Body::Tool { title, output, .. } = last_tool(&view) else {
        unreachable!()
    };
    assert_eq!(title, &format!("Read file '{}'", notes.display()));
    assert_eq!(output.as_ref().unwrap().text, "apples\npears\n");
    assert!(slash_commands(&view).contains(&"review"));
}

#[tokio::test]
async fn a_recorded_conversation_plays_again_as_it_went() {
    let (root, kept) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut harness = harnesses().find("fake").unwrap().clone();
    harness.record = Some(kept.path().join("recordings"));
    let agents = Agents::new(Harnesses::new(vec![harness]));
    let world = World::new_with(root.path(), agents).await;
    let lived = world.edit(Duration::from_secs(10)).await;

    let files: Vec<_> = std::fs::read_dir(kept.path().join("recordings"))
        .unwrap()
        .map(|file| file.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1, "one file for the one start");
    let name = files[0].file_name().unwrap().to_str().unwrap();
    assert!(
        name.starts_with("fake-") && name.ends_with(".jsonl"),
        "{name}"
    );
    let agents = Agents::new(harnesses_with(&[(
        "FAKE_AGENT_REPLAY",
        files[0].to_str().unwrap(),
    )]));
    let again = tempfile::tempdir().unwrap();
    let world = World::new_with(again.path(), agents).await;
    let replayed = world.edit(Duration::from_secs(10)).await;
    assert_eq!(texts(&replayed), texts(&lived));
    assert_eq!(replayed.turns[0].state, TurnState::Done);
}

/// `threads`, `read` and `send` are tools from the methods table (ADR
/// 0019): their MCP names, their methods, their `///` and the schema of
/// their params, with only what an Agent sets.
#[tokio::test]
async fn threads_one_thread_send_show_visual_and_preview_visual_are_an_agents_tools() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = World::open(root.path(), owner).await;
    let agent = Participant::Agent(AgentId::new());
    let mut tools = kernel
        .call(agent, "projects.tools", None, None, Value::Null)
        .await
        .unwrap();
    // The machine's module `harnesses` comes first, with its own.
    let machine = tools.as_array_mut().unwrap();
    assert!(
        machine
            .iter()
            .any(|tool| tool["method"] == "harnesses.limits")
    );
    machine.retain(|tool| !tool["method"].as_str().unwrap().starts_with("harnesses."));
    // The last: its own Thread put off while it waits, and woken (ADR
    // 0074), with only what an Agent sets.
    let wake = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&wake["name"], &wake["method"]),
        (&json!("wake"), &json!("agents.wake"))
    );
    assert_eq!(
        wake["schema"]["required"],
        Value::Null,
        "its own by default"
    );
    let later = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&later["name"], &later["method"]),
        (&json!("later"), &json!("agents.later"))
    );
    let fields = later["schema"]["properties"].as_object().unwrap();
    let mut names: Vec<_> = fields.keys().map(String::as_str).collect();
    names.sort();
    assert_eq!(names, ["after", "thread", "until"]);
    // Then a line the Agent tells its Person when its turn ends.
    let notify = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&notify["name"], &notify["method"]),
        (&json!("notify"), &json!("agents.notify"))
    );
    assert_eq!(notify["schema"]["required"], json!(["text"]));
    // An issue the Agent drafts, which only its Person sends.
    let draft = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&draft["name"], &draft["method"]),
        (&json!("draft_issue"), &json!("agents.draft_issue"))
    );
    assert_eq!(
        draft["schema"]["required"],
        json!(["fingerprint", "title", "body"])
    );
    let preview = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&preview["name"], &preview["method"]),
        (&json!("preview_visual"), &json!("agents.preview_visual"))
    );
    assert!(
        preview["description"]
            .as_str()
            .unwrap()
            .contains("before show_visual")
    );
    let show = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&show["name"], &show["method"]),
        (&json!("show_visual"), &json!("agents.show_visual"))
    );
    let description = show["description"].as_str().unwrap();
    assert!(description.starts_with("Shows your Person a finished HTML page"));
    assert!(
        description.contains("--chart-1 to --chart-6"),
        "{description}"
    );
    let given: Vec<_> = show["schema"]["properties"]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    assert_eq!(given, ["html", "title", "height"]);
    assert_eq!(
        show["schema"]["required"],
        json!(["html", "title", "height"])
    );
    let send = tools.as_array_mut().unwrap().pop().unwrap();
    assert_eq!(
        (&send["name"], &send["method"]),
        (&json!("send"), &json!("agents.send"))
    );
    // A command: `banda mcp` sends it again after a broken connection,
    // as its receipt keeps it from running twice (ADR 0082, decision 4).
    assert_eq!(send["kind"], "command");
    let description = send["description"].as_str().unwrap();
    assert!(
        description.starts_with("Writes into a Thread of this Project"),
        "{description}"
    );
    let given: Vec<_> = send["schema"]["properties"]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    assert_eq!(given, ["thread", "harness", "text"]);
    let thread = json!({
        "type": "string",
        "format": "uuid",
        "description": "The Thread's ID, as `threads` lists it."
    });
    assert_eq!(
        tools,
        json!([
            {
                "name": "threads",
                "method": "agents.threads",
                "kind": "call",
                "description": "The Threads of this Project, the latest first: each one's ID, \
                    title and Harness, what it was last asked, how its latest turn stands, and \
                    the Questions it waits on.",
                "schema": { "type": "object", "properties": {} }
            },
            {
                "name": "read",
                "method": "agents.thread",
                "kind": "call",
                "description": "One Thread of this Project as its Person reads it: its messages \
                    and replies, its turns and what each may do now, and its settings.",
                "schema": {
                    "type": "object",
                    "properties": { "thread": thread },
                    "required": ["thread"]
                }
            }
        ])
    );
}

/// The Agent at work in a Thread, as its replies name it.
fn agent_of(view: &ThreadView) -> Participant {
    let mut authors = view.items.iter().map(|item| item.author);
    authors
        .find(|author| matches!(author, Participant::Agent(_)))
        .expect("the Agent replied")
}

/// Whether the Thread has `turns` turns and every one has ended.
fn settled(turns: usize) -> impl Fn(&ThreadView) -> bool {
    move |view| view.turns.len() == turns && view.turns.iter().all(|t| !ongoing(view, &json!(t.id)))
}

/// `(opener, from_thread)` as a turn that `from`'s Agent opened keeps it.
fn by(opener: &str, from: &Value) -> (String, Option<String>) {
    (opener.to_owned(), from.as_str().map(str::to_owned))
}

impl World {
    /// An Agent's message into a Thread, or into a new one on the Harness.
    async fn write(
        &self,
        agent: Participant,
        thread: Option<&Value>,
        text: &str,
    ) -> Result<Value, banda_kernel::Refusal> {
        let mut params = json!({ "text": text });
        match thread {
            Some(thread) => params["thread"] = thread.clone(),
            None => params["harness"] = json!(self.harness),
        }
        self.call(agent, "agents.send", params).await
    }

    /// Whether each message posted into `thread` answers, as its fact says.
    async fn posted_answers(&self, thread: &Value) -> Vec<Value> {
        let filter = EventFilter {
            module: Some("agents".to_owned()),
            subject: thread.as_str().map(str::to_owned),
            kinds: Some(vec!["message.posted".to_owned()]),
        };
        let project = self.kernel.project(self.project).await.unwrap();
        let events = project.events_after(0, filter, usize::MAX).await.unwrap();
        events
            .into_iter()
            .map(|e| e.payload["answers"].clone())
            .collect()
    }
}

#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "a page names its local images by Unix paths: Windows' come with ADR 0090's paths in the page (decision 7)"
)]
async fn an_agent_shows_its_person_a_visual_in_its_own_turn() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "wait").await;
    let thread = sent["thread"].clone();
    world
        .until(&thread, |v| {
            texts(v).contains(&"message: Waiting.".to_owned())
        })
        .await;
    let listed = world.threads().await.threads;
    let agent = Participant::Agent(listed[0].agent);
    let page = "<!doctype html><p style=\"color:var(--primary)\">Hi</p>";
    let show = |who, title: &str, height: u32| {
        world.call(
            who,
            "agents.show_visual",
            json!({ "html": page, "title": title, "height": height }),
        )
    };

    // The Agent's own Thread shows it, after what the turn said, by the Agent.
    let said = show(agent, " A mockup ", 12).await.unwrap();
    assert!(
        said.as_str()
            .unwrap()
            .starts_with("Shown to your Person above your reply.")
    );
    let view = world.thread(&thread).await;
    assert_eq!(
        texts(&view)[1..],
        ["message: Waiting.", "visual: A mockup (80px)"]
    );
    let item = view.items.last().unwrap();
    assert_eq!(item.author, agent);
    assert_eq!(json!(item.turn), sent["turn"]);
    let Body::Visual { visual, .. } = &item.body else {
        panic!("a Visual")
    };
    let read = world
        .call(world.person(), "agents.visual", json!({ "visual": visual }))
        .await
        .unwrap();
    assert_eq!(read["html"], page);

    // A Person has no Thread to show it in; a page is needed.
    let person = show(world.person(), "t", 300).await.unwrap_err();
    assert_eq!(person.code, Code::Forbidden);
    let empty = world
        .call(
            agent,
            "agents.show_visual",
            json!({ "html": "", "title": "t", "height": 300 }),
        )
        .await
        .unwrap_err();
    assert_eq!(
        empty.message,
        "A Visual needs its page: a whole HTML document."
    );
    // A local image goes into the page as it is kept; one not there, or
    // not an image, refuses the page, as a page sized by its frame does.
    let pictures = tempfile::tempdir().unwrap();
    let dot = pictures.path().join("dot.png");
    std::fs::write(&dot, b"\x89PNG\r\n\x1a\nrest").unwrap();
    let secret = pictures.path().join("secret.png");
    std::fs::write(&secret, b"TOKEN=hunter2").unwrap();
    let with = |src: &std::path::Path| format!("<!doctype html><img src=\"{}\">", src.display());
    let shown = world
        .call(
            agent,
            "agents.show_visual",
            json!({ "html": with(&dot), "title": "A dot", "height": 100 }),
        )
        .await
        .unwrap();
    assert!(shown.as_str().unwrap().starts_with("Shown"));
    let view = world.thread(&thread).await;
    let Body::Visual { visual, .. } = &view.items.last().unwrap().body else {
        panic!("a Visual")
    };
    let kept = world
        .call(world.person(), "agents.visual", json!({ "visual": visual }))
        .await
        .unwrap();
    assert_eq!(
        kept["html"],
        "<!doctype html><img src=\"data:image/png;base64,iVBORw0KGgpyZXN0\">"
    );
    for (html, said) in [
        (with(&secret), format!("{}: not an image", secret.display())),
        (
            with(&pictures.path().join("gone.png")),
            "gone.png: not found".into(),
        ),
        (
            "<!doctype html><div style=\"height:100vh\"></div>".into(),
            "(vh)".into(),
        ),
    ] {
        let refused = world
            .call(
                agent,
                "agents.show_visual",
                json!({ "html": html, "title": "t", "height": 300 }),
            )
            .await
            .unwrap_err();
        assert_eq!(refused.code, Code::Invalid);
        assert!(refused.message.contains(&said), "{}", refused.message);
    }
    let none = world
        .call(
            world.person(),
            "agents.visual",
            json!({ "visual": TurnId::new() }),
        )
        .await
        .unwrap_err();
    assert_eq!(none.message, "There is no such Visual.");

    // Once its turn ended, nothing shows, and no page is left behind.
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    world.until(&thread, |v| !ongoing(v, &sent["turn"])).await;
    let late = show(agent, "Late", 300).await.unwrap_err();
    assert_eq!(late.message, "A Visual shows in a turn that runs.");
    let kept = std::fs::read_dir(root.path().join(".data/projects"))
        .unwrap()
        .flat_map(|project| std::fs::read_dir(project.unwrap().path().join("visuals")).unwrap())
        .count();
    assert_eq!(kept, 2, "only the Visuals that showed keep their pages");
}

#[tokio::test]
async fn the_check_of_a_visual_needs_a_page_and_banda_s_window() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let agent = world.agent();
    let check = |html: &str| {
        world.call(
            agent,
            "agents.preview_visual",
            json!({ "html": html, "width": 9_000 }),
        )
    };
    let empty = check(" ").await.unwrap_err();
    assert_eq!(
        empty.message,
        "A Visual needs its page: a whole HTML document."
    );
    // The window lays pages out; with none open, nothing is checked.
    let alone = check("<p>Hi</p>").await.unwrap_err();
    assert_eq!(alone.code, Code::Conflict);
    assert!(
        alone.message.starts_with("Banda's window is not open."),
        "{}",
        alone.message
    );
}

#[tokio::test]
async fn an_agent_writes_to_another_thread_and_its_answer_comes_back() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (a, asking) = world.finish(None, "hello").await;
    let (b, answering) = world.finish(None, "hi there").await;
    let sent = world
        .write(agent_of(&asking), Some(&b), "count the files")
        .await
        .unwrap();
    assert_eq!(opened(root.path(), &sent["turn"]), by("asked", &a));

    // B keeps the plain words, by A's Agent; its Harness read who wrote.
    let view = world.until(&b, settled(2)).await;
    let message = view.items.iter().find(|i| json!(i.id) == sent["item"]);
    assert_eq!(message.unwrap().author, agent_of(&asking));
    let said = texts(&view);
    assert_eq!(said[3], "message: count the files");
    // It asks: neither the item nor its fact says it answers.
    let asks = matches!(message.unwrap().body, Body::Message { answers: false, .. });
    assert!(asks);
    assert_eq!(world.posted_answers(&b).await, [Value::Null, Value::Null]);
    let from = format!(
        "message: You said: The Agent of Thread \"hello\" ({}), another Agent of this Project",
        a.as_str().unwrap()
    );
    assert!(said[5].starts_with(&from), "{}", said[5]);
    assert!(said[5].ends_with("\n\ncount the files"), "{}", said[5]);

    // B's last reply goes back to A by itself, from B's Agent, and A goes on.
    let view = world.until(&a, settled(2)).await;
    let answered = json!(view.turns[1].id);
    assert_eq!(opened(root.path(), &answered), by("answered", &b));
    let answer = view.items.iter().find(|i| i.id == view.turns[1].message);
    assert_eq!(answer.unwrap().author, agent_of(&answering));
    let answers = matches!(answer.unwrap().body, Body::Message { answers: true, .. });
    assert!(answers, "the item says it answers");
    assert_eq!(world.posted_answers(&a).await, [Value::Null, json!(true)]);
    let said_in_a = texts(&view);
    assert_eq!(said_in_a[3], said[5], "the answer is B's last reply");
    let from = format!(
        "message: You said: The Agent of Thread \"hi there\" ({}), another Agent of this Project, answers",
        b.as_str().unwrap()
    );
    assert!(said_in_a[5].starts_with(&from), "{}", said_in_a[5]);
    // An answer is not asked again.
    assert_eq!(world.thread(&b).await.turns.len(), 2);
}

#[tokio::test]
async fn an_agent_starts_a_thread_on_a_harness_and_hears_from_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (a, view) = world.finish(None, "hello").await;
    let sent = world
        .write(agent_of(&view), None, "look around")
        .await
        .unwrap();
    let started = &sent["thread"];
    assert_ne!(*started, a);
    assert_eq!(opened(root.path(), &sent["turn"]), by("asked", &a));
    let view = world.until(started, settled(1)).await;
    assert_eq!(view.thread.title, "look around");
    let view = world.until(&a, settled(2)).await;
    let answered = json!(view.turns[1].id);
    assert_eq!(opened(root.path(), &answered), by("answered", started));
    assert_eq!(world.threads().await.threads.len(), 2);
}

#[tokio::test]
async fn a_failed_turn_an_agent_asked_for_answers_again_when_tried_again() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (a, asking) = world.finish(None, "hello").await;
    let (b, _) = world.finish(None, "hi there").await;
    let sent = world
        .write(agent_of(&asking), Some(&b), "flaky count")
        .await
        .unwrap();
    world.until(&b, settled(2)).await;
    let view = world.until(&a, settled(2)).await;
    assert!(texts(&view)[3].starts_with("message: Its turn ended failed: "));

    let params = json!({ "turn": sent["turn"] });
    let again = world
        .call(world.person(), "agents.retry", params)
        .await
        .unwrap();
    assert_eq!(opened(root.path(), &again["turn"]), by("retry", &a));
    let tried = world.until(&b, settled(3)).await;
    let view = world.until(&a, settled(3)).await;
    let reply = texts(&tried).pop().unwrap();
    assert!(
        texts(&view).contains(&reply),
        "the reply went back: {reply}"
    );
}

#[tokio::test]
async fn an_agent_writes_neither_to_its_own_thread_nor_in_a_circle() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (a, va) = world.finish(None, "hello").await;
    let (b, vb) = world.finish(None, "hi there").await;
    let (c, vc) = world.finish(None, "good day").await;
    let (agent_a, agent_b, agent_c) = (agent_of(&va), agent_of(&vb), agent_of(&vc));
    let code = |written: Result<Value, banda_kernel::Refusal>| written.unwrap_err().code;
    let own = world.write(agent_a, Some(&a), "hello me").await;
    assert_eq!(code(own), Code::Invalid);

    // A asks B, and B asks C, while each one's turn goes on.
    world.write(agent_a, Some(&b), "slow count").await.unwrap();
    let circle = world.write(agent_b, Some(&a), "answer").await;
    assert_eq!(code(circle), Code::Conflict);
    world.write(agent_b, Some(&c), "slow too").await.unwrap();
    for to in [&a, &b] {
        let circle = world.write(agent_c, Some(to), "answer").await;
        assert_eq!(code(circle), Code::Conflict);
    }

    // Once the answers came back, nobody waits.
    world.until(&b, settled(3)).await;
    world.until(&a, settled(2)).await;
    world.write(agent_c, Some(&a), "now then").await.unwrap();
    // An Agent of no Thread writes nowhere.
    let nowhere = world.write(world.agent(), Some(&a), "hi").await;
    assert_eq!(code(nowhere), Code::Forbidden);
}

#[tokio::test]
async fn an_agent_writes_neither_over_a_persons_question_nor_into_another_project() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "hello").await;
    let agent = agent_of(&view);
    let sent = world.send(None, "please ask first").await;
    world.until(&sent["thread"], asking).await;
    let refused = world
        .write(agent, Some(&sent["thread"]), "yes, go on")
        .await;
    assert_eq!(refused.unwrap_err().code, Code::Conflict);

    // A pass keeps its Agent in its own Project, whatever it calls.
    let walled = Caller {
        only: Some(ProjectId::new()),
        ..Caller::from(agent)
    };
    let params = json!({ "harness": "fake", "text": "elsewhere" });
    let command = Some(CommandId::new());
    let refused = world
        .kernel
        .call(walled, "agents.send", Some(world.project), command, params)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
}

#[tokio::test]
async fn a_removed_project_stops_its_turns_before_its_data_goes() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    world.waiting(None).await;
    let params = json!({ "project": world.project });
    let removed = world.kernel.call(
        world.person(),
        "projects.remove",
        None,
        Some(CommandId::new()),
        params,
    );
    removed.await.unwrap();
    // A turn that kept running would hold the data until it ended.
    let projects = root.path().join(".data/projects");
    let since = std::time::Instant::now();
    while projects.read_dir().unwrap().next().is_some() {
        assert!(
            since.elapsed() < Duration::from_secs(5),
            "the turn never stopped"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_thread_forks_at_a_turns_end_and_its_session_knows_only_that_far() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, first) = world.finish(None, "remember apples").await;
    let turn = first.turns[0].id;
    world.finish(Some(&thread), "remember pears").await;

    let forked = world
        .call(world.person(), "agents.fork", json!({ "turn": turn }))
        .await
        .unwrap();
    let fork = &forked["thread"];
    assert_ne!(fork, &thread);
    let view = world.thread(fork).await;
    assert_eq!(view.thread.title, "remember apples fork");
    assert_eq!(
        view.forked_from.map(|from| json!(from)).as_ref(),
        Some(&thread),
        "it names the Thread it was forked from"
    );
    assert_eq!(first.forked_from, None);
    assert_eq!(
        texts(&view),
        [
            "message: remember apples",
            "message: I will remember apples."
        ],
        "the conversation to the end of the turn"
    );
    assert_eq!(view.turns.len(), 1);
    assert_ne!(
        view.turns[0].id, turn,
        "each turn copied has an ID of its own"
    );
    assert_ne!(view.items[0].id, first.items[0].id);

    // Its session is a fork at that turn's reply, and the Thread's own
    // goes on as it was.
    let (_, view) = world.finish(Some(fork), "what do you remember").await;
    assert_eq!(last_reply(&view), "message: I remember: apples.");
    let (_, view) = world.finish(Some(&thread), "what do you remember").await;
    assert_eq!(last_reply(&view), "message: I remember: apples, pears.");
}

#[tokio::test]
async fn a_thread_is_not_forked_where_its_agent_named_no_reply_or_while_it_works() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "hello").await;
    let fork = |turn: TurnId| world.call(world.person(), "agents.fork", json!({ "turn": turn }));
    let refused = fork(view.turns[0].id).await.unwrap_err();
    assert_eq!(
        refused.code,
        Code::Conflict,
        "the fake names no plain reply"
    );

    let sent = world.send(Some(&thread), "wait").await;
    world.until(&thread, |v| ongoing(v, &sent["turn"])).await;
    let refused = fork(view.turns[0].id).await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict, "not while a turn runs");
    let turn: TurnId = serde_json::from_value(sent["turn"].clone()).unwrap();
    assert_eq!(fork(turn).await.unwrap_err().code, Code::Conflict);
}

#[tokio::test]
async fn a_thread_goes_back_to_before_a_message_and_its_session_forgets_what_came_after() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "remember apples").await;
    let (_, view) = world.finish(Some(&thread), "remember pears").await;
    let pears = view.turns[1].id;
    let (_, view) = world.finish(Some(&thread), "remember plums").await;
    assert!(view.turns.iter().all(|turn| turn.can.rewind));
    let rewind =
        |turn: TurnId| world.call(world.person(), "agents.rewind", json!({ "turn": turn }));

    // The turn of "remember pears" and every one after it leave the
    // Thread; its session goes back to the reply before.
    rewind(pears).await.unwrap();
    let view = world.thread(&thread).await;
    assert_eq!(
        texts(&view),
        [
            "message: remember apples",
            "message: I will remember apples."
        ]
    );
    assert_eq!(view.turns.len(), 1);
    let (_, view) = world.finish(Some(&thread), "what do you remember").await;
    assert_eq!(last_reply(&view), "message: I remember: apples.");

    // Back to before the first message, it starts anew.
    rewind(view.turns[0].id).await.unwrap();
    let view = world.thread(&thread).await;
    assert!(view.items.is_empty() && view.turns.is_empty());
    let (_, view) = world.finish(Some(&thread), "what do you remember").await;
    assert_eq!(last_reply(&view), "message: I remember: .");
    assert!(
        !texts(&view).iter().any(|text| text.contains("afresh")),
        "a new session it asked for is not one it lost"
    );
}

#[tokio::test]
async fn a_message_gone_back_from_keeps_its_images_for_the_next() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let shot = world
        .attach(world.person(), "image/png", PNG, Some("shot.png"))
        .await
        .unwrap();
    let sent = world.send_images("what is this", &[&shot]).await;
    let view = world.ended(&sent).await;
    world
        .call(
            world.person(),
            "agents.rewind",
            json!({ "turn": view.turns[0].id }),
        )
        .await
        .unwrap();
    // The image waits, as a draft's does, and goes with the next message.
    let read = world
        .call(
            world.person(),
            "agents.image",
            json!({ "image": shot["id"] }),
        )
        .await;
    assert!(read.is_ok(), "{read:?}");
    let params =
        json!({ "thread": sent["thread"], "text": "what is this", "images": [shot["id"]] });
    let sent = world
        .call(world.person(), "agents.send", params)
        .await
        .unwrap();
    let view = world.ended(&sent).await;
    assert_eq!(texts(&view)[0], "message: what is this + 1 image(s)");
}

#[tokio::test]
async fn a_thread_goes_back_only_to_a_persons_message_once_nothing_runs() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let (_, view) = world.finish(Some(&thread), "hello again").await;
    let rewind =
        |turn: TurnId| world.call(world.person(), "agents.rewind", json!({ "turn": turn }));
    // The fake names no plain reply, so the second message has no reply
    // to go back to; the first starts anew.
    let refused = rewind(view.turns[1].id).await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict);

    let sent = world.send(Some(&thread), "wait").await;
    let view = world.until(&thread, |v| ongoing(v, &sent["turn"])).await;
    assert!(view.turns.iter().all(|turn| !turn.can.rewind));
    let refused = rewind(view.turns[0].id).await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict, "not while a turn runs");
}

/// Claude Code and Codex fork a session at a turn's reply, by the ID they
/// gave its message (ADR 0027): the fork knows what came before it and
/// not what came after. It calls the models, which costs money: run it by
/// hand when an adapter changes, `cargo test -p banda-agents --test agents
/// real_harnesses_fork -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "calls the real models, which costs money"]
async fn the_real_harnesses_fork_a_thread_at_a_turns_end() {
    told_apples_then_pears(async |world, thread, view| {
        let forked = world
            .call(
                world.person(),
                "agents.fork",
                json!({ "turn": view.turns[0].id }),
            )
            .await
            .unwrap();
        let fork = world.thread(&forked["thread"]).await;
        assert_eq!(fork.thread.title, forked["title"]);
        assert_eq!(
            fork.forked_from.map(|from| json!(from)).as_ref(),
            Some(thread)
        );
        forked["thread"].clone()
    })
    .await;
}

/// Claude Code and Codex go back to before a message (ADR 0027): the
/// Thread's open session forks at the reply before it, and the next turn
/// knows nothing after it. It calls the models, which costs money: run it
/// by hand when an adapter changes, `cargo test -p banda-agents --test
/// agents real_harnesses_go_back -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "calls the real models, which costs money"]
async fn the_real_harnesses_go_back_to_before_a_message() {
    told_apples_then_pears(async |world, thread, view| {
        let turn = view.turns[1].id;
        let back = world
            .call(world.person(), "agents.rewind", json!({ "turn": turn }))
            .await;
        back.unwrap();
        assert_eq!(world.thread(thread).await.turns.len(), 1);
        thread.clone()
    })
    .await;
}

/// A skill of the Person's that Claude Code says as a slash command runs
/// named with `$` mid-message; the model may not run it of itself, so the
/// word it answers comes of the skill run alone (issue #149). It calls the
/// model, which costs money: run it by hand when the adapter changes,
/// `cargo test -p banda-agents --test agents claude_runs -- --ignored`.
#[tokio::test]
#[ignore = "calls the real model, which costs money"]
async fn claude_runs_a_skill_named_with_a_dollar_mid_message() {
    let known = Harnesses::known();
    let agents = Agents::new(Harnesses::new(vec![known.find("claude").unwrap().clone()]));
    let root = tempfile::tempdir().unwrap();
    let world = World::new_on(root.path(), agents, "claude").await;
    let project = world.kernel.project(world.project).await.unwrap();
    let skill = project.folder().join(".claude/skills/banda-echo");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: banda-echo\ndescription: Answers with a fixed word.\n\
         disable-model-invocation: true\n---\n\nReply with only the word MANGOES.\n",
    )
    .unwrap();
    let (thread, view) = world
        .finish_real(None, "Do not use any tools. Reply with only: OK")
        .await;
    assert!(
        view.offer.skills.iter().any(|s| s.name == "banda-echo"),
        "its skill: {:?}",
        view.offer.skills
    );
    let (_, view) = world
        .finish_real(Some(&thread), "Please run $banda-echo now.")
        .await;
    let said = texts(&view);
    eprintln!("claude: {}", said.last().unwrap());
    assert!(said.last().unwrap().contains("MANGOES"), "{said:?}");
}

/// Tells each real Harness to remember APPLES, then PEARS; `back` takes
/// the Thread to after the first, and answers the Thread to ask what it
/// remembers there: APPLES alone.
async fn told_apples_then_pears(back: impl AsyncFn(&World, &Value, &ThreadView) -> Value) {
    let known = Harnesses::known();
    for harness in ["claude", "codex"] {
        let agents = Agents::new(Harnesses::new(vec![known.find(harness).unwrap().clone()]));
        let root = tempfile::tempdir().unwrap();
        let world = World::new_on(root.path(), agents, harness).await;
        let (thread, _) = world
            .finish_real(
                None,
                "Remember the word APPLES. Do not use any tools. Reply with only: OK",
            )
            .await;
        let (_, view) = world
            .finish_real(
                Some(&thread),
                "Remember the word PEARS too. Do not use any tools. Reply with only: OK",
            )
            .await;
        let asked = back(&world, &thread, &view).await;
        let ask = "Which words did I ask you to remember? Do not use any tools. \
                   Reply with only the words, comma separated.";
        let (_, view) = world.finish_real(Some(&asked), ask).await;
        let reply = last_reply(&view);
        println!("{harness}: {reply}");
        assert!(reply.contains("APPLES"), "{harness} remembers: {reply}");
        assert!(!reply.contains("PEARS"), "{harness} knows no more: {reply}");
    }
}

impl World {
    /// Opens `agents.write` with `params`: its stream, or why not.
    async fn writing(&self, params: Value) -> Result<banda_kernel::Stream, banda_kernel::Refusal> {
        (self.kernel)
            .stream(self.person(), "agents.write", Some(self.project), params)
            .await
    }

    /// What `agents.write` says to `params`: the reply's text, or why
    /// there is none.
    async fn written(&self, params: Value) -> Result<String, banda_kernel::Refusal> {
        let mut heard = self.writing(params).await?;
        let piece = tokio::time::timeout(Duration::from_secs(30), heard.recv())
            .await
            .expect("it writes in time")
            .expect("it says a piece");
        match piece["kind"].as_str() {
            Some("reply") => Ok(piece["text"].as_str().unwrap().to_owned()),
            _ => Err(serde_json::from_value(piece["refusal"].clone()).unwrap()),
        }
    }
}

#[tokio::test]
async fn a_short_run_of_its_own_writes_on_the_threads_model_and_the_thread_never_shows_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "which session").await;
    world
        .configure(
            &thread,
            json!({ "options": { "model": "smart", "effort": "high" } }),
        )
        .await;
    let before = texts(&world.thread(&thread).await);
    let write = |prompt: &str| world.written(json!({ "thread": thread, "prompt": prompt }));

    let written = write("which settings").await.unwrap();
    assert_eq!(written, "Mode plan, model smart, brief false");
    // On the Thread's model, at the least effort it offers: quick.
    assert_eq!(
        write("which effort").await.unwrap(),
        "Effort low, fast false"
    );
    // What it asks is refused: the tool call is skipped, and it replies.
    assert!(!write("ask").await.unwrap().is_empty());
    let own = write("which session").await.unwrap();

    assert_eq!(texts(&world.thread(&thread).await), before);
    let (_, (session, _)) = ask_session(&world, Some(&thread)).await;
    assert!(!own.contains(&session), "{own} is the Thread's {session}");
    // The Thread's own session keeps its effort.
    let (_, view) = world.finish(Some(&thread), "which effort").await;
    assert!(
        texts(&view).contains(&"message: Effort high, fast false".to_owned()),
        "{:?}",
        texts(&view)
    );

    let refused = world
        .writing(json!({ "thread": banda_agents::model::ThreadId::new(), "prompt": "hello" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    let refused = world
        .writing(json!({ "prompt": "hello" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn a_new_threads_harness_writes_before_the_thread_starts() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let written = world
        .written(json!({ "harness": "fake", "prompt": "which settings" }))
        .await
        .unwrap();
    assert_eq!(written, "Mode plan, model fast, brief false");
    assert!(world.threads().await.threads.is_empty(), "no Thread starts");
    let refused = world
        .writing(json!({ "harness": "nobody", "prompt": "hello" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn a_write_let_go_stops_its_run_and_closes_its_session() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    // How many turns run, and how many sessions were closed besides the
    // ones these counts ran in: each is closed before it answers.
    let counts = std::cell::Cell::new(0);
    let count = async || {
        let said = world
            .written(json!({ "thread": thread, "prompt": "how many turns" }))
            .await
            .unwrap();
        let (running, closed) = said
            .strip_prefix("Turns running ")
            .and_then(|said| said.split_once(", sessions closed "))
            .unwrap();
        let earlier = counts.replace(counts.get() + 1);
        let closed: u64 = closed.parse().unwrap();
        (running.parse::<u64>().unwrap(), closed - earlier)
    };
    assert_eq!(count().await, (1, 0));

    // It waits until it is stopped, as a slow Harness would.
    let heard = world
        .writing(json!({ "thread": thread, "prompt": "wait" }))
        .await
        .unwrap();
    let mut now = count().await;
    for _ in 0..100 {
        if now == (2, 0) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        now = count().await;
    }
    assert_eq!(now, (2, 0), "it runs beside the count");

    // Let go: its turn is cancelled, and its session closed.
    drop(heard);
    for _ in 0..100 {
        now = count().await;
        if now == (1, 1) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(now, (1, 1), "it stopped and its session closed");
}

/// Claude Code and Codex write a commit's message in a short run of
/// their own (ADR 0034, decision 3): JSON as the prompt asks, nothing
/// changed in the folder, nothing shown in the Thread. It calls the
/// models, which costs money: run it by hand when an adapter or the
/// prompt changes, `cargo test -p banda-agents --test agents -- --ignored
/// the_real_harnesses_write_a_commits_message --nocapture`.
#[tokio::test]
#[ignore = "calls the real models, which costs money"]
async fn the_real_harnesses_write_a_commits_message() {
    let known = Harnesses::known();
    for harness in ["claude", "codex"] {
        let agents = Agents::new(Harnesses::new(vec![known.find(harness).unwrap().clone()]));
        let root = tempfile::tempdir().unwrap();
        let world = World::new_on(root.path(), agents, harness).await;
        let project = world.kernel.project(world.project).await.unwrap();
        let notes = project.folder().join("notes.txt");
        std::fs::write(&notes, "apples\npears\n").unwrap();
        let (thread, _) = world
            .finish_real(None, "Do not use any tools. Reply with only: OK")
            .await;
        let before = texts(&world.thread(&thread).await);
        let prompt = "You write concise git commit messages.\n\
            Return only a JSON object with keys: subject, body, branch.\n\
            Rules:\n\
            - subject must be imperative, <= 72 chars, and no trailing period\n\
            - body can be empty string or short bullet points\n\
            - no trailers: no Co-Authored-By line, no \"Generated with\" line, nothing naming who wrote it\n\
            - branch must be a short semantic git branch fragment for this change\n\
            - capture the primary user-visible or developer-visible change\n\
            - do not run tools or change files: answer from what is below\n\
            - follow the repository's established commit message style, as its last subjects show\n\n\
            Last subjects:\nAdd the shopping list\nFix the list's order\n\n\
            Branch: main\n\n\
            Files:\nnotes.txt (+1 −0)\n\n\
            Patch:\n\
            diff --git a/notes.txt b/notes.txt\n\
            --- a/notes.txt\n\
            +++ b/notes.txt\n\
            @@ -1,2 +1,3 @@\n apples\n pears\n+plums\n";
        let started = std::time::Instant::now();
        let written = world
            .written(json!({ "thread": thread, "prompt": prompt }))
            .await;
        println!("{harness} in {:?}: {written:#?}", started.elapsed());
        let text = written.unwrap();
        let object = &text[text.find('{').unwrap()..=text.rfind('}').unwrap()];
        let reply: Value = serde_json::from_str(object).unwrap();
        let subject = reply["subject"].as_str().unwrap();
        assert!(!subject.is_empty() && subject.len() <= 72, "{reply}");
        assert!(subject.to_lowercase().contains("plum"), "{reply}");
        assert!(reply["branch"].is_string(), "{reply}");
        assert_eq!(std::fs::read_to_string(&notes).unwrap(), "apples\npears\n");
        assert_eq!(texts(&world.thread(&thread).await), before);
    }
}

#[tokio::test]
async fn an_agent_tells_its_person_what_its_turn_ends_with() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "wait").await;
    let thread = sent["thread"].clone();
    world
        .until(&thread, |v| {
            texts(v).contains(&"message: Waiting.".to_owned())
        })
        .await;
    let agent = Participant::Agent(world.threads().await.threads[0].agent);
    let notify = |who, text: &str| world.call(who, "agents.notify", json!({ "text": text }));

    // One line a turn, from its own Agent: the last one is kept.
    let said = notify(agent, "Started the build").await.unwrap();
    assert!(
        said.as_str()
            .unwrap()
            .starts_with("Kept: your Person sees it")
    );
    notify(agent, " PR #470 is open, CI green ").await.unwrap();
    for text in ["", "two\nlines", &"x".repeat(141)] {
        assert_eq!(notify(agent, text).await.unwrap_err().code, Code::Invalid);
    }
    assert_eq!(
        notify(world.person(), "Hi").await.unwrap_err().code,
        Code::Forbidden
    );

    // The turn that ends carries it, and the list keeps it.
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    world
        .until(&thread, |v| {
            state(v, &sent["turn"]) == Some(TurnState::Stopped)
        })
        .await;
    let latest = world.threads().await.threads[0].latest.clone().unwrap();
    assert_eq!(latest.note.as_deref(), Some("PR #470 is open, CI green"));

    // With no turn that runs, there is nothing to keep it on.
    assert_eq!(
        notify(agent, "Late").await.unwrap_err().code,
        Code::Conflict
    );
}

#[tokio::test]
async fn an_agent_drafts_an_issue_that_only_its_person_answers() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "wait").await;
    let thread = sent["thread"].clone();
    world
        .until(&thread, |v| {
            texts(v).contains(&"message: Waiting.".to_owned())
        })
        .await;
    let agent = Participant::Agent(world.threads().await.threads[0].agent);
    let draft = |title: &str| {
        world.call(
            agent,
            "agents.draft_issue",
            json!({ "fingerprint": "3124d1bf35ad", "title": title, "body": "## What broke" }),
        )
    };

    // The Agent drafts it in its own Thread; the Person sees a card.
    let said = draft("Tabs break").await.unwrap();
    assert!(
        said.as_str()
            .unwrap()
            .starts_with("Shown to your Person as a card")
    );
    assert_eq!(draft(" ").await.unwrap_err().code, Code::Invalid);
    let view = world.thread(&thread).await;
    assert_eq!(texts(&view).last().unwrap(), "issue: Tabs break (Drafted)");
    let item = view.items.last().unwrap().id;
    let url = "https://github.com/0x1oceanlabs/banda/issues/412";
    let answer = |who, answer: Value| {
        let mut answer = answer;
        answer["item"] = json!(item);
        world.call(who, "agents.answer_issue", answer)
    };

    // Only the Person answers it, sent as they last wrote it; once.
    let sent = json!({ "state": "sent", "title": "Tabs break, no title", "body": "## What broke", "url": url });
    assert_eq!(
        answer(agent, sent.clone()).await.unwrap_err().code,
        Code::Forbidden
    );
    let unsent = json!({ "state": "sent" });
    assert_eq!(
        answer(world.person(), unsent).await.unwrap_err().code,
        Code::Invalid
    );
    answer(world.person(), sent.clone()).await.unwrap();
    let view = world.thread(&thread).await;
    assert_eq!(
        texts(&view).last().unwrap(),
        "issue: Tabs break, no title (Sent)"
    );
    let Body::Issue {
        url: went, body, ..
    } = &view.items.last().unwrap().body
    else {
        panic!("an issue")
    };
    assert_eq!(
        (went.as_deref(), body.as_str()),
        (Some(url), "## What broke")
    );
    assert_eq!(
        answer(world.person(), sent).await.unwrap_err().code,
        Code::Conflict
    );

    // Or the Person does not send it.
    draft("Tabs break").await.unwrap();
    let other = world.thread(&thread).await.items.last().unwrap().id;
    let cancel = json!({ "item": other, "state": "cancelled" });
    world
        .call(world.person(), "agents.answer_issue", cancel)
        .await
        .unwrap();
    let view = world.thread(&thread).await;
    assert_eq!(
        texts(&view).last().unwrap(),
        "issue: Tabs break (Cancelled)"
    );
}

#[test]
fn tool_images_are_kept_as_files_in_order_and_survive_restart() {
    let root = tempfile::tempdir().unwrap();
    across_a_restart(
        root.path(),
        || Agents::new(harnesses()),
        async |world| {
            let (thread, view) = world.finish(None, "tool images").await;
            let content = view
                .items
                .iter()
                .find_map(|item| match &item.body {
                    Body::Tool {
                        content,
                        status: ToolStatus::Done,
                        ..
                    } => Some(content),
                    _ => None,
                })
                .expect("the updated tool result");
            assert!(
                matches!(&content[0], ToolContent::Text { text } if text == "Before the screenshot.")
            );
            assert!(
                matches!(&content[2], ToolContent::Text { text } if text.starts_with("Image could not be shown:"))
            );
            assert!(
                matches!(&content[4], ToolContent::Text { text } if text == "After the screenshot.")
            );
            let images: Vec<_> = content
                .iter()
                .filter_map(|part| match part {
                    ToolContent::Image { image } => Some(image.clone()),
                    _ => None,
                })
                .collect();
            assert_eq!(images.len(), 2);
            for image in &images {
                let read = world
                    .call(world.person(), "agents.image", json!({"image": image.id}))
                    .await
                    .unwrap();
                assert_eq!(read["mime"], "image/png");
                let bytes = BASE64.decode(read["data"].as_str().unwrap()).unwrap();
                assert_eq!(bytes.len(), image.size as usize);
                assert_eq!(
                    bytes,
                    include_bytes!("../../../../client/desktop/e2e/shot.png")
                );
                let text = serde_json::to_string(&view).unwrap();
                assert!(
                    !text.contains(read["data"].as_str().unwrap()),
                    "binary payloads stay out of Thread snapshots"
                );
            }
            (thread, images[0].id)
        },
        async |world, (thread, image)| {
            let reopened = world.thread(&thread).await;
            assert!(reopened.items.iter().any(|item| matches!(&item.body, Body::Tool { content, .. } if content.iter().any(|part| matches!(part, ToolContent::Image { image: kept } if kept.id == image)))));
            assert!(
                world
                    .call(world.person(), "agents.image", json!({"image":image}))
                    .await
                    .is_ok()
            );
        },
    );
}

#[tokio::test]
async fn a_tool_update_with_images_can_arrive_before_the_start_and_be_forked() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "tool images raw update only").await;
    let image = view
        .items
        .iter()
        .find_map(|item| match &item.body {
            Body::Tool { content, .. } => content.iter().find_map(|part| match part {
                ToolContent::Image { image } => Some(image.clone()),
                _ => None,
            }),
            _ => None,
        })
        .unwrap();
    let turn = view.turns[0].id;
    // The Harness must name a reply to fork its session at that point.
    let (_, named) = world.finish(Some(&thread), "remember screenshots").await;
    let fork_at = named.turns[1].id;
    let fork = world
        .call(world.person(), "agents.fork", json!({"turn":fork_at}))
        .await
        .unwrap();
    world
        .call(world.person(), "agents.rewind", json!({"turn":turn}))
        .await
        .unwrap();
    assert!(
        !world
            .thread(&thread)
            .await
            .items
            .iter()
            .any(|item| matches!(item.body, Body::Tool { .. }))
    );
    let forked = world.thread(&fork["thread"]).await;
    assert!(forked.items.iter().any(|item| matches!(&item.body, Body::Tool {content, ..} if content.iter().any(|part| matches!(part, ToolContent::Image {image: kept} if kept.id == image.id)))));
    assert!(
        world
            .call(world.person(), "agents.image", json!({"image":image.id}))
            .await
            .is_ok()
    );
}

/// An hour from now, in milliseconds since the epoch.
fn in_an_hour() -> i64 {
    banda_kernel::now_ms() + 3_600_000
}

impl World {
    /// `who` puts off `thread` until `until`, or, without it, until done.
    async fn later(
        &self,
        who: Participant,
        thread: &Value,
        until: Option<i64>,
    ) -> Result<Value, banda_kernel::Refusal> {
        let mut params = json!({ "thread": thread });
        if let Some(until) = until {
            params["until"] = json!(until);
        }
        self.call(who, "agents.later", params).await
    }

    /// The Later the list shows for `thread`.
    async fn later_of(&self, thread: &Value) -> Option<banda_agents::model::Later> {
        let list = self.threads().await.threads;
        let listed = list.into_iter().find(|t| json!(t.thread.id) == *thread);
        listed.expect("the Thread is listed").later
    }

    /// What woke `thread` before its time, as the list says.
    async fn woke(&self, thread: &Value) -> Option<Wake> {
        self.later_of(thread).await?.woke.map(|woke| woke.by)
    }
}

impl World {
    /// Renames `thread` to `title`, or to its first message's with none.
    async fn rename(
        &self,
        thread: &Value,
        title: Option<&str>,
    ) -> Result<Value, banda_kernel::Refusal> {
        let mut params = json!({ "thread": thread });
        if let Some(title) = title {
            params["title"] = json!(title);
        }
        self.call(self.person(), "agents.rename", params).await
    }

    /// The `thread.renamed` facts of `thread`, the first first.
    async fn renamed(&self, thread: &Value) -> Vec<Value> {
        let filter = EventFilter {
            module: Some("agents".to_owned()),
            subject: thread.as_str().map(str::to_owned),
            kinds: Some(vec!["thread.renamed".to_owned()]),
        };
        let project = self.kernel.project(self.project).await.unwrap();
        let events = project.events_after(0, filter, usize::MAX).await.unwrap();
        events.into_iter().map(|e| e.payload).collect()
    }

    /// The Thread as `agents.threads` lists it.
    async fn listed(&self, thread: &Value) -> banda_agents::model::ListedThread {
        let threads = self.threads().await.threads;
        let found = threads
            .into_iter()
            .find(|listed| json!(listed.thread.id) == *thread);
        found.expect("the Thread is listed")
    }

    async fn suggest_title(&self, thread: &Value) -> Result<String, banda_kernel::Refusal> {
        let asked = json!({ "thread": thread });
        let said = self
            .call(self.person(), "agents.suggest_title", asked)
            .await?;
        Ok(said.as_str().unwrap().to_owned())
    }
}

#[tokio::test]
async fn the_host_wakes_a_thread_as_its_time_comes_once_with_that_time() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let until = banda_kernel::now_ms() + 300;
    world
        .later(world.person(), &thread, Some(until))
        .await
        .unwrap();
    let mut woke = None;
    for _ in 0..100 {
        woke = world.later_of(&thread).await.unwrap().woke;
        if woke.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let woke = woke.expect("its time woke it");
    assert_eq!((woke.by, woke.at), (Wake::Time, until));
    let facts = world.facts("thread.woke").await;
    let payloads: Vec<_> = facts.into_iter().map(|event| event.payload).collect();
    assert_eq!(
        payloads,
        [json!({ "thread": thread, "by": "time", "at": until })]
    );
}

#[tokio::test]
async fn a_later_puts_a_thread_away_until_its_time_and_the_list_says_so() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    let until = in_an_hour();
    let person = world.person();
    world.later(person, &thread, Some(until)).await.unwrap();
    let listed = world.later_of(&thread).await.unwrap();
    assert_eq!(
        (listed.until, listed.by, listed.woke),
        (Some(until), person, None)
    );
    let past = world
        .later(person, &thread, Some(banda_kernel::now_ms() - 1))
        .await;
    assert!(past.is_err(), "a time gone is refused");
    let idle = world.later(person, &thread, None).await;
    assert!(
        idle.is_err(),
        "only a Thread at work sleeps until it is done"
    );

    // Woken by hand, it stays awake, and waking it again does nothing.
    let wake = json!({ "thread": thread });
    world
        .call(person, "agents.wake", wake.clone())
        .await
        .unwrap();
    let woke = world.later_of(&thread).await.unwrap().woke;
    assert_eq!(woke.map(|w| w.by), Some(Wake::Woken));
    world.call(person, "agents.wake", wake).await.unwrap();
    assert_eq!(world.later_of(&thread).await.unwrap().woke, woke);
}

#[tokio::test]
async fn a_thread_that_asks_may_be_put_off_and_a_new_question_wakes_one_early() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "please ask first").await;
    let asks = &sent["thread"];
    world.until(asks, asking).await;
    // Put off while it asks (ADR 0098, decision 11), it sleeps with the
    // same question, and still cannot be archived.
    world
        .later(world.person(), asks, Some(in_an_hour()))
        .await
        .unwrap();
    let later = world.later_of(asks).await.unwrap();
    assert_eq!((later.until.is_some(), later.woke), (true, None));
    let archived = world.archive(world.person(), asks, true).await;
    assert!(archived.is_err(), "a Thread that asks is never archived");
    // Its Agent does not hide its own question; its Person's answer wakes
    // it.
    let view = world.until(asks, asking).await;
    let hides = world.later(agent_of(&view), asks, None).await;
    assert!(hides.is_err(), "its Agent leaves its question in sight");
    let question = open(&view).unwrap().0;
    let answer = json!({ "item": question, "choice": "allow" });
    world
        .call(world.person(), "agents.answer", answer)
        .await
        .unwrap();
    assert_eq!(world.woke(asks).await, Some(Wake::Message));

    // Another Thread's Agent writes to a sleeping one, which then asks.
    let (writer, writing) = world.finish(None, "hello").await;
    let (sleeper, _) = world.finish(None, "hi there").await;
    world
        .later(world.person(), &sleeper, Some(in_an_hour()))
        .await
        .unwrap();
    world
        .write(agent_of(&writing), Some(&sleeper), "please ask first")
        .await
        .unwrap();
    world.until(&sleeper, asking).await;
    assert_eq!(world.woke(&sleeper).await, Some(Wake::Question));
    assert!(world.later_of(&writer).await.is_none());
}

#[tokio::test]
async fn someday_is_a_persons_and_the_end_of_its_turn_leaves_it_asleep() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "wait for me").await;
    let thread = &sent["thread"];
    world
        .until(thread, |v| {
            state(v, &sent["turn"]) == Some(TurnState::Running)
        })
        .await;
    let (_, view) = world.finish(None, "hello").await;
    let own = json!({ "someday": true });
    let agents = world.call(agent_of(&view), "agents.later", own).await;
    assert!(agents.is_err(), "Someday is its Person's");
    let someday = json!({ "thread": thread, "someday": true });
    let both = json!({ "thread": thread, "someday": true, "after": "1h" });
    let both = world.call(world.person(), "agents.later", both).await;
    assert!(both.is_err(), "Someday has no time");
    world
        .call(world.person(), "agents.later", someday)
        .await
        .unwrap();
    let later = world.later_of(thread).await.unwrap();
    assert_eq!((later.someday, later.until), (true, None));
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    world.until(thread, settled(1)).await;
    assert_eq!(
        world.woke(thread).await,
        None,
        "Someday never wakes by itself"
    );
    let later = world.facts("thread.later").await;
    assert_eq!(later.last().unwrap().payload["someday"], json!(true));
}

#[tokio::test]
async fn a_thread_at_work_put_off_until_done_wakes_when_its_turn_ends() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "wait for me").await;
    let thread = &sent["thread"];
    world
        .until(thread, |v| {
            state(v, &sent["turn"]) == Some(TurnState::Running)
        })
        .await;
    world.later(world.person(), thread, None).await.unwrap();
    assert_eq!(world.later_of(thread).await.unwrap().until, None);
    world
        .call(
            world.person(),
            "agents.stop",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    world.until(thread, settled(1)).await;
    assert_eq!(world.woke(thread).await, Some(Wake::Done));
}

#[tokio::test]
async fn its_persons_message_or_a_failure_wakes_a_put_off_thread() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (writer, writing) = world.finish(None, "hello").await;
    let (thread, _) = world.finish(None, "hi there").await;
    let person = world.person();
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    world.send(Some(&thread), "one more thing").await;
    assert_eq!(world.woke(&thread).await, Some(Wake::Message));

    world.until(&thread, settled(2)).await;
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    assert_eq!(world.woke(&thread).await, None);
    world
        .write(agent_of(&writing), Some(&thread), "fail now")
        .await
        .unwrap();
    world.until(&thread, settled(3)).await;
    assert_eq!(world.woke(&thread).await, Some(Wake::Failure));
    assert!(world.later_of(&writer).await.is_none());
}

#[tokio::test]
async fn its_person_sees_a_thread_that_woke_by_itself_once_then_dismisses_it() {
    use banda_agents::model::WokeSeen;
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, writing) = world.finish(None, "hello").await;
    let (thread, _) = world.finish(None, "hi there").await;
    let person = world.person();
    let see = |seen: &str| json!({ "thread": thread, "seen": seen });
    let seen_of = |later: Option<banda_agents::model::Later>| later.unwrap().woke_seen;

    // Asleep, there is nothing to see.
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    world
        .call(person, "agents.see_woke", see("seen"))
        .await
        .unwrap();
    assert_eq!(seen_of(world.later_of(&thread).await), None);

    // Woken by its Person's own message, they know already.
    world.send(Some(&thread), "one more thing").await;
    world.until(&thread, settled(2)).await;
    world
        .call(person, "agents.see_woke", see("seen"))
        .await
        .unwrap();
    assert_eq!(seen_of(world.later_of(&thread).await), None);

    // Woken by a failure, it is seen, then dismissed, and never back.
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    world
        .write(agent_of(&writing), Some(&thread), "fail now")
        .await
        .unwrap();
    world.until(&thread, settled(3)).await;
    assert_eq!(world.woke(&thread).await, Some(Wake::Failure));
    let refused = world
        .call(agent_of(&writing), "agents.see_woke", see("seen"))
        .await;
    assert!(refused.is_err(), "only a Person marks a Thread");
    world
        .call(person, "agents.see_woke", see("seen"))
        .await
        .unwrap();
    assert_eq!(seen_of(world.later_of(&thread).await), Some(WokeSeen::Seen));
    world
        .call(person, "agents.see_woke", see("dismissed"))
        .await
        .unwrap();
    world
        .call(person, "agents.see_woke", see("seen"))
        .await
        .unwrap();
    assert_eq!(
        seen_of(world.later_of(&thread).await),
        Some(WokeSeen::Dismissed)
    );

    // A new Later has seen nothing of its own waking.
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    assert_eq!(seen_of(world.later_of(&thread).await), None);
}

#[tokio::test]
async fn an_agent_puts_off_only_its_own_thread() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (mine, view) = world.finish(None, "hello").await;
    let (other, _) = world.finish(None, "hi there").await;
    let agent = agent_of(&view);
    let theirs = world.later(agent, &other, Some(in_an_hour())).await;
    assert!(theirs.is_err(), "another Thread is its Person's to put off");
    world.later(agent, &mine, Some(in_an_hour())).await.unwrap();
    assert_eq!(world.later_of(&mine).await.unwrap().by, agent);
}

#[tokio::test]
async fn a_person_renames_a_thread_and_a_blank_title_brings_its_first_message_back() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello   there").await;
    world.finish(Some(&thread), "and more").await;
    assert_eq!(world.listed(&thread).await.thread.was, None);

    // One line, its spaces trimmed and collapsed.
    world
        .rename(&thread, Some("  Fix the\n list  "))
        .await
        .unwrap();
    assert_eq!(world.thread(&thread).await.thread.title, "Fix the list");
    let listed = world.listed(&thread).await;
    assert_eq!(listed.thread.title, "Fix the list");
    assert_eq!(listed.thread.was.as_deref(), Some("hello there"));
    let renamed = json!({ "thread": thread, "title": "Fix the list", "was": "hello there" });
    assert_eq!(world.renamed(&thread).await, [renamed]);

    // The title it has already writes nothing.
    world.rename(&thread, Some("Fix the list")).await.unwrap();
    assert_eq!(world.renamed(&thread).await.len(), 1);

    // None, or a blank one, gives back the first message's title.
    world.rename(&thread, None).await.unwrap();
    let listed = world.listed(&thread).await;
    assert_eq!(listed.thread.title, "hello there");
    assert_eq!(listed.thread.was.as_deref(), Some("Fix the list"));
    world.rename(&thread, Some("Again")).await.unwrap();
    world.rename(&thread, Some(" \n ")).await.unwrap();
    assert_eq!(world.thread(&thread).await.thread.title, "hello there");
    let back = json!({ "thread": thread, "title": "hello there", "was": "Again" });
    assert_eq!(world.renamed(&thread).await.last(), Some(&back));
    assert_eq!(world.renamed(&thread).await.len(), 4);

    // Up to 120 characters; a longer one is refused, not cut.
    let longest = "a".repeat(120);
    world.rename(&thread, Some(&longest)).await.unwrap();
    let refused = world
        .rename(&thread, Some(&format!("{longest}b")))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
    assert_eq!(world.listed(&thread).await.thread.title, longest);

    // Only a Person renames a Thread: not its Agent.
    let agent = Participant::Agent(world.listed(&thread).await.agent);
    let asked = json!({ "thread": thread, "title": "By the Agent" });
    let refused = world.call(agent, "agents.rename", asked).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let nowhere = json!(banda_agents::model::ThreadId::new());
    let refused = world.rename(&nowhere, Some("Hi")).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
}

#[tokio::test]
async fn a_threads_small_model_suggests_a_title_and_renames_nothing() {
    // With a small model offered, on it; with none, on the Thread's.
    for (env, said) in [
        (
            vec![("FAKE_AGENT_MINI", "1")],
            "Mode plan, model mini, brief",
        ),
        (vec![], "Mode plan, model smart, brief"),
    ] {
        let root = tempfile::tempdir().unwrap();
        let world = World::new_with(root.path(), Agents::new(harnesses_with(&env))).await;
        let (thread, _) = world.finish(None, "hello").await;
        world
            .configure(
                &thread,
                json!({ "options": { "model": "smart", "effort": "high" } }),
            )
            .await;
        // Its latest message names it.
        let (_, view) = world.finish(Some(&thread), "which settings").await;
        let before = texts(&view);

        assert_eq!(world.suggest_title(&thread).await.unwrap(), said);
        let view = world.thread(&thread).await;
        assert_eq!(view.thread.title, "hello", "it renames nothing");
        assert_eq!(texts(&view), before, "the Thread shows nothing of it");
        assert!(world.renamed(&thread).await.is_empty());
        // The Thread's own session keeps its model.
        let (_, view) = world.finish(Some(&thread), "which settings").await;
        assert_eq!(
            last_reply(&view),
            "message: Mode bypassPermissions, model smart, brief false"
        );
    }
}

#[tokio::test]
async fn a_title_is_suggested_in_a_folder_of_the_engines_not_the_projects() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "hello").await;
    // The fake writes `made.txt` in its session's folder, as asked.
    world.finish(Some(&thread), "on disk").await;
    let project = world.kernel.project(world.project).await.unwrap();
    std::fs::remove_file(project.folder().join("made.txt")).unwrap();

    let said = world.suggest_title(&thread).await.unwrap();
    assert_eq!(said, "I edited notes.md and ran a");
    assert!(project_data(root.path()).join("titles/made.txt").exists());
    assert!(!project.folder().join("made.txt").exists());

    let nowhere = json!(banda_agents::model::ThreadId::new());
    let refused = world.suggest_title(&nowhere).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
}

#[tokio::test]
async fn a_later_that_goes_on_tries_its_failed_turn_again_as_its_time_comes() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (sent, _) = failing(&world, "flaky please").await;
    let thread = &sent["thread"];
    let alone = json!({ "thread": thread, "resume": true });
    let refused = world.call(world.person(), "agents.later", alone).await;
    assert!(refused.is_err(), "it goes on at a time");
    let soon = json!({ "thread": thread, "resume": true, "until": banda_kernel::now_ms() + 300 });
    world
        .call(world.person(), "agents.later", soon)
        .await
        .unwrap();
    let view = world
        .until(thread, |v| {
            v.turns.len() == 2 && v.turns[1].state == TurnState::Done
        })
        .await;
    assert_eq!(view.turns[0].state, TurnState::Failed);
    let later = world.later_of(thread).await.unwrap();
    assert_eq!(later.resume, None, "it went on once");
    assert_eq!(
        later.woke.map(|w| w.by),
        Some(Wake::Time),
        "and its time woke it"
    );
    let (done, _) = world.finish(None, "hello").await;
    let nothing_failed =
        json!({ "thread": done, "resume": true, "until": banda_kernel::now_ms() + 60_000 });
    let refused = world
        .call(world.person(), "agents.later", nothing_failed)
        .await;
    assert!(refused.is_err(), "no failed turn to go on with");
}

/// The next piece `heard` says, in time.
async fn next_piece(heard: &mut banda_kernel::Stream) -> Value {
    tokio::time::timeout(Duration::from_secs(30), heard.recv())
        .await
        .expect("a piece in time")
        .expect("the stream goes on")
}

#[tokio::test]
async fn the_file_a_turns_tool_calls_name_is_heard_as_each_starts_and_goes_as_the_turn_ends() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let mut heard = (world.kernel)
        .stream(
            world.person(),
            "agents.touching",
            Some(world.project),
            json!({}),
        )
        .await
        .unwrap();
    assert_eq!(next_piece(&mut heard).await, json!({ "touched": [] }));

    // It reads notes.md at its line 2, as ACP names the place.
    let sent = world.send(None, "walk the files").await;
    let piece = next_piece(&mut heard).await;
    let read = &piece["touched"][0];
    assert_eq!(read["thread"], sent["thread"]);
    assert!(
        Path::new(read["path"].as_str().unwrap()).ends_with("notes.md"),
        "{read}"
    );
    assert_eq!((&read["line"], &read["kind"]), (&json!(2), &json!("read")));

    // Then it writes src/util.ts.
    world.steer(&sent["thread"], "go on").await;
    let piece = next_piece(&mut heard).await;
    let wrote = &piece["touched"][0];
    assert!(
        Path::new(wrote["path"].as_str().unwrap()).ends_with("src/util.ts"),
        "{wrote}"
    );
    assert_eq!(wrote["kind"], json!("write"));
    assert!(wrote["at"].as_i64().unwrap() >= read["at"].as_i64().unwrap());

    // Its turn ends: it works on nothing.
    world.steer(&sent["thread"], "done").await;
    assert_eq!(next_piece(&mut heard).await, json!({ "touched": [] }));
    let view = world.ended(&sent).await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Done));
}

impl World {
    /// The Project's `agents.doing`.
    async fn doing(&self) -> banda_kernel::Stream {
        let heard =
            self.kernel
                .stream(self.person(), "agents.doing", Some(self.project), json!({}));
        heard.await.unwrap()
    }
}

/// What `heard` next says `thread` does that `holds`, in time.
async fn doing_of(
    heard: &mut banda_kernel::Stream,
    thread: &Value,
    holds: impl Fn(&Value) -> bool,
) -> Value {
    loop {
        let piece = next_piece(heard).await;
        let threads = piece["threads"].as_array().unwrap();
        let found = threads.iter().find(|one| one["thread"] == *thread);
        if let Some(one) = found.filter(|one| holds(one)) {
            return one.clone();
        }
    }
}

#[tokio::test]
async fn what_a_turn_does_is_heard_as_it_changes_listed_and_gone_as_the_turn_ends() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let mut heard = world.doing().await;
    let none = json!({ "all": true, "threads": [] });
    assert_eq!(next_piece(&mut heard).await, none);

    // It reads card.ts, named by its base name.
    let sent = world.send(None, "doing read src/card.ts").await;
    let thread = &sent["thread"];
    let read = doing_of(&mut heard, thread, |one| one["doing"]["what"] == "read").await;
    assert_eq!(read["doing"]["title"], json!("card.ts"));

    // Then it runs the tests: what it does moves on, and so does when it
    // last said anything.
    world.steer(thread, "doing execute pnpm test").await;
    let runs = doing_of(&mut heard, thread, |one| one["doing"]["what"] == "execute").await;
    assert_eq!(runs["doing"]["title"], json!("pnpm test"));
    let (stepped, since) = (&runs["stepped"], &runs["doing"]["since"]);
    assert!(stepped.as_i64() > read["stepped"].as_i64(), "{runs}");
    assert!(since.as_i64() > read["doing"]["since"].as_i64(), "{runs}");

    // A window that comes now hears it at once, and the list shows it.
    let mut later = world.doing().await;
    let all = json!({ "all": true, "threads": [runs] });
    assert_eq!(next_piece(&mut later).await, all);
    let listed = serde_json::to_value(world.listed(thread).await).unwrap();
    assert_eq!(
        (&listed["doing"], &listed["stepped"]),
        (&runs["doing"], stepped)
    );

    // It replies, and its turn ends: the Thread does nothing.
    world.steer(thread, "that is all").await;
    let ended = doing_of(&mut heard, thread, |one| one.get("stepped").is_none()).await;
    assert_eq!(ended, json!({ "thread": thread }));
    let view = world.ended(&sent).await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Done));
    assert!(texts(&view).contains(&"message: Done: that is all.".to_owned()));
    let listed = serde_json::to_value(world.listed(thread).await).unwrap();
    assert!(listed.get("doing").is_none(), "{listed}");
    assert!(listed.get("stepped").is_none(), "{listed}");
}

#[tokio::test]
async fn a_turn_that_waits_on_its_usage_limit_says_until_when_and_does_not_fail() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let mut heard = world.doing().await;
    next_piece(&mut heard).await;
    let before = banda_kernel::now_ms();
    let sent = world.send(None, "limit wait").await;
    let thread = &sent["thread"];
    let waits = doing_of(&mut heard, thread, |one| one["limit_until"].is_i64()).await;
    let until = waits["limit_until"].as_i64().unwrap();
    let hour = 3_600_000;
    assert!(until >= before - 1000 + hour, "an hour on: {waits}");
    assert!(
        until <= banda_kernel::now_ms() + hour,
        "an hour on: {waits}"
    );

    // A message goes into it, and it goes on to the end of its turn.
    world.steer(thread, "go on").await;
    let ended = doing_of(&mut heard, thread, |one| one.get("stepped").is_none()).await;
    assert_eq!(ended, json!({ "thread": thread }));
    let view = world.ended(&sent).await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Done));
}

/// The fake agent as two accounts of Claude Code, `claude-a` and
/// `claude-b`, which share their sessions, and one of another Harness.
#[cfg(unix)]
fn two_claude_accounts(cli: &Path) -> Agents {
    let entry = |id: &str, cli: Option<Cli>| Harness {
        id: id.into(),
        name: id.into(),
        short: None,
        command: fake_agent().display().to_string(),
        enabled: true,
        retired: None,
        args: Vec::new(),
        env: Default::default(),
        cli,
        of: None,
        kind: Default::default(),
        mark: None,
        icon: None,
        colour: None,
        shadows: None,
        carried: None,
        record: None,
        cwd: None,
        holes: Holes::default(),
        credentials: Default::default(),
    };
    let claude = || {
        Some(Cli {
            program: cli.display().to_string(),
            variable: "CLAUDE_CODE_EXECUTABLE".to_owned(),
            minimum: None,
        })
    };
    Agents::new(Harnesses::new(vec![
        entry("claude-a", claude()),
        entry("claude-b", claude()),
        entry("other", None),
    ]))
}

// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn a_thread_moves_to_another_account_and_keeps_its_session() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let world = World::new_on(root.path(), two_claude_accounts(&cli), "claude-a").await;
    let (thread, (session, on_a)) = ask_session(&world, None).await;
    let switch = |harness: &str| {
        let params = json!({ "thread": thread, "harness": harness });
        world.call(world.person(), "agents.switch", params)
    };

    switch("claude-b").await.unwrap();
    assert_eq!(world.thread(&thread).await.thread.harness, "claude-b");
    let (_, (again, on_b)) = ask_session(&world, Some(&thread)).await;
    assert_ne!(on_a, on_b, "another account's process");
    assert_eq!(session, again, "the same session");

    // Back on the first account, whose process still runs: it lets go of
    // what it knew, and goes on with the session as it is now.
    switch("claude-a").await.unwrap();
    let (_, (back, _)) = ask_session(&world, Some(&thread)).await;
    assert_eq!(session, back);
    switch("claude-a").await.unwrap();
    let switched = world.events_of(&thread, "thread.switched").await;
    let moves: Vec<_> = switched
        .iter()
        .map(|e| (e["was"].as_str().unwrap(), e["harness"].as_str().unwrap()))
        .collect();
    assert_eq!(
        moves,
        [("claude-a", "claude-b"), ("claude-b", "claude-a")],
        "the same account again writes nothing"
    );

    let params = json!({ "thread": thread, "harness": "claude-b" });
    let by_agent = world.call(world.agent(), "agents.switch", params).await;
    assert!(by_agent.is_err(), "only a Person moves a Thread");
    assert!(switch("gone").await.is_err(), "an entry the list has not");
}

/// Asks `thread`'s Agent what it read, and the reply: the prompt as it
/// came, after the session's ID.
#[cfg(unix)]
async fn ask_read(world: &World, thread: &Value) -> (String, String) {
    let sent = world.send(Some(thread), "what did you read").await;
    let view = world
        .until(thread, |v| state(v, &sent["turn"]) == Some(TurnState::Done))
        .await;
    let reply = texts(&view)
        .into_iter()
        .rev()
        .find_map(|t| t.strip_prefix("message: Session ").map(str::to_owned))
        .expect("the agent said what it read");
    let (session, read) = reply.split_once(" read: ").unwrap();
    (session.to_owned(), read.to_owned())
}

// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn a_thread_moves_to_another_harness_with_its_history_and_back_to_its_own_session() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let world = World::new_on(root.path(), two_claude_accounts(&cli), "claude-a").await;
    let (thread, (on_claude, _)) = ask_session(&world, None).await;
    let switch = |harness: &str| {
        let params = json!({ "thread": thread, "harness": harness });
        world.call(world.person(), "agents.switch", params)
    };

    // To another Harness: a session of its own, which reads the history.
    switch("other").await.unwrap();
    let (on_other, read) = ask_read(&world, &thread).await;
    assert_ne!(on_other, on_claude, "a session of its own");
    assert!(read.contains("ran on claude-a until now"), "{read}");
    assert!(read.contains("[Person] which session\n"), "{read}");
    assert!(
        read.contains(&format!("[Agent] Session {on_claude}")),
        "{read}"
    );
    assert!(read.ends_with("</history>\n\nwhat did you read"), "{read}");
    // Its next turn goes on in that session, and reads nothing more.
    let (again, read) = ask_read(&world, &thread).await;
    assert_eq!(again, on_other);
    assert_eq!(read, "what did you read");

    // Back: Claude Code goes on with its own session, and reads only what
    // it missed.
    switch("claude-b").await.unwrap();
    let (back, read) = ask_read(&world, &thread).await;
    assert_eq!(back, on_claude, "its own session again");
    assert!(read.contains("ran on other since your last turn"), "{read}");
    // The two turns on the other Harness, and nothing from before them.
    assert!(
        read.contains("<missed>\n[Person] what did you read\n"),
        "only what it missed: {read}"
    );

    let view = world.thread(&thread).await;
    let moved: Vec<_> = texts(&view)
        .into_iter()
        .filter(|text| text.starts_with("moved: "))
        .collect();
    assert_eq!(moved.len(), 2, "{moved:?}");
    assert!(
        moved[0].starts_with("moved: claude-a → other Handoff"),
        "{moved:?}"
    );
    assert!(
        moved[1].starts_with("moved: other → claude-b Back"),
        "{moved:?}"
    );
}

// A failed first request must not consume the history the new Harness
// has not read yet.
#[cfg(unix)]
#[tokio::test]
async fn a_handoff_keeps_its_history_until_a_prompt_succeeds() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let world = World::new_on(root.path(), two_claude_accounts(&cli), "claude-a").await;
    let (thread, _) = ask_session(&world, None).await;
    world
        .call(
            world.person(),
            "agents.switch",
            json!({ "thread": thread, "harness": "other" }),
        )
        .await
        .unwrap();
    let sent = world.send(Some(&thread), "flaky what did you read").await;
    let view = world.ended(&sent).await;
    assert_eq!(state(&view, &sent["turn"]), Some(TurnState::Failed));
    let retry = world
        .call(
            world.person(),
            "agents.retry",
            json!({ "turn": sent["turn"] }),
        )
        .await
        .unwrap();
    let view = world
        .until(&thread, |v| {
            matches!(
                state(v, &retry["turn"]),
                Some(TurnState::Done | TurnState::Failed)
            )
        })
        .await;
    assert_eq!(
        state(&view, &retry["turn"]),
        Some(TurnState::Done),
        "the same prompt, including its history, is tried again"
    );
    assert!(last_reply(&view).contains("[Person] which session"));
    let (_, read) = ask_read(&world, &thread).await;
    assert_eq!(
        read, "what did you read",
        "a successful handoff is sent only once"
    );
}

// Slash commands retain their meaning and leave the history for a
// message that the new Harness actually reads.
#[cfg(unix)]
#[tokio::test]
async fn a_handoff_waits_through_a_slash_command() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let world = World::new_on(root.path(), two_claude_accounts(&cli), "claude-a").await;
    let (thread, _) = ask_session(&world, None).await;
    world
        .call(
            world.person(),
            "agents.switch",
            json!({ "thread": thread, "harness": "other" }),
        )
        .await
        .unwrap();
    let (_, view) = world.finish(Some(&thread), "/compact").await;
    assert_eq!(last_reply(&view), "message: You said: /compact");
    let (_, read) = ask_read(&world, &thread).await;
    assert!(read.contains("[Person] which session"), "{read}");
    let view = world.thread(&thread).await;
    assert_eq!(
        texts(&view)
            .iter()
            .filter(|text| text.starts_with("moved:"))
            .count(),
        1,
        "one divider per move"
    );
}

/// Two accounts of Codex, the fake agent each: `codex`, whose home is
/// `codex` under `root`, and `work`, which signs in in `work` and shadows
/// it (ADR 0078, decision 3).
#[cfg(unix)]
fn two_codex_accounts(root: &Path, cli: &Path) -> Agents {
    let entry = |id: &str, of: Option<&str>, home: &str| Harness {
        id: id.into(),
        name: id.into(),
        cli: Some(Cli {
            program: cli.display().to_string(),
            variable: "CODEX_PATH".to_owned(),
            minimum: None,
        }),
        of: of.map(Into::into),
        shadows: of.map(|_| root.join("codex")),
        ..fake_with(&[("CODEX_HOME", &root.join(home).display().to_string())])
    };
    Agents::new(Harnesses::new(vec![
        entry("codex", None, "codex"),
        entry("work", Some("codex"), "work"),
    ]))
}

// Its CLI is a `sh` script that runs by its exec bit.
#[cfg(unix)]
#[tokio::test]
async fn a_codex_thread_moves_to_another_account_and_forgets_only_its_reasoning() {
    let (root, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let cli = fake_cli(bin.path());
    let agents = two_codex_accounts(root.path(), &cli);
    let world = World::new_on(root.path(), agents, "codex").await;
    let (thread, (session, on_codex)) = ask_session(&world, None).await;
    // Codex's rollout of the session, as the first account wrote it.
    let day = root.path().join("codex/sessions/2026/11/09");
    std::fs::create_dir_all(&day).unwrap();
    let rollout = day.join(format!("rollout-2026-11-09T10-00-00-{session}.jsonl"));
    let said = r#"{"type":"response_item","payload":{"type":"message"}}"#;
    let sealed =
        r#"{"type":"response_item","payload":{"type":"reasoning","encrypted_content":"x"}}"#;
    std::fs::write(&rollout, format!("{said}\n{sealed}\n")).unwrap();
    let switch = |harness: &str| {
        let params = json!({ "thread": thread, "harness": harness });
        world.call(world.person(), "agents.switch", params)
    };

    switch("work").await.unwrap();
    let (_, (again, on_work)) = ask_session(&world, Some(&thread)).await;
    assert_ne!(on_codex, on_work, "another account's process");
    assert_eq!(session, again, "the same session");
    let sessions = std::fs::read_link(root.path().join("work/sessions")).unwrap();
    assert_eq!(
        sessions,
        root.path().join("codex/sessions"),
        "a shadow home"
    );
    let left = std::fs::read_to_string(&rollout).unwrap();
    assert_eq!(
        left,
        format!("{said}\n"),
        "the first account's reasoning is gone"
    );

    // A turn on the account it is on keeps what that account wrote.
    std::fs::write(&rollout, format!("{said}\n{sealed}\n")).unwrap();
    ask_session(&world, Some(&thread)).await;
    assert!(
        std::fs::read_to_string(&rollout)
            .unwrap()
            .contains("reasoning")
    );
}

/// Banda's own Claude Code entry, with the adapters the engine found on
/// its host and a Node to run them on (ADR 0059; ADR 0062, step S1): a
/// Thread's process is the carried adapter on that Node, told where the
/// Project keeps Claude Code's sessions, which the shim in it reads (ADR
/// 0078, decision 3).
// Its Node is a `sh` script.
#[cfg(unix)]
#[tokio::test]
async fn a_threads_process_runs_the_carried_adapter_on_the_node_found_with_the_projects_sessions() {
    use banda_harnesses::carried::{Carried, Node};
    let root = tempfile::tempdir().unwrap();
    let adapters = root.path().join("adapters");
    std::fs::create_dir(&adapters).unwrap();
    // A stand-in of the Node the engine found: it writes how it was
    // started, then runs the fake agent in the adapter's place.
    let (node, told) = (root.path().join("node"), root.path().join("told"));
    let script = format!(
        "#!/bin/sh\nprintf '%s|%s|%s\\n' \"$1\" \"$BANDA_CLAUDE_SESSIONS\" \"$ELECTRON_RUN_AS_NODE\" >> '{}'\nexec '{}'\n",
        told.display(),
        fake_agent().display()
    );
    std::fs::write(&node, script).unwrap();
    std::fs::set_permissions(&node, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let claude = Harness {
        id: "claude".into(),
        name: "Claude Code".into(),
        short: None,
        command: "npx".into(),
        enabled: true,
        retired: None,
        args: Vec::new(),
        env: Default::default(),
        cli: None,
        of: None,
        kind: Default::default(),
        mark: None,
        icon: None,
        colour: None,
        shadows: None,
        carried: Some("claude-agent-acp.mjs".into()),
        record: None,
        cwd: None,
        holes: Holes::default(),
        credentials: Default::default(),
    };
    let harnesses = Harnesses::new(vec![claude]);
    harnesses.carry(Some(Carried {
        adapters: adapters.clone(),
        node: Node {
            program: node,
            electron: false,
        },
    }));
    let world = World::new_on(root.path(), Agents::new(harnesses), "claude").await;
    ask_session(&world, None).await;

    let told = std::fs::read_to_string(&told).unwrap();
    let file = adapters.join("claude-agent-acp.mjs").display().to_string();
    let sessions = project_data(root.path()).join("sessions").join("claude");
    let thread = format!("{file}|{}|", sessions.display());
    assert!(told.lines().any(|line| line == thread), "{told}");
    assert!(
        told.lines()
            .all(|line| line.starts_with(&format!("{file}|"))),
        "every start runs the carried adapter: {told}"
    );
}

impl World {
    /// The payloads of `thread`'s facts of `kind`, the first first.
    async fn events_of(&self, thread: &Value, kind: &str) -> Vec<Value> {
        let events = self.facts(kind).await.into_iter();
        let of = events.filter(|event| event.subject.as_deref() == thread.as_str());
        of.map(|event| event.payload).collect()
    }
}

#[tokio::test]
async fn an_agent_puts_off_its_own_thread_for_a_while() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (mine, view) = world.finish(None, "hello").await;
    let agent = agent_of(&view);
    let before = banda_kernel::now_ms();
    world
        .call(agent, "agents.later", json!({ "after": "30m" }))
        .await
        .unwrap();
    let later = world.later_of(&mine).await.unwrap();
    let until = later.until.unwrap();
    assert!(
        (before + 1_800_000..before + 1_810_000).contains(&until),
        "{until}"
    );
    assert_eq!(later.by, agent);
    let put_off = |who, params| world.call(who, "agents.later", params);
    let refused = put_off(world.person(), json!({ "after": "30m" })).await;
    assert!(refused.is_err(), "a Person names the Thread");
    let refused = put_off(agent, json!({ "after": "soon" })).await;
    assert!(refused.is_err(), "no while it reads");
    let both = json!({ "after": "2h", "until": until });
    assert!(
        put_off(agent, both).await.is_err(),
        "after or until, not both"
    );
    // A year at most, and only the field's numbers: none overflows.
    for after in ["inf h", "1e300 d", "99999999999999999999d", "366d"] {
        let refused = put_off(agent, json!({ "after": after })).await.unwrap_err();
        assert_eq!(refused.code, Code::Invalid, "{after}");
    }
    let past_a_year = banda_kernel::now_ms() + 400 * 86_400_000;
    for until in [past_a_year, i64::MAX] {
        let refused = put_off(agent, json!({ "until": until })).await.unwrap_err();
        assert_eq!(refused.code, Code::Invalid, "{until}");
    }
    // It starts no turn: going on by itself is its Person's alone.
    let resume = json!({ "after": "2h", "resume": true });
    let refused = put_off(agent, resume).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden, "{refused:?}");
    assert_eq!(world.later_of(&mine).await.unwrap().until, Some(until));
    // Its own, by default, it wakes too.
    world.call(agent, "agents.wake", json!({})).await.unwrap();
    let woke = world.later_of(&mine).await.unwrap().woke;
    assert_eq!(woke.map(|w| w.by), Some(Wake::Woken));
    let refused = world.call(world.person(), "agents.wake", json!({})).await;
    assert_eq!(
        refused.unwrap_err().code,
        Code::Invalid,
        "a Person names it"
    );
}

#[tokio::test]
async fn an_agent_leaves_its_persons_later_that_goes_on_alone() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "hello").await;
    let agent = agent_of(&view);
    let sent = world.send(Some(&thread), "flaky please").await;
    let failed = |v: &ThreadView| state(v, &sent["turn"]) == Some(TurnState::Failed);
    world.until(&thread, failed).await;
    let thread = &thread;
    let until = in_an_hour();
    let goes_on = json!({ "thread": thread, "resume": true, "until": until });
    world
        .call(world.person(), "agents.later", goes_on)
        .await
        .unwrap();

    // Put off again or woken, it would not go on: that is its Person's.
    for (method, params) in [
        ("agents.later", json!({ "after": "5m" })),
        ("agents.wake", json!({})),
    ] {
        let refused = world.call(agent, method, params).await.unwrap_err();
        assert_eq!(refused.code, Code::Forbidden, "{method}: {refused:?}");
    }
    let later = world.later_of(thread).await.unwrap();
    assert_eq!((later.until, later.woke), (Some(until), None));
    assert!(later.resume.is_some(), "it still goes on");

    // Woken by its Person, it goes on no more, and is the Agent's again.
    world
        .call(world.person(), "agents.wake", json!({ "thread": thread }))
        .await
        .unwrap();
    let again = json!({ "after": "5m" });
    world.call(agent, "agents.later", again).await.unwrap();
    assert_eq!(world.later_of(thread).await.unwrap().by, agent);
}

impl World {
    /// `who` archives `thread`, or brings it back.
    async fn archive(
        &self,
        who: Participant,
        thread: &Value,
        archived: bool,
    ) -> Result<Value, banda_kernel::Refusal> {
        let method = if archived {
            "agents.archive"
        } else {
            "agents.unarchive"
        };
        self.call(who, method, json!({ "thread": thread })).await
    }

    /// The Project's facts of `kind`, of any Thread or of none, the first
    /// first.
    async fn facts(&self, kind: &str) -> Vec<banda_kernel::Event> {
        let filter = EventFilter {
            module: Some("agents".to_owned()),
            subject: None,
            kinds: Some(vec![kind.to_owned()]),
        };
        let project = self.kernel.project(self.project).await.unwrap();
        project.events_after(0, filter, usize::MAX).await.unwrap()
    }

    /// When `thread` last changed, as the list says.
    async fn changed(&self, thread: &Value) -> i64 {
        self.listed(thread).await.thread.updated_at
    }

    /// When each Thread last changed, as the list says.
    async fn every_changed(&self) -> BTreeMap<String, i64> {
        let list = self.threads().await.threads;
        let each = list.iter();
        let each = each.map(|t| (t.thread.id.to_string(), t.thread.updated_at));
        each.collect()
    }
}

/// Waits into the next millisecond, so what happens next is later than
/// what happened before by the engine's clock.
async fn a_moment() {
    tokio::time::sleep(Duration::from_millis(2)).await;
}

#[tokio::test]
async fn a_person_archives_a_thread_and_brings_it_back_and_nothing_moves_in_the_list() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "hello").await;
    let (later, _) = world.finish(None, "hi there").await;
    let person = world.person();
    let changed = world.changed(&thread).await;
    let order = |list: ThreadList| list.threads.iter().map(|t| t.thread.id).collect::<Vec<_>>();
    let before = order(world.threads().await);

    world.archive(person, &thread, true).await.unwrap();
    let listed = world.listed(&thread).await;
    let at = listed.archived.expect("the list says it is archived").at;
    assert!(at >= changed);
    assert!(listed.is_archived());
    assert_eq!(listed.thread.updated_at, changed, "a mark moves nothing");
    assert_eq!(order(world.threads().await), before);
    let archived = world.facts("thread.archived").await;
    assert_eq!(archived.len(), 1);
    // Its `at` is the event's own, the host's time.
    assert_eq!(archived[0].payload, json!({ "thread": thread }));
    assert_eq!((archived[0].at, archived[0].author), (at, person));
    assert!(!world.listed(&later).await.is_archived());
    // An Agent reads it in its `threads`, as the window does.
    let agent = agent_of(&view);
    let seen = world
        .call(agent, "agents.threads", json!({}))
        .await
        .unwrap();
    let theirs = seen["threads"].as_array().unwrap();
    let theirs = theirs.iter().find(|t| t["id"] == thread).unwrap();
    assert_eq!(theirs["archived"], json!({ "at": at }));

    // Archived already, with nothing new since, it writes nothing.
    world.archive(person, &thread, true).await.unwrap();
    assert_eq!(world.listed(&thread).await.archived.unwrap().at, at);
    assert_eq!(world.facts("thread.archived").await.len(), 1);

    // Only a Person archives a Thread or brings it back.
    for archived in [true, false] {
        let refused = world.archive(agent, &thread, archived).await.unwrap_err();
        assert_eq!(refused.code, Code::Forbidden, "{refused:?}");
    }
    assert!(world.listed(&thread).await.is_archived());
    let nowhere = json!(banda_agents::model::ThreadId::new());
    let refused = world.archive(person, &nowhere, true).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);

    world.archive(person, &thread, false).await.unwrap();
    let listed = world.listed(&thread).await;
    assert_eq!((listed.archived, listed.is_archived()), (None, false));
    assert_eq!(listed.thread.updated_at, changed);
    let back = world.facts("thread.unarchived").await;
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].payload, json!({ "thread": thread }));
    // Back already, it stays so, and nothing is written.
    world.archive(person, &thread, false).await.unwrap();
    assert_eq!(world.facts("thread.unarchived").await.len(), 1);
    assert_eq!(order(world.threads().await), before);
}

#[tokio::test]
async fn a_thread_at_work_or_that_asks_cannot_be_archived() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let asks = world.send(None, "please ask first").await;
    world.until(&asks["thread"], asking).await;
    let refused = world.archive(person, &asks["thread"], true).await;
    assert_eq!(refused.unwrap_err().code, Code::Conflict);

    let works = world.send(None, "wait for me").await;
    let thread = &works["thread"];
    world
        .until(thread, |v| {
            state(v, &works["turn"]) == Some(TurnState::Running)
        })
        .await;
    let refused = world.archive(person, thread, true).await;
    assert_eq!(refused.unwrap_err().code, Code::Conflict);
    assert!(world.listed(thread).await.archived.is_none());
    assert!(world.facts("thread.archived").await.is_empty());
}

#[tokio::test]
async fn archiving_wakes_a_put_off_thread_and_a_later_takes_it_out_of_archive() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, view) = world.finish(None, "hello").await;
    let person = world.person();
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    world.archive(person, &thread, true).await.unwrap();
    assert_eq!(world.woke(&thread).await, Some(Wake::Woken));
    assert!(world.listed(&thread).await.is_archived());
    // It woke, then was archived, in the one command.
    let woke = world.facts("thread.woke").await;
    let archived = world.facts("thread.archived").await;
    assert_eq!(woke[0].seq + 1, archived[0].seq);

    // Put off again, it leaves Archive, whoever puts it off.
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    let listed = world.listed(&thread).await;
    assert_eq!(listed.archived, None);
    assert_eq!(world.woke(&thread).await, None, "it sleeps");
    let back = world.facts("thread.unarchived").await;
    assert_eq!((back.len(), back[0].author), (1, person));
    world.archive(person, &thread, true).await.unwrap();
    let agent = agent_of(&view);
    world
        .later(agent, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    assert_eq!(world.listed(&thread).await.archived, None);
    let back = world.facts("thread.unarchived").await;
    assert_eq!((back.len(), back[1].author), (2, agent));
    // A Later of a Thread not archived writes no such fact.
    world
        .later(person, &thread, Some(in_an_hour()))
        .await
        .unwrap();
    assert_eq!(world.facts("thread.unarchived").await.len(), 2);
}

#[tokio::test]
async fn anything_new_after_the_archive_brings_the_thread_back() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "remember apples").await;
    let person = world.person();
    world.archive(person, &thread, true).await.unwrap();
    let at = world.listed(&thread).await.archived.unwrap().at;

    // A new turn: the mark stays, but no longer holds.
    a_moment().await;
    let (_, view) = world.finish(Some(&thread), "remember pears").await;
    let listed = world.listed(&thread).await;
    assert_eq!(listed.archived.map(|a| a.at), Some(at));
    assert!(listed.thread.updated_at > at);
    assert!(!listed.is_archived());

    // Archived again, it is archived from now.
    world.archive(person, &thread, true).await.unwrap();
    let listed = world.listed(&thread).await;
    assert!(listed.archived.unwrap().at > at && listed.is_archived());
    assert_eq!(world.facts("thread.archived").await.len(), 2);

    // Taken back to before a message, it changes nothing a list orders
    // by, so it stays archived; the message sent again brings it back.
    let pears = view.turns[1].id;
    world
        .call(person, "agents.rewind", json!({ "turn": pears }))
        .await
        .unwrap();
    assert!(world.listed(&thread).await.is_archived());
    a_moment().await;
    let sent = world.send(Some(&thread), "remember plums").await;
    assert!(!world.listed(&thread).await.is_archived());
    world.ended(&sent).await;
    assert!(!world.listed(&thread).await.is_archived());
}

#[tokio::test]
async fn a_window_moves_the_archives_it_kept_to_the_host_once() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (kept, view) = world.finish(None, "hello").await;
    let (marked, _) = world.finish(None, "hello again").await;
    let (sleeps, _) = world.finish(None, "good night").await;
    world.archive(person, &marked, true).await.unwrap();
    let marked_at = world.listed(&marked).await.archived.unwrap().at;
    world
        .later(person, &sleeps, Some(in_an_hour()))
        .await
        .unwrap();
    let changed = world.every_changed().await;
    let nowhere = json!(banda_agents::model::ThreadId::new());
    // By ID only: the host stamps the moment (ADR 0096, decision 7).
    let marks = json!({ "archived": [
        // Moved, archived from now.
        kept,
        // The host's own mark stays.
        marked,
        // A Thread it does not know.
        nowhere,
        // One that sleeps.
        sleeps,
        // The same one twice.
        kept,
    ] });

    // Only a Person moves them.
    let agent = agent_of(&view);
    let call = |who| world.call(who, "agents.import_marks", marks.clone());
    assert_eq!(call(agent).await.unwrap_err().code, Code::Forbidden);
    assert_eq!(world.listed(&kept).await.archived, None);

    a_moment().await;
    let before = banda_kernel::now_ms();
    assert_eq!(call(person).await.unwrap(), json!({ "count": 1 }));
    let after = banda_kernel::now_ms();
    let listed = world.listed(&kept).await;
    let at = listed.archived.unwrap().at;
    assert!((before..=after).contains(&at), "{at}");
    assert!(listed.is_archived());
    assert_eq!(world.listed(&marked).await.archived.unwrap().at, marked_at);
    assert_eq!(world.listed(&sleeps).await.archived, None);
    assert_eq!(world.every_changed().await, changed, "nothing moved");

    // One fact, of no one Thread, says marks moved; the list reads again.
    let moved = world.facts("marks.moved").await;
    assert_eq!(moved.len(), 1);
    assert_eq!(
        (&moved[0].payload, &moved[0].subject, moved[0].at),
        (&json!({}), &None, at)
    );
    assert_eq!(
        world.facts("thread.archived").await.len(),
        1,
        "the one by hand"
    );

    // Moved again, nothing moves, and nothing is said.
    assert_eq!(call(person).await.unwrap(), json!({ "count": 0 }));
    let nothing = world.call(person, "agents.import_marks", json!({})).await;
    assert_eq!(nothing.unwrap(), json!({ "count": 0 }));
    assert_eq!(world.facts("marks.moved").await.len(), 1);
}

#[tokio::test]
async fn an_import_leaves_a_thread_at_work_or_that_asks() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let asks = world.send(None, "please ask first").await;
    world.until(&asks["thread"], asking).await;
    let works = world.send(None, "wait for me").await;
    world
        .until(&works["thread"], |v| {
            state(v, &works["turn"]) == Some(TurnState::Running)
        })
        .await;

    let marks = json!({ "archived": [asks["thread"], works["thread"]] });
    let moved = world.call(person, "agents.import_marks", marks).await;
    assert_eq!(moved.unwrap(), json!({ "count": 0 }));
    assert_eq!(world.listed(&asks["thread"]).await.archived, None);
    assert_eq!(world.listed(&works["thread"]).await.archived, None);
    assert!(world.facts("marks.moved").await.is_empty());
}

#[tokio::test]
async fn an_import_too_big_or_with_marks_this_host_does_not_know_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (thread, _) = world.finish(None, "hello").await;

    // At most 10,000 marks at once, as many as a window kept.
    let mut many = vec![thread.clone()];
    many.extend((0..10_000).map(|_| json!(banda_agents::model::ThreadId::new())));
    let marks = json!({ "archived": many });
    let refused = world.call(person, "agents.import_marks", marks).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
    many.pop();
    let marks = json!({ "archived": many });
    let moved = world.call(person, "agents.import_marks", marks).await;
    assert_eq!(moved.unwrap(), json!({ "count": 1 }));

    // As many seen marks again, which a window keeps fewer of.
    let seen = (0..=10_000).map(|_| {
        let thread = banda_agents::model::ThreadId::new().to_string();
        (thread, json!(TurnId::new()))
    });
    let marks = json!({ "seen": seen.collect::<serde_json::Map<_, _>>() });
    let refused = world.call(person, "agents.import_marks", marks).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);

    // A newer window's marks are refused, not dropped unread (ADR 0096,
    // decision 8), so that window keeps them to send again.
    let (other, _) = world.finish(None, "hi there").await;
    let marks = json!({ "archived": [other], "pinned": [] });
    let refused = world.call(person, "agents.import_marks", marks).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
    assert_eq!(world.listed(&other).await.archived, None);
}

impl World {
    /// `who` marks `thread` read: `turn` seen, or without it, its latest
    /// that ended.
    async fn read(
        &self,
        who: Participant,
        thread: &Value,
        turn: Option<&Value>,
    ) -> Result<Value, banda_kernel::Refusal> {
        let mut ask = json!({ "thread": thread });
        if let Some(turn) = turn {
            ask["turn"] = turn.clone();
        }
        self.call(who, "agents.read", ask).await
    }

    /// `who` marks `thread` unread.
    async fn unread(
        &self,
        who: Participant,
        thread: &Value,
    ) -> Result<Value, banda_kernel::Refusal> {
        self.call(who, "agents.unread", json!({ "thread": thread }))
            .await
    }

    /// The turn of `thread` its Person saw last, as the list says.
    async fn seen(&self, thread: &Value) -> Option<Value> {
        self.listed(thread).await.seen.map(|turn| json!(turn))
    }

    /// The turn at `index` of `thread`, the first first.
    async fn turn_at(&self, thread: &Value, index: usize) -> Value {
        json!(self.thread(thread).await.turns[index].id)
    }

    /// A window moves the marks it kept: `seen`, each Thread's turn, and
    /// `archived`. Says how many moved.
    async fn import(&self, seen: &[(&Value, &Value)], archived: &[&Value]) -> Value {
        let seen = seen.iter().map(|(thread, turn)| {
            let thread = thread.as_str().unwrap().to_owned();
            (thread, (*turn).clone())
        });
        let seen = seen.collect::<serde_json::Map<_, _>>();
        let marks = json!({ "seen": seen, "archived": archived });
        let moved = self.call(self.person(), "agents.import_marks", marks);
        moved.await.unwrap()["count"].clone()
    }
}

#[tokio::test]
async fn a_person_marks_a_thread_read_forward_only_and_nothing_moves_in_the_list() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (thread, _) = world.finish(None, "hello").await;
    let (_, view) = world.finish(Some(&thread), "hello again").await;
    let (first, second) = (json!(view.turns[0].id), json!(view.turns[1].id));
    let (other, _) = world.finish(None, "hi there").await;
    let changed = world.changed(&thread).await;
    let order = |list: ThreadList| list.threads.iter().map(|t| t.thread.id).collect::<Vec<_>>();
    let before = order(world.threads().await);
    assert_eq!(world.seen(&thread).await, None, "none seen yet");

    world.read(person, &thread, Some(&first)).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(first.clone()));
    let seen = world.facts("thread.seen").await;
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].payload, json!({ "thread": thread, "turn": first }));
    assert_eq!(seen[0].author, person);
    world.read(person, &thread, Some(&second)).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(second.clone()));

    // The turn it holds, an older one, one of another Thread and one that
    // is no turn at all change nothing, and nothing is written.
    let elsewhere = world.turn_at(&other, 0).await;
    let nowhere = json!(TurnId::new());
    for turn in [&second, &first, &elsewhere, &nowhere] {
        world.read(person, &thread, Some(turn)).await.unwrap();
    }
    assert_eq!(world.seen(&thread).await, Some(second.clone()));
    assert_eq!(world.seen(&other).await, None);
    assert_eq!(world.facts("thread.seen").await.len(), 2);
    assert_eq!(
        world.changed(&thread).await,
        changed,
        "a mark moves nothing"
    );
    assert_eq!(order(world.threads().await), before);

    // An Agent reads it in its `threads`, as the window does.
    let agent = agent_of(&view);
    let listed = world.call(agent, "agents.threads", json!({})).await;
    let listed = listed.unwrap();
    let theirs = listed["threads"].as_array().unwrap();
    let theirs = theirs.iter().find(|t| t["id"] == thread).unwrap();
    assert_eq!(theirs["seen"], second);

    // Only a Person marks a Thread read or unread.
    let refused = world.read(agent, &thread, None).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden, "{refused:?}");
    let refused = world.unread(agent, &thread).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden, "{refused:?}");
    assert_eq!(world.seen(&thread).await, Some(second.clone()));
    let no_thread = json!(banda_agents::model::ThreadId::new());
    let refused = world.read(person, &no_thread, None).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    let refused = world.unread(person, &no_thread).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);

    // Unread, it has none; unread again, nothing is written.
    world.unread(person, &thread).await.unwrap();
    assert_eq!(world.seen(&thread).await, None);
    let unseen = world.facts("thread.unseen").await;
    assert_eq!(unseen.len(), 1);
    assert_eq!(unseen[0].payload, json!({ "thread": thread }));
    world.unread(person, &thread).await.unwrap();
    assert_eq!(world.facts("thread.unseen").await.len(), 1);
    assert_eq!(world.changed(&thread).await, changed);

    // Read with no turn, its latest that ended is seen.
    world.read(person, &thread, None).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(second));
    assert_eq!(order(world.threads().await), before);
}

#[tokio::test]
async fn a_turn_that_has_not_ended_is_never_seen() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let works = world.send(None, "wait for me").await;
    let thread = &works["thread"];
    world
        .until(thread, |v| {
            state(v, &works["turn"]) == Some(TurnState::Running)
        })
        .await;
    world
        .read(person, thread, Some(&works["turn"]))
        .await
        .unwrap();
    // Read with no turn, it has none that ended to see.
    world.read(person, thread, None).await.unwrap();
    assert_eq!(world.seen(thread).await, None);
    assert!(world.facts("thread.seen").await.is_empty());

    // With a later turn running, read with no turn sees the latest that
    // ended, not the running one.
    let (ended, _) = world.finish(None, "hello").await;
    let first = world.turn_at(&ended, 0).await;
    world.waiting(Some(&ended)).await;
    world.read(person, &ended, None).await.unwrap();
    assert_eq!(world.seen(&ended).await, Some(first));
}

#[tokio::test]
async fn a_rewind_that_takes_the_seen_turn_out_clears_it() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (thread, _) = world.finish(None, "remember apples").await;
    world.finish(Some(&thread), "remember pears").await;
    let (apples, pears) = (
        world.turn_at(&thread, 0).await,
        world.turn_at(&thread, 1).await,
    );
    let rewind = |turn: &Value| world.call(person, "agents.rewind", json!({ "turn": turn }));

    // A rewind after the seen turn leaves it seen.
    world.read(person, &thread, Some(&apples)).await.unwrap();
    rewind(&pears).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(apples.clone()));

    // One that takes it out, with every turn after, clears it.
    world.finish(Some(&thread), "remember plums").await;
    world.finish(Some(&thread), "remember figs").await;
    let (plums, figs) = (
        world.turn_at(&thread, 1).await,
        world.turn_at(&thread, 2).await,
    );
    world.read(person, &thread, None).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(figs));
    rewind(&plums).await.unwrap();
    assert_eq!(world.seen(&thread).await, None);
    // A list reads itself again after a rewind: no fact of its own.
    assert!(world.facts("thread.unseen").await.is_empty());
    // It moves again from none.
    world.read(person, &thread, Some(&apples)).await.unwrap();
    assert_eq!(world.seen(&thread).await, Some(apples));
}

#[tokio::test]
async fn a_window_moves_the_turns_it_saw_to_the_host_forward_only() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (fresh, _) = world.finish(None, "hello").await;
    world.finish(Some(&fresh), "hello again").await;
    let (first, second) = (
        world.turn_at(&fresh, 0).await,
        world.turn_at(&fresh, 1).await,
    );
    let (ahead, view) = world.finish(None, "hi").await;
    world.finish(Some(&ahead), "hi again").await;
    let behind = world.turn_at(&ahead, 0).await;
    world.read(person, &ahead, None).await.unwrap();
    let theirs = world.seen(&ahead).await;
    let (stranger, _) = world.finish(None, "who are you").await;
    // Its "Waiting." is in before the list is taken, so no reply moves it.
    let works = world.waiting(None).await;
    let nowhere = json!(banda_agents::model::ThreadId::new());
    let changed = world.every_changed().await;
    let seen = [
        // Moved: the host saw none.
        (&fresh, &first),
        // The host's later seen stays.
        (&ahead, &behind),
        // Another Thread's turn.
        (&stranger, &first),
        // A turn that has not ended.
        (&works["thread"], &works["turn"]),
        // A Thread the host does not know.
        (&nowhere, &first),
    ];

    // Only a Person moves them.
    let marks = json!({ "seen": { fresh.as_str().unwrap(): first } });
    let refused = world.call(agent_of(&view), "agents.import_marks", marks);
    assert_eq!(refused.await.unwrap_err().code, Code::Forbidden);
    assert_eq!(world.seen(&fresh).await, None);

    assert_eq!(world.import(&seen, &[]).await, json!(1));
    assert_eq!(world.seen(&fresh).await, Some(first));
    assert_eq!(world.seen(&ahead).await, theirs);
    assert_eq!(world.seen(&stranger).await, None);
    assert_eq!(world.seen(&works["thread"]).await, None);
    assert_eq!(world.every_changed().await, changed, "nothing moved");
    // One fact says marks moved; none says each Thread was seen.
    assert_eq!(world.facts("marks.moved").await.len(), 1);
    assert_eq!(world.facts("thread.seen").await.len(), 1, "the one by hand");

    // Moved again, a later turn moves it on, with an archive in the same
    // move.
    assert_eq!(
        world.import(&[(&fresh, &second)], &[&ahead]).await,
        json!(2)
    );
    assert_eq!(world.seen(&fresh).await, Some(second));
    assert!(world.listed(&ahead).await.is_archived());
    assert_eq!(world.facts("marks.moved").await.len(), 2);
}

#[tokio::test]
async fn a_window_that_moves_its_marks_again_undoes_nothing_its_person_chose() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let person = world.person();
    let (taken, _) = world.finish(None, "hello").await;
    let (kept, _) = world.finish(None, "hi there").await;
    let (taken_turn, kept_turn) = (
        world.turn_at(&taken, 0).await,
        world.turn_at(&kept, 0).await,
    );
    let seen = [(&taken, &taken_turn), (&kept, &kept_turn)];
    assert_eq!(world.import(&seen, &[&taken, &kept]).await, json!(4));

    // The Person takes both marks off one Thread on another machine; the
    // window moves its marks again, as one whose flag was lost (#853).
    world.unread(person, &taken).await.unwrap();
    world.archive(person, &taken, false).await.unwrap();
    assert_eq!(world.import(&seen, &[&taken, &kept]).await, json!(0));
    let listed = world.listed(&taken).await;
    assert_eq!((listed.seen, listed.archived), (None, None));
    let listed = world.listed(&kept).await;
    assert_eq!(listed.seen.map(|turn| json!(turn)), Some(kept_turn));
    assert!(listed.is_archived());
    assert_eq!(world.facts("marks.moved").await.len(), 1);

    // So it is for marks taken off before the window first moved them.
    let (first, _) = world.finish(None, "good morning").await;
    let first_turn = world.turn_at(&first, 0).await;
    world.read(person, &first, None).await.unwrap();
    world.unread(person, &first).await.unwrap();
    world.archive(person, &first, true).await.unwrap();
    world.archive(person, &first, false).await.unwrap();
    assert_eq!(
        world.import(&[(&first, &first_turn)], &[&first]).await,
        json!(0)
    );
    let listed = world.listed(&first).await;
    assert_eq!((listed.seen, listed.archived), (None, None));
    // What the Person marks by hand after holds as ever.
    world.read(person, &first, None).await.unwrap();
    assert_eq!(world.seen(&first).await, Some(first_turn));
}

#[tokio::test]
async fn a_turn_a_limit_stopped_goes_on_with_another_account_at_once() {
    let root = tempfile::tempdir().unwrap();
    let other = Harness {
        id: "other".into(),
        name: "Other".into(),
        ..fake_with(&[])
    };
    let agents = Agents::new(Harnesses::new(vec![fake_with(&[]), other]));
    let world = World::new_with(root.path(), agents).await;
    let (sent, _) = failing(&world, "over the limit").await;
    let (thread, turn) = (&sent["thread"], &sent["turn"]);
    // Put off till the reset, to go on by itself.
    let until = banda_kernel::now_ms() + 3_600_000;
    let later = json!({ "thread": thread, "resume": true, "until": until });
    (world.call(world.person(), "agents.later", later).await).unwrap();

    let go_on = json!({ "turn": turn, "harness": "other" });
    let by_agent = world
        .call(world.agent(), "agents.go_on", go_on.clone())
        .await;
    assert!(by_agent.is_err(), "only a Person moves a Thread");
    (world
        .call(world.person(), "agents.go_on", go_on.clone())
        .await)
        .unwrap();

    // The same words meet the fake agent's limit again: it ran there.
    let view = world
        .until(thread, |v| {
            v.turns.len() == 2 && v.turns[1].state == TurnState::Failed
        })
        .await;
    assert_eq!(view.thread.harness, "other");
    assert_eq!(view.turns[1].harness.as_deref(), Some("other"));
    let later = world.later_of(thread).await.unwrap();
    assert!(later.woke.is_some(), "the move woke it");
    let again = world.call(world.person(), "agents.go_on", go_on).await;
    assert_eq!(again.unwrap(), Value::Null, "it went on already");

    // Another window still has the old card. Its different destination
    // must not change where the Thread is now or wake its new Later.
    world
        .call(
            world.person(),
            "agents.later",
            json!({ "thread": thread, "until": until }),
        )
        .await
        .unwrap();
    let before = world.thread(thread).await.at;
    let stale = world
        .call(
            world.person(),
            "agents.go_on",
            json!({ "turn": turn, "harness": "fake" }),
        )
        .await
        .unwrap();
    assert_eq!(stale, Value::Null);
    assert_eq!(
        world.thread(thread).await.at,
        before,
        "a stale card writes nothing"
    );
    assert_eq!(world.thread(thread).await.thread.harness, "other");
    assert!(world.later_of(thread).await.unwrap().woke.is_none());
}

#[tokio::test]
async fn removing_an_account_keeps_its_running_turn_then_moves_its_threads() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("harnesses.toml");
    let program = serde_json::to_string(&fake_agent().display().to_string()).unwrap();
    let base = format!(
        "[[harness]]\nid = \"old\"\nname = \"Old\"\ncommand = {program}\n\n[[harness]]\nid = \"next\"\nname = \"Next\"\ncommand = {program}\n"
    );
    std::fs::write(&file, &base).unwrap();
    let choices = Harnesses::load(&file).unwrap();
    let world = World::new_on(root.path(), Agents::new(choices.clone()), "old").await;
    let idle = world.send(None, "hello").await;
    world
        .until(&idle["thread"], |v| {
            state(v, &idle["turn"]) == Some(TurnState::Done)
        })
        .await;
    let active = world.send(None, "slow").await;
    world
        .until(&active["thread"], |v| {
            texts(v).iter().any(|s| s.contains("message: 0 "))
        })
        .await;
    let saved = base.replace("name = \"Old\"", &format!("name = \"Old\"\nretired = {{ to = \"next\", by = {{ kind = \"person\", id = \"{}\" }} }}", world.owner));
    std::fs::write(&file, saved).unwrap();
    assert!(choices.get("old").is_err());
    assert_eq!(
        world.thread(&active["thread"]).await.thread.harness,
        "old",
        "the current Turn keeps its Account"
    );
    world
        .until(&active["thread"], |v| v.thread.harness == "next")
        .await;
    world
        .until(&idle["thread"], |v| v.thread.harness == "next")
        .await;
    let next = world.send(Some(&active["thread"]), "hello again").await;
    let view = world
        .until(&active["thread"], |v| {
            state(v, &next["turn"]) == Some(TurnState::Done)
        })
        .await;
    assert!(
        texts(&view).iter().any(|s| s.contains("message: 0 ")),
        "history stays"
    );
    assert_eq!(
        world
            .events_of(&active["thread"], "thread.switched")
            .await
            .len(),
        1,
        "repeated checks move once"
    );
}
