//! The ACP adapter: one Harness process, spoken to over ACP v1 on its
//! stdio. ACP's words stop here: the rest of the module hears what the
//! Harness [`Said`], and how a turn ended, in the module's own words.
//!
//! The engine declares what it can show: notices and options that are on
//! or off. A Thread's settings become the session's options when a turn
//! starts ([`Connection::settle`]): the mode maps onto the Harness's own
//! modes where it has Claude Code's or Codex's, never freer than the one
//! chosen. A failure's class comes
//! from ACP's error codes and the data the adapters attach to an error
//! (`errorKind` from Claude Code's, `codexErrorInfo` from Codex's), and a
//! usage limit's reset from Claude Code's rate limit updates. The JetBrains
//! AIR extension would say more, but a client that declares it must render
//! the rest of AIR too.
//!
//! The connection's handlers run on its dispatch loop, so none of them
//! waits there. A permission request is routed to its turn, and a task off
//! the loop answers it once the Person decides.
//!
//! Starting a Harness and opening a session are bounded; a turn is not: it
//! runs until the Harness ends it or a Person stops it.

use crate::model::{
    Failure, HarnessOption, Mode, Offer, OptionChoice, OptionValue, Settings, ThreadId, ToolKind,
    ToolStatus, TurnState,
};
use crate::rules::{Ending, Offered};
use crate::settings::Harness;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// How long a Harness may take to start and agree on ACP. The first start
/// may download it.
const STARTING: Duration = Duration::from_secs(120);
/// How long a Harness may take to open a session.
const OPENING: Duration = Duration::from_secs(60);

/// What a Harness said during a turn.
pub enum Said {
    Reply(String),
    Thought(String),
    ToolStarted {
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
    },
    ToolChanged {
        call: String,
        title: Option<String>,
        status: Option<ToolStatus>,
    },
    /// The Harness asks a Person to decide, and waits for `answer`.
    Asks {
        call: String,
        title: Option<String>,
        /// What the tool call would do, if the Harness says here.
        tool: Option<ToolKind>,
        offered: Vec<Offered>,
        answer: oneshot::Sender<Answer>,
    },
    /// The session's options changed during the turn.
    Runs(Running),
    /// A line for the Person, such as a warning.
    Notice(String),
    /// The account may be used again at this time, in milliseconds since
    /// the epoch: it has reached its limit.
    Resets(i64),
}

/// What goes back to a Harness that asked.
#[derive(Debug)]
pub enum Answer {
    Chose(String),
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
}

impl Evidence {
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

/// What a session runs with, as the Harness last said.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Running {
    /// The Harness has modes of its own and enforces the Thread's mode.
    pub native: bool,
    /// The mode it runs in, when that is one of Bandaso's.
    pub mode: Option<Mode>,
    /// It plans before it changes anything.
    pub plan: bool,
    pub offer: Offer,
}

/// Each mode as the Harnesses with modes of their own name it, Claude
/// Code's first, then Codex's; from the strictest to the freest.
const MODES: [(Mode, [&str; 2]); 4] = [
    (Mode::Supervised, ["default", "read-only"]),
    (Mode::AcceptEdits, ["acceptEdits", "workspace-write"]),
    (Mode::Auto, ["auto", "agent"]),
    (Mode::FullAccess, ["bypassPermissions", "agent-full-access"]),
];
/// Planning: one of Claude Code's modes, and Codex's collaboration mode.
const PLAN: &str = "plan";
const WORKING: &str = "default";
const COLLABORATION: &str = "collaboration_mode";

type Routes = Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>;
/// Each session's options, as the Harness last said.
type Options = Arc<Mutex<HashMap<acp::SessionId, Vec<acp::SessionConfigOption>>>>;

/// What the Harness said it can do with sessions.
#[derive(Clone, Copy)]
struct Agreed {
    loads: bool,
    resumes: bool,
}

