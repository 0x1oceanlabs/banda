//! What runs now, in memory: the Harness processes ([`Hosts`]), the turns
//! they run, the sub-agents at work in their sessions, and the Questions
//! both wait on. A restart loses it, and the outbox settles what that cut
//! short. A turn is held from [`Live::open`] until its [`TurnRun`] is let
//! go, however its task ends, and is counted as at work for that long,
//! waiting on its Person's Question too: the engine keeps its machine
//! awake while any is (ADR 0097, decision 1).
//!
//! A sub-agent at work holds what a running turn holds (ADR 0103,
//! decision 11), from [`Live::lane`] until its [`LaneRun`] is let go: it
//! counts as at work, keeps its process from being let go as idle, and
//! keeps its Questions, which its turn's end leaves open. It holds its
//! session weakly, so it never keeps alive a process Banda let go: as
//! Banda lets one go, for a change of the Project's trust or of a
//! Harness's account, or as a Thread moves elsewhere, it notes the cut on
//! the sub-agents at work there ([`Cut`]), which end Lost in its words
//! once the process is gone. A Project removed stops them.
//!
//! One lock holds the running turns, the cancels, the sub-agents and the
//! Questions together, so a stop that comes while a turn starts, or while
//! it asks, is never lost. Whether a turn was asked to stop is the turn's
//! own state (`agents_turns.stopping`), which the rules read; memory only
//! keeps whether its Harness was told.
//!
//! The Harness processes are one per Project and Harness entry: every Thread
//! on that Harness in that Project is a session in the one process. A host
//! with nothing to do is let go, and its Threads resume their sessions
//! when it starts again. After a sign-in every host of that Harness entry
//! is let go, so each reads the account again when it starts; and every
//! host of a Project whose trust the Person changed, so its sessions load
//! what the folder names only while it is trusted (ADR 0083, decision 5).
//!
//! The `banda` an Agent runs in its shell acts under a pass walled to its
//! Project (ADR 0019). Each Harness process carries one, which its Agents'
//! shells share: of an Agent no one Thread names, made once per Project and
//! Harness entry in this run of the engine, so a process started again
//! keeps it, until the Project closes. A Harness that takes variables for
//! each session's shell, as Claude Code's adapter does, gives a Thread's
//! session its own over it, the one its `banda mcp` has
//! (`acp/opening.rs`), which the process holds while the session is open
//! in it. The kernel keeps every pass past an engine restart, until what
//! holds it lets it go or it expires (ADR 0083, decision 2).

use crate::acp::{Answer, Connection, Session, WeakSession};
use crate::doing::Doings;
use crate::model::{ItemId, SubagentId, ThreadId, TurnId, Values};
use crate::touching::Touches;
use crate::{Pipe, kept};
use banda_harnesses::hosts::{Held, Hosts};
use banda_harnesses::{Failed, Harness};
use banda_kernel::{
    AgentId, AtWork, Holes, Listener, ModuleProject, Pass, Program, ProjectId, Refusal, Working,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, oneshot};

pub struct Live {
    hosts: Arc<Hosts<Connection>>,
    turns: Mutex<Turns>,
    /// Told each time a turn begins or ends, or a Question stops waiting:
    /// what waits on that ([`Live::until`]) looks again then.
    changed: Notify,
    /// How long a turn the Agent went on with by itself waits for more.
    quiet: Duration,
    /// How a session's Agent reaches Banda, if it does.
    pipe: Option<Pipe>,
    /// The pass each Harness process's Agents share, as the variables that
    /// hand it to `banda`, by Project and Harness entry, held while the
    /// Project is open.
    passes: Mutex<HashMap<(ProjectId, String), ProcessPass>>,
    /// The file each running turn works on now.
    touches: Arc<Touches>,
    /// What each running turn does now.
    doings: Arc<Doings>,
    /// The count of the turns that run, which each [`TurnRun`] holds one
    /// of.
    working: Working,
    /// The Threads a move to another Project or a delete holds now, each
    /// with what holds it ([`Live::hold`]).
    holds: Mutex<HashMap<ThreadId, Hold>>,
}

