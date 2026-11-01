//! A scripted ACP agent. It speaks ACP v1 over stdio like a real Harness,
//! and the words in a prompt choose what it does:
//!
//! - `ask`: starts a tool call and asks permission to run it. An allow runs
//!   it, a reject skips it, and a cancel ends the turn.
//! - `choose`: asks for a colour with a form, as Claude Code asks its own
//!   questions, and replies with the answer, or that the Person skipped.
//!   `quickly`, it stops waiting after 300 milliseconds, as Codex does when
//!   a question times out.
//! - `which settings`: replies with the session's mode, model and brevity.
//! - `plan done`: in the plan mode, switches to accepting edits, as Claude
//!   Code does when a Person accepts its plan.
//! - `propose`: asks to leave plan mode with its plan, as Claude Code does.
//!   An answer that allows it switches to accepting edits and carries the
//!   plan out; "keep planning" ends the turn as cancelled.
//! - `quit`: ends the turn as cancelled, though nobody stopped it.
//! - `slow`: replies in forty pieces, fifty milliseconds apart, and stops
//!   early when cancelled.
//! - `wait`: says it waits, then waits for a message sent into its turn
//!   (`_session/steering`) and replies to that, or stops when cancelled.
//!   A message sent into any other turn is taken and goes unanswered.
//! - `fail`: answers the prompt with an error.
//! - `flaky`: fails the first time this process sees the prompt, and
//!   answers as anything else does after that.
//! - `sign in`: answers the prompt as a Harness whose Person signed out.
//! - `limit`: says the account's limit resets in an hour, as Claude Code
//!   does, then fails the prompt as one over its limit.
//! - `warn`: sends a notice, if the client shows them, then answers.
//! - `crash`: exits at once, as a Harness that dies would.
//! - `which session`: replies with the session's ID and its own process ID.
//! - `steps`: makes a plan of three steps and does them one by one; the
//!   context is then a quarter full. With `clear`, it clears the plan.
//! - `clear`: clears a plan it never made.
//! - `twice`: says two messages, told apart only by their IDs.
//! - `background`: starts a task, ends the turn, and goes on by itself when
//!   the task ends, as Claude Code does; `long`, until it is stopped or a
//!   prompt takes it in; `asks`, asking to run a check; `quiet`, never
//!   saying what that cost; `dies`, ending its process. `background
//!   detached` runs a command that ends after the turn, and nothing more.
//! - `later`: says what it used after the turn has ended.
//! - `edit`: edits a file, and shows the change as a diff.
//! - `run`: runs the tests, printing as Codex does; `loud` far more than a
//!   Thread keeps; `at once` as Claude Code does, all at the end.
//! - `new command`: starts its reply, learns the command `/init`, and ends
//!   the reply.
//! - images: it says how many it was shown and of what kinds, then does
//!   what the words ask.
//! - anything else: a short thought, then a reply that quotes the prompt.
//!
//! Just after a session opens it says its commands, `/review` and
//! `/compact`, as Claude Code does.
//!
//! With `FAKE_AGENT_HOME` set it has an account, kept as a file there. It
//! reads it when it starts, and a prompt fails as one whose Person must
//! sign in until someone has. It says who is signed in as Claude Code's
//! adapter does (`_auth/status_update`), and signs out when asked. It
//! offers two ways to sign in: `fake-sign-in`, which
//! runs `banda-fake-agent --sign-in` in a terminal, where the Person
//! pastes the code `fake-code`, as Claude Code's adapter offers to a client
//! that runs terminals; and `fake-browser`, which signs in by itself, as
//! Codex's does in the browser.
//!
//! Its sessions can be resumed or loaded after a restart, as a real
//! Harness keeps them on disk. With `FAKE_AGENT_FORGETS` set it refuses
//! both, as a Harness that lost them would.
//!
//! Each session has options as Claude Code's do: a `mode` with Claude
//! Code's modes, a `model`, and `brief`, on or off, for a client that shows
//! such options. With `FAKE_AGENT_NO_MODES` set it has no modes, as an ACP
//! agent other than Claude Code and Codex. With `FAKE_AGENT_NO_IMAGES` set
//! it takes no images, and with `FAKE_AGENT_NO_STEERING` no message into a
//! running turn.
//!
//! With `FAKE_AGENT_REPLAY` naming a recording it plays a real Harness's
//! conversation instead: see [`replay`].

