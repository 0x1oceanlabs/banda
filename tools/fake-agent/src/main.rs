//! A scripted ACP agent. It speaks ACP v1 over stdio like a real Harness,
//! and the words in a prompt choose what it does:
//!
//! - `tool images`: starts and updates a tool with text, valid images and
//!   an invalid image; `update only` omits the initial call.
//! - `ask`: starts a tool call and asks permission to run it. An allow runs
//!   it, a reject skips it, and a cancel ends the turn.
//! - `choose`: asks for a colour with a form, as Claude Code asks its own
//!   questions, and replies with the answer, or that the Person skipped.
//!   `quickly`, it stops waiting after 300 milliseconds, as Codex does when
//!   a question times out. `drinks` asks a second question, of any of its
//!   choices, as a multiSelect asks.
//! - `which settings`: replies with the session's mode, model and brevity.
//! - `which effort`: replies with the session's effort and whether it is fast.
//! - `plan done`: in the plan mode, switches to accepting edits, as Claude
//!   Code does when a Person accepts its plan.
//! - `propose`: asks to leave plan mode with its plan, as Claude Code does.
//!   An answer that allows it switches to accepting edits and carries the
//!   plan out; "keep planning" ends the turn as cancelled.
//! - `quit`: ends the turn as cancelled, though nobody stopped it.
//! - `slow`: replies in forty pieces, fifty milliseconds apart, and stops
//!   early when cancelled.
//! - `pages`: works on until a file `go` is in the session's folder, takes
//!   it, then says paragraphs `page 0 of 30` on; `pages 2` says two.
//! - `wait`: says it waits, then waits for a message sent into its turn
//!   (`_session/steering`) and replies to that, or stops when cancelled.
//!   A message sent into any other turn is taken and goes unanswered.
//! - `fail`: answers the prompt with an error.
//! - `flaky`: fails the first time this process sees the prompt, and
//!   answers as anything else does after that.
//! - `sign in`: answers the prompt as a Harness whose Person signed out.
//! - `limit`: says the account's limit resets in an hour, as Claude Code
//!   does, then fails the prompt as one over its limit. `limit wait`, it
//!   waits on its limit instead, until a message is sent into its turn,
//!   and replies.
//! - `warn`: sends a notice, if the client shows them, then answers.
//! - `crash`: exits at once, as a Harness that dies would.
//! - `which session`: replies with the session's ID and its own process ID.
//! - `how many turns`: replies with how many turns run now, its own
//!   among them, and how many sessions were closed (`session/close`).
//! - `steps`: makes a plan of three steps and does them one by one; the
//!   context is then a quarter full. With `clear`, it clears the plan.
//! - `clear`: clears a plan it never made.
//! - `twice`: says two messages, told apart only by their IDs.
//! - `background`: starts a task, ends the turn, and goes on by itself when
//!   the task ends, as Claude Code does; `long`, until it is stopped or a
//!   prompt takes it in; `asks`, asking to run a check; `quiet`, never
//!   saying what that cost; `dies`, ending its process; `at once`, going
//!   on right after its answer, with no frame between, before Banda wrote
//!   how the turn ended; `on cue`, going on once a file `cue` is in the
//!   session's folder, which it takes. `background detached` runs a
//!   command that ends after the turn, and nothing more.
//! - `later`: says what it used after the turn has ended.
//! - `sub-agents`: starts a sub-agent that reads `a.txt`, as Claude Code's
//!   Agent tool does: in a session of its own for a client that shows
//!   sub-agents, else as a `think` call with its calls in the turn. The
//!   words after it change that, and combine: `three`, `asks`, `form`,
//!   `fails`, `nested`, `outlive`, `again`, `slow`, `codex`, `unknown`,
//!   `refuses`, `load`, `late`, `background`, `edit` and `dies` (see
//!   [`subagents`]).
//! - `edit`: edits a file, and shows the change as a diff.
//! - `walk`: reads `notes.md`, then edits `src/util.ts`, naming each file
//!   and its line, a step each time a message is sent into its turn.
//! - `cat`, first, and files in its folder, as `@` names them or not:
//!   reads each from its own machine's disk, naming each file it read,
//!   and replies with what each holds (`who.txt holds arc.`), so a test
//!   sees whose file it was.
//! - `doing` and `read`, `edit`, `delete`, `move`, `search`, `execute`,
//!   `fetch` or `other`, then what it works on: works on a tool call of
//!   that kind, named as Claude Code names it (`doing read card.ts`,
//!   `doing execute pnpm test`, `doing search standOf`, `doing fetch
//!   docs.rs`), until a message is sent into its turn. `doing think` and
//!   `doing reply` say a piece of a thought or of the reply instead, and
//!   `doing compact` compacts the context as Claude Code says it does.
//!   Another `doing …` moves on to that; anything else ends the call and
//!   replies.
//! - `silent` and a number: says nothing for that many seconds, then
//!   replies.
//! - `run`: runs the tests, printing as Codex does; `loud` far more than a
//!   Thread keeps; `at once` as Claude Code does, all at the end.
//! - `new command`: starts its reply, learns the command `/init`, and ends
//!   the reply.
//! - `remember` and a word: keeps the word, and says it did in a reply
//!   with an ID of its own; `what do you remember` replies with the words
//!   the session keeps. A fork of a session keeps what it kept, up to the
//!   reply it is forked at, named by its ID in `_meta.jetbrains.air.fork`,
//!   as Claude Code's and Codex's adapters take it.
//! - images: it says how many it was shown and of what kinds, then does
//!   what the words ask.
//! - anything else: a short thought, then a reply that quotes the prompt.
//!
//! The words are the Person's message's: the notices Banda puts before it
//! ask nothing, as its Agent is told, so no word of theirs chooses what it
//! does, as one in the folders a moved Thread's notice names: a Windows
//! runner's `runneradmin` holds `run`. It still quotes them.
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
//! both, as a Harness that lost them would, and with
//! `FAKE_AGENT_NO_RESUME` set it offers only to load them, as an ACP agent
//! with no resume. With `FAKE_AGENT_SESSIONS` naming a folder it keeps
//! there the sub-agents `sub-agents load` announced, so that a load in a
//! later process replays them. `FAKE_AGENT_OUTLIVES_BY` says how many
//! milliseconds a sub-agent of `sub-agents outlive` goes on after its
//! turn's answer.
//!
//! Each session has options as Claude Code's do: a `mode` with Claude
//! Code's modes, a `model`, an `effort`, and `fast` and `brief`, on or off,
//! for a client that shows such options. With `FAKE_AGENT_MINI` set its
//! models end with a small one, `mini`, as Codex's do. With `FAKE_AGENT_NO_MODES` set it has no modes, as an ACP
//! agent other than Claude Code and Codex. With `FAKE_AGENT_NO_IMAGES` set
//! it takes no images, and with `FAKE_AGENT_NO_STEERING` no message into a
//! running turn.
//!
//! With `FAKE_AGENT_MCP` naming a file it writes there the MCP servers a
//! new session was given, as JSON, so a test can start them as a Harness
//! would. With `FAKE_AGENT_ROOTS` naming a file it writes there the extra
//! roots (`additionalDirectories`) a new session was given, as JSON. With
//! `FAKE_AGENT_SHELLS` naming a file it writes there, as JSON, what the
//! shell of the last session it opened (new, forked, resumed or loaded)
//! would be handed for `banda`: `process`, `BANDA_TOKEN` and
//! `BANDA_ENGINE` as its own environment has them, and `session`, the
//! request's `_meta.claudeCode.options.env`, which Claude Code's adapter
//! sets over them; and what it would load of the Project's folder:
//! `untrusted`, `BANDA_UNTRUSTED` as its environment has it, and
//! `sources`, the request's `_meta.claudeCode.options.settingSources`.
//!
//! With `FAKE_AGENT_REPLAY` naming a recording it plays a real Harness's
//! conversation instead: see [`replay`].

