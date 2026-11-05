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
//! A Thread runs one turn at a time: what the Agent does by itself opens
//! its turn once the turn that ran has ended ([`Event::Open`]), and a turn
//! the outbox starts takes the Agent's own over. The writer (`writer.rs`)
//! makes and ends it.
//!
//! What the Harness used, and what it offers, are written at once between
//! turns too.

use crate::acp::{Between, Said, Session, WeakSession};
use crate::drive::drive;
use crate::live::Live;
use crate::model::{
    Body, Fact, Failure, Item, ItemId, Opener, Settings, ThreadId, ToolStatus, TurnId, TurnState,
};
use crate::rules::{Ending, Event};
use crate::transcript::{self, Transcript};
use crate::{emit, plain, store, writer};
use banda_kernel::{AgentId, Error, ModuleSpace, Participant, Tx};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// How long a turn the Agent went on with by itself waits for more before
/// it ends, unless a tool call of it still runs or it asks a Person.
pub const QUIET: Duration = Duration::from_secs(60);
/// How long what the Agent does by itself waits for the turn that ran to
/// be written as ended.
const ENDING: Duration = Duration::from_secs(10);

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
    pub fn hear(self, session: &Session) {
        let Some(hear) = session.between() else {
            return;
        };
        tokio::spawn(self.listen(session.downgrade(), hear));
    }

    async fn listen(self, session: WeakSession, mut hear: mpsc::UnboundedReceiver<Between>) {
        while let Some(heard) = hear.recv().await {
            let Between::Said(said) = heard else {
                continue;
            };
            let Some(session) = session.upgrade() else {
                return;
            };
            session.touch();
            let (thread, agent) = (self.thread, Participant::Agent(self.agent));
            let written = match said {
                Said::Used { usage, .. } => self
                    .space
                    .write(move |tx| transcript::used(tx, agent, thread, usage))
                    .await
                    .map_err(plain),
                Said::Runs(now) => self
                    .space
                    .write(move |tx| transcript::offered(tx, agent, thread, &now))
                    .await
                    .map_err(plain),
                // Nothing it asked is open between turns, and a tool call
                // that changes now belongs to a turn that ended, which shows
                // how it went: Claude Code ends a command it sent to the
                // background so.
                Said::Withdrawn(_) | Said::ToolChanged { .. } => Ok(()),
                said => self.went_on(&session, said, &mut hear).await,
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
        session: &Session,
        first: Said,
        hear: &mut mpsc::UnboundedReceiver<Between>,
    ) -> Result<(), String> {
        let Some(Opened { turn, settings }) = self.open(session).await? else {
            return Ok(());
        };
        let _kept = session.keep();
        let run = self.live.open(turn.id);
        run.begin(session.clone());
        let transcript = Transcript::new(
            self.space.clone(),
            &turn,
            self.harness.clone(),
            settings,
            session.running(),
        );
        let (to_writer, mut written) = mpsc::unbounded_channel();
        let mut calls = Calls::default();
        calls.hear(&first);
        let _ = to_writer.send(first);
        let (quiet, harness) = (self.live.quiet(), &self.harness);
        let asking = || run.asking();
        let forward = async move {
            loop {
                tokio::select! {
                    next = hear.recv() => match next {
                        // The session's words are a turn's now, and the
                        // Harness takes that turn's prompt into what it does.
                        Some(Between::Prompted) => break Ending::new(TurnState::Done, None),
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
                    () = tokio::time::sleep(quiet) => if !calls.running() && !asking() {
                        break Ending::new(TurnState::Done, None);
                    },
                }
            }
        };
        let ending = drive(&run, transcript, &mut written, forward).await;
        // Memory lets go of the turn before its end is written. Stopped,
        // if a Person asked, however the Harness ended it: the rules read
        // that from the turn.
        drop(run);
        self.space
            .write(move |tx| {
                // Unless it ended already, as one a turn the outbox
                // started took over.
                let agent = Participant::Agent(turn.agent);
                writer::tell(tx, agent, &turn, Event::End(ending))
            })
            .await
            .map_err(plain)
    }
}

impl Listener {
    /// Opens a turn of the Agent's own, once the turn that ran is written
    /// as ended: the Harness may go on before Banda wrote how that turn
    /// ended. `None` when the Thread is gone, or a turn's prompt took the
    /// session over meanwhile, whose turn what it says now is.
    async fn open(&self, session: &Session) -> Result<Option<Opened>, String> {
        let (thread, agent) = (self.thread, self.agent);
        let given_up = Instant::now() + ENDING;
        // Following the Thread's turn endings before the first try, so the
        // end is not missed between the two.
        let mut ended = self.space.committed(thread, &[writer::ENDED]);
        loop {
            let text = format!("{} went on by itself.", self.name);
            let opening = self
                .space
                .write(move |tx| open(tx, thread, agent, text))
                .await;
            // Refused: another turn runs in the Thread, and nothing was
            // written.
            match opening {
                Err(Error::Refused(_)) if session.prompting() => return Ok(None),
                // It tries again once a turn of the Thread is written as
                // ended.
                Err(Error::Refused(refused)) => {
                    if tokio::time::timeout_at(given_up, ended.next())
                        .await
                        .is_err()
                    {
                        return Err(refused.message);
                    }
                }
                opened => return opened.map_err(plain),
            }
        }
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
        state: TurnState::Queued,
        opener: Opener::ByItself,
        from_thread: None,
        stopping: false,
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
        turn: Some(turn.id),
        text,
    };
    emit(tx, by, thread, &posted)?;
    let (settings, step) = writer::make(tx, by, &turn, Event::Open, None)?;
    let turn = store::Turn {
        state: step.state,
        ..turn
    };
    Ok(Some(Opened { turn, settings }))
}

/// A restart is one event (ADR 0018, decision 3): each turn still running
/// was cut short. The outbox already settled the turns its effects ran,
/// and no effect has run since, so what runs now is the Agent's own.
pub fn cut_short(tx: &mut Tx<'_>) -> Result<(), Error> {
    for running in store::every_running(tx.sql())? {
        let agent = Participant::Agent(running.agent);
        writer::tell(tx, agent, &running, Event::CutShort)?;
    }
    Ok(())
}
