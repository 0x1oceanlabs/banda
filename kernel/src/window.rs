//! The road from a module to the window (ADR 0029, decision 2).
//!
//! Some work is the window's: its pages, for one. A module's method asks
//! the window with [`crate::Call::ask_window`] and awaits the answer,
//! within a time it gives. The window hears what it is asked on one stream
//! for the machine, `window.requests`, and answers each request by
//! `window.answer`. Both need [`crate::Right::Run`], so no Agent holds or
//! answers them.
//!
//! One window holds the stream at a time: the latest to ask for it. The
//! one before stops hearing, and what it was asked and has not answered
//! is refused. Nothing here is kept: a request lives while its asker waits.

use crate::{Nothing, Participant, ProjectId, Refusal, Right, Stream};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use ts_rs::TS;

/// How many requests wait to be written to the window before an asker
/// waits too.
const QUEUE: usize = 64;

/// One thing a module asks the window.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WindowRequest {
    /// What `window.answer` names it by.
    #[ts(type = "number")]
    pub id: u64,
    /// What is asked, under its module's name: `notes.show`.
    pub method: String,
    /// The Project the asking call runs in.
    pub project: ProjectId,
    /// Who made the call that asks.
    pub by: Participant,
    #[serde(default)]
    pub params: Value,
    /// How long the asking call waits, in milliseconds: past it, the
    /// window may stop what it does, as no one hears the answer.
    #[ts(type = "number")]
    pub within: u64,
}

/// The window's answer to one request: what it gives, or why not.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct WindowAnswer {
    #[ts(type = "number")]
    pub request: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ok: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<Refusal>,
}

type Answered = oneshot::Sender<Result<Value, Refusal>>;

/// The window that holds the road, and what it was asked and has not
/// answered. Dropped as another window takes the road, it refuses those:
/// their askers hear their answers will not come.
struct Holder {
    send: mpsc::Sender<Value>,
    waiting: HashMap<u64, Answered>,
}

#[derive(Default)]
struct State {
    holder: Option<Holder>,
    /// The ID of the next request.
    next: u64,
}

/// The road: who holds it, and what waits for an answer.
#[derive(Default)]
pub(crate) struct Window(Mutex<State>);

crate::methods! {
    Window(Participant) as "WindowMethods" in "./" {
        /// What modules ask the window, one request a piece, for the
        /// window that runs as the Person. It takes the road from the
        /// window that held it.
        stream requests(Nothing) -> WindowRequest, Run;
        /// The window's answer to a request it heard.
        call answer(WindowAnswer) -> (), Run;
    }
}

fn not_open() -> Refusal {
    Refusal::conflict("Banda's window is not open.")
}

fn closed() -> Refusal {
    Refusal::may_have_run(
        "Banda's window closed before it answered. What was asked may have been done.",
    )
}

fn late(within: Duration) -> Refusal {
    Refusal::may_have_run(format!(
        "Banda's window did not answer within {} s. What was asked may have been done.",
        within.as_secs_f64()
    ))
}

impl Window {
    /// The right a method of `window.*` needs, or `None`.
    pub(crate) fn right(name: &str) -> Option<Right> {
        Self::method_right(name)
    }

    pub(crate) async fn call(
        &self,
        by: Participant,
        name: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        self.dispatch(by, name, params).await
    }

    pub(crate) async fn stream(
        &self,
        by: Participant,
        name: &str,
        params: Value,
    ) -> Result<Stream, Refusal> {
        self.dispatch_stream(by, name, params).await
    }

    async fn requests(&self, _: Participant, _: Nothing) -> Result<Stream, Refusal> {
        let (send, hear) = mpsc::channel(QUEUE);
        let waiting = HashMap::new();
        self.0.lock().unwrap().holder = Some(Holder { send, waiting });
        Ok(hear)
    }

    async fn answer(&self, _: Participant, answer: WindowAnswer) -> Result<(), Refusal> {
        let answered = {
            let mut state = self.0.lock().unwrap();
            let holder = state.holder.as_mut();
            holder.and_then(|h| h.waiting.remove(&answer.request))
        };
        let answered = answered.ok_or_else(|| {
            Refusal::not_found(format!(
                "No request {} waits for an answer: it was answered, or its time ran out.",
                answer.request
            ))
        })?;
        let _ = answered.send(match answer.error {
            Some(refusal) => Err(refusal),
            None => Ok(answer.ok.unwrap_or(Value::Null)),
        });
        Ok(())
    }

    /// Whether a window holds the road and hears it still.
    pub(crate) fn open(&self) -> bool {
        let state = self.0.lock().unwrap();
        (state.holder.as_ref()).is_some_and(|holder| !holder.send.is_closed())
    }

