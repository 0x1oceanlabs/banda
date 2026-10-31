//! What a Harness does between a Thread's turns.
//!
//! Claude Code goes on by itself when a background task it started ends,
//! or when a wakeup fires, and its adapter says what it does then as it
//! says a turn's. Here that opens a turn of the Agent's own, whose message
//! is a notice from Bandaso. The turn ends with the cycle, when the Harness
//! says what the cycle cost; when a turn's prompt goes to the session,
//! which takes the prompt into what it does; when a Person stops it; or
//! after a minute in which it says nothing and asks nothing.
//!
//! What the Harness used, and what it offers, are written at once between
//! turns too.

use crate::acp::{Between, Connection, Said, Session};
use crate::live::Live;
use crate::model::{Body, Fact, Failure, Item, ItemId, Settings, ThreadId, TurnId, TurnState};
use crate::rules::{self, Ending};
use crate::turn::{self, Writer};
use crate::{emit, store};
use bandaso_kernel::{AgentId, Error, ModuleSpace, Participant, Tx};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::mpsc;

/// How long a turn the Agent started waits for more before it ends.
const QUIET: Duration = Duration::from_secs(60);

/// Who hears a Thread's session between its turns.
pub struct Listener {
    pub live: Arc<Live>,
    pub space: ModuleSpace,
    pub thread: ThreadId,
    pub agent: AgentId,
    /// The Agent's name and its Harness's, for plain words.
    pub name: String,
    pub harness: String,
}

impl Listener {
    /// Hears `session` from now on, unless someone already does. It stops
    /// when the Harness is gone, and never keeps one that is let go.
    pub fn hear(self, connection: &Arc<Connection>, session: &Session) {
        let Some(hear) = connection.between(session) else {
            return;
        };
        let (connection, session) = (Arc::downgrade(connection), session.clone());
        tokio::spawn(self.listen(connection, session, hear));
    }

    async fn listen(
        self,
        connection: Weak<Connection>,
        session: Session,
        mut hear: mpsc::UnboundedReceiver<Between>,
    ) {
        while let Some(heard) = hear.recv().await {
            let Between::Said(said) = heard else {
                continue;
            };
            let Some(connection) = connection.upgrade() else {
                return;
            };
            connection.touch();
            let (thread, agent) = (self.thread, Participant::Agent(self.agent));
            let written = match said {
                Said::Used { usage, .. } => self
                    .space
                    .write(move |tx| turn::used(tx, agent, thread, usage))
                    .await
                    .map_err(plain),
                Said::Runs(now) => self
                    .space
                    .write(move |tx| turn::offered(tx, agent, thread, &now))
                    .await
                    .map_err(plain),
                // Nothing it asked is open between turns.
                Said::Withdrawn(_) => Ok(()),
                said => self.went_on(connection, &session, said, &mut hear).await,
            };
            if let Err(error) = written {
                tracing::warn!(%error, "what a Harness said between turns could not be written");
            }
        }
    }