mod replay;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentAuthCapabilities, AgentCapabilities, AuthMethod, AuthMethodAgent, AuthMethodTerminal,
    AuthenticateRequest, AuthenticateResponse, AvailableCommand, AvailableCommandInput,
    AvailableCommandsUpdate, CancelNotification, ConfigOptionUpdate, ContentBlock, ContentChunk,
    Cost, CreateElicitationRequest, Diff, ElicitationAction, ElicitationContentValue,
    ElicitationFormMode, ElicitationSchema, ElicitationSessionScope, EnumOption, Implementation,
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    LogoutCapabilities, LogoutRequest, LogoutResponse, MessageId, NewSessionRequest,
    NewSessionResponse, Notice, NoticeSeverity, PermissionOption, PermissionOptionKind, Plan,
    PlanEntry, PlanEntryPriority, PlanEntryStatus, PromptCapabilities, PromptRequest,
    PromptResponse, RequestPermissionOutcome, RequestPermissionRequest, ResumeSessionRequest,
    ResumeSessionResponse, SessionCapabilities, SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigOptionValue, SessionConfigSelectOption, SessionId, SessionNotification,
    SessionResumeCapabilities, SessionUpdate, SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse, StopReason, StringPropertySchema, Terminal, TextContent,
    ToolCall, ToolCallContent, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UnstructuredCommandInput, UsageUpdate,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Responder, Stdio};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

/// `_session/steering`, as Claude Code's and Codex's adapters take it.
#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcRequest)]
#[request(method = "_session/steering", response = SteeringResponse)]
#[serde(rename_all = "camelCase")]
struct SteeringRequest {
    session_id: SessionId,
    prompt: Vec<ContentBlock>,
    #[serde(rename = "_meta", default)]
    meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcResponse)]
struct SteeringResponse {
    outcome: String,
}

#[derive(Clone, Default)]
struct Fake {
    sessions: Arc<AtomicU64>,
    cancelled: Arc<Mutex<HashSet<SessionId>>>,
    /// The client declared that it shows notices.
    notices: Arc<AtomicBool>,
    /// The `flaky` prompts that have failed once.
    failed_once: Arc<Mutex<HashSet<String>>>,
    /// The client shows options that are on or off.
    toggles: Arc<AtomicBool>,
    /// The client shows forms.
    forms: Arc<AtomicBool>,
    /// The client takes what a command prints in pieces.
    output: Arc<AtomicBool>,
    /// The turn each session runs, by where a message sent into it goes.
    running: Arc<Mutex<HashMap<SessionId, mpsc::UnboundedSender<String>>>>,
    setups: Arc<Mutex<HashMap<SessionId, Setup>>>,
    /// Its Person signed in, as it read when it started or signed in since.
    signed_in: Arc<AtomicBool>,
}

/// What a session runs with.
#[derive(Clone)]
struct Setup {
    mode: String,
    model: String,
    brief: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            mode: "default".into(),
            model: "fast".into(),
            brief: false,
        }
    }
}

const MODES: [(&str, &str); 5] = [
    ("default", "Manual"),
    ("acceptEdits", "Accept edits"),
    ("plan", "Plan"),
    ("auto", "Auto"),
    ("bypassPermissions", "Bypass permissions"),
];
const MODELS: [(&str, &str); 2] = [("fast", "Fast"), ("smart", "Smart")];

fn select(values: &[(&str, &str)]) -> Vec<SessionConfigSelectOption> {
    values
        .iter()
        .map(|(value, name)| SessionConfigSelectOption::new(value.to_string(), *name))
        .collect()
}

impl Fake {
    fn cancelled(&self, session: &SessionId) -> bool {
        self.cancelled.lock().unwrap().contains(session)
    }

    fn setup(&self, session: &SessionId) -> Setup {
        let mut setups = self.setups.lock().unwrap();
        setups.entry(session.clone()).or_default().clone()
    }

    /// The session's options, as the Harness offers them.
    fn options(&self, session: &SessionId) -> Vec<SessionConfigOption> {
        let setup = self.setup(session);
        let mut options = Vec::new();
        if std::env::var_os("FAKE_AGENT_NO_MODES").is_none() {
            options.push(
                SessionConfigOption::select("mode", "Mode", setup.mode, select(&MODES))
                    .category(SessionConfigOptionCategory::Mode),
            );
        }
        options.push(
            SessionConfigOption::select("model", "Model", setup.model, select(&MODELS))
                .category(SessionConfigOptionCategory::Model),
        );
        if self.toggles.load(Ordering::Relaxed) {
            options.push(SessionConfigOption::boolean("brief", "Brief", setup.brief));
        }
        options
    }

    /// Sets one option, if the session offers it and the value is one of
    /// its own.
    /// Leaves plan mode for accepting edits, as Claude Code does once its
    /// plan is accepted: what to tell the client, if it was planning.
    fn leave_plan(&self, session: &SessionId) -> Option<SessionUpdate> {
        {
            let mut setups = self.setups.lock().unwrap();
            let setup = setups.entry(session.clone()).or_default();
            if setup.mode != "plan" {
                return None;
            }
            setup.mode = "acceptEdits".into();
        }
        let update = ConfigOptionUpdate::new(self.options(session));
        Some(SessionUpdate::ConfigOptionUpdate(update))
    }

