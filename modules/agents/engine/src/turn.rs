//! Running turns. Each of the module's effects is here:
//!
//! - `turn.start`, keyed by the Agent, so one Agent works through one turn
//!   at a time and the rest wait in order: the outbox is the Agent's queue.
//! - `turn.stop`, keyed by the turn: it asks the Harness to stop.
//! - `question.reply`, keyed by the Question, so an answer never waits
//!   behind the turn that asked.
//!
//! Each one dies with the Harness's process, so a restart abandons it and
//! [`settle`] writes what that means.

use crate::acp::{Answer, Ending, Said};
use crate::live::Live;
use crate::model::{
    Body, Fact, Item, ItemId, QuestionState, ThreadId, ToolKind, ToolStatus, TurnId, TurnState,
    TurnView,
};
use crate::rules::{self, Piece, Pieces, Text};
use crate::settings::{self, Harnesses};
use crate::{emit, store};
use bandaso_kernel::{AgentId, Effect, Error, ModuleSpace, Outcome, Participant, Settled, Tx};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

pub const START: &str = "turn.start";
pub const STOP: &str = "turn.stop";
pub const REPLY: &str = "question.reply";

/// How long pieces of a reply gather before they are written together.
const GATHER: Duration = Duration::from_millis(80);
/// How long a Harness may take to stop a turn that cannot go on.
const STOPPING: Duration = Duration::from_secs(10);

#[derive(Serialize, Deserialize)]
pub struct TurnEffect {
    pub turn: TurnId,
}

#[derive(Serialize, Deserialize)]
pub struct ReplyEffect {
    pub item: ItemId,
    pub choice: String,
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Ends a turn: its state, its Questions that never got an answer, and the
/// fact that it ended.
pub fn end(tx: &mut Tx<'_>, turn: &store::Turn, view: TurnView) -> Result<(), Error> {
    let agent = Participant::Agent(turn.agent);
    for mut item in store::open_questions(tx.sql(), turn.id)? {
        rules::close(&mut item.body);
        store::set_body(tx.sql(), item.id, &item.body)?;
        emit(
            tx,
            agent,
            turn.thread,
            &Fact::QuestionClosed { item: item.id },
        )?;
    }
    store::set_turn(tx.sql(), &view)?;
    store::touch_thread(tx.sql(), turn.thread, tx.now())?;
    let ended = Fact::TurnEnded {
        turn: view.id,
        state: view.state,
        reason: view.reason,
    };
    emit(tx, agent, turn.thread, &ended)
}

/// Writes what it means that one of the module's effects will not run to
/// its end.
pub fn settle(tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
    match effect.kind.as_str() {
        START => {
            let start: TurnEffect = serde_json::from_value(effect.payload.clone())?;
            let Some(turn) = store::turn(tx.sql(), start.turn)? else {
                return Ok(());
            };
            if !rules::ongoing(turn.state) {
                return Ok(());
            }
            let (state, reason) = match settled {
                Settled::Abandoned => (
                    TurnState::Interrupted,
                    "Bandaso stopped while the Agent worked.".to_owned(),
                ),
                Settled::Failed(reason) => (TurnState::Failed, reason.clone()),
            };
            let view = TurnView {
                id: turn.id,
                state,
                reason: Some(reason),
            };
            end(tx, &turn, view)
        }
        REPLY => {
            let reply: ReplyEffect = serde_json::from_value(effect.payload.clone())?;
            let Some((thread, mut item)) = store::item(tx.sql(), reply.item)? else {
                return Ok(());
            };
            if !rules::close(&mut item.body) {
                return Ok(());
            }
            store::set_body(tx.sql(), item.id, &item.body)?;
            let agent = store::agent_of(tx.sql(), thread)?;
            let author = agent.map_or(item.author, Participant::Agent);
            emit(tx, author, thread, &Fact::QuestionClosed { item: item.id })
        }
        _ => Ok(()),
    }
}

/// Hands a Person's answer to the Harness that waits for it.
pub fn reply(live: &Live, effect: &Effect) -> Outcome {
    let Ok(reply) = serde_json::from_value::<ReplyEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The answer could not be read.".to_owned());
    };
    if live.answer(reply.item, reply.choice) {
        Outcome::Done
    } else {
        Outcome::Fail("The turn that asked has ended.".to_owned())
    }
}

/// Asks the Harness to stop a running turn.
pub async fn stop(live: &Live, space: ModuleSpace, effect: &Effect) -> Outcome {
    let Ok(stop) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The stop could not be read.".to_owned());
    };
    let state = space
        .read(move |sql| Ok(store::turn(sql, stop.turn)?.map(|t| t.state)))
        .await;
    match state {
        Ok(Some(state)) if rules::ongoing(state) => match live.stop(stop.turn) {
            Ok(()) => Outcome::Done,
            Err(error) => Outcome::Retry(error),
        },
        Ok(_) => Outcome::Done,
        Err(error) => Outcome::Retry(error.to_string()),
    }
}

