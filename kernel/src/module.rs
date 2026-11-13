use crate::access::{self, Right};
use crate::kernel::Projects;
use crate::methods::{Kind, Tool, needs_command_id};
use crate::outbox::{Effect, OnRestart, Outcome, Retry, Settled};
use crate::project::ModuleProject;
use crate::store::Receipt;
use crate::{CommandId, Error, Participant, ProjectId, Refusal, Tx};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

/// What a module says now and keeps nowhere, such as a terminal's output:
/// pieces in order, until its sender drops. Only those who hear it now get
/// it, and one heard again starts again; the event log is for what the work
/// keeps.
pub type Stream = mpsc::Receiver<Value>;

/// Where a module keeps its data and runs its methods (ADR 0025,
/// decision 1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// In each Project: its methods name one.
    Project,
    /// Once for this machine, as the workspaces are, holding every
    /// Project's Panes: its methods name no Project.
    Machine,
}

/// A bounded context: its own words, data and contract (ADR 0001, decision
/// 3). The kernel knows a module only through this trait.
///
/// A module's name prefixes its methods (`notes.add`) and its tables
/// (`notes_items`), and its events carry it. It writes only its own tables and reads no
/// other module's, and the kernel holds it to that: its SQL reaches no
/// table outside its prefixes (ADR 0062, decision 5). Modules reach each
/// other only by commands and events.
#[async_trait::async_trait]
pub trait Module: Send + Sync + 'static {
    /// Lowercase letters: the prefix of its methods, events and tables.
    fn name(&self) -> &'static str;

    /// The prefixes its tables kept from an id it had before, as its
    /// `app.toml` declares them (`legacy-prefixes`): its SQL reaches
    /// `<prefix>_*` too. A module whose id changes keeps its tables'
    /// names, for data at rest is never renamed (ADR 0085, decision 12).
    /// Lowercase letters, none another module's name.
    fn legacy_prefixes(&self) -> &'static [&'static str] {
        &[]
    }

    /// Where its data lives: each Project's, or this machine's.
    fn scope(&self) -> Scope {
        Scope::Project
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

    /// The kind of each of its methods, `Self::method_kind(method)`, or
    /// `None` when it has no such method. A command keeps a receipt
    /// ([`Kernel::answer`](crate::Kernel::answer)).
    fn kind(&self, method: &str) -> Option<Kind>;

    /// Whether one of its commands runs on past one write before it
    /// answers, as a sign-in that waits for the Person does. The router
    /// keeps such a command in no queue, so the next commands of its
    /// session go on beside it (ADR 0082, decision 4). `method` comes
    /// without the module's prefix. Work longer than one write should
    /// answer at once and report through facts; until it does, it is
    /// named here.
    fn runs_on(&self, _method: &str) -> bool {
        false
    }

    /// Its methods an Agent may call as tools: the lines of its `methods!`
    /// table marked `tool`, `Self::method_tools(self.name())` (ADR 0019,
    /// decision 3).
    fn tools(&self) -> Vec<Tool> {
        Vec::new()
    }

    /// Whether a pass reaches `method` of this machine's module, named
    /// without the module's prefix, though it is no Agent's tool: what a
    /// Harness process asks for itself, as a gateway account's key (ADR
    /// 0078, decision 1). Its handler says whose pass may. The lines of its
    /// `methods!` table marked `pass`, `Self::method_passes(method)`.
    fn passes_reach(&self, _method: &str) -> bool {
        false
    }

    /// Runs once a Project opens, after the outbox settled what a restart cut
    /// short and before any effect runs: a module can pick up its work here,
    /// and finds it as the last boot left it.
    async fn opened(&self, _project: ModuleProject) -> Result<(), Error> {
        Ok(())
    }

    /// Runs as the Project is removed (ADR 0026): a module stops what it
    /// runs there, its turns and its programs, before the Project's data
    /// goes.
    async fn closing(&self, _project: ModuleProject) {}

    /// Refuses a folder move while this module still has work in the Project.
    /// The kernel excludes new calls while checking every module and moving.
    async fn can_move(&self, _project: ModuleProject) -> Result<(), Refusal> {
        Ok(())
    }

    /// The folder is about to move, as every module let it
    /// ([`Module::can_move`]). Let go of idle processes that work in it:
    /// Windows moves no folder a process works in (ADR 0090, decision 3).
    /// No call runs till it moved, and work after reads the new folder.
    async fn moving(&self, _project: ModuleProject) {}

    /// The Person trusted the Project, or took its trust back (ADR 0083,
    /// decision 5). A module lets go of what started under the other, so
    /// what starts next reads [`ModuleProject::trusted`] as it is now.
    async fn trust_changed(&self, _project: ModuleProject) {}

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

    /// Runs one of its side effects from the outbox, of those the engine
    /// runs ([`Tx::enqueue`]). A run holds its key until it ends, so a
    /// module bounds how long its own runs take.
    async fn run(&self, _project: ModuleProject, effect: Effect) -> Outcome {
        Outcome::Fail(format!(
            "{} runs no effect of kind {}",
            self.name(),
            effect.kind
        ))
    }

    /// What one of its effects that a restart cut short becomes, or one
    /// whose worker's lease ran out.
    fn on_restart(&self, _kind: &str) -> OnRestart {
        OnRestart::Abandon
    }

    /// How one of its effects that asks to retry tries again: a few tries,
    /// for work on this host, or until a deadline, for work over the
    /// network (ADR 0082, A6).
    fn retry(&self, _kind: &str) -> Retry {
        Retry::default()
    }

    /// Writes, in the same transaction, what it means that an effect will
    /// not run to its end: an event the Person can see, a state to undo.
    fn settle(&self, _tx: &mut Tx<'_>, _effect: &Effect, _settled: &Settled) -> Result<(), Error> {
        Ok(())
    }
}

