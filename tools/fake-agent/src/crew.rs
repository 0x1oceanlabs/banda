//! `crew`: the Agent starts a Workflow, a Crew, as Claude Code's Workflow
//! tool does, in the shape `docs/research/2026-11-10-sub-agents/
//! recordings.md` gives: its call, with the script in `rawInput`, done at
//! once with `async_launched`; the turn ends; the Crew works in the
//! background, its phases and agents said whole in each `task_progress`;
//! it ends with `task_updated`, `task_notification` naming its output file,
//! and `background_tasks_changed` empty; then the Agent goes on by itself,
//! its last usage naming the Crew's run (`_claude/origin`).
//!
//! Claude's raw frames (`_claude/sdkMessage`) come only to a session whose
//! client asked for them (`_meta.claudeCode.emitRawSDKMessages`), as Claude
//! Code's adapter sends them; without them the Crew works unseen.
//!
//! Each word after `crew` changes that, and they combine:
//!
//! - `start`: the Workflow call asks first, with the script, as Claude
//!   Code does in its default mode; refused, nothing starts.
//! - `asks`: its Verify agent asks, between turns, on the parent's
//!   session, to run `echo ok > d.txt`: allowed, the call ends done.
//! - `big`: its Fix phase calls 50 agents, 8 at a time: the rest wait,
//!   Queued.
//! - `log`: it logs a line after each phase, which only its output file
//!   says, as Claude's.
//! - `fails`: its script throws after the first phase: it ends failed.
//! - `long`: each agent works 600 ms, not 60.
//! - `dies`: the fake agent's process ends in its second phase.
//! - `two`: two Crews at once, the second without `asks`.
//!
//! With `FAKE_AGENT_CREW_CUE` naming a file, a Crew holds in its Fix phase,
//! some of its agents done and some at work, until that file is there:
//! a test sees it at work as long as it needs.
//! - `ultracode`: Ultracode turns on first, as the session's options say,
//!   so a window names it.

use super::{After, Fake, allowed, say, text};
use agent_client_protocol::schema::v1::{
    Cost, PermissionOption, PermissionOptionKind, RequestPermissionRequest, SessionId,
    SessionUpdate, StopReason, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields,
    ToolKind, UsageUpdate,
};
use agent_client_protocol::{Client, ConnectionTo, Error};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

/// A raw frame, as Claude Code's adapter sends it.
#[derive(Clone, Debug, Serialize, Deserialize, agent_client_protocol::JsonRpcNotification)]
#[notification(method = "_claude/sdkMessage")]
#[serde(rename_all = "camelCase")]
struct SdkMessage {
    session_id: SessionId,
    message: Value,
}

/// The sessions whose client asked for raw frames.
static RAW: LazyLock<Mutex<HashSet<SessionId>>> = LazyLock::new(Default::default);

/// What works in each session's background now, as Claude lists it.
static TASKS: LazyLock<Mutex<HashMap<SessionId, Vec<Value>>>> = LazyLock::new(Default::default);

/// Each Crew's number, unique in the process.
static CREWS: AtomicU32 = AtomicU32::new(0);

/// Notes whether `session`'s client asks for raw frames, as its params'
/// `_meta` says on `session/new`, `load`, `resume` or `fork`.
pub(super) fn asked(session: &SessionId, meta: Option<&serde_json::Map<String, Value>>) {
    let raw = meta
        .and_then(|meta| meta.get("claudeCode")?.get("emitRawSDKMessages"))
        .is_some_and(|filters| filters.as_array().is_some_and(|all| !all.is_empty()));
    let mut sessions = RAW.lock().unwrap();
    if raw {
        sessions.insert(session.clone());
    } else {
        sessions.remove(session);
    }
}

/// Forgets `session`, closed.
pub(super) fn forget(session: &SessionId) {
    RAW.lock().unwrap().remove(session);
    TASKS.lock().unwrap().remove(session);
}

/// One Crew, as it runs.
#[derive(Clone)]
struct Crew {
    cx: ConnectionTo<Client>,
    session: SessionId,
    folder: std::path::PathBuf,
    words: Vec<String>,
    task: String,
    run: String,
    launch: String,
    /// It asks between turns.
    asks: bool,
}

impl Crew {
    fn on(&self, word: &str) -> bool {
        self.words.iter().any(|said| said == word)
    }

    /// A raw frame, to a session that asked for them.
    fn raw(&self, message: Value) -> Result<(), Error> {
        if !RAW.lock().unwrap().contains(&self.session) {
            return Ok(());
        }
        self.cx.send_notification(SdkMessage {
            session_id: self.session.clone(),
            message,
        })
    }