/// One Harness process and its ACP connection. Dropping it stops the
/// process and everything it started.
pub struct Connection {
    cx: ConnectionTo<Agent>,
    harness: String,
    /// The Harness's name, for plain words.
    name: String,
    agreed: Agreed,
    routes: Routes,
    options: Options,
    /// When a turn last began or ended here.
    active: Arc<Mutex<Instant>>,
    /// The Harness's session for each Thread, in this process.
    sessions: tokio::sync::Mutex<HashMap<ThreadId, acp::SessionId>>,
    driver: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl Connection {
    /// Starts `harness` and agrees on ACP v1 with it.
    pub async fn start(harness: &Harness) -> Result<Arc<Connection>, String> {
        let config = AcpAgentConfig::new(&harness.command)
            .args(harness.args.iter().cloned())
            .envs(harness.env.clone());
        let name = harness.id.clone();
        let process = AcpAgent::new(config).with_debug(move |line, direction| {
            if matches!(direction, LineDirection::Stderr) {
                tracing::debug!(harness = %name, "{line}");
            }
        });
        let (routes, options) = (Routes::default(), Options::default());
        let (ready, started) = oneshot::channel();
        let driver = tokio::spawn(drive(process, routes.clone(), options.clone(), ready));
        let (cx, agreed) = match timeout(STARTING, started).await {
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
            routes,
            options,
            active: Arc::new(Mutex::new(Instant::now())),
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
        let busy = !self.routes.lock().unwrap().is_empty();
        (!busy).then(|| *self.active.lock().unwrap())
    }

    /// Marks the host as just used, so it is not let go as idle.
    pub fn touch(&self) {
        *self.active.lock().unwrap() = Instant::now();
    }

    /// The Harness's session for `thread`, opened in `folder` on first use.
    /// A Thread that had a session continues it when the Harness can, by
    /// resuming it or else by loading it; otherwise a new one opens.
    pub async fn session(
        &self,
        thread: ThreadId,
        folder: &Path,
        earlier: Option<&Evidence>,
    ) -> Result<(Session, Opened), Ending> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(&thread) {
            return Ok((Session(session.clone()), Opened::Known));
        }
        if let Some(session) = earlier.and_then(|e| e.continued_by(&self.harness))
            && let Some(options) = self.continue_session(&session, folder).await
        {
            self.options
                .lock()
                .unwrap()
                .insert(session.clone(), options);
            sessions.insert(thread, session.clone());
            return Ok((Session(session), Opened::Continued));
        }
        let opening = self
            .cx
            .send_request(acp::NewSessionRequest::new(folder))
            .block_task();
        let made = match timeout(OPENING, opening).await {
            Ok(made) => made.map_err(|error| failed(&self.name, &error))?,
            Err(_) => {
                return Err(Ending::failed(
                    format!("{} did not open a session within a minute.", self.name),
                    Some(Failure::HarnessStopped),
                ));
            }
        };
        let options = made.config_options.unwrap_or_default();
        self.options
            .lock()
            .unwrap()
            .insert(made.session_id.clone(), options);
        sessions.insert(thread, made.session_id.clone());
        let evidence = Evidence {
            harness: self.harness.clone(),
            session: made.session_id.0.to_string(),
            lasts: if self.agreed.loads || self.agreed.resumes {
                Lasts::Harness
            } else {
                Lasts::Process
            },
        };
        let lost = earlier.is_some();
        Ok((Session(made.session_id), Opened::New { evidence, lost }))
    }

    /// Asks the Harness to continue `session`: resumed if it can, else
    /// loaded. A load replays the conversation, which nobody hears: the
    /// Thread already shows it. The session's options, if it is open again.
    async fn continue_session(
        &self,
        session: &acp::SessionId,
        folder: &Path,
    ) -> Option<Vec<acp::SessionConfigOption>> {
        let answer = if self.agreed.resumes {
            let resume = acp::ResumeSessionRequest::new(session.clone(), folder);
            let asked = self.cx.send_request(resume).block_task();
            timeout(OPENING, asked)
                .await
                .map(|a| a.map(|r| r.config_options))
        } else if self.agreed.loads {
            let load = acp::LoadSessionRequest::new(session.clone(), folder);
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
        let known = self.options.lock().unwrap().get(session).cloned();
        let mut options = known.unwrap_or_default();
        let (mut tried, mut refused) = (Vec::new(), Vec::new());
        while let Some((id, value)) = next_change(&options, wanted, &tried) {
            let name = options
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
                Ok(Ok(answer)) => options = answer.config_options,
                Ok(Err(error)) => refused.push(format!(
                    "{} did not take the setting {name}: {}",
                    self.name, error.message
                )),
                Err(_) => refused.push(format!(
                    "{} did not answer when Bandaso set {name}.",
                    self.name
                )),
            }
        }
        let running = running(&options);
        self.options
            .lock()
            .unwrap()
            .insert(session.clone(), options);
        (running, refused)
    }

    /// Sends a prompt. What the Harness says comes on the receiver; the
    /// returned task ends with the turn.
    pub fn prompt(
        &self,
        Session(session): &Session,
        text: &str,
    ) -> (mpsc::UnboundedReceiver<Said>, JoinHandle<Ending>) {
        let (said, hear) = mpsc::unbounded_channel();
        self.touch();
        self.routes.lock().unwrap().insert(session.clone(), said);
        let request = acp::PromptRequest::new(
            session.clone(),
            vec![acp::ContentBlock::Text(acp::TextContent::new(text))],
        );
        // Sent here, not in the task: a stop that follows must reach the
        // Harness after the prompt it stops.
        let sent = self.cx.send_request(request);
        let (routes, active) = (self.routes.clone(), self.active.clone());
        let (session, name) = (session.clone(), self.name.clone());
        let done = tokio::spawn(async move {
            let answer = sent.block_task().await;
            *active.lock().unwrap() = Instant::now();
            routes.lock().unwrap().remove(&session);
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

    /// Asks the Harness to stop the session's turn.
    pub fn cancel(&self, Session(session): &Session) -> Result<(), String> {
        self.cx
            .send_notification(acp::CancelNotification::new(session.clone()))
            .map_err(plain)
    }
}

async fn drive(
    process: AcpAgent,
    routes: Routes,
    options: Options,
    ready: oneshot::Sender<Result<(ConnectionTo<Agent>, Agreed), String>>,
) {
    let heard = routes.clone();
    let asked = routes.clone();
    let served = Client
        .builder()
        .name("bandaso")
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
                if let acp::SessionUpdate::ConfigOptionUpdate(update) = &note.update {
                    let now = update.config_options.clone();
                    options.lock().unwrap().insert(note.session_id.clone(), now);
                }
                if let Some(said) = said(note.update)
                    && let Some(route) = heard.lock().unwrap().get(&note.session_id)
                {
                    let _ = route.send(said);
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
                let question = Said::Asks {
                    call: request.tool_call.tool_call_id.0.to_string(),
                    title: fields.title.clone(),
                    tool: fields.kind.map(tool_kind),
                    offered: request.options.iter().map(offered).collect(),
                    answer,
                };
                let routed = asked
                    .lock()
                    .unwrap()
                    .get(&request.session_id)
                    .is_some_and(|route| route.send(question).is_ok());
                if !routed {
                    return responder.respond(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    ));
                }
                cx.spawn(async move {
                    let outcome = match decided.await {
                        Ok(Answer::Chose(option)) => acp::RequestPermissionOutcome::Selected(
                            acp::SelectedPermissionOutcome::new(option),
                        ),
                        Ok(Answer::Cancelled) | Err(_) => acp::RequestPermissionOutcome::Cancelled,
                    };
                    responder.respond(acp::RequestPermissionResponse::new(outcome))
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(process, async move |cx: ConnectionTo<Agent>| {
            let options = acp::SessionConfigOptionsCapabilities::new()
                .boolean(acp::BooleanConfigOptionCapabilities::new());
            let shows = acp::ClientCapabilities::new().session(
                acp::ClientSessionCapabilities::new()
                    .notices(acp::NoticeCapabilities::new())
                    .config_options(options),
            );
            let hello = acp::InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(shows)
                .client_info(acp::Implementation::new(
                    "bandaso",
                    env!("CARGO_PKG_VERSION"),
                ));
            let agreed = cx.send_request(hello).block_task().await;
            match agreed {
                Ok(answer) if answer.protocol_version == ProtocolVersion::V1 => {
                    let capabilities = &answer.agent_capabilities;
                    let agreed = Agreed {
                        loads: capabilities.load_session,
                        resumes: capabilities.session_capabilities.resume.is_some(),
                    };
                    let _ = ready.send(Ok((cx.clone(), agreed)));
                }
                Ok(answer) => {
                    let _ = ready.send(Err(format!(
                        "The Harness speaks ACP {:?}; Bandaso speaks version 1.",
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
    // Every turn still listening hears that the Harness is gone.
    routes.lock().unwrap().clear();
}

fn text_of(chunk: &acp::ContentChunk) -> Option<String> {
    match &chunk.content {
        acp::ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

fn said(update: acp::SessionUpdate) -> Option<Said> {
    match update {
        acp::SessionUpdate::AgentMessageChunk(chunk) => text_of(&chunk).map(Said::Reply),
        acp::SessionUpdate::AgentThoughtChunk(chunk) => text_of(&chunk).map(Said::Thought),
        acp::SessionUpdate::ToolCall(call) => Some(Said::ToolStarted {
            call: call.tool_call_id.0.to_string(),
            title: call.title,
            tool: tool_kind(call.kind),
            status: tool_status(call.status),
        }),
        acp::SessionUpdate::ToolCallUpdate(update) => Some(Said::ToolChanged {
            call: update.tool_call_id.0.to_string(),
            title: update.fields.title,
            status: update.fields.status.map(tool_status),
        }),
        acp::SessionUpdate::Notice(notice) => Some(Said::Notice(match notice.description {
            Some(more) if !more.trim().is_empty() => format!("{} {more}", notice.title),
            _ => notice.title,
        })),
        acp::SessionUpdate::UsageUpdate(usage) => resets(usage.meta.as_ref()).map(Said::Resets),
        acp::SessionUpdate::ConfigOptionUpdate(update) => {
            Some(Said::Runs(running(&update.config_options)))
        }
        _ => None,
    }
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

/// Whether the Harness has modes Bandaso knows: Claude Code's or Codex's.
fn native(options: &[acp::SessionConfigOption]) -> bool {
    let modes = options.iter().find(|o| is_mode(o));
    modes.is_some_and(|o| values(o).into_iter().any(|v| mode_of(v).is_some()))
}

/// What a session runs with, from its options.
fn running(options: &[acp::SessionConfigOption]) -> Running {
    let native = native(options);
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
    options: &[acp::SessionConfigOption],
    wanted: &Settings,
    tried: &[String],
) -> Option<(String, acp::SessionConfigOptionValue)> {
    let native = native(options);
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

fn offered(option: &acp::PermissionOption) -> Offered {
    use acp::PermissionOptionKind as Kind;
    Offered {
        id: option.option_id.0.to_string(),
        name: option.name.clone(),
        allows: matches!(option.kind, Kind::AllowOnce | Kind::AllowAlways),
        always: matches!(option.kind, Kind::AllowAlways | Kind::RejectAlways),
    }
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
    fn settle(mut options: Vec<acp::SessionConfigOption>, wanted: &Settings) -> Vec<String> {
        let mut tried = Vec::new();
        let mut set = Vec::new();
        while let Some((id, value)) = next_change(&options, wanted, &tried) {
            let value = value.as_value_id().unwrap().0.to_string();
            set.push(format!("{id}={value}"));
            let option = options.iter_mut().find(|o| *o.id.0 == *id).unwrap();
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
        let running = running(&codex());
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

    #[test]
    fn modes_bandaso_does_not_know_are_options_like_any_other() {
        let other = vec![
            select("mode", "ask", &["ask", "code"])
                .category(acp::SessionConfigOptionCategory::Mode),
        ];
        let running = running(&other);
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