    fn set(&self, request: &SetSessionConfigOptionRequest) -> Result<(), Error> {
        let offered = self.options(&request.session_id);
        let option = offered
            .iter()
            .find(|o| o.id == request.config_id)
            .ok_or_else(|| Error::invalid_params().data("no such option"))?;
        let mut setups = self.setups.lock().unwrap();
        let setup = setups.entry(request.session_id.clone()).or_default();
        let choose = |values: &[(&str, &str)], value: &SessionConfigOptionValue| {
            let value = value.as_value_id().map(|v| v.0.to_string());
            value
                .filter(|v| values.iter().any(|(id, _)| id == v))
                .ok_or_else(|| Error::invalid_params().data("no such value"))
        };
        match &*option.id.0 {
            "mode" => setup.mode = choose(&MODES, &request.value)?,
            "model" => setup.model = choose(&MODELS, &request.value)?,
            _ => {
                setup.brief = request
                    .value
                    .as_bool()
                    .ok_or_else(|| Error::invalid_params().data("on or off"))?
            }
        }
        Ok(())
    }
}

fn say(cx: &ConnectionTo<Client>, session: &SessionId, update: SessionUpdate) -> Result<(), Error> {
    cx.send_notification(SessionNotification::new(session.clone(), update))
}

/// Who is signed in, as Claude Code's adapter pushes it.
#[derive(Clone, Debug, Serialize, Deserialize, agent_client_protocol::JsonRpcNotification)]
#[notification(method = "_auth/status_update")]
struct AuthStatusUpdate {
    #[serde(rename = "authStatus")]
    status: serde_json::Value,
}

fn report(cx: &ConnectionTo<Client>, signed_in: bool) -> Result<(), Error> {
    let status = match signed_in {
        true => json!({
            "kind": "account", "label": "Fake Pro",
            "account": { "email": "person@example.invalid", "plan": "pro" },
        }),
        false => json!({ "kind": "none", "label": "Not logged in" }),
    };
    cx.send_notification(AuthStatusUpdate { status })
}

/// Its commands; with `/init` once it has learned that.
fn commands(learned: bool) -> SessionUpdate {
    let mut all = vec![
        AvailableCommand::new("review", "Review the changes so far").input(
            AvailableCommandInput::Unstructured(UnstructuredCommandInput::new("what to look at")),
        ),
        AvailableCommand::new("compact", "Make room in the context"),
    ];
    if learned {
        all.push(AvailableCommand::new(
            "init",
            "Write notes about this folder",
        ));
    }
    SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(all))
}

fn text(words: &str) -> ContentChunk {
    ContentChunk::new(ContentBlock::Text(TextContent::new(words)))
}

fn words_of(prompt: &[ContentBlock]) -> String {
    prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// What it says of the images it was shown, if it was shown any.
fn seen(prompt: &[ContentBlock]) -> Option<String> {
    let kinds: Vec<&str> = prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Image(image) => Some(image.mime_type.as_str()),
            _ => None,
        })
        .collect();
    match kinds.len() {
        0 => None,
        1 => Some(format!("I see 1 image: {}. ", kinds[0])),
        n => Some(format!("I see {n} images: {}. ", kinds.join(", "))),
    }
}

