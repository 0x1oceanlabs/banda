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
    /// `places` are the files it works on, as the Harness names them;
    /// `compacts` when it is the Harness compacting the context.
    ToolStarted {
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<ToolPart>,
        places: Vec<Place>,
        compacts: bool,
    },
    /// `output` follows what the command printed before; `places`, when
    /// not empty, are the files it works on now.
    ToolChanged {
        call: String,
        change: ToolChange,
        output: Option<String>,
        places: Vec<Place>,
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
    /// The Agent started a sub-agent, here, after what it said before
    /// (ADR 0103, decision 7). What hears it keeps the sub-agent's lane
    /// and the entry where it shows, then tells `started` which lane it
    /// is, of which turn.
    Subagent {
        announced: Announced,
        started: StartedTx,
    },
}

/// The lane a sub-agent's start was kept as.
pub type StartedTx = oneshot::Sender<Subagent>;
pub type StartedRx = oneshot::Receiver<Subagent>;

/// A sub-agent as its parent announced it: its child session, as the
/// Harness names it, the title and role its parent gave it, whether the
/// Harness lets it be stopped alone, and how it stands, if it says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Announced {
    pub child: String,
    pub title: Option<String>,
    pub role: Option<String>,
    /// The Harness lets a client stop it alone (`capabilities.cancel`).
    pub cancel: bool,
    pub state: Option<LaneState>,
}

/// What a Thread's sub-agents say, each by its child session as the
/// Harness names it, in the order the Harness says it: on a channel of
/// their own ([`Session::lanes`]), apart from the Thread's turns, so none
/// of it opens a turn (ADR 0103, decision 8).
pub enum LaneSaid {
    /// A sub-agent was announced: by the Thread's own session, or by
    /// another sub-agent's, `parent`. `started` hears which lane it is,
    /// once what heard its start kept it: the turn that heard it, or its
    /// parent's lane, which hears it first, as said in place. `held` keeps
    /// its process from being let go as idle until its lane holds it.
    Seen {
        announced: Announced,
        parent: Option<String>,
        started: StartedRx,
        held: Held,
    },
    /// What its parent changed of it: each field given replaces its own.
    /// A title or role is none when not given, `Some(None)` when cleared.
    Changed {
        child: String,
        title: Option<Option<String>>,
        role: Option<Option<String>>,
        cancel: Option<bool>,
        state: Option<LaneState>,
    },
    /// What it said on its own session, as a turn hears it.
    Said { child: String, said: Said },
    /// The model and the role its session runs with, when it says them.
    Runs {
        child: String,
        model: Option<String>,
        role: Option<String>,
    },
    /// A message its parent sent it, `message`, all of it so far.
    Brief {
        child: String,
        message: String,
        text: String,
    },
    /// Its report to its parent, all of it so far, as [`report`] cleans it.
    Report { child: String, text: String },
}

impl LaneSaid {
    /// The child session it is of, as the Harness names it.
    pub fn child(&self) -> &str {
        match self {
            LaneSaid::Seen { announced, .. } => &announced.child,
            LaneSaid::Changed { child, .. }
            | LaneSaid::Said { child, .. }
            | LaneSaid::Runs { child, .. }
            | LaneSaid::Brief { child, .. }
            | LaneSaid::Report { child, .. } => child,
        }
    }
}

/// How a sub-agent's work stands, as its Harness says it (the RFD's
/// states).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LaneState {
    Running,
    /// It waits on its Person (`requires_action`).
    Asks,
    Idle(IdleWhy),
    /// The Harness cannot say how it goes.
    Unknown,
    /// A state Banda does not know.
    Other,
}

/// Why a sub-agent went idle, as its Harness says it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdleWhy {
    EndTurn,
    Cancelled,
    /// Something failed, in the Harness's words, which may be none.
    Error(String),
    Refusal,
    MaxTokens,
    MaxTurnRequests,
    /// It said no reason, or one Banda does not know.
    Unsaid,
}

/// A sub-agent's state as its parent says it; a state cleared says none.
pub(super) fn lane_state(state: MaybeUndefined<acp::StateUpdate>) -> Option<LaneState> {
    Some(match state.take()? {
        acp::StateUpdate::Running(_) => LaneState::Running,
        acp::StateUpdate::RequiresAction(_) => LaneState::Asks,
        acp::StateUpdate::Idle(idle) => LaneState::Idle(match idle.stop_reason {
            Some(acp::IdleStopReason::EndTurn) => IdleWhy::EndTurn,
            Some(acp::IdleStopReason::Cancelled) => IdleWhy::Cancelled,
            Some(acp::IdleStopReason::Error(failed)) => IdleWhy::Error(
                (failed.error)
                    .map(|error| error.message.trim().to_owned())
                    .unwrap_or_default(),
            ),
            Some(acp::IdleStopReason::Refusal) => IdleWhy::Refusal,
            Some(acp::IdleStopReason::MaxTokens) => IdleWhy::MaxTokens,
            Some(acp::IdleStopReason::MaxTurnRequests) => IdleWhy::MaxTurnRequests,
            _ => IdleWhy::Unsaid,
        }),
        acp::StateUpdate::Unknown(_) => LaneState::Unknown,
        _ => LaneState::Other,
    })
}

/// Whether a sub-agent may be stopped alone, as a patch of its
/// capabilities says, from `was`: omitted keeps it, `null` clears it, and
/// an object says it.
pub(super) fn cancel_of(
    was: bool,
    capabilities: &MaybeUndefined<acp::SubagentSessionCapabilities>,
) -> bool {
    match capabilities {
        MaybeUndefined::Undefined => was,
        MaybeUndefined::Null => false,
        MaybeUndefined::Value(can) => can.cancel.is_some(),
    }
}