/// The variables that hand a Harness process's Agents' shells their pass,
/// and the pass, held while its Project is open.
type ProcessPass = (BTreeMap<String, String>, Pass);

/// What holds a Thread a while ([`Live::hold`]): its move to another
/// Project, or its delete (ADR 0098, decision 14).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    Moving,
    Deleting,
}

impl Hold {
    /// The refusal of what finds a Thread held so.
    pub fn refused(self) -> Refusal {
        Refusal::conflict(match self {
            Hold::Moving => "This Thread is moving to another Project now.",
            Hold::Deleting => "This Thread is being deleted now.",
        })
    }
}

/// A Thread held ([`Live::hold`]), let go as this is.
pub struct Holding<'a> {
    live: &'a Live,
    thread: ThreadId,
}

impl Drop for Holding<'_> {
    fn drop(&mut self) {
        self.live.holds.lock().unwrap().remove(&self.thread);
    }
}

#[derive(Default)]
struct Turns {
    running: HashMap<TurnId, Session>,
    /// Turns whose Harness was told to stop them. One that is still
    /// starting hears it when it begins.
    cancelled: HashSet<TurnId>,
    /// Turns a message was just sent into: what the Agent says next reads
    /// after it.
    steered: HashSet<TurnId>,
    /// The Questions the Harness waits on, by whose they are.
    questions: HashMap<ItemId, (Owner, oneshot::Sender<Answer>)>,
    /// What Persons typed in secret fields, until it goes to the Harness.
    /// Only memory holds it.
    secrets: HashMap<ItemId, Values>,
    /// The sub-agents at work.
    lanes: HashMap<SubagentId, LaneHeld>,
}

/// Whose a Question is: a turn's, or a sub-agent's, which its turn's end
/// leaves open (ADR 0103, decision 8).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Owner {
    Turn(TurnId),
    Lane(SubagentId),
}

/// A sub-agent at work, as memory holds it.
struct LaneHeld {
    project: ProjectId,
    /// The Harness entry its process runs.
    harness: String,
    thread: ThreadId,
    /// Its child session, as the Harness names it.
    child: String,
    /// Its Thread's session, held weakly.
    session: WeakSession,
    /// Why Banda cut it off, once it did.
    cut: Option<Cut>,
}

/// Why Banda cut a sub-agent off from its Harness's process, as it let the
/// process go: the lane ends Lost in these words (ADR 0103, decision 3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cut {
    /// The Person changed the Project's trust.
    Trust,
    /// The Harness's account changed.
    Account,
    /// Its Thread moved to another Harness entry, by its name.
    Moved(String),
}

impl Turns {
    fn asking(&self, turn: TurnId) -> bool {
        let of = Owner::Turn(turn);
        self.questions.values().any(|(owner, _)| *owner == of)
    }

    /// The Harness hears that nobody will answer the turn's Questions; a
    /// sub-agent's stay.
    fn release(&mut self, turn: TurnId) {
        self.release_of(Owner::Turn(turn));
    }

    /// The Harness hears that nobody will answer the sub-agent's Questions.
    fn release_lane(&mut self, sub: SubagentId) {
        self.release_of(Owner::Lane(sub));
    }

    fn release_of(&mut self, of: Owner) {
        let asked: Vec<ItemId> = self
            .questions
            .iter()
            .filter(|(_, (owner, _))| *owner == of)
            .map(|(item, _)| *item)
            .collect();
        for item in asked {
            if let Some((_, answer)) = self.questions.remove(&item) {
                let _ = answer.send(Answer::Cancelled);
            }
        }
    }

    /// Notes `cut` on each sub-agent at work that `whose` names; which
    /// they are.
    fn cut(&mut self, cut: &Cut, whose: impl Fn(&LaneHeld) -> bool) -> Vec<SubagentId> {
        let mut were = Vec::new();
        for (sub, held) in self.lanes.iter_mut().filter(|(_, held)| whose(held)) {
            held.cut = Some(cut.clone());
            were.push(*sub);
        }
        were
    }