mod replay;
mod subagents;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentAuthCapabilities, AgentCapabilities, AuthMethod, AuthMethodAgent, AuthMethodTerminal,
    AuthenticateRequest, AuthenticateResponse, AvailableCommand, AvailableCommandInput,
    AvailableCommandsUpdate, CancelNotification, CloseSessionRequest, CloseSessionResponse,
    ConfigOptionUpdate, Content, ContentBlock, ContentChunk, Cost, CreateElicitationRequest, Diff,
    ElicitationAction, ElicitationContentValue, ElicitationFormMode, ElicitationSchema,
    ElicitationSessionScope, EnumOption, ForkSessionRequest, ForkSessionResponse, ImageContent,
    Implementation, InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    LogoutCapabilities, LogoutRequest, LogoutResponse, MessageId, MultiSelectPropertySchema,
    NewSessionRequest, NewSessionResponse, Notice, NoticeSeverity, PermissionOption,
    PermissionOptionKind, Plan, PlanEntry, PlanEntryPriority, PlanEntryStatus, PromptCapabilities,
    PromptRequest, PromptResponse, RequestPermissionOutcome, RequestPermissionRequest,
    ResumeSessionRequest, ResumeSessionResponse, SessionCapabilities, SessionCloseCapabilities,
    SessionConfigOption, SessionConfigOptionCategory, SessionConfigOptionValue,
    SessionConfigSelectOption, SessionForkCapabilities, SessionId, SessionNotification,
    SessionResumeCapabilities, SessionUpdate, SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse, StopReason, StringPropertySchema, Terminal, TextContent,
    ToolCall, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolCallUpdate,
    ToolCallUpdateFields, ToolKind, UnstructuredCommandInput, UsageUpdate,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Responder, Stdio};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::pin::Pin;
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
    /// How many sessions the client closed.
    closed: Arc<AtomicU64>,
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
    /// The client shows sub-agents, each in a session of its own.
    subagents: Arc<AtomicBool>,
    /// The turn each session runs, by where a message sent into it goes.
    running: Arc<Mutex<HashMap<SessionId, mpsc::UnboundedSender<String>>>>,
    setups: Arc<Mutex<HashMap<SessionId, Setup>>>,
    /// Its Person signed in, as it read when it started or signed in since.
    signed_in: Arc<AtomicBool>,
    /// The words each session was asked to remember, each with the ID of
    /// the reply that said so.
    kept: Arc<Mutex<HashMap<SessionId, Vec<Kept>>>>,
}

