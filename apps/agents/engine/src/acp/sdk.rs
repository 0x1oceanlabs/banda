//! Claude's raw SDK frames, `_claude/sdkMessage` (ADR 0103, decision 9):
//! what Crews and background sub-agents are made of. Banda asks for five
//! subtypes as a Thread's session opens ([`RAW`]), and reads them here into
//! its own words, tolerantly: `workflow_progress` is not documented, so a
//! frame, or a part of one, Banda cannot read is left out, and leaves a
//! Crew as it was.

use crate::model::{CrewAgent, Phase, SubagentState};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The raw frames Banda asks Claude Code for, by their subtype: no `init`,
/// which says the session's tools and model again each time it goes on.
pub(super) const RAW: [&str; 5] = [
    "task_started",
    "task_progress",
    "task_updated",
    "task_notification",
    "background_tasks_changed",
];

/// `_meta.claudeCode.emitRawSDKMessages`, the filter that asks for [`RAW`].
pub(super) fn asked() -> Value {
    let filters: Vec<Value> = RAW
        .iter()
        .map(|subtype| serde_json::json!({ "type": "system", "subtype": subtype }))
        .collect();
    Value::Array(filters)
}

/// `_claude/sdkMessage`, as Claude Code's adapter sends a raw frame.
#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcNotification)]
#[notification(method = "_claude/sdkMessage")]
#[serde(rename_all = "camelCase")]
pub(super) struct SdkMessage {
    pub(super) session_id: agent_client_protocol::schema::v1::SessionId,
    pub(super) message: Value,
}

/// One raw frame, in Banda's words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Sdk {
    /// A task started: a Crew, a sub-agent, or a command.
    Started(Started),
    /// How a task goes now; a Crew's whole tree when it changed.
    Progress(Progress),
    /// A task's state changed: it ended, when it says how.
    Updated { task: String, end: Option<TaskEnd> },
    /// A task ended, and what it left.
    Notified(Notified),
    /// The tasks that go on in the background now, all of them.
    Background(Vec<Background>),
}

/// What kind of task Claude says one is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskKind {
    /// A Workflow: a Crew.
    Workflow,
    /// A sub-agent.
    Agent,
    /// Anything else, as a command.
    Other,
}

impl TaskKind {
    fn of(said: Option<&str>) -> TaskKind {
        match said {
            Some("local_workflow") => TaskKind::Workflow,
            Some("local_agent") => TaskKind::Agent,
            _ => TaskKind::Other,
        }
    }
}

/// `task_started`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Started {
    pub task: String,
    /// The run Claude's usage names when it goes on after the task.
    pub run: Option<String>,
    /// The tool use that launched it.
    pub tool_use: Option<String>,
    pub kind: TaskKind,
    /// A workflow's name, its script's `meta.name`.
    pub name: Option<String>,
    pub description: Option<String>,
    /// A workflow's script; a sub-agent's brief.
    pub prompt: Option<String>,
    pub background: bool,
    /// The task that started it, for a nested one.
    pub parent: Option<String>,
    /// Claude's own housekeeping, which nobody is shown.
    pub ambient: bool,
}

/// `task_progress`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Progress {
    pub task: String,
    pub tokens: Option<u64>,
    /// A Crew's phases and agents, when the frame carries them.
    pub tree: Option<Tree>,
}

/// A Crew's tree as `workflow_progress` says it, whole each time.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tree {
    pub phases: Vec<Phase>,
    pub agents: Vec<CrewAgent>,
    /// What its script last logged, when the tree carries it.
    pub log: Option<String>,
}

/// How a task ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskEnd {
    Completed,
    Failed,
    Stopped,
}

impl TaskEnd {
    fn of(said: Option<&str>) -> Option<TaskEnd> {
        match said? {
            "completed" | "done" | "success" => Some(TaskEnd::Completed),
            "failed" | "error" => Some(TaskEnd::Failed),
            "stopped" | "killed" | "cancelled" | "canceled" => Some(TaskEnd::Stopped),
            _ => None,
        }
    }
}

/// `task_notification`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notified {
    pub task: String,
    pub end: Option<TaskEnd>,
    /// Where it wrote what it gave back; none when empty.
    pub output: Option<String>,
    pub summary: Option<String>,
    pub tokens: Option<u64>,
}

/// One task of `background_tasks_changed`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Background {
    pub task: String,
    pub run: Option<String>,
    pub kind: TaskKind,
    pub ambient: bool,
}

fn text(value: &Value, key: &str) -> Option<String> {
    let said = value.get(key)?.as_str()?.trim();
    (!said.is_empty()).then(|| said.to_owned())
}

