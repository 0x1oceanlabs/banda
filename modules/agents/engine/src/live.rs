//! What runs now, in memory: the Harness processes ([`Hosts`]), the turns
//! they run and the Questions they wait on. A restart loses it, and the
//! outbox settles what that cut short.
//!
//! One lock holds the running turns, the stops and the Questions together,
//! so a stop that comes while a turn starts, or while it asks, is never lost.

use crate::acp::{Answer, Connection, Session};
use crate::hosts::Hosts;
use crate::model::{ItemId, TurnId, Values};
use crate::settings::Harness;
use bandaso_kernel::SpaceId;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

pub struct Live {
    hosts: Arc<Hosts>,
    turns: Mutex<Turns>,
}

#[derive(Default)]
struct Turns {
    running: HashMap<TurnId, (Arc<Connection>, Session)>,
    /// Turns a Person stopped. A turn that is still starting sees its stop
    /// when it begins.
    stopping: HashSet<TurnId>,
    questions: HashMap<ItemId, (TurnId, oneshot::Sender<Answer>)>,
}

impl Turns {
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
    /// Hosts let go after `idle` with nothing to do.
    pub fn new(idle: Duration) -> Live {
        Live {
            hosts: Hosts::new(idle),
            turns: Mutex::default(),
        }
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

    /// The turn's prompt went to the Harness in `session`. If a Person
    /// stopped the turn while it started, the Harness hears the stop now.
    pub fn begin(&self, turn: TurnId, connection: Arc<Connection>, session: Session) {
        let mut turns = self.turns.lock().unwrap();
        if turns.stopping.contains(&turn)
            && let Err(error) = connection.cancel(&session)
        {
            tracing::warn!(%error, "a stopped turn could not be cancelled");
        }
        turns.running.insert(turn, (connection, session));
    }

    /// A Person stops a turn the engine runs: its Harness hears the stop
    /// first, then that nobody will answer its Questions.
    pub fn stop(&self, turn: TurnId) -> Result<(), String> {
        let mut turns = self.turns.lock().unwrap();
        turns.stopping.insert(turn);
        if let Some((connection, session)) = turns.running.get(&turn) {
            connection.cancel(session)?;
        }
        turns.release(turn);
        Ok(())
    }

    /// Holds a Question until a Person answers it. False when the turn is
    /// stopping: the Harness hears at once that nobody will answer.
    pub fn ask(&self, turn: TurnId, item: ItemId, answer: oneshot::Sender<Answer>) -> bool {
        let mut turns = self.turns.lock().unwrap();
        if turns.stopping.contains(&turn) {
            let _ = answer.send(Answer::Cancelled);
            return false;
        }
        turns.questions.insert(item, (turn, answer));
        true
    }

    /// Lets go of a Question that could not be written.
    pub fn forget(&self, item: ItemId) {
        if let Some((_, answer)) = self.turns.lock().unwrap().questions.remove(&item) {
            let _ = answer.send(Answer::Cancelled);
        }
    }

    /// Hands a Person's answer to the Harness: a choice, or a form's
    /// values. Whether it still waited.
    pub fn answer(&self, item: ItemId, choice: String, values: Option<Values>) -> bool {
        let waiting = self.turns.lock().unwrap().questions.remove(&item);
        let given = match values {
            Some(values) => Answer::Filled(values),
            None => Answer::Chose(choice),
        };
        waiting.is_some_and(|(_, answer)| answer.send(given).is_ok())
    }

    /// The turn ended: lets go of it and its Questions. Whether a Person
    /// stopped it.
    pub fn end(&self, turn: TurnId) -> bool {
        let mut turns = self.turns.lock().unwrap();
        turns.running.remove(&turn);
        turns.release(turn);
        turns.stopping.remove(&turn)
    }
}
