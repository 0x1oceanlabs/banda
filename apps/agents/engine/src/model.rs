//! The agents module's published language: its IDs, the facts it publishes
//! and the views a window reads. TypeScript types come from here.

use banda_kernel::ProjectId;
use banda_kernel::{AgentId, Participant};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

banda_kernel::id!(
    /// A Thread: one conversation between a Person and an Agent.
    ThreadId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// A Turn: one stretch of an Agent's work in a Thread.
    TurnId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// One entry a Thread shows: a message, a thought, a tool call or a
    /// Question.
    ItemId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// A sub-agent: a Harness's helper at work inside a Thread, kept as a
    /// lane of it (ADR 0103, decision 4).
    SubagentId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// A Crew: the sub-agents one Thread set to work together in phases,
    /// what Claude Code calls a workflow (ADR 0103, decision 2).
    CrewId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// An image a Thread item carries.
    ImageId,
    export_to = "agents/"
);
banda_kernel::id!(
    /// A Visual: a page an Agent showed in its Thread (ADR 0037).
    VisualId,
    export_to = "agents/"
);

/// An image in a message or tool result. Its bytes are kept apart, in
/// the Project's data, `projects/<id>/images/`, and read with `agents.image`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Image {
    pub id: ImageId,
    /// Its kind: `image/png`, `image/jpeg`, `image/gif` or `image/webp`.
    pub mime: String,
    /// How large it is, in bytes.
    pub size: u32,
    /// The name of the file it came from, if it had one.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// How freely an Agent acts in a Thread (ADR 0003, decision 9). A Harness
/// that has modes of its own enforces the mode; for any other, the engine
/// answers the Harness's Questions by it.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS, schemars::JsonSchema,
)]
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, schemars::JsonSchema)]
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

impl HarnessOption {
    /// Whether `value` is one it takes: one of its choices, or on or off
    /// for one that has none.
    pub fn takes(&self, value: &OptionValue) -> bool {
        match value {
            OptionValue::Choice(choice) => self.choices.iter().any(|c| c.value == *choice),
            OptionValue::Toggle(_) => self.choices.is_empty(),
        }
    }
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
    /// What a message can start with to have the Harness run a command,
    /// such as `/compact`.
    #[serde(default)]
    pub slash_commands: Vec<SlashCommand>,
    /// The skills a message can name anywhere with `$` and a skill's
    /// name, as Codex reads it (ADR 0015, decision 6).
    #[serde(default)]
    pub skills: Vec<Skill>,
    /// The Harness takes no images: a message to it carries text alone.
    #[serde(default)]
    pub no_images: bool,
    /// In plain words, that the Person's CLI is older than the Harness
    /// supports.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outdated: Option<String>,
}

/// What the Harness runs when a message starts with `/` and its name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct SlashCommand {
    /// Its name, without the `/`.
    pub name: String,
    /// What it does, in the Harness's words.
    pub description: String,
    /// What to write after it, when it takes something.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// What the Harness can do as a message asks with `$` and its name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Skill {
    /// Its name, without the `$`.
    pub name: String,
    /// What it does, in the Harness's words.
    pub description: String,
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
    /// A Person took its message back before it ran.
    Withdrawn,
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
    /// When it began to run, in ms since the epoch. A turn from before
    /// Banda kept it has none.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started: Option<i64>,
    /// When it stopped running, the same way.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended: Option<i64>,
    /// The Harness entry, the account, it ran on (ADR 0078, decision 2):
    /// its Thread's as it started. A turn that has not run, or ran before
    /// Banda kept it, has none.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    /// It made a plan before changing anything: its Thread was in plan
    /// mode when it was asked for.
    #[ts(as = "Option<bool>", optional)]
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub plan: bool,
    /// What a Person may do with it now.
    #[serde(default)]
    pub can: Can,
}

/// Who opened a turn, and how (ADR 0018, decision 2). The turn keeps it,
/// so "by itself" is read from it, not from the turn's message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Opener {
    /// A Person's message.
    Person,
    /// A Person tried a turn's message again.
    Retry,
    /// A message its turn could not take waits for a turn of its own.
    Requeue,
    /// The Agent went on by itself between turns.
    ByItself,
    /// Another Thread's Agent wrote to this one; when the turn ends, its
    /// last reply goes back there (ADR 0019, decision 4).
    Asked,
    /// Another Thread's Agent answers what this Thread's Agent asked.
    Answered,
}

impl Opener {
    /// The Agent went on by itself between turns.
    pub fn by_itself(self) -> bool {
        self == Opener::ByItself
    }

    /// It is a Person's word: it may join the turn that runs and let a
    /// held queue go on. Another Thread's Agent's message only waits.
    /// ADR 0018's writer (step 3) gives it to `rules::next` as a fact.
    pub fn by_person(self) -> bool {
        !matches!(self, Opener::ByItself | Opener::Asked | Opener::Answered)
    }
}

/// What a Person may do with a turn now, as the rules its commands ask
/// say (ADR 0014, decision 2). The window shows only what this allows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Can {
    /// Stop it: it waits or runs (`agents.stop`).
    pub stop: bool,
    /// Try its message again: it failed or was cut short, it is the
    /// Thread's latest, and a Person asked for it (`agents.retry`).
    pub retry: bool,
    /// Change its message: it waits, and no turn ran the message yet
    /// (`agents.edit`).
    pub edit: bool,
    /// Take its message back, or send it now: it waits (`agents.withdraw`,
    /// `agents.steer`).
    pub withdraw: bool,
    /// Take a message sent now: it runs, the queue is not held, and a
    /// Person asked for it (`agents.send` with `steer`).
    pub steer: bool,
    /// Fork its Thread at its end: it ran and ended, and no turn of the
    /// Thread runs (`agents.fork`).
    pub fork: bool,
    /// Take its Thread back to before its message, which a Person sent
    /// and it ran first, to edit it: it ended, and nothing runs or waits
    /// in the Thread (`agents.rewind`).
    pub rewind: bool,
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

