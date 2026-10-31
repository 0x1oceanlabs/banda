//! A scripted ACP agent. It speaks ACP v1 over stdio like a real Harness,
//! and the words in a prompt choose what it does:
//!
//! - `ask`: starts a tool call and asks permission to run it. An allow runs
//!   it, a reject skips it, and a cancel ends the turn.
//! - `which settings`: replies with the session's mode, model and brevity.
//! - `plan done`: in the plan mode, switches to accepting edits, as Claude
//!   Code does when a Person accepts its plan.
//! - `quit`: ends the turn as cancelled, though nobody stopped it.
//! - `slow`: replies in forty pieces, fifty milliseconds apart, and stops
//!   early when cancelled.
//! - `fail`: answers the prompt with an error.
//! - `flaky`: fails the first time this process sees the prompt, and
//!   answers as anything else does after that.
//! - `sign in`: answers the prompt as a Harness whose Person signed out.
//! - `limit`: says the account's limit resets in an hour, as Claude Code
//!   does, then fails the prompt as one over its limit.
//! - `warn`: sends a notice, if the client shows them, then answers.
//! - `crash`: exits at once, as a Harness that dies would.
//! - `which session`: replies with the session's ID and its own process ID.
//! - anything else: a short thought, then a reply that quotes the prompt.
//!
//! Its sessions can be resumed or loaded after a restart, as a real
//! Harness keeps them on disk. With `FAKE_AGENT_FORGETS` set it refuses
//! both, as a Harness that lost them would.
//!
//! Each session has options as Claude Code's do: a `mode` with Claude
//! Code's modes, a `model`, and `brief`, on or off, for a client that shows
//! such options. With `FAKE_AGENT_NO_MODES` set it has no modes, as an ACP
//! agent other than Claude Code and Codex.

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ConfigOptionUpdate, ContentBlock, ContentChunk,
    Implementation, InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, Notice, NoticeSeverity, PermissionOption,
    PermissionOptionKind, PromptRequest, PromptResponse, RequestPermissionOutcome,
    RequestPermissionRequest, ResumeSessionRequest, ResumeSessionResponse, SessionCapabilities,
    SessionConfigOption, SessionConfigOptionCategory, SessionConfigOptionValue,
    SessionConfigSelectOption, SessionId, SessionNotification, SessionResumeCapabilities,
    SessionUpdate, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, StopReason,
    TextContent, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UsageUpdate,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Responder, Stdio};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    setups: Arc<Mutex<HashMap<SessionId, Setup>>>,
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

async fn turn(
    fake: Fake,
    cx: ConnectionTo<Client>,
    prompt: PromptRequest,
) -> Result<StopReason, Error> {
    let session = prompt.session_id.clone();
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
    if words.contains("sign in") {
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
        let planned = {
            let mut setups = fake.setups.lock().unwrap();
            let setup = setups.entry(session.clone()).or_default();
            let planned = setup.mode == "plan";
            if planned {
                setup.mode = "acceptEdits".into();
            }
            planned
        };
        if planned {
            let update = ConfigOptionUpdate::new(fake.options(&session));
            say(&cx, &session, SessionUpdate::ConfigOptionUpdate(update))?;
        }
        let reply = if planned {
            "The plan is ready."
        } else {
            "There was no plan."
        };
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(reply)))?;
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

/// Whether this run lost the sessions of earlier runs.
fn forgets() -> bool {
    std::env::var_os("FAKE_AGENT_FORGETS").is_some()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let fake = Fake::default();
    Agent
        .builder()
        .name("bandaso-fake-agent")
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            _cx: ConnectionTo<Client>| {
                    let shows = request.client_capabilities.session.as_ref();
                    let notices = shows.is_some_and(|s| s.notices.is_some());
                    fake.notices.store(notices, Ordering::Relaxed);
                    let options = shows.and_then(|s| s.config_options.as_ref());
                    let toggles = options.is_some_and(|o| o.boolean.is_some());
                    fake.toggles.store(toggles, Ordering::Relaxed);
                    let protocol = if request.protocol_version >= ProtocolVersion::V1 {
                        ProtocolVersion::V1
                    } else {
                        request.protocol_version
                    };
                    let capabilities = AgentCapabilities::new()
                        .load_session(true)
                        .session_capabilities(
                            SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
                        );
                    responder.respond(
                        InitializeResponse::new(protocol)
                            .agent_capabilities(capabilities)
                            .agent_info(Implementation::new(
                                "bandaso-fake-agent",
                                env!("CARGO_PKG_VERSION"),
                            )),
                    )
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |_request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            _cx: ConnectionTo<Client>| {
                    let number = fake.sessions.fetch_add(1, Ordering::Relaxed) + 1;
                    // Unique across processes, so a resumed session shows.
                    let id = SessionId::new(format!("fake-{}-{number}", std::process::id()));
                    let options = fake.options(&id);
                    responder.respond(NewSessionResponse::new(id).config_options(options))
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
                    fake.cancelled.lock().unwrap().remove(&request.session_id);
                    let (fake, turn_cx) = (fake.clone(), cx.clone());
                    // The turn waits on the client, so it runs off the
                    // dispatch loop.
                    cx.spawn(async move {
                        match turn(fake, turn_cx, request).await {
                            Ok(stop) => responder.respond(PromptResponse::new(stop)),
                            Err(error) => responder.respond_with_error(error),
                        }
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
