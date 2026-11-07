//! What runs now, in memory: the Harness processes ([`Hosts`]), the turns
//! they run and the Questions they wait on. A restart loses it, and the
//! outbox settles what that cut short. A turn is held from [`Live::open`]
//! until its [`TurnRun`] is let go, however its task ends.
//!
//! One lock holds the running turns, the cancels and the Questions
//! together, so a stop that comes while a turn starts, or while it asks, is
//! never lost. Whether a turn was asked to stop is the turn's own state
//! (`agents_turns.stopping`), which the rules read; memory only keeps
//! whether its Harness was told.
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
//! keeps it. A Harness that takes variables for each session's shell, as
//! Claude Code's adapter does, gives a Thread's session its own over it,
//! the one its `banda mcp` has (`acp/opening.rs`). Like every pass, these
//! last until the engine stops, and so outlive the processes that hold
//! them.

use crate::Pipe;
use crate::acp::{Answer, Connection, Session};
use crate::model::{ItemId, ThreadId, TurnId, Values};
use crate::touching::Touches;
use banda_harnesses::Harness;
use banda_harnesses::hosts::Hosts;
use banda_harnesses::model::Program;
use banda_kernel::{AgentId, Heard, ModuleProject, ProjectId};
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
    /// hand it to `banda`, by Project and Harness entry.
    passes: Mutex<HashMap<(ProjectId, String), BTreeMap<String, String>>>,
    /// The file each running turn works on now.
    touches: Arc<Touches>,
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
    questions: HashMap<ItemId, (TurnId, oneshot::Sender<Answer>)>,
    /// What Persons typed in secret fields, until it goes to the Harness.
    /// Only memory holds it.
    secrets: HashMap<ItemId, Values>,
}

impl Turns {
    fn asking(&self, turn: TurnId) -> bool {
        self.questions.values().any(|(of, _)| *of == turn)
    }

    /// The Harness hears that nobody will answer the turn's Questions.
    fn release(&mut self, turn: TurnId) {
        let asked: Vec<ItemId> = self
            .questions
            .iter()
            .filter(|(_, (of, _))| *of == turn)
            .map(|(item, _)| *item)
            .collect();
        for item in asked {
            if let Some((_, answer)) = self.questions.remove(&item) {
                let _ = answer.send(Answer::Cancelled);
            }
        }
    }
}

impl Live {
    /// Hosts let go after `idle` with nothing to do; a turn the Agent
    /// went on with by itself ends after `quiet` with nothing said; each
    /// session gets `banda mcp` through `pipe`.
    pub fn new(idle: Duration, quiet: Duration, pipe: Option<Pipe>) -> Live {
        Live {
            hosts: Hosts::new(idle),
            turns: Mutex::default(),
            changed: Notify::new(),
            quiet,
            pipe,
            passes: Mutex::default(),
            touches: Arc::default(),
        }
    }

    /// The file each running turn works on now, by Project.
    pub fn touches(&self) -> &Arc<Touches> {
        &self.touches
    }

    /// `banda mcp` as a session of `agent`'s in `project` starts it, with a
    /// new pass (ADR 0019).
    pub fn banda(&self, project: &ModuleProject, agent: AgentId) -> Option<Program> {
        self.pipe.as_ref()?.program(project, agent)
    }

    /// The variables that hand the `banda` in every shell of `harness`'s
    /// process in `project` a pass for its Agents, walled in `project`:
    /// made the first time it is asked for in this run of the engine. None
    /// without a pipe.
    fn process_pass(&self, project: &ModuleProject, harness: &Harness) -> BTreeMap<String, String> {
        let Some(pipe) = &self.pipe else {
            return BTreeMap::new();
        };
        let mut passes = self.passes.lock().unwrap();
        let key = (project.id(), harness.id.clone());
        if let Some(variables) = passes.get(&key) {
            return variables.clone();
        }
        let Some(variables) = pipe.variables(project, AgentId::new()) else {
            return BTreeMap::new();
        };
        passes.insert(key, variables.clone());
        variables
    }

    /// How long a turn the Agent went on with by itself waits for more.
    pub fn quiet(&self) -> Duration {
        self.quiet
    }

    /// The process of `harness` for `project`, started if it is not
    /// running, with the pass its Agents' shells share, and the Project's
    /// trust as it is now: one started under the other is let go.
    pub async fn connection(
        &self,
        project: &ModuleProject,
        harness: &Harness,
    ) -> Result<Arc<Connection>, String> {
        let pass = self.process_pass(project, harness);
        let (id, data) = (project.id(), project.data());
        let started = harness.in_project(id, data, &pass, project.trusted());
        let connection = self.hosts.get(project.id(), &started).await?;
        connection.touch();
        Ok(connection)
    }

    /// Lets go of `thread`'s session in each process of `project` but
    /// `keep`'s, as one of its turns starts on `keep`: a Thread's session
    /// is open in one process only, the account it runs on now (ADR 0078).
    pub async fn forget_elsewhere(&self, project: ProjectId, thread: ThreadId, keep: &str) {
        for (harness, connection) in self.hosts.running(project).await {
            if harness != keep {
                connection.forget_thread(thread).await;
            }
        }
    }

    /// Lets go of `project`'s process of each Harness whose account changed,
    /// as the machine says, until the Project closes (ADR 0040, decision 4).
    pub async fn let_go_as_accounts_change(self: Arc<Self>, project: ProjectId, mut heard: Heard) {
        loop {
            match heard.next().await {
                Ok(Some(event)) => {
                    // It starts again on its next turn.
                    if let Some(harness) = &event.subject {
                        self.hosts.let_go(project, Some(harness));
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
    /// starts one that reads the Project as it is now.
    pub fn let_go(&self, project: ProjectId) {
        self.hosts.let_go(project, None);
    }

    /// Stops every turn that runs on a Harness of `project`, as the Project is
    /// removed, and lets go of its Harnesses.
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
    }

    /// A turn the engine runs, from now until the returned run is let go:
    /// what memory holds of it goes then.
    pub fn open(self: &Arc<Self>, turn: TurnId) -> TurnRun {
        TurnRun {
            live: self.clone(),
            turn,
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
        turns.questions.insert(item, (self.turn, answer));
        true
    }

    /// Lets go of a Question that could not be written, or that the
    /// Harness took back.
    pub fn forget(&self, item: ItemId) {
        if let Some((_, answer)) = self.live.turns.lock().unwrap().questions.remove(&item) {
            let _ = answer.send(Answer::Cancelled);
            self.live.changed.notify_waiters();
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn live() -> Arc<Live> {
        Arc::new(Live::new(
            Duration::from_secs(60),
            Duration::from_secs(60),
            None,
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
}
