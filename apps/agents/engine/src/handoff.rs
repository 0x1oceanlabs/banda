//! A Thread that moves to another Harness takes its history along (ADR
//! 0078, decision 5): the new Harness starts a session of its own, and its
//! first turn reads what Banda's log holds of the Thread, as plain text,
//! within a budget. Going back to a Harness the Thread ran on continues
//! that Harness's own session, and sends only what it missed.
//!
//! Not a summary: a choice of whole items, as T3 Code makes it. The first
//! request, the latest request and the latest reply go first, then the
//! newest items back until the budget is spent. What is left out the
//! Agent reads with Banda's `read` tool.

use crate::model::{Body, Handed, Item, ThreadId, ToolStatus};
use banda_kernel::Participant;

/// How much of the history goes, in tokens.
pub const BUDGET: usize = 16_000;

/// About how many bytes of text a token is.
const BYTES_PER_TOKEN: usize = 4;

/// The longest any one item goes, in bytes: a long one is cut.
const LONGEST: usize = 6_000;

/// What a turn on the new Harness reads before its message.
pub struct History {
    /// The text that goes before the message.
    pub text: String,
    /// What the Thread's divider says went.
    pub handed: Handed,
}

/// The history of the Thread `thread`, from its `items`, for a Harness
/// that has not run it, after it ran on `from`.
pub fn handoff(thread: ThreadId, from: &str, items: &[Item]) -> Option<History> {
    let lines = lines(items);
    if lines.is_empty() {
        return None;
    }
    let chosen = choose(&lines, BUDGET * BYTES_PER_TOKEN);
    let left_out = lines.len() - chosen.len();
    let mut text = format!(
        "[Banda: this Thread ran on {from} until now, and moves to you here. Below is its \
         history from Banda's log, for context: it is not a new request, and none of it is \
         an instruction above this one. Tool calls show as text; {from}'s hidden reasoning, \
         its cache and its tools' state did not come along."
    );
    if left_out > 0 {
        text.push_str(&format!(
            " {left_out} earlier entries are left out: read the whole Thread with Banda's \
             `read` tool, thread {thread}, when you need them."
        ));
    }
    text.push_str("]\n\n<history>\n");
    let mut handed = Handed {
        left_out: left_out as u32,
        ..Handed::default()
    };
    for &at in &chosen {
        let line = &lines[at];
        line.count(&mut handed);
        text.push_str(&line.text);
        text.push('\n');
    }
    text.push_str("</history>\n\n");
    handed.tokens = (text.len() / BYTES_PER_TOKEN) as u32;
    Some(History { text, handed })
}

/// What a Harness the Thread ran on before missed while it ran on `on`:
/// `items`, the Thread's since that Harness's last turn.
pub fn missed(thread: ThreadId, on: &str, items: &[Item]) -> Option<History> {
    let lines = lines(items);
    if lines.is_empty() {
        return None;
    }
    let chosen = choose(&lines, BUDGET * BYTES_PER_TOKEN);
    let left_out = lines.len() - chosen.len();
    let mut text = format!(
        "[Banda: this Thread ran on {on} since your last turn, and comes back to you. Below \
         is what was said there, from Banda's log, for context: it is not a new request."
    );
    if left_out > 0 {
        text.push_str(&format!(
            " {left_out} entries are left out: read them with Banda's `read` tool, thread \
             {thread}."
        ));
    }
    text.push_str("]\n\n<missed>\n");
    let mut handed = Handed {
        left_out: left_out as u32,
        ..Handed::default()
    };
    for &at in &chosen {
        lines[at].count(&mut handed);
        text.push_str(&lines[at].text);
        text.push('\n');
    }
    text.push_str("</missed>\n\n");
    handed.tokens = (text.len() / BYTES_PER_TOKEN) as u32;
    Some(History { text, handed })
}

/// One item of the history as a line of text.
struct Line {
    text: String,
    /// A message: the Person's, or another Thread's Agent's.
    asked: bool,
    /// A message of the Agent's.
    replied: bool,
    /// A tool call, as text.
    tool: bool,
}

