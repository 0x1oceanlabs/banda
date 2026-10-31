//! The agents module through the kernel's interface, with the fake agent
//! from `tools/fake-agent` as the Harness: a real process speaking ACP.

use bandaso_agents::Agents;
use bandaso_agents::model::{
    Body, Exit, Failure, Mode, OptionValue, QuestionState, Settings, StepState, ThreadView,
    ToolContent, ToolStatus, TurnState,
};
use bandaso_agents::settings::{Harness, Harnesses};
use bandaso_kernel::{AgentId, Code, CommandId, Kernel, Participant, PersonId, SpaceId};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
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
    harnesses_with(&[])
}

/// The fake agent as the only Harness, started with `env`.
fn harnesses_with(env: &[(&str, &str)]) -> Harnesses {
    Harnesses::new(vec![Harness {
        id: "fake".into(),
        name: "Fake".into(),
        command: fake_agent().display().to_string(),
        args: Vec::new(),
        env: env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
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
        World::open_with(root, owner, Agents::new(harnesses())).await
    }

    async fn open_with(root: &Path, owner: PersonId, agents: Agents) -> Arc<Kernel> {
        Kernel::builder(root, owner)
            .module(agents)
            .open()
            .await
            .unwrap()
    }

    async fn new(root: &Path) -> World {
        World::new_with(root, Agents::new(harnesses())).await
    }

    async fn new_with(root: &Path, agents: Agents) -> World {
        let owner = PersonId::new();
        let kernel = World::open_with(root, owner, agents).await;
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
            Body::Message { text, images } if images.is_empty() => format!("message: {text}"),
            Body::Message { text, images } => {
                format!("message: {text} + {} image(s)", images.len())
            }
            Body::Thought { text } => format!("thought: {text}"),
            Body::Tool { title, status, .. } => format!("tool: {title} ({status:?})"),
            Body::Question { title, state, .. } => format!("question: {title} ({state:?})"),
            Body::Notice { text } => format!("notice: {text}"),
            Body::Plan { steps } => format!("plan: {} steps", steps.len()),
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
            "thread.offered",
            "thought.grew",
            "reply.grew",
            "turn.ended",
        ]
    );
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
            Participant::Agent(world.agent),
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
    let (owner, space, agent, kept) = first.block_on(async {
        let world = World::new_with(root, agents()).await;
        let kept = before(&world).await;
        (world.owner, world.space, world.agent, kept)
    });
    first.shutdown_timeout(Duration::from_secs(5));
    runtime().block_on(async {
        let kernel = World::open_with(root, owner, agents()).await;
        let world = World {
            kernel,
            owner,
            space,
            agent,
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
    assert_eq!(texts(&view).last().unwrap(), "message: You said: flaky one");
    assert_eq!(
        view.items
            .iter()
            .filter(|i| matches!(i.body, Body::Message { .. }) && i.turn.is_none())
            .count(),
        1,
        "the message is not posted twice"
    );

    let refused = retry(&sent["turn"]).await.unwrap_err();
    assert!(refused.message.contains("latest"), "{}", refused.message);
    let refused = retry(&again["turn"]).await.unwrap_err();
    assert!(refused.message.contains("failed"), "{}", refused.message);
}

impl World {
    async fn defaults(&self) -> Value {
        let params = json!({ "agent": self.agent });
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
        ["model", "brief"],
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
async fn an_agents_file_holds_what_its_new_threads_start_with() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let first = world.defaults().await;
    assert_eq!(first["settings"]["mode"], "full_access");
    assert_eq!(first["offer"]["options"], json!([]), "nothing offered yet");

    let space = world.kernel.space(world.space).await.unwrap();
    let file = space.folder().join(".bandaso/agents/Writer.toml");
    let text = std::fs::read_to_string(&file).unwrap();
    std::fs::write(
        &file,
        format!("{text}mode = \"auto\"\n\n[options]\nmodel = \"smart\"\n"),
    )
    .unwrap();
    let (_, view) = world.finish(None, "which settings").await;
    assert_eq!(view.settings.mode, Mode::Auto);
    assert_eq!(
        last_reply(&view),
        "message: Mode auto, model smart, brief false"
    );

    let after = world.defaults().await;
    assert_eq!(after["settings"]["mode"], "auto");
    assert_eq!(
        after["offer"]["options"][0]["id"], "model",
        "what the Harness offered"
    );
    assert_eq!(
        after["settings"]["options"],
        json!({ "model": "smart", "brief": false }),
        "what the composer shows is what a new Thread gets"
    );
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
        "agent": world.agent,
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
    let agent = Participant::Agent(world.agent);
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
        "agent": world.agent,
        "thread": thread,
        "text": "go on",
        "settings": settings,
    });
    let sent = world.call(agent, "agents.send", params).await;
    assert_eq!(sent.unwrap_err().code, Code::Forbidden);
    let params = json!({ "agent": world.agent, "thread": thread, "text": "go on" });
    world.call(agent, "agents.send", params).await.unwrap();
}

/// Whether the Thread waits on an open Question.
fn asking(view: &ThreadView) -> bool {
    view.items.iter().any(|i| {
        matches!(
            i.body,
            Body::Question {
                state: QuestionState::Open,
                ..
            }
        )
    })
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
async fn what_the_agent_used_between_turns_reaches_the_thread_with_the_next() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (thread, _) = world.finish(None, "stop for later").await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let (_, view) = world.finish(Some(&thread), "hello").await;
    assert_eq!(view.usage.map(|u| u.used), Some(150_000));
}

fn slash_commands(view: &ThreadView) -> Vec<&str> {
    view.offer
        .slash_commands
        .iter()
        .map(|c| c.name.as_str())
        .collect()
}

#[tokio::test]
async fn the_slash_commands_a_harness_says_on_opening_reach_its_thread() {
    let root = tempfile::tempdir().unwrap();
    let world = World::new(root.path()).await;
    let (_, view) = world.finish(None, "hello").await;
    assert_eq!(slash_commands(&view), ["review", "compact"]);
    let review = &view.offer.slash_commands[0];
    assert_eq!(review.description, "Review the changes so far");
    assert_eq!(review.hint.as_deref(), Some("what to look at"));
    assert_eq!(view.offer.slash_commands[1].hint, None);
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

/// Where the Space keeps an image's bytes.
fn image_file(root: &Path, image: &Value) -> PathBuf {
    let id = image["id"].as_str().unwrap();
    root.join("Work/.bandaso/images").join(id)
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
    ) -> Result<Value, bandaso_kernel::Refusal> {
        let data = BASE64.encode(bytes);
        let params = json!({ "mime": mime, "data": data, "name": name });
        self.call(who, "agents.attach", params).await
    }

    async fn send_images(&self, text: &str, images: &[&Value]) -> Value {
        let ids: Vec<&Value> = images.iter().map(|image| &image["id"]).collect();
        let params = json!({ "agent": self.agent, "text": text, "images": ids });
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
    // Its bytes are a file in the Space, not a row in its database.
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
    let twice = json!({ "agent": world.agent, "text": "one", "images": [shot["id"], shot["id"]] });
    let refused = world
        .call(world.person(), "agents.send", twice)
        .await
        .unwrap_err();
    assert_eq!(refused.message, "A message carries each image once.");
    world.send_images("one", &[&shot]).await;
    let again = json!({ "agent": world.agent, "text": "two", "images": [shot["id"]] });
    let refused = world
        .call(world.person(), "agents.send", again)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid, "{refused:?}");

    // An image someone else added is not this Person's to send.
    let theirs = world
        .attach(Participant::Agent(world.agent), "image/png", PNG, None)
        .await
        .unwrap();
    let send = json!({ "agent": world.agent, "text": "three", "images": [theirs["id"]] });
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