async fn turn(
    fake: Fake,
    cx: ConnectionTo<Client>,
    prompt: PromptRequest,
    mut steered: mpsc::UnboundedReceiver<String>,
) -> Result<StopReason, Error> {
    let session = prompt.session_id.clone();
    if let Some(seen) = seen(&prompt.prompt) {
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(&seen)))?;
    }
    let words = words_of(&prompt.prompt);
    if words.contains("crash") {
        std::process::exit(1);
    }
    if words.contains("fail") {
        return Err(Error::internal_error().data("the fake agent was told to fail"));
    }
    if words.contains("flaky") && fake.failed_once.lock().unwrap().insert(words.clone()) {
        return Err(Error::internal_error().data("the fake agent fails this once"));
    }
    if words.contains("sign in") || !fake.signed_in.load(Ordering::Relaxed) {
        return Err(Error::auth_required());
    }
    if words.contains("limit") {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        let limit = json!({ "status": "rejected", "resetsAt": now.as_secs() + 3600 });
        let meta = json!({ "_claude/rateLimit": limit });
        let usage = UsageUpdate::new(1000, 200_000).meta(meta.as_object().cloned());
        say(&cx, &session, SessionUpdate::UsageUpdate(usage))?;
        return Err(Error::new(-32603, "Internal error: You've hit your limit.")
            .data(json!({ "errorKind": "rate_limit" })));
    }
    if words.contains("warn") && fake.notices.load(Ordering::Relaxed) {
        let notice = Notice::new(NoticeSeverity::Warning, "The model is busy.")
            .description("The Harness tries again.");
        say(&cx, &session, SessionUpdate::Notice(notice))?;
    }
    if words.contains("slow") {
        for piece in 0..40 {
            if fake.cancelled(&session) {
                return Ok(StopReason::Cancelled);
            }
            say(
                &cx,
                &session,
                SessionUpdate::AgentMessageChunk(text(&format!("{piece} "))),
            )?;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        return Ok(StopReason::EndTurn);
    }
    if words.contains("quit") {
        return Ok(StopReason::Cancelled);
    }
    if words.contains("wait") {
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Waiting.")),
        )?;
        loop {
            if fake.cancelled(&session) {
                return Ok(StopReason::Cancelled);
            }
            let heard = tokio::time::timeout(Duration::from_millis(50), steered.recv()).await;
            if let Ok(Some(words)) = heard {
                let reply = format!("Steered: {words}.");
                say(
                    &cx,
                    &session,
                    SessionUpdate::AgentMessageChunk(text(&reply)),
                )?;
                return Ok(StopReason::EndTurn);
            }
        }
    }
    if words.contains("choose") {
        let reply = if fake.forms.load(Ordering::Relaxed) {
            choose(&cx, &session, words.contains("quickly")).await?
        } else {
            "I cannot ask you here.".to_owned()
        };
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("which settings") {
        let setup = fake.setup(&session);
        let reply = format!(
            "Mode {}, model {}, brief {}",
            setup.mode, setup.model, setup.brief
        );
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("plan done") {
        let left = fake.leave_plan(&session);
        let planned = left.is_some();
        if let Some(update) = left {
            say(&cx, &session, update)?;
        }
        let reply = if planned {
            "The plan is ready."
        } else {
            "There was no plan."
        };
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(reply)))?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("steps") {
        // A plan of three steps, done one by one, as Claude Code's todos.
        let steps = ["Read the notes", "Fix the typo", "Check the result"];
        for done in 0..=steps.len() {
            let entries = steps
                .iter()
                .enumerate()
                .map(|(at, step)| {
                    let status = match at.cmp(&done) {
                        std::cmp::Ordering::Less => PlanEntryStatus::Completed,
                        std::cmp::Ordering::Equal => PlanEntryStatus::InProgress,
                        std::cmp::Ordering::Greater => PlanEntryStatus::Pending,
                    };
                    PlanEntry::new(*step, PlanEntryPriority::Medium, status)
                })
                .collect();
            say(&cx, &session, SessionUpdate::Plan(Plan::new(entries)))?;
        }
        if words.contains("clear") {
            say(&cx, &session, SessionUpdate::Plan(Plan::new(vec![])))?;
        }
        let usage = UsageUpdate::new(52_000, 200_000).cost(Cost::new(0.25, "USD"));
        say(&cx, &session, SessionUpdate::UsageUpdate(usage))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("All three steps are done.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("clear") {
        say(&cx, &session, SessionUpdate::Plan(Plan::new(vec![])))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Nothing to plan.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("twice") {
        // Two messages, told apart only by their IDs, as Codex's plan and
        // the reply after it.
        for (id, words) in [("m1", "First."), ("m1", " Still first."), ("m2", "Second.")] {
            let chunk = text(words).message_id(MessageId::new(id));
            say(&cx, &session, SessionUpdate::AgentMessageChunk(chunk))?;
        }
        return Ok(StopReason::EndTurn);
    }
    if words.contains("background") {
        // A task it started ends after the turn, and it goes on by itself
        // with what the task found, as Claude Code does. `long`, it goes on
        // until it is stopped or a prompt takes it in; `asks`, it asks to
        // run a check first; `quiet`, it never says what that cost, as
        // Codex; `dies`, its process ends. `detached` runs a command in the
        // background, which ends after the turn, and nothing more.
        let (after, its, fake) = (cx.clone(), session.clone(), fake.clone());
        let long = words.contains("long");
        let (asks, quiet, dies) = (
            words.contains("asks"),
            words.contains("quiet"),
            words.contains("dies"),
        );
        if words.contains("detached") {
            let tool = "detached-1";
            say(
                &cx,
                &session,
                SessionUpdate::ToolCall(
                    ToolCall::new(tool, "Run the server")
                        .kind(ToolKind::Execute)
                        .status(ToolCallStatus::Completed),
                ),
            )?;
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let mut meta = serde_json::Map::new();
                meta.insert(
                    "terminal_exit".to_owned(),
                    serde_json::json!({ "terminal_id": tool, "exit_code": null, "signal": null }),
                );
                let exit = ToolCallUpdate::new(tool, ToolCallUpdateFields::new()).meta(meta);
                let _ = say(&after, &its, SessionUpdate::ToolCallUpdate(exit));
                let used = SessionUpdate::UsageUpdate(UsageUpdate::new(70_000, 200_000));
                let _ = say(&after, &its, used);
            });
            return Ok(StopReason::EndTurn);
        }
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let found = SessionUpdate::AgentMessageChunk(text("The task finished."));
            let _ = say(&after, &its, found);
            if dies {
                // What it said gets out first.
                tokio::time::sleep(Duration::from_millis(200)).await;
                std::process::exit(3);
            }
            if asks {
                let tool = "check-2";
                let check = ToolCall::new(tool, "Run a check")
                    .kind(ToolKind::Execute)
                    .status(ToolCallStatus::Pending);
                let _ = say(&after, &its, SessionUpdate::ToolCall(check));
                let options = vec![
                    PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
                    PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
                ];
                let question = RequestPermissionRequest::new(
                    its.clone(),
                    ToolCallUpdate::new(tool, ToolCallUpdateFields::new().title("Run a check")),
                    options,
                );
                let allowed = match after.send_request(question).block_task().await {
                    Ok(answer) => matches!(
                        answer.outcome,
                        RequestPermissionOutcome::Selected(selected)
                            if selected.option_id.0.as_ref() == "allow"
                    ),
                    Err(_) => false,
                };
                let (status, reply) = if allowed {
                    (ToolCallStatus::Completed, "The check passed.")
                } else {
                    (ToolCallStatus::Failed, "I did not run the check.")
                };
                let ran = ToolCallUpdate::new(tool, ToolCallUpdateFields::new().status(status));
                let _ = say(&after, &its, SessionUpdate::ToolCallUpdate(ran));
                let _ = say(&after, &its, SessionUpdate::AgentMessageChunk(text(reply)));
            }
            if quiet {
                return;
            }
            // What the cycle cost ends it, as Claude Code's result does.
            let cost = UsageUpdate::new(60_000, 200_000).cost(Cost::new(0.5, "USD"));
            let ended = SessionUpdate::UsageUpdate(cost);
            if !long {
                let _ = say(&after, &its, ended);
                return;
            }
            loop {
                tokio::time::sleep(Duration::from_millis(50)).await;
                if fake.running.lock().unwrap().contains_key(&its) {
                    return;
                }
                if fake.cancelled(&its) {
                    let _ = say(&after, &its, ended);
                    return;
                }
            }
        });
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Started a task.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("later") {
        // What it used, said after the turn ended, as Claude Code does
        // between turns.
        let (after, its) = (cx.clone(), session.clone());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let usage = UsageUpdate::new(150_000, 200_000);
            let _ = say(&after, &its, SessionUpdate::UsageUpdate(usage));
        });
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Done for now.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("new command") {
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Before")),
        )?;
        say(&cx, &session, commands(true))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(" and after.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("edit") {
        let diff = Diff::new("/work/notes.md", "one\n2\nthree\nfour\n")
            .old_text("one\ntwo\nthree\n".to_owned());
        let call = ToolCall::new("edit-1", "Edit notes.md")
            .kind(ToolKind::Edit)
            .status(ToolCallStatus::Completed)
            .content(vec![ToolCallContent::Diff(diff)]);
        say(&cx, &session, SessionUpdate::ToolCall(call))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("I edited notes.md.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("run") {
        let how = if words.contains("loud") {
            Run::Loud
        } else if words.contains("at once") {
            Run::AtOnce
        } else {
            Run::Quiet
        };
        run(&fake, &cx, &session, how).await?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("which session") {
        let reply = format!("Session {} in process {}", session.0, std::process::id());
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("propose") {
        let tool = "plan-1";
        let input = json!({ "plan": "# Tidy the notes\n\n1. Read them.\n2. Sort them." });
        say(
            &cx,
            &session,
            SessionUpdate::ToolCall(
                ToolCall::new(tool, "Approve Plan")
                    .kind(ToolKind::SwitchMode)
                    .status(ToolCallStatus::Pending)
                    .raw_input(input.clone()),
            ),
        )?;
        let options = vec![
            PermissionOption::new(
                "acceptEdits",
                "Yes, auto-accept edits",
                PermissionOptionKind::AllowAlways,
            ),
            PermissionOption::new(
                "default",
                "Yes, manually approve edits",
                PermissionOptionKind::AllowOnce,
            ),
            PermissionOption::new(
                "plan",
                "No, keep planning",
                PermissionOptionKind::RejectOnce,
            ),
        ];
        let fields = ToolCallUpdateFields::new()
            .title("Approve Plan")
            .kind(ToolKind::SwitchMode)
            .raw_input(input);
        let question = RequestPermissionRequest::new(
            session.clone(),
            ToolCallUpdate::new(tool, fields),
            options,
        );
        let answer = cx.send_request(question).block_task().await?;
        let RequestPermissionOutcome::Selected(selected) = answer.outcome else {
            return Ok(StopReason::Cancelled);
        };
        if selected.option_id.0.as_ref() == "plan" {
            return Ok(StopReason::Cancelled);
        }
        if let Some(update) = fake.leave_plan(&session) {
            say(&cx, &session, update)?;
        }
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("The notes are tidy.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("ask") {
        let tool = "check-1";
        say(
            &cx,
            &session,
            SessionUpdate::ToolCall(
                ToolCall::new(tool, "Run a check")
                    .kind(ToolKind::Execute)
                    .status(ToolCallStatus::Pending),
            ),
        )?;
        let options = vec![
            PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
            PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways),
            PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
        ];
        let question = RequestPermissionRequest::new(
            session.clone(),
            ToolCallUpdate::new(tool, ToolCallUpdateFields::new().title("Run a check")),
            options,
        );
        let answer = cx.send_request(question).block_task().await?;
        let allowed = match answer.outcome {
            RequestPermissionOutcome::Cancelled => return Ok(StopReason::Cancelled),
            RequestPermissionOutcome::Selected(selected) => {
                selected.option_id.0.as_ref() != "reject"
            }
            _ => false,
        };
        let (status, reply) = if allowed {
            (ToolCallStatus::Completed, "The check passed.")
        } else {
            (ToolCallStatus::Failed, "I did not run the check.")
        };
        say(
            &cx,
            &session,
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                tool,
                ToolCallUpdateFields::new().status(status),
            )),
        )?;
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(reply)))?;
        return Ok(StopReason::EndTurn);
    }
    say(
        &cx,
        &session,
        SessionUpdate::AgentThoughtChunk(text("Reading the request.")),
    )?;
    for piece in ["You said: ", &words] {
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(piece)))?;
    }
    Ok(StopReason::EndTurn)
}