    /// The sub-agents at work that `whose` names.
    fn lanes(&self, whose: impl Fn(&LaneHeld) -> bool) -> Vec<SubagentId> {
        let held = self.lanes.iter().filter(|(_, held)| whose(held));
        held.map(|(sub, _)| *sub).collect()
    }

    /// Stops sub-agents `subs` where their Harness lets Banda stop them
    /// alone, then tells it nobody will answer their Questions, as ACP
    /// asks of a client once it cancelled: a request left waiting would
    /// keep the lane heard after its session closed. The Thread sessions
    /// they work in, each once, to close.
    fn stop_lanes(&mut self, subs: &[SubagentId]) -> Vec<Session> {
        let mut sessions: Vec<Session> = Vec::new();
        for sub in subs {
            let Some(held) = self.lanes.get(sub) else {
                continue;
            };
            if let Some(session) = held.session.upgrade() {
                if let Err(error) = session.cancel_child(&held.child) {
                    tracing::info!(%error, "a sub-agent Banda cut off could not be stopped");
                }
                if !sessions.iter().any(|one| one.is(&session)) {
                    sessions.push(session);
                }
            }
            self.release_lane(*sub);
        }
        sessions
    }
}

impl Live {
    /// Hosts let go after `idle` with nothing to do; a turn the Agent
    /// went on with by itself ends after `quiet` with nothing said; each
    /// session gets `banda mcp` through `pipe`; each turn counts in
    /// `working` while it runs.
    pub fn new(idle: Duration, quiet: Duration, pipe: Option<Pipe>, working: Working) -> Live {
        Live {
            hosts: Hosts::new(idle),
            turns: Mutex::default(),
            changed: Notify::new(),
            quiet,
            pipe,
            passes: Mutex::default(),
            touches: Arc::default(),
            doings: Arc::default(),
            working,
            holds: Mutex::default(),
        }
    }

    /// The file each running turn works on now, by Project.
    pub fn touches(&self) -> &Arc<Touches> {
        &self.touches
    }

    /// What each running turn does now, by Project (ADR 0099, decision
    /// 11).
    pub fn doings(&self) -> &Arc<Doings> {
        &self.doings
    }

    /// `banda mcp` as `agent`'s session of `thread` in `project` starts it,
    /// with a new pass that names the Thread (ADR 0019; ADR 0083, decision
    /// 2), and the entry `harness`, which runs it, which the session's
    /// process holds while the session is open in it.
    pub fn banda(
        &self,
        project: &ModuleProject,
        agent: AgentId,
        thread: ThreadId,
        harness: &str,
    ) -> Option<(Program, Pass)> {
        self.pipe.as_ref()?.program(project, agent, thread, harness)
    }

    /// The variables that hand the `banda` in every shell of `harness`'s
    /// process in `project` a pass for its Agents, walled in `project` and
    /// naming no Thread: made the first time it is asked for in this run
    /// of the engine. None without a pipe.
    fn process_pass(&self, project: &ModuleProject, harness: &Harness) -> BTreeMap<String, String> {
        let Some(pipe) = &self.pipe else {
            return BTreeMap::new();
        };
        let mut passes = self.passes.lock().unwrap();
        let key = (project.id(), harness.id.clone());
        if let Some((variables, _)) = passes.get(&key) {
            return variables.clone();
        }
        let Some((variables, pass)) = pipe.variables(project, AgentId::new(), None, &harness.id)
        else {
            return BTreeMap::new();
        };
        passes.insert(key, (variables.clone(), pass));
        variables
    }

    /// How long a turn the Agent went on with by itself waits for more.
    pub fn quiet(&self) -> Duration {
        self.quiet
    }

