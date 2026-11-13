//! The engine's API: JSON frames over one WebSocket (ADR 0001, decision 1).
//! Beside it, a file's bytes and a page are served by token ([`bytes`]).
//!
//! 1. The client's first frame is `hello`, with the protocol version and a
//!    token. The [`Identity`] port says which Participant the token names,
//!    or the token is a pass: an Agent, which works only in its pass's
//!    Project ([`crate::access::within`]), and calls there when it names
//!    none. A wrong version or an unknown token gets
//!    `goodbye`. `welcome` lists the engine's modules, so a window shows
//!    only what the engine has (ADR 0002, decision 8), the ID this
//!    machine's modules are followed by (ADR 0025), what this host is
//!    called and drawn by, `named` (ADR 0095), and its Apps with their
//!    versions, `apps` (ADR 0082, decision 14), whose methods
//!    `apps.describe` says.
//!    The door ([`crate::devices`], ADR 0124) is the other way in, for
//!    the Person's devices: its first frames prove a device's key and the
//!    host's instead, its `welcome` adds what they proved, and from there
//!    on a session is the same ([`session`]).
//! 2. `call` runs a method and gets one `result` with the same `id`; a
//!    command's carries its place in the log, `at` (ADR 0082, decision 4),
//!    and every one with `ok` when it was so, `as_of` (decision 3). A
//!    client reads a read's as `Read`, and an act's, a command's or a call
//!    that acts, as its `Outcome`: done, refused, or `may_have_run`
//!    (`sdk/contract`, #1226).
//!    A connection's commands to one scope, this machine's or a Project's,
//!    wait in one queue: each starts once the one before it answered, so
//!    they commit, and answer, in the order sent. A client sends the next
//!    before the last answers. A module's calls that say so
//!    ([`Module::in_order`](crate::Module::in_order)), as the keys typed
//!    into one terminal, wait the same way in a queue of their own.
//!    Queues run beside each other, and any other call or a stream waits
//!    in none, nor does a command that runs on past one write
//!    ([`Module::runs_on`](crate::Module::runs_on)). A command may
//!    carry `not_after`: past it it is refused `expired`, but for one that
//!    ran, which gets its answer (ADR 0105).
//!
//!    The decision's session is one connection here. A reconnect gets new
//!    queues, while the old connection's still run what is in them. Order
//!    holds across it only as a client sends its unanswered commands
//!    again, in order, before any new one, as `sdk/contract`'s `command()`
//!    does. Receipts make the two queues agree: a resend waits for the run
//!    already under way, or gets its answer.
//! 3. `subscribe` follows a Project's events after a position. The window first
//!    reads a view with its position, then subscribes after it (ADR 0002,
//!    decision 5). The log is replayed a page at a time, then live events
//!    follow; a subscriber that falls behind catches up from the log.
//!    `resync` ends a subscription the engine cannot go on with: read the
//!    view again.
//! 4. `stream` hears what a module says now and keeps nowhere, such as a
//!    terminal's output: `piece` after `piece`, until `ended` says the
//!    module ended it. Heard again after a reconnect, it starts again.
//!    `unsubscribe` stops a stream as it stops a subscription. A stream
//!    of this machine's names no Project: `window.requests`, where the window
//!    hears what modules ask it (ADR 0029), `machine.named`, what this host
//!    is called and drawn by and then each change of it (ADR 0095),
//!    `machine.power`, its battery and why it is held awake, and each change
//!    of them (ADR 0097), or a module of the machine's.
//! 5. `ping` is answered by `pong` with the same `id` and this machine's
//!    time, in ms since the epoch: a client hears that the host still
//!    answers, and how far its clock is from the host's (ADR 0082,
//!    decision 11). An engine from before it answers `result` with
//!    `invalid`, which says as much that it answers.
//!
//! Unknown fields are ignored on both sides, so either side can be newer.