/// Runs one turn to its end, and writes how it ended.
pub async fn start(
    live: &Live,
    harnesses: &Harnesses,
    space: ModuleSpace,
    effect: &Effect,
) -> Outcome {
    let Ok(start) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The turn could not be read.".to_owned());
    };
    let begun = space
        .write(move |tx| {
            let Some(turn) = store::turn(tx.sql(), start.turn)? else {
                return Ok(None);
            };
            // A turn stopped while it waited never runs.
            if !rules::may_start(turn.state) {
                return Ok(None);
            }
            let running = TurnView {
                id: turn.id,
                state: TurnState::Running,
                reason: None,
            };
            store::set_turn(tx.sql(), &running)?;
            let text = match store::item(tx.sql(), turn.message)? {
                Some((
                    _,
                    Item {
                        body: Body::Message { text },
                        ..
                    },
                )) => text,
                _ => String::new(),
            };
            let started = Fact::TurnStarted { turn: turn.id };
            emit(tx, Participant::Agent(turn.agent), turn.thread, &started)?;
            Ok(Some((turn, text)))
        })
        .await;
    let (turn, text) = match begun {
        Ok(Some(begun)) => begun,
        Ok(None) => return Outcome::Done,
        Err(error) => return Outcome::Retry(error.to_string()),
    };
    let ending = work(live, harnesses, &space, &turn, &text).await;
    let stopped = live.end(turn.id);
    let (state, reason) = match ending {
        Ok(Ending {
            state: TurnState::Stopped,
            ..
        }) => rules::cancelled(stopped),
        Ok(Ending { state, reason }) => (state, reason),
        Err(reason) => (TurnState::Failed, Some(reason)),
    };
    let view = TurnView {
        id: turn.id,
        state,
        reason,
    };
    match space.write(move |tx| end(tx, &turn, view)).await {
        Ok(()) => Outcome::Done,
        // The outbox settles it as failed.
        Err(error) => Outcome::Fail(error.to_string()),
    }
}

async fn work(
    live: &Live,
    harnesses: &Harnesses,
    space: &ModuleSpace,
    turn: &store::Turn,
    text: &str,
) -> Result<Ending, String> {
    let agent = settings::agent(space.folder(), turn.agent).map_err(|r| r.message)?;
    let harness = harnesses
        .find(&agent.harness)
        .ok_or_else(|| format!("This computer has no Harness named \"{}\".", agent.harness))?;
    let connection = live.connection(agent.id, harness).await?;
    let (session, opened) = connection.session(turn.thread, space.folder()).await?;
    if let Some(evidence) = opened {
        let thread = turn.thread;
        space
            .write(move |tx| store::set_evidence(tx.sql(), thread, &evidence))
            .await
            .map_err(plain)?;
    }
    let (mut hear, mut done) = connection.prompt(&session, text);
    live.begin(turn.id, connection.clone(), session.clone());
    let mut writer = Writer::new(space.clone(), turn);
    if let Err(reason) = writer.listen(live, &mut hear).await {
        // What the Harness says cannot be written: the turn stops and fails.
        let _ = connection.cancel(&session);
        if tokio::time::timeout(STOPPING, &mut done).await.is_err() {
            done.abort();
        }
        return Err(reason);
    }
    match done.await {
        Ok(ending) => ending.map_err(|error| format!("The Harness stopped the turn: {error}")),
        Err(_) => Err("The turn's task ended.".to_owned()),
    }
}

/// Writes what the Harness says into the Thread.
struct Writer {
    space: ModuleSpace,
    thread: ThreadId,
    turn: TurnId,
    agent: AgentId,
    pieces: Pieces,
    /// The Harness's tool call IDs and the items that show them.
    tools: HashMap<String, (ItemId, String)>,
    due: Option<Instant>,
}

impl Writer {
    fn new(space: ModuleSpace, turn: &store::Turn) -> Writer {
        Writer {
            space,
            thread: turn.thread,
            turn: turn.id,
            agent: turn.agent,
            pieces: Pieces::default(),
            tools: HashMap::new(),
            due: None,
        }
    }