    fn system(&self, subtype: &str, fields: Value) -> Result<(), Error> {
        let mut message = json!({
            "type": "system",
            "subtype": subtype,
            "task_id": self.task,
            "run_id": self.run,
            "session_id": self.session.0,
        });
        if let (Some(message), Value::Object(fields)) = (message.as_object_mut(), fields) {
            message.extend(fields);
        }
        self.raw(message)
    }

    /// The session's background list, with it in or out as `works` says.
    fn background(&self, works: bool) -> Result<(), Error> {
        let tasks = {
            let mut all = TASKS.lock().unwrap();
            let tasks = all.entry(self.session.clone()).or_default();
            tasks.retain(|task| task["task_id"] != self.task.as_str());
            if works {
                tasks.push(self.listed());
            }
            tasks.clone()
        };
        self.raw(json!({
            "type": "system",
            "subtype": "background_tasks_changed",
            "tasks": tasks,
            "session_id": self.session.0,
        }))
    }

    fn listed(&self) -> Value {
        json!({
            "task_id": self.task, "run_id": self.run,
            "task_type": "local_workflow", "description": "Audit the routes",
        })
    }

    fn script(&self) -> String {
        "export const meta = { name: 'audit-routes', description: 'Find dead routes and fix \
         them', phases: [ { title: 'Scan', detail: 'read the routes' }, { title: 'Fix', \
         detail: 'one agent a route' }, { title: 'Verify', detail: 'check the build' } ] }\n\
         phase('Scan')\nawait agent('Read routes.ts')\nreturn 'ok'"
            .to_owned()
    }

    /// The Workflow call, in the turn: true once it launched.
    async fn launch(&self) -> Result<bool, Error> {
        let call = ToolCall::new(self.launch.clone(), "Workflow")
            .kind(ToolKind::Other)
            .status(ToolCallStatus::Pending)
            .raw_input(json!({}));
        say(&self.cx, &self.session, SessionUpdate::ToolCall(call))?;
        let input = json!({ "script": self.script() });
        let fields = ToolCallUpdateFields::new().raw_input(input.clone());
        let update = ToolCallUpdate::new(self.launch.clone(), fields);
        say(&self.cx, &self.session, SessionUpdate::ToolCallUpdate(update))?;
        if self.on("start") {
            let options = vec![
                PermissionOption::new("allow-once", "Yes", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "allow-with-updates",
                    "Yes, and don't ask again for Workflow commands",
                    PermissionOptionKind::AllowAlways,
                ),
                PermissionOption::new("reject", "No", PermissionOptionKind::RejectOnce),
            ];
            let fields = ToolCallUpdateFields::new()
                .title("Workflow")
                .kind(ToolKind::Other)
                .status(ToolCallStatus::Pending)
                .raw_input(input);
            let asked = ToolCallUpdate::new(self.launch.clone(), fields);
            let question = RequestPermissionRequest::new(self.session.clone(), asked, options);
            if !allowed(&self.cx, question, &["allow-once", "allow-with-updates"]).await {
                let fields = ToolCallUpdateFields::new().status(ToolCallStatus::Failed);
                let update = ToolCallUpdate::new(self.launch.clone(), fields);
                say(&self.cx, &self.session, SessionUpdate::ToolCallUpdate(update))?;
                return Ok(false);
            }
        }
        let output = json!({
            "async_launched": true, "runId": self.run,
        });
        let fields = ToolCallUpdateFields::new()
            .status(ToolCallStatus::Completed)
            .raw_output(output);
        let update = ToolCallUpdate::new(self.launch.clone(), fields);
        say(&self.cx, &self.session, SessionUpdate::ToolCallUpdate(update))?;
        Ok(true)
    }

    /// Its start, as raw frames say it.
    fn started(&self) -> Result<(), Error> {
        self.background(true)?;
        self.system(
            "task_started",
            json!({
                "tool_use_id": self.launch,
                "description": "Audit the routes",
                "task_type": "local_workflow",
                "workflow_name": "audit-routes",
                "prompt": self.script(),
            }),
        )
    }

    /// Its whole tree now.
    fn progress(&self, agents: &[Agent], tokens: u64) -> Result<(), Error> {
        let mut tree: Vec<Value> = ["Scan", "Fix", "Verify"]
            .iter()
            .enumerate()
            .map(|(at, title)| json!({ "type": "workflow_phase", "index": at + 1, "title": title }))
            .collect();
        tree.extend(agents.iter().map(Agent::frame));
        self.system(
            "task_progress",
            json!({
                "tool_use_id": self.launch,
                "description": "Audit the routes",
                "usage": { "total_tokens": tokens, "tool_uses": agents.len(), "duration_ms": 10 },
                "workflow_progress": tree,
            }),
        )
    }

