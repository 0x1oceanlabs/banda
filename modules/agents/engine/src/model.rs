//! The agents module's published language: its IDs, the facts it publishes
//! and the views a window reads. TypeScript types come from here.

use bandaso_kernel::{AgentId, Participant};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

bandaso_kernel::id!(
    /// A Thread: one conversation between a Person and an Agent.
    ThreadId,
    export_to = "agents/"
);
bandaso_kernel::id!(
    /// A Turn: one stretch of an Agent's work in a Thread.
    TurnId,
    export_to = "agents/"
);
bandaso_kernel::id!(
    /// One entry a Thread shows: a message, a thought, a tool call or a
    /// Question.
    ItemId,
    export_to = "agents/"
);

/// An Agent, as its text file describes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct AgentView {
    pub id: AgentId,
    pub name: String,
    /// The Harness it runs on, by its ID in the Harness list.
    pub harness: String,
    /// What its new Threads start with.
    pub settings: Settings,
}

/// How freely an Agent acts in a Thread (ADR 0003, decision 9). A Harness
/// that has modes of its own enforces the mode; for any other, the engine
/// answers the Harness's Questions by it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Mode {
    /// It asks before it changes anything.
    Supervised,
    /// It edits files without asking, and asks before anything else.
    AcceptEdits,
    /// It decides itself what to ask about.
    Auto,
    /// It never asks.
    #[default]
    FullAccess,
}

impl Mode {
    /// Its name, as the window shows it.
    pub fn name(self) -> &'static str {
        match self {
            Mode::Supervised => "Supervised",
            Mode::AcceptEdits => "Auto-accept edits",
            Mode::Auto => "Auto",
            Mode::FullAccess => "Full access",
        }
    }
}

/// A value of one of the Harness's options: a choice's ID, or on or off.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "agents/")]
pub enum OptionValue {
    Choice(String),
    Toggle(bool),
}

/// What a Thread runs with. A Person chooses it; the Harness gets it when
/// a turn starts.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Settings {
    #[serde(default)]
    pub mode: Mode,
    /// The Agent makes a plan before it changes anything.
    #[serde(default)]
    pub plan: bool,
    /// The Harness's options by their IDs, such as its model.
    #[serde(default)]
    pub options: BTreeMap<String, OptionValue>,
}

/// One of the Harness's options for a session, such as its model or
/// effort, as the Harness offers it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct HarnessOption {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// What kind of option it is, such as `model` or `thought_level`.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub value: OptionValue,
    /// The values to choose from; none for an option that is on or off.
    #[serde(default)]
    pub choices: Vec<OptionChoice>,
}

/// What the Harness offers a Person to choose in a Thread.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Offer {
    /// Its options, the model first. A Harness with modes of its own keeps
    /// them out of this list: the Thread's mode and plan stand for them.
    #[serde(default)]
    pub options: Vec<HarnessOption>,
    /// The Harness can plan before it changes anything.
    #[serde(default)]
    pub plans: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct OptionChoice {
    pub value: String,
    pub name: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A Harness this machine can run.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct HarnessView {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum TurnState {
    /// Waiting for the Agent's earlier turns.
    Queued,
    Running,
    /// The Agent finished.
    Done,
    /// A Person stopped it.
    Stopped,
    /// The Harness failed it or could not run it.
    Failed,
    /// The engine stopped while it ran.
    Interrupted,
}

/// Why a turn failed, so the Thread can offer what to do about it (ADR 0003,
/// decision 12). A Person's stop is a state of its own, not a failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "class", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Failure {
    /// The Harness needs its Person to sign in.
    SignIn,
    /// The account has used up what it may use for now.
    UsageLimit {
        /// When it may be used again, in milliseconds since the epoch, if
        /// the Harness said.
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        until: Option<i64>,
    },
    /// The Harness's process stopped, or could not start.
    HarnessStopped,
    /// The model's provider, or the Harness, reported an error.
    Provider,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct TurnView {
    pub id: TurnId,
    /// The message that asked for it.
    pub message: ItemId,
    pub state: TurnState,
    /// Why it ended, in plain words, when that is worth saying.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// What kind of failure it was, when the turn failed and that is known.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
}

/// What kind of action a tool call is, as the Harness says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum ToolStatus {
    Pending,
    Running,
    Done,
    Failed,
}

/// One answer a Question offers. The Harness wrote it; Bandaso passes it on
/// unchanged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Choice {
    pub id: String,
    pub name: String,
    pub allows: bool,
    /// The Harness keeps this answer for next time.
    #[serde(default)]
    pub always: bool,
}

/// One field of a Question's form. The Harness wrote it; Bandaso shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Field {
    pub id: String,
    /// Its label: the Harness's title, or else its ID.
    pub title: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// A Person must fill it in to submit the form.
    #[serde(default)]
    pub required: bool,
    pub input: Input,
}

