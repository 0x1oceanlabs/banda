//! Running turns. Each of the module's effects is here:
//!
//! - `turn.start`, keyed by the Thread, so a Thread's turns run one at a
//!   time and in order, while Threads run side by side: the outbox is each
//!   Thread's queue.
//! - `turn.stop`, keyed by the turn: it asks the Harness to stop.
//! - `question.reply`, keyed by the Question, so an answer never waits
//!   behind the turn that asked.
//!
//! Each one dies with the Harness's process, so a restart abandons it and
//! [`settle`] writes what that means.
//!
//! A turn starts by setting the session's options to the Thread's settings.
//! A Harness with modes of its own enforces the mode; for any other, the
//! turn answers the Harness's Questions by the mode where the mode allows,
//! and asks the Person otherwise.

use crate::acp::{Answer, Opened, Running, Said};
use crate::live::Live;
use crate::model::{
    Body, Fact, Failure, Item, ItemId, Mode, QuestionState, Settings, ThreadId, ToolContent,
    ToolKind, ToolStatus, TurnId, TurnState,
};
use crate::rules::{self, Ending, Piece, Pieces, Text};
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
    /// What the Person filled in, for a form Question, but its secret
    /// fields: [`Live`] holds those.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<crate::model::Values>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secret: bool,
}

fn plain(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Ends a turn: its state, its Questions that never got an answer, and the
/// fact that it ended.
pub fn end(tx: &mut Tx<'_>, turn: &store::Turn, ending: Ending) -> Result<(), Error> {
    let Ending {
        state,
        reason,
        failure,
    } = ending;
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
    store::set_turn(tx.sql(), turn.id, state, reason.as_deref(), failure)?;
    store::touch_thread(tx.sql(), turn.thread, tx.now())?;
    let ended = Fact::TurnEnded {
        turn: turn.id,
        state,
        reason,
        failure,
    };
    emit(tx, agent, turn.thread, &ended)
}

/// Writes a line from Bandaso into the Thread.
fn notice(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    turn: TurnId,
    text: String,
) -> Result<(), Error> {
    let item = Item {
        id: ItemId::new(),
        turn: Some(turn),
        author: agent,
        at: tx.now(),
        body: Body::Notice { text: text.clone() },
    };
    store::put(tx.sql(), thread, &item)?;
    let fact = Fact::NoticePosted {
        item: item.id,
        turn,
        text,
    };
    emit(tx, agent, thread, &fact)
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
            let ending = match settled {
                Settled::Abandoned => Ending::new(
                    TurnState::Interrupted,
                    Some("Bandaso stopped while the Agent worked."),
                ),
                Settled::Failed(reason) => Ending::failed(reason.clone(), None),
            };
            end(tx, &turn, ending)
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
    let mut values = reply.values;
    if reply.secret {
        // Only memory held the secret: after a restart it is gone, and
        // so is the turn that asked.
        let Some(secret) = live.take_secret(reply.item) else {
            return Outcome::Fail("The turn that asked has ended.".to_owned());
        };
        values.get_or_insert_default().extend(secret);
    }
    if live.answer(reply.item, reply.choice, values) {
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
            store::set_turn(tx.sql(), turn.id, TurnState::Running, None, None)?;
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
            let settings = store::turn_settings(tx.sql(), &turn)?;
            let started = Fact::TurnStarted { turn: turn.id };
            emit(tx, Participant::Agent(turn.agent), turn.thread, &started)?;
            Ok(Some((turn, text, settings)))
        })
        .await;
    let (turn, text, settings) = match begun {
        Ok(Some(begun)) => begun,
        Ok(None) => return Outcome::Done,
        Err(error) => return Outcome::Retry(error.to_string()),
    };
    let ending = work(live, harnesses, &space, &turn, &text, settings).await;
    let ending = ending.stop_asked(live.end(turn.id));
    match space.write(move |tx| end(tx, &turn, ending)).await {
        Ok(()) => Outcome::Done,
        // The outbox settles it as failed.
        Err(error) => Outcome::Fail(error.to_string()),
    }
}

/// Runs the turn's prompt; how it ended, or why it could not run.
async fn work(
    live: &Live,
    harnesses: &Harnesses,
    space: &ModuleSpace,
    turn: &store::Turn,
    text: &str,
    settings: Settings,
) -> Ending {
    match prompt(live, harnesses, space, turn, text, settings).await {
        Ok(ending) | Err(ending) => ending,
    }
}