    /// Writes what the Harness says until it ends the turn.
    async fn listen(
        &mut self,
        live: &Live,
        hear: &mut mpsc::UnboundedReceiver<Said>,
    ) -> Result<(), String> {
        loop {
            let due = self.due;
            let gathered = async move {
                match due {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                biased;
                said = hear.recv() => match said {
                    Some(said) => self.hear(live, said).await?,
                    None => break,
                },
                () = gathered => self.write_gathered().await?,
            }
        }
        self.close().await
    }

    async fn hear(&mut self, live: &Live, said: Said) -> Result<(), String> {
        match said {
            Said::Reply(text) => self.gather(Text::Reply, &text).await,
            Said::Thought(text) => self.gather(Text::Thought, &text).await,
            Said::ToolStarted {
                call,
                title,
                tool,
                status,
            } => {
                self.close().await?;
                self.start_tool(call, title, tool, status).await
            }
            Said::ToolChanged {
                call,
                title,
                status,
            } => {
                self.close().await?;
                let Some((id, known)) = self.tools.get_mut(&call) else {
                    let title = title.unwrap_or_else(|| "A tool".to_owned());
                    let status = status.unwrap_or(ToolStatus::Running);
                    return self.start_tool(call, title, ToolKind::Other, status).await;
                };
                if let Some(title) = &title {
                    known.clone_from(title);
                }
                let id = *id;
                self.change_tool(id, title, status).await
            }
            Said::Asks {
                call,
                title,
                offered,
                answer,
            } => {
                self.close().await?;
                let choices = rules::choices(offered);
                if choices.is_empty() {
                    let _ = answer.send(Answer::Cancelled);
                    return Err(
                        "The Harness offered only answers it would keep for next time; \
                         a Person decides each time."
                            .to_owned(),
                    );
                }
                let title = title
                    .or_else(|| self.tools.get(&call).map(|(_, t)| t.clone()))
                    .unwrap_or_else(|| "The Agent asks before it goes on.".to_owned());
                let id = ItemId::new();
                // Held before it is written, so an answer finds it.
                if !live.ask(self.turn, id, answer) {
                    return Ok(());
                }
                let asked = Fact::QuestionAsked {
                    item: id,
                    turn: self.turn,
                    title: title.clone(),
                    choices: choices.clone(),
                };
                let body = Body::Question {
                    title,
                    choices,
                    state: QuestionState::Open,
                    answer: None,
                };
                let written = self.put(id, body, asked).await;
                if written.is_err() {
                    live.forget(id);
                }
                written
            }
        }
    }

    async fn start_tool(
        &mut self,
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
    ) -> Result<(), String> {
        let id = ItemId::new();
        self.tools.insert(call, (id, title.clone()));
        let started = Fact::ToolStarted {
            item: id,
            turn: self.turn,
            title: title.clone(),
            tool,
            status,
        };
        let body = Body::Tool {
            title,
            tool,
            status,
        };
        self.put(id, body, started).await
    }

    async fn change_tool(
        &self,
        id: ItemId,
        title: Option<String>,
        status: Option<ToolStatus>,
    ) -> Result<(), String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        self.space
            .write(move |tx| {
                if let Some((_, mut item)) = store::item(tx.sql(), id)?
                    && let Body::Tool {
                        title: shown,
                        status: now,
                        ..
                    } = &mut item.body
                {
                    if let Some(title) = &title {
                        shown.clone_from(title);
                    }
                    if let Some(status) = status {
                        *now = status;
                    }
                    store::set_body(tx.sql(), id, &item.body)?;
                }
                let changed = Fact::ToolChanged {
                    item: id,
                    title,
                    status,
                };
                emit(tx, agent, thread, &changed)
            })
            .await
            .map_err(plain)
    }

    async fn gather(&mut self, kind: Text, text: &str) -> Result<(), String> {
        if let Some(ended) = self.pieces.add(kind, text, ItemId::new()) {
            self.write(ended).await?;
        }
        if self.due.is_none() {
            self.due = Some(Instant::now() + GATHER);
        }
        Ok(())
    }

    async fn write_gathered(&mut self) -> Result<(), String> {
        self.due = None;
        match self.pieces.take() {
            Some(piece) => self.write(piece).await,
            None => Ok(()),
        }
    }

    /// Writes what is gathered and ends the open item.
    async fn close(&mut self) -> Result<(), String> {
        self.due = None;
        match self.pieces.close() {
            Some(piece) => self.write(piece).await,
            None => Ok(()),
        }
    }

    async fn write(&self, Piece { item, kind, text }: Piece) -> Result<(), String> {
        let grew = kind.grew(item, self.turn, text.clone());
        self.put(item, kind.body(text), grew).await
    }

    /// Writes an item, or a piece of one, and the fact of it.
    async fn put(&self, id: ItemId, body: Body, fact: Fact) -> Result<(), String> {
        let (thread, turn, agent) = (self.thread, self.turn, Participant::Agent(self.agent));
        self.space
            .write(move |tx| {
                let item = Item {
                    id,
                    turn: Some(turn),
                    author: agent,
                    at: tx.now(),
                    body,
                };
                store::put(tx.sql(), thread, &item)?;
                store::touch_thread(tx.sql(), thread, tx.now())?;
                emit(tx, agent, thread, &fact)
            })
            .await
            .map_err(plain)
    }
}