    /// The Harness went on by itself, starting with `first`: a turn of the
    /// Agent's own shows what it does, until the cycle ends.
    async fn went_on(
        &self,
        connection: Arc<Connection>,
        session: &Session,
        first: Said,
        hear: &mut mpsc::UnboundedReceiver<Between>,
    ) -> Result<(), String> {
        let (thread, agent) = (self.thread, self.agent);
        let text = format!("{} went on by itself.", self.name);
        let opened = self
            .space
            .write(move |tx| open(tx, thread, agent, text))
            .await
            .map_err(plain)?;
        let Some((turn, settings)) = opened else {
            return Ok(());
        };
        self.live
            .begin(turn.id, connection.clone(), session.clone());
        let running = connection.running(session);
        let mut writer = Writer::new(
            self.space.clone(),
            &turn,
            self.harness.clone(),
            settings,
            running,
        );
        let (said, mut heard) = mpsc::unbounded_channel();
        let _ = said.send(first);
        let (live, id, harness) = (&self.live, turn.id, &self.harness);
        let forward = async move {
            loop {
                tokio::select! {
                    heard = hear.recv() => match heard {
                        // The session's words are a turn's now, and the
                        // Harness takes that turn's prompt into what it does.
                        Some(Between::Prompted) => break Ending::new(TurnState::Done, None),
                        Some(Between::Said(now)) => {
                            let ended = matches!(&now, Said::Used { usage, .. } if usage.cost.is_some());
                            let _ = said.send(now);
                            if ended {
                                break Ending::new(TurnState::Done, None);
                            }
                        }
                        None => break Ending::failed(
                            format!("{harness} stopped while it worked."),
                            Some(Failure::HarnessStopped),
                        ),
                    },
                    () = tokio::time::sleep(QUIET) => if !live.asking(id) {
                        break Ending::new(TurnState::Done, None);
                    },
                }
            }
        };
        let (ending, written) = tokio::join!(forward, writer.listen(live, &mut heard));
        let ending = match written {
            Ok(()) => ending,
            // What the Harness says cannot be written: it stops.
            Err(reason) => {
                let _ = connection.cancel(session);
                Ending::failed(reason, None)
            }
        };
        let ending = match self.live.end(id) {
            true => Ending::new(TurnState::Stopped, None),
            false => ending,
        };
        self.space
            .write(move |tx| close(tx, agent, &turn, ending))
            .await
            .map_err(plain)
    }
}

/// Opens a turn of the Agent's own in the Thread: its message is a notice
/// from Bandaso, and it runs from now. `None` when the Thread is gone.
fn open(
    tx: &mut Tx<'_>,
    thread: ThreadId,
    agent: AgentId,
    text: String,
) -> Result<Option<(store::Turn, Settings)>, Error> {
    if store::thread(tx.sql(), thread)?.is_none() {
        return Ok(None);
    }
    let (by, now) = (Participant::Agent(agent), tx.now());
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: ItemId::new(),
        state: TurnState::Running,
    };
    let item = Item {
        id: turn.message,
        turn: None,
        author: by,
        at: now,
        body: Body::Notice { text: text.clone() },
    };
    store::insert_item(tx.sql(), thread, &item)?;
    let settings = store::settings(tx.sql(), thread)?;
    store::insert_turn(tx.sql(), &turn, by, now, &settings)?;
    store::touch_thread(tx.sql(), thread, now)?;
    let (item, id) = (item.id, turn.id);
    emit(
        tx,
        by,
        thread,
        &Fact::NoticePosted {
            item,
            turn: id,
            text,
        },
    )?;
    emit(
        tx,
        by,
        thread,
        &Fact::TurnQueued {
            turn: id,
            message: item,
        },
    )?;
    emit(tx, by, thread, &Fact::TurnStarted { turn: id })?;
    Ok(Some((turn, settings)))
}

/// Ends each turn the Agent went on with by itself that a restart cut
/// short: no effect ran it, so nothing settled it.
pub fn cut_short(tx: &mut Tx<'_>) -> Result<(), Error> {
    for running in store::every_running(tx.sql())? {
        if turn::by_itself(tx.sql(), &running)? {
            let reason = Some("Bandaso stopped while the Agent worked.");
            let ending = Ending::new(TurnState::Interrupted, reason);
            turn::end(tx, Participant::Agent(running.agent), &running, ending)?;
        }
    }
    Ok(())
}

/// Ends the Agent's own turn, unless it ended already.
fn close(tx: &mut Tx<'_>, agent: AgentId, turn: &store::Turn, ending: Ending) -> Result<(), Error> {
    let now = store::turn(tx.sql(), turn.id)?;
    if !now.is_some_and(|now| rules::ongoing(now.state)) {
        return Ok(());
    }
    turn::end(tx, Participant::Agent(agent), turn, ending)
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}
