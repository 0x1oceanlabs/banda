//! What the pulls module hears of the others (ADR 0076, decision 1): an
//! Agent's shell call that ran `gh pr create` links what it made to its
//! Thread; a turn that starts or ends changes whose turn it is; a push
//! from a Thread's card reads its pull requests again.

use crate::model::{By, PullRef};
use crate::reader::Live;
use crate::shell;
use crate::store;
use banda_kernel::{Event, EventFilter, Heard, Participant};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

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

/// A shell call it follows.
struct Shell {
    thread: String,
    command: String,
    said: String,
}

/// Hears the agents module's facts until the Project closes.
pub async fn follow_agents(mut heard: Heard, live: Arc<Live>) {
    let mut calls: HashMap<String, Shell> = HashMap::new();
    let mut agents: HashMap<String, String> = HashMap::new();
    loop {
        let event = match heard.next().await {
            Ok(Some(event)) => event,
            Ok(None) => return,
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
        match event.kind.as_str() {
            "turn.started" => {
                live.working.lock().unwrap().insert(thread);
                live.poke(false);
            }
            "turn.ended" => {
                live.working.lock().unwrap().remove(&thread);
                live.poke(false);
            }
            _ => {
                if let Some((thread, made)) = shell_call(&mut calls, thread, &event)
                    && let Some(project) = heard.project()
                {
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
    }
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
pub async fn follow_git(mut heard: Heard, live: Arc<Live>) {
    loop {
        match heard.next().await {
            Ok(Some(_)) => live.poke(true),
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
}