    /// The process of `harness` for `project`, started if it is not
    /// running, with the pass its Agents' shells share, this `banda` first
    /// on its PATH, and the Project's trust as it is now: one started
    /// under the other is let go.
    ///
    /// It is one to start behind the fence, reading its sessions' extra
    /// roots there (ADR 0083, decision 1), and in the Project's folder once
    /// the Person trusts it: a trusted folder that is gone is said so
    /// before a process starts in it.
    pub async fn connection(
        &self,
        project: &ModuleProject,
        harness: &Harness,
    ) -> Result<Arc<Connection>, Failed> {
        let pass = self.process_pass(project, harness);
        let (id, data) = (project.id(), project.data());
        let (folder, trusted) = (project.folder(), project.trusted());
        if trusted && !folder.is_dir() {
            return Err(Failed::Lasting(format!(
                "The Project's folder {} is not there.",
                folder.display()
            )));
        }
        let holes = Holes {
            reads: kept::roots(data),
            ..Holes::default()
        };
        let mut started = harness.in_project(id, data, &folder, holes, &pass, trusted);
        if let Some(pipe) = &self.pipe {
            pipe.first_on_path(&mut started.env);
        }
        // The Person's GitHub token, which `gh` behind the fence cannot
        // read from the keyring, and their SSH agent go only to a Project
        // the Person said they trust (ADR 0083, F0-3).
        started.set_trust_said(project.trust_said()).await;
        let connection = (self.hosts)
            .get(project.id(), project.environment(), &started)
            .await?;
        connection.touch();
        Ok(connection)
    }

    /// Lets go of `thread`'s session in each process of `project` but
    /// `keep`'s, as one of its turns starts on `keep`: a Thread's session
    /// is open in one process only, the account it runs on now (ADR 0078).
    /// Its sub-agents at work elsewhere are cut off: stopped where they
    /// can be, their Questions let go, before the session closes (ADR
    /// 0103, decision 11). Those that ended are left as they are.
    pub async fn forget_elsewhere(&self, project: ProjectId, thread: ThreadId, keep: &Harness) {
        for (harness, connection) in self.hosts.running(project).await {
            if harness == keep.id {
                continue;
            }
            let moved = Cut::Moved(keep.name.clone());
            let stopped = {
                let mut turns = self.turns.lock().unwrap();
                let cut = turns.cut(&moved, |held| {
                    (held.project, held.thread) == (project, thread) && held.harness == harness
                });
                turns.stop_lanes(&cut)
            };
            self.changed.notify_waiters();
            // Theirs is the Thread's session, which closes now.
            drop(stopped);
            connection.forget_thread(thread).await;
        }
    }

    /// Lets go of `thread`'s session in each process of `project`, as its
    /// Person deleted the Thread, or moved it to another Project: what its
    /// Harness says between turns then has no Thread to go to here, and a
    /// moved Thread's next turn opens its session there.
    pub async fn forget_thread(&self, project: ProjectId, thread: ThreadId) {
        for (_, connection) in self.hosts.running(project).await {
            connection.forget_thread(thread).await;
        }
    }

