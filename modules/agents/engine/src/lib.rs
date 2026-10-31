//! The agents module: a Person works with Agents in Threads (ADR 0001,
//! decision 10).
//!
//! - **Agents** are text files in the Space, and the **Harness list** is a
//!   text file of the machine ([`settings`]).
//! - **Threads, turns and Questions** are this module's tables and facts
//!   ([`model`]). A message queues a turn; the outbox runs a Thread's turns
//!   one at a time, and Threads run side by side.
//! - **Harnesses** are reached through ACP, one process per Space and
//!   Harness entry (`hosts.rs`). ACP's words stop in `acp.rs`.
//!
//! | Method | Right | What it does |
//! |---|---|---|
//! | `agents.harnesses` | read | the Harnesses this machine can start |
//! | `agents.list` | read | the Space's Agents |
//! | `agents.create` | manage | a new Agent: `{name, harness}` |
//! | `agents.threads` | read | Threads, the latest first: `{agent?}` |
//! | `agents.thread` | read | one Thread as a view: `{thread}` |
//! | `agents.send` | write | a message that queues a turn: `{agent, thread?, text}` |
//! | `agents.stop` | write | stops a turn: `{turn}` |
//! | `agents.answer` | decide | answers a Question: `{item, choice}` |

mod acp;
mod hosts;
mod live;
pub mod model;
mod rules;
pub mod settings;
mod store;
mod turn;

use bandaso_kernel::{
    AgentId, Call, Effect, Error, Module, ModuleSpace, OnRestart, Outcome, Participant, Refusal,
    Right, Settled, Tx, decode,
};
use live::Live;
use model::{
    Body, Fact, Item, ItemId, ThreadId, ThreadList, ThreadSummary, ThreadView, TurnId, TurnState,
    VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use settings::Harnesses;
use std::fmt::Display;
use std::sync::Arc;
use std::time::Duration;
use ts_rs::TS;
use turn::{ReplyEffect, TurnEffect};

pub struct Agents {
    harnesses: Harnesses,
    live: Arc<Live>,
}

impl Agents {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            live: Arc::new(Live::new(hosts::IDLE)),
        }
    }

    /// Lets a Harness process go after `idle` with nothing to do, instead
    /// of half an hour.
    pub fn idle_after(mut self, idle: Duration) -> Self {
        self.live = Arc::new(Live::new(idle));
        self
    }
}

enum Method {
    Harnesses,
    List,
    Create,
    Threads,
    Thread,
    Send,
    Stop,
    Answer,
}

impl Method {
    fn parse(name: &str) -> Option<Method> {
        Some(match name {
            "harnesses" => Method::Harnesses,
            "list" => Method::List,
            "create" => Method::Create,
            "threads" => Method::Threads,
            "thread" => Method::Thread,
            "send" => Method::Send,
            "stop" => Method::Stop,
            "answer" => Method::Answer,
            _ => return None,
        })
    }

    fn right(&self) -> Right {
        match self {
            Method::Harnesses | Method::List | Method::Threads | Method::Thread => Right::Read,
            Method::Create => Right::Manage,
            Method::Send | Method::Stop => Right::Write,
            Method::Answer => Right::Decide,
        }
    }
}

#[derive(Deserialize)]
struct Create {
    name: String,
    harness: String,
}

#[derive(Deserialize)]
struct Threads {
    #[serde(default)]
    agent: Option<AgentId>,
}

#[derive(Deserialize)]
struct OneThread {
    thread: ThreadId,
}

#[derive(Deserialize)]
struct Send {
    agent: AgentId,
    #[serde(default)]
    thread: Option<ThreadId>,
    text: String,
}

/// What `agents.send` answers.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Sent {
    pub thread: ThreadId,
    pub turn: TurnId,
    pub item: ItemId,
}

#[derive(Deserialize)]
struct Stop {
    turn: TurnId,
}

#[derive(Deserialize)]
struct Answer {
    item: ItemId,
    choice: String,
}

fn value(answer: impl Serialize) -> Result<Value, Refusal> {
    Ok(serde_json::to_value(answer).map_err(Error::from)?)
}

/// Writes one of the module's facts about `subject`.
fn emit(
    tx: &mut Tx<'_>,
    author: Participant,
    subject: impl Display,
    fact: &Fact,
) -> Result<(), Error> {
    let mut both = serde_json::to_value(fact)?;
    let kind = both["kind"].as_str().unwrap_or_default().to_owned();
    let payload = both["payload"].take();
    tx.emit(&kind, VERSION, Some(&subject.to_string()), author, &payload)?;
    Ok(())
}