    /// Asks the window and waits for its answer, at most `within`.
    pub(crate) async fn ask(
        &self,
        method: String,
        project: ProjectId,
        by: Participant,
        params: Value,
        within: Duration,
    ) -> Result<Value, Refusal> {
        let (id, send, answer) = {
            let mut state = self.0.lock().unwrap();
            let id = state.next;
            state.next += 1;
            let holder = state.holder.as_mut().filter(|h| !h.send.is_closed());
            let holder = holder.ok_or_else(not_open)?;
            let (answered, answer) = oneshot::channel();
            holder.waiting.insert(id, answered);
            (id, holder.send.clone(), answer)
        };
        let request = WindowRequest {
            id,
            method,
            project,
            by,
            params,
            within: u64::try_from(within.as_millis()).unwrap_or(u64::MAX),
        };
        let asked = async {
            let request = crate::methods::answer(request)?;
            send.send(request).await.map_err(|_| closed())?;
            tokio::select! {
                answer = answer => answer.map_err(|_| closed())?,
                // A window that stops hearing will not answer.
                () = send.closed() => Err(closed()),
            }
        };
        let answered = tokio::time::timeout(within, asked).await;
        if let Some(holder) = self.0.lock().unwrap().holder.as_mut() {
            holder.waiting.remove(&id);
        }
        answered.unwrap_or_else(|_| Err(late(within)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Code, PersonId};
    use serde_json::json;
    use std::sync::Arc;
    use tokio::task::JoinHandle;

    const SOON: Duration = Duration::from_secs(5);

    fn person() -> Participant {
        Participant::Person(PersonId::new())
    }

    async fn ask(window: &Window, within: Duration) -> Result<Value, Refusal> {
        let params = json!({ "tab": "a" });
        (window.ask(
            "notes.show".into(),
            ProjectId::new(),
            person(),
            params,
            within,
        ))
        .await
    }

    /// Asks the window from a task of its own, as a module's call does.
    fn asking(window: &Arc<Window>) -> JoinHandle<Result<Value, Refusal>> {
        let window = window.clone();
        tokio::spawn(async move { ask(&window, SOON).await })
    }

    async fn hold(window: &Window) -> Stream {
        (window.stream(person(), "requests", Value::Null).await).unwrap()
    }

    async fn heard(hear: &mut Stream) -> WindowRequest {
        serde_json::from_value(hear.recv().await.unwrap()).unwrap()
    }

    async fn reply(window: &Window, request: u64, ok: Option<Value>) -> Result<Value, Refusal> {
        let error = None;
        let answer = json!(WindowAnswer { request, ok, error });
        window.call(person(), "answer", answer).await
    }

    #[tokio::test]
    async fn with_no_window_the_ask_is_refused_at_once() {
        let window = Window::default();
        assert_eq!(ask(&window, SOON).await, Err(not_open()));
    }

    #[tokio::test]
    async fn the_window_hears_a_request_and_its_answer_comes_back() {
        let window = Arc::new(Window::default());
        let mut hear = hold(&window).await;
        let asking = asking(&window);
        let asked = heard(&mut hear).await;
        assert_eq!(asked.method, "notes.show");
        assert_eq!(asked.params, json!({ "tab": "a" }));
        let ok = json!({ "tree": "- button" });
        reply(&window, asked.id, Some(ok.clone())).await.unwrap();
        assert_eq!(asking.await.unwrap(), Ok(ok));
        let again = reply(&window, asked.id, None).await.unwrap_err();
        assert_eq!(again.code, Code::NotFound, "an answer counts once");
    }

    #[tokio::test]
    async fn a_refusal_from_the_window_is_the_askers() {
        let window = Arc::new(Window::default());
        let mut hear = hold(&window).await;
        let asking = asking(&window);
        let asked = heard(&mut hear).await;
        let refusal = Refusal::not_found("There is no such tab.");
        let answer = WindowAnswer {
            request: asked.id,
            ok: None,
            error: Some(refusal.clone()),
        };
        (window.call(person(), "answer", json!(answer)).await).unwrap();
        assert_eq!(asking.await.unwrap(), Err(refusal));
    }

    #[tokio::test]
    async fn a_late_answer_is_refused_and_says_it_may_have_run() {
        let window = Window::default();
        let _hear = hold(&window).await;
        let refusal = ask(&window, Duration::from_millis(20)).await.unwrap_err();
        assert_eq!(refusal.code, Code::MayHaveRun);
        assert!(refusal.message.contains("may have been done"));
    }

    #[tokio::test]
    async fn a_new_window_takes_the_road_and_the_old_ones_requests_are_refused() {
        let window = Arc::new(Window::default());
        let mut old = hold(&window).await;
        let first = asking(&window);
        heard(&mut old).await;
        let mut new = hold(&window).await;
        assert_eq!(first.await.unwrap(), Err(closed()));
        assert_eq!(old.recv().await, None, "the old window stops hearing");
        let second = asking(&window);
        let asked = heard(&mut new).await;
        reply(&window, asked.id, None).await.unwrap();
        assert_eq!(second.await.unwrap(), Ok(Value::Null));
    }

    #[tokio::test]
    async fn a_window_that_stops_hearing_refuses_what_it_was_asked() {
        let window = Arc::new(Window::default());
        let mut hear = hold(&window).await;
        let asking = asking(&window);
        heard(&mut hear).await;
        drop(hear);
        assert_eq!(asking.await.unwrap(), Err(closed()));
        assert_eq!(ask(&window, SOON).await, Err(not_open()));
    }
}