/// One answer a Question offers. The Harness wrote it; Banda passes it on
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

/// One field of a Question's form. The Harness wrote it; Banda shows it.
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
    /// What a Person types in it reaches the Harness and nothing else: the
    /// Thread keeps a mask.
    #[serde(default)]
    pub secret: bool,
    pub input: Input,
    /// Of a field of choices, the ID of the form's text field where a
    /// Person answers it in their own words, as Claude Code's
    /// `question_0_custom` answers `question_0`: in place of a choice, or
    /// besides those picked of several. That field stays in the form, for
    /// a window that does not pair them.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other: Option<String>,
}

/// What text a field takes, when the Harness says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum TextFormat {
    Email,
    Uri,
    Date,
    DateTime,
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
        /// The fewest and the most characters it takes.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shortest: Option<u32>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        longest: Option<u32>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<TextFormat>,
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
        /// The fewest and the most it takes.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fewest: Option<u32>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        most: Option<u32>,
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

/// What a tool call shows besides its title.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum ToolContent {
    /// The bytes are kept in the Project's images folder, as for messages.
    Image {
        image: Image,
    },
    Text {
        text: String,
    },
    /// A file's text before and after the change; none before for a new
    /// file.
    Diff {
        path: String,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        old: Option<String>,
        new: String,
    },
    /// Where what its command prints shows: the tool call's output.
    Terminal,
}

/// One step of an Agent's plan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct PlanStep {
    pub text: String,
    pub state: StepState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum StepState {
    Pending,
    InProgress,
    Done,
}

/// What the Agent has used in its session: its context window, in tokens,
/// `used` of `size`; and what it cost so far, when the Harness says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Usage {
    pub used: u32,
    pub size: u32,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<Cost>,
}

/// An amount of money, in a currency's ISO 4217 code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Cost {
    pub amount: serde_json::Number,
    pub currency: String,
}

/// What a command printed, as far as Banda keeps it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Output {
    pub text: String,
    /// How the command ended, once it has.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<Exit>,
    /// It printed more than Banda keeps.
    #[serde(default)]
    pub cut: bool,
}

/// How a command ended: its exit code, or the signal that stopped it;
/// neither when the Harness does not know.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Exit {
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

/// What one Thread entry holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Body {
    Message {
        text: String,
        #[serde(default)]
        images: Vec<Image>,
        /// It answers what this Thread's Agent asked another Thread's
        /// (ADR 0019); its author is that Thread's Agent.
        #[ts(as = "Option<bool>", optional)]
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        answers: bool,
    },
    Thought {
        text: String,
    },
    Tool {
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        /// What it shows besides its title, as the Harness last said.
        #[serde(default)]
        content: Vec<ToolContent>,
        /// What the command printed.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<Output>,
    },
    /// What the Agent means to do in this turn, step by step.
    Plan {
        steps: Vec<PlanStep>,
    },
    Question {
        title: String,
        choices: Vec<Choice>,
        /// A form to fill in, when the Harness asks for more than a choice.
        /// Its choices then submit it or skip it.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        form: Option<Vec<Field>>,
        /// The plan the Agent asks to carry out, when it asks to leave plan
        /// mode.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plan: Option<String>,
        state: QuestionState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        answer: Option<String>,
        /// What the Person filled in the form.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        values: Option<Values>,
        /// The sub-agent that asks, when it is not the Agent itself. Its
        /// Question is an entry of the Thread, not of its lane, so the
        /// Thread asks (ADR 0103, decision 8).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
        /// The Crew whose agent asks, between turns, while it is the one
        /// Crew at work (ADR 0103, decision 28).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crew: Option<CrewId>,
        /// The Crew Claude asks to start, as its script's `meta` says it
        /// (ADR 0103, decision 30).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<CrewStart>,
    },
    /// A line from Banda about the Thread, such as a session the
    /// Harness could not continue.
    Notice {
        text: String,
    },
    /// The Thread moved from the Harness entry `from` to `to` before this
    /// turn (ADR 0078): the Thread's divider.
    Moved {
        from: String,
        to: String,
        how: Moved,
    },
    /// A page the Agent showed its Person (ADR 0037): read with
    /// `agents.visual`, it shows as tall as `heights` says for its width,
    /// or `height` pixels, till it says its own.
    Visual {
        visual: VisualId,
        title: String,
        height: u32,
        /// How tall the page laid out at each of several widths, as the
        /// window found when it showed; none without a window.
        #[serde(default)]
        heights: Vec<Fit>,
    },
    /// An issue about a Problem of Banda's the Agent drafted, for its
    /// Person to send to Banda on GitHub, or not (ADR 0039, decision 3).
    Issue {
        fingerprint: String,
        title: String,
        body: String,
        /// The issue it comments on instead, which has the fingerprint.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comment_on: Option<u32>,
        state: IssueState,
        /// Where it went, once it did.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    /// Where a sub-agent started, which shows it (ADR 0103, decision 15):
    /// its record is the Thread's `subagents`, its work its own lane.
    Subagent {
        subagent: SubagentId,
    },
    /// A message its parent sent sub-agent `subagent` after its brief, as
    /// Claude's SendMessage does (ADR 0103, decision 25): where its parent
    /// sent it, the Thread's turn or its parent's lane, and in its own
    /// lane, where it came among its work. `text` is the message's words,
    /// none when the Harness did not send them, as for one queued for a
    /// sub-agent at work.
    Messaged {
        subagent: SubagentId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// Where a Crew started, which shows it (ADR 0103, decision 18): its
    /// record is the Thread's `crews`.
    Crew {
        crew: CrewId,
    },
}

/// How a Thread went on as it moved (ADR 0078).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Moved {
    /// To another account of its Harness, in the same session: only the
    /// prompt cache and the hidden reasoning are lost (decision 4).
    Same,
    /// To another Harness, which started a session of its own with the
    /// history Banda handed it (decision 5).
    Handoff {
        #[serde(flatten)]
        handed: Handed,
    },
    /// Back to a Harness the Thread ran on before, which goes on with its
    /// own session and was handed only what it missed.
    Back {
        #[serde(flatten)]
        handed: Handed,
    },
}