/// Runs the tests as Codex shows a command: its output in pieces, then how
/// it exited; as one block of text at the end for a client that does not
/// take pieces. Loud, it prints far more than a Thread keeps.
/// How the fake runs a command.
#[derive(Clone, Copy, PartialEq)]
enum Run {
    /// Two lines, sent as they are printed, as Codex sends them.
    Quiet,
    /// More than Banda keeps, in large pieces.
    Loud,
    /// As Claude Code sends it: all it printed once it is done, then the
    /// terminal; here with an exit it does not know.
    AtOnce,
}

async fn run(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    how: Run,
) -> Result<(), Error> {
    let id = "run-1";
    let terminal = || vec![ToolCallContent::Terminal(Terminal::new(id))];
    let call = ToolCall::new(id, "Run the tests")
        .kind(ToolKind::Execute)
        .status(ToolCallStatus::InProgress);
    let call = if how == Run::AtOnce {
        call
    } else {
        call.content(terminal())
    };
    say(cx, session, SessionUpdate::ToolCall(call))?;
    let lines: Vec<String> = match how {
        // Seventy pieces of a thousand lines: over 4 MB.
        Run::Loud => (0..70)
            .map(|piece| {
                (0..1000)
                    .map(|n| format!("{:>6} {}\n", piece * 1000 + n, "x".repeat(60)))
                    .collect()
            })
            .collect(),
        Run::Quiet => vec!["test one ... ok\n".into(), "test two ... ok\n".into()],
        Run::AtOnce => vec!["test one ... ok\ntest two ... ok\n".into()],
    };
    let pieces = fake.output.load(Ordering::Relaxed);
    if pieces {
        for line in &lines {
            let meta = json!({ "terminal_output_delta": { "terminal_id": id, "data": line } });
            let update = ToolCallUpdate::new(id, ToolCallUpdateFields::new())
                .meta(meta.as_object().cloned());
            say(cx, session, SessionUpdate::ToolCallUpdate(update))?;
        }
    }
    let ended = ToolCallUpdateFields::new().status(ToolCallStatus::Completed);
    let ended = if !pieces {
        let block = format!("```console\n{}```", lines.concat());
        ended.content(vec![block.into()])
    } else if how == Run::AtOnce {
        ended.content(terminal())
    } else {
        ended
    };
    let code = if how == Run::AtOnce {
        json!(null)
    } else {
        json!(0)
    };
    let exit = json!({ "terminal_exit": { "terminal_id": id, "exit_code": code, "signal": null } });
    let update = ToolCallUpdate::new(id, ended).meta(exit.as_object().cloned());
    say(cx, session, SessionUpdate::ToolCallUpdate(update))?;
    say(
        cx,
        session,
        SessionUpdate::AgentMessageChunk(text("The tests passed.")),
    )?;
    Ok(())
}

