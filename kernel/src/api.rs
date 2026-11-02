//! The engine's API: JSON frames over one WebSocket (ADR 0001, decision 1).
//!
//! 1. The client's first frame is `hello`, with the protocol version and a
//!    token. The [`Identity`] port says which Participant the token names,
//!    or the token is a pass: an Agent, which works only in its pass's
//!    Space ([`crate::access::within`]), and calls there when it names
//!    none. A wrong version or an unknown token gets
//!    `goodbye`. `welcome` lists the engine's modules, so a window shows
//!    only what the engine has (ADR 0002, decision 8), and the ID this
//!    machine's modules are followed by (ADR 0025).
//! 2. `call` runs a method and gets one `result` with the same `id`.
//! 3. `subscribe` follows a Space's events after a position. The window first
//!    reads a view with its position, then subscribes after it (ADR 0002,
//!    decision 5). The log is replayed a page at a time, then live events
//!    follow; a subscriber that falls behind catches up from the log.
//!    `resync` ends a subscription the engine cannot go on with: read the
//!    view again.
//! 4. `stream` hears what a module says now and keeps nowhere, such as a
//!    terminal's output: `piece` after `piece`, until `ended` says the
//!    module ended it. Heard again after a reconnect, it starts again.
//!    `unsubscribe` stops a stream as it stops a subscription. A stream
//!    of this machine's names no Space: `window.requests`, where the window
//!    hears what modules ask it (ADR 0029), or a module of the machine's.
//!
//! Unknown fields are ignored on both sides, so either side can be newer.

use crate::access::Caller;
use crate::events::{Event, EventFilter};
use crate::module::Stream;
use crate::{Code, CommandId, Kernel, PROTOCOL, Participant, PersonId, Refusal, SpaceId};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;
use ts_rs::TS;

/// How many stored events a subscription reads at a time.
const PAGE: usize = 500;

const HELLO_WITHIN: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientFrame {
    Hello {
        protocol: u32,
        token: String,
    },
    Call {
        #[ts(type = "number")]
        id: u64,
        method: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        space: Option<SpaceId>,
        /// Makes a command run once (ADR 0002, decision 2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        command: Option<CommandId>,
        #[serde(default)]
        params: Value,
    },
    Subscribe {
        #[ts(type = "number")]
        id: u64,
        space: SpaceId,
        #[ts(type = "number")]
        after: i64,
        #[serde(default)]
        filter: EventFilter,
    },
    Unsubscribe {
        #[ts(type = "number")]
        id: u64,
        #[ts(type = "number")]
        subscription: u64,
    },
    Stream {
        #[ts(type = "number")]
        id: u64,
        /// None for a stream of this machine's: `window.requests`, or a
        /// module of the machine's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        space: Option<SpaceId>,
        method: String,
        #[serde(default)]
        params: Value,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum EngineFrame {
    Welcome {
        protocol: u32,
        engine: String,
        /// The modules this engine runs.
        modules: Vec<String>,
        /// What this machine's modules are followed and streamed by, as a
        /// Space is (ADR 0025, decision 1); none while no module is.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        machine: Option<SpaceId>,
    },
    Result {
        #[ts(type = "number")]
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        ok: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error: Option<Refusal>,
    },
    Event {
        #[ts(type = "number")]
        subscription: u64,
        event: Event,
    },
    /// The subscription ended because it fell behind: read the view again.
    Resync {
        #[ts(type = "number")]
        subscription: u64,
    },
    /// One piece of a stream.
    Piece {
        #[ts(type = "number")]
        stream: u64,
        data: Value,
    },
    /// The module ended the stream.
    Ended {
        #[ts(type = "number")]
        stream: u64,
    },
    Goodbye {
        reason: Refusal,
    },
}

/// Who a connection is: the identity port (ADR 0001, decision 3). Here the
/// kernel learns which Participant acts; the access decision then says what
/// that Participant may do.
pub trait Identity: Send + Sync + 'static {
    /// The Participant a `hello`'s token names, or `None`.
    fn identify(&self, token: &str) -> Option<Participant>;
}

/// One computer: whoever holds the engine's secret is its owner.
pub struct OwnerSecret {
    pub secret: String,
    pub owner: PersonId,
}

impl Identity for OwnerSecret {
    fn identify(&self, token: &str) -> Option<Participant> {
        same_secret(token, &self.secret).then_some(Participant::Person(self.owner))
    }
}

struct Api {
    kernel: Arc<Kernel>,
    identity: Box<dyn Identity>,
    engine: String,
}

/// The API's routes: one WebSocket at `/ws`.
pub fn router(kernel: Arc<Kernel>, identity: impl Identity, engine: impl Into<String>) -> Router {
    Router::new()
        .route(PATH, get(upgrade))
        .with_state(Arc::new(Api {
            kernel,
            identity: Box::new(identity),
            engine: engine.into(),
        }))
}

async fn upgrade(
    State(api): State<Arc<Api>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let origin = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok());
    if !origin_allowed(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| serve(api, socket))
}