/// What of a Thread's history went to the Harness it moved to.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Handed {
    /// Messages, plans and Questions that went.
    pub messages: u32,
    /// Tool calls that went, as text.
    pub tools: u32,
    /// About how many tokens went.
    pub tokens: u32,
    /// Entries left out, which the Agent reads with `read`.
    pub left_out: u32,
}

/// Where an issue the Agent drafted stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum IssueState {
    /// It waits for the Person.
    Drafted,
    /// `gh` filed it, or its comment.
    Sent,
    /// GitHub opened in the browser with it, for the Person to send there.
    Opened,
    /// The Person did not send it.
    Cancelled,
}

/// How tall a page lays out at a width, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Fit {
    pub width: u32,
    pub height: u32,
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
    /// The Harness it runs on, by its ID in the Harness list; chosen when
    /// it starts, it stays (ADR 0006). Empty for a Thread from before
    /// Threads named theirs whose Agent's file is gone.
    pub harness: String,
    /// The start of its first message, until its Person renames it (ADR
    /// 0077).
    pub title: String,
    #[ts(type = "number")]
    pub updated_at: i64,
    /// Its title before the Person last renamed it, which "Previous
    /// title" brings back. None before a rename.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub was: Option<String>,
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
    /// How full the Agent's context is, as the Harness last said.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    /// Its queue waits for a Person: a stop or a restart held it, and
    /// sending or going on lets it go.
    #[serde(default)]
    pub held: bool,
    /// The Thread it was forked from (`agents.fork`), if it was.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<ThreadId>,
    /// It is in Full access its Person chose where the fence does not
    /// hold (ADR 0083): it runs so, its Agent acting as the Person.
    #[ts(optional, as = "Option<bool>")]
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unfenced: bool,
    /// Its sub-agents, nested ones with their parent, in the order they
    /// started (ADR 0103, decision 10). Left out when it has none, so a
    /// window and an engine from before read the same view.
    #[ts(optional, as = "Option<Vec<Subagent>>")]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subagents: Vec<Subagent>,
    /// The calls of its sub-agents that edit, delete or move files, in the
    /// order they came: of a lane's entries only these come with the
    /// Thread, so its turns' changes count them (ADR 0103, decision 8).
    #[ts(optional, as = "Option<Vec<Item>>")]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<Item>,
    /// Its Crews, in the order they started (ADR 0103, decision 10). Left
    /// out when it has none.
    #[ts(optional, as = "Option<Vec<Crew>>")]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crews: Vec<Crew>,
}

/// Where a sub-agent's work stands, in Banda's words (ADR 0103, decision
/// 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum SubagentState {
    /// It works.
    Running,
    /// It waits for its Person to answer its Question.
    Asks,
    /// It finished.
    Done,
    /// It ended without finishing what it was given.
    Failed,
    /// The Person, its Thread's Agent or its parent stopped it.
    Stopped,
    /// A Crew's agent waits for a slot. No lane is in it before Crews come
    /// (ADR 0103, step 4).
    Queued,
    /// It was cut off from Banda: by a restart, its Harness stopping, or
    /// Banda letting go of its process. A state the Harness says later
    /// undoes it.
    Lost,
}

impl SubagentState {
    /// Whether it is at work: it runs or asks. Fork and rewind wait for
    /// such a lane, as for a turn that runs (ADR 0103, Open questions).
    pub fn works(self) -> bool {
        matches!(self, SubagentState::Running | SubagentState::Asks)
    }
}

/// A sub-agent as its Thread keeps it: a lane of the Thread, with a slice
/// of its entries of its own (ADR 0103, decisions 4 and 10). It keeps no
/// counts and nothing of what it does now: those come from its entries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Subagent {
    pub id: SubagentId,
    /// The turn it started in; a nested one's is its root's, so a rewind
    /// takes a whole tree with its turn.
    pub turn: TurnId,
    /// The sub-agent that started it, when one did.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<SubagentId>,
    /// What its parent calls it, as the Harness says; empty once the
    /// Harness cleared it.
    pub title: String,
    /// What it is for, as the Harness says: "Explore", "general-purpose".
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// The model it runs on, when the Harness says.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub state: SubagentState,
    /// Why it ended as it did, in plain words, when that is worth saying.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// It may be stopped alone, as the Harness allows
    /// (`capabilities.cancel`).
    pub can_stop: bool,
    /// When it started, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub started: i64,
    /// When it ended, the same way; none while it is at work.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended: Option<i64>,
    /// The brief it was given as it started.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// What it reported back as it went idle.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
    /// The Crew it works in, when Claude's raw frames tie it to one by its
    /// task (ADR 0103, decision 10).
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crew: Option<CrewId>,
    /// Its phase in that Crew, by the phase's index.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<u16>,
    /// It runs in the background: its parent's turn need not wait for it.
    #[ts(optional, as = "Option<bool>")]
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub background: bool,
}

/// A Crew as its Thread keeps it (ADR 0103, decisions 2, 9 and 10): its
/// script's title, description and phases, and each agent the script
/// called so far, as Claude's raw frames last said them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Crew {
    pub id: CrewId,
    /// The turn it started in.
    pub turn: TurnId,
    /// Its script's name: "audit-routes".
    pub title: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Its phases, as its script names them, in order.
    pub phases: Vec<Phase>,
    /// The agents its script called, by phase, each in the order of its
    /// index there; a phase's agents grow as the script calls them.
    pub agents: Vec<CrewAgent>,
    pub state: CrewState,
    /// Why it ended as it did, when that is worth saying.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// When it started, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub started: i64,
    /// When it ended, the same way; none while it works.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended: Option<i64>,
    /// How many tokens its agents used, as Claude last said.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    /// What its script last logged, when a frame carries it.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
    /// Its script, for View script.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// What it gave back as it ended: its output file, read once, at most
    /// 64 KB. None when it gave none.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// The turn Claude went on with by itself after it ended, once its
    /// usage names the Crew's run.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub went_on: Option<TurnId>,
}