/// Asks a colour as Claude Code asks its questions: the choice, and an
/// "Other" answer beside it. What to reply.
async fn choose(
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    quickly: bool,
) -> Result<String, Error> {
    let colour = StringPropertySchema::new().title("Colour").one_of(vec![
        EnumOption::new("Red", "Red"),
        EnumOption::new("Blue", "Blue").description("Like the sea"),
    ]);
    let other = StringPropertySchema::new().title("Other");
    let schema = ElicitationSchema::new()
        .property("question_0", colour, false)
        .property("question_0_custom", other, false);
    let scope = ElicitationSessionScope::new(session.clone()).tool_call_id("ask-1");
    let form = ElicitationFormMode::new(scope, schema);
    let request = CreateElicitationRequest::new(form, "Which colour?");
    let asked = cx.send_request(request);
    if quickly {
        let give_up = asked.cancellation_handle();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = give_up.cancel();
        });
    }
    let answer = asked.block_task().await?;
    Ok(match answer.action {
        ElicitationAction::Accept(accepted) => {
            let content = accepted.content.unwrap_or_default();
            let said = |key: &str| match content.get(key) {
                Some(ElicitationContentValue::String(s)) if !s.is_empty() => Some(s.clone()),
                _ => None,
            };
            match said("question_0_custom").or_else(|| said("question_0")) {
                Some(colour) => format!("You chose {colour}."),
                None => "You chose nothing.".to_owned(),
            }
        }
        ElicitationAction::Decline => "You skipped the question.".to_owned(),
        _ => "The question was cancelled.".to_owned(),
    })
}