    /// Holds `thread` for `why`, until what this answers is let go; or,
    /// while something holds it already, says what. So two moves of one
    /// Thread, as from two windows, never cross, and neither takes back the
    /// copy the other made; and a Thread is never deleted as it moves,
    /// which would leave its copy in the other Project, nor moves as it is
    /// deleted.
    pub fn hold(&self, thread: ThreadId, why: Hold) -> Result<Holding<'_>, Hold> {
        use std::collections::hash_map::Entry;
        match self.holds.lock().unwrap().entry(thread) {
            Entry::Occupied(held) => Err(*held.get()),
            Entry::Vacant(free) => {
                free.insert(why);
                Ok(Holding { live: self, thread })
            }
        }
    }

    /// The name of a Project's listener of the machine's accounts.
    pub const ACCOUNTS: &str = "accounts";

    /// Lets go of `project`'s process of each Harness whose account changed,
    /// as the machine says, until the Project closes (ADR 0040, decision 4).
    pub async fn let_go_as_accounts_change(
        self: Arc<Self>,
        project: ProjectId,
        mut heard: Listener,
    ) {
        loop {
            match heard.next().await {
                Ok(Some(event)) => {
                    // It starts again on its next turn, and its sub-agents
                    // at work end with it.
                    if let Some(harness) = &event.subject {
                        (self.turns.lock().unwrap()).cut(&Cut::Account, |held| {
                            held.project == project && held.harness == *harness
                        });
                        self.hosts.let_go(project, Some(harness));
                    }
                    if let Err(error) = heard.ack_through(event.seq).await {
                        tracing::warn!(%error, "a Project's place in the accounts was not kept");
                    }
                }
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(%error, "a Project no longer hears the machine's accounts");
                    return;
                }
            }
        }
    }

    /// Lets go of every process of `project`, as the Person's trust in it
    /// changed: a turn that runs keeps its own until it ends, and the next
    /// starts one that reads the Project as it is now. Its sub-agents at
    /// work end with it.
    pub fn let_go(&self, project: ProjectId) {
        (self.turns.lock().unwrap()).cut(&Cut::Trust, |held| held.project == project);
        self.hosts.let_go(project, None);
    }

    /// Stops every turn that runs on a Harness of `project`, and every
    /// sub-agent at work there, as the Project is removed, and lets go of
    /// its Harnesses. Nothing is written: the Project's data goes.
    pub async fn close(&self, project: ProjectId) {
        (self.passes.lock().unwrap()).retain(|(of, _), _| *of != project);
        let hosts = self.hosts.forget(project).await;
        let turns: Vec<TurnId> = (self.turns.lock().unwrap().running.iter())
            .filter(|(_, session)| hosts.iter().any(|host| session.runs_in(host)))
            .map(|(turn, _)| *turn)
            .collect();
        for turn in turns {
            if let Err(error) = self.stop(turn) {
                tracing::warn!(%error, "a turn of a removed Project could not be stopped");
            }
        }
        let cancelled = {
            let mut turns = self.turns.lock().unwrap();
            let lanes = turns.lanes(|held| held.project == project);
            turns.stop_lanes(&lanes)
        };
        self.changed.notify_waiters();
        // Its process goes with the last of `hosts`: a session no turn
        // runs in is closed first, so the Harness has its cancels by then.
        // One a turn runs in lives until that turn ends.
        for session in cancelled {
            if !session.prompting() {
                session.close().await;
            }
        }
        drop(hosts);
    }

    /// Why Banda cut sub-agent `sub` off, if it did while it worked.
    pub fn cut(&self, sub: SubagentId) -> Option<Cut> {
        let turns = self.turns.lock().unwrap();
        turns.lanes.get(&sub).and_then(|held| held.cut.clone())
    }

    /// A turn the engine runs, from now until the returned run is let go:
    /// what memory holds of it goes then, and it no longer counts as at
    /// work.
    pub fn open(self: &Arc<Self>, turn: TurnId) -> TurnRun {
        TurnRun {
            live: self.clone(),
            turn,
            _at_work: self.working.hold(),
        }
    }

    /// Sub-agent `sub` of `thread` in `project`, whose child session is
    /// `child`, works in `session`, its Thread's, from now until the
    /// returned run is let go: it counts as at work, keeps the process
    /// from being let go as idle, and holds the session weakly.
    pub fn lane(
        self: &Arc<Self>,
        project: ProjectId,
        thread: ThreadId,
        sub: SubagentId,
        child: &str,
        session: &Session,
    ) -> LaneRun {
        let held = LaneHeld {
            project,
            harness: session.harness().to_owned(),
            thread,
            child: child.to_owned(),
            session: session.downgrade(),
            cut: None,
        };
        self.hold_lane(sub, held, session.keep())
    }

    fn hold_lane(self: &Arc<Self>, sub: SubagentId, held: LaneHeld, kept: Held) -> LaneRun {
        self.turns.lock().unwrap().lanes.insert(sub, held);
        LaneRun {
            live: self.clone(),
            sub,
            _held: kept,
            _at_work: self.working.hold(),
        }
    }

    /// Marks that a message goes into the running turn.
    pub fn mark_steered(&self, turn: TurnId) {
        self.turns.lock().unwrap().steered.insert(turn);
    }

    /// Stops a turn the engine runs: its Harness hears the stop first, then
    /// that nobody will answer its Questions.
    pub fn stop(&self, turn: TurnId) -> Result<(), String> {
        let mut turns = self.turns.lock().unwrap();
        turns.cancelled.insert(turn);
        if let Some(session) = turns.running.get(&turn) {
            session.cancel()?;
        }
        turns.release(turn);
        self.changed.notify_waiters();
        Ok(())
    }

    /// Returns once the turn waits for no Person's answer.
    pub async fn answered(&self, turn: TurnId) {
        self.until(|turns| (!turns.asking(turn)).then_some(()))
            .await;
    }

    /// The session that runs the turn, once its prompt went to it.
    pub async fn begun(&self, turn: TurnId) -> Session {
        self.until(|turns| turns.running.get(&turn).cloned()).await
    }

    /// Waits until `ready` finds what it looks for in what runs now, which
    /// it is asked again each time that changes.
    async fn until<T>(&self, ready: impl Fn(&Turns) -> Option<T>) -> T {
        loop {
            // Listening before it looks, so no change between is missed:
            // `notify_waiters` reaches a listener made before it.
            let changed = self.changed.notified();
            if let Some(found) = ready(&self.turns.lock().unwrap()) {
                return found;
            }
            changed.await;
        }
    }

    /// Hands a Person's answer to the Harness: a choice, or a form's
    /// values. Whether it still waited.
    pub fn answer(&self, item: ItemId, choice: String, values: Option<Values>) -> bool {
        let waiting = self.turns.lock().unwrap().questions.remove(&item);
        self.changed.notify_waiters();
        let given = match values {
            Some(values) => Answer::Filled(values),
            None => Answer::Chose(choice),
        };
        waiting.is_some_and(|(_, answer)| answer.send(given).is_ok())
    }

    /// Lets go of Question `item`: the Harness hears nobody will answer
    /// it.
    fn forget_question(&self, item: ItemId) {
        if let Some((_, answer)) = self.turns.lock().unwrap().questions.remove(&item) {
            let _ = answer.send(Answer::Cancelled);
            self.changed.notify_waiters();
        }
    }

    /// Holds what a Person typed in a Question's secret fields until its
    /// answer goes to the Harness.
    pub fn keep_secret(&self, item: ItemId, secret: Values) {
        self.turns.lock().unwrap().secrets.insert(item, secret);
    }

    /// What a Person typed in a Question's secret fields, once.
    pub fn take_secret(&self, item: ItemId) -> Option<Values> {
        self.turns.lock().unwrap().secrets.remove(&item)
    }
}

