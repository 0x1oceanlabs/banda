//! What the pulls module hears of the others (ADR 0076, decision 1): an
//! Agent's shell call that ran `gh pr create` links what it made to its
//! Thread; a turn that starts or ends changes whose turn it is; a push
//! from a Thread's card reads its pull requests again.
//!
//! It hears them through the kernel's listeners (ADR 0082, decision 6),
//! from where it last acked. A shell call it follows spans several facts,
//! kept in memory, so its place stays before the first fact of every
//! call it still follows, for a day at most: after a restart it hears
//! those again, and follows them anew. A link is kept by its call's key,
//! so a call heard again links nothing twice. A turn that ends lets go of
//! the calls it left open.

use crate::model::{By, PullRef};
use crate::reader::Live;
use crate::shell;
use crate::store;
use banda_kernel::{Event, EventFilter, Listener, Participant};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// The name of its listener of the agents module, which links the pull
/// requests an Agent made to its Thread.
pub const LINKS: &str = "links";

/// The agents module's facts it hears.
pub fn agents() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(
            [
                "tool.started",
                "tool.changed",
                "tool.output",
                "turn.started",
                "turn.ended",
            ]
            .map(str::to_owned)
            .to_vec(),
        ),
    }
}

/// The name of its listener of the git module.
pub const PUSHES: &str = "pushes";

/// The git module's: a commit, a push or a pull from a Thread's card.
pub fn git() -> EventFilter {
    EventFilter {
        module: Some("git".into()),
        subject: None,
        kinds: Some(vec!["git.acted".into()]),
    }
}

/// How much of a shell call's words it keeps, to find a URL in.
const KEPT: usize = 64 << 10;
/// How many shell calls it follows at once.
const CALLS: usize = 200;
/// How long a call it follows holds its place in the log back: a turn
/// that never said it ended holds no restart back past a day.
const HELD: i64 = 24 * 60 * 60 * 1000;

/// A shell call it follows.
struct Shell {
    thread: String,
    command: String,
    said: String,
    /// Its first fact's place in the log, and when that was.
    from: i64,
    at: i64,
}

/// Hears the agents module's facts until the Project closes; then wakes
/// the reader, which finds it closed and ends the list.
pub async fn follow_agents(mut heard: Listener, live: Arc<Live>) {
    let mut calls: HashMap<String, Shell> = HashMap::new();
    let mut agents: HashMap<String, String> = HashMap::new();
    let mut acked = 0;
    loop {
        let event = match heard.next().await {
            Ok(Some(event)) => event,
            Ok(None) => return live.poke(false),
            Err(error) => {
                tracing::warn!(%error, "pulls stopped hearing the Threads");
                return;
            }
        };
        let Some(thread) = event.subject.clone() else {
            continue;
        };
        if let Participant::Agent(agent) = event.author {
            let agent = agent.to_string();
            if agents.get(&agent) != Some(&thread)
                && let Some(project) = heard.project()
            {
                let (a, t) = (agent.clone(), thread.clone());
                let kept = project.write(move |tx| store::agent_in(tx.sql(), &a, &t));
                if let Err(error) = kept.await {
                    tracing::warn!(%error, "an Agent's Thread was not kept");
                }
                agents.insert(agent, thread.clone());
            }
        }
        let mut linked = false;
        match event.kind.as_str() {
            "turn.started" => {
                live.working.lock().unwrap().insert(thread);
                live.poke(false);
            }
            "turn.ended" => {
                outlived(&mut calls, &thread);
                live.working.lock().unwrap().remove(&thread);
                live.poke(false);
            }
            _ => {
                if let Some((thread, made)) = shell_call(&mut calls, thread, &event)
                    && let Some(project) = heard.project()
                {
                    linked = true;
                    let author = event.author;
                    let key = format!("tool:{}", made.1);
                    let pull = made.0;
                    let linked = project.write(move |tx| {
                        store::link(tx, author, &thread, &pull, By::Agent, Some(&key))
                    });
                    match linked.await {
                        Ok(true) => live.poke(true),
                        Ok(false) => {}
                        Err(error) => tracing::warn!(%error, "a pull request was not linked"),
                    }
                }
            }
        }
        if let Some(through) = place(&calls, &event, linked, acked) {
            match heard.ack_through(through).await {
                Ok(()) => acked = through,
                Err(error) => tracing::warn!(%error, "pulls' place among the Threads was not kept"),
            }
        }
    }
}

