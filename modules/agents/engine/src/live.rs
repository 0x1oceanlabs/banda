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
//! The Harness processes are one per Space and Harness entry: every Thread
//! on that Harness in that Space is a session in the one process. A host
//! with nothing to do is let go, and its Threads resume their sessions
//! when it starts again. After a sign-in every host of that Harness entry
//! is let go, so each reads the account again when it starts.

use crate::Pipe;
use crate::acp::{Answer, Connection, Session};
use crate::model::{ItemId, TurnId, Values};
use banda_harnesses::Harness;
use banda_harnesses::hosts::Hosts;
use banda_harnesses::model::Program;
use banda_kernel::{AgentId, Heard, ModuleSpace, SpaceId};
use std::collections::{HashMap, HashSet};
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
        }
    }

    /// `banda mcp` as a session of `agent`'s in `space` starts it, with a
    /// new pass (ADR 0019).
    pub fn banda(&self, space: &ModuleSpace, agent: AgentId) -> Option<Program> {
        self.pipe.as_ref()?.program(space, agent)
    }

    /// How long a turn the Agent went on with by itself waits for more.
    pub fn quiet(&self) -> Duration {
        self.quiet
    }

    /// The process of `harness` for `space`, started if it is not running.
    pub async fn connection(
        &self,
        space: SpaceId,
        harness: &Harness,
    ) -> Result<Arc<Connection>, String> {
        let connection = self.hosts.get(space, harness).await?;
        connection.touch();
        Ok(connection)
    }

    /// Lets go of `space`'s process of each Harness whose account changed,
    /// as the machine says, until the Space closes (ADR 0040, decision 4).
    pub async fn let_go_as_accounts_change(self: Arc<Self>, space: SpaceId, mut heard: Heard) {
        loop {
            match heard.next().await {
                Ok(Some(event)) => {
                    // It starts again on its next turn.
                    if let Some(harness) = &event.subject {
                        self.hosts.let_go(space, harness);
                    }
                }
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(%error, "a Space no longer hears the machine's accounts");
                    return;
                }
            }
        }
    }

    /// Stops every turn that runs on a Harness of `space`, as the Space is
    /// removed, and lets go of its Harnesses.
    pub async fn close(&self, space: SpaceId) {
        let hosts = self.hosts.forget(space).await;
        let turns: Vec<TurnId> = (self.turns.lock().unwrap().running.iter())
            .filter(|(_, session)| hosts.iter().any(|host| session.runs_in(host)))
            .map(|(turn, _)| *turn)
            .collect();
        for turn in turns {
            if let Err(error) = self.stop(turn) {
                tracing::warn!(%error, "a turn of a removed Space could not be stopped");
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