use crate::access::Caller;
use crate::cursors::Heard;
use crate::devices::Proved;
use crate::events::{Event, EventFilter};
use crate::module::Stream;
use crate::router::Queue;
use crate::{
    Answer, Code, CommandId, Kernel, PROTOCOL, Participant, PersonId, ProjectId, Refusal, now_ms,
};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::future::BoxFuture;
use futures::stream::{SplitSink, SplitStream};
use futures::{FutureExt, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use ts_rs::TS;

pub(crate) const HELLO_WITHIN: Duration = Duration::from_secs(10);

/// How long a run may hold up the next in its queue: a guard against one
/// that hangs. A command is one write, so it answers well within this,
/// even as the disk stalls; one that runs on by design waits in no queue
/// ([`Module::runs_on`](crate::Module::runs_on)). A call that keeps its
/// order gives up on its own well before it, as a terminal's write to a
/// program that reads nothing does. One still running past it gives up
/// its place, and the log says so (ADR 0082, decision 4).
const HOLDS_UP: Duration = Duration::from_secs(30);

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
        project: Option<ProjectId>,
        /// Makes a command run once (ADR 0002, decision 2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        command: Option<CommandId>,
        /// The time past which a command does not run, in ms since the
        /// epoch by this machine's clock: one that waited for it is
        /// refused `expired` after (ADR 0105). A resend of one that ran
        /// gets its answer all the same.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        not_after: Option<i64>,
        #[serde(default)]
        params: Value,
    },
    Subscribe {
        #[ts(type = "number")]
        id: u64,
        project: ProjectId,
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
        /// None for a stream of this machine's: `window.requests`,
        /// `machine.named`, `machine.power`, or a module of the machine's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        project: Option<ProjectId>,
        method: String,
        #[serde(default)]
        params: Value,
    },
    /// Asks whether the host still answers (ADR 0082, decision 11).
    Ping {
        #[ts(type = "number")]
        id: u64,
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
        /// Project is (ADR 0025, decision 1); none while no module is.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        machine: Option<ProjectId>,
        /// This boot of the engine: another once it restarted, and every
        /// session of the last ended with it.
        #[serde(default)]
        boot: String,
        /// Whether the fence around its Harnesses' programs holds (ADR
        /// 0083, decision 1). An engine that says none has none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        fence: Option<crate::Fence>,
        /// What this host is called and drawn by, as every window shows
        /// it; `machine.named` streams each change (ADR 0095). An engine
        /// that says none names itself nothing. A client older than the
        /// engine draws an icon it has not as `desktop`, so a new icon is
        /// additive too.
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::named::lenient"
        )]
        #[ts(optional)]
        named: Option<crate::Named>,
        /// Banda's version this engine was built as, and its build id
        /// (ADR 0119, decision 6). A window of another build still
        /// attaches while it speaks this protocol, and does without what
        /// this engine lacks. An engine that says none is older than both.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        build: Option<String>,
        /// Each App this engine runs, and each part of the platform, with
        /// its version and the major of the App API it is written to (ADR
        /// 0082, decision 14); `apps.describe` says their methods. An
        /// engine that says none is older than the list.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<crate::App>>")]
        apps: Vec<crate::App>,
        /// At the door (`crate::devices`, ADR 0124, decision 3): who the
        /// two ends proved to be. The API says none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        door: Option<Proved>,
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
        /// A command's place in the log of its scope (ADR 0082, decision
        /// 4): the last fact it wrote. A view current there shows what it
        /// did. The same for a resend; none for a command that wrote no
        /// fact, which leaves nothing to wait to hear (#880), for a
        /// refusal, or for a call.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        at: Option<i64>,
        /// When the engine answered, by its machine's clock: what a read
        /// said was so as of then (ADR 0082, decision 3). Every answer
        /// with `ok` carries it; an engine from before it says none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        as_of: Option<AsOf>,
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
    /// The answer to a `ping`: this machine's time, in ms since the epoch.
    Pong {
        #[ts(type = "number")]
        id: u64,
        #[ts(type = "number")]
        time: i64,
    },
}

/// When an answer was so, by the engine's machine's clock (ADR 0082,
/// decision 3). With a client's offset from that clock, as its `pong`s
/// say it, the client says "as of 14:02" by its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct AsOf {
    /// In ms since the epoch.
    #[ts(type = "number")]
    pub at: i64,
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

/// Where a file's bytes are beside the API, by a token the bytes module
/// gave (ADR 0106, step 4a): `/b/<token>`, read in ranges.
pub const BYTES_PATH: &str = "/b/{token}";