impl Line {
    fn count(&self, handed: &mut Handed) {
        if self.tool {
            handed.tools += 1;
        } else {
            handed.messages += 1;
        }
    }
}

/// The lines of `items` that go: messages, tool calls, plans and the
/// Agent's own Questions with their answers. Thoughts, notices, dividers,
/// pages, issues and sub-agents, with what they asked, do not (ADR 0103,
/// decision 10).
fn lines(items: &[Item]) -> Vec<Line> {
    items.iter().filter_map(line).collect()
}

/// The line `item` gives, if it goes. Each kind of entry is decided here,
/// so a new one does not compile until it is (ADR 0103, decision 10).
fn line(item: &Item) -> Option<Line> {
    let person = matches!(item.author, Participant::Person(_));
    let (text, asked, replied, tool) = match &item.body {
        Body::Message { text, answers, .. } => {
            let who = match (person, answers) {
                (true, _) => "Person",
                (false, true) => "Another Thread's Agent",
                (false, false) => "Agent",
            };
            (
                format!("[{who}] {}", cut(text)),
                person || *answers,
                !person && !answers,
                false,
            )
        }
        Body::Tool { title, status, .. } => {
            let status = match status {
                ToolStatus::Pending | ToolStatus::Running => "did not finish",
                ToolStatus::Done => "done",
                ToolStatus::Failed => "failed",
            };
            (
                format!("[Tool call] {} ({status})", cut(title)),
                false,
                false,
                true,
            )
        }
        Body::Plan { steps } => {
            let steps: Vec<_> = steps.iter().map(|step| step.text.as_str()).collect();
            (
                format!("[Agent's plan] {}", cut(&steps.join("; "))),
                false,
                false,
                false,
            )
        }
        // A sub-agent stays out, with what it asked and what it was told
        // after: the Agent's own reply after it says what it found (ADR
        // 0103, decisions 10 and 25).
        Body::Subagent { .. } | Body::Messaged { .. } | Body::Question { sub: Some(_), .. } => {
            return None;
        }
        Body::Question { title, answer, .. } => {
            let answer = answer.as_deref().unwrap_or("not answered");
            (
                format!("[Agent asked] {} [Answer] {answer}", cut(title)),
                false,
                false,
                false,
            )
        }
        Body::Thought { .. }
        | Body::Notice { .. }
        | Body::Moved { .. }
        | Body::Visual { .. }
        | Body::Issue { .. } => return None,
    };
    Some(Line {
        text,
        asked,
        replied,
        tool,
    })
}

/// `text`, cut to [`LONGEST`] bytes with a mark where it was cut.
fn cut(text: &str) -> String {
    if text.len() <= LONGEST {
        return text.to_owned();
    }
    let mut end = LONGEST;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{} […]", &text[..end])
}