/// Where the API listens on the engine's address.
pub const PATH: &str = "/ws";

/// The origin of Banda's own window.
pub const APP_ORIGIN: &str = "app://banda";

/// A web page elsewhere must not reach the engine. Banda's window, the
/// CLI (no origin) and pages served from this machine may try, and still
/// need the token. An opaque origin (`null`) could be any page.
fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return true };
    if origin == APP_ORIGIN {
        return true;
    }
    match origin.split_once("://") {
        Some(("http" | "https", rest)) => {
            let host = if rest.starts_with("[::1]") {
                "[::1]"
            } else {
                rest.split([':', '/']).next().unwrap_or_default()
            };
            matches!(host, "localhost" | "127.0.0.1" | "[::1]")
        }
        _ => false,
    }
}

/// Who a `hello`'s token names, and the one Space a pass keeps it in.
fn identify(api: &Api, token: &str) -> Option<Caller> {
    if let Some(participant) = api.identity.identify(token) {
        return Some(participant.into());
    }
    let (agent, space) = api.kernel.holder(token)?;
    Some(Caller {
        participant: Participant::Agent(agent),
        only: Some(space),
    })
}

fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn result(id: u64, answer: Result<Value, Refusal>) -> Outgoing {
    let frame = match answer {
        Ok(ok) => EngineFrame::Result {
            id,
            ok: Some(ok),
            error: None,
        },
        Err(error) => EngineFrame::Result {
            id,
            ok: None,
            error: Some(error),
        },
    };
    frame.into()
}

/// A frame on its way to the socket. A stream's piece says when it is
/// written, so each stream has one piece in flight: a window that reads
/// slowly holds the module back, and the engine queues no more.
struct Outgoing {
    frame: EngineFrame,
    written: Option<oneshot::Sender<()>>,
}

impl From<EngineFrame> for Outgoing {
    fn from(frame: EngineFrame) -> Self {
        Outgoing {
            frame,
            written: None,
        }
    }
}

fn text(frame: &EngineFrame) -> Message {
    Message::Text(Utf8Bytes::from(
        serde_json::to_string(frame).expect("frames serialize"),
    ))
}

async fn serve(api: Arc<Api>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let first = match tokio::time::timeout(HELLO_WITHIN, stream.next()).await {
        Ok(Some(Ok(Message::Text(first)))) => serde_json::from_str::<ClientFrame>(&first).ok(),
        _ => None,
    };
    let who = match first {
        Some(ClientFrame::Hello { protocol, .. }) if protocol != PROTOCOL => Err(Refusal::new(
            Code::Protocol,
            format!(
                "This engine speaks protocol {PROTOCOL}, the window speaks {protocol}. Update Banda."
            ),
        )),
        Some(ClientFrame::Hello { token, .. }) => identify(&api, &token).ok_or_else(|| {
            Refusal::forbidden("The first frame must be hello with a token this engine knows.")
        }),
        _ => Err(Refusal::forbidden(
            "The first frame must be hello with a token this engine knows.",
        )),
    };
    let caller = match who {
        Ok(caller) => caller,
        Err(reason) => {
            let _ = sink.send(text(&EngineFrame::Goodbye { reason })).await;
            let _ = sink.close().await;
            return;
        }
    };
    let welcome = EngineFrame::Welcome {
        protocol: PROTOCOL,
        engine: api.engine.clone(),
        modules: api
            .kernel
            .modules()
            .into_iter()
            .map(str::to_owned)
            .collect(),
        machine: api.kernel.machine(),
    };
    if sink.send(text(&welcome)).await.is_err() {
        return;
    }

    let (out, mut outgoing) = mpsc::channel::<Outgoing>(1024);
    let writer = tokio::spawn(async move {
        while let Some(Outgoing { frame, written }) = outgoing.recv().await {
            if sink.send(text(&frame)).await.is_err() {
                break;
            }
            if let Some(written) = written {
                let _ = written.send(());
            }
        }
    });
    let mut subscriptions: HashMap<u64, JoinHandle<()>> = HashMap::new();

    while let Some(Ok(message)) = stream.next().await {
        let Message::Text(body) = message else {
            if matches!(message, Message::Close(_)) {
                break;
            }
            continue;
        };
        let frame = match serde_json::from_str::<ClientFrame>(&body) {
            Ok(frame) => frame,
            Err(error) => {
                if let Some(id) = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| v["id"].as_u64())
                {
                    let refusal = Refusal::invalid(format!("This frame does not fit: {error}."));
                    let _ = out.send(result(id, Err(refusal))).await;
                }
                continue;
            }
        };
        match frame {
            ClientFrame::Hello { .. } => {}
            ClientFrame::Call {
                id,
                method,
                space,
                command,
                params,
            } => {
                let kernel = api.kernel.clone();
                let out = out.clone();
                tokio::spawn(async move {
                    let answer = kernel.call(caller, &method, space, command, params).await;
                    let _ = out.send(result(id, answer)).await;
                });
            }
            ClientFrame::Subscribe {
                id,
                space,
                after,
                filter,
            } => {
                match api.kernel.follow(caller, space).await {
                    Ok(space) => {
                        // The answer goes out before the first event.
                        let ok = serde_json::json!({ "subscription": id });
                        let _ = out.send(result(id, Ok(ok))).await;
                        let follower = tokio::spawn(follow(space, id, after, filter, out.clone()));
                        if let Some(old) = subscriptions.insert(id, follower) {
                            old.abort();
                        }
                    }
                    Err(refusal) => {
                        let _ = out.send(result(id, Err(refusal))).await;
                    }
                }
            }
            ClientFrame::Stream {
                id,
                space,
                method,
                params,
            } => {
                match api.kernel.stream(caller, &method, space, params).await {
                    Ok(pieces) => {
                        // The answer goes out before the first piece.
                        let ok = serde_json::json!({ "stream": id });
                        let _ = out.send(result(id, Ok(ok))).await;
                        let hearing = tokio::spawn(hear(id, pieces, out.clone()));
                        if let Some(old) = subscriptions.insert(id, hearing) {
                            old.abort();
                        }
                    }
                    Err(refusal) => {
                        let _ = out.send(result(id, Err(refusal))).await;
                    }
                }
            }
            ClientFrame::Unsubscribe { id, subscription } => {
                if let Some(task) = subscriptions.remove(&subscription) {
                    task.abort();
                }
                let _ = out.send(result(id, Ok(Value::Null))).await;
            }
        }
    }
    for task in subscriptions.into_values() {
        task.abort();
    }
    drop(out);
    let _ = writer.await;
}