    /// Works its phases, says its end, and goes on by itself with it.
    async fn work(self) -> Result<(), Error> {
        let pace = Duration::from_millis(if self.on("long") { 600 } else { 60 });
        let fix = if self.on("big") { 50 } else { 3 };
        let mut agents: Vec<Agent> = Vec::new();
        let mut tokens = 0;
        let mut logs = Vec::new();
        let mut cued = false;
        for (phase, count) in [(1u16, 2u32), (2, fix), (3, 1)] {
            if phase == 2 && self.on("fails") {
                return self.end("failed", tokens, &logs).await;
            }
            for index in 1..=count {
                let state = if index <= 8 { "start" } else { "queued" };
                agents.push(Agent::new(phase, index, state));
            }
            self.progress(&agents, tokens)?;
            if phase == 2 && self.on("dies") {
                tokio::time::sleep(pace).await;
                std::process::exit(1);
            }
            if phase == 3 && self.asks {
                self.verify().await?;
            }
            // They end eight at a time, the queued starting as others end.
            loop {
                tokio::time::sleep(pace).await;
                tokens += 1000;
                let at_work: Vec<usize> = (agents.iter().enumerate())
                    .filter(|(_, agent)| agent.phase == phase && agent.state != "done")
                    .map(|(at, _)| at)
                    .collect();
                if at_work.is_empty() {
                    break;
                }
                // Held on cue, Fix ends one agent first.
                let holds = phase == 2 && !cued && cueing();
                for at in at_work.iter().take(if holds { 1 } else { 8 }) {
                    agents[*at].state = "done";
                }
                for at in at_work.iter().skip(8).take(if holds { 0 } else { 8 }) {
                    agents[*at].state = "start";
                }
                self.progress(&agents, tokens)?;
                if phase == 2 && !cued {
                    cued = true;
                    cue().await;
                }
            }
            if self.on("log") {
                logs.push(format!("phase {phase} done"));
            }
        }
        self.end("completed", tokens, &logs).await
    }

    /// `asks`: the Verify agent asks to run a command, on the parent's
    /// session, between turns.
    async fn verify(&self) -> Result<(), Error> {
        let id = format!("{}-verify", self.task);
        let call = ToolCall::new(id.clone(), "echo ok > d.txt")
            .kind(ToolKind::Execute)
            .status(ToolCallStatus::Pending);
        say(&self.cx, &self.session, SessionUpdate::ToolCall(call))?;
        let options = vec![
            PermissionOption::new("allow-once", "Yes", PermissionOptionKind::AllowOnce),
            PermissionOption::new("reject", "No", PermissionOptionKind::RejectOnce),
        ];
        let fields = ToolCallUpdateFields::new()
            .title("echo ok > d.txt")
            .kind(ToolKind::Execute)
            .status(ToolCallStatus::Pending);
        let asked = ToolCallUpdate::new(id.clone(), fields);
        let question = RequestPermissionRequest::new(self.session.clone(), asked, options);
        let status = match allowed(&self.cx, question, &["allow-once"]).await {
            true => {
                let _ = std::fs::write(self.folder.join("d.txt"), "ok\n");
                ToolCallStatus::Completed
            }
            false => ToolCallStatus::Failed,
        };
        let ran = ToolCallUpdate::new(id, ToolCallUpdateFields::new().status(status));
        say(&self.cx, &self.session, SessionUpdate::ToolCallUpdate(ran))
    }

