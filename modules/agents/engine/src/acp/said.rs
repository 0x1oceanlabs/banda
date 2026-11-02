//! What a Harness says in a session, in the module's own words.

use super::*;

/// What a Harness said during a turn.
pub enum Said {
    /// A piece of the Agent's reply, or of its thinking: `message` names
    /// the message it belongs to, when the Harness says.
    Reply {
        text: String,
        message: Option<String>,
    },
    Thought {
        text: String,
        message: Option<String>,
    },
    ToolStarted {
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<ToolContent>,
    },
    /// `output` follows what the command printed before.
    ToolChanged {
        call: String,
        change: ToolChange,
        output: Option<String>,
    },
    /// The steps of the Agent's plan now, all of them.
    Steps(Vec<PlanStep>),
    /// What it has used now, and, when the account reached its limit, the
    /// time it may be used again, in milliseconds since the epoch.
    Used { usage: Usage, resets: Option<i64> },
    /// The Harness asks a Person to decide, and waits for `answer`.
    Asks {
        call: String,
        title: Option<String>,
        /// What the tool call would do, if the Harness says here.
        tool: Option<ToolKind>,
        offered: Vec<Choice>,
        /// A form to fill in, for a Question that asks more than a choice.
        form: Option<Vec<Field>>,
        /// The plan it asks to carry out, when it asks to leave plan mode.
        plan: Option<String>,
        answer: oneshot::Sender<Answer>,
    },
    /// The Harness no longer waits for the answer to what it asked.
    Withdrawn(String),
    /// The session's options changed during the turn.
    Runs(Running),
    /// A line for the Person, such as a warning.
    Notice(String),
}

/// What an update changes in a tool call: each field given replaces its
/// own.
#[derive(Debug, Default)]
pub struct ToolChange {
    pub title: Option<String>,
    pub status: Option<ToolStatus>,
    pub content: Option<Vec<ToolContent>>,
    /// How its command ended.
    pub exit: Option<Exit>,
}

impl ToolChange {
    /// Whether it changes nothing.
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.status.is_none()
            && self.content.is_none()
            && self.exit.is_none()
    }
}

/// What goes back to a Harness that asked.
#[derive(Debug)]
pub enum Answer {
    Chose(String),
    /// The Person submitted the form with these values.
    Filled(Values),
    /// The turn is stopping: the Harness must not wait any longer.
    Cancelled,
}

/// The `_meta` keys where Claude Code's and Codex's adapters put what a
/// command prints, for a client that declares the first, and how the
/// command ended (their Zed conventions).
pub(super) const OUTPUT_META: &str = "terminal_output_delta";
const EXIT_META: &str = "terminal_exit";

fn message_of(chunk: &acp::ContentChunk) -> Option<String> {
    chunk.message_id.as_ref().map(|id| id.0.to_string())
}

fn text_of(chunk: &acp::ContentChunk) -> Option<String> {
    match &chunk.content {
        acp::ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

pub(super) fn said(update: acp::SessionUpdate) -> Option<Said> {
    match update {
        acp::SessionUpdate::AgentMessageChunk(chunk) => {
            let message = message_of(&chunk);
            text_of(&chunk).map(|text| Said::Reply { text, message })
        }
        acp::SessionUpdate::AgentThoughtChunk(chunk) => {
            let message = message_of(&chunk);
            text_of(&chunk).map(|text| Said::Thought { text, message })
        }
        acp::SessionUpdate::ToolCall(call) => Some(Said::ToolStarted {
            call: call.tool_call_id.0.to_string(),
            title: call.title,
            tool: tool_kind(call.kind),
            status: tool_status(call.status),
            content: tool_content(&call.content),
        }),
        acp::SessionUpdate::ToolCallUpdate(update) => {
            let terminal = |key: &str| update.meta.as_ref()?.get(key);
            let exit = terminal(EXIT_META).map(|ended| Exit {
                code: ended
                    .get("exit_code")
                    .and_then(serde_json::Value::as_i64)
                    .and_then(|code| i32::try_from(code).ok()),
                signal: ended
                    .get("signal")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
            });
            Some(Said::ToolChanged {
                call: update.tool_call_id.0.to_string(),
                change: ToolChange {
                    title: update.fields.title,
                    status: update.fields.status.map(tool_status),
                    content: update.fields.content.as_deref().map(tool_content),
                    exit,
                },
                output: terminal(OUTPUT_META)
                    .and_then(|o| o.get("data")?.as_str())
                    .map(str::to_owned),
            })
        }
        acp::SessionUpdate::Plan(plan) => Some(Said::Steps(
            plan.entries
                .into_iter()
                .map(|entry| PlanStep {
                    text: entry.content,
                    state: step_state(&entry.status),
                })
                .collect(),
        )),
        acp::SessionUpdate::UsageUpdate(update) => Some(Said::Used {
            resets: resets(update.meta.as_ref()),
            usage: usage(update),
        }),
        acp::SessionUpdate::Notice(notice) => Some(Said::Notice(match notice.description {
            Some(more) if !more.trim().is_empty() => format!("{} {more}", notice.title),
            _ => notice.title,
        })),
        _ => None,
    }
}

/// What a tool call shows: its text, its diffs, and where its command's
/// output goes, which comes apart, in [`OUTPUT_META`].
fn tool_content(content: &[acp::ToolCallContent]) -> Vec<ToolContent> {
    content
        .iter()
        .filter_map(|shown| match shown {
            acp::ToolCallContent::Content(acp::Content {
                content: acp::ContentBlock::Text(text),
                ..
            }) => Some(ToolContent::Text {
                text: text.text.clone(),
            }),
            acp::ToolCallContent::Diff(diff) => Some(ToolContent::Diff {
                path: diff.path.display().to_string(),
                old: diff.old_text.clone(),
                new: diff.new_text.clone(),
            }),
            acp::ToolCallContent::Terminal(_) => Some(ToolContent::Terminal),
            _ => None,
        })
        .collect()
}

pub(super) fn tool_kind(kind: acp::ToolKind) -> ToolKind {
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

fn step_state(status: &acp::PlanEntryStatus) -> StepState {
    match status {
        acp::PlanEntryStatus::InProgress => StepState::InProgress,
        acp::PlanEntryStatus::Completed => StepState::Done,
        _ => StepState::Pending,
    }
}

pub(super) fn usage(update: acp::UsageUpdate) -> Usage {
    let tokens = |n: u64| u32::try_from(n).unwrap_or(u32::MAX);
    Usage {
        used: tokens(update.used),
        size: tokens(update.size),
        cost: update.cost.and_then(|cost| {
            Some(Cost {
                amount: serde_json::Number::from_f64(cost.amount)?,
                currency: cost.currency,
            })
        }),
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
