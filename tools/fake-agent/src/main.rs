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
//! - `steps`: makes a plan of three steps and does them one by one; the
//!   context is then a quarter full. With `clear`, it clears the plan.
//! - `clear`: clears a plan it never made.
//! - `twice`: says two messages, told apart only by their IDs.
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
//! Its sessions can be resumed or loaded after a restart, as a real
//! Harness keeps them on disk. With `FAKE_AGENT_FORGETS` set it refuses
//! both, as a Harness that lost them would.
//!
//! Each session has options as Claude Code's do: a `mode` with Claude
//! Code's modes, a `model`, and `brief`, on or off, for a client that shows
//! such options. With `FAKE_AGENT_NO_MODES` set it has no modes, as an ACP
//! agent other than Claude Code and Codex. With `FAKE_AGENT_NO_IMAGES` set
//! it takes no images.

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, AvailableCommand, AvailableCommandInput, AvailableCommandsUpdate,
    CancelNotification, ConfigOptionUpdate, ContentBlock, ContentChunk, Cost,
    CreateElicitationRequest, Diff, ElicitationAction, ElicitationContentValue,
    ElicitationFormMode, ElicitationSchema, ElicitationSessionScope, EnumOption, Implementation,
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse, MessageId,
    NewSessionRequest, NewSessionResponse, Notice, NoticeSeverity, PermissionOption,
    PermissionOptionKind, Plan, PlanEntry, PlanEntryPriority, PlanEntryStatus, PromptCapabilities,
    PromptRequest, PromptResponse, RequestPermissionOutcome, RequestPermissionRequest,
    ResumeSessionRequest, ResumeSessionResponse, SessionCapabilities, SessionConfigOption,
    SessionConfigOptionCategory, SessionConfigOptionValue, SessionConfigSelectOption, SessionId,
    SessionNotification, SessionResumeCapabilities, SessionUpdate, SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse, StopReason, StringPropertySchema, Terminal, TextContent,
    ToolCall, ToolCallContent, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UnstructuredCommandInput, UsageUpdate,
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
    /// The client shows forms.
    forms: Arc<AtomicBool>,
    /// The client takes what a command prints in pieces.
    output: Arc<AtomicBool>,
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
    /// More than Bandaso keeps, in large pieces.
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
                    let capabilities = AgentCapabilities::new()
                        .prompt_capabilities(PromptCapabilities::new().image(images))
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