/// The tag Claude Code puts before a sub-agent's report, naming the tools
/// it used: its own, never the sub-agent's words.
const TOOLS_TAG: (&str, &str) = (
    "<tools-used-before-summary>",
    "</tools-used-before-summary>",
);
/// How a background sub-agent's first `:reply` starts: Claude Code's
/// receipt that it launched, not what it found.
const RECEIPT: &str = "Async agent launched";

/// A sub-agent's report as its Harness sends it, cleaned: Claude Code's
/// tools tag cut, whether it is a block of its own or before a blank line
/// (`docs/research/2026-11-10-sub-agents/recordings.md`). None for a
/// receipt, or for nothing but the tag.
pub(super) fn report(text: &str) -> Option<String> {
    let (open, close) = TOOLS_TAG;
    let trimmed = text.trim_start();
    let words = match trimmed.strip_prefix(open) {
        Some(tagged) => tagged.split_once(close).map_or(trimmed, |(_, after)| after),
        None => trimmed,
    };
    let words = words.trim();
    (!words.is_empty() && !words.starts_with(RECEIPT)).then(|| words.to_owned())
}

/// What a message's content says, its text blocks together.
pub(super) fn text_of_blocks<'a>(
    blocks: impl IntoIterator<Item = &'a acp::ContentBlock>,
) -> String {
    blocks
        .into_iter()
        .filter_map(|block| match block {
            acp::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect()
}

/// Tool content in flight. Image bytes stop here, before the Thread's
/// stored words and facts: the transcript keeps them as files first.
#[derive(Debug)]
pub enum ToolPart {
    Shown(ToolContent),
    Image { mime: String, data: String },
}

impl ToolPart {
    /// What it shows as the Thread keeps it, unless it is an image.
    pub fn shown(&self) -> Option<&ToolContent> {
        match self {
            ToolPart::Shown(shown) => Some(shown),
            ToolPart::Image { .. } => None,
        }
    }
}

/// How a tool call its Harness changes but never said started shows, in
/// the Thread and on its card alike: of no kind, titled "A tool" and
/// running, unless the change says its title or how it stands.
pub fn unstarted(title: Option<&str>, status: Option<ToolStatus>) -> (ToolKind, &str, ToolStatus) {
    let status = status.unwrap_or(ToolStatus::Running);
    (ToolKind::Other, title.unwrap_or("A tool"), status)
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
            compacts: compacts(call.meta.as_ref()),
            call: call.tool_call_id.0.to_string(),
            title: call.title,
            tool: tool_kind(call.kind),
            status: tool_status(call.status),
            content: tool_content(Some(call.content), call.raw_output).unwrap_or_default(),
            places: places(call.locations),
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
                places: places(update.fields.locations.unwrap_or_default()),
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

/// Whether a tool call is its Harness compacting the context: Claude
/// Code's adapter says so as a call of its tool `compact` to a client that
/// does not declare ACP's own compaction updates, as the engine does not.
fn compacts(meta: Option<&acp::Meta>) -> bool {
    let tool = meta.and_then(|meta| meta.get("claudeCode")?.get("toolName"));
    tool.and_then(serde_json::Value::as_str) == Some("compact")
}

/// The files a tool call works on, as the Harness names them.
fn places(locations: Vec<acp::ToolCallLocation>) -> Vec<Place> {
    locations
        .into_iter()
        .map(|location| Place {
            path: location.path.display().to_string(),
            line: location.line,
        })
        .collect()
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
    fn claude_codes_compact_tool_call_is_a_compaction_and_no_other_is() {
        let call = |meta: Option<serde_json::Value>| {
            let call = acp::ToolCall::new("c", "Compact conversation").kind(acp::ToolKind::Think);
            let call = call.meta(meta.and_then(|meta| meta.as_object().cloned()));
            match said(acp::SessionUpdate::ToolCall(call)) {
                Some(Said::ToolStarted { compacts, .. }) => compacts,
                _ => panic!("a tool call starts"),
            }
        };
        assert!(call(Some(
            json!({ "claudeCode": { "toolName": "compact" } })
        )));
        assert!(!call(Some(json!({ "claudeCode": { "toolName": "Read" } }))));
        assert!(!call(None));
    }

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

    #[test]
    fn a_launch_receipt_is_no_report() {
        // As `claude-nested.jsonl:28` has it, cut short.
        let receipt = "Async agent launched successfully. (This tool result is internal metadata.)\nagentId: a7f20df87b6b088ad (internal ID - do not mention to user.)";
        assert_eq!(report(receipt), None);
        assert_eq!(
            report("<tools-used-before-summary>Read</tools-used-before-summary>\n"),
            None
        );
        assert_eq!(report("  "), None);
        assert_eq!(
            report("Async agents are fine"),
            Some("Async agents are fine".to_owned())
        );
    }

    #[test]
    fn a_reports_tools_tag_is_stripped_as_a_block_or_a_prefix() {
        // A block of its own, then the words (`claude-subagents.jsonl:57`).
        let blocks = [
            acp::ContentBlock::Text(acp::TextContent::new(
                "<tools-used-before-summary>Read</tools-used-before-summary>\n",
            )),
            acp::ContentBlock::Text(acp::TextContent::new("banana")),
        ];
        assert_eq!(report(&text_of_blocks(&blocks)).as_deref(), Some("banana"));
        // Both in one block, a blank line between (`claude-nested.jsonl:71`).
        let one = "<tools-used-before-summary>Bash, Read</tools-used-before-summary>\n\ncherry";
        assert_eq!(report(one).as_deref(), Some("cherry"));
        // Words with no tag stay as they are, and a tag later on is theirs.
        let plain = "It holds.\n<tools-used-before-summary>x</tools-used-before-summary>";
        assert_eq!(report(plain).as_deref(), Some(plain));
    }
}
