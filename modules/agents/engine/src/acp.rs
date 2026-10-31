//! The ACP adapter: one Harness process, spoken to over ACP v1 on its
//! stdio. ACP's words stop here: the rest of the module hears what the
//! Harness [`Said`], and how a turn ended, in the module's own words.
//!
//! The engine declares what it can show: notices. A failure's class comes
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

use crate::model::{Failure, ThreadId, ToolKind, ToolStatus, TurnState};
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
        offered: Vec<Offered>,
        answer: oneshot::Sender<Answer>,
    },
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

type Routes = Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>;

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
        let routes = Routes::default();
        let (ready, started) = oneshot::channel();
        let driver = tokio::spawn(drive(process, routes.clone(), ready));
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
            && self.continue_session(&session, folder).await
        {
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
    /// Thread already shows it. Whether the session is open again.
    async fn continue_session(&self, session: &acp::SessionId, folder: &Path) -> bool {
        let answer = if self.agreed.resumes {
            let resume = acp::ResumeSessionRequest::new(session.clone(), folder);
            let asked = self.cx.send_request(resume).block_task();
            timeout(OPENING, asked).await.map(|a| a.map(drop))
        } else if self.agreed.loads {
            let load = acp::LoadSessionRequest::new(session.clone(), folder);
            let asked = self.cx.send_request(load).block_task();
            timeout(OPENING, asked).await.map(|a| a.map(drop))
        } else {
            return false;
        };
        match answer {
            Ok(Ok(())) => true,
            Ok(Err(error)) => {
                tracing::info!(%error, "the Harness could not continue a session");
                false
            }
            Err(_) => {
                tracing::info!("the Harness took too long to continue a session");
                false
            }
        }
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
    ready: oneshot::Sender<Result<(ConnectionTo<Agent>, Agreed), String>>,
) {
    let heard = routes.clone();
    let asked = routes.clone();
    let served = Client
        .builder()
        .name("bandaso")
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
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
            let shows = acp::ClientCapabilities::new().session(
                acp::ClientSessionCapabilities::new().notices(acp::NoticeCapabilities::new()),
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