/// Where a page is beside the API, for a frame alone and sandboxed:
/// `/p/<token>`.
pub const PAGE_PATH: &str = "/p/{token}";

/// Which of the routes beside the API a request came by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Served {
    /// `/b/<token>`: a file's bytes.
    Bytes,
    /// `/p/<token>`: a page, into a frame.
    Page,
}

/// The bytes port (ADR 0082, decision 13; ADR 0106, step 4a): what answers
/// the routes beside the API. The bytes module answers them. The token in
/// the path is the capability, so neither route asks who calls, and the
/// kernel only routes: it knows nothing of files.
pub trait Bytes: Send + Sync + 'static {
    /// The answer to `request`, which came by `served` with `token`, the
    /// path's last part as it was sent.
    fn serve(
        &self,
        served: Served,
        token: String,
        request: axum::extract::Request,
    ) -> BoxFuture<'static, Response>;
}

/// The routes beside the API, `GET` and `HEAD` of `/b/<token>` and
/// `/p/<token>`, which `bytes` answers; another method is refused with
/// 405. The engine serves them with its [`router`].
pub fn bytes(bytes: impl Bytes) -> Router {
    let bytes: Arc<dyn Bytes> = Arc::new(bytes);
    let by = |served: Served| {
        let bytes = bytes.clone();
        get(move |request: axum::extract::Request| {
            let path = request.uri().path();
            let token = path.rsplit('/').next().unwrap_or_default().to_owned();
            bytes.serve(served, token, request)
        })
    };
    Router::new()
        .route(BYTES_PATH, by(Served::Bytes))
        .route(PAGE_PATH, by(Served::Page))
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

/// Who a `hello`'s token names, the one Project a pass keeps it in, and
/// the Thread whose session the pass was made for.
fn identify(api: &Api, token: &str) -> Option<Caller> {
    if let Some(participant) = api.identity.identify(token) {
        return Some(participant.into());
    }
    api.kernel.caller(token)
}

fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn result(id: u64, answer: Result<Value, Refusal>) -> Outgoing {
    answered(id, answer.map(|value| Answer { value, at: None }))
}

/// A call's answer, with a command's place in the log.
fn answered(id: u64, answer: Result<Answer, Refusal>) -> Outgoing {
    let frame = match answer {
        Ok(Answer { value, at }) => EngineFrame::Result {
            id,
            ok: Some(value),
            error: None,
            at,
            as_of: Some(AsOf { at: now_ms() }),
        },
        Err(error) => EngineFrame::Result {
            id,
            ok: None,
            error: Some(error),
            at: None,
            as_of: None,
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

pub(crate) fn text(frame: &impl Serialize) -> Message {
    Message::Text(Utf8Bytes::from(
        serde_json::to_string(frame).expect("frames serialize"),
    ))
}

/// A connection's first frame, read as `T`, if it comes in time and is
/// one.
pub(crate) async fn first<T: serde::de::DeserializeOwned>(
    stream: &mut SplitStream<WebSocket>,
) -> Option<T> {
    match tokio::time::timeout(HELLO_WITHIN, stream.next()).await {
        Ok(Some(Ok(Message::Text(first)))) => serde_json::from_str(&first).ok(),
        _ => None,
    }
}

/// Tells a connection that gets no session why, and ends it.
pub(crate) async fn refuse(mut sink: SplitSink<WebSocket, Message>, reason: Refusal) {
    let _ = sink.send(text(&EngineFrame::Goodbye { reason })).await;
    let _ = sink.close().await;
}

/// What a session's `welcome` says of how it began: the protocol picked,
/// and at the door, who the two ends proved to be.
pub(crate) struct Welcomed {
    pub(crate) protocol: u32,
    pub(crate) door: Option<Proved>,
}

async fn serve(api: Arc<Api>, socket: WebSocket) {
    let (sink, mut stream) = socket.split();
    let who = match first::<ClientFrame>(&mut stream).await {
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
    let welcome = Welcomed {
        protocol: PROTOCOL,
        door: None,
    };
    // A session by the API ends only with its connection.
    let never = std::future::pending();
    match who {
        Ok(caller) => {
            session(
                api.kernel.clone(),
                &api.engine,
                caller,
                welcome,
                sink,
                stream,
                never,
            )
            .await
        }
        Err(reason) => refuse(sink, reason).await,
    }
}

/// A session, from its `welcome` on, which says how it began (`welcomed`):
/// `caller`'s, who came by the API or by the door. It runs the frames that
/// come until the connection ends, or until `ended` says why it must: then
/// it says `goodbye` with that, as a device's does once its machine
/// removed it.
pub(crate) async fn session(
    kernel: Arc<Kernel>,
    engine: &str,
    caller: Caller,
    welcomed: Welcomed,
    mut sink: SplitSink<WebSocket, Message>,
    mut stream: SplitStream<WebSocket>,
    ended: impl Future<Output = Refusal>,
) {
    let welcome = EngineFrame::Welcome {
        protocol: welcomed.protocol,
        engine: engine.to_owned(),
        modules: kernel.modules().into_iter().map(str::to_owned).collect(),
        machine: kernel.machine(),
        boot: kernel.boot().to_owned(),
        fence: Some(kernel.fence()),
        named: kernel.named(),
        version: Some(crate::version().to_owned()),
        build: crate::build().map(str::to_owned),
        apps: kernel.apps(),
        door: welcomed.door,
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
    let mut queues = Queues::default();

    let mut ended = std::pin::pin!(ended);
    loop {
        let message = tokio::select! {
            message = stream.next() => message,
            reason = &mut ended => {
                let _ = out.send(EngineFrame::Goodbye { reason }.into()).await;
                break;
            }
        };
        let Some(Ok(message)) = message else { break };
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
                project,
                command,
                not_after,
                params,
            } => {
                let queue = kernel.queue(&caller, &method, project, &params);
                let kernel = kernel.clone();
                let out = out.clone();
                let name = method.clone();
                let caller = caller.clone();
                let run = async move {
                    let answer =
                        kernel.answer_until(caller, &method, project, command, not_after, params);
                    let _ = out.send(answered(id, answer.await)).await;
                };
                match queue {
                    Some(queue) => queues.push(queue, name, run),
                    None => {
                        tokio::spawn(run);
                    }
                }
            }
            ClientFrame::Subscribe {
                id,
                project,
                after,
                filter,
            } => {
                match kernel.follow(caller.clone(), project).await {
                    Ok(project) => {
                        // The answer goes out before the first event.
                        let ok = serde_json::json!({ "subscription": id });
                        let _ = out.send(result(id, Ok(ok))).await;
                        let follower =
                            tokio::spawn(follow(project, id, after, filter, out.clone()));
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
                project,
                method,
                params,
            } => {
                match kernel
                    .stream(caller.clone(), &method, project, params)
                    .await
                {
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
            ClientFrame::Ping { id } => {
                let pong = EngineFrame::Pong { id, time: now_ms() };
                let _ = out.send(pong.into()).await;
            }
        }
    }
    for task in subscriptions.into_values() {
        task.abort();
    }
    drop(out);
    let _ = writer.await;
}

/// One connection's queues: of commands, one for each scope they run in
/// (ADR 0082, decision 4), and of the calls that run in the order sent,
/// one for each thing they act on ([`Queue`]). A queue runs what it holds
/// one at a time, in the order it came, each once the one before it
/// answered or ran for [`HOLDS_UP`]. Its last runs go on even once the
/// connection is gone, as any call does: a command's resend after a
/// reconnect finds its receipt.
#[derive(Default)]
struct Queues(HashMap<Queue, mpsc::UnboundedSender<Queued>>);

/// A command or a call in a queue: its method, for the log, and the run
/// that answers it.
type Queued = (String, BoxFuture<'static, ()>);

impl Queues {
    /// Queues `run`, which answers one command or call. The connection's
    /// reader never waits here, so a long queue holds up no other.
    fn push(
        &mut self,
        queue: Queue,
        method: String,
        run: impl Future<Output = ()> + Send + 'static,
    ) {
        let queued = self.0.entry(queue).or_insert_with(|| {
            let (queued, runs) = mpsc::unbounded_channel();
            tokio::spawn(one_at_a_time(runs, HOLDS_UP));
            queued
        });
        // Its task ends only once this sender is gone.
        let _ = queued.send((method, run.boxed()));
    }
}

async fn one_at_a_time(mut runs: mpsc::UnboundedReceiver<Queued>, holds_up: Duration) {
    while let Some((method, run)) = runs.recv().await {
        // A task of its own, so one that hangs runs on, and the next goes.
        let mut running = tokio::spawn(run);
        if tokio::time::timeout(holds_up, &mut running).await.is_err() {
            tracing::warn!(
                %method,
                "it ran past {}s, so the next in its queue starts beside it",
                holds_up.as_secs()
            );
        }
    }
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
/// gap and no repeat (see `cursors::Heard`).
async fn follow(
    project: Arc<crate::Project>,
    subscription: u64,
    after: i64,
    filter: EventFilter,
    out: mpsc::Sender<Outgoing>,
) {
    let mut heard = Heard::new(&project, after, filter);
    // It holds the Project only while it reads the log.
    drop(project);
    loop {
        let event = match heard.next().await {
            Ok(Some(event)) => event,
            Ok(None) => return,
            Err(error) => {
                tracing::error!(%error, "a subscription could not read the log");
                let _ = out.send(EngineFrame::Resync { subscription }.into()).await;
                return;
            }
        };
        let frame = EngineFrame::Event {
            subscription,
            event,
        };
        if out.send(frame.into()).await.is_err() {
            return;
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

    #[tokio::test]
    async fn a_command_that_hangs_gives_up_its_place_once_it_ran_past_the_limit() {
        let holds_up = Duration::from_millis(50);
        let (queued, runs) = mpsc::unbounded_channel();
        tokio::spawn(one_at_a_time(runs, holds_up));
        let (ran, heard) = oneshot::channel();
        let sent = std::time::Instant::now();
        let hangs = std::future::pending::<()>().boxed();
        queued.send(("notes.hang".into(), hangs)).unwrap();
        let next = async move { ran.send(()).unwrap() }.boxed();
        queued.send(("notes.add".into(), next)).unwrap();

        tokio::time::timeout(Duration::from_secs(10), heard)
            .await
            .expect("the next starts beside it")
            .unwrap();
        assert!(sent.elapsed() >= holds_up, "once it waited for it");
    }

    #[test]
    fn secrets_match_only_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    /// A newer engine's icon, or a `named` this build cannot read, keeps
    /// no client from connecting: `banda mcp` reads this welcome.
    #[test]
    fn a_welcome_with_an_icon_this_build_has_not_still_reads() {
        let named = |said: &str| {
            let welcome =
                format!(r#"{{"type":"welcome","protocol":1,"engine":"e","modules":[]{said}}}"#);
            match serde_json::from_str::<EngineFrame>(&welcome) {
                Ok(EngineFrame::Welcome { named, .. }) => named,
                other => panic!("{said}: {other:?}"),
            }
        };
        let watch = named(r#","named":{"name":"wrist","icon":"watch"}"#).unwrap();
        assert_eq!(
            (watch.name.as_str(), watch.icon),
            ("wrist", crate::MachineIcon::Desktop)
        );
        let tower = named(r#","named":{"name":"studio","icon":"tower"}"#).unwrap();
        assert_eq!(tower.icon, crate::MachineIcon::Tower);
        assert_eq!(named(r#","named":{"icon":7}"#), None);
        assert_eq!(named(r#","named":null"#), None);
        assert_eq!(named(""), None);
    }

    /// An engine from before ADR 0119 says no version, and its welcome
    /// still reads; a newer one says both.
    #[test]
    fn a_welcome_says_its_version_and_build_when_it_knows_them() {
        let read = |said: &str| {
            let welcome =
                format!(r#"{{"type":"welcome","protocol":1,"engine":"e","modules":[]{said}}}"#);
            match serde_json::from_str::<EngineFrame>(&welcome) {
                Ok(EngineFrame::Welcome { version, build, .. }) => (version, build),
                other => panic!("{said}: {other:?}"),
            }
        };
        assert_eq!(read(""), (None, None));
        assert_eq!(
            read(r#","version":"0.1.0-dev.660","build":"4505ed37""#),
            (Some("0.1.0-dev.660".into()), Some("4505ed37".into()))
        );
    }
}