/// A turn the engine runs, as memory holds it: letting it go ends it there,
/// with its Questions, however its task ended.
pub struct TurnRun {
    live: Arc<Live>,
    turn: TurnId,
    /// Counted as at work while it runs, a Question it waits on too.
    _at_work: AtWork,
}

impl TurnRun {
    /// The prompt went to the Harness in `session`, or the session went on
    /// with the turn by itself. A turn the session ran before no longer
    /// holds it, so a stop of that turn misses this one. If the turn was
    /// stopped while it started, the Harness hears the stop now.
    pub fn begin(&self, session: Session) {
        let mut turns = self.live.turns.lock().unwrap();
        if turns.cancelled.contains(&self.turn)
            && let Err(error) = session.cancel()
        {
            tracing::warn!(%error, "a stopped turn could not be cancelled");
        }
        turns.running.retain(|_, held| !held.is(&session));
        turns.running.insert(self.turn, session);
        self.live.changed.notify_waiters();
    }

    /// Stops the turn, as a stop from a Person does.
    pub fn stop(&self) -> Result<(), String> {
        self.live.stop(self.turn)
    }

    /// Whether the turn waits for a Person's answer.
    pub fn asking(&self) -> bool {
        self.live.turns.lock().unwrap().asking(self.turn)
    }

    /// Holds one of the turn's Questions until a Person answers it. False
    /// when the turn was stopped: the Harness hears at once that nobody
    /// will answer.
    pub fn ask(&self, item: ItemId, answer: oneshot::Sender<Answer>) -> bool {
        let mut turns = self.live.turns.lock().unwrap();
        if turns.cancelled.contains(&self.turn) {
            let _ = answer.send(Answer::Cancelled);
            return false;
        }
        turns
            .questions
            .insert(item, (Owner::Turn(self.turn), answer));
        true
    }

    /// Lets go of a Question that could not be written, or that the
    /// Harness took back.
    pub fn forget(&self, item: ItemId) {
        self.live.forget_question(item);
    }