/// A word a session was asked to remember, and the ID of the reply that
/// said so.
type Kept = (String, String);

/// What a session runs with.
#[derive(Clone)]
struct Setup {
    mode: String,
    model: String,
    effort: String,
    fast: bool,
    brief: bool,
    /// The folder it works in.
    folder: std::path::PathBuf,
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            mode: "default".into(),
            model: "fast".into(),
            effort: "medium".into(),
            fast: false,
            brief: false,
            folder: Default::default(),
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
const MODELS: [(&str, &str); 3] = [("fast", "Fast"), ("smart", "Smart"), ("mini", "Mini")];

/// Its models: the small one only with `FAKE_AGENT_MINI` set.
fn models() -> &'static [(&'static str, &'static str)] {
    match std::env::var_os("FAKE_AGENT_MINI") {
        Some(_) => &MODELS,
        None => &MODELS[..2],
    }
}
const EFFORTS: [(&str, &str); 4] = [
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("max", "Max"),
];

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

    /// `session` works in `folder`.
    fn at_folder(&self, session: SessionId, folder: std::path::PathBuf) {
        (self.setups.lock().unwrap())
            .entry(session)
            .or_default()
            .folder = folder;
    }

    fn setup(&self, session: &SessionId) -> Setup {
        let mut setups = self.setups.lock().unwrap();
        setups.entry(session.clone()).or_default().clone()
    }

    /// A new session's ID, unique across processes, so a resumed session
    /// shows.
    fn new_session(&self) -> SessionId {
        let number = self.sessions.fetch_add(1, Ordering::Relaxed) + 1;
        SessionId::new(format!("fake-{}-{number}", std::process::id()))
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
            SessionConfigOption::select("model", "Model", setup.model, select(models()))
                .category(SessionConfigOptionCategory::Model),
        );
        options.push(
            SessionConfigOption::select("effort", "Effort", setup.effort, select(&EFFORTS))
                .category(SessionConfigOptionCategory::ThoughtLevel),
        );
        if self.toggles.load(Ordering::Relaxed) {
            options.push(
                SessionConfigOption::boolean("fast", "Fast mode", setup.fast)
                    .category(SessionConfigOptionCategory::Other("model_config".into())),
            );
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
            "model" => setup.model = choose(models(), &request.value)?,
            "effort" => setup.effort = choose(&EFFORTS, &request.value)?,
            "fast" => setup.fast = on_off(&request.value)?,
            _ => setup.brief = on_off(&request.value)?,
        }
        Ok(())
    }
}

