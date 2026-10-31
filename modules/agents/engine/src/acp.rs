//! The ACP adapter: one Harness process per Agent, spoken to over ACP v1 on
//! its stdio. ACP's words stop here: the rest of the module hears what the
//! Harness [`Said`], in the module's own words.
//!
//! The connection's handlers run on its dispatch loop, so none of them
//! waits there. A permission request is routed to its turn, and a task off
//! the loop answers it once the Person decides.
//!
//! Starting a Harness and opening a session are bounded; a turn is not: it
//! runs until the Harness ends it or a Person stops it.

use crate::model::{ThreadId, ToolKind, ToolStatus, TurnState};
use crate::rules::Offered;
use crate::settings::Harness;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
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
#[derive(Serialize)]
pub struct Evidence {
    harness: String,
    session: String,
    lasts: Lasts,
}

/// How long a session outlives its Harness process.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Lasts {
    /// It ends with the process.
    Process,
    /// The Harness can load it again after a restart.
    Harness,
}

/// How a turn ended, as the Harness reported it. A cancelled turn comes back
/// as stopped; whether a Person stopped it is for the module to say.
pub struct Ending {
    pub state: TurnState,
    pub reason: Option<String>,
}

type Routes = Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>;

/// One Harness process and its ACP connection. Dropping it stops the
/// process and everything it started.
pub struct Connection {
    cx: ConnectionTo<Agent>,
    harness: String,
    /// The Harness can load its sessions again.
    loads: bool,
    routes: Routes,
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
        let (cx, loads) = match timeout(STARTING, started).await {
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
            loads,
            routes,
            sessions: Default::default(),
            driver,
        }))
    }

    /// Whether the process still answers.
    pub fn alive(&self) -> bool {
        !self.driver.is_finished() && !self.cx.is_incoming_closed()
    }

    /// The Harness's session for `thread`, opened in `folder` on first use.
    /// A session opened now comes with the evidence its Thread keeps.
    pub async fn session(
        &self,
        thread: ThreadId,
        folder: &Path,
    ) -> Result<(Session, Option<Evidence>), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(&thread) {
            return Ok((Session(session.clone()), None));
        }
        let opening = self
            .cx
            .send_request(acp::NewSessionRequest::new(folder))
            .block_task();
        let made = match timeout(OPENING, opening).await {
            Ok(made) => made.map_err(plain)?,
            Err(_) => return Err("The Harness did not open a session within a minute.".to_owned()),
        };
        sessions.insert(thread, made.session_id.clone());
        let evidence = Evidence {
            harness: self.harness.clone(),
            session: made.session_id.0.to_string(),
            lasts: if self.loads {
                Lasts::Harness
            } else {
                Lasts::Process
            },
        };
        Ok((Session(made.session_id), Some(evidence)))
    }

    /// Sends a prompt. What the Harness says comes on the receiver; the
    /// returned task ends with the turn.
    pub fn prompt(
        &self,
        Session(session): &Session,
        text: &str,
    ) -> (
        mpsc::UnboundedReceiver<Said>,
        JoinHandle<Result<Ending, String>>,
    ) {
        let (said, hear) = mpsc::unbounded_channel();
        self.routes.lock().unwrap().insert(session.clone(), said);
        let request = acp::PromptRequest::new(
            session.clone(),
            vec![acp::ContentBlock::Text(acp::TextContent::new(text))],
        );
        let cx = self.cx.clone();
        let routes = self.routes.clone();
        let session = session.clone();
        let done = tokio::spawn(async move {
            let answer = cx.send_request(request).block_task().await;
            routes.lock().unwrap().remove(&session);
            answer.map(|r| ending(&r.stop_reason)).map_err(plain)
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
    ready: oneshot::Sender<Result<(ConnectionTo<Agent>, bool), String>>,
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
            let hello = acp::InitializeRequest::new(ProtocolVersion::V1).client_info(
                acp::Implementation::new("bandaso", env!("CARGO_PKG_VERSION")),
            );
            let agreed = cx.send_request(hello).block_task().await;
            match agreed {
                Ok(answer) if answer.protocol_version == ProtocolVersion::V1 => {
                    let loads = answer.agent_capabilities.load_session;
                    let _ = ready.send(Ok((cx.clone(), loads)));
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
        _ => None,
    }
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
    Ending {
        state,
        reason: reason.map(str::to_owned),
    }
}