async fn prompt(
    live: &Live,
    harnesses: &Harnesses,
    space: &ModuleSpace,
    turn: &store::Turn,
    text: &str,
    settings: Settings,
) -> Result<Ending, Ending> {
    let unplanned = |reason: String| Ending::failed(reason, None);
    let agent = settings::agent(space.folder(), turn.agent).map_err(|r| unplanned(r.message))?;
    let harness = harnesses.find(&agent.harness).ok_or_else(|| {
        unplanned(format!(
            "This computer has no Harness named \"{}\".",
            agent.harness
        ))
    })?;
    let connection = live
        .connection(space.id(), harness)
        .await
        .map_err(|reason| Ending::failed(reason, Some(Failure::HarnessStopped)))?;
    let thread = turn.thread;
    let earlier = space
        .read(move |sql| store::evidence(sql, thread))
        .await
        .map_err(|e| unplanned(plain(e)))?;
    let (session, opened) = connection
        .session(thread, space.folder(), earlier.as_ref())
        .await?;
    if let Opened::New { evidence, lost } = opened {
        let (id, agent) = (turn.id, Participant::Agent(turn.agent));
        let name = harness.name.clone();
        space
            .write(move |tx| {
                store::set_evidence(tx.sql(), thread, &evidence)?;
                if lost {
                    let text = format!(
                        "{name} could not pick up this Thread's earlier conversation, \
                         so it starts afresh and does not remember what was said before."
                    );
                    notice(tx, agent, thread, id, text)?;
                }
                Ok(())
            })
            .await
            .map_err(|e| unplanned(plain(e)))?;
    }
    let (running, refused) = connection.settle(&session, &settings).await;
    let (id, agent, offer) = (
        turn.id,
        Participant::Agent(turn.agent),
        running.offer.clone(),
    );
    space
        .write(move |tx| {
            offered(tx, agent, thread, offer)?;
            for text in refused {
                notice(tx, agent, thread, id, text)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| unplanned(plain(e)))?;
    let (mut hear, mut done) = connection.prompt(&session, text);
    live.begin(turn.id, connection.clone(), session.clone());
    let mut writer = Writer::new(space.clone(), turn, harness.name.clone(), settings, running);
    if let Err(reason) = writer.listen(live, &mut hear).await {
        // What the Harness says cannot be written: the turn stops and fails.
        let _ = connection.cancel(&session);
        if tokio::time::timeout(STOPPING, &mut done).await.is_err() {
            done.abort();
        }
        return Err(unplanned(reason));
    }
    let ending = done
        .await
        .unwrap_or_else(|_| unplanned("The turn's task ended.".to_owned()));
    Ok(ending.resets(writer.resets))
}

/// Writes what the Harness offers in the Thread, when that changed.
fn offered(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    offer: crate::model::Offer,
) -> Result<(), Error> {
    if store::offer(tx.sql(), thread)? == offer {
        return Ok(());
    }
    store::set_offer(tx.sql(), thread, &offer)?;
    emit(tx, agent, thread, &Fact::ThreadOffered { thread, offer })
}

/// The Harness started or left its plan by itself, as Claude Code does
/// when a plan is accepted: the Thread's settings follow, and its mode
/// only if the Harness moved that too.
fn switched(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    ran: &Running,
    now: &Running,
) -> Result<(), Error> {
    let before = store::settings(tx.sql(), thread)?;
    let mut settings = before.clone();
    settings.plan = now.plan;
    if now.mode != ran.mode
        && let Some(mode) = now.mode
    {
        settings.mode = mode;
    }
    if settings == before {
        return Ok(());
    }
    store::set_settings(tx.sql(), thread, &settings)?;
    emit(
        tx,
        agent,
        thread,
        &Fact::ThreadConfigured { thread, settings },
    )
}

/// A tool call the Thread shows.
struct Shown {
    item: ItemId,
    title: String,
    kind: ToolKind,
    /// How much of what it printed the Thread holds, and whether it holds
    /// no more.
    kept: usize,
    cut: bool,
    /// What it printed that is not written yet.
    waiting: String,
}

/// Writes what the Harness says into the Thread.
struct Writer {
    space: ModuleSpace,
    thread: ThreadId,
    turn: TurnId,
    agent: AgentId,
    /// The Harness's name, for plain words.
    harness: String,
    /// What the turn started with, and what the session runs with now.
    settings: Settings,
    running: Running,
    pieces: Pieces,
    /// The tool calls the Thread shows, by the Harness's IDs.
    tools: HashMap<String, Shown>,
    /// The open Questions it asked, by the Harness's IDs for them.
    asked: HashMap<String, ItemId>,
    due: Option<Instant>,
    /// When the account may be used again, if the Harness said it reached
    /// its limit.
    resets: Option<i64>,
}

impl Writer {
    fn new(
        space: ModuleSpace,
        turn: &store::Turn,
        harness: String,
        settings: Settings,
        running: Running,
    ) -> Writer {
        Writer {
            space,
            thread: turn.thread,
            turn: turn.id,
            agent: turn.agent,
            harness,
            settings,
            running,
            pieces: Pieces::default(),
            tools: HashMap::new(),
            asked: HashMap::new(),
            due: None,
            resets: None,
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
                content,
            } => {
                self.close().await?;
                self.start_tool(call, title, tool, status, content).await
            }
            Said::ToolChanged {
                call,
                title,
                status,
                content,
                output,
                exit,
            } => {
                let (mut title, mut status, mut content) = (title, status, content);
                if !self.tools.contains_key(&call) {
                    self.close().await?;
                    let started = title.take().unwrap_or_else(|| "A tool".to_owned());
                    let now = status.take().unwrap_or(ToolStatus::Running);
                    let shows = content.take().unwrap_or_default();
                    self.start_tool(call.clone(), started, ToolKind::Other, now, shows)
                        .await?;
                }
                let shown = self.tools.get_mut(&call).expect("started above");
                if let Some(text) = output {
                    shown.waiting.push_str(&text);
                    self.due.get_or_insert_with(|| Instant::now() + GATHER);
                }
                if title.is_none() && status.is_none() && content.is_none() && exit.is_none() {
                    return Ok(());
                }
                if let Some(title) = &title {
                    shown.title.clone_from(title);
                }
                let id = shown.item;
                // What it printed comes before how it ended.
                self.write_output().await?;
                self.change_tool(id, title, status, content, exit).await
            }
            Said::Asks {
                call,
                title,
                tool,
                offered,
                form,
                answer,
            } => {
                self.close().await?;
                let known = self.tools.get(&call);
                let tool = tool.or(known.map(|shown| shown.kind));
                // A form asks what only the Person knows: no mode answers it.
                if form.is_none()
                    && !self.running.native
                    && rules::disposition(self.settings.mode, tool.unwrap_or(ToolKind::Other))
                        == rules::Disposition::Allow
                    && let Some(once) = rules::allow_once(&offered)
                {
                    let _ = answer.send(Answer::Chose(once.to_owned()));
                    return Ok(());
                }
                let title = title
                    .or_else(|| known.map(|shown| shown.title.clone()))
                    .unwrap_or_else(|| "The Agent asks before it goes on.".to_owned());
                let choices = rules::choices(offered);
                if choices.is_empty() {
                    let _ = answer.send(Answer::Cancelled);
                    return Err("The Harness asked without offering any answer.".to_owned());
                }
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
                    form: form.clone(),
                };
                let body = Body::Question {
                    title,
                    choices,
                    form,
                    state: QuestionState::Open,
                    answer: None,
                    values: None,
                };
                let written = self.put(id, body, asked).await;
                if written.is_err() {
                    live.forget(id);
                } else {
                    self.asked.insert(call, id);
                }
                written
            }
            Said::Withdrawn(call) => {
                let Some(id) = self.asked.remove(&call) else {
                    return Ok(());
                };
                live.forget(id);
                let (thread, agent) = (self.thread, Participant::Agent(self.agent));
                self.space
                    .write(move |tx| {
                        let Some((_, mut item)) = store::item(tx.sql(), id)? else {
                            return Ok(());
                        };
                        if !rules::close(&mut item.body) {
                            return Ok(());
                        }
                        store::set_body(tx.sql(), id, &item.body)?;
                        emit(tx, agent, thread, &Fact::QuestionClosed { item: id })
                    })
                    .await
                    .map_err(plain)
            }
            Said::Notice(text) => {
                self.close().await?;
                let id = ItemId::new();
                let posted = Fact::NoticePosted {
                    item: id,
                    turn: self.turn,
                    text: text.clone(),
                };
                self.put(id, Body::Notice { text }, posted).await
            }
            Said::Resets(at) => {
                self.resets = Some(at);
                Ok(())
            }
            Said::Runs(now) => {
                self.close().await?;
                let ran = std::mem::replace(&mut self.running, now.clone());
                let planned = now.native && now.plan != ran.plan;
                // A mode it moved to by itself, not leaving a plan, is not
                // the Person's choice: the Thread keeps theirs, and says so.
                let moved = (now.native && !planned && now.mode != ran.mode).then(|| {
                    let runs = now.mode.map_or("a mode of its own", Mode::name);
                    format!("{} switched itself to {runs} for this turn.", self.harness)
                });
                let (thread, agent, turn) =
                    (self.thread, Participant::Agent(self.agent), self.turn);
                self.space
                    .write(move |tx| {
                        if planned {
                            switched(tx, agent, thread, &ran, &now)?;
                        }
                        if let Some(text) = moved {
                            notice(tx, agent, thread, turn, text)?;
                        }
                        offered(tx, agent, thread, now.offer)
                    })
                    .await
                    .map_err(plain)
            }
        }
    }

    async fn start_tool(
        &mut self,
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<ToolContent>,
    ) -> Result<(), String> {
        let id = ItemId::new();
        let shown = Shown {
            item: id,
            title: title.clone(),
            kind: tool,
            kept: 0,
            cut: false,
            waiting: String::new(),
        };
        self.tools.insert(call, shown);
        let content = rules::kept(content);
        let started = Fact::ToolStarted {
            item: id,
            turn: self.turn,
            title: title.clone(),
            tool,
            status,
            content: content.clone(),
        };
        let body = Body::Tool {
            title,
            tool,
            status,
            content,
            output: None,
        };
        self.put(id, body, started).await
    }

    async fn change_tool(
        &self,
        id: ItemId,
        title: Option<String>,
        status: Option<ToolStatus>,
        content: Option<Vec<ToolContent>>,
        exit: Option<i32>,
    ) -> Result<(), String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        let content = content.map(rules::kept);
        self.space
            .write(move |tx| {
                if let Some((_, mut item)) = store::item(tx.sql(), id)?
                    && let Body::Tool {
                        title: shown,
                        status: now,
                        content: shows,
                        output,
                        ..
                    } = &mut item.body
                {
                    if let Some(title) = &title {
                        shown.clone_from(title);
                    }
                    if let Some(status) = status {
                        *now = status;
                    }
                    if let Some(content) = &content {
                        shows.clone_from(content);
                    }
                    if exit.is_some() {
                        output.get_or_insert_default().exit = exit;
                    }
                    store::set_body(tx.sql(), id, &item.body)?;
                }
                let changed = Fact::ToolChanged {
                    item: id,
                    title,
                    status,
                    content,
                    exit,
                };
                emit(tx, agent, thread, &changed)
            })
            .await
            .map_err(plain)
    }

    /// Writes what each command printed since the last time, as far as the
    /// Thread keeps it.
    async fn write_output(&mut self) -> Result<(), String> {
        let mut printed = Vec::new();
        for shown in self.tools.values_mut() {
            if shown.waiting.is_empty() {
                continue;
            }
            let waiting = std::mem::take(&mut shown.waiting);
            if shown.cut {
                continue;
            }
            let text = rules::fit(&waiting, rules::OUTPUT_KEPT - shown.kept).to_owned();
            shown.kept += text.len();
            shown.cut = text.len() < waiting.len();
            printed.push((shown.item, text, shown.cut));
        }
        if printed.is_empty() {
            return Ok(());
        }
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        self.space
            .write(move |tx| {
                for (id, text, cut) in printed {
                    if let Some((_, mut item)) = store::item(tx.sql(), id)?
                        && let Body::Tool { output, .. } = &mut item.body
                    {
                        let output = output.get_or_insert_default();
                        output.text.push_str(&text);
                        output.cut |= cut;
                        store::set_body(tx.sql(), id, &item.body)?;
                    }
                    let fact = Fact::ToolOutput {
                        item: id,
                        text,
                        cut,
                    };
                    emit(tx, agent, thread, &fact)?;
                }
                Ok(())
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
        if let Some(piece) = self.pieces.take() {
            self.write(piece).await?;
        }
        self.write_output().await
    }

    /// Writes what is gathered and ends the open item.
    async fn close(&mut self) -> Result<(), String> {
        self.due = None;
        if let Some(piece) = self.pieces.close() {
            self.write(piece).await?;
        }
        self.write_output().await
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
