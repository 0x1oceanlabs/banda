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
//! Starting a Harness and opening a session are bounded; a turn is not: it
//! runs until the Harness ends it or a Person stops it.

use crate::model::{
    Failure, Field, FieldValue, HarnessOption, Input, Mode, Offer, OptionChoice, OptionValue,
    Settings, TextFormat, ThreadId, ToolKind, ToolStatus, TurnState, Values,
};
use crate::rules::{Ending, Offered};
use crate::settings::Harness;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
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
        /// A form to fill in, for a Question that asks more than a choice.
        form: Option<Vec<Field>>,
        answer: oneshot::Sender<Answer>,
    },
    /// The Harness no longer waits for the answer to what it asked.
    Withdrawn(String),
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
/// A form Question's answers: submit it, or skip it.
const SUBMIT: &str = "accept";
const SKIP: &str = "decline";

type Routes = Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>;
/// Each session's options, as the Harness last said.
type Options = Arc<Mutex<HashMap<acp::SessionId, Known>>>;

/// A session's options, and whether its modes are Claude Code's or Codex's:
/// decided by the list it opened with, so a later list that leaves the modes
/// out does not change who keeps to the Thread's mode.
#[derive(Clone, Default)]
struct Known {
    native: bool,
    options: Vec<acp::SessionConfigOption>,
}

impl Known {
    fn new(options: Vec<acp::SessionConfigOption>) -> Known {
        Known {
            native: native(&options),
            options,
        }
    }
}

/// Keeps a session's newest options. An empty list, which is what an update
/// that cannot be read becomes, keeps the last.
fn learn(options: &Options, session: &acp::SessionId, now: Vec<acp::SessionConfigOption>) -> Known {
    let mut all = options.lock().unwrap();
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
                .insert(session.clone(), Known::new(options));
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
            .insert(made.session_id.clone(), Known::new(options));
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
        let (mut tried, mut refused) = (Vec::new(), Vec::new());
        let known = loop {
            // Read again each time: an update may have come since.
            let known = self.options.lock().unwrap().get(session).cloned();
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
                    learn(&self.options, session, answer.config_options);
                }
                Ok(Err(error)) => refused.push(format!(
                    "{} did not take the setting {name}: {}",
                    self.name, error.message
                )),
                Err(_) => refused.push(format!(
                    "{} did not answer when Bandaso set {name}.",
                    self.name
                )),
            }
        };
        let running = running(&known);
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
    let filling = routes.clone();
    let served = Client
        .builder()
        .name("bandaso")
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
                let said = match note.update {
                    acp::SessionUpdate::ConfigOptionUpdate(update) => {
                        let known = learn(&options, &note.session_id, update.config_options);
                        Some(Said::Runs(running(&known)))
                    }
                    update => said(update),
                };
                if let Some(said) = said
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
                let call = request.tool_call.tool_call_id.0.to_string();
                let question = Said::Asks {
                    call: call.clone(),
                    title: fields.title.clone(),
                    tool: fields.kind.map(tool_kind),
                    offered: request.options.iter().map(offered).collect(),
                    form: None,
                    answer,
                };
                let route = asked.lock().unwrap().get(&request.session_id).cloned();
                let Some(route) = route.filter(|route| route.send(question).is_ok()) else {
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
                let Some(route) = filling.lock().unwrap().get(&scope.session_id).cloned() else {
                    return responder.respond(cancel());
                };
                let Some(fields) = form_fields(&form.requested_schema) else {
                    let _ = route.send(Said::Notice(
                        "The Agent asked with a form Bandaso cannot show, so it went unanswered."
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
                    answer,
                };
                if route.send(question).is_err() {
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
            let shows = acp::ClientCapabilities::new().elicitation(forms).session(
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

/// Whether the Harness has modes Bandaso knows: Claude Code's or Codex's,
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
/// a kind Bandaso cannot show is left out.
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
    fn a_form_with_a_required_field_bandaso_cannot_show_is_not_asked() {
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
        let options = Options::default();
        let session = acp::SessionId::new("s");
        assert!(learn(&options, &session, codex()).native);
        let kept = learn(&options, &session, Vec::new());
        assert_eq!(
            kept.options.len(),
            codex().len(),
            "an empty list keeps the last"
        );
        let model = vec![codex().remove(2)];
        let now = learn(&options, &session, model);
        assert!(
            now.native,
            "a list without the modes changes nothing about them"
        );
        assert_eq!(now.options.len(), 1);
    }

    #[test]
    fn modes_bandaso_does_not_know_are_options_like_any_other() {
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