    /// Whether a message went into the turn since the last time asked.
    pub fn take_steered(&self) -> bool {
        self.live.turns.lock().unwrap().steered.remove(&self.turn)
    }
}

/// The turn ended: memory lets go of it and its Questions.
impl Drop for TurnRun {
    fn drop(&mut self) {
        let mut turns = self.live.turns.lock().unwrap();
        turns.running.remove(&self.turn);
        turns.steered.remove(&self.turn);
        turns.cancelled.remove(&self.turn);
        turns.release(self.turn);
        self.live.changed.notify_waiters();
    }
}

/// A sub-agent at work, as memory holds it: letting it go, as it ends,
/// ends it there, with its Questions.
pub struct LaneRun {
    live: Arc<Live>,
    sub: SubagentId,
    /// Its process is not let go as idle while it works.
    _held: Held,
    /// Counted as at work while it works, a Question it waits on too.
    _at_work: AtWork,
}

impl LaneRun {
    /// Holds one of its Questions until a Person answers it, or it ends.
    pub fn ask(&self, item: ItemId, answer: oneshot::Sender<Answer>) -> bool {
        let mut turns = self.live.turns.lock().unwrap();
        turns
            .questions
            .insert(item, (Owner::Lane(self.sub), answer));
        true
    }

    /// Lets go of a Question that could not be written, or that the
    /// Harness took back.
    pub fn forget(&self, item: ItemId) {
        self.live.forget_question(item);
    }

    /// No message goes into a sub-agent (ADR 0103, decision 25).
    pub fn take_steered(&self) -> bool {
        false
    }
}