/// Where its place in the log may move after `event`, from `acked`. A
/// turn's start or end, or a call that made a pull request (`linked`),
/// moves it: to just before the first fact of each call it still follows
/// that began within a day, so a restart hears those again, or past
/// `event` while it follows none. Other tool facts move it not, so a
/// restart may hear a few again. None while it stays.
fn place(calls: &HashMap<String, Shell>, event: &Event, linked: bool, acked: i64) -> Option<i64> {
    let moves = linked || matches!(event.kind.as_str(), "turn.started" | "turn.ended");
    let held = (calls.values()).filter(|call| event.at - call.at < HELD);
    let through = (held.map(|call| call.from - 1).min()).unwrap_or(event.seq);
    (moves && through > acked).then_some(through)
}

/// A call its turn outlived ends no more.
fn outlived(calls: &mut HashMap<String, Shell>, thread: &str) {
    calls.retain(|_, call| call.thread != thread);
}

/// Follows one tool fact; a shell call that ended having made a pull
/// request says its Thread, the pull request and the call's item.
fn shell_call(
    calls: &mut HashMap<String, Shell>,
    thread: String,
    event: &Event,
) -> Option<(String, (PullRef, String))> {
    let payload = &event.payload;
    let item = payload["item"].as_str()?.to_owned();
    match event.kind.as_str() {
        "tool.started" => {
            if payload["tool"] != "execute" {
                return None;
            }
            if calls.len() >= CALLS {
                calls.clear();
            }
            let mut shell = Shell {
                thread,
                command: payload["title"].as_str().unwrap_or_default().to_owned(),
                said: String::new(),
                from: event.seq,
                at: event.at,
            };
            said(&mut shell, &payload["content"]);
            calls.insert(item.clone(), shell);
            ended(calls, &item, payload)
        }
        "tool.changed" => {
            let shell = calls.get_mut(&item)?;
            if let Some(title) = payload["title"].as_str() {
                title.clone_into(&mut shell.command);
            }
            said(shell, &payload["content"]);
            ended(calls, &item, payload)
        }
        "tool.output" => {
            let shell = calls.get_mut(&item)?;
            keep(
                &mut shell.said,
                payload["text"].as_str().unwrap_or_default(),
            );
            None
        }
        _ => None,
    }
}

/// When the call ended, what it made, if it made a pull request.
fn ended(
    calls: &mut HashMap<String, Shell>,
    item: &str,
    payload: &Value,
) -> Option<(String, (PullRef, String))> {
    let done =
        matches!(payload["status"].as_str(), Some("done" | "failed")) || !payload["exit"].is_null();
    if !done {
        return None;
    }
    let shell = calls.remove(item)?;
    if !shell::creates_pull(&shell.command) {
        return None;
    }
    let pull = shell::find_url(&shell.said)?;
    Some((shell.thread, (pull, item.to_owned())))
}

/// Keeps the text a tool call shows.
fn said(shell: &mut Shell, content: &Value) {
    for part in content.as_array().into_iter().flatten() {
        if let Some(text) = part["text"].as_str() {
            keep(&mut shell.said, text);
        }
    }
}

fn keep(said: &mut String, text: &str) {
    if said.len() < KEPT {
        said.push_str(text);
        said.push('\n');
    }
}