/// The wall a pass keeps an Agent behind (ADR 0019, decision 2): the one
/// Project it works in, and whether its Person lets that Project's Agents see
/// the other Projects' Panes (ADR 0032). A module of this machine answers a
/// walled call with what it may see; a module of a Project holds its paths
/// inside the Project's folder ([`Reach`](crate::Reach)).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wall {
    pub project: ProjectId,
    pub sees_others: bool,
}

/// One allowed call to a module's method: who makes it, in which Project, and
/// for a command the receipt that makes it run once.
pub struct Call {
    participant: Participant,
    project: ModuleProject,
    method: String,
    receipt: Option<Receipt>,
    wall: Option<Wall>,
    thread: Option<Uuid>,
    runs: Option<String>,
    /// Every Project of this machine, which a call of their owner's may
    /// reach ([`Call::other`]); none for a stream.
    projects: Option<Projects>,
}

/// Another Project, as the module of a call that reaches it sees it
/// ([`Call::other`]). While it is held, that Project's folder does not
/// move, as the call's own does not while it runs, and its data is not
/// put away: removed meanwhile, it goes once the call let go of it.
pub struct Other {
    project: ModuleProject,
    _moving: tokio::sync::OwnedRwLockReadGuard<()>,
    _reached: tokio::sync::OwnedRwLockReadGuard<()>,
}

impl std::ops::Deref for Other {
    type Target = ModuleProject;

    fn deref(&self) -> &ModuleProject {
        &self.project
    }
}

impl Call {
    pub(crate) fn new(
        participant: Participant,
        project: ModuleProject,
        method: String,
        receipt: Option<Receipt>,
        wall: Option<Wall>,
        thread: Option<Uuid>,
        runs: Option<String>,
    ) -> Self {
        Self {
            participant,
            project,
            method,
            receipt,
            wall,
            thread,
            runs,
            projects: None,
        }
    }

    /// The call, able to reach the other Projects of `projects`.
    pub(crate) fn reaching(self, projects: Projects) -> Self {
        Self {
            projects: Some(projects),
            ..self
        }
    }

    pub fn participant(&self) -> Participant {
        self.participant
    }

    /// The wall its caller's pass keeps it behind; none for the owner.
    pub fn wall(&self) -> Option<Wall> {
        self.wall
    }

