//! The agents module through the kernel's interface, with the fake agent
//! from `tools/fake-agent` as the Harness: a real process speaking ACP.

use bandaso_agents::Agents;
use bandaso_agents::model::{Body, QuestionState, ThreadView, TurnState};
use bandaso_agents::settings::{Harness, Harnesses};
use bandaso_kernel::{AgentId, Code, CommandId, Kernel, Participant, PersonId, SpaceId};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// Builds the fake agent once, next to this test's own binary.
fn fake_agent() -> PathBuf {
    static BUILT: OnceLock<PathBuf> = OnceLock::new();
    BUILT
        .get_or_init(|| {
            let status = std::process::Command::new(env!("CARGO"))
                .args(["build", "-q", "-p", "bandaso-fake-agent"])
                .status()
                .expect("cargo runs");
            assert!(status.success(), "the fake agent builds");
            let deps = std::env::current_exe().unwrap();
            let profile = deps.parent().and_then(Path::parent).unwrap();
            profile.join("bandaso-fake-agent")
        })
        .clone()
}

fn harnesses() -> Harnesses {
    Harnesses::new(vec![Harness {
        id: "fake".into(),
        name: "Fake".into(),
        command: fake_agent().display().to_string(),
        args: Vec::new(),
        env: Default::default(),
    }])
}

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    space: SpaceId,
    agent: AgentId,
}

impl World {
    async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
        Kernel::builder(root, owner)
            .module(Agents::new(harnesses()))
            .open()
            .await
            .unwrap()
    }

    async fn new(root: &Path) -> World {
        let owner = PersonId::new();
        let kernel = World::open(root, owner).await;
        let person = Participant::Person(owner);
        let space = kernel
            .call(
                person,
                "spaces.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let space: SpaceId = serde_json::from_value(space["id"].clone()).unwrap();
        let agent = kernel
            .call(
                person,
                "agents.create",
                Some(space),
                Some(CommandId::new()),
                json!({ "name": "Writer", "harness": "fake" }),
            )
            .await
            .unwrap();
        let agent: AgentId = serde_json::from_value(agent["id"].clone()).unwrap();
        World {
            kernel,
            owner,
            space,
            agent,
        }
    }

    fn person(&self) -> Participant {
        Participant::Person(self.owner)
    }

    async fn call(
        &self,
        who: Participant,
        method: &str,
        params: Value,
    ) -> Result<Value, bandaso_kernel::Refusal> {
        self.kernel
            .call(
                who,
                method,
                Some(self.space),
                Some(CommandId::new()),
                params,
            )
            .await
    }

    async fn send(&self, thread: Option<&Value>, text: &str) -> Value {
        let mut params = json!({ "agent": self.agent, "text": text });
        if let Some(thread) = thread {
            params["thread"] = thread.clone();
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
                Some(self.space),
                None,
                json!({ "thread": thread }),
            )
            .await
            .unwrap();
        serde_json::from_value(view).unwrap()
    }

    /// Waits up to ten seconds for the Thread to satisfy `check`.
    async fn until(&self, thread: &Value, check: impl Fn(&ThreadView) -> bool) -> ThreadView {
        for _ in 0..1000 {
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

fn texts(view: &ThreadView) -> Vec<String> {
    view.items
        .iter()
        .map(|item| match &item.body {
            Body::Message { text } => format!("message: {text}"),
            Body::Thought { text } => format!("thought: {text}"),
            Body::Tool { title, status, .. } => format!("tool: {title} ({status:?})"),
            Body::Question { title, state, .. } => format!("question: {title} ({state:?})"),
        })
        .collect()
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
    assert_eq!(view.items[2].author, Participant::Agent(world.agent));

    let space = world.kernel.space(world.space).await.unwrap();
    let kinds: Vec<String> = space
        .events_after(0, Default::default(), 100)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.kind)
        .collect();
    assert_eq!(
        kinds,
        [
            "agent.created",
            "thread.started",
            "message.posted",
            "turn.started",
            "thought.grew",
            "reply.grew",
            "turn.ended",
        ]
    );
}

#[tokio::test]
async fn a_question_waits_for_a_person_and_never_offers_always() {
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
    let ids: Vec<_> = choices.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["allow", "reject"]);

    let by_agent = world
        .call(
            Participant::Agent(world.agent),
            "agents.answer",
            json!({ "item": question.id, "choice": "allow" }),
        )
        .await;
    assert_eq!(by_agent.unwrap_err().code, Code::Forbidden);
    let always = world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question.id, "choice": "always" }),
        )
        .await;
    assert_eq!(always.unwrap_err().code, Code::Invalid);
    world
        .call(
            world.person(),
            "agents.answer",
            json!({ "item": question.id, "choice": "allow" }),
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
async fn a_question_that_offers_only_always_answers_fails_its_turn() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let sent = world.send(None, "remember my answer").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Failed)
        })
        .await;
    let reason = view.turns[0].reason.as_deref().unwrap_or_default();
    assert!(reason.contains("a Person decides each time"), "{reason}");
    assert!(
        view.items
            .iter()
            .all(|i| !matches!(i.body, Body::Question { .. })),
        "a Question with nothing to choose is never shown"
    );
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
    assert!(
        replies.iter().any(|t| t.starts_with("message: 0 ")),
        "the running turn had begun: {replies:?}"
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
    assert!(view.turns[0].reason.is_some());

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

#[tokio::test]
async fn an_agent_on_a_harness_this_computer_lacks_fails_plainly() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let file = root.path().join("Work/.bandaso/agents/Writer.toml");
    let text = std::fs::read_to_string(&file)
        .unwrap()
        .replace("\"fake\"", "\"elsewhere\"");
    std::fs::write(&file, text).unwrap();
    let sent = world.send(None, "hello").await;
    let view = world
        .until(&sent["thread"], |v| {
            state(v, &sent["turn"]) == Some(TurnState::Failed)
        })
        .await;
    assert_eq!(
        view.turns[0].reason.as_deref(),
        Some("This computer has no Harness named \"elsewhere\".")
    );
}

#[test]
fn a_restart_interrupts_the_turn_it_cut_short_and_closes_its_question() {
    let root = tempfile::tempdir().unwrap();
    let runtime = || tokio::runtime::Runtime::new().unwrap();

    let before = runtime();
    let (owner, space, thread, turn) = before.block_on(async {
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
            world.space,
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
                Some(space),
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
