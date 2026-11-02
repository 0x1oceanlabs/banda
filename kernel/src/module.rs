use crate::access::Right;
use crate::methods::Tool;
use crate::outbox::{Effect, OnRestart, Outcome, Settled};
use crate::space::ModuleSpace;
use crate::{CommandId, Error, Participant, Refusal, SpaceId, Tx};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;

/// What a module says now and keeps nowhere, such as a terminal's output:
/// pieces in order, until its sender drops. Only those who hear it now get
/// it, and one heard again starts again; the event log is for what the work
/// keeps.
pub type Stream = mpsc::Receiver<Value>;

/// Where a module keeps its data and runs its methods (ADR 0025,
/// decision 1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// In each Space: its methods name one.
    Space,
    /// Once for this machine, as the workspaces are, holding every
    /// Space's Panes: its methods name no Space.
    Machine,
}

/// A bounded context: its own words, data and contract (ADR 0001, decision
/// 3). The kernel knows a module only through this trait.
///
/// A module's name prefixes its methods (`notes.add`) and its tables
/// (`notes_items`), and its events carry it. It writes only its own tables and reads no
/// other module's. Modules reach each other only by commands and events.
#[async_trait::async_trait]
pub trait Module: Send + Sync + 'static {
    /// Lowercase letters: the prefix of its methods, events and tables.
    fn name(&self) -> &'static str;

    /// Where its data lives: each Space's, or this machine's.
    fn scope(&self) -> Scope {
        Scope::Space
    }

    /// Its own ledger of migrations. Each step runs once, in order, and a
    /// shipped step never changes.
    fn migrations(&self) -> &'static [&'static str];

    /// The right each of its methods needs, or `None` when it has no such
    /// method. `method` comes without the module's prefix. A module parses
    /// it into its own method enum and maps that with one exhaustive
    /// `match`, so the compiler rejects a method without a right (ADR 0002,
    /// decision 9). The kernel decides before [`Module::call`] runs.
    fn right(&self, method: &str) -> Option<Right>;

    /// Its methods an Agent may call as tools: the lines of its `methods!`
    /// table marked `tool`, `Self::method_tools(self.name())` (ADR 0019,
    /// decision 3).
    fn tools(&self) -> Vec<Tool> {
        Vec::new()
    }

    /// Runs once a Space opens, after the outbox settled what a restart cut
    /// short: a module can pick up its work here.
    async fn opened(&self, _space: ModuleSpace) -> Result<(), Error> {
        Ok(())
    }

    /// Runs as the Space is removed (ADR 0026): a module stops what it
    /// runs there, its turns and its programs, before the Space's data
    /// goes.
    async fn closing(&self, _space: ModuleSpace) {}

    /// One of its methods, already allowed. `method` comes without the
    /// module's prefix.
    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal>;

    /// One of its streams, already allowed. `method` comes without the
    /// module's prefix, and [`Module::right`] names its right too.
    async fn stream(&self, _call: Call, method: &str, _params: Value) -> Result<Stream, Refusal> {
        Err(Refusal::invalid(format!(
            "{} has no stream named {method}.",
            self.name()
        )))
    }

    /// Runs one of its side effects from the outbox. A run holds its key
    /// until it ends, so a module bounds how long its own runs take.
    async fn run(&self, _space: ModuleSpace, effect: Effect) -> Outcome {
        Outcome::Fail(format!(
            "{} runs no effect of kind {}",
            self.name(),
            effect.kind
        ))
    }

    /// What one of its effects that a restart cut short becomes.
    fn on_restart(&self, _kind: &str) -> OnRestart {
        OnRestart::Abandon
    }

    /// Writes, in the same transaction, what it means that an effect will
    /// not run to its end: an event the Person can see, a state to undo.
    fn settle(&self, _tx: &mut Tx<'_>, _effect: &Effect, _settled: &Settled) -> Result<(), Error> {
        Ok(())
    }
}

/// The wall a pass keeps an Agent behind (ADR 0019, decision 2): the one
/// Space it works in, and whether its Person lets that Space's Agents see
/// the other Spaces' Panes (ADR 0032). A module of this machine answers a
/// walled call with what it may see.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wall {
    pub space: SpaceId,
    pub sees_others: bool,
}

/// One allowed call to a module's method: who makes it, in which Space, and
/// the command ID that makes it run once.
pub struct Call {
    participant: Participant,
    space: ModuleSpace,
    method: String,
    command: Option<CommandId>,
    wall: Option<Wall>,
}

impl Call {
    pub(crate) fn new(
        participant: Participant,
        space: ModuleSpace,
        method: String,
        command: Option<CommandId>,
        wall: Option<Wall>,
    ) -> Self {
        Self {
            participant,
            space,
            method,
            command,
            wall,
        }
    }

    pub fn participant(&self) -> Participant {
        self.participant
    }

    /// The wall its caller's pass keeps it behind; none for the owner.
    pub fn wall(&self) -> Option<Wall> {
        self.wall
    }

    pub fn space(&self) -> &ModuleSpace {
        &self.space
    }

    /// Asks the window `what`, under this module's name, for this call's
    /// caller in its Space, and waits for the answer at most `within`
    /// (ADR 0029, decision 2). With no window, or none that answers in
    /// time, it is refused, and the refusal says whether it may have run;
    /// an answer that is not a `T` is refused too.
    pub async fn ask_window<T: serde::de::DeserializeOwned>(
        &self,
        what: &str,
        params: Value,
        within: Duration,
    ) -> Result<T, Refusal> {
        let answer = (self.space)
            .ask_window(self.participant, what, params, within)
            .await?;
        serde_json::from_value(answer)
            .map_err(|e| Refusal::invalid(format!("Banda's window answered amiss: {e}.")))
    }

    /// The ID this call runs under as a command. A module whose command
    /// acts before it writes asks first, so a call without one does
    /// nothing.
    pub fn command_id(&self) -> Result<CommandId, Refusal> {
        self.command.ok_or_else(|| {
            Refusal::invalid(format!(
                "{} is a command and needs a command ID.",
                self.method
            ))
        })
    }

    /// Runs this call as a command: once per command ID, in one transaction
    /// with its receipt, its events and its outbox rows. A repeated command
    /// answers what the first one did.
    pub async fn command<T>(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Refusal>
    where
        T: Serialize + DeserializeOwned,
    {
        let command = self.command_id()?;
        let kept = self
            .space
            .command(command, &self.method, self.participant, move |tx| {
                Ok(serde_json::to_value(change(tx)?)?)
            })
            .await?;
        Ok(serde_json::from_value(kept).map_err(Error::from)?)
    }
}

impl crate::methods::Asks for Call {
    fn command_id(&self) -> Result<CommandId, Refusal> {
        Call::command_id(self)
    }
}