fn on_off(value: &SessionConfigOptionValue) -> Result<bool, Error> {
    value
        .as_bool()
        .ok_or_else(|| Error::invalid_params().data("on or off"))
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

/// Its commands, a skill among them; with `/init` once it has learned
/// that.
fn commands(learned: bool) -> SessionUpdate {
    let mut all = vec![
        AvailableCommand::new("review", "Review the changes so far").input(
            AvailableCommandInput::Unstructured(UnstructuredCommandInput::new("what to look at")),
        ),
        AvailableCommand::new("compact", "Make room in the context"),
        // A skill, named as Codex names one.
        AvailableCommand::new("$explain", "Explain the code it is pointed at"),
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

/// The Person's message in `said`, a prompt's words, past the notices
/// Banda puts before it (the agents engine's `notices::before`).
fn asked(said: &str) -> &str {
    const NOTICES: &str = "Since your last turn, Banda told your Person this";
    match said.strip_prefix(NOTICES) {
        Some(notices) => notices.split_once("\n\n").map_or(said, |(_, asked)| asked),
        None => said,
    }
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

/// Waits for a message sent into the turn, and gives its words; none when
/// the turn is cancelled first.
async fn steered_on(
    fake: &Fake,
    session: &SessionId,
    steered: &mut mpsc::UnboundedReceiver<String>,
) -> Option<String> {
    loop {
        if fake.cancelled(session) {
            return None;
        }
        let heard = tokio::time::timeout(Duration::from_millis(50), steered.recv()).await;
        if let Ok(Some(words)) = heard {
            return Some(words);
        }
    }
}

/// `walk`: reads `notes.md` at its second line, then, once a message is
/// sent into its turn, appends a line to `src/util.ts` and shows the
/// change, naming each file and line as a real Harness does (ACP's
/// locations); once another comes, it says it is done.
async fn walk(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    steered: &mut mpsc::UnboundedReceiver<String>,
) -> Result<StopReason, Error> {
    let folder = fake.setup(session).folder;
    let notes = folder.join("notes.md");
    let read = ToolCall::new("walk-read", "Read notes.md")
        .kind(ToolKind::Read)
        .status(ToolCallStatus::Completed)
        .locations(vec![ToolCallLocation::new(notes).line(2)]);
    say(cx, session, SessionUpdate::ToolCall(read))?;
    if steered_on(fake, session, steered).await.is_none() {
        return Ok(StopReason::Cancelled);
    }
    let edit = util_edit("walk-edit", &folder, "export const three = 3", Some(2));
    say(cx, session, SessionUpdate::ToolCall(edit))?;
    if steered_on(fake, session, steered).await.is_none() {
        return Ok(StopReason::Cancelled);
    }
    say(
        cx,
        session,
        SessionUpdate::AgentMessageChunk(text("I walked the files.")),
    )?;
    Ok(StopReason::EndTurn)
}

/// The call `id` that adds `added` as a line of `src/util.ts` in `folder`,
/// and shows the change, named at `line`, else at the line it adds. It
/// writes only in the session's folder: a session it resumed has none
/// here.
fn util_edit(
    id: impl Into<String>,
    folder: &std::path::Path,
    added: &str,
    line: Option<u32>,
) -> ToolCall {
    let util = folder.join("src/util.ts");
    let old = std::fs::read_to_string(&util).ok();
    let new = format!("{}{added}\n", old.clone().unwrap_or_default());
    if folder.is_absolute() {
        let _ = std::fs::write(&util, &new);
    }
    let line = line.unwrap_or_else(|| u32::try_from(new.lines().count()).unwrap_or(1));
    ToolCall::new(id.into(), "Edit src/util.ts")
        .kind(ToolKind::Edit)
        .status(ToolCallStatus::Completed)
        .locations(vec![ToolCallLocation::new(util.clone()).line(line)])
        .content(vec![ToolCallContent::Diff(
            Diff::new(util, new).old_text(old),
        )])
}

/// Whether the client answers `question` with one of the options
/// `allowing` names; a question it fails to answer allows nothing.
async fn allowed(
    cx: &ConnectionTo<Client>,
    question: RequestPermissionRequest,
    allowing: &[&str],
) -> bool {
    match cx.send_request(question).block_task().await {
        Ok(answer) => matches!(
            answer.outcome,
            RequestPermissionOutcome::Selected(selected)
                if allowing.contains(&selected.option_id.0.as_ref())
        ),
        Err(_) => false,
    }
}

/// The files a prompt that starts with `cat` names, each as the Person
/// wrote it, without the `@` a Message box's chip puts before it.
fn cat_of(words: &str) -> Option<Vec<String>> {
    let mut words = words.split_whitespace();
    (words.next()? == "cat").then(|| {
        words
            .map(|name| name.trim_start_matches('@').to_owned())
            .collect()
    })
}

/// `cat`: reads each of `names` in the session's folder, as a real
/// Harness reads on the machine it runs on, naming the whole path it read
/// (ACP's locations), and replies with what each holds.
fn cat(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    names: &[String],
) -> Result<StopReason, Error> {
    let folder = fake.setup(session).folder;
    let mut said = Vec::new();
    for (at, name) in names.iter().enumerate() {
        let file = folder.join(name);
        let read = ToolCall::new(format!("cat-{at}"), format!("Read {name}"))
            .kind(ToolKind::Read)
            .status(ToolCallStatus::Completed)
            .locations(vec![ToolCallLocation::new(file.clone())]);
        say(cx, session, SessionUpdate::ToolCall(read))?;
        said.push(match std::fs::read_to_string(&file) {
            Ok(held) => format!("{name} holds {}.", held.trim()),
            Err(_) => format!("{name} is not there."),
        });
    }
    say(
        cx,
        session,
        SessionUpdate::AgentMessageChunk(text(&said.join(" "))),
    )?;
    Ok(StopReason::EndTurn)
}

/// What `doing` names in `words`: a tool call of a kind, a thought, the
/// reply, or the context compacted.
#[derive(Clone, Copy, PartialEq)]
enum Doing {
    Call(ToolKind),
    Think,
    Reply,
    Compact,
}

/// What `doing` names in `words`, and what it works on.
fn doing_of(words: &str) -> Option<(Doing, String)> {
    let mut after = words.split_whitespace().skip_while(|word| *word != "doing");
    let doing = match after.nth(1)? {
        "read" => Doing::Call(ToolKind::Read),
        "edit" => Doing::Call(ToolKind::Edit),
        "delete" => Doing::Call(ToolKind::Delete),
        "move" => Doing::Call(ToolKind::Move),
        "search" => Doing::Call(ToolKind::Search),
        "execute" => Doing::Call(ToolKind::Execute),
        "fetch" => Doing::Call(ToolKind::Fetch),
        "other" => Doing::Call(ToolKind::Other),
        "think" => Doing::Think,
        "reply" => Doing::Reply,
        "compact" => Doing::Compact,
        _ => return None,
    };
    Some((doing, after.collect::<Vec<_>>().join(" ")))
}

/// The tool call `doing` makes of `kind` on `on`, titled as Claude Code
/// titles its own: a file's by its path, a search by its pattern, a fetch
/// by its address, a command as it is.
fn call_of(id: String, kind: ToolKind, on: &str, folder: &std::path::Path) -> ToolCall {
    let title = match kind {
        ToolKind::Read => "Read",
        ToolKind::Edit => "Edit",
        ToolKind::Delete => "Delete",
        ToolKind::Move => "Move",
        ToolKind::Search => return ToolCall::new(id, format!("grep \"{on}\"")),
        ToolKind::Fetch => return ToolCall::new(id, format!("Fetch https://{on}")),
        _ => return ToolCall::new(id, on),
    };
    let place = ToolCallLocation::new(folder.join(on));
    ToolCall::new(id, format!("{title} {on}")).locations(vec![place])
}

/// `doing`: works on what each message names, a tool call as Claude Code
/// titles its calls, a thought, the reply or a compaction, until a message
/// names none (see the top).
async fn doing(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    mut words: String,
    steered: &mut mpsc::UnboundedReceiver<String>,
) -> Result<StopReason, Error> {
    let folder = fake.setup(session).folder;
    let mut calls = 0;
    while let Some((doing, on)) = doing_of(&words) {
        calls += 1;
        let id = format!("doing-{calls}");
        let running =
            |call: ToolCall| SessionUpdate::ToolCall(call.status(ToolCallStatus::InProgress));
        let update = match doing {
            Doing::Call(kind) => running(call_of(id.clone(), kind, &on, &folder).kind(kind)),
            // As Claude Code's adapter says it compacts: a call of its tool
            // `compact`.
            Doing::Compact => {
                let meta = json!({ "claudeCode": { "toolName": "compact" } });
                running(ToolCall::new(id.clone(), "Compact").meta(meta.as_object().cloned()))
            }
            Doing::Think => SessionUpdate::AgentThoughtChunk(text(&format!("Thinking: {on}"))),
            Doing::Reply => SessionUpdate::AgentMessageChunk(text(&format!("{on} "))),
        };
        let called = matches!(update, SessionUpdate::ToolCall(_));
        say(cx, session, update)?;
        let Some(next) = steered_on(fake, session, steered).await else {
            return Ok(StopReason::Cancelled);
        };
        if called {
            let done = ToolCallUpdateFields::new().status(ToolCallStatus::Completed);
            say(
                cx,
                session,
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(id, done)),
            )?;
        }
        words = next;
    }
    let reply = format!("Done: {words}.");
    say(cx, session, SessionUpdate::AgentMessageChunk(text(&reply)))?;
    Ok(StopReason::EndTurn)
}

/// Says the account reached its limit, which resets in an hour, as Claude
/// Code's adapter does.
fn limit_reached(cx: &ConnectionTo<Client>, session: &SessionId) -> Result<(), Error> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let limit = json!({ "status": "rejected", "resetsAt": now.as_secs() + 3600 });
    let meta = json!({ "_claude/rateLimit": limit });
    let usage = UsageUpdate::new(1000, 200_000).meta(meta.as_object().cloned());
    say(cx, session, SessionUpdate::UsageUpdate(usage))
}

/// What a turn says right after its answer, before anything else.
type After = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

/// Does what the prompt's words say, and puts in `then` what it says
/// right after it answers, if anything.
async fn turn(
    fake: Fake,
    cx: ConnectionTo<Client>,
    prompt: PromptRequest,
    mut steered: mpsc::UnboundedReceiver<String>,
    then: &mut Option<After>,
) -> Result<StopReason, Error> {
    let session = prompt.session_id.clone();
    if let Some(seen) = seen(&prompt.prompt) {
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(&seen)))?;
    }
    let said = words_of(&prompt.prompt);
    let words = asked(&said).to_owned();
    // Before the words its own words hold: `fails` holds `fail`.
    if words.contains("sub-agents") {
        if !fake.signed_in.load(Ordering::Relaxed) {
            return Err(Error::auth_required());
        }
        return subagents::turn(&fake, &cx, &session, &words, then).await;
    }
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
    if doing_of(&words).is_some() {
        return doing(&fake, &cx, &session, words, &mut steered).await;
    }
    if let Some(names) = cat_of(&words) {
        return cat(&fake, &cx, &session, &names);
    }
    if words.contains("silent") {
        let seconds = (words.split_whitespace())
            .skip_while(|word| *word != "silent")
            .nth(1)
            .and_then(|word| word.parse().ok())
            .unwrap_or(1);
        let until = tokio::time::Instant::now() + Duration::from_secs(seconds);
        while tokio::time::Instant::now() < until {
            if fake.cancelled(&session) {
                return Ok(StopReason::Cancelled);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let reply = format!("I was silent for {seconds} s.");
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("limit wait") {
        limit_reached(&cx, &session)?;
        let Some(words) = steered_on(&fake, &session, &mut steered).await else {
            return Ok(StopReason::Cancelled);
        };
        let reply = format!("Steered: {words}.");
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("limit") {
        limit_reached(&cx, &session)?;
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
    if words.contains("pages") {
        // A long run that ends while its Person is away (see the top).
        let go = fake.setup(&session).folder.join("go");
        while !go.exists() {
            if fake.cancelled(&session) {
                return Ok(StopReason::Cancelled);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let _ = std::fs::remove_file(&go);
        let count = words
            .split_whitespace()
            .skip_while(|word| *word != "pages")
            .nth(1)
            .and_then(|word| word.parse().ok())
            .unwrap_or(30);
        let pages: Vec<String> = (0..count)
            .map(|at| format!("page {at} of {count}"))
            .collect();
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&pages.join("\n\n"))),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("quit") {
        return Ok(StopReason::Cancelled);
    }
    if words.contains("walk") {
        return walk(&fake, &cx, &session, &mut steered).await;
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
            choose(
                &cx,
                &session,
                words.contains("quickly"),
                words.contains("drinks"),
            )
            .await?
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
    // Asked for a commit's message, as git.prompt asks (ADR 0034).
    if words.contains("git commit messages") {
        let reply = r#"{"subject": "Change the app", "body": "", "branch": "change-app"}"#;
        say(&cx, &session, SessionUpdate::AgentMessageChunk(text(reply)))?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("how many turns") {
        let running = fake.running.lock().unwrap().len();
        let closed = fake.closed.load(Ordering::Relaxed);
        let reply = format!("Turns running {running}, sessions closed {closed}");
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("which effort") {
        let setup = fake.setup(&session);
        let reply = format!("Effort {}, fast {}", setup.effort, setup.fast);
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
    if let Some(word) = words.strip_prefix("remember ") {
        let id = format!("kept-{}", fake.sessions.fetch_add(1, Ordering::Relaxed));
        let mut kept = fake.kept.lock().unwrap();
        let session_kept = kept.entry(session.clone()).or_default();
        session_kept.push((word.to_owned(), id.clone()));
        let chunk = text(&format!("I will remember {word}.")).message_id(MessageId::new(id));
        say(&cx, &session, SessionUpdate::AgentMessageChunk(chunk))?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("what do you remember") {
        let kept = fake.kept.lock().unwrap();
        let words: Vec<&str> = (kept.get(&session).into_iter().flatten())
            .map(|(word, _)| word.as_str())
            .collect();
        let reply = format!("I remember: {}.", words.join(", "));
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
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
        // Codex; `dies`, its process ends; `at once`, it goes on right
        // after its answer, with nothing between; `on cue`, once a file
        // `cue` is in its folder. `detached` runs a command in the
        // background, which ends after the turn, and nothing more.
        let (after, its, fake) = (cx.clone(), session.clone(), fake.clone());
        let long = words.contains("long");
        let at_once = words.contains("at once");
        let cue = (words.contains("on cue")).then(|| fake.setup(&session).folder.join("cue"));
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
        let goes_on = async move {
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
                let (status, reply) = if allowed(&after, question, &["allow"]).await {
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
        };
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("Started a task.")),
        )?;
        if at_once {
            *then = Some(Box::pin(goes_on));
        } else {
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Some(cue) = cue {
                    while !cue.exists() {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    let _ = std::fs::remove_file(&cue);
                }
                goes_on.await;
            });
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
    if words.contains("tool images") {
        let image = || {
            ToolCallContent::Content(Content::new(ContentBlock::Image(ImageContent::new(
                "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",
                "image/png",
            ))))
        };
        if !words.contains("update only") {
            let call = ToolCall::new("shot-1", "Screenshot result")
                .kind(ToolKind::Fetch)
                .status(ToolCallStatus::InProgress)
                .content(vec![image()]);
            say(&cx, &session, SessionUpdate::ToolCall(call))?;
        }
        let content = vec![
            ToolCallContent::Content(Content::new(ContentBlock::Text(TextContent::new(
                "Before the screenshot.",
            )))),
            image(),
            ToolCallContent::Content(Content::new(ContentBlock::Image(ImageContent::new(
                "bad-base64",
                "image/png",
            )))),
            image(),
            ToolCallContent::Content(Content::new(ContentBlock::Text(TextContent::new(
                "After the screenshot.",
            )))),
        ];
        let fields = ToolCallUpdateFields::new()
            .title("Screenshot result")
            .status(ToolCallStatus::Completed);
        let fields = if words.contains("raw") {
            let parts: Vec<_> = content
                .into_iter()
                .filter_map(|part| match part {
                    ToolCallContent::Content(content) => Some(content.content),
                    _ => None,
                })
                .collect();
            fields.raw_output(json!({"result":{"content": parts}, "error":null}))
        } else {
            fields.content(content)
        };
        let update = ToolCallUpdate::new("shot-1", fields);
        say(&cx, &session, SessionUpdate::ToolCallUpdate(update))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("The screenshots are ready.")),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("on disk") {
        // It edits a file with its tool, and its shell makes another, as
        // a real Harness does, in the session's folder.
        let folder = fake.setup(&session).folder;
        let notes = folder.join("notes.md");
        let old = std::fs::read_to_string(&notes).ok();
        let _ = std::fs::write(&notes, "one\n2\nthree\n");
        let _ = std::fs::write(folder.join("made.txt"), "by the shell\n");
        let diff = Diff::new(notes, "one\n2\nthree\n").old_text(old);
        let call = ToolCall::new("edit-1", "Edit notes.md")
            .kind(ToolKind::Edit)
            .status(ToolCallStatus::Completed)
            .content(vec![ToolCallContent::Diff(diff)]);
        say(&cx, &session, SessionUpdate::ToolCall(call))?;
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text("I edited notes.md and ran a script.")),
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
    // Each text block apart, to see a skill sent as Claude Code runs one.
    if words.contains("blocks") {
        let blocks: Vec<String> = prompt
            .prompt
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(format!("[{}]", text.text)),
                _ => None,
            })
            .collect();
        let reply = format!("Blocks: {}", blocks.join(" "));
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    if words.contains("what did you read") {
        // The prompt as it came, for a test of what Banda put before the
        // message, as a moved Thread's history (ADR 0078).
        let read: String = (prompt.prompt.iter())
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect();
        let reply = format!("Session {} read: {read}", session.0);
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
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
    for piece in ["You said: ", &said] {
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
    drinks: bool,
) -> Result<String, Error> {
    let colour = StringPropertySchema::new().title("Colour").one_of(vec![
        EnumOption::new("Red", "Red"),
        EnumOption::new("Blue", "Blue").description("Like the sea"),
    ]);
    let other = StringPropertySchema::new().title("Other");
    let mut schema = ElicitationSchema::new()
        .property("question_0", colour, false)
        .property("question_0_custom", other.clone(), false);
    if drinks {
        let drink = MultiSelectPropertySchema::titled(vec![
            EnumOption::new("Tea", "Tea"),
            EnumOption::new("Coffee", "Coffee"),
        ])
        .title("Drinks")
        .description("What to drink?");
        schema =
            schema
                .property("question_1", drink, false)
                .property("question_1_custom", other, false);
    }
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
            let colour = match said("question_0_custom").or_else(|| said("question_0")) {
                Some(colour) => format!("You chose {colour}."),
                None => "You chose nothing.".to_owned(),
            };
            let mut drunk = match content.get("question_1") {
                Some(ElicitationContentValue::StringArray(picks)) => picks.clone(),
                _ => Vec::new(),
            };
            drunk.extend(said("question_1_custom"));
            if drunk.is_empty() {
                colour
            } else {
                format!("{colour} To drink: {}.", drunk.join(", "))
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

/// Writes in `FAKE_AGENT_SHELLS`, when it names a file, what the shell of
/// a session opened with `meta` would be handed for `banda`.
fn tell_shells(meta: Option<&serde_json::Map<String, serde_json::Value>>) {
    let Some(file) = std::env::var_os("FAKE_AGENT_SHELLS") else {
        return;
    };
    let own = |name| std::env::var(name).ok();
    let process = json!({ "BANDA_TOKEN": own("BANDA_TOKEN"), "BANDA_ENGINE": own("BANDA_ENGINE") });
    let options = meta.and_then(|meta| meta.get("claudeCode")?.get("options"));
    let session = options.and_then(|options| options.get("env"));
    let sources = options.and_then(|options| options.get("settingSources"));
    let shells = json!({
        "process": process,
        "session": session,
        "untrusted": own("BANDA_UNTRUSTED"),
        "sources": sources,
    });
    let _ = std::fs::write(file, shells.to_string());
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
                    let subagents = request.client_capabilities.subagents.is_some();
                    fake.subagents.store(subagents, Ordering::Relaxed);
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
                    let resumes = std::env::var_os("FAKE_AGENT_NO_RESUME").is_none();
                    let meta = json!({ "steering": { "supported": steers } });
                    let mut capabilities = AgentCapabilities::new()
                        .prompt_capabilities(PromptCapabilities::new().image(images))
                        .load_session(true)
                        .session_capabilities(
                            SessionCapabilities::new()
                                .resume(resumes.then(SessionResumeCapabilities::new))
                                .fork(SessionForkCapabilities::new())
                                .close(SessionCloseCapabilities::new()),
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
                async move |request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            cx: ConnectionTo<Client>| {
                    if let Some(file) = std::env::var_os("FAKE_AGENT_MCP") {
                        let servers = serde_json::to_vec(&request.mcp_servers).unwrap_or_default();
                        let _ = std::fs::write(file, servers);
                    }
                    if let Some(file) = std::env::var_os("FAKE_AGENT_ROOTS") {
                        let roots =
                            serde_json::to_vec(&request.additional_directories).unwrap_or_default();
                        let _ = std::fs::write(file, roots);
                    }
                    tell_shells(request.meta.as_ref());
                    let id = fake.new_session();
                    fake.at_folder(id.clone(), request.cwd.clone());
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
                async move |request: ForkSessionRequest,
                            responder: Responder<ForkSessionResponse>,
                            cx: ConnectionTo<Client>| {
                    tell_shells(request.meta.as_ref());
                    let id = fake.new_session();
                    let at = request
                        .meta
                        .as_ref()
                        .and_then(|meta| meta.get("jetbrains")?.get("air")?.get("fork"))
                        .and_then(|fork| fork.get("messageId")?.as_str().map(str::to_owned));
                    {
                        let mut kept = fake.kept.lock().unwrap();
                        let mut copied = kept.get(&request.session_id).cloned().unwrap_or_default();
                        if let Some(at) = at {
                            let Some(end) = copied.iter().position(|(_, id)| *id == at) else {
                                return responder.respond_with_error(
                                    Error::invalid_params().data("no such message"),
                                );
                            };
                            copied.truncate(end + 1);
                        }
                        kept.insert(id.clone(), copied);
                    }
                    let options = fake.options(&id);
                    responder
                        .respond(ForkSessionResponse::new(id.clone()).config_options(options))?;
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
                    tell_shells(request.meta.as_ref());
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
                            cx: ConnectionTo<Client>| {
                    if forgets() {
                        return responder.respond_with_error(Error::resource_not_found(None));
                    }
                    tell_shells(request.meta.as_ref());
                    fake.at_folder(request.session_id.clone(), request.cwd.clone());
                    // As a load replays the conversation, before it answers.
                    subagents::replay(&cx, &request.session_id)?;
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
                        let mut then = None;
                        let ended = turn(fake.clone(), turn_cx, request, steered, &mut then).await;
                        fake.running.lock().unwrap().remove(&session);
                        match ended {
                            Ok(stop) => responder.respond(PromptResponse::new(stop))?,
                            Err(error) => return responder.respond_with_error(error),
                        }
                        // What it says right after its answer follows it.
                        if let Some(then) = then {
                            then.await;
                        }
                        Ok(())
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
        .on_receive_request(
            {
                let fake = fake.clone();
                async move |request: CloseSessionRequest,
                            responder: Responder<CloseSessionResponse>,
                            _cx: ConnectionTo<Client>| {
                    let session = request.session_id;
                    fake.setups.lock().unwrap().remove(&session);
                    fake.kept.lock().unwrap().remove(&session);
                    subagents::forget(&session);
                    fake.closed.fetch_add(1, Ordering::Relaxed);
                    responder.respond(CloseSessionResponse::new())
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