/// The file that says its Person signed in, when it has an account.
fn account() -> Option<std::path::PathBuf> {
    std::env::var_os("FAKE_AGENT_HOME").map(|home| std::path::Path::new(&home).join("signed-in"))
}

/// Signs in in a terminal, as `claude auth login` does: the Person pastes
/// the code the browser shows. It ends with code 0 when the code is right.
fn sign_in_in_a_terminal() -> ! {
    use std::io::{BufRead, Write};
    let Some(signed_in) = account() else {
        eprintln!("This fake agent has no account: set FAKE_AGENT_HOME.");
        std::process::exit(2);
    };
    print!("Open https://example.invalid/fake-sign-in to sign in.\r\nPaste the code: ");
    let _ = std::io::stdout().flush();
    let mut code = String::new();
    let _ = std::io::stdin().lock().read_line(&mut code);
    if code.trim() != "fake-code" {
        print!("That code is wrong.\r\n");
        std::process::exit(1);
    }
    std::fs::write(&signed_in, "yes").expect("the fake agent's home takes its account");
    print!("Signed in.\r\n");
    std::process::exit(0);
}

/// Whether this run lost the sessions of earlier runs.
fn forgets() -> bool {
    std::env::var_os("FAKE_AGENT_FORGETS").is_some()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    if std::env::args().any(|arg| arg == "--sign-in") {
        sign_in_in_a_terminal();
    }
    if let Some(recording) = std::env::var_os("FAKE_AGENT_REPLAY") {
        let recording = std::path::Path::new(&recording);
        if let Err(error) = replay::replay(recording).await {
            eprintln!(
                "The fake agent cannot replay {}: {error}",
                recording.display()
            );
            std::process::exit(1);
        }
        return Ok(());
    }
    let fake = Fake::default();
    let signed_in = account().is_none_or(|signed_in| signed_in.exists());
    fake.signed_in.store(signed_in, Ordering::Relaxed);
    Agent
        .builder()
        .name("banda-fake-agent")
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            cx: ConnectionTo<Client>| {
                    let shows = request.client_capabilities.session.as_ref();
                    let notices = shows.is_some_and(|s| s.notices.is_some());
                    fake.notices.store(notices, Ordering::Relaxed);
                    let options = shows.and_then(|s| s.config_options.as_ref());
                    let toggles = options.is_some_and(|o| o.boolean.is_some());
                    fake.toggles.store(toggles, Ordering::Relaxed);
                    let elicitation = request.client_capabilities.elicitation.as_ref();
                    let forms = elicitation.is_some_and(|e| e.form.is_some());
                    fake.forms.store(forms, Ordering::Relaxed);
                    let meta = request.client_capabilities.meta.as_ref();
                    let output = meta.and_then(|m| m.get("terminal_output_delta"));
                    fake.output
                        .store(output == Some(&json!(true)), Ordering::Relaxed);
                    let protocol = if request.protocol_version >= ProtocolVersion::V1 {
                        ProtocolVersion::V1
                    } else {
                        request.protocol_version
                    };
                    let images = std::env::var_os("FAKE_AGENT_NO_IMAGES").is_none();
                    let steers = std::env::var_os("FAKE_AGENT_NO_STEERING").is_none();
                    let meta = json!({ "steering": { "supported": steers } });
                    let mut capabilities = AgentCapabilities::new()
                        .prompt_capabilities(PromptCapabilities::new().image(images))
                        .load_session(true)
                        .session_capabilities(
                            SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
                        );
                    let mut ways = Vec::new();
                    let has_account = account().is_some();
                    if has_account {
                        capabilities = capabilities
                            .auth(AgentAuthCapabilities::new().logout(LogoutCapabilities::new()))
                            .meta(json!({ "authStatus": {} }).as_object().cloned());
                        if request.client_capabilities.auth.terminal {
                            ways.push(AuthMethod::Terminal(
                                AuthMethodTerminal::new("fake-sign-in", "Fake account")
                                    .description("Paste a code from the browser")
                                    .args(vec!["--sign-in".to_owned()]),
                            ));
                        }
                        ways.push(AuthMethod::Agent(AuthMethodAgent::new(
                            "fake-browser",
                            "Fake browser",
                        )));
                    }
                    responder.respond(
                        InitializeResponse::new(protocol)
                            .auth_methods(ways)
                            .agent_capabilities(capabilities)
                            .meta(meta.as_object().cloned())
                            .agent_info(Implementation::new(
                                "banda-fake-agent",
                                env!("CARGO_PKG_VERSION"),
                            )),
                    )?;
                    // Once it started, as Claude Code's adapter does.
                    match has_account {
                        true => report(&cx, fake.signed_in.load(Ordering::Relaxed)),
                        false => Ok(()),
                    }
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: AuthenticateRequest,
                            responder: Responder<AuthenticateResponse>,
                            cx: ConnectionTo<Client>| {
                    match account() {
                        Some(signed_in) if &*request.method_id.0 == "fake-browser" => {
                            std::fs::write(signed_in, "yes")
                                .map_err(|_| Error::internal_error())?;
                            fake.signed_in.store(true, Ordering::Relaxed);
                            responder.respond(AuthenticateResponse::new())?;
                            report(&cx, true)
                        }
                        _ => responder.respond_with_error(Error::invalid_params()),
                    }
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |_request: LogoutRequest,
                            responder: Responder<LogoutResponse>,
                            cx: ConnectionTo<Client>| {
                    let Some(signed_in) = account() else {
                        return responder.respond_with_error(Error::method_not_found());
                    };
                    let _ = std::fs::remove_file(signed_in);
                    fake.signed_in.store(false, Ordering::Relaxed);
                    responder.respond(LogoutResponse::new())?;
                    report(&cx, false)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |_request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            cx: ConnectionTo<Client>| {
                    let number = fake.sessions.fetch_add(1, Ordering::Relaxed) + 1;
                    // Unique across processes, so a resumed session shows.
                    let id = SessionId::new(format!("fake-{}-{number}", std::process::id()));
                    let options = fake.options(&id);
                    responder
                        .respond(NewSessionResponse::new(id.clone()).config_options(options))?;
                    // Before any prompt, as Claude Code does.
                    say(&cx, &id, commands(false))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: ResumeSessionRequest,
                            responder: Responder<ResumeSessionResponse>,
                            _cx: ConnectionTo<Client>| {
                    if forgets() {
                        return responder.respond_with_error(Error::resource_not_found(None));
                    }
                    let options = fake.options(&request.session_id);
                    responder.respond(ResumeSessionResponse::new().config_options(options))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: LoadSessionRequest,
                            responder: Responder<LoadSessionResponse>,
                            _cx: ConnectionTo<Client>| {
                    if forgets() {
                        return responder.respond_with_error(Error::resource_not_found(None));
                    }
                    let options = fake.options(&request.session_id);
                    responder.respond(LoadSessionResponse::new().config_options(options))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: SetSessionConfigOptionRequest,
                            responder: Responder<SetSessionConfigOptionResponse>,
                            _cx: ConnectionTo<Client>| {
                    if let Err(error) = fake.set(&request) {
                        return responder.respond_with_error(error);
                    }
                    let options = fake.options(&request.session_id);
                    responder.respond(SetSessionConfigOptionResponse::new(options))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: PromptRequest,
                            responder: Responder<PromptResponse>,
                            cx: ConnectionTo<Client>| {
                    let session = request.session_id.clone();
                    fake.cancelled.lock().unwrap().remove(&session);
                    let (steer, steered) = mpsc::unbounded_channel();
                    fake.running.lock().unwrap().insert(session.clone(), steer);
                    let (fake, turn_cx) = (fake.clone(), cx.clone());
                    // The turn waits on the client, so it runs off the
                    // dispatch loop.
                    cx.spawn(async move {
                        let ended = turn(fake.clone(), turn_cx, request, steered).await;
                        fake.running.lock().unwrap().remove(&session);
                        match ended {
                            Ok(stop) => responder.respond(PromptResponse::new(stop)),
                            Err(error) => responder.respond_with_error(error),
                        }
                    })
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: SteeringRequest,
                            responder: Responder<SteeringResponse>,
                            _cx: ConnectionTo<Client>| {
                    let running = fake.running.lock().unwrap();
                    // As Claude Code's adapter: an idle session leaves the
                    // message to the client only when the client asks it to.
                    let leaves = request.meta["steering"]["idleBehavior"] == "promptRequired";
                    let outcome = match running.get(&request.session_id) {
                        Some(turn) if turn.send(words_of(&request.prompt)).is_ok() => "injected",
                        _ if leaves => "promptRequired",
                        _ => "startedNewTurn",
                    };
                    responder.respond(SteeringResponse {
                        outcome: outcome.to_owned(),
                    })
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            async move |cancel: CancelNotification, _cx: ConnectionTo<Client>| {
                fake.cancelled.lock().unwrap().insert(cancel.session_id);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_to(Stdio::new())
        .await
}
