//! The engine's API: JSON frames over one WebSocket (ADR 0001, decision 1).
//!
//! 1. The client's first frame is `hello`, with the protocol version and a
//!    token. The [`Identity`] port says which Participant the token names,
//!    or the token is a pass: an Agent, which works only in its pass's
//!    Project ([`crate::access::within`]), and calls there when it names
//!    none. A wrong version or an unknown token gets
//!    `goodbye`. `welcome` lists the engine's modules, so a window shows
//!    only what the engine has (ADR 0002, decision 8), the ID this
//!    machine's modules are followed by (ADR 0025), and what this host is
//!    called and drawn by, `named` (ADR 0095).
//! 2. `call` runs a method and gets one `result` with the same `id`; a
//!    command's carries its place in the log, `at` (ADR 0082, decision 4).
//!    A connection's commands to one scope, this machine's or a Project's,
//!    wait in one queue: each starts once the one before it answered, so
//!    they commit, and answer, in the order sent. A client sends the next
//!    before the last answers. Queues run beside each other, and a call
//!    or a stream waits in none, nor does a command that runs on past one
//!    write ([`Module::runs_on`](crate::Module::runs_on)).
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
//!    is called and drawn by and then each change of it (ADR 0095), or a
//!    module of the machine's.
//!
//! Unknown fields are ignored on both sides, so either side can be newer.

use crate::access::Caller;
use crate::cursors::Heard;
use crate::events::{Event, EventFilter};
use crate::kernel::Queue;
use crate::module::Stream;
use crate::{Answer, Code, CommandId, Kernel, PROTOCOL, Participant, PersonId, ProjectId, Refusal};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::future::BoxFuture;
use futures::{FutureExt, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use ts_rs::TS;

const HELLO_WITHIN: Duration = Duration::from_secs(10);

/// How long a command may hold up the next in its queue: a guard against
/// one that hangs. A command is one write, so it answers well within
/// this, even as the disk stalls; one that runs on by design waits in no
/// queue ([`Module::runs_on`](crate::Module::runs_on)). One still running
/// past it gives up its place, and the log says so (ADR 0082, decision 4).
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
        /// `machine.named`, or a module of the machine's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        project: Option<ProjectId>,
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

/// Who a `hello`'s token names, and the one Project a pass keeps it in.
fn identify(api: &Api, token: &str) -> Option<Caller> {
    if let Some(participant) = api.identity.identify(token) {
        return Some(participant.into());
    }
    let (agent, project) = api.kernel.holder(token)?;
    Some(Caller {
        participant: Participant::Agent(agent),
        only: Some(project),
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
        },
        Err(error) => EngineFrame::Result {
            id,
            ok: None,
            error: Some(error),
            at: None,
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
        boot: api.kernel.boot().to_owned(),
        fence: Some(api.kernel.fence()),
        named: api.kernel.named(),
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
                project,
                command,
                params,
            } => {
                let queue = api.kernel.queue(caller, &method, project);
                let kernel = api.kernel.clone();
                let out = out.clone();
                let name = method.clone();
                let run = async move {
                    let answer = kernel.answer(caller, &method, project, command, params);
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
                match api.kernel.follow(caller, project).await {
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
                match api.kernel.stream(caller, &method, project, params).await {
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

/// One connection's queues of commands, one for each scope they run in
/// (ADR 0082, decision 4). A queue runs its commands one at a time, in the
/// order they came, each once the one before it answered or ran for
/// [`HOLDS_UP`]. Its last commands run even once the connection is gone,
/// as a call does: a resend after a reconnect finds their receipts.
#[derive(Default)]
struct Queues(HashMap<Queue, mpsc::UnboundedSender<Queued>>);

/// A command in a queue: its method, for the log, and the run that
/// answers it.
type Queued = (String, BoxFuture<'static, ()>);

impl Queues {
    /// Queues `run`, which answers one command. The connection's reader
    /// never waits here, so a long queue holds up no other.
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
                "a command ran past {}s, so the next in its queue starts beside it",
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
}