/// Hears a Thread's card's commits, pushes and pulls: its pull requests
/// are read again at once.
pub async fn follow_git(mut heard: Listener, live: Arc<Live>) {
    loop {
        match heard.next().await {
            Ok(Some(acted)) => {
                live.poke(true);
                if let Err(error) = heard.ack_through(acted.seq).await {
                    tracing::warn!(%error, "pulls' place among git's acts was not kept");
                }
            }
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(%error, "pulls stopped hearing git");
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::{AgentId, EventId};
    use serde_json::json;

    fn fact(kind: &str, payload: Value) -> Event {
        Event {
            seq: 1,
            id: EventId::new(),
            module: "agents".into(),
            kind: kind.into(),
            version: 1,
            subject: Some("thread-1".into()),
            author: Participant::Agent(AgentId::new()),
            at: 0,
            payload,
        }
    }

    #[test]
    fn a_shell_call_that_made_a_pull_request_says_so_once_it_ends() {
        let mut calls = HashMap::new();
        let started = fact(
            "tool.started",
            json!({"item": "i1", "turn": "t", "title": "git push && gh pr create --fill",
                   "tool": "execute", "status": "running", "content": []}),
        );
        assert!(shell_call(&mut calls, "thread-1".into(), &started).is_none());
        let printed = fact(
            "tool.output",
            json!({"item": "i1", "text": "https://github.com/o/r/pull/7\n", "cut": false}),
        );
        assert!(shell_call(&mut calls, "thread-1".into(), &printed).is_none());
        let done = fact(
            "tool.changed",
            json!({"item": "i1", "status": "done", "exit": {"code": 0}}),
        );
        let (thread, (pull, item)) = shell_call(&mut calls, "thread-1".into(), &done).unwrap();
        assert_eq!(
            (thread.as_str(), pull.number, item.as_str()),
            ("thread-1", 7, "i1")
        );
        assert!(calls.is_empty());
    }

    #[test]
    fn a_call_that_only_looks_at_one_makes_none() {
        let mut calls = HashMap::new();
        let started = fact(
            "tool.started",
            json!({"item": "i2", "turn": "t", "title": "gh pr view 7", "tool": "execute",
                   "status": "done",
                   "content": [{"kind": "text", "text": "https://github.com/o/r/pull/7"}]}),
        );
        assert!(shell_call(&mut calls, "thread-1".into(), &started).is_none());
        // Claude Code's shell says what it printed as the call's text.
        let started = fact(
            "tool.started",
            json!({"item": "i3", "turn": "t", "title": "gh pr create --fill", "tool": "execute",
                   "status": "running", "content": []}),
        );
        assert!(shell_call(&mut calls, "thread-1".into(), &started).is_none());
        let done = fact(
            "tool.changed",
            json!({"item": "i3", "status": "done",
                   "content": [{"kind": "text", "text": "https://github.com/o/r/pull/8"}]}),
        );
        let (_, (pull, _)) = shell_call(&mut calls, "thread-1".into(), &done).unwrap();
        assert_eq!(pull.number, 8);
    }

    /// The fact `kind` of `thread` at `seq`, `at` ms in: a shell call's
    /// start or end as `item`, or a turn's.
    fn told(kind: &str, thread: &str, item: &str, seq: i64, at: i64) -> Event {
        let payload = match kind {
            "tool.started" => json!({"item": item, "title": "gh pr create --fill",
                                     "tool": "execute", "status": "running", "content": []}),
            "tool.changed" => json!({"item": item, "status": "done", "exit": {"code": 0},
                                     "content": [{"kind": "text",
                                                  "text": "https://github.com/o/r/pull/9"}]}),
            _ => json!({"turn": "t"}),
        };
        Event {
            seq,
            at,
            subject: Some(thread.into()),
            ..fact(kind, payload)
        }
    }

    /// Its place stays just before every call it still follows, and moves
    /// only as a turn starts or ends, or a call links what it made.
    /// Hears `event` as the module does, and says where its place moves.
    fn hear(calls: &mut HashMap<String, Shell>, event: &Event, acked: i64) -> Option<i64> {
        let thread = event.subject.clone().unwrap();
        let linked = match event.kind.as_str() {
            "turn.ended" => {
                outlived(calls, &thread);
                false
            }
            _ => shell_call(calls, thread, event).is_some(),
        };
        place(calls, event, linked, acked)
    }

    #[test]
    fn its_place_stays_before_each_call_it_still_follows() {
        let calls = &mut HashMap::new();
        // Each fact heard, where it was acked, and where its place moves.
        let heard = [
            (("turn.started", "a", "", 1, 0), 0, Some(1)),
            // A call's facts move nothing, and hold its place before it.
            (("tool.started", "a", "one", 2, 0), 1, None),
            (("turn.started", "b", "", 3, 0), 1, None),
            (("tool.started", "b", "two", 4, 0), 1, None),
            // One call links what it made: the other still holds it.
            (("tool.changed", "a", "one", 5, 0), 1, Some(3)),
            // Its turn ended, a call it left open holds nothing back.
            (("turn.ended", "b", "", 6, 0), 3, Some(6)),
            // Nor does one begun more than a day before.
            (("tool.started", "a", "three", 7, 0), 6, None),
            (("turn.started", "c", "", 8, HELD - 1), 6, None),
            (("turn.started", "d", "", 9, HELD), 6, Some(9)),
        ];
        for ((kind, thread, item, seq, at), acked, moves) in heard {
            let event = told(kind, thread, item, seq, at);
            assert_eq!(hear(calls, &event, acked), moves, "{kind} at {seq}");
        }
    }

    /// Following as many calls as it may, it lets go of them all for the
    /// next, and its place is held only by that one.
    #[test]
    fn a_call_past_as_many_as_it_follows_lets_go_of_the_others() {
        let mut calls = HashMap::new();
        for seq in 1..=CALLS as i64 {
            let started = told("tool.started", "a", &format!("call-{seq}"), seq, 0);
            assert!(shell_call(&mut calls, "a".into(), &started).is_none());
        }
        let last = CALLS as i64 + 1;
        let started = told("tool.started", "a", "last", last, 0);
        assert!(shell_call(&mut calls, "a".into(), &started).is_none());
        assert_eq!(calls.len(), 1);
        let turn = told("turn.started", "b", "", last + 1, 0);
        assert_eq!(place(&calls, &turn, false, 0), Some(last - 1));
    }
}