fn number(value: &Value, key: &str) -> Option<u64> {
    value.get(key)?.as_u64()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// The tokens a frame's `usage` says.
fn tokens(value: &Value) -> Option<u64> {
    number(value.get("usage")?, "total_tokens")
}

/// What raw `message` says, in Banda's words; none for a frame Banda does
/// not read, or cannot.
pub fn read(message: &Value) -> Option<Sdk> {
    if message.get("type")?.as_str()? != "system" {
        return None;
    }
    let subtype = message.get("subtype")?.as_str()?;
    if subtype == "background_tasks_changed" {
        let tasks = message.get("tasks")?.as_array()?;
        let tasks = tasks.iter().filter_map(|task| {
            Some(Background {
                task: text(task, "task_id")?,
                run: text(task, "run_id"),
                kind: TaskKind::of(task.get("task_type").and_then(Value::as_str)),
                ambient: flag(task, "ambient"),
            })
        });
        return Some(Sdk::Background(tasks.collect()));
    }
    let task = text(message, "task_id")?;
    Some(match subtype {
        "task_started" => Sdk::Started(Started {
            run: text(message, "run_id"),
            tool_use: text(message, "tool_use_id"),
            kind: TaskKind::of(message.get("task_type").and_then(Value::as_str)),
            name: text(message, "workflow_name"),
            description: text(message, "description"),
            prompt: text(message, "prompt"),
            background: flag(message, "is_backgrounded"),
            parent: text(message, "parent_task_id"),
            ambient: flag(message, "ambient"),
            task,
        }),
        "task_progress" => Sdk::Progress(Progress {
            tokens: tokens(message),
            tree: message.get("workflow_progress").and_then(tree),
            task,
        }),
        "task_updated" => {
            let status = message.get("patch").and_then(|patch| patch.get("status"));
            Sdk::Updated {
                end: TaskEnd::of(status.and_then(Value::as_str)),
                task,
            }
        }
        "task_notification" => Sdk::Notified(Notified {
            end: TaskEnd::of(message.get("status").and_then(Value::as_str)),
            output: text(message, "output_file"),
            summary: text(message, "summary"),
            tokens: tokens(message),
            task,
        }),
        _ => return None,
    })
}

/// A Crew's tree from `workflow_progress`: its phases, and its agents in
/// their phase's order, by index (ADR 0103, decision 22). Not an array,
/// none; an entry it cannot read is left out.
fn tree(progress: &Value) -> Option<Tree> {
    let mut tree = Tree::default();
    for entry in progress.as_array()? {
        match entry.get("type").and_then(Value::as_str) {
            Some("workflow_phase") => {
                let (Some(index), Some(title)) = (number(entry, "index"), text(entry, "title"))
                else {
                    continue;
                };
                tree.phases.push(Phase {
                    index: u16::try_from(index).unwrap_or(u16::MAX),
                    title,
                    detail: text(entry, "detail"),
                });
            }
            Some("workflow_agent") => {
                if let Some(agent) = agent(entry) {
                    tree.agents.push(agent);
                }
            }
            Some("workflow_log") => {
                let line = ["message", "text", "line"]
                    .iter()
                    .find_map(|key| text(entry, key));
                if line.is_some() {
                    tree.log = line;
                }
            }
            _ => {}
        }
    }
    tree.phases.sort_by_key(|phase| phase.index);
    tree.agents.sort_by_key(|agent| (agent.phase, agent.index));
    Some(tree)
}

/// One `workflow_agent`.
fn agent(entry: &Value) -> Option<CrewAgent> {
    let index = u32::try_from(number(entry, "index")?).ok()?;
    let phase = u16::try_from(number(entry, "phaseIndex")?).ok()?;
    let started = entry.get("startedAt").and_then(Value::as_i64);
    let why = text(entry, "error");
    let state = agent_state(
        entry.get("state").and_then(Value::as_str),
        entry.get("endedWithRun").and_then(Value::as_str),
        started.is_some(),
    );
    let last = match (text(entry, "lastToolName"), text(entry, "lastToolSummary")) {
        (Some(tool), Some(summary)) => Some(format!("{tool} · {summary}")),
        (tool, summary) => summary.or(tool),
    };
    Some(CrewAgent {
        index,
        label: text(entry, "label").unwrap_or_else(|| format!("Agent {index}")),
        phase,
        state,
        model: text(entry, "model"),
        attempt: number(entry, "attempt")
            .and_then(|attempt| u16::try_from(attempt).ok())
            .unwrap_or(1),
        tokens: number(entry, "tokens"),
        calls: number(entry, "toolCalls").and_then(|calls| u32::try_from(calls).ok()),
        took: entry.get("durationMs").and_then(Value::as_i64),
        started,
        prompt: text(entry, "promptPreview"),
        result: text(entry, "resultPreview"),
        last,
        why,
        lane: None,
    })
}

/// An agent's state in Banda's words: one Claude says it errored because
/// its Crew was stopped is Stopped, and one it says starts with no start
/// time waits for a place, Queued, as Claude says those past its limit of
/// agents at once. A state Banda does not know is Running once it started,
/// else Queued.
fn agent_state(said: Option<&str>, ended_with: Option<&str>, started: bool) -> SubagentState {
    match said {
        Some("queued" | "pending" | "waiting") => SubagentState::Queued,
        Some("start" | "started") if !started => SubagentState::Queued,
        Some("start" | "started" | "running" | "progress") => SubagentState::Running,
        Some("done" | "completed" | "success") => SubagentState::Done,
        Some("error" | "failed") if ended_with == Some("stopped") => SubagentState::Stopped,
        Some("error" | "failed") => SubagentState::Failed,
        Some("stopped" | "killed" | "cancelled" | "canceled") => SubagentState::Stopped,
        _ if started => SubagentState::Running,
        _ => SubagentState::Queued,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The recording of step 0, made with the capability on: it cannot be
    /// replayed, as its client was not Banda, but its frames are Claude's.
    const WORKFLOW: &str =
        include_str!("../../../../../docs/research/2026-11-10-sub-agents/acp-with-subagents/claude-workflow.jsonl");

    /// The raw message on line `n` of [`WORKFLOW`].
    fn line(n: usize) -> Value {
        let line = WORKFLOW.lines().nth(n - 1).unwrap();
        let entry: Value = serde_json::from_str(line).unwrap();
        assert_eq!(entry["frame"]["method"], "_claude/sdkMessage", "line {n}");
        entry["frame"]["params"]["message"].clone()
    }

    #[test]
    fn a_workflow_starts_with_its_name_run_and_script() {
        let Some(Sdk::Started(started)) = read(&line(27)) else {
            panic!("a start");
        };
        assert_eq!(started.task, "wu8k0p16z");
        assert_eq!(started.kind, TaskKind::Workflow);
        assert_eq!(started.name.as_deref(), Some("read-two"));
        assert_eq!(started.run.as_deref(), Some("0mwaee106-c47aaf5f"));
        assert_eq!(
            started.tool_use.as_deref(),
            Some("toolu_01UAFqaRgMvSjxPLBawB1PZw")
        );
        assert!(started.prompt.unwrap().starts_with("export const meta"));
        assert!(!started.background && !started.ambient);
    }

    #[test]
    fn progress_carries_the_whole_tree_in_phase_and_index_order() {
        let Some(Sdk::Progress(first)) = read(&line(30)) else {
            panic!("progress");
        };
        let tree = first.tree.unwrap();
        let titles: Vec<_> = tree.phases.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, ["Read", "Check"]);
        assert_eq!(tree.phases[0].index, 1);
        let [agent] = tree.agents.as_slice() else {
            panic!("one agent so far: {:?}", tree.agents);
        };
        assert_eq!(agent.label, "read a.txt");
        assert_eq!(agent.state, SubagentState::Running);
        assert_eq!(agent.model.as_deref(), Some("claude-haiku-5-5"));
        assert_eq!(agent.attempt, 1);

        let Some(Sdk::Progress(later)) = read(&line(53)) else {
            panic!("progress");
        };
        assert_eq!(later.tokens, Some(12452));
        let agents = later.tree.unwrap().agents;
        let states: Vec<_> = agents.iter().map(|a| (a.phase, a.state)).collect();
        assert_eq!(
            states,
            [(1, SubagentState::Done), (2, SubagentState::Running)]
        );
        let done = &agents[0];
        assert_eq!(done.tokens, Some(12452));
        assert_eq!(done.calls, Some(3));
        assert_eq!(done.took, Some(6128));
        assert!(done.result.as_deref().unwrap().contains("apple banana"));
        assert!(done.last.as_deref().unwrap().starts_with("Bash · cat "));
    }

    #[test]
    fn an_agent_of_a_stopped_crew_is_stopped_not_failed() {
        let Some(Sdk::Progress(progress)) = read(&line(101)) else {
            panic!("progress");
        };
        let agent = &progress.tree.unwrap().agents[0];
        assert_eq!(agent.state, SubagentState::Stopped);
        assert_eq!(
            agent.why.as_deref(),
            Some("Stopped because the workflow was stopped")
        );
    }

    /// Past Claude's limit of agents at once, an agent waits as one that
    /// starts with no start time (`tests/recordings/claude-crew.jsonl`).
    #[test]
    fn an_agent_that_starts_with_no_start_time_waits_queued() {
        let agent = |started: Option<i64>| {
            let mut entry = serde_json::json!({
                "type": "workflow_agent", "index": 19, "label": "cat 17", "phaseIndex": 2,
                "state": "start", "queuedAt": 1, "attempt": 1,
            });
            if let Some(at) = started {
                entry["startedAt"] = at.into();
            }
            let frame = serde_json::json!({
                "type": "system", "subtype": "task_progress", "task_id": "w",
                "workflow_progress": [entry],
            });
            let Some(Sdk::Progress(progress)) = read(&frame) else {
                panic!("progress");
            };
            progress.tree.unwrap().agents[0].state
        };
        assert_eq!(agent(None), SubagentState::Queued);
        assert_eq!(agent(Some(5)), SubagentState::Running);
    }

    #[test]
    fn a_task_ends_and_says_where_it_wrote_what_it_left() {
        let Some(Sdk::Updated { task, end }) = read(&line(57)) else {
            panic!("an update");
        };
        assert_eq!((task.as_str(), end), ("wu8k0p16z", Some(TaskEnd::Completed)));
        let Some(Sdk::Notified(notified)) = read(&line(58)) else {
            panic!("a notification");
        };
        assert_eq!(notified.end, Some(TaskEnd::Completed));
        assert!(notified.output.unwrap().ends_with("wu8k0p16z.output"));
        assert_eq!(notified.tokens, Some(24255));
        // A stopped command's notification names no output file.
        let Some(Sdk::Notified(stopped)) = read(&line(105)) else {
            panic!("a notification");
        };
        assert_eq!((stopped.end, stopped.output), (Some(TaskEnd::Stopped), None));
    }

    #[test]
    fn background_tasks_are_the_whole_list_each_time() {
        let Some(Sdk::Background(tasks)) = read(&line(26)) else {
            panic!("the list");
        };
        let [task] = tasks.as_slice() else {
            panic!("one: {tasks:?}");
        };
        assert_eq!(task.kind, TaskKind::Workflow);
        assert_eq!(task.run.as_deref(), Some("0mwaee106-c47aaf5f"));
        assert_eq!(read(&line(59)), Some(Sdk::Background(vec![])));
    }

    #[test]
    fn a_frame_it_cannot_read_is_left_out() {
        // Not a system frame, no task, an unknown subtype.
        assert_eq!(read(&serde_json::json!({ "type": "assistant" })), None);
        let no_task = serde_json::json!({ "type": "system", "subtype": "task_progress" });
        assert_eq!(read(&no_task), None);
        let init = serde_json::json!({ "type": "system", "subtype": "init", "task_id": "t" });
        assert_eq!(read(&init), None);
        // A tree that is no array says nothing of the tree; an agent with
        // no index is left out, the rest stay.
        let odd = serde_json::json!({
            "type": "system", "subtype": "task_progress", "task_id": "t",
            "workflow_progress": [
                { "type": "workflow_agent", "label": "no index", "phaseIndex": 1 },
                { "type": "workflow_agent", "index": 2, "phaseIndex": 1, "state": "queued" },
                { "type": "workflow_log", "message": "scanned 4 files" },
                { "type": "something new" },
            ],
        });
        let Some(Sdk::Progress(progress)) = read(&odd) else {
            panic!("progress");
        };
        let tree = progress.tree.unwrap();
        assert_eq!(tree.agents.len(), 1);
        assert_eq!(tree.agents[0].state, SubagentState::Queued);
        assert_eq!(tree.agents[0].label, "Agent 2");
        assert_eq!(tree.log.as_deref(), Some("scanned 4 files"));
        let flat = serde_json::json!({
            "type": "system", "subtype": "task_progress", "task_id": "t",
            "workflow_progress": "?",
        });
        assert!(matches!(read(&flat), Some(Sdk::Progress(Progress { tree: None, .. }))));
    }

    #[test]
    fn banda_asks_for_five_subtypes_and_not_init() {
        let asked = asked();
        let subtypes: Vec<_> = (asked.as_array().unwrap().iter())
            .map(|filter| filter["subtype"].as_str().unwrap())
            .collect();
        assert_eq!(subtypes, RAW);
        assert!(!subtypes.contains(&"init"));
    }
}