    /// Its end, as `status` says, with what it left; then the Agent goes
    /// on by itself with it.
    /// Its output file is Claude's object of what it returned and logged;
    /// a script that threw leaves it empty.
    async fn end(&self, status: &str, tokens: u64, logs: &[String]) -> Result<(), Error> {
        let output = self.folder.join(format!(".crew-{}.output", self.task));
        let left = match status {
            "completed" => json!({
                "summary": "Audit the routes",
                "logs": logs,
                "result": "Fixed 3 dead routes; the build passes.",
            })
            .to_string(),
            _ => String::new(),
        };
        let _ = std::fs::write(&output, left);
        let summary = match status {
            "completed" => "Dynamic workflow \"Audit the routes\" completed".to_owned(),
            _ => "Dynamic workflow \"Audit the routes\" failed: Error: the script threw after \
                  Scan\n    at <anonymous> (workflow.js:5:7)"
                .to_owned(),
        };
        self.system("task_updated", json!({ "patch": { "status": status } }))?;
        self.system(
            "task_notification",
            json!({
                "tool_use_id": self.launch,
                "status": status,
                "output_file": output.to_string_lossy(),
                "summary": summary,
                "usage": { "total_tokens": tokens, "tool_uses": 6, "duration_ms": 100 },
            }),
        )?;
        self.background(false)?;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let words = match status {
            "completed" => "The Crew fixed the routes.",
            _ => "The Crew failed.",
        };
        say(&self.cx, &self.session, SessionUpdate::AgentMessageChunk(text(words)))?;
        let origin = json!({ "_claude/origin": { "kind": "task-notification", "runId": self.run } });
        let used = UsageUpdate::new(30_000, 200_000)
            .cost(Cost::new(0.1, "USD"))
            .meta(origin.as_object().cloned());
        say(&self.cx, &self.session, SessionUpdate::UsageUpdate(used))
    }
}

/// Whether a Crew waits for a cue.
fn cueing() -> bool {
    std::env::var_os("FAKE_AGENT_CREW_CUE").is_some()
}

/// Waits for the file `FAKE_AGENT_CREW_CUE` names, if it names one.
async fn cue() {
    let Some(path) = std::env::var_os("FAKE_AGENT_CREW_CUE") else {
        return;
    };
    while !std::path::Path::new(&path).exists() {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// One agent of a Crew, as its tree says it.
#[derive(Clone)]
struct Agent {
    phase: u16,
    index: u32,
    state: &'static str,
}

impl Agent {
    fn new(phase: u16, index: u32, state: &'static str) -> Agent {
        Agent {
            phase,
            index,
            state,
        }
    }

    fn frame(&self) -> Value {
        let title = ["Scan", "Fix", "Verify"][usize::from(self.phase) - 1];
        let mut frame = json!({
            "type": "workflow_agent",
            "index": self.index,
            "label": format!("{} {}", title.to_lowercase(), self.index),
            "phaseIndex": self.phase,
            "phaseTitle": title,
            "agentId": format!("a{}{}", self.phase, self.index),
            "model": "fake-small",
            // One past the limit at once waits as Claude says it: it
            // starts, with no start time.
            "state": if self.state == "queued" { "start" } else { self.state },
            "attempt": 1,
            "queuedAt": 1,
            "promptPreview": format!("{title} part {}", self.index),
        });
        if self.state != "queued" {
            frame["startedAt"] = json!(1000 + u64::from(self.phase) * 100 + u64::from(self.index));
        }
        if self.state == "done" {
            frame["resultPreview"] = json!("ok");
        }
        frame
    }
}

/// The `crew` turn: the Workflow call, its answer, and the Crew working
/// after it.
pub(super) async fn turn(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    words: &str,
    then: &mut Option<After>,
) -> Result<StopReason, Error> {
    let words: Vec<String> = (words.split_whitespace())
        .skip_while(|word| *word != "crew")
        .skip(1)
        .map(str::to_owned)
        .collect();
    let crew = |asks: bool| {
        let n = CREWS.fetch_add(1, Ordering::Relaxed) + 1;
        Crew {
            cx: cx.clone(),
            session: session.clone(),
            folder: fake.setup(session).folder,
            words: words.clone(),
            task: format!("w{}x{n}", std::process::id()),
            run: format!("run-{}-{n}", std::process::id()),
            launch: format!("toolu_crew_{n}"),
            asks,
        }
    };
    if words.iter().any(|word| word == "ultracode")
        && let Some(update) = fake.ultracode(session)
    {
        say(cx, session, update)?;
    }
    let first = crew(words.iter().any(|word| word == "asks"));
    if !first.launch().await? {
        say(cx, session, SessionUpdate::AgentMessageChunk(text("I did not start it.")))?;
        return Ok(StopReason::EndTurn);
    }
    first.started()?;
    let mut crews = vec![first];
    if crews[0].on("two") {
        let second = crew(false);
        second.launch().await?;
        second.started()?;
        crews.push(second);
    }
    say(cx, session, SessionUpdate::AgentMessageChunk(text("The Crew is at work.")))?;
    *then = Some(Box::pin(async move {
        let works = crews.into_iter().map(|crew| tokio::spawn(crew.work()));
        for work in works.collect::<Vec<_>>() {
            let _ = work.await;
        }
    }));
    Ok(StopReason::EndTurn)
}