#[async_trait::async_trait]
impl Module for Agents {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn migrations(&self) -> &'static [&'static str] {
        store::MIGRATIONS
    }

    fn right(&self, method: &str) -> Option<Right> {
        Method::parse(method).map(|m| m.right())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        let method =
            Method::parse(method).ok_or_else(|| Refusal::invalid("agents has no such method."))?;
        let space = call.space();
        match method {
            Method::Harnesses => value(self.harnesses.views()),
            Method::List => value(settings::agents(space.folder())?),
            Method::Create => {
                let Create { name, harness } = decode(params)?;
                if self.harnesses.find(&harness).is_none() {
                    return Err(Refusal::invalid(format!(
                        "This computer has no Harness named \"{harness}\"."
                    )));
                }
                let (folder, author) = (space.folder().to_owned(), call.participant());
                call.command(move |tx| {
                    // The module writes its own settings: the Agent's file
                    // and its fact come from one command.
                    let agent = settings::create(&folder, &name, &harness)?;
                    let fact = Fact::AgentCreated {
                        agent: agent.id,
                        name: agent.name.clone(),
                        harness: agent.harness.clone(),
                    };
                    emit(tx, author, agent.id, &fact)?;
                    Ok(serde_json::to_value(agent)?)
                })
                .await
            }
            Method::Threads => {
                let Threads { agent } = decode(params)?;
                let (at, threads) = space.view(move |sql| store::threads(sql, agent)).await?;
                value(ThreadList { at, threads })
            }
            Method::Thread => {
                let OneThread { thread } = decode(params)?;
                let (at, found) = space
                    .view(move |sql| {
                        let Some(summary) = store::thread(sql, thread)? else {
                            return Ok(None);
                        };
                        let items = store::items(sql, thread)?;
                        Ok(Some((summary, items, store::turns(sql, thread)?)))
                    })
                    .await?;
                let (thread, items, turns) =
                    found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
                value(ThreadView {
                    at,
                    thread,
                    items,
                    turns,
                })
            }
            Method::Send => {
                let Send {
                    agent,
                    thread,
                    text,
                } = decode(params)?;
                if text.trim().is_empty() {
                    return Err(Refusal::invalid("A message needs some text."));
                }
                settings::agent(space.folder(), agent)?;
                let author = call.participant();
                call.command(move |tx| send(tx, author, agent, thread, text))
                    .await
            }
            Method::Stop => {
                let Stop { turn } = decode(params)?;
                call.command(move |tx| stop(tx, turn)).await
            }
            Method::Answer => {
                let Answer { item, choice } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| answer(tx, author, item, choice))
                    .await
            }
        }
    }

    async fn run(&self, space: ModuleSpace, effect: Effect) -> Outcome {
        match effect.kind.as_str() {
            turn::START => turn::start(&self.live, &self.harnesses, space, &effect).await,
            turn::STOP => turn::stop(&self.live, space, &effect).await,
            turn::REPLY => turn::reply(&self.live, &effect),
            other => Outcome::Fail(format!("agents runs no effect of kind {other}")),
        }
    }

    /// Every effect of this module dies with the Harness's process.
    fn on_restart(&self, _kind: &str) -> OnRestart {
        OnRestart::Abandon
    }

    fn settle(&self, tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
        turn::settle(tx, effect, settled)
    }
}

/// A message to an Agent, in its Thread or in a new one, and a turn that
/// waits behind the Thread's earlier turns.
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    agent: AgentId,
    thread: Option<ThreadId>,
    text: String,
) -> Result<Value, Error> {
    let now = tx.now();
    let thread = match thread {
        Some(id) => {
            let found = store::thread(tx.sql(), id)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            if found.agent != agent {
                return Err(Refusal::invalid("This Thread belongs to another Agent.").into());
            }
            id
        }
        None => {
            let summary = ThreadSummary {
                id: ThreadId::new(),
                agent,
                title: rules::title(&text),
                updated_at: now,
            };
            store::insert_thread(tx.sql(), &summary, author)?;
            let fact = Fact::ThreadStarted {
                thread: summary.id,
                agent,
                title: summary.title.clone(),
            };
            emit(tx, author, summary.id, &fact)?;
            summary.id
        }
    };
    let item = Item {
        id: ItemId::new(),
        turn: None,
        author,
        at: now,
        body: Body::Message { text: text.clone() },
    };
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: item.id,
        state: TurnState::Queued,
    };
    store::insert_item(tx.sql(), thread, &item)?;
    store::insert_turn(tx.sql(), &turn, author, now)?;
    store::touch_thread(tx.sql(), thread, now)?;
    let sent = Sent {
        thread,
        turn: turn.id,
        item: item.id,
    };
    let fact = Fact::MessagePosted {
        item: item.id,
        turn: turn.id,
        text,
    };
    emit(tx, author, thread, &fact)?;
    tx.enqueue(
        turn::START,
        &thread.to_string(),
        &TurnEffect { turn: turn.id },
    )?;
    Ok(serde_json::to_value(sent)?)
}

/// Stops a turn: at once if it waits, through the Harness if it runs.
fn stop(tx: &mut Tx<'_>, turn: TurnId) -> Result<Value, Error> {
    let found =
        store::turn(tx.sql(), turn)?.ok_or_else(|| Refusal::not_found("There is no such turn."))?;
    match rules::stop(found.state) {
        rules::Stop::Now => {
            turn::end(tx, &found, TurnState::Stopped, None)?;
        }
        rules::Stop::AskHarness => {
            tx.enqueue(turn::STOP, &turn.to_string(), &TurnEffect { turn })?;
        }
        rules::Stop::Nothing => {}
    }
    Ok(Value::Null)
}

/// A Person's answer to a Question. It goes to the Harness from the outbox.
fn answer(
    tx: &mut Tx<'_>,
    author: Participant,
    item: ItemId,
    choice: String,
) -> Result<Value, Error> {
    let (thread, mut found) = store::item(tx.sql(), item)?
        .ok_or_else(|| Refusal::not_found("There is no such Question."))?;
    rules::answer(&mut found.body, &choice)?;
    store::set_body(tx.sql(), item, &found.body)?;
    let fact = Fact::QuestionAnswered {
        item,
        choice: choice.clone(),
    };
    emit(tx, author, thread, &fact)?;
    tx.enqueue(
        turn::REPLY,
        &item.to_string(),
        &ReplyEffect { item, choice },
    )?;
    Ok(Value::Null)
}