/// Forwards a stream's pieces, then says that it ended.
async fn hear(stream: u64, mut pieces: Stream, out: mpsc::Sender<Outgoing>) {
    while let Some(data) = pieces.recv().await {
        let (written, sent) = oneshot::channel();
        let piece = Outgoing {
            frame: EngineFrame::Piece { stream, data },
            written: Some(written),
        };
        if out.send(piece).await.is_err() || sent.await.is_err() {
            return;
        }
    }
    let _ = out.send(EngineFrame::Ended { stream }.into()).await;
}

/// Replays the stored events after `after`, then forwards live ones, with no
/// gap and no repeat: it listens before it reads, and skips what it already
/// sent. When it falls behind the live events, it reads the log again.
async fn follow(
    space: Arc<crate::Space>,
    subscription: u64,
    after: i64,
    filter: EventFilter,
    out: mpsc::Sender<Outgoing>,
) {
    let send = |event| {
        out.send(
            EngineFrame::Event {
                subscription,
                event,
            }
            .into(),
        )
    };
    let mut live = space.subscribe();
    let mut last = after;
    loop {
        loop {
            let page = match space.events_after(last, filter.clone(), PAGE).await {
                Ok(page) => page,
                Err(error) => {
                    tracing::error!(%error, "a subscription could not read the log");
                    let _ = out.send(EngineFrame::Resync { subscription }.into()).await;
                    return;
                }
            };
            let full = page.len() == PAGE;
            for event in page {
                last = event.seq;
                if send(event).await.is_err() {
                    return;
                }
            }
            if !full {
                break;
            }
        }
        loop {
            match live.recv().await {
                Ok(event) if event.seq > last => {
                    last = event.seq;
                    if filter.matches(&event) && send(Event::clone(&event)).await.is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                // Back to the log for what went by.
                Err(broadcast::error::RecvError::Lagged(_)) => break,
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_this_machine_and_the_app_pass_the_origin_check() {
        for allowed in [
            None,
            Some("http://localhost:5173"),
            Some("http://127.0.0.1:4000"),
            Some("http://[::1]:80"),
            Some(APP_ORIGIN),
        ] {
            assert!(origin_allowed(allowed), "{allowed:?}");
        }
        for refused in [
            Some("https://example.com"),
            Some("http://localhost.example.com"),
            Some("http://127.0.0.1.example.com"),
            Some("null"),
            Some("file://"),
            Some("chrome-extension://abc"),
            Some("app://elsewhere"),
            Some("garbage"),
        ] {
            assert!(!origin_allowed(refused), "{refused:?}");
        }
    }

    #[test]
    fn secrets_match_only_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }
}