/// It ended: memory lets go of it and its Questions.
impl Drop for LaneRun {
    fn drop(&mut self) {
        let mut turns = self.live.turns.lock().unwrap();
        turns.lanes.remove(&self.sub);
        turns.release_lane(self.sub);
        self.live.changed.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_harnesses::hosts::Activity;

    fn live() -> Arc<Live> {
        live_counted(Working::new())
    }

    fn live_counted(working: Working) -> Arc<Live> {
        Arc::new(Live::new(
            Duration::from_secs(60),
            Duration::from_secs(60),
            None,
            working,
        ))
    }

    #[tokio::test]
    async fn a_turn_let_go_releases_its_questions() {
        let live = live();
        let run = live.open(TurnId::new());
        let (answer, answered) = oneshot::channel();
        assert!(run.ask(ItemId::new(), answer));
        assert!(run.asking());
        drop(run);
        assert!(matches!(answered.await, Ok(Answer::Cancelled)));
    }

    #[tokio::test]
    async fn a_stop_before_the_turn_runs_holds_until_it_is_let_go() {
        let live = live();
        let turn = TurnId::new();
        live.stop(turn).unwrap();
        let run = live.open(turn);
        let (answer, _) = oneshot::channel();
        assert!(
            !run.ask(ItemId::new(), answer),
            "a stopped turn asks nobody"
        );
        drop(run);
        let run = live.open(turn);
        let (answer, _) = oneshot::channel();
        assert!(run.ask(ItemId::new(), answer), "memory let go of the stop");
    }

    #[tokio::test]
    async fn a_turn_counts_as_at_work_until_it_is_let_go_its_question_too() {
        let working = Working::new();
        let count = working.count();
        let live = live_counted(working);
        let run = live.open(TurnId::new());
        let other = live.open(TurnId::new());
        assert_eq!(*count.borrow(), 2);
        let (answer, _) = oneshot::channel();
        assert!(run.ask(ItemId::new(), answer));
        drop(other);
        assert_eq!(*count.borrow(), 1, "it waits on its Person, at work");
        drop(run);
        assert_eq!(*count.borrow(), 0);
    }

    /// A sub-agent of `thread` in `project` at work on a process whose
    /// activity is `activity`, and of the Harness entry `harness`.
    fn lane(
        live: &Arc<Live>,
        (project, thread): (ProjectId, ThreadId),
        harness: &str,
        activity: &Activity,
    ) -> (SubagentId, LaneRun) {
        let sub = SubagentId::new();
        let held = LaneHeld {
            project,
            harness: harness.to_owned(),
            thread,
            child: format!("child-{sub}"),
            session: WeakSession::gone("root"),
            cut: None,
        };
        (sub, live.hold_lane(sub, held, activity.hold()))
    }

    #[tokio::test]
    async fn a_lanes_questions_go_with_the_lane_not_its_turn() {
        let live = live();
        let (turn, activity) = (TurnId::new(), Activity::default());
        let run = live.open(turn);
        let at = (ProjectId::new(), ThreadId::new());
        let (_, lane) = lane(&live, at, "fake", &activity);
        let (asked, mut answered) = oneshot::channel();
        assert!(lane.ask(ItemId::new(), asked));
        assert!(!run.asking(), "the turn waits on none of its own");
        tokio::time::timeout(Duration::from_secs(5), live.answered(turn))
            .await
            .expect("the turn is answered, whatever its sub-agent asks");
        // The turn ends: the sub-agent's Question still waits.
        drop(run);
        assert!(answered.try_recv().is_err(), "it still waits");
        // An answer reaches it.
        let item = ItemId::new();
        let (asked, answer) = oneshot::channel();
        assert!(lane.ask(item, asked));
        assert!(live.answer(item, "yes".to_owned(), None));
        assert!(matches!(answer.await, Ok(Answer::Chose(chose)) if chose == "yes"));
        // The sub-agent ends: nobody answers what it asked.
        drop(lane);
        assert!(matches!(answered.await, Ok(Answer::Cancelled)));
    }

    #[tokio::test]
    async fn a_lane_at_work_keeps_its_host_busy_and_the_machine_awake() {
        let working = Working::new();
        let count = working.count();
        let live = live_counted(working);
        let activity = Activity::default();
        let at = (ProjectId::new(), ThreadId::new());
        let (_, one) = lane(&live, at, "fake", &activity);
        let (_, two) = lane(&live, at, "fake", &activity);
        assert_eq!(*count.borrow(), 2);
        assert_eq!(activity.idle_since(), None, "not idle while one works");
        drop(one);
        assert_eq!(activity.idle_since(), None);
        assert_eq!(*count.borrow(), 1);
        drop(two);
        assert!(activity.idle_since().is_some(), "idle once none works");
        assert_eq!(*count.borrow(), 0);
    }

    #[tokio::test]
    async fn a_lane_on_a_process_let_go_holds_it_no_longer() {
        let live = live();
        let activity = Activity::default();
        let (project, other) = (ProjectId::new(), ProjectId::new());
        let (thread, elsewhere) = (ThreadId::new(), ThreadId::new());
        let (trusted, trusted_run) = lane(&live, (project, thread), "fake", &activity);
        let (signed, signed_run) = lane(&live, (other, elsewhere), "claude", &activity);
        let (moved, moved_run) = lane(&live, (other, thread), "codex", &activity);
        // The Person changes the Project's trust: its process goes, and
        // only its own sub-agents are cut off with it.
        live.let_go(project);
        assert_eq!(live.cut(trusted), Some(Cut::Trust));
        assert_eq!(live.cut(signed), None);
        // A Harness's account changes: its process's.
        let accounts = Cut::Account;
        (live.turns.lock().unwrap()).cut(&accounts, |held| held.harness == "claude");
        assert_eq!(live.cut(signed), Some(Cut::Account));
        assert_eq!(live.cut(moved), None);
        // Held only weakly: the process that is gone is not kept.
        let held = |sub| (live.turns.lock().unwrap().lanes[&sub].session).upgrade();
        assert!(held(moved).is_none());
        // Ended, a sub-agent is cut off no more, as memory let go of it.
        drop(trusted_run);
        assert_eq!(live.cut(trusted), None);
        // The Project removed stops the rest of its sub-agents: nobody
        // answers what they asked.
        let (asked, answered) = oneshot::channel();
        assert!(signed_run.ask(ItemId::new(), asked));
        live.close(other).await;
        assert!(matches!(answered.await, Ok(Answer::Cancelled)));
        drop((signed_run, moved_run));
        assert!(live.turns.lock().unwrap().lanes.is_empty());
    }
}