/// What a field takes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Input {
    Text {
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    /// One of the choices.
    Choice {
        choices: Vec<OptionChoice>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    /// Any of the choices.
    Choices {
        choices: Vec<OptionChoice>,
        #[serde(default)]
        default: Vec<String>,
    },
    Number {
        /// Only whole numbers.
        integer: bool,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        minimum: Option<serde_json::Number>,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        maximum: Option<serde_json::Number>,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<serde_json::Number>,
    },
    Toggle {
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<bool>,
    },
}

/// What a Person filled in one field.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "agents/")]
pub enum FieldValue {
    Text(String),
    Toggle(bool),
    Number(#[ts(type = "number")] serde_json::Number),
    Choices(Vec<String>),
}

/// What a Person filled in a form, by the fields' IDs.
pub type Values = BTreeMap<String, FieldValue>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum QuestionState {
    Open,
    Answered,
    /// It can no longer be answered: its turn ended first.
    Closed,
}

/// What one Thread entry holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Body {
    Message {
        text: String,
    },
    Thought {
        text: String,
    },
    Tool {
        title: String,
        tool: ToolKind,
        status: ToolStatus,
    },
    Question {
        title: String,
        choices: Vec<Choice>,
        /// A form to fill in, when the Harness asks for more than a choice.
        /// Its choices then submit it or skip it.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        form: Option<Vec<Field>>,
        state: QuestionState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        answer: Option<String>,
        /// What the Person filled in the form.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        values: Option<Values>,
    },
    /// A line from Bandaso about the Thread, such as a session the
    /// Harness could not continue.
    Notice {
        text: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Item {
    pub id: ItemId,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<TurnId>,
    pub author: Participant,
    #[ts(type = "number")]
    pub at: i64,
    pub body: Body,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadSummary {
    pub id: ThreadId,
    pub agent: AgentId,
    /// The start of its first message.
    pub title: String,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// A Thread as a window first loads it. It is current at `at`; the window
/// then follows the Thread's events after `at`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadView {
    #[ts(type = "number")]
    pub at: i64,
    pub thread: ThreadSummary,
    pub items: Vec<Item>,
    pub turns: Vec<TurnView>,
    pub settings: Settings,
    /// What the Harness last offered in this Thread.
    pub offer: Offer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadList {
    #[ts(type = "number")]
    pub at: i64,
    pub threads: Vec<ThreadSummary>,
}

/// What the agents module publishes, version 1: each fact is an Event's
/// `kind` and `payload`. A fact says what happened, in its own fields, and
/// copies no view: the Event around it carries who and when. A Thread's
/// facts have the Thread as their subject, so a Pane follows one Thread.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "payload")]
#[ts(export, export_to = "agents/")]
pub enum Fact {
    #[serde(rename = "agent.created")]
    AgentCreated {
        agent: AgentId,
        name: String,
        harness: String,
    },
    #[serde(rename = "thread.started")]
    ThreadStarted {
        thread: ThreadId,
        agent: AgentId,
        title: String,
    },
    /// A message to the Agent, which queues a turn.
    #[serde(rename = "message.posted")]
    MessagePosted {
        item: ItemId,
        turn: TurnId,
        text: String,
    },
    #[serde(rename = "turn.started")]
    TurnStarted { turn: TurnId },
    #[serde(rename = "turn.ended")]
    TurnEnded {
        turn: TurnId,
        state: TurnState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<Failure>,
    },
    /// A Person tries a failed turn's message again, in a new turn.
    #[serde(rename = "turn.queued")]
    TurnQueued { turn: TurnId, message: ItemId },
    /// The Thread's settings changed, by a Person or by the Harness.
    #[serde(rename = "thread.configured")]
    ThreadConfigured {
        thread: ThreadId,
        settings: Settings,
    },
    /// The Harness offers this in the Thread now.
    #[serde(rename = "thread.offered")]
    ThreadOffered { thread: ThreadId, offer: Offer },
    /// More of the Agent's reply. The first piece of an item starts it.
    #[serde(rename = "reply.grew")]
    ReplyGrew {
        item: ItemId,
        turn: TurnId,
        text: String,
    },
    #[serde(rename = "thought.grew")]
    ThoughtGrew {
        item: ItemId,
        turn: TurnId,
        text: String,
    },
    #[serde(rename = "tool.started")]
    ToolStarted {
        item: ItemId,
        turn: TurnId,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
    },
    #[serde(rename = "tool.changed")]
    ToolChanged {
        item: ItemId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<ToolStatus>,
    },
    #[serde(rename = "question.asked")]
    QuestionAsked {
        item: ItemId,
        turn: TurnId,
        title: String,
        choices: Vec<Choice>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        form: Option<Vec<Field>>,
    },
    #[serde(rename = "question.answered")]
    QuestionAnswered {
        item: ItemId,
        choice: String,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        values: Option<Values>,
    },
    /// It can no longer be answered.
    #[serde(rename = "question.closed")]
    QuestionClosed { item: ItemId },
    #[serde(rename = "notice.posted")]
    NoticePosted {
        item: ItemId,
        turn: TurnId,
        text: String,
    },
}

/// The version of every fact's payload today.
pub const VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::VERSION;

    /// Writes `VERSION` beside the generated types, as ts-rs writes them,
    /// so a window reads the facts' version from the Rust.
    #[test]
    fn export_the_fact_version() {
        let Ok(dir) = std::env::var("TS_RS_EXPORT_DIR") else {
            return;
        };
        let file = std::path::Path::new(&dir).join("agents/VERSION.ts");
        let text = format!(
            "// Written by modules/agents/engine/src/model.rs. Do not edit this file manually.\n\n\
             /** The newest version of the agents module's facts. */\n\
             export const VERSION = {VERSION}\n"
        );
        if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, text).unwrap();
        }
    }
}