/// Where a Crew stands, in Banda's words (ADR 0103, decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum CrewState {
    /// Its script runs.
    Working,
    /// Its script finished.
    Done,
    /// Its script failed.
    Failed,
    /// It was stopped: by Claude, or by the Thread's Stop.
    Stopped,
    /// It was cut off from Banda, as a sub-agent is (decision 3).
    Lost,
}

impl CrewState {
    /// Whether it works.
    pub fn works(self) -> bool {
        self == CrewState::Working
    }
}

/// One step of a Crew, as its script names it: "Scan", "Fix", "Verify".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Phase {
    /// From 1, as Claude counts them.
    pub index: u16,
    pub title: String,
    /// What the script's `meta` says the phase does.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One agent a Crew's script called, as Claude's raw frames say it. It is
/// no lane: its work is in Claude's transcript (ADR 0103, decision 22).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CrewAgent {
    /// Its place in its phase, from 1; an agent of a pipeline keeps it from
    /// phase to phase.
    pub index: u32,
    pub label: String,
    /// Its phase, by the phase's index.
    pub phase: u16,
    /// Queued while it waits for a slot.
    pub state: SubagentState,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Which try this is, from 1.
    pub attempt: u16,
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    /// How many tool calls it made.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<u32>,
    /// How long it took, in milliseconds.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub took: Option<i64>,
    /// When it started, in milliseconds since the epoch; none while queued.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started: Option<i64>,
    /// The start of its brief.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// The start of what it gave back.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// What it last did: its last tool and what that worked on.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<String>,
    /// Why it failed or stopped, as Claude says.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// Its lane, when it is one of the Thread's sub-agents.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<SubagentId>,
}

/// A Crew Claude asks to start, as its script's `meta` says it (ADR 0103,
/// decision 30): what the Question to start it shows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CrewStart {
    pub title: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub phases: Vec<Phase>,
    /// The script, for View script.
    pub script: String,
}

/// A Crew as its Pane reads it (`agents.crew`), current at `at`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CrewView {
    #[ts(type = "number")]
    pub at: i64,
    /// The Thread it works in.
    pub thread: ThreadId,
    pub crew: Crew,
    /// What its agents did between turns, as the Thread shows it too:
    /// their calls and the Questions they asked.
    pub items: Vec<Item>,
}

/// A sub-agent as its Pane, or its row opened in place, reads it
/// (`agents.subagent`): its own entries and the Questions it asked, and
/// its own sub-agents, one level down. It is current at `at`, as a
/// Thread's view is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct SubagentView {
    #[ts(type = "number")]
    pub at: i64,
    /// The Thread it works in.
    pub thread: ThreadId,
    pub subagent: Subagent,
    pub items: Vec<Item>,
    /// The sub-agents it started, in the order they started.
    pub subagents: Vec<Subagent>,
}

/// Why Banda started a turn of a Thread in Full access Supervised, and
/// keeps the Thread so (ADR 0083): the fence does not hold here now, and
/// its Person did not choose Full access knowing that.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct WhySupervised {
    /// Its Full access was from before the fence: the window says so once
    /// on a machine, not for each Thread.
    pub before: bool,
    /// The fence as the engine found it.
    pub fence: banda_kernel::Fence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadList {
    #[ts(type = "number")]
    pub at: i64,
    pub threads: Vec<ListedThread>,
}

/// How much a Project's Threads use one account, a Harness entry, as its
/// settings say it (ADR 0093, decision 6).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct AccountUse {
    /// The entry's ID.
    pub harness: String,
    /// Its Threads now: those on it that are not archived.
    pub threads: u32,
    /// When its latest turn began, in milliseconds since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub last: Option<i64>,
    /// Its turns that began since the time asked.
    pub turns: u32,
}

/// A Thread as a list shows it: what it is, and where its work stands. A
/// list follows it from the Thread's facts; what that means to a Person,
/// such as "needs you", is the window's to say (ADR 0005, decision 8).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ListedThread {
    #[serde(flatten)]
    pub thread: ThreadSummary,
    /// Its Agent: the author of what it writes into other Threads.
    pub agent: AgentId,
    /// The Thread whose Agent started it through Banda (ADR 0019): it is
    /// that Thread's child (ADR 0098, decision 24). None for one its
    /// Person started, and for a fork; it never changes.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<ThreadId>,
    /// Its latest turn that began. None has yet.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest: Option<LatestTurn>,
    /// Its Questions that wait for an answer, the first asked first.
    #[serde(default)]
    pub asking: Vec<Asking>,
    /// The start of the latest message sent into it: what it was last asked
    /// to do. A list shows its first line.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Its latest Later (ADR 0074), asleep or woken.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub later: Option<Later>,
    /// The latest of its turns that ended which its Person saw (ADR
    /// 0096). It moves forward only; none until they see one, and none
    /// again once they mark it unread or a rewind takes that turn out.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<TurnId>,
    /// When its Person archived it (ADR 0096), unless they brought it
    /// back or put it off since. It is archived only while it neither
    /// works nor asks and nothing happened in it after: `updated_at <=
    /// archived.at`, both the host's times.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<Archived>,
    /// What it does while a turn of its runs (ADR 0099, decision 11):
    /// only its host's memory holds it, and `agents.doing` says each
    /// change.
    #[serde(flatten)]
    pub now: crate::doing::DoingNow,
    /// How many lines its latest turn that ended changed, with its
    /// sub-agents' edits, kept as it ended: the card's "+38 −9" (ADR 0098,
    /// decision 8). None when that turn changed no line, or ended before
    /// turns kept it; while another runs, it is still the one before's.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_lines: Option<crate::changes::ChangedLines>,
    /// Its direct sub-agents, while it works and one of them works or
    /// failed since its latest turn began (ADR 0103, decision 10): the
    /// card's line 2 and the Mark's red satellite. None otherwise.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagents: Option<Subagents>,
    /// Its Crew at work, after its turn too (ADR 0103, decision 10): line
    /// 2's "Crew audit-routes · Fix 4/7". None while none works.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crew: Option<CrewBrief>,
    /// The Crew its latest turn went on from, once it ended (ADR 0103,
    /// decision 33): what its call says, "Crew audit-routes finished · 2
    /// failed". None for a turn that went on from none.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crew_ended: Option<CrewEnded>,
}

