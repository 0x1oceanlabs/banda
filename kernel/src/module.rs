use crate::access::Right;
use crate::outbox::{Effect, OnRestart, Outcome, Settled};
use crate::space::ModuleSpace;
use crate::{CommandId, Error, Participant, Refusal, Tx};
use serde_json::Value;
use tokio::sync::mpsc;

/// What a module says now and keeps nowhere, such as a terminal's output:
/// pieces in order, until its sender drops. Only those who hear it now get
/// it, and one heard again starts again; the event log is for what the work
/// keeps.
pub type Stream = mpsc::Receiver<Value>;

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

    /// Its own ledger of migrations. Each step runs once, in order, and a
    /// shipped step never changes.
    fn migrations(&self) -> &'static [&'static str];

    /// The right each of its methods needs, or `None` when it has no such
    /// method. `method` comes without the module's prefix. A module parses
    /// it into its own method enum and maps that with one exhaustive
    /// `match`, so the compiler rejects a method without a right (ADR 0002,
    /// decision 9). The kernel decides before [`Module::call`] runs.
    fn right(&self, method: &str) -> Option<Right>;

    /// Runs once a Space opens, after the outbox settled what a restart cut
    /// short: a module can pick up its work here.
    async fn opened(&self, _space: ModuleSpace) -> Result<(), Error> {
        Ok(())
    }

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

/// One allowed call to a module's method: who makes it, in which Space, and
/// the command ID that makes it run once.
pub struct Call {
    participant: Participant,
    space: ModuleSpace,
    method: String,
    command: Option<CommandId>,
}

impl Call {
    pub(crate) fn new(
        participant: Participant,
        space: ModuleSpace,
        method: String,
        command: Option<CommandId>,
    ) -> Self {
        Self {
            participant,
            space,
            method,
            command,
        }
    }

    pub fn participant(&self) -> Participant {
        self.participant
    }

    pub fn space(&self) -> &ModuleSpace {
        &self.space
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
    /// with its receipt, its events and its outbox rows.
    pub async fn command(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<Value, Error> + Send + 'static,
    ) -> Result<Value, Refusal> {
        let command = self.command_id()?;
        self.space
            .command(command, &self.method, self.participant, change)
            .await
    }
}
