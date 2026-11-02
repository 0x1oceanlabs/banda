//! The ACP adapter: one Harness process, spoken to over ACP v1 on its
//! stdio. ACP's words stop here: the rest of the module hears what the
//! Harness [`Said`], and how a turn ended, in the module's own words.
//!
//! The engine declares what it can show: notices, options that are on or
//! off, and forms, which Claude Code needs to ask a Person its own
//! questions and Codex to ask in a plan. A Thread's settings become the
//! session's options when a turn starts ([`Connection::settle`]): the mode
//! maps onto the Harness's own modes where it has Claude Code's or Codex's,
//! never freer than the one chosen. A failure's class comes from ACP's
//! error codes and the data the adapters attach to an error
//! (`errorKind` from Claude Code's, `codexErrorInfo` from Codex's), and a
//! usage limit's reset from Claude Code's rate limit updates. The JetBrains
//! AIR extension would say more, but a client that declares it must render
//! the rest of AIR too.
//!
//! The connection's handlers run on its dispatch loop, so none of them
//! waits there. A permission request is routed to its turn, and a task off
//! the loop answers it once the Person decides.
//!
//! It declares terminal sign-in too, so a Harness offers the ways it signs
//! in, Claude Code's in a terminal among them ([`Connection::ways`]). Who
//! is signed in comes from the Harness's own reports (`_auth/status_update`,
//! which Claude Code's and Codex's adapters push), never from its files.
//! A Harness that does not report it shows no one.
//!
//! Starting a Harness and opening a session are bounded; a turn is not: it
//! runs until the Harness ends it or a Person stops it.

use crate::model::{
    Account, Adapter, CliView, Cost, Exit, Failure, Field, FieldValue, HarnessOption, Input, Mode,
    Offer, OptionChoice, OptionValue, PlanStep, Program, Settings, SignInWay, SignedInAs, Skill,
    SlashCommand, StepState, TextFormat, ThreadId, ToolContent, ToolKind, ToolStatus, TurnState,
    Usage, Values,
};
use crate::record::{Recording, To};
use crate::rules::{Ending, Offered};
use crate::settings::Harness;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// How long a Harness may take to start and agree on ACP. The first start
/// may download it.
pub const STARTING: Duration = Duration::from_secs(120);
/// How long a Harness may take to open a session.
pub const OPENING: Duration = Duration::from_secs(60);
/// How long a Harness may take to say whether a message joins its turn.
const STEERING: Duration = Duration::from_secs(30);
/// How long a Harness that signs in by itself may wait for its Person.
const SIGNING_IN: Duration = Duration::from_secs(10 * 60);
/// How long a Harness may take to sign out.
const SIGNING_OUT: Duration = Duration::from_secs(60);
/// How long a Harness that reports who is signed in may take to first say
/// it: Claude Code's adapter asks its CLI, for up to 5 seconds.
const FIRST_REPORT: Duration = Duration::from_secs(6);

/// What a Harness said during a turn.
pub enum Said {
    /// A piece of the Agent's reply, or of its thinking: `message` names
    /// the message it belongs to, when the Harness says.
    Reply {
        text: String,
        message: Option<String>,
    },
    Thought {
        text: String,
        message: Option<String>,
    },
    ToolStarted {
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<ToolContent>,
    },
    /// `output` follows what the command printed before.
    ToolChanged {
        call: String,
        change: ToolChange,
        output: Option<String>,
    },
    /// The steps of the Agent's plan now, all of them.
    Steps(Vec<PlanStep>),
    /// What it has used now, and, when the account reached its limit, the
    /// time it may be used again, in milliseconds since the epoch.
    Used { usage: Usage, resets: Option<i64> },
    /// The Harness asks a Person to decide, and waits for `answer`.
    Asks {
        call: String,
        title: Option<String>,
        /// What the tool call would do, if the Harness says here.
        tool: Option<ToolKind>,
        offered: Vec<Offered>,
        /// A form to fill in, for a Question that asks more than a choice.
        form: Option<Vec<Field>>,
        /// The plan it asks to carry out, when it asks to leave plan mode.
        plan: Option<String>,
        answer: oneshot::Sender<Answer>,
    },
    /// The Harness no longer waits for the answer to what it asked.
    Withdrawn(String),
    /// The session's options changed during the turn.
    Runs(Running),
    /// A line for the Person, such as a warning.
    Notice(String),
}

/// What an update changes in a tool call: each field given replaces its
/// own.
#[derive(Debug, Default)]
pub struct ToolChange {
    pub title: Option<String>,
    pub status: Option<ToolStatus>,
    pub content: Option<Vec<ToolContent>>,
    /// How its command ended.
    pub exit: Option<Exit>,
}

impl ToolChange {
    /// Whether it changes nothing.
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.status.is_none()
            && self.content.is_none()
            && self.exit.is_none()
    }
}

/// What goes back to a Harness that asked.
#[derive(Debug)]
pub enum Answer {
    Chose(String),
    /// The Person submitted the form with these values.
    Filled(Values),
    /// The turn is stopping: the Harness must not wait any longer.
    Cancelled,
}

/// A Harness's session for one Thread.
#[derive(Clone)]
pub struct Session(acp::SessionId);

/// What a Thread keeps of its session: evidence, not identity (ADR 0002,
/// decision 7).
#[derive(Serialize, Deserialize)]
pub struct Evidence {
    harness: String,
    session: String,
    lasts: Lasts,
    /// The Thread's next session is to be a fork of `session` at this
    /// reply (ADR 0027): its conversation to there, and no further. It
    /// goes before a session open in this process, which knows more.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fork: Option<ForkAt>,
}

/// A reply of a session, which a fork of it goes to: by the ID the
/// Harness gave its message, as Claude Code's and Codex's adapters find it
/// in the request's `_meta.jetbrains.air.fork`, JetBrains AIR's extension.
/// None goes back before the first reply: a new session, as a Thread
/// edited from its first message is.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ForkAt {
    pub message: Option<String>,
}

/// The request's `_meta` that forks a session at `message`.
fn fork_meta(message: &str) -> acp::Meta {
    let fork = serde_json::json!({ "version": 1, "messageId": message });
    let meta = serde_json::json!({ "jetbrains": { "air": { "fork": fork } } });
    meta.as_object().cloned().unwrap_or_default()
}

impl Evidence {
    /// The session of a Thread that forks this one's at `at`.
    pub fn forked_at(mut self, at: ForkAt) -> Evidence {
        self.fork = Some(at);
        self
    }

    /// The session a new process of `harness` may continue.
    fn continued_by(&self, harness: &str) -> Option<acp::SessionId> {
        let lasts = matches!(self.lasts, Lasts::Harness);
        (lasts && self.harness == harness).then(|| acp::SessionId::new(self.session.as_str()))
    }
}

/// How a Thread's session came to be open in this process.
pub enum Opened {
    /// It was open already.
    Known,
    /// The Harness continued the session the Thread had before.
    Continued,
    /// A new session. `lost` when the Thread had one the Harness could not
    /// continue.
    New { evidence: Evidence, lost: bool },
}

/// How long a session outlives its Harness process.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Lasts {
    /// It ends with the process.
    Process,
    /// The Harness can load it again after a restart.
    Harness,
}

/// What a turn sends the Harness: its message's text and images.
pub struct Prompt {
    pub text: String,
    /// A skill the message names, as Claude Code runs one: `/name` and
    /// what follows, after the text (issue #149).
    pub command: Option<String>,
    pub images: Vec<PromptImage>,
}

/// An image as a Harness gets it: its kind and its bytes.
pub struct PromptImage {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// What became of a message sent into a running turn.
#[derive(Debug, PartialEq, Eq)]
pub enum Steered {
    /// It joined the turn: what the Agent says of it comes with the turn.
    Joined,
    /// No turn could take it, as one that just ended: it needs its own.
    NotNow,
}

/// `_session/steering`, which Claude Code's and Codex's adapters share
/// (ACP PR #1261): a message into the session's running turn. With
/// `promptRequired` an adapter whose turn ended starts none by itself; the
/// engine queues the message instead.
#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcRequest)]
#[request(method = "_session/steering", response = SteeringResponse)]
#[serde(rename_all = "camelCase")]
struct SteeringRequest {
    session_id: acp::SessionId,
    prompt: Vec<acp::ContentBlock>,
    #[serde(rename = "_meta")]
    meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcResponse)]