impl ListedThread {
    /// Whether the Thread works: its latest turn runs, or a direct
    /// sub-agent or a Crew of it works on after that turn ended (ADR 0103,
    /// decision 19). The list, the Mark, the bar and the sound all read it so.
    pub fn works(&self) -> bool {
        let runs = (self.latest.as_ref()).is_some_and(|latest| latest.state == TurnState::Running);
        let lanes = self.subagents.as_ref().is_some_and(|subs| subs.working > 0);
        runs || lanes || self.crew.is_some()
    }

    /// Whether the Thread is archived now, by the rule a window applies to
    /// the list it follows too.
    pub fn is_archived(&self) -> bool {
        let asks = !self.asking.is_empty();
        let changed = self.thread.updated_at;
        crate::rules::archive::holds(self.archived, changed, self.works(), asks)
    }
}

/// A Thread's direct sub-agents as its list says them (ADR 0103, decisions
/// 10 and 32): how many work, running or asking, which are its Mark's
/// satellites; how many failed since its latest turn began, its red one;
/// and, when one works, what names it: "Waiting on Explore".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Subagents {
    pub working: u16,
    pub failed: u16,
    /// The label of the one at work, when it is one (`lanes::label`).
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub only: Option<String>,
}

/// A Thread's Crew at work as its list says it (ADR 0103, decisions 10 and
/// 32): "Crew ‹title› · ‹phase› ‹done›/‹of›".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CrewBrief {
    pub title: String,
    /// The phase of the agent that started last; empty before any did.
    pub phase: String,
    /// That phase's agents done.
    pub done: u16,
    /// That phase's agents so far: it grows as the script calls them.
    pub of: u16,
}

/// A Crew a Thread's latest turn went on from, as its call says it (ADR
/// 0103, decision 33).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CrewEnded {
    pub title: String,
    pub state: CrewState,
    /// How many of its agents failed.
    pub failed: u16,
}

/// When its Person archived a Thread (ADR 0096, decision 4): by its
/// host's clock, never a window's, so it is compared only with the host's
/// own times.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Archived {
    /// In milliseconds since the epoch.
    #[ts(type = "number")]
    pub at: i64,
}

/// A Thread put away by its Person, or by its own Agent, until a time,
/// until the turn that ran ended, or, its Person's, Someday (ADR 0074;
/// ADR 0098, decision 12). It sleeps until it ends, unless `woke` says what woke it first: a reader compares `until` with
/// now, and no fact says that the time came.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Later {
    /// When it was put off, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub at: i64,
    pub by: Participant,
    /// When it wakes, in milliseconds since the epoch; none: when the turn
    /// that ran ends, or, with `someday`, never by itself.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    /// Someday (ADR 0098, decision 12): no time, and it never wakes by
    /// itself, only as something calls its Person or they wake it.
    #[ts(as = "Option<bool>", optional)]
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub someday: bool,
    /// What woke it, and when: its time, or what came first.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub woke: Option<Woke>,
    /// The failed turn that goes again as its time comes: a usage limit's
    /// reset (ADR 0074, decision 8). Cleared once it went.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<TurnId>,
    /// What its Person has seen of it waking by itself (ADR 0074,
    /// decisions 3 and 7; ADR 0096): kept here, beside the Later, so
    /// every window and machine reads the same.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub woke_seen: Option<WokeSeen>,
}

/// When a [`Later`] ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Until {
    /// At a moment, in milliseconds since the epoch.
    At(i64),
    /// When the turn that ran ends.
    Done,
    /// Never by itself (ADR 0098, decision 12).
    Someday,
}

impl Later {
    /// When it ends.
    pub fn ends(&self) -> Until {
        match (self.until, self.someday) {
            (Some(at), _) => Until::At(at),
            (None, true) => Until::Someday,
            (None, false) => Until::Done,
        }
    }
}

impl Until {
    /// `Later.until` and `Later.someday`, as kept: the other way of
    /// [`Later::ends`].
    pub fn kept(self) -> (Option<i64>, bool) {
        match self {
            Until::At(at) => (Some(at), false),
            Until::Done => (None, false),
            Until::Someday => (None, true),
        }
    }
}

/// What a Person has seen of a Thread that woke by itself. It moves
/// forward only: `seen`, then `dismissed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum WokeSeen {
    /// They looked at it: the sidebar's row no longer says it woke.
    Seen,
    /// They dismissed its Pane's "Woke at" line too.
    Dismissed,
}

/// What woke a put-off Thread, and when.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Woke {
    #[ts(type = "number")]
    pub at: i64,
    pub by: Wake,
}

/// Why a put-off Thread woke: its time came, or what came first (ADR
/// 0074, decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Wake {
    /// It asks its Person: a Question waits.
    Question,
    /// A turn failed.
    Failure,
    /// Its Person wrote to it.
    Message,
    /// The turn it slept through ended.
    Done,
    /// Someone woke it with `agents.wake`.
    Woken,
    /// Its time came: the host wrote it, as the one who put it off.
    Time,
}

/// How much of a message a list keeps.
pub const LISTED_MESSAGE: usize = 200;

