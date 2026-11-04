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
        content: Vec<ToolPart>,
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

/// Tool content in flight. Image bytes stop here, before the Thread's
/// stored words and facts: the transcript keeps them as files first.
#[derive(Debug)]
pub enum ToolPart {
    Shown(ToolContent),
    Image { mime: String, data: String },
}

/// What an update changes in a tool call: each field given replaces its
/// own.
#[derive(Debug, Default)]
pub struct ToolChange {
    pub title: Option<String>,
    pub status: Option<ToolStatus>,
    pub content: Option<Vec<ToolPart>>,
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
            content: tool_content(Some(call.content), call.raw_output).unwrap_or_default(),
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
                    content: tool_content(update.fields.content, update.fields.raw_output),
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

/// Prefer standard ACP content. Codex ACP 2.5 also carries MCP image
/// results as rawOutput.result.content, with no display content field.
fn tool_content(
    content: Option<Vec<acp::ToolCallContent>>,
    raw: Option<serde_json::Value>,
) -> Option<Vec<ToolPart>> {
    let shown = content.map(content_parts);
    if shown.as_ref().is_some_and(|parts| !parts.is_empty()) {
        return shown;
    }
    raw.and_then(mcp_images).or(shown)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum McpPart {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime: String,
    },
    #[serde(other)]
    Other,
}

/// Decode only a known MCP result envelope containing an image, never
/// arbitrary JSON. Moving its fields avoids copying encoded payloads.
fn mcp_images(mut raw: serde_json::Value) -> Option<Vec<ToolPart>> {
    if let Some(result) = raw.get_mut("result") {
        raw = result.take();
    }
    let serde_json::Value::Array(parts) = raw.get_mut("content")?.take() else {
        return None;
    };
    let parts: Vec<_> = parts
        .into_iter()
        .filter_map(|part| match serde_json::from_value::<McpPart>(part).ok()? {
            McpPart::Text { text } => Some(ToolPart::Shown(ToolContent::Text { text })),
            McpPart::Image { data, mime } => Some(ToolPart::Image { mime, data }),
            McpPart::Other => None,
        })
        .collect();
    parts
        .iter()
        .any(|part| matches!(part, ToolPart::Image { .. }))
        .then_some(parts)
}

/// What a tool call shows: its text, its diffs, and where its command's
/// output goes, which comes apart, in [`OUTPUT_META`].
fn content_parts(content: Vec<acp::ToolCallContent>) -> Vec<ToolPart> {
    content
        .into_iter()
        .filter_map(|shown| {
            if let acp::ToolCallContent::Content(acp::Content {
                content: acp::ContentBlock::Image(image),
                ..
            }) = shown
            {
                return Some(ToolPart::Image {
                    mime: image.mime_type,
                    data: image.data,
                });
            }
            let shown = match shown {
                acp::ToolCallContent::Content(acp::Content {
                    content: acp::ContentBlock::Text(text),
                    ..
                }) => ToolContent::Text { text: text.text },
                acp::ToolCallContent::Diff(diff) => ToolContent::Diff {
                    path: diff.path.display().to_string(),
                    old: diff.old_text,
                    new: diff.new_text,
                },
                acp::ToolCallContent::Terminal(_) => ToolContent::Terminal,
                _ => return None,
            };
            Some(ToolPart::Shown(shown))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mcp_image_results_arrive_as_content_or_raw_output_without_duplicates() {
        let raw = || {
            json!({"result":{"content":[
            {"type":"text","text":"before"},
            {"type":"image","mimeType":"image/png","data":"AA=="},
            {"type":"text","text":"after"}
        ]},"error":null})
        };
        assert_eq!(
            tool_content(Some(Vec::new()), Some(raw())).unwrap().len(),
            3
        );
        let parts = tool_content(None, Some(raw())).unwrap();
        assert!(
            matches!(&parts[..], [ToolPart::Shown(ToolContent::Text {text: before}), ToolPart::Image {mime, data}, ToolPart::Shown(ToolContent::Text {text: after})] if before == "before" && after == "after" && mime == "image/png" && data == "AA==")
        );
        let direct = vec![acp::ToolCallContent::Content(acp::Content::new(
            acp::ContentBlock::Image(acp::ImageContent::new("BB==", "image/png")),
        ))];
        let parts = tool_content(Some(direct), Some(raw())).unwrap();
        assert!(matches!(&parts[..], [ToolPart::Image {data,..}] if data == "BB=="));
        assert!(
            tool_content(
                None,
                Some(json!({"content":[{"type":"text","text":"ordinary raw output"}]}))
            )
            .is_none()
        );
        assert!(tool_content(None, Some(json!({"other":{"content":[{"type":"image","mimeType":"image/png","data":"AA=="}]}}))).is_none());
    }
}