struct SteeringResponse {
    outcome: SteeringOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SteeringOutcome {
    Injected,
    /// No turn runs, so none took it.
    PromptRequired,
    /// Only without `promptRequired`: the adapter ran the message as a
    /// turn of its own, whose words reach no turn here.
    StartedNewTurn,
    /// It failed, or the adapter answered what this engine does not know.
    #[serde(other)]
    Other,
}

/// Where a Harness declares that it takes messages into a running turn,
/// and where each such message says what an idle session does with it.
const STEERING_META: &str = "steering";
/// An idle session leaves the message to the engine.
const LEAVE_IT: &str = "promptRequired";
/// Where a Harness declares that it reports who is signed in.
const REPORTS_ACCOUNT_META: &str = "authStatus";

/// Who the Harness says is signed in, pushed once it started and at each
/// change. The adapters' extension, until ACP has it.
#[derive(Clone, Debug, Serialize, Deserialize, agent_client_protocol::JsonRpcNotification)]
#[notification(method = "_auth/status_update")]
struct AuthStatusUpdate {
    #[serde(rename = "authStatus")]
    status: AuthStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AuthStatus {
    /// `account`, `api_key`, `gateway`, `external`, or `none`.
    kind: String,
    label: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    account: Option<AuthAccount>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct AuthAccount {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organization: Option<String>,
}

impl From<AuthStatus> for SignedInAs {
    fn from(status: AuthStatus) -> Self {
        let account = status.account.unwrap_or_default();
        SignedInAs {
            signed_in: status.kind != "none",
            label: status.label,
            detail: status.detail,
            email: account.email,
            organization: account.organization,
        }
    }
}

/// What a session runs with, as the Harness last said.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Running {
    /// The Harness has modes of its own and enforces the Thread's mode.
    pub native: bool,
    /// The mode it runs in, when that is one of Banda's.
    pub mode: Option<Mode>,
    /// It plans before it changes anything.
    pub plan: bool,
    /// Its options, and whether it can plan. Its slash commands and
    /// skills are not here: see `commands`.
    pub offer: Offer,
    /// The commands it said, or `None` before it has: a session that has
    /// not said them yet leaves the Thread's.
    pub commands: Option<Commands>,
}

/// What a session said a message can ask it to run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Commands {
    pub slash_commands: Vec<SlashCommand>,
    pub skills: Vec<Skill>,
    /// The skills it runs as slash commands, as Claude Code does.
    pub slashed: Vec<String>,
}

/// Each mode as the Harnesses with modes of their own name it, Claude
/// Code's first, then Codex's; from the strictest to the freest.
const MODES: [(Mode, [&str; 2]); 4] = [
    (Mode::Supervised, ["default", "read-only"]),
    (Mode::AcceptEdits, ["acceptEdits", "workspace-write"]),
    (Mode::Auto, ["auto", "agent"]),
    (Mode::FullAccess, ["bypassPermissions", "agent-full-access"]),
];
/// The `_meta` keys where Claude Code's and Codex's adapters put what a
/// command prints, for a client that declares the first, and how the
/// command ended (their Zed conventions).
const OUTPUT_META: &str = "terminal_output_delta";
const EXIT_META: &str = "terminal_exit";

/// Planning: one of Claude Code's modes, and Codex's collaboration mode.
const PLAN: &str = "plan";
const WORKING: &str = "default";
const COLLABORATION: &str = "collaboration_mode";
/// A form Question's answers: submit it, or skip it.
const SUBMIT: &str = "accept";
const SKIP: &str = "decline";

/// What a session says while none of the engine's turns runs in it.
pub enum Between {
    /// The Harness said it by itself, as Claude Code does when it goes on
    /// with what a background task it started found.
    Said(Said),
    /// A turn's prompt went to the session: what it says now is the turn's.
    Prompted,
}

/// Where what each session says goes: to the turn whose prompt it
/// answers, or else to whoever hears the session between turns.
#[derive(Clone, Default)]
struct Routes {
    turns: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>,
    between: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Between>>>>,
}

#[derive(Clone)]
enum Route {
    Turn(mpsc::UnboundedSender<Said>),
    Between(mpsc::UnboundedSender<Between>),
}

impl Routes {
    fn of(&self, session: &acp::SessionId) -> Option<Route> {
        if let Some(turn) = self.turns.lock().unwrap().get(session) {
            return Some(Route::Turn(turn.clone()));
        }
        let between = self.between.lock().unwrap();
        between.get(session).cloned().map(Route::Between)
    }

    /// Everyone who listens hears that the Harness is gone.
    fn clear(&self) {
        self.turns.lock().unwrap().clear();
        self.between.lock().unwrap().clear();
    }
}

impl Route {
    /// False when nobody listens any more.
    fn send(&self, said: Said) -> bool {
        match self {
            Route::Turn(turn) => turn.send(said).is_ok(),
            Route::Between(between) => between.send(Between::Said(said)).is_ok(),
        }
    }
}
/// What each session has said of itself.
type Learned = Arc<Mutex<HashMap<acp::SessionId, Known>>>;

/// A session's options, and whether its modes are Claude Code's or Codex's:
/// decided by the list it opened with, so a later list that leaves the modes
/// out does not change who keeps to the Thread's mode. And what it last
/// said it has used and which slash commands it takes, which may come
/// between turns: Claude Code sends its slash commands just after the
/// session opens.
#[derive(Clone, Default)]
struct Known {
    native: bool,
    options: Vec<acp::SessionConfigOption>,
    usage: Option<Usage>,
    /// The commands it said, or `None` before it has.
    said: Option<Vec<acp::AvailableCommand>>,
    /// The folder it works in, where its project's skills are.
    folder: Option<PathBuf>,
    /// What it said, its skills told by their files: read again only as
    /// what it said or its folder changes, which may come in either order.
    commands: Option<Commands>,
}

impl Known {
    fn new(options: Vec<acp::SessionConfigOption>) -> Known {
        Known {
            native: native(&options),
            options,
            ..Known::default()
        }
    }

    fn read_commands(&mut self) {
        self.commands = (self.said.as_ref()).map(|said| commands(said, self.folder.as_deref()));
    }
}

/// Changes what is known of `session`, from nothing if it is new.
fn update<R>(
    learned: &Learned,
    session: &acp::SessionId,
    change: impl FnOnce(&mut Known) -> R,
) -> R {
    change(learned.lock().unwrap().entry(session.clone()).or_default())
}

/// Keeps the options a session opened with, in `folder`.
fn opened(
    learned: &Learned,
    session: &acp::SessionId,
    now: Vec<acp::SessionConfigOption>,
    folder: &Path,
) {
    update(learned, session, |known| {
        known.native = native(&now);
        known.options = now;
        known.folder = Some(folder.to_owned());
        known.read_commands();
    });
}

/// Keeps a session's newest options. An empty list, which is what an update
/// that cannot be read becomes, keeps the last.
fn learn(learned: &Learned, session: &acp::SessionId, now: Vec<acp::SessionConfigOption>) -> Known {
    let mut all = learned.lock().unwrap();
    match all.get_mut(session) {
        Some(known) => {
            if !now.is_empty() {
                known.options = now;
            }
            known.clone()
        }
        None => all
            .entry(session.clone())
            .or_insert(Known::new(now))
            .clone(),
    }
}

/// What the Harness said it can do with sessions.
#[derive(Clone, Copy)]
struct Agreed {
    loads: bool,
    resumes: bool,
    /// It takes images in a prompt.
    images: bool,
    /// It takes a message into a running turn (`_session/steering`).
    steers: bool,
    /// It forks a session (`session/fork`).
    forks: bool,
}

/// What a Harness said when it started: what it can do with sessions, and
/// how a Person signs in to it.
struct Started {
    cx: ConnectionTo<Agent>,
    agreed: Agreed,
    methods: Vec<acp::AuthMethod>,
    about: About,
}

/// What a Harness says of itself and its account when it starts.
struct About {
    adapter: Option<Adapter>,
    signs_out: bool,
    /// It pushes who is signed in (`_auth/status_update`).
    reports_account: bool,
}

/// One Harness process and its ACP connection. Dropping it stops the
/// process and everything it started.
pub struct Connection {
    cx: ConnectionTo<Agent>,
    harness: String,
    /// The Harness's name, for plain words.
    name: String,
    agreed: Agreed,
    /// The ways it offers to sign in.
    ways: Vec<SignInWay>,
    about: About,
    /// The Person's CLI it runs, as last found: when it started, or when a
    /// Person last asked who is signed in.
    cli: Mutex<Option<CliView>>,
    /// Who it last said is signed in.
    account: watch::Receiver<Option<AuthStatus>>,
    routes: Routes,
    learned: Learned,
    /// When a turn last began or ended here.
    active: Arc<Mutex<Instant>>,
    /// The turns the Agent went on with by itself here, which keep the
    /// host as the engine's turns do.
    kept: Arc<AtomicUsize>,
    /// The Harness's session for each Thread, in this process.
    sessions: tokio::sync::Mutex<HashMap<ThreadId, acp::SessionId>>,
    driver: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

/// While it lives, its host is not let go as idle.
pub struct Kept {
    kept: Arc<AtomicUsize>,
    active: Arc<Mutex<Instant>>,
}

impl Drop for Kept {
    fn drop(&mut self) {
        *self.active.lock().unwrap() = Instant::now();
        self.kept.fetch_sub(1, Ordering::SeqCst);
    }
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// `banda mcp` as ACP hands an MCP server to a session, named `banda`.
fn servers(banda: Option<Program>) -> Vec<acp::McpServer> {
    let server = |Program { program, args, env }: Program| {
        let env = env
            .into_iter()
            .map(|(name, value)| acp::EnvVariable::new(name, value));
        acp::McpServer::Stdio(
            acp::McpServerStdio::new("banda", program)
                .args(args)
                .env(env.collect()),
        )
    };
    banda.map(server).into_iter().collect()
}

/// What a Harness's error says, in the words it has for a Person.
fn in_words(error: &agent_client_protocol::Error) -> &str {
    let said = error.data.as_ref().and_then(|d| d.get("message"));
    said.and_then(|m| m.as_str())
        .unwrap_or(error.message.trim())
}

impl Connection {
    /// Starts `harness` and agrees on ACP v1 with it.
    pub async fn start(harness: &Harness) -> Result<Arc<Connection>, String> {
        // The entry as it starts, with its CLI's path when it runs one.
        let (harness, cli) = crate::cli::find(harness).await?;
        let harness = &harness;
        let config = AcpAgentConfig::new(&harness.command)
            .args(harness.args.iter().cloned())
            .envs(harness.env.clone());
        let recording = match &harness.record {
            Some(folder) => Some(Recording::start(folder, &harness.id)?),
            None => None,
        };
        let name = harness.id.clone();
        let process = AcpAgent::new(config).with_debug(move |line, direction| {
            let to = match direction {
                LineDirection::Stdin => To::Harness,
                LineDirection::Stdout => To::Banda,
                LineDirection::Stderr => {
                    tracing::debug!(harness = %name, "{line}");
                    return;
                }
            };
            if let Some(recording) = &recording {
                recording.write(to, line);
            }
        });
        let (routes, learned) = (Routes::default(), Learned::default());
        let (ready, started) = oneshot::channel();
        let (told, account) = watch::channel(None);
        let driver = tokio::spawn(drive(process, routes.clone(), learned.clone(), told, ready));
        let Started {
            cx,
            agreed,
            methods,
            about,
        } = match timeout(STARTING, started).await {
            Ok(Ok(Ok(agreed))) => agreed,
            Ok(Ok(Err(error))) => return Err(error),
            Ok(Err(_)) => return Err("The Harness stopped while it started.".to_owned()),
            Err(_) => {
                driver.abort();
                return Err("The Harness did not start within two minutes.".to_owned());
            }
        };
        Ok(Arc::new(Connection {
            cx,
            harness: harness.id.clone(),
            name: harness.name.clone(),
            agreed,
            ways: ways(harness, methods),
            about,
            cli: Mutex::new(cli),
            account,
            routes,
            learned,
            active: Arc::new(Mutex::new(Instant::now())),
            kept: Arc::default(),
            sessions: Default::default(),
            driver,
        }))
    }