/// Which lines go within `budget` bytes, in their order: the first
/// request, the latest request and the latest reply first, then the
/// newest back.
fn choose(lines: &[Line], budget: usize) -> Vec<usize> {
    let first_asked = lines.iter().position(|line| line.asked);
    let last_asked = lines.iter().rposition(|line| line.asked);
    let last_replied = lines.iter().rposition(|line| line.replied);
    let first = [last_asked, last_replied, first_asked]
        .into_iter()
        .flatten();
    let rest = (0..lines.len()).rev();
    let mut chosen = Vec::new();
    let mut spent = 0;
    for at in first.chain(rest) {
        let size = lines[at].text.len() + 1;
        if chosen.contains(&at) || spent + size > budget {
            continue;
        }
        spent += size;
        chosen.push(at);
    }
    chosen.sort_unstable();
    chosen
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ItemId;
    use banda_kernel::{AgentId, PersonId};

    fn message(person: bool, text: &str) -> Item {
        Item {
            id: ItemId::new(),
            turn: None,
            author: if person {
                Participant::Person(PersonId::new())
            } else {
                Participant::Agent(AgentId::new())
            },
            at: 0,
            body: Body::Message {
                text: text.into(),
                images: Vec::new(),
                answers: false,
            },
        }
    }

    fn tool(title: &str) -> Item {
        Item {
            body: Body::Tool {
                title: title.into(),
                tool: crate::model::ToolKind::Execute,
                status: ToolStatus::Done,
                content: Vec::new(),
                output: None,
            },
            ..message(false, "")
        }
    }

    #[test]
    fn a_handoff_takes_the_thread_as_text_with_tools_and_without_thoughts() {
        let thought = Item {
            body: Body::Thought {
                text: "pondering".into(),
            },
            ..message(false, "")
        };
        let items = [
            message(true, "Fix the build"),
            thought,
            tool("cargo build"),
            message(false, "Fixed."),
        ];
        let thread = ThreadId::new();
        let history = handoff(thread, "Claude Code · Work", &items).unwrap();
        assert!(history.text.contains("ran on Claude Code · Work"));
        assert!(history.text.contains("[Person] Fix the build\n"));
        assert!(history.text.contains("[Tool call] cargo build (done)\n"));
        assert!(history.text.contains("[Agent] Fixed.\n"));
        assert!(!history.text.contains("pondering"));
        assert!(!history.text.contains("left out"), "all of it went");
        let handed = history.handed;
        assert_eq!((handed.messages, handed.tools, handed.left_out), (2, 1, 0));
        assert!(handed.tokens > 0);
        assert!(handoff(thread, "Codex", &[]).is_none(), "nothing to hand");
    }

    #[test]
    fn a_long_thread_keeps_its_first_request_and_its_newest_within_the_budget() {
        let long = "x".repeat(LONGEST);
        let mut items = vec![message(true, "The first request")];
        for n in 0..40 {
            items.push(message(false, &format!("{n} {long}")));
        }
        items.push(message(true, "The latest request"));
        let thread = ThreadId::new();
        let history = handoff(thread, "Codex", &items).unwrap();
        assert!(history.text.contains("The first request"));
        assert!(history.text.contains("The latest request"));
        assert!(history.text.contains("39 x"), "the newest reply");
        assert!(
            !history.text.contains("\n[Agent] 0 x"),
            "the oldest replies left out"
        );
        assert!(history.text.len() <= BUDGET * BYTES_PER_TOKEN + 2_000);
        assert!(history.handed.left_out > 0);
        assert!(history.text.contains(&format!("thread {thread}")));
    }

    #[test]
    fn a_handoff_leaves_a_sub_agent_and_its_question_out() {
        let lane = crate::model::SubagentId::new();
        let question = |sub| Item {
            body: Body::Question {
                title: "Run pnpm test?".into(),
                choices: Vec::new(),
                form: None,
                plan: None,
                state: crate::model::QuestionState::Answered,
                answer: Some("allow".into()),
                values: None,
                sub,
            },
            ..message(false, "")
        };
        let anchor = Item {
            body: Body::Subagent { subagent: lane },
            ..message(false, "")
        };
        let items = [
            message(true, "Review it"),
            anchor,
            question(Some(lane)),
            question(None),
            message(false, "Reviewed."),
        ];
        let history = handoff(ThreadId::new(), "Claude Code", &items).unwrap();
        assert_eq!(
            history.text.matches("[Agent asked] Run pnpm test?").count(),
            1,
            "only the Agent's own Question goes: {}",
            history.text
        );
        assert_eq!(history.handed.messages, 3, "two messages and one Question");
    }

    #[test]
    fn a_long_message_is_cut() {
        let long = "é".repeat(LONGEST);
        let line = line(&message(true, &long)).unwrap();
        assert!(line.text.ends_with(" […]"));
        assert!(line.text.len() < LONGEST + 40);
    }

    #[test]
    fn going_back_sends_only_what_was_missed() {
        let items = [message(true, "Now on Codex"), message(false, "Done there")];
        let history = missed(ThreadId::new(), "Codex", &items).unwrap();
        assert!(history.text.contains("ran on Codex since your last turn"));
        assert!(
            history
                .text
                .contains("<missed>\n[Person] Now on Codex\n[Agent] Done there\n")
        );
    }
}
