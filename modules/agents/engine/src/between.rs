//! What a Harness does between a Thread's turns.
//!
//! Claude Code goes on by itself when a background task it started ends,
//! or when a wakeup fires, and its adapter says what it does then as it
//! says a turn's. Here that opens a turn of the Agent's own, whose message
//! is a notice from Banda. The turn ends when the Harness says what that
//! cost; when a turn's prompt goes to the session, which takes the prompt
//! into what it does; when a Person stops it; or after a minute in which it
//! says nothing and asks nothing.
//!
//! What the Harness used, and what it offers, are written at once between
//! turns too.

use crate::acp::{Between, Connection, Said, Session};
use crate::live::Live;
use crate::model::{
    Body, Fact, Failure, Item, ItemId, Opener, Settings, ThreadId, ToolStatus, TurnId, TurnState,
};
use crate::rules::{self, Ending};
use crate::turn::{self, Writer, plain};
use crate::{emit, store};
use banda_kernel::{AgentId, Error, ModuleSpace, Participant, Tx};
use std::collections::HashSet;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::mpsc;

/// How long a turn the Agent went on with by itself waits for more before
/// it ends, unless a tool call of it still runs or it asks a Person.
pub const QUIET: Duration = Duration::from_secs(60);

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
                // Nothing it asked is open between turns, and a tool call
                // that changes now belongs to a turn that ended, which shows
                // how it went: Claude Code ends a command it sent to the
                // background so.
                Said::Withdrawn(_) | Said::ToolChanged { .. } => Ok(()),
                said => self.went_on(connection, &session, said, &mut hear).await,
            };
            if let Err(error) = written {
                tracing::warn!(%error, "what a Harness said between turns could not be written");
            }
        }
    }

    /// The Harness went on by itself, starting with `first`: a turn of the
    /// Agent's own shows what it does, until it is done.
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
        let Some(Opened { turn, settings }) = opened else {
            return Ok(());
        };
        let id = turn.id;
        let _kept = connection.keep();
        self.live.begin(id, connection.clone(), session.clone());
        let mut writer = Writer::new(
            self.space.clone(),
            &turn,
            self.harness.clone(),
            settings,
            connection.running(session),
        );
        let (to_writer, mut written) = mpsc::unbounded_channel();
        let mut calls = Calls::default();
        calls.hear(&first);
        let _ = to_writer.send(first);
        let (live, harness) = (&self.live, &self.harness);
        let forward = async move {
            loop {
                tokio::select! {
                    next = hear.recv() => match next {
                        // The session's words are a turn's now, and the
                        // Harness takes that turn's prompt into what it does.
                        Some(Between::Prompted) => {
                            live.hand_over(id);
                            break Ending::new(TurnState::Done, None);
                        }
                        Some(Between::Said(said)) => {
                            if !calls.hear(&said) {
                                continue;
                            }
                            // Each time it goes on, it ends with what that cost.
                            let done = matches!(&said, Said::Used { usage, .. } if usage.cost.is_some());
                            let _ = to_writer.send(said);
                            if done {
                                break Ending::new(TurnState::Done, None);
                            }
                        }
                        None => break Ending::failed(
                            format!("{harness} stopped while it worked."),
                            Some(Failure::HarnessStopped),
                        ),
                    },
                    () = tokio::time::sleep(live.quiet()) => if !calls.running() && !live.asking(id) {
                        break Ending::new(TurnState::Done, None);
                    },
                }
            }
        };
        let (ending, listened) = tokio::join!(forward, writer.listen(live, &mut written));
        let ending = match listened {
            Ok(()) => ending,
            // What the Harness says cannot be written: it stops, unless a
            // turn's prompt took the session over.
            Err(reason) => {
                if !connection.prompting(session) {
                    let _ = connection.cancel(session);
                }
                Ending::failed(reason, None)
            }
        };
        let ending = ending.stopped_if_asked(self.live.end(id));
        self.space
            .write(move |tx| close(tx, agent, &turn, ending))
            .await
            .map_err(plain)
    }
}

/// The tool calls of a turn the Agent went on with by itself.
#[derive(Default)]
struct Calls {
    made: HashSet<String>,
    running: HashSet<String>,
}

impl Calls {
    /// Whether `said` belongs to the turn: a tool call changes in it only
    /// when it started in it.
    fn hear(&mut self, said: &Said) -> bool {
        match said {
            Said::ToolStarted { call, status, .. } => {
                self.made.insert(call.clone());
                self.track(call, *status);
            }
            Said::Asks { call, .. } => {
                self.made.insert(call.clone());
            }
            Said::ToolChanged { call, change, .. } => {
                if !self.made.contains(call) {
                    return false;
                }
                if let Some(status) = change.status {
                    self.track(call, status);
                }
            }
            _ => {}
        }
        true
    }

    fn track(&mut self, call: &str, status: ToolStatus) {
        match status {
            ToolStatus::Pending | ToolStatus::Running => self.running.insert(call.to_owned()),
            ToolStatus::Done | ToolStatus::Failed => self.running.remove(call),
        };
    }

    /// Whether one of them still runs.
    fn running(&self) -> bool {
        !self.running.is_empty()
    }
}

/// A turn of the Agent's own, as it opened.
struct Opened {
    turn: store::Turn,
    settings: Settings,
}

/// Opens a turn of the Agent's own in the Thread: its message is a notice
/// from Banda, and it runs from now. `None` when the Thread is gone.
fn open(
    tx: &mut Tx<'_>,
    thread: ThreadId,
    agent: AgentId,
    text: String,
) -> Result<Option<Opened>, Error> {
    if store::thread(tx.sql(), thread)?.is_none() {
        return Ok(None);
    }
    let by = Participant::Agent(agent);
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: ItemId::new(),
        state: TurnState::Running,
        opener: Opener::ByItself,
        from_thread: None,
    };
    let item = Item {
        id: turn.message,
        turn: None,
        author: by,
        at: tx.now(),
        body: Body::Notice { text: text.clone() },
    };
    store::insert_item(tx.sql(), thread, &item)?;
    let posted = Fact::NoticePosted {
        item: item.id,
        turn: turn.id,
        text,
    };
    emit(tx, by, thread, &posted)?;
    let settings = turn::add(tx, by, &turn)?;
    emit(tx, by, thread, &Fact::TurnStarted { turn: turn.id })?;
    Ok(Some(Opened { turn, settings }))
}

/// Ends each turn the Agent went on with by itself that a restart cut
/// short: no effect ran it, so nothing settled it.
pub fn cut_short(tx: &mut Tx<'_>) -> Result<(), Error> {
    for running in store::every_running(tx.sql())? {
        if running.opener.by_itself() {
            let agent = Participant::Agent(running.agent);
            turn::end(tx, agent, &running, Ending::cut_short())?;
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