/// A Question that waits for an answer, as a list names it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Asking {
    pub item: ItemId,
    pub title: String,
    /// Its choices, when a click on one answers it: no form to fill in
    /// and no plan to read (ADR 0056, decision 3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<Choice>,
    /// What names the sub-agent that asks (ADR 0103, decision 28); none
    /// for the Agent's own.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asker: Option<String>,
}

/// A Thread's latest turn that began, and where it stands: it runs, or how
/// it ended. A turn that waits, or that a Person took back, never began.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct LatestTurn {
    pub turn: TurnId,
    pub state: TurnState,
    /// When it began to run, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub began: i64,
    /// Why it ended as it did, when the Harness or the engine said.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// What its Agent tells its Person, with `notify` (ADR 0057).
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// What failed, when the turn failed for a reason the Person mends.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
}

/// What the agents module publishes, version 1: each fact is an Event's
/// `kind` and `payload`. A fact says what happened, in its own fields, and
/// copies no view: the Event around it carries who and when. A Thread's
/// facts have the Thread as their subject, so a Pane follows one Thread.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "payload")]
#[ts(export, export_to = "agents/")]
pub enum Fact {
    #[serde(rename = "thread.started")]
    ThreadStarted {
        thread: ThreadId,
        title: String,
        /// The Harness it runs on. Older logs leave it out.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        harness: Option<String>,
        /// Its Agent. Older logs leave it out.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent: Option<AgentId>,
        /// The Thread of the event's author, when that is the Agent of
        /// another Thread (ADR 0098, decision 24). None for a Person's,
        /// and for a fork; older logs leave it out.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent: Option<ThreadId>,
    },
    /// A message to the Agent, which queues a turn.
    #[serde(rename = "message.posted")]
    MessagePosted {
        item: ItemId,
        turn: TurnId,
        text: String,
        #[serde(default)]
        images: Vec<Image>,
        /// It answers what this Thread's Agent asked another Thread's
        /// (ADR 0019); its author is that Thread's Agent.
        #[ts(as = "Option<bool>", optional)]
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        answers: bool,
    },
    /// A message into the turn that runs, which it joins instead of
    /// queuing one; or a waiting message a Person sent now. It reads after
    /// what the Thread showed before it.
    #[serde(rename = "message.steered")]
    MessageSteered {
        item: ItemId,
        turn: TurnId,
        text: String,
        #[serde(default)]
        images: Vec<Image>,
    },
    /// A waiting message's text, changed before its turn ran.
    #[serde(rename = "message.edited")]
    MessageEdited { item: ItemId, text: String },
    /// The turn runs. Its message reads after what the Thread showed
    /// before, unless an earlier turn ran it.
    #[serde(rename = "turn.started")]
    TurnStarted {
        turn: TurnId,
        /// The Harness entry, the account, it runs on (ADR 0078, decision
        /// 2). Older logs leave it out.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        harness: Option<String>,
    },
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
        /// What its Agent tells its Person, with `notify` (ADR 0057).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
        /// How many lines its tool calls and its sub-agents' edits so far
        /// changed, when they changed any (ADR 0098, decision 8). Older
        /// logs leave it out.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        changed_lines: Option<crate::changes::ChangedLines>,
    },
    /// A message waits for a turn of its own: a failed turn's, tried
    /// again, or one that could not join the turn it was sent into.
    #[serde(rename = "turn.queued")]
    TurnQueued { turn: TurnId, message: ItemId },
    /// The Thread's queue waits for a Person, or goes on.
    #[serde(rename = "thread.held")]
    ThreadHeld { thread: ThreadId, held: bool },
    /// The Thread is put away until `until`, or, without it, until the
    /// turn that runs ends (ADR 0074). Its author put it off.
    // Its name before ADR 0098, as old logs and older engines say it.
    #[serde(rename = "thread.later", alias = "thread.snoozed")]
    ThreadLater {
        thread: ThreadId,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        until: Option<i64>,
        /// Someday: no time, and it never wakes by itself.
        #[ts(as = "Option<bool>", optional)]
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        someday: bool,
        /// The failed turn that goes again as `until` comes.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume: Option<TurnId>,
    },
    /// A put-off Thread woke, before its time or as it came.
    #[serde(rename = "thread.woke")]
    ThreadWoke {
        thread: ThreadId,
        by: Wake,
        /// When it woke: for its time, the time that came, though the
        /// fact may be written late, as the engine starts. Older facts
        /// have none, and woke at their own moment.
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<i64>,
    },
    /// The Person saw the Thread wake by itself, or dismissed that it
    /// did: its Later's `woke_seen` is `seen` now. Like each of the
    /// Person's marks below, it moves the Thread nowhere in a list.
    #[serde(rename = "thread.woke_seen")]
    ThreadWokeSeen { thread: ThreadId, seen: WokeSeen },
    /// The Person saw `turn`, which ended, settled (ADR 0096): it is the
    /// Thread's `seen` now. Like each of the Person's marks below, it
    /// moves the Thread nowhere in a list.
    #[serde(rename = "thread.seen")]
    ThreadSeen { thread: ThreadId, turn: TurnId },
    /// The Person marked the Thread unread: it has no `seen`, so its
    /// latest turn calls them again.
    #[serde(rename = "thread.unseen")]
    ThreadUnseen { thread: ThreadId },
    /// The Person archived the Thread (ADR 0096): it is put away until
    /// something new happens in it. Its `archived.at` is the event's own
    /// `at`.
    #[serde(rename = "thread.archived")]
    ThreadArchived { thread: ThreadId },
    /// The Thread left Archive: its Person brought it back, or a Later
    /// took it out (ADR 0074, decision 4).
    #[serde(rename = "thread.unarchived")]
    ThreadUnarchived { thread: ThreadId },
    /// A window moved the marks it kept of the Project's Threads to their
    /// host, once (`agents.import_marks`, ADR 0096, decision 9). It names
    /// no Thread: a list reads itself again.
    #[serde(rename = "marks.moved")]
    MarksMoved {},
    /// The Thread went back to before `turn`'s message, to edit it (ADR
    /// 0027): that turn and every turn after it leave it, with their
    /// items. The Project's log keeps what they said.
    #[serde(rename = "thread.rewound")]
    ThreadRewound { thread: ThreadId, turn: TurnId },
    /// The Person deleted the Thread, from Archive (ADR 0098, decision
    /// 14): its turns, items and marks left the Project's tables, and
    /// every list drops it. The Project's log keeps what it said, as after
    /// a rewind, since the log is never rewritten (ADR 0002, decision 6).
    #[serde(rename = "thread.deleted")]
    ThreadDeleted { thread: ThreadId },
    /// The Person renamed the Thread (ADR 0077): `title` is its title now,
    /// `was` the one before.
    #[serde(rename = "thread.renamed")]
    ThreadRenamed {
        thread: ThreadId,
        title: String,
        was: String,
    },
    /// The Person moved the Thread to another account of its Harness (ADR
    /// 0078): `harness` is the entry it runs on from its next turn, `was`
    /// the one before.
    #[serde(rename = "thread.switched")]
    ThreadSwitched {
        thread: ThreadId,
        harness: String,
        was: String,
    },
    /// The Person moved the Thread to another Project of this machine,
    /// `to` (ADR 0098, decision 14): it is not here any more. This
    /// Project's log keeps what it said here.
    #[serde(rename = "thread.left")]
    ThreadLeft {
        thread: ThreadId,
        to: ProjectId,
        /// The machine `to` is on, by its name, when it is another (ADR
        /// 0116).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        machine: Option<String>,
    },
    /// The Thread came here, whole, from another Project of this machine,
    /// `from`: its turns, items and marks as they were there. A list reads
    /// itself again, as only the engine knows all of it.
    #[serde(rename = "thread.arrived")]
    ThreadArrived {
        thread: ThreadId,
        from: ProjectId,
        /// The machine `from` is on, by its name, when it is another (ADR
        /// 0116).
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        machine: Option<String>,
    },
    /// The Thread's settings changed, by a Person or by the Harness; or
    /// by Banda, which started it Supervised, as `supervised` says why.
    #[serde(rename = "thread.configured")]
    ThreadConfigured {
        thread: ThreadId,
        settings: Settings,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        supervised: Option<WhySupervised>,
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
        /// The sub-agent whose lane it is of, when it is not the Agent's
        /// own; so for each fact below that names `sub`.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    #[serde(rename = "thought.grew")]
    ThoughtGrew {
        item: ItemId,
        turn: TurnId,
        text: String,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    #[serde(rename = "tool.started")]
    ToolStarted {
        item: ItemId,
        turn: TurnId,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        #[serde(default)]
        content: Vec<ToolContent>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    /// Each field given replaces the tool call's.
    #[serde(rename = "tool.changed")]
    ToolChanged {
        item: ItemId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<ToolStatus>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<Vec<ToolContent>>,
        /// The command ended so.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit: Option<Exit>,
    },
    /// The command printed more: `text` follows what it printed before.
    #[serde(rename = "tool.output")]
    ToolOutput {
        item: ItemId,
        text: String,
        /// Banda keeps no more of its output.
        #[serde(default)]
        cut: bool,
    },
    /// The Agent made a plan for its turn.
    #[serde(rename = "plan.made")]
    PlanMade {
        item: ItemId,
        turn: TurnId,
        steps: Vec<PlanStep>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    /// The plan's steps now, all of them.
    #[serde(rename = "plan.changed")]
    PlanChanged { item: ItemId, steps: Vec<PlanStep> },
    /// How full the Agent's context in the Thread is now.
    #[serde(rename = "thread.used")]
    ThreadUsed { thread: ThreadId, usage: Usage },
    /// A Question, the Agent's own or a sub-agent's, `sub`, which `asker`
    /// names as it asks. A sub-agent's is the Thread's entry all the same,
    /// in its launch turn (ADR 0103, decisions 8 and 28).
    #[serde(rename = "question.asked")]
    QuestionAsked {
        item: ItemId,
        turn: TurnId,
        title: String,
        choices: Vec<Choice>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        form: Option<Vec<Field>>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plan: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        asker: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crew: Option<CrewId>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<CrewStart>,
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
    /// The Thread moved to another account or Harness, and its divider
    /// went in before `turn`'s first reply (ADR 0078).
    #[serde(rename = "thread.moved")]
    ThreadMoved {
        item: ItemId,
        turn: TurnId,
        from: String,
        to: String,
        how: Moved,
    },
    /// A line from Banda, in a turn; or between turns, as a notice another
    /// part of Banda posts for the Agent (`agents.notice`).
    #[serde(rename = "notice.posted")]
    NoticePosted {
        item: ItemId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn: Option<TurnId>,
        text: String,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    /// A sub-agent started, a lane of the Thread, and `item` is where it
    /// shows: its anchor, an entry of the Thread's, or of its parent's lane
    /// for a nested one (ADR 0103, decision 8). Its entries are each a
    /// fact of its own, naming it by `sub`.
    #[serde(rename = "subagent.started")]
    SubagentStarted { item: ItemId, subagent: Subagent },
    /// What changed of a sub-agent, and only that: each field given
    /// replaces its own. A state at work, running or asks, takes its
    /// `ended` and `why` away.
    #[serde(rename = "subagent.changed")]
    SubagentChanged {
        subagent: SubagentId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        state: Option<SubagentState>,
        /// Empty when the Harness cleared it.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        /// `null` when the Harness cleared it.
        #[ts(optional = nullable, as = "Option<String>")]
        #[serde(
            default,
            deserialize_with = "banda_kernel::present",
            skip_serializing_if = "Option::is_none"
        )]
        role: Option<Option<String>>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// `false` when the Harness cleared what it lets a client do.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        can_stop: Option<bool>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        why: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        report: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crew: Option<CrewId>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase: Option<u16>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<bool>,
    },
    /// A sub-agent ended, as `state` says, and can no longer be stopped.
    /// `why` is this end's, none for one that needs none; a `report` given
    /// replaces its own. `turn` is the turn it started in, as a turn's end
    /// names its own, so git takes that turn's changes again (ADR 0103,
    /// decision 8).
    #[serde(rename = "subagent.ended")]
    SubagentEnded {
        subagent: SubagentId,
        turn: TurnId,
        state: SubagentState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        why: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        report: Option<String>,
        /// When it ended, in milliseconds since the epoch.
        #[ts(type = "number")]
        ended: i64,
    },
    /// A sub-agent's parent sent it a message after its brief (ADR 0103,
    /// decision 25): `item` shows it where its parent sent it, or, with
    /// `sub` naming it, in the sub-agent's own lane. Given again for the
    /// same `item`, its `text` is all of it so far.
    #[serde(rename = "subagent.messaged")]
    SubagentMessaged {
        item: ItemId,
        turn: TurnId,
        subagent: SubagentId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sub: Option<SubagentId>,
    },
    /// A Crew started, and `item` is where it shows, in its turn (ADR
    /// 0103, decision 18).
    #[serde(rename = "crew.started")]
    CrewStarted { item: ItemId, crew: Crew },
    /// What changed of a Crew at work, and only that: written only when an
    /// agent's state, a phase, a count or the log line changes, never for
    /// each frame. `agents` are the agents new or changed, each whole;
    /// `phases` all of them, when they changed. `went_on` names the turn
    /// Claude went on with by itself after it ended, as Claude's usage
    /// names the Crew's run then.
    #[serde(rename = "crew.progressed")]
    CrewProgressed {
        crew: CrewId,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phases: Option<Vec<Phase>>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<CrewAgent>>")]
        agents: Vec<CrewAgent>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        log: Option<String>,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tokens: Option<u64>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        went_on: Option<TurnId>,
    },
    /// A Crew ended, as `state` says, in `turn`, the turn it started in.
    /// Its open calls ended and its Questions closed with it.
    #[serde(rename = "crew.ended")]
    CrewEnded {
        crew: CrewId,
        turn: TurnId,
        state: CrewState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        why: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        /// The last line its script logged, when its end says one no
        /// frame said while it worked.
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        log: Option<String>,
        #[ts(optional, type = "number")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tokens: Option<u64>,
        #[ts(type = "number")]
        ended: i64,
    },
    /// The Agent showed its Person a Visual (ADR 0037).
    #[serde(rename = "visual.shown")]
    VisualShown {
        item: ItemId,
        turn: TurnId,
        visual: VisualId,
        title: String,
        height: u32,
        #[serde(default)]
        heights: Vec<Fit>,
    },
    /// The Agent drafted an issue about a Problem of Banda's (ADR 0039).
    #[serde(rename = "issue.drafted")]
    IssueDrafted {
        item: ItemId,
        turn: TurnId,
        fingerprint: String,
        title: String,
        body: String,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comment_on: Option<u32>,
    },
    /// The Person sent it, as they last wrote it, or did not: its title
    /// and body where they changed them.
    #[serde(rename = "issue.answered")]
    IssueAnswered {
        item: ItemId,
        state: IssueState,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
}

/// The version of every fact's payload today.
pub const VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thread_an_old_log_started_has_no_parent() {
        let old = serde_json::json!({
            "kind": "thread.started",
            "payload": { "thread": "0196a4f2-6a3c-7000-8000-000000000001", "title": "Hi" },
        });
        let Fact::ThreadStarted { parent, .. } = serde_json::from_value(old).unwrap() else {
            panic!("a start")
        };
        assert_eq!(parent, None);
    }

    /// Writes `VERSION` beside the generated types, as ts-rs writes them,
    /// so a window reads the facts' version from the Rust.
    #[test]
    fn export_the_fact_version() {
        let Ok(dir) = std::env::var("TS_RS_EXPORT_DIR") else {
            return;
        };
        let file = std::path::Path::new(&dir).join("agents/VERSION.ts");
        let text = format!(
            "// Written by apps/agents/engine/src/model.rs. Do not edit this file manually.\n\n\
             /** The newest version of the agents module's facts. */\n\
             export const VERSION = {VERSION}\n"
        );
        if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, text).unwrap();
        }
    }

    #[test]
    fn a_change_names_a_cleared_role_and_leaves_out_what_did_not_change() {
        let subagent = SubagentId::new();
        let change = |role| Fact::SubagentChanged {
            subagent,
            state: None,
            title: None,
            role,
            model: None,
            can_stop: None,
            why: None,
            prompt: None,
            report: None,
            crew: None,
            phase: None,
            background: None,
        };
        let id = subagent.to_string();
        for (role, said) in [
            (None, serde_json::json!({ "subagent": id })),
            (
                Some(None),
                serde_json::json!({ "subagent": id, "role": null }),
            ),
            (
                Some(Some("Explore".to_owned())),
                serde_json::json!({ "subagent": id, "role": "Explore" }),
            ),
        ] {
            let fact = change(role);
            let written = serde_json::to_value(&fact).unwrap();
            assert_eq!(written["payload"], said);
            assert_eq!(serde_json::from_value::<Fact>(written).unwrap(), fact);
        }
    }

    #[test]
    fn what_a_thread_wrote_before_sub_agents_reads_and_writes_as_it_did() {
        let question = r#"{"kind":"question","title":"Run it?","choices":[],"state":"open"}"#;
        let body: Body = serde_json::from_str(question).unwrap();
        assert!(matches!(body, Body::Question { sub: None, .. }));
        assert_eq!(serde_json::to_string(&body).unwrap(), question);
        let grew = r#"{"kind":"reply.grew","payload":{"item":"0195f0a8-0000-7000-8000-000000000000","turn":"0195f0a8-0000-7000-8000-000000000001","text":"Hi"}}"#;
        let fact: Fact = serde_json::from_str(grew).unwrap();
        assert_eq!(serde_json::to_string(&fact).unwrap(), grew);
    }
}
