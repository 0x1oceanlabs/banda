//! A scripted ACP agent. It speaks ACP v1 over stdio like a real Harness,
//! and the words in a prompt choose what it does:
//!
//! - `ask`: starts a tool call and asks permission to run it. An allow runs
//!   it, a reject skips it, and a cancel ends the turn.
//! - `remember`: asks as `ask` does, offering only answers to keep for next
//!   time.
//! - `quit`: ends the turn as cancelled, though nobody stopped it.
//! - `slow`: replies in forty pieces, fifty milliseconds apart, and stops
//!   early when cancelled.
//! - `fail`: answers the prompt with an error.
//! - `crash`: exits at once, as a Harness that dies would.
//! - `which session`: replies with the session's ID and its own process ID.
//! - anything else: a short thought, then a reply that quotes the prompt.
//!
//! Its sessions can be resumed or loaded after a restart, as a real
//! Harness keeps them on disk. With `FAKE_AGENT_FORGETS` set it refuses
//! both, as a Harness that lost them would.

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, Implementation,
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, PermissionOption, PermissionOptionKind, PromptRequest,
    PromptResponse, RequestPermissionOutcome, RequestPermissionRequest, ResumeSessionRequest,
    ResumeSessionResponse, SessionCapabilities, SessionId, SessionNotification,
    SessionResumeCapabilities, SessionUpdate, StopReason, TextContent, ToolCall, ToolCallStatus,
    ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Responder, Stdio};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Default)]
struct Fake {
    sessions: Arc<AtomicU64>,
    cancelled: Arc<Mutex<HashSet<SessionId>>>,
}

impl Fake {
    fn cancelled(&self, session: &SessionId) -> bool {
        self.cancelled.lock().unwrap().contains(session)
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
    if words.contains("which session") {
        let reply = format!("Session {} in process {}", session.0, std::process::id());
        say(
            &cx,
            &session,
            SessionUpdate::AgentMessageChunk(text(&reply)),
        )?;
        return Ok(StopReason::EndTurn);
    }
    let remember = words.contains("remember");
    if remember || words.contains("ask") {
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
        let always =
            PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways);
        let options = if remember {
            vec![
                always,
                PermissionOption::new("never", "Never allow", PermissionOptionKind::RejectAlways),
            ]
        } else {
            vec![
                PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
                always,
                PermissionOption::new("reject", "Reject", PermissionOptionKind::RejectOnce),
            ]
        };
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
            async |request: InitializeRequest,
                   responder: Responder<InitializeResponse>,
                   _cx: ConnectionTo<Client>| {
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
                    let id = format!("fake-{}-{number}", std::process::id());
                    responder.respond(NewSessionResponse::new(id))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async |_request: ResumeSessionRequest,
                   responder: Responder<ResumeSessionResponse>,
                   _cx: ConnectionTo<Client>| {
                if forgets() {
                    return responder.respond_with_error(Error::resource_not_found(None));
                }
                responder.respond(ResumeSessionResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async |_request: LoadSessionRequest,
                   responder: Responder<LoadSessionResponse>,
                   _cx: ConnectionTo<Client>| {
                if forgets() {
                    return responder.respond_with_error(Error::resource_not_found(None));
                }
                responder.respond(LoadSessionResponse::new())
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