    /// The Thread whose session its caller's pass was made for; none for
    /// the owner and for a Harness process's shared pass (ADR 0083,
    /// decision 2). The module that asked for the pass named it, so the
    /// Agent never does.
    pub fn thread(&self) -> Option<Uuid> {
        self.thread
    }

    /// What runs the process or the session its caller's pass is for, as
    /// the module that asked for the pass named it: an Agent's Harness
    /// entry. None for the owner, and for a pass that names nothing.
    pub fn runs(&self) -> Option<&str> {
        self.runs.as_deref()
    }

    pub fn project(&self) -> &ModuleProject {
        &self.project
    }

    /// Whether `project` of this machine is a scratch one, a Thread's in
    /// No Project (ADR 0046); none when this machine does not know it.
    pub async fn scratch(&self, project: ProjectId) -> Option<bool> {
        let projects = self.projects.as_ref()?.read().await;
        projects.get(&project).map(|entry| entry.scratch())
    }

    /// This module in `project`, another open Project of this machine, for
    /// a call of their owner's that moves the module's own data there, as
    /// a Person moves a Thread to another Project (ADR 0098, decision 14).
    /// What it writes there is the module's own, in that Project's store
    /// and data, under no receipt: it is the call's to write once. Only a
    /// Person reaches it, the owner, whose every right holds there too: an
    /// Agent stays in its own Project, with a pass or without, whatever
    /// right the method needs. The call's own Project is no other.
    pub async fn other(&self, project: ProjectId) -> Result<Other, Refusal> {
        if self.participant.agent().is_some() {
            return Err(Refusal::forbidden(
                "An Agent reaches no Project but its own.",
            ));
        }
        access::within(self.wall.map(|wall| wall.project), Some(project))?;
        if project == self.project.id() {
            return Err(Refusal::invalid("That is the Project this call runs in."));
        }
        let projects = (self.projects.as_ref()).ok_or_else(|| {
            Refusal::invalid(format!("{} reaches no other Project.", self.method))
        })?;
        let other = crate::kernel::open_in(projects, project).await?;
        access::decide(&self.participant, Right::Write, other.owner())?;
        let moving = other.moving.clone().read_owned().await;
        let reached = other.reached.clone().read_owned().await;
        // Removed as it was found: it is not there any more.
        if other.removed() {
            return Err(crate::kernel::no_project());
        }
        Ok(Other {
            project: self.project.beside(other)?,
            _moving: moving,
            _reached: reached,
        })
    }

    /// Asks the window `what`, under this module's name, for this call's
    /// caller in its Project, and waits for the answer at most `within`
    /// (ADR 0029, decision 2). With no window, or none that answers in
    /// time, it is refused, and the refusal says whether it may have run;
    /// an answer that is not a `T` is refused too.
    pub async fn ask_window<T: DeserializeOwned>(
        &self,
        what: &str,
        params: &impl Serialize,
        within: Duration,
    ) -> Result<T, Refusal> {
        let params = serde_json::to_value(params).map_err(|_| Refusal::internal())?;
        let answer = (self.project)
            .ask_window(self.participant, what, params, within)
            .await?;
        serde_json::from_value(answer)
            .map_err(|e| Refusal::invalid(format!("Banda's window answered amiss: {e}.")))
    }

    /// The ID this call runs under as a command; a `call` has none.
    pub fn command_id(&self) -> Result<CommandId, Refusal> {
        Ok(self.receipt()?.command)
    }

    fn receipt(&self) -> Result<&Receipt, Refusal> {
        (self.receipt.as_ref()).ok_or_else(|| needs_command_id(&self.method))
    }

    /// Writes this command's change in one transaction with its events,
    /// its outbox rows and a mark on its receipt, so a crash leaves all of
    /// it or none. Once it is written, a resend never runs the command
    /// again ([`Kernel::answer`](crate::Kernel::answer)).
    pub async fn command<T: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Refusal> {
        let receipt = self.receipt()?.clone();
        self.project.command(receipt, change).await
    }
}

impl crate::methods::Asks for Call {
    fn command_id(&self) -> Result<CommandId, Refusal> {
        Call::command_id(self)
    }
}