    /// Whether the process still answers.
    pub fn alive(&self) -> bool {
        !self.driver.is_finished() && !self.cx.is_incoming_closed()
    }

    /// Since when no turn runs here, or `None` while one does.
    pub fn idle_since(&self) -> Option<Instant> {
        let busy =
            !self.routes.turns.lock().unwrap().is_empty() || self.kept.load(Ordering::SeqCst) > 0;
        (!busy).then(|| *self.active.lock().unwrap())
    }

    /// Keeps the host while the Agent goes on by itself, as a turn does.
    pub fn keep(&self) -> Kept {
        self.kept.fetch_add(1, Ordering::SeqCst);
        Kept {
            kept: self.kept.clone(),
            active: self.active.clone(),
        }
    }

    /// Whether a turn's prompt runs in `session` now.
    pub fn prompting(&self, Session(session): &Session) -> bool {
        self.routes.turns.lock().unwrap().contains_key(session)
    }

    /// Marks the host as just used, so it is not let go as idle.
    pub fn touch(&self) {
        *self.active.lock().unwrap() = Instant::now();
    }

    /// Hears what `session` says between the engine's turns, from now on;
    /// `None` while someone already hears it. Nobody hears it any more once
    /// the Harness is gone.
    pub fn between(&self, Session(session): &Session) -> Option<mpsc::UnboundedReceiver<Between>> {
        let mut between = self.routes.between.lock().unwrap();
        if between.get(session).is_some_and(|heard| !heard.is_closed()) {
            return None;
        }
        let (said, hear) = mpsc::unbounded_channel();
        between.insert(session.clone(), said);
        Some(hear)
    }

