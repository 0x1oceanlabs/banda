use crate::access::{self, Right};
use crate::outbox::{Effect, OnRestart, Outcome, Settled};
use crate::space::ModuleSpace;
use crate::{Actor, CommandId, Error, Refusal, Tx};
use serde_json::Value;

/// A bounded context: its own words, data and contract (ADR 0001, decision
/// 3). The kernel knows a module only through this trait.
///
/// A module's name prefixes its methods (`agents.send`), its events and its
/// tables (`agents_threads`). It writes only its own tables and reads no
/// other module's. Modules reach each other only by commands and events.
#[async_trait::async_trait]
pub trait Module: Send + Sync + 'static {
    /// Lowercase letters: the prefix of its methods, events and tables.
    fn name(&self) -> &'static str;

    /// Its own ledger of migrations. Each step runs once, in order, and a
    /// shipped step never changes.
    fn migrations(&self) -> &'static [&'static str];

    /// Runs once a Space opens, after the outbox settled what a restart cut
    /// short: a module can pick up its work here.
    async fn opened(&self, _space: ModuleSpace) -> Result<(), Error> {
        Ok(())
    }

    /// One of its methods. `method` comes without the module's prefix. The
    /// module maps every method to a [`Right`] with one exhaustive `match`
    /// and asks [`Call::authorize`] before anything else.
    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal>;

    /// Runs one of its side effects from the outbox.
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

/// One call to a module's method: who makes it, in which Space, and the
/// command ID that makes it run once.
pub struct Call {
    actor: Actor,
    space: ModuleSpace,
    method: String,
    command: Option<CommandId>,
}

impl Call {
    pub(crate) fn new(
        actor: Actor,
        space: ModuleSpace,
        method: String,
        command: Option<CommandId>,
    ) -> Self {
        Self {
            actor,
            space,
            method,
            command,
        }
    }

    pub fn actor(&self) -> Actor {
        self.actor
    }

    pub fn space(&self) -> &ModuleSpace {
        &self.space
    }

    /// The access decision for this call.
    pub fn authorize(&self, right: Right) -> Result<(), Refusal> {
        access::decide(&self.actor, right, self.space.owner())
    }

    /// Runs this call as a command: once per command ID, in one transaction
    /// with its receipt, its events and its outbox rows.
    pub async fn command(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<Value, Error> + Send + 'static,
    ) -> Result<Value, Refusal> {
        let command = self.command.ok_or_else(|| {
            Refusal::invalid(format!(
                "{} is a command and needs a command ID.",
                self.method
            ))
        })?;
        self.space.command(command, &self.method, change).await
    }
}
