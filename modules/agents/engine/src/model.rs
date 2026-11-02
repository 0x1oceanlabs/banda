//! The agents module's published language: its IDs, the facts it publishes
//! and the views a window reads. TypeScript types come from here.

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
    /// An image a message carries.
    ImageId,
    export_to = "agents/"
);

/// An image a Person sends with a message. Its bytes are kept apart, in
/// the Space's data, `spaces/<id>/images/`, and read with `agents.image`.
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

/// A Harness this machine can run, as `harnesses.toml` has it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct HarnessView {
    pub id: String,
    pub name: String,
    /// Whether Threads start with it.
    pub enabled: bool,
    /// How it starts: its program, then its arguments.
    pub command: Vec<String>,
    /// The names of the variables it starts with. Their values may be
    /// secrets, so they stay in the file.
    pub env: Vec<String>,
}

impl HarnessView {
    pub fn of(harness: &crate::settings::Harness) -> Self {
        Self {
            id: harness.id.clone(),
            name: harness.name.clone(),
            enabled: harness.enabled,
            command: [&harness.command]
                .into_iter()
                .chain(&harness.args)
                .cloned()
                .collect(),
            env: harness.env.keys().cloned().collect(),
        }
    }
}

/// What `agents.account` answers: a Harness entry on this computer as its
/// process says when it starts, and how a Person signs in to it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Account {
    pub ways: Vec<SignInWay>,
    /// What runs, as it names itself.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<Adapter>,
    /// The Person's own CLI it runs, when it runs one.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<CliView>,
    /// Who it says is signed in; `None` when it does not say.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signed_in_as: Option<SignedInAs>,
    /// Signing out here ends its sign-in (`agents.sign_out`): it declares
    /// ACP's logout, and an account is signed in. A key in its environment
    /// outlives a logout.
    pub signs_out: bool,
}

/// The Person's own CLI that a Harness runs, where it was found and the
/// version it says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CliView {
    pub path: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// In plain words, that the version is older than the Harness
    /// supports.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outdated: Option<String>,
}

/// A Harness's program, as it names itself when it starts: for Claude
/// Code and Codex, their ACP adapter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Adapter {
    pub name: String,
    pub version: String,
}

/// Who a Harness says is signed in, in its own words: a plan such as
/// "Claude Max" with its email, an API key, a gateway, or no one. Banda
/// reads none of its files to know.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct SignedInAs {
    /// Whether anyone is: `false` when the Harness says no one is.
    pub signed_in: bool,
    pub label: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
}

/// A way to sign in to a Harness, as the Harness offers it. Banda runs
/// it and holds none of the account's credentials: the Harness keeps them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct SignInWay {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The program a Person signs in with, in a terminal: it ends with
    /// code 0 when that worked. Without one the Harness signs in by itself,
    /// as Codex does in the browser.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<Program>,
}

/// A program with its arguments, never a shell line, and what it adds to
/// the engine's environment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Program {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
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
    },
    /// A line from Banda about the Thread, such as a session the
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
    /// The Harness it runs on, by its ID in the Harness list; chosen when
    /// it starts, it stays (ADR 0006). Empty for a Thread from before
    /// Threads named theirs whose Agent's file is gone.
    pub harness: String,
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadList {
    #[ts(type = "number")]
    pub at: i64,
    pub threads: Vec<ListedThread>,
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
}

/// How much of a message a list keeps.
pub const LISTED_MESSAGE: usize = 200;

/// A Question that waits for an answer, as a list names it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Asking {
    pub item: ItemId,
    pub title: String,
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
    /// A message waits for a turn of its own: a failed turn's, tried
    /// again, or one that could not join the turn it was sent into.
    #[serde(rename = "turn.queued")]
    TurnQueued { turn: TurnId, message: ItemId },
    /// The Thread's queue waits for a Person, or goes on.
    #[serde(rename = "thread.held")]
    ThreadHeld { thread: ThreadId, held: bool },
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
        #[serde(default)]
        content: Vec<ToolContent>,
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
    },
    /// The plan's steps now, all of them.
    #[serde(rename = "plan.changed")]
    PlanChanged { item: ItemId, steps: Vec<PlanStep> },
    /// How full the Agent's context in the Thread is now.
    #[serde(rename = "thread.used")]
    ThreadUsed { thread: ThreadId, usage: Usage },
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