    /// The Harness's session for `thread`, opened in `folder` on first use,
    /// with `roots` as extra roots its Agent may read (ADR 0026).
    /// A Thread that had a session continues it when the Harness can, by
    /// resuming it or else by loading it; otherwise a new one opens. A
    /// session that opens, either way, gets `banda()`, the `banda mcp` its
    /// Agent reaches Banda through, as a stdio MCP server.
    pub async fn session(
        &self,
        thread: ThreadId,
        folder: &Path,
        roots: &[PathBuf],
        earlier: Option<&Evidence>,
        banda: impl FnOnce() -> Option<Program>,
    ) -> Result<(Session, Opened), Ending> {
        let mut sessions = self.sessions.lock().await;
        // A session to fork goes before one open here, which knows more;
        // with no fork, the Thread goes on in the one it had.
        let fork = earlier.and_then(|earlier| Some((earlier, earlier.fork.as_ref()?)));
        let earlier = earlier.filter(|_| fork.is_none());
        if fork.is_none()
            && let Some(session) = sessions.get(&thread)
        {
            return Ok((Session(session.clone()), Opened::Known));
        }
        let servers = servers(banda());
        if let Some((
            earlier,
            ForkAt {
                message: Some(message),
            },
        )) = fork
        {
            if !self.agreed.forks {
                return Err(Ending::failed(
                    format!("{} cannot fork a conversation.", self.name),
                    None,
                ));
            }
            let fork = acp::ForkSessionRequest::new(earlier.session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(servers)
                .meta(fork_meta(message));
            let made = self.open(fork, "fork this Thread's conversation").await?;
            let (session, options) = (made.session_id, made.config_options);
            return Ok(self.opened(thread, &mut sessions, session, options, folder, false));
        }
        if let Some(session) = earlier.and_then(|e| e.continued_by(&self.harness))
            && let Some(options) = self
                .continue_session(&session, folder, roots, &servers)
                .await
        {
            opened(&self.learned, &session, options, folder);
            sessions.insert(thread, session.clone());
            return Ok((Session(session), Opened::Continued));
        }
        let new = acp::NewSessionRequest::new(folder)
            .additional_directories(roots.to_vec())
            .mcp_servers(servers);
        let made = self.open(new, "open a session").await?;
        let (session, options) = (made.session_id, made.config_options);
        Ok(self.opened(
            thread,
            &mut sessions,
            session,
            options,
            folder,
            earlier.is_some(),
        ))
    }

    /// Asks the Harness for a session, `doing` that in plain words if it
    /// cannot, or does not within a minute.
    async fn open<R: agent_client_protocol::JsonRpcRequest>(
        &self,
        request: R,
        doing: &str,
    ) -> Result<R::Response, Ending> {
        let asked = self.cx.send_request(request).block_task();
        match timeout(OPENING, asked).await {
            Ok(made) => made.map_err(|error| failed(&self.name, &error)),
            Err(_) => Err(Ending::failed(
                format!("{} did not {doing} within a minute.", self.name),
                Some(Failure::HarnessStopped),
            )),
        }
    }

    /// A session the Harness opened anew for `thread`, and its evidence.
    fn opened(
        &self,
        thread: ThreadId,
        sessions: &mut HashMap<ThreadId, acp::SessionId>,
        session: acp::SessionId,
        options: Option<Vec<acp::SessionConfigOption>>,
        folder: &Path,
        lost: bool,
    ) -> (Session, Opened) {
        opened(&self.learned, &session, options.unwrap_or_default(), folder);
        sessions.insert(thread, session.clone());
        let evidence = Evidence {
            harness: self.harness.clone(),
            session: session.0.to_string(),
            lasts: if self.agreed.loads || self.agreed.resumes {
                Lasts::Harness
            } else {
                Lasts::Process
            },
            fork: None,
        };
        (Session(session), Opened::New { evidence, lost })
    }

    /// Asks the Harness to continue `session`: resumed if it can, else
    /// loaded. A load replays the conversation, which nobody hears: the
    /// Thread already shows it. The session's options, if it is open again.
    async fn continue_session(
        &self,
        session: &acp::SessionId,
        folder: &Path,
        roots: &[PathBuf],
        servers: &[acp::McpServer],
    ) -> Option<Vec<acp::SessionConfigOption>> {
        let answer = if self.agreed.resumes {
            let resume = acp::ResumeSessionRequest::new(session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(servers.to_vec());
            let asked = self.cx.send_request(resume).block_task();
            timeout(OPENING, asked)
                .await
                .map(|a| a.map(|r| r.config_options))
        } else if self.agreed.loads {
            let load = acp::LoadSessionRequest::new(session.clone(), folder)
                .additional_directories(roots.to_vec())
                .mcp_servers(servers.to_vec());
            let asked = self.cx.send_request(load).block_task();
            timeout(OPENING, asked)
                .await
                .map(|a| a.map(|r| r.config_options))
        } else {
            return None;
        };
        match answer {
            Ok(Ok(options)) => Some(options.unwrap_or_default()),
            Ok(Err(error)) => {
                tracing::info!(%error, "the Harness could not continue a session");
                None
            }
            Err(_) => {
                tracing::info!("the Harness took too long to continue a session");
                None
            }
        }
    }

    /// Sets the session's options so it runs as `wanted`: one at a time,
    /// since an option may change what another offers. What it runs with
    /// then, and in plain words each setting the Harness did not take.
    pub async fn settle(
        &self,
        Session(session): &Session,
        wanted: &Settings,
    ) -> (Running, Vec<String>) {
        let (mut tried, mut refused) = (Vec::new(), Vec::new());
        let known = loop {
            // Read again each time: an update may have come since.
            let known = self.learned.lock().unwrap().get(session).cloned();
            let known = known.unwrap_or_default();
            let Some((id, value)) = next_change(&known, wanted, &tried) else {
                break known;
            };
            let name = known
                .options
                .iter()
                .find(|o| *o.id.0 == *id)
                .map_or_else(|| id.clone(), |o| o.name.clone());
            let set = acp::SetSessionConfigOptionRequest::new(
                session.clone(),
                acp::SessionConfigId::new(id.as_str()),
                value,
            );
            tried.push(id);
            let asked = self.cx.send_request(set).block_task();
            match timeout(OPENING, asked).await {
                Ok(Ok(answer)) => {
                    learn(&self.learned, session, answer.config_options);
                }
                Ok(Err(error)) => refused.push(format!(
                    "{} did not take the setting {name}: {}",
                    self.name, error.message
                )),
                Err(_) => refused.push(format!(
                    "{} did not answer when Banda set {name}.",
                    self.name
                )),
            }
        };
        let running = self.runs(&known);
        let mode_set = known
            .options
            .iter()
            .any(|o| is_mode(o) && tried.iter().any(|t| **t == *o.id.0));
        let planning = wanted.plan && running.plan;
        if running.native && mode_set && !planning && running.mode != Some(wanted.mode) {
            let runs = running.mode.map_or("a mode of its own", Mode::name);
            refused.push(format!(
                "{} offers no {} here, so it runs in {runs}.",
                self.name,
                wanted.mode.name()
            ));
        }
        (running, refused)
    }

    /// Sends a prompt: its text, then its images. What the Harness says
    /// comes on the receiver; the returned task ends with the turn.
    pub fn prompt(
        &self,
        Session(session): &Session,
        prompt: &Prompt,
    ) -> (mpsc::UnboundedReceiver<Said>, JoinHandle<Ending>) {
        let (said, hear) = mpsc::unbounded_channel();
        self.touch();
        self.routes
            .turns
            .lock()
            .unwrap()
            .insert(session.clone(), said);
        if let Some(between) = self.routes.between.lock().unwrap().get(session) {
            let _ = between.send(Between::Prompted);
        }
        let request = acp::PromptRequest::new(session.clone(), blocks(prompt));
        // Sent here, not in the task: a stop that follows must reach the
        // Harness after the prompt it stops.
        let sent = self.cx.send_request(request);
        let (routes, active) = (self.routes.clone(), self.active.clone());
        let (session, name) = (session.clone(), self.name.clone());
        let done = tokio::spawn(async move {
            let answer = sent.block_task().await;
            *active.lock().unwrap() = Instant::now();
            routes.turns.lock().unwrap().remove(&session);
            match answer {
                Ok(answer) => ending(&answer.stop_reason),
                Err(error) if gone(&error) => Ending::failed(
                    format!("{name} stopped while it worked."),
                    Some(Failure::HarnessStopped),
                ),
                Err(error) => failed(&name, &error),
            }
        });
        (hear, done)
    }

    /// What the session last said it has used, if it has.
    pub fn usage(&self, Session(session): &Session) -> Option<Usage> {
        self.learned.lock().unwrap().get(session)?.usage.clone()
    }

    /// What the session runs with, as it last said.
    pub fn running(&self, Session(session): &Session) -> Running {
        update(&self.learned, session, |known| self.runs(known))
    }

    /// What a session runs with, as `known` holds it, with what the
    /// Harness agreed to take.
    fn runs(&self, known: &Known) -> Running {
        let mut running = running(known);
        running.offer.no_images = !self.agreed.images;
        let cli = self.cli.lock().unwrap();
        running.offer.outdated = cli.as_ref().and_then(|c| c.outdated.clone());
        running
    }

    /// Whether the Harness takes a message into a running turn.
    pub fn steers(&self) -> bool {
        self.agreed.steers
    }

    /// The Harness's name, for plain words.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Sends a message into the session's running turn.
    pub async fn steer(
        &self,
        Session(session): &Session,
        prompt: &Prompt,
    ) -> Result<Steered, String> {
        let request = SteeringRequest {
            session_id: session.clone(),
            prompt: blocks(prompt),
            meta: serde_json::json!({ STEERING_META: { "idleBehavior": LEAVE_IT } }),
        };
        let sent = self.cx.send_request(request).block_task();
        let answer = timeout(STEERING, sent)
            .await
            .map_err(|_| format!("{} did not take the message in time.", self.name))?
            .map_err(plain)?;
        match answer.outcome {
            SteeringOutcome::Injected => Ok(Steered::Joined),
            SteeringOutcome::PromptRequired => Ok(Steered::NotNow),
            SteeringOutcome::StartedNewTurn => {
                tracing::warn!(harness = %self.harness, "a steered message started a turn of its own");
                Ok(Steered::Joined)
            }
            SteeringOutcome::Other => Err(format!("{} could not take the message.", self.name)),
        }
    }

    /// Asks the Harness to stop the session's turn.
    pub fn cancel(&self, Session(session): &Session) -> Result<(), String> {
        self.cx
            .send_notification(acp::CancelNotification::new(session.clone()))
            .map_err(plain)
    }

    /// The ways the Harness offers to sign in.
    pub fn ways(&self) -> &[SignInWay] {
        &self.ways
    }

    /// This Harness entry as its process says, and how to sign in to it.
    /// A Harness that reports who is signed in says it soon after it
    /// starts: until then this waits, a few seconds at most.
    /// Who is signed in, what the Harness runs, and the Person's CLI as
    /// `harness` finds it now: updated since the start, its Threads stop
    /// warning that it is old.
    pub async fn account(&self, harness: &Harness) -> Result<Account, String> {
        let (_, cli) = crate::cli::find(harness).await?;
        *self.cli.lock().unwrap() = cli.clone();
        let mut account = self.account.clone();
        if self.about.reports_account {
            let _ = timeout(FIRST_REPORT, account.wait_for(Option::is_some)).await;
        }
        let status = account.borrow().clone();
        let by_account = status.as_ref().is_some_and(|s| s.kind == "account");
        Ok(Account {
            ways: self.ways.clone(),
            adapter: self.about.adapter.clone(),
            cli,
            signed_in_as: status.map(SignedInAs::from),
            signs_out: self.about.signs_out && by_account,
        })
    }

    /// Asks the Harness to sign out, when it says it does.
    pub async fn sign_out(&self) -> Result<(), String> {
        if !self.about.signs_out {
            return Err(format!(
                "{} does not sign out from Banda: sign out in a terminal.",
                self.name
            ));
        }
        let asked = self.cx.send_request(acp::LogoutRequest::new()).block_task();
        let signed_out = timeout(SIGNING_OUT, asked)
            .await
            .map_err(|_| format!("Signing out of {} took too long: try again.", self.name))?;
        signed_out
            .map(|_| ())
            .map_err(|error| format!("{} could not sign out: {}", self.name, in_words(&error)))
    }

    /// Signs in with `way`, which the Harness does by itself: Codex opens
    /// the browser and waits there for the Person.
    pub async fn sign_in(&self, way: &str) -> Result<(), String> {
        let request = acp::AuthenticateRequest::new(way.to_owned());
        let asked = self.cx.send_request(request).block_task();
        let signed_in = timeout(SIGNING_IN, asked)
            .await
            .map_err(|_| format!("Signing in to {} took too long: try again.", self.name))?;
        signed_in
            .map(|_| ())
            .map_err(|error| format!("{} could not sign in: {}", self.name, in_words(&error)))
    }
}

/// The ways `harness` offers to sign in, from what it said when it
/// started. A way in a terminal runs the Harness's own program with the
/// way's arguments after its own, and the way's environment over its own,
/// as ACP has a client do; a kind Banda does not know is left out.
fn ways(harness: &Harness, methods: Vec<acp::AuthMethod>) -> Vec<SignInWay> {
    methods
        .into_iter()
        .filter_map(|method| {
            let terminal = match &method {
                acp::AuthMethod::Terminal(way) => Some(harness.program(&way.args, &way.env)),
                acp::AuthMethod::Agent(_) => None,
                _ => return None,
            };
            Some(SignInWay {
                id: method.id().0.to_string(),
                name: method.name().to_owned(),
                description: method.description().map(str::to_owned),
                terminal,
            })
        })
        .collect()
}

async fn drive(
    process: AcpAgent,
    routes: Routes,
    learned: Learned,
    told: watch::Sender<Option<AuthStatus>>,
    ready: oneshot::Sender<Result<Started, String>>,
) {
    let heard = routes.clone();
    let asked = routes.clone();
    let filling = routes.clone();
    let served = Client
        .builder()
        .name("banda")
        .on_receive_notification(
            async move |note: AuthStatusUpdate, _cx: ConnectionTo<Agent>| {
                told.send_replace(Some(note.status));
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
                let said = match note.update {
                    acp::SessionUpdate::ConfigOptionUpdate(now) => {
                        let known = learn(&learned, &note.session_id, now.config_options);
                        Some(Said::Runs(running(&known)))
                    }
                    acp::SessionUpdate::AvailableCommandsUpdate(now) => {
                        Some(Said::Runs(update(&learned, &note.session_id, |known| {
                            known.said = Some(now.available_commands);
                            known.read_commands();
                            running(known)
                        })))
                    }
                    now => said(now),
                };
                // What it has used may come between turns: the next turn
                // writes what it last said.
                if let Some(Said::Used { usage, .. }) = &said {
                    update(&learned, &note.session_id, |known| {
                        known.usage = Some(usage.clone());
                    });
                }
                if let Some(said) = said
                    && let Some(route) = heard.of(&note.session_id)
                {
                    route.send(said);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: acp::RequestPermissionRequest,
                        responder: agent_client_protocol::Responder<
                acp::RequestPermissionResponse,
            >,
                        cx: ConnectionTo<Agent>| {
                let (answer, decided) = oneshot::channel();
                let fields = &request.tool_call.fields;
                let call = request.tool_call.tool_call_id.0.to_string();
                let question = Said::Asks {
                    call: call.clone(),
                    title: fields.title.clone(),
                    tool: fields.kind.map(tool_kind),
                    offered: request.options.iter().map(offered).collect(),
                    form: None,
                    plan: proposed(fields),
                    answer,
                };
                let route = asked.of(&request.session_id);
                let Some(route) = route.filter(|route| route.send(question)) else {
                    return responder.respond(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    ));
                };
                let withdrawn = responder.cancellation();
                cx.spawn(async move {
                    let decided = tokio::select! {
                        decided = decided => decided,
                        () = withdrawn.cancelled() => {
                            let _ = route.send(Said::Withdrawn(call));
                            Ok(Answer::Cancelled)
                        }
                    };
                    let outcome = match decided {
                        Ok(Answer::Chose(option)) => acp::RequestPermissionOutcome::Selected(
                            acp::SelectedPermissionOutcome::new(option),
                        ),
                        Ok(Answer::Filled(_) | Answer::Cancelled) | Err(_) => {
                            acp::RequestPermissionOutcome::Cancelled
                        }
                    };
                    responder.respond(acp::RequestPermissionResponse::new(outcome))
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: acp::CreateElicitationRequest,
                        responder: agent_client_protocol::Responder<
                acp::CreateElicitationResponse,
            >,
                        cx: ConnectionTo<Agent>| {
                let cancel = || acp::CreateElicitationResponse::new(acp::ElicitationAction::Cancel);
                // Only a form in a session can be asked in a Thread.
                let acp::ElicitationMode::Form(form) = &request.mode else {
                    return responder.respond(cancel());
                };
                let acp::ElicitationScope::Session(scope) = &form.scope else {
                    return responder.respond(cancel());
                };
                let Some(route) = filling.of(&scope.session_id) else {
                    return responder.respond(cancel());
                };
                let Some(fields) = form_fields(&form.requested_schema) else {
                    let _ = route.send(Said::Notice(
                        "The Agent asked with a form Banda cannot show, so it went unanswered."
                            .to_owned(),
                    ));
                    return responder.respond(cancel());
                };
                let call = scope.tool_call_id.as_ref().map_or_else(
                    || format!("form-{}", uuid::Uuid::now_v7()),
                    |id| id.0.to_string(),
                );
                let (answer, decided) = oneshot::channel();
                let choice = |id: &str, name: &str, allows| Offered {
                    id: id.to_owned(),
                    name: name.to_owned(),
                    allows,
                    always: false,
                };
                let question = Said::Asks {
                    call: call.clone(),
                    title: Some(request.message.clone()),
                    tool: None,
                    offered: vec![choice(SUBMIT, "Submit", true), choice(SKIP, "Skip", false)],
                    form: Some(fields.clone()),
                    plan: None,
                    answer,
                };
                if !route.send(question) {
                    return responder.respond(cancel());
                }
                let withdrawn = responder.cancellation();
                cx.spawn(async move {
                    let decided = tokio::select! {
                        decided = decided => decided,
                        // The Harness stopped waiting, as Codex does when
                        // its question times out: the Question closes.
                        () = withdrawn.cancelled() => {
                            let _ = route.send(Said::Withdrawn(call));
                            Ok(Answer::Cancelled)
                        }
                    };
                    let action = match decided {
                        Ok(Answer::Filled(values)) => acp::ElicitationAction::Accept(
                            acp::ElicitationAcceptAction::new().content(content(&fields, values)),
                        ),
                        Ok(Answer::Chose(_)) => acp::ElicitationAction::Decline,
                        Ok(Answer::Cancelled) | Err(_) => acp::ElicitationAction::Cancel,
                    };
                    responder.respond(acp::CreateElicitationResponse::new(action))
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(process, async move |cx: ConnectionTo<Agent>| {
            let options = acp::SessionConfigOptionsCapabilities::new()
                .boolean(acp::BooleanConfigOptionCapabilities::new());
            let forms =
                acp::ElicitationCapabilities::new().form(acp::ElicitationFormCapabilities::new());
            let mut output = acp::Meta::new();
            output.insert(OUTPUT_META.to_owned(), true.into());
            let shows = acp::ClientCapabilities::new()
                .auth(acp::AuthCapabilities::new().terminal(true))
                .elicitation(forms)
                .session(
                    acp::ClientSessionCapabilities::new()
                        .notices(acp::NoticeCapabilities::new())
                        .config_options(options),
                )
                .meta(output);
            let hello = acp::InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(shows)
                .client_info(acp::Implementation::new("banda", env!("CARGO_PKG_VERSION")));
            let agreed = cx.send_request(hello).block_task().await;
            match agreed {
                Ok(answer) if answer.protocol_version == ProtocolVersion::V1 => {
                    let capabilities = &answer.agent_capabilities;
                    let steering = answer
                        .meta
                        .as_ref()
                        .and_then(|meta| meta.get(STEERING_META));
                    let agreed = Agreed {
                        loads: capabilities.load_session,
                        resumes: capabilities.session_capabilities.resume.is_some(),
                        images: capabilities.prompt_capabilities.image,
                        forks: capabilities.session_capabilities.fork.is_some(),
                        steers: steering
                            .and_then(|steering| steering.get("supported"))
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                    };
                    let reports_account = capabilities
                        .meta
                        .as_ref()
                        .is_some_and(|meta| meta.contains_key(REPORTS_ACCOUNT_META));
                    let adapter = answer.agent_info.map(|info| Adapter {
                        name: info.title.unwrap_or(info.name),
                        version: info.version,
                    });
                    let about = About {
                        adapter,
                        signs_out: capabilities.auth.logout.is_some(),
                        reports_account,
                    };
                    let _ = ready.send(Ok(Started {
                        cx: cx.clone(),
                        agreed,
                        methods: answer.auth_methods,
                        about,
                    }));
                }
                Ok(answer) => {
                    let _ = ready.send(Err(format!(
                        "The Harness speaks ACP {:?}; Banda speaks version 1.",
                        answer.protocol_version
                    )));
                    return Ok(());
                }
                Err(error) => {
                    let _ = ready.send(Err(format!("The Harness did not start: {error}")));
                    return Ok(());
                }
            }
            cx.incoming_closed().await;
            Ok(())
        })
        .await;
    if let Err(error) = served {
        tracing::warn!(%error, "a Harness connection ended with an error");
    }
    routes.clear();
}

/// A prompt as ACP content: its text, its command, then its images.
fn blocks(
    Prompt {
        text,
        command,
        images,
    }: &Prompt,
) -> Vec<acp::ContentBlock> {
    let texts = (!text.is_empty())
        .then_some(text)
        .into_iter()
        .chain(command);
    let text = texts.map(|text| acp::ContentBlock::Text(acp::TextContent::new(text)));
    let images = images.iter().map(|image| {
        acp::ContentBlock::Image(acp::ImageContent::new(
            BASE64.encode(&image.bytes),
            image.mime.clone(),
        ))
    });
    text.into_iter().chain(images).collect()
}

fn message_of(chunk: &acp::ContentChunk) -> Option<String> {
    chunk.message_id.as_ref().map(|id| id.0.to_string())
}

fn text_of(chunk: &acp::ContentChunk) -> Option<String> {
    match &chunk.content {
        acp::ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

fn said(update: acp::SessionUpdate) -> Option<Said> {
    match update {
        acp::SessionUpdate::AgentMessageChunk(chunk) => {
            let message = message_of(&chunk);
            text_of(&chunk).map(|text| Said::Reply { text, message })
        }
        acp::SessionUpdate::AgentThoughtChunk(chunk) => {
            let message = message_of(&chunk);
            text_of(&chunk).map(|text| Said::Thought { text, message })
        }
        acp::SessionUpdate::ToolCall(call) => Some(Said::ToolStarted {
            call: call.tool_call_id.0.to_string(),
            title: call.title,
            tool: tool_kind(call.kind),
            status: tool_status(call.status),
            content: tool_content(&call.content),
        }),
        acp::SessionUpdate::ToolCallUpdate(update) => {
            let terminal = |key: &str| update.meta.as_ref()?.get(key);
            let exit = terminal(EXIT_META).map(|ended| Exit {
                code: ended
                    .get("exit_code")
                    .and_then(serde_json::Value::as_i64)
                    .and_then(|code| i32::try_from(code).ok()),
                signal: ended
                    .get("signal")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
            });
            Some(Said::ToolChanged {
                call: update.tool_call_id.0.to_string(),
                change: ToolChange {
                    title: update.fields.title,
                    status: update.fields.status.map(tool_status),
                    content: update.fields.content.as_deref().map(tool_content),
                    exit,
                },
                output: terminal(OUTPUT_META)
                    .and_then(|o| o.get("data")?.as_str())
                    .map(str::to_owned),
            })
        }
        acp::SessionUpdate::Plan(plan) => Some(Said::Steps(
            plan.entries
                .into_iter()
                .map(|entry| PlanStep {
                    text: entry.content,
                    state: step_state(&entry.status),
                })
                .collect(),
        )),
        acp::SessionUpdate::UsageUpdate(update) => Some(Said::Used {
            resets: resets(update.meta.as_ref()),
            usage: usage(update),
        }),
        acp::SessionUpdate::Notice(notice) => Some(Said::Notice(match notice.description {
            Some(more) if !more.trim().is_empty() => format!("{} {more}", notice.title),
            _ => notice.title,
        })),
        _ => None,
    }
}

/// What a tool call shows: its text, its diffs, and where its command's
/// output goes, which comes apart, in [`OUTPUT_META`].
fn tool_content(content: &[acp::ToolCallContent]) -> Vec<ToolContent> {
    content
        .iter()
        .filter_map(|shown| match shown {
            acp::ToolCallContent::Content(acp::Content {
                content: acp::ContentBlock::Text(text),
                ..
            }) => Some(ToolContent::Text {
                text: text.text.clone(),
            }),
            acp::ToolCallContent::Diff(diff) => Some(ToolContent::Diff {
                path: diff.path.display().to_string(),
                old: diff.old_text.clone(),
                new: diff.new_text.clone(),
            }),
            acp::ToolCallContent::Terminal(_) => Some(ToolContent::Terminal),
            _ => None,
        })
        .collect()
}

/// The values a choice option offers; none for any other.
fn values(option: &acp::SessionConfigOption) -> Vec<&str> {
    let acp::SessionConfigKind::Select(select) = &option.kind else {
        return Vec::new();
    };
    match &select.options {
        acp::SessionConfigSelectOptions::Ungrouped(choices) => {
            choices.iter().map(|c| &*c.value.0).collect()
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|g| &g.options)
            .map(|c| &*c.value.0)
            .collect(),
        _ => Vec::new(),
    }
}

fn current(option: &acp::SessionConfigOption) -> Option<OptionValue> {
    match &option.kind {
        acp::SessionConfigKind::Select(select) => {
            Some(OptionValue::Choice(select.current_value.0.to_string()))
        }
        acp::SessionConfigKind::Boolean(toggle) => Some(OptionValue::Toggle(toggle.current_value)),
        _ => None,
    }
}

fn category(option: &acp::SessionConfigOption) -> Option<String> {
    let word = serde_json::to_value(option.category.as_ref()?).ok()?;
    word.as_str().map(str::to_owned)
}

/// The Harness's own permission modes.
fn is_mode(option: &acp::SessionConfigOption) -> bool {
    option.category == Some(acp::SessionConfigOptionCategory::Mode)
}

/// Codex's switch between planning and working.
fn is_collaboration(option: &acp::SessionConfigOption) -> bool {
    &*option.id.0 == COLLABORATION || category(option).as_deref() == Some(COLLABORATION)
}

fn mode_of(value: &str) -> Option<Mode> {
    MODES
        .iter()
        .find(|(_, values)| values.contains(&value))
        .map(|(mode, _)| *mode)
}

/// Whether the Harness has modes Banda knows: Claude Code's or Codex's,
/// told by the two strictest, which each offers always. Another Harness's
/// mode named `default` is not enough.
fn native(options: &[acp::SessionConfigOption]) -> bool {
    let Some(modes) = options.iter().find(|o| is_mode(o)) else {
        return false;
    };
    let offers = values(modes);
    (0..2).any(|harness| {
        MODES[..2]
            .iter()
            .all(|(_, names)| offers.contains(&names[harness]))
    })
}

/// What a session runs with, from its options.
fn running(known: &Known) -> Running {
    let (native, options) = (known.native, &known.options);
    let modes = options.iter().find(|o| is_mode(o));
    let collaboration = options.iter().find(|o| is_collaboration(o));
    let now = |option: Option<&acp::SessionConfigOption>| match option.and_then(current) {
        Some(OptionValue::Choice(value)) => Some(value),
        _ => None,
    };
    let (mode_now, planning_now) = (now(modes), now(collaboration));
    let plans = [modes, collaboration]
        .into_iter()
        .flatten()
        .any(|o| values(o).contains(&PLAN));
    let mut offered: Vec<HarnessOption> = options
        .iter()
        .filter(|o| !(native && (is_mode(o) || is_collaboration(o))))
        .filter_map(harness_option)
        .collect();
    let rank = |o: &HarnessOption| match o.category.as_deref() {
        Some("model") => 0,
        Some("thought_level") => 1,
        Some("model_config") => 2,
        _ => 3,
    };
    offered.sort_by_key(rank);
    Running {
        native,
        mode: mode_now.as_deref().and_then(mode_of),
        plan: native
            && [mode_now, planning_now]
                .iter()
                .any(|v| v.as_deref() == Some(PLAN)),
        offer: Offer {
            options: offered,
            plans: native && plans,
            slash_commands: Vec::new(),
            skills: Vec::new(),
            no_images: false,
            outdated: None,
        },
        commands: known.commands.clone(),
    }
}

/// The commands a session in `folder` said, its slash commands apart
/// from its skills: Codex says each of its skills as a command named `$`
/// and the skill's name, which a message names anywhere in its text.
/// Claude Code says its skills as slash commands: one whose `SKILL.md` is
/// in the folder or the home folder is a skill too (issue #149).
fn commands(said: &[acp::AvailableCommand], folder: Option<&Path>) -> Commands {
    let home = dirs::home_dir();
    let mut commands = Commands::default();
    for command in said {
        let skill = |name: &str| Skill {
            name: name.to_owned(),
            description: command.description.clone(),
        };
        match command.name.strip_prefix('$') {
            Some("") => {}
            Some(name) => commands.skills.push(skill(name)),
            None => {
                if crate::skills::file(&command.name, folder, home.as_deref()).is_some() {
                    commands.skills.push(skill(&command.name));
                    commands.slashed.push(command.name.clone());
                }
                commands.slash_commands.push(slash_command(command));
            }
        }
    }
    commands
}

fn slash_command(command: &acp::AvailableCommand) -> SlashCommand {
    SlashCommand {
        name: command.name.clone(),
        description: command.description.clone(),
        hint: match &command.input {
            Some(acp::AvailableCommandInput::Unstructured(input)) => Some(input.hint.clone()),
            _ => None,
        },
    }
}

fn harness_option(option: &acp::SessionConfigOption) -> Option<HarnessOption> {
    let choices = match &option.kind {
        acp::SessionConfigKind::Select(select) => match &select.options {
            acp::SessionConfigSelectOptions::Ungrouped(choices) => choices.iter().collect(),
            acp::SessionConfigSelectOptions::Grouped(groups) => {
                groups.iter().flat_map(|g| &g.options).collect()
            }
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    Some(HarnessOption {
        id: option.id.0.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: category(option),
        value: current(option)?,
        choices: choices
            .into_iter()
            .map(|c| OptionChoice {
                value: c.value.0.to_string(),
                name: c.name.clone(),
                description: c.description.clone(),
            })
            .collect(),
    })
}

/// The value `option` should have for a session to run as `wanted`, if it
/// offers one.
fn wanted_value(
    option: &acp::SessionConfigOption,
    native: bool,
    wanted: &Settings,
) -> Option<OptionValue> {
    let offers = values(option);
    let choice = |value: &str| {
        offers
            .contains(&value)
            .then(|| OptionValue::Choice(value.to_owned()))
    };
    if native && is_mode(option) {
        if wanted.plan && offers.contains(&PLAN) {
            return choice(PLAN);
        }
        // The chosen mode, or else the freest one below it.
        let at = MODES.iter().position(|(m, _)| *m == wanted.mode)?;
        return MODES[..=at]
            .iter()
            .rev()
            .flat_map(|(_, values)| values)
            .find_map(|value| choice(value));
    }
    if native && is_collaboration(option) {
        return choice(if wanted.plan { PLAN } else { WORKING });
    }
    match (wanted.options.get(&*option.id.0)?, &option.kind) {
        (OptionValue::Choice(value), acp::SessionConfigKind::Select(_)) => choice(value),
        (OptionValue::Toggle(on), acp::SessionConfigKind::Boolean(_)) => {
            Some(OptionValue::Toggle(*on))
        }
        _ => None,
    }
}

/// The next option to set for a session to run as `wanted`: the mode, the
/// plan, the model, then the rest in the Harness's order. `tried` are the
/// options set already this time.
fn next_change(
    known: &Known,
    wanted: &Settings,
    tried: &[String],
) -> Option<(String, acp::SessionConfigOptionValue)> {
    let (native, options) = (known.native, &known.options);
    let order = |o: &acp::SessionConfigOption| {
        if native && is_mode(o) {
            0
        } else if native && is_collaboration(o) {
            1
        } else if o.category == Some(acp::SessionConfigOptionCategory::Model) {
            2
        } else {
            3
        }
    };
    let mut candidates: Vec<_> = options
        .iter()
        .filter(|o| !tried.iter().any(|t| **t == *o.id.0))
        .collect();
    candidates.sort_by_key(|o| order(o));
    candidates.into_iter().find_map(|option| {
        let value = wanted_value(option, native, wanted)?;
        (current(option)? != value).then(|| {
            let value = match value {
                OptionValue::Choice(id) => acp::SessionConfigOptionValue::value_id(id),
                OptionValue::Toggle(on) => acp::SessionConfigOptionValue::boolean(on),
            };
            (option.id.0.to_string(), value)
        })
    })
}

/// When a rejected account may be used again, from Claude Code's rate
/// limit update: `{status, resetsAt}` in seconds.
fn resets(meta: Option<&acp::Meta>) -> Option<i64> {
    let limit = meta?.get("_claude/rateLimit")?;
    let rejected = limit.get("status")?.as_str()? == "rejected";
    let at = limit.get("resetsAt")?.as_i64()?;
    rejected.then_some(at.saturating_mul(1000))
}

/// Whether the request failed because the Harness's process went away.
fn gone(error: &acp::Error) -> bool {
    agent_client_protocol::is_connection_terminated(error)
        || agent_client_protocol::is_incoming_transport_closed(error)
}

/// How a turn ends on an error from its Harness: the class from ACP's code
/// and the data the adapter attached, in the Harness's own words when it
/// gave some.
fn failed(name: &str, error: &acp::Error) -> Ending {
    let data = error.data.as_ref();
    let said = |key: &str| data.and_then(|d| d.get(key)).and_then(|v| v.as_str());
    let failure = if error.code == acp::ErrorCode::AuthRequired {
        Failure::SignIn
    } else {
        match said("errorKind").or_else(|| said("codexErrorInfo")) {
            Some("authentication_failed" | "oauth_org_not_allowed" | "unauthorized") => {
                Failure::SignIn
            }
            Some(
                "rate_limit" | "billing_error" | "account_on_hold" | "usageLimitExceeded"
                | "rateLimitExceeded",
            ) => Failure::UsageLimit { until: None },
            _ => Failure::Provider,
        }
    };
    let words = said("message").map(str::to_owned).or_else(|| {
        let message = error.message.trim();
        let message = message.strip_prefix("Internal error").unwrap_or(message);
        let message = message.trim_start_matches(':').trim();
        (!message.is_empty()).then(|| message.to_owned())
    });
    let reason = match (failure, words) {
        (Failure::SignIn, _) => format!("{name} needs you to sign in."),
        (_, Some(words)) => words,
        (Failure::UsageLimit { .. }, None) => format!("{name} has reached its usage limit."),
        (_, None) => format!("{name} reported an error."),
    };
    Ending::failed(reason, Some(failure))
}

/// A form's fields, from the JSON Schema the Harness asks with. A field of
/// a kind Banda cannot show is left out.
fn form_fields(schema: &acp::ElicitationSchema) -> Option<Vec<Field>> {
    let required = schema.required.as_deref().unwrap_or_default();
    let choices = |options: &[acp::EnumOption]| {
        options
            .iter()
            .map(|o| OptionChoice {
                value: o.value.clone(),
                name: o.title.clone(),
                description: o.description.clone(),
            })
            .collect::<Vec<_>>()
    };
    let named = |values: &[String]| {
        values
            .iter()
            .map(|v| OptionChoice {
                value: v.clone(),
                name: v.clone(),
                description: None,
            })
            .collect::<Vec<_>>()
    };
    let number = |n: Option<f64>| n.and_then(serde_json::Number::from_f64);
    let count = |n: Option<u64>| n.map(|n| u32::try_from(n).unwrap_or(u32::MAX));
    let mut fields = Vec::new();
    for (id, property) in &schema.properties {
        use acp::ElicitationPropertySchema as Property;
        let mut secret = false;
        let shown = match property {
            Property::String(text) => {
                // Codex marks a question whose answer is a secret.
                secret = text
                    .meta
                    .as_ref()
                    .and_then(|m| m.get("codex")?.get("isSecret")?.as_bool())
                    .unwrap_or(false);
                let input = match (&text.one_of, &text.enum_values) {
                    (Some(options), _) => Input::Choice {
                        choices: choices(options),
                        default: text.default.clone(),
                    },
                    (None, Some(values)) => Input::Choice {
                        choices: named(values),
                        default: text.default.clone(),
                    },
                    (None, None) => Input::Text {
                        default: text.default.clone(),
                        shortest: text.min_length,
                        longest: text.max_length,
                        format: text.format.and_then(|f| match f {
                            acp::StringFormat::Email => Some(TextFormat::Email),
                            acp::StringFormat::Uri => Some(TextFormat::Uri),
                            acp::StringFormat::Date => Some(TextFormat::Date),
                            acp::StringFormat::DateTime => Some(TextFormat::DateTime),
                            _ => None,
                        }),
                    },
                };
                Some((&text.title, &text.description, input))
            }
            Property::Number(n) => Some((
                &n.title,
                &n.description,
                Input::Number {
                    integer: false,
                    minimum: number(n.minimum),
                    maximum: number(n.maximum),
                    default: number(n.default),
                },
            )),
            Property::Integer(n) => Some((
                &n.title,
                &n.description,
                Input::Number {
                    integer: true,
                    minimum: n.minimum.map(Into::into),
                    maximum: n.maximum.map(Into::into),
                    default: n.default.map(Into::into),
                },
            )),
            Property::Boolean(toggle) => Some((
                &toggle.title,
                &toggle.description,
                Input::Toggle {
                    default: toggle.default,
                },
            )),
            Property::Array(many) => {
                let options = match &many.items {
                    acp::MultiSelectItems::String(items) => Some(named(&items.values)),
                    acp::MultiSelectItems::Titled(items) => Some(choices(&items.options)),
                    _ => None,
                };
                options.map(|options| {
                    let input = Input::Choices {
                        choices: options,
                        default: many.default.clone().unwrap_or_default(),
                        fewest: count(many.min_items),
                        most: count(many.max_items),
                    };
                    (&many.title, &many.description, input)
                })
            }
            _ => None,
        };
        let required = required.contains(id);
        match shown {
            Some((title, description, input)) => fields.push(Field {
                id: id.clone(),
                title: title.clone().unwrap_or_else(|| id.clone()),
                description: description.clone(),
                required,
                secret,
                input,
            }),
            // A field the Person cannot fill in: the form cannot be
            // submitted without it.
            None if required => return None,
            None => {}
        }
    }
    // The schema keeps no order; Claude Code's and Codex's IDs number
    // their questions, so `question_2` comes before `question_10`.
    fields.sort_by_cached_key(|f| natural(&f.id));
    Some(fields)
}

/// An ID's words and numbers, so numbers sort as numbers.
fn natural(id: &str) -> Vec<(String, u64)> {
    let mut parts = Vec::new();
    let mut rest = id;
    while !rest.is_empty() {
        let digits = rest
            .find(|c: char| c.is_ascii_digit())
            .unwrap_or(rest.len());
        let (word, after) = rest.split_at(digits);
        let end = after
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(after.len());
        let (number, after) = after.split_at(end);
        parts.push((word.to_owned(), number.parse().unwrap_or(0)));
        rest = after;
    }
    parts
}

/// What a Person filled in, as the Harness takes it.
fn content(fields: &[Field], values: Values) -> BTreeMap<String, acp::ElicitationContentValue> {
    use acp::ElicitationContentValue as Content;
    values
        .into_iter()
        .filter_map(|(id, value)| {
            let integer = fields
                .iter()
                .any(|f| f.id == id && matches!(f.input, Input::Number { integer: true, .. }));
            let value = match value {
                FieldValue::Text(text) => Content::String(text),
                FieldValue::Toggle(on) => Content::Boolean(on),
                FieldValue::Number(n) if integer => Content::Integer(n.as_i64()?),
                FieldValue::Number(n) => Content::Number(n.as_f64()?),
                FieldValue::Choices(values) => Content::StringArray(values),
            };
            Some((id, value))
        })
        .collect()
}

fn offered(option: &acp::PermissionOption) -> Offered {
    use acp::PermissionOptionKind as Kind;
    Offered {
        id: option.option_id.0.to_string(),
        name: option.name.clone(),
        allows: matches!(option.kind, Kind::AllowOnce | Kind::AllowAlways),
        always: matches!(option.kind, Kind::AllowAlways | Kind::RejectAlways),
    }
}

/// The plan a Harness asks to carry out: Claude Code leaves plan mode by
/// asking, the plan in what it would call the tool with.
fn proposed(fields: &acp::ToolCallUpdateFields) -> Option<String> {
    if fields.kind != Some(acp::ToolKind::SwitchMode) {
        return None;
    }
    let plan = fields.raw_input.as_ref()?.get("plan")?.as_str()?.trim();
    (!plan.is_empty()).then(|| plan.to_owned())
}

fn tool_kind(kind: acp::ToolKind) -> ToolKind {
    match kind {
        acp::ToolKind::Read => ToolKind::Read,
        acp::ToolKind::Edit => ToolKind::Edit,
        acp::ToolKind::Delete => ToolKind::Delete,
        acp::ToolKind::Move => ToolKind::Move,
        acp::ToolKind::Search => ToolKind::Search,
        acp::ToolKind::Execute => ToolKind::Execute,
        acp::ToolKind::Think => ToolKind::Think,
        acp::ToolKind::Fetch => ToolKind::Fetch,
        _ => ToolKind::Other,
    }
}

fn step_state(status: &acp::PlanEntryStatus) -> StepState {
    match status {
        acp::PlanEntryStatus::InProgress => StepState::InProgress,
        acp::PlanEntryStatus::Completed => StepState::Done,
        _ => StepState::Pending,
    }
}

fn usage(update: acp::UsageUpdate) -> Usage {
    let tokens = |n: u64| u32::try_from(n).unwrap_or(u32::MAX);
    Usage {
        used: tokens(update.used),
        size: tokens(update.size),
        cost: update.cost.and_then(|cost| {
            Some(Cost {
                amount: serde_json::Number::from_f64(cost.amount)?,
                currency: cost.currency,
            })
        }),
    }
}

fn tool_status(status: acp::ToolCallStatus) -> ToolStatus {
    match status {
        acp::ToolCallStatus::Pending => ToolStatus::Pending,
        acp::ToolCallStatus::InProgress => ToolStatus::Running,
        acp::ToolCallStatus::Completed => ToolStatus::Done,
        acp::ToolCallStatus::Failed => ToolStatus::Failed,
        _ => ToolStatus::Pending,
    }
}

fn ending(reason: &acp::StopReason) -> Ending {
    let (state, reason) = match reason {
        acp::StopReason::EndTurn => (TurnState::Done, None),
        acp::StopReason::Cancelled => (TurnState::Stopped, None),
        acp::StopReason::MaxTokens => (
            TurnState::Done,
            Some("The Agent reached the most it may write in one turn."),
        ),
        acp::StopReason::MaxTurnRequests => (
            TurnState::Done,
            Some("The Agent reached the most steps it may take in one turn."),
        ),
        acp::StopReason::Refusal => (TurnState::Done, Some("The Agent declined to go on.")),
        _ => (TurnState::Done, None),
    };
    Ending::new(state, reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_asking_to_leave_plan_mode_brings_its_plan() {
        let asks = |kind, input: serde_json::Value| {
            proposed(&acp::ToolCallUpdateFields::new().kind(kind).raw_input(input))
        };
        let plan = serde_json::json!({ "plan": "  # Plan\n\n1. Read it.\n" });
        assert_eq!(
            asks(acp::ToolKind::SwitchMode, plan.clone()).as_deref(),
            Some("# Plan\n\n1. Read it.")
        );
        assert_eq!(
            asks(acp::ToolKind::Execute, plan),
            None,
            "only leaving a mode"
        );
        let empty = serde_json::json!({ "plan": " " });
        assert_eq!(asks(acp::ToolKind::SwitchMode, empty), None);
    }

    fn select(id: &str, now: &str, values: &[&str]) -> acp::SessionConfigOption {
        let choices = values
            .iter()
            .map(|v| acp::SessionConfigSelectOption::new(v.to_string(), *v))
            .collect::<Vec<_>>();
        acp::SessionConfigOption::select(id.to_owned(), id.to_owned(), now.to_owned(), choices)
    }

    fn codex() -> Vec<acp::SessionConfigOption> {
        use acp::SessionConfigOptionCategory as Category;
        vec![
            select(
                "mode",
                "agent",
                &["read-only", "workspace-write", "agent", "agent-full-access"],
            )
            .category(Category::Mode),
            select("reasoning_effort", "medium", &["low", "medium", "high"])
                .category(Category::ThoughtLevel),
            select("model", "gpt", &["gpt", "gpt-mini"]).category(Category::Model),
            select(COLLABORATION, WORKING, &[WORKING, PLAN])
                .category(Category::Other(COLLABORATION.to_owned())),
        ]
    }

    /// Sets each next change in turn, as the Harness would take it.
    fn settle(options: Vec<acp::SessionConfigOption>, wanted: &Settings) -> Vec<String> {
        let mut known = Known::new(options);
        let mut tried = Vec::new();
        let mut set = Vec::new();
        while let Some((id, value)) = next_change(&known, wanted, &tried) {
            let value = value.as_value_id().unwrap().0.to_string();
            set.push(format!("{id}={value}"));
            let option = known.options.iter_mut().find(|o| *o.id.0 == *id).unwrap();
            if let acp::SessionConfigKind::Select(select) = &mut option.kind {
                select.current_value = acp::SessionConfigValueId::new(value);
            }
            tried.push(id);
        }
        set
    }

    #[test]
    fn codex_gets_its_own_modes_and_plans_in_its_collaboration_mode() {
        let wanted = Settings {
            plan: true,
            ..Settings::default()
        };
        assert_eq!(
            settle(codex(), &wanted),
            ["mode=agent-full-access", "collaboration_mode=plan"]
        );
        let running = running(&Known::new(codex()));
        assert!(running.native && running.offer.plans);
        assert_eq!(running.mode, Some(Mode::Auto));
        let offered: Vec<_> = running
            .offer
            .options
            .iter()
            .map(|o| o.id.as_str())
            .collect();
        assert_eq!(
            offered,
            ["model", "reasoning_effort"],
            "the model first; the modes stand apart"
        );
    }

    #[test]
    fn a_mode_the_harness_lacks_falls_to_the_freest_one_below_it() {
        // Claude Code offers no bypass when it runs as root.
        let claude = vec![
            select(
                "mode",
                "default",
                &["default", "acceptEdits", "plan", "auto"],
            )
            .category(acp::SessionConfigOptionCategory::Mode),
        ];
        assert_eq!(settle(claude.clone(), &Settings::default()), ["mode=auto"]);
        let planning = Settings {
            mode: Mode::AcceptEdits,
            plan: true,
            ..Settings::default()
        };
        assert_eq!(settle(claude.clone(), &planning), ["mode=plan"]);
        let supervised = Settings {
            mode: Mode::Supervised,
            ..Settings::default()
        };
        assert!(settle(claude, &supervised).is_empty(), "it runs so already");
    }

    fn schema(properties: serde_json::Value, required: &[&str]) -> acp::ElicitationSchema {
        let schema = serde_json::json!({
            "type": "object",
            "properties": properties,
            "required": required,
        });
        serde_json::from_value(schema).unwrap()
    }

    #[test]
    fn a_form_keeps_its_questions_in_order_and_its_secrets_marked() {
        let text = serde_json::json!({ "type": "string" });
        let secret = serde_json::json!({
            "type": "string",
            "_meta": { "codex": { "isSecret": true } },
        });
        let form = schema(
            serde_json::json!({
                "question_10": text,
                "question_2": text,
                "question_2_custom": text,
                "key": secret,
            }),
            &[],
        );
        let fields = form_fields(&form).unwrap();
        let ids: Vec<_> = fields.iter().map(|f| (f.id.as_str(), f.secret)).collect();
        assert_eq!(
            ids,
            [
                ("key", true),
                ("question_2", false),
                ("question_2_custom", false),
                ("question_10", false),
            ]
        );
    }

    #[test]
    fn a_form_with_a_required_field_banda_cannot_show_is_not_asked() {
        let future = serde_json::json!({ "type": "colour" });
        let optional = schema(serde_json::json!({ "shade": future }), &[]);
        assert_eq!(form_fields(&optional).unwrap(), []);
        let required = schema(serde_json::json!({ "shade": future }), &["shade"]);
        assert_eq!(form_fields(&required), None);
    }

    #[test]
    fn what_a_person_filled_in_goes_back_as_each_field_takes_it() {
        let form = schema(
            serde_json::json!({
                "count": { "type": "integer" },
                "share": { "type": "number" },
                "tags": { "type": "array", "items": { "type": "string", "enum": ["a", "b"] } },
            }),
            &[],
        );
        let fields = form_fields(&form).unwrap();
        let values: Values = serde_json::from_value(serde_json::json!({
            "count": 3, "share": 0.5, "tags": ["b"],
        }))
        .unwrap();
        let sent = serde_json::to_value(content(&fields, values)).unwrap();
        assert_eq!(
            sent,
            serde_json::json!({ "count": 3, "share": 0.5, "tags": ["b"] })
        );
    }

    #[test]
    fn a_mode_named_default_alone_is_not_claude_codes() {
        let other = vec![
            select("mode", "default", &["default", "autoEdit", "yolo"])
                .category(acp::SessionConfigOptionCategory::Mode),
        ];
        assert!(!native(&other));
        assert!(native(&codex()));
    }

    #[test]
    fn a_session_keeps_who_enforces_its_mode_and_its_last_options() {
        let learned = Learned::default();
        let session = acp::SessionId::new("s");
        assert!(learn(&learned, &session, codex()).native);
        let kept = learn(&learned, &session, Vec::new());
        assert_eq!(
            kept.options.len(),
            codex().len(),
            "an empty list keeps the last"
        );
        let model = vec![codex().remove(2)];
        let now = learn(&learned, &session, model);
        assert!(
            now.native,
            "a list without the modes changes nothing about them"
        );
        assert_eq!(now.options.len(), 1);
    }

    #[test]
    fn modes_banda_does_not_know_are_options_like_any_other() {
        let other = vec![
            select("mode", "ask", &["ask", "code"])
                .category(acp::SessionConfigOptionCategory::Mode),
        ];
        let running = running(&Known::new(other.clone()));
        assert!(!running.native && !running.offer.plans);
        assert_eq!(running.offer.options[0].id, "mode");
        let mut wanted = Settings::default();
        wanted
            .options
            .insert("mode".into(), OptionValue::Choice("code".into()));
        assert_eq!(settle(other.clone(), &wanted), ["mode=code"]);
        wanted
            .options
            .insert("mode".into(), OptionValue::Choice("gone".into()));
        assert!(
            settle(other, &wanted).is_empty(),
            "a value it no longer offers"
        );
    }
}
