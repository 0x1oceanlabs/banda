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
//! | `agents.defaults` | read | what an Agent's new Threads start with: `{agent}` |
//! | `agents.send` | write | a message that queues a turn: `{agent, thread?, text, settings?}` |
//! | `agents.configure` | write | the Thread's settings, from its next turn on: `{thread, settings}` |
//! | `agents.stop` | write | stops a turn: `{turn}` |
//! | `agents.retry` | write | tries a failed turn's message again: `{turn}` |
//! | `agents.answer` | decide | answers a Question: `{item, choice, values?}`; `values` fill its form |

mod acp;
mod hosts;
mod images;
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
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use images::Images;
use live::Live;
use model::{
    Body, Fact, Image, ImageId, Item, ItemId, Offer, Settings, ThreadId, ThreadList, ThreadSummary,
    ThreadView, TurnId, TurnState, VERSION,
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
    Defaults,
    Send,
    Configure,
    Stop,
    Retry,
    Answer,
    Attach,
    Image,
}

impl Method {
    fn parse(name: &str) -> Option<Method> {
        Some(match name {
            "harnesses" => Method::Harnesses,
            "list" => Method::List,
            "create" => Method::Create,
            "threads" => Method::Threads,
            "thread" => Method::Thread,
            "defaults" => Method::Defaults,
            "send" => Method::Send,
            "configure" => Method::Configure,
            "stop" => Method::Stop,
            "retry" => Method::Retry,
            "answer" => Method::Answer,
            "attach" => Method::Attach,
            "image" => Method::Image,
            _ => return None,
        })
    }

    fn right(&self) -> Right {
        match self {
            Method::Harnesses
            | Method::List
            | Method::Threads
            | Method::Thread
            | Method::Defaults
            | Method::Image => Right::Read,
            Method::Create => Right::Manage,
            Method::Send | Method::Stop | Method::Retry | Method::Attach => Right::Write,
            // How freely an Agent acts decides what it asks a Person.
            Method::Configure | Method::Answer => Right::Decide,
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
struct OneAgent {
    agent: AgentId,
}

#[derive(Deserialize)]
struct Send {
    agent: AgentId,
    #[serde(default)]
    thread: Option<ThreadId>,
    #[serde(default)]
    text: String,
    /// The images it carries, each added with `agents.attach` first.
    #[serde(default)]
    images: Vec<ImageId>,
    /// What a new Thread starts with, instead of the Agent's defaults; or
    /// the Thread's settings from this turn on.
    #[serde(default)]
    settings: Option<Settings>,
}

/// An image a message will carry: its kind, its bytes in base64, and the
/// name of its file.
#[derive(Deserialize)]
struct Attach {
    mime: String,
    data: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct OneImage {
    image: ImageId,
}

/// What `agents.image` answers: an image's kind and its bytes in base64.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ImageData {
    pub mime: String,
    pub data: String,
}

#[derive(Deserialize)]
struct Configure {
    thread: ThreadId,
    settings: Settings,
}

/// What `agents.defaults` answers: what an Agent's new Threads start with,
/// and what its Harness last offered.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Defaults {
    pub settings: Settings,
    pub offer: Offer,
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
struct OneTurn {
    turn: TurnId,
}

#[derive(Deserialize)]
struct Answer {
    item: ItemId,
    choice: String,
    #[serde(default)]
    values: Option<model::Values>,
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
                        Ok(Some(ThreadView {
                            at: 0,
                            items: store::items(sql, thread)?,
                            turns: store::turns(sql, thread)?,
                            settings: store::settings(sql, thread)?,
                            offer: store::offer(sql, thread)?,
                            usage: store::usage(sql, thread)?,
                            thread: summary,
                        }))
                    })
                    .await?;
                let view = found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
                value(ThreadView { at, ..view })
            }
            Method::Defaults => {
                let OneAgent { agent } = decode(params)?;
                let agents = settings::agents(space.folder())?;
                let found = agents
                    .iter()
                    .find(|a| a.id == agent)
                    .ok_or_else(|| Refusal::not_found("There is no such Agent in this Space."))?;
                // What this Agent's Harness offered, in its own Threads first.
                let mut asked = vec![found.id];
                asked.extend(
                    agents
                        .iter()
                        .filter(|a| a.harness == found.harness && a.id != found.id)
                        .map(|a| a.id),
                );
                let offer = space
                    .read(move |sql| {
                        for agent in asked {
                            if let Some(offer) = store::latest_offer(sql, agent)? {
                                return Ok(offer);
                            }
                        }
                        Ok(Offer::default())
                    })
                    .await?;
                // What the composer shows is what the new Thread gets: the
                // Agent's settings, and the Harness's values where it has none.
                let mut settings = found.settings.clone();
                for option in &offer.options {
                    settings
                        .options
                        .entry(option.id.clone())
                        .or_insert_with(|| option.value.clone());
                }
                value(Defaults { settings, offer })
            }
            Method::Send => {
                let Send {
                    agent,
                    thread,
                    text,
                    images,
                    settings,
                } = decode(params)?;
                rules::may_send(&text, &images)?;
                let found = settings::agent(space.folder(), agent)?;
                let author = call.participant();
                if settings.is_some() {
                    rules::may_choose(author)?;
                }
                let settings = match (thread, settings) {
                    (None, None) => Some(found.settings),
                    (_, settings) => settings,
                };
                let message = Message { text, images };
                call.command(move |tx| send(tx, author, agent, thread, message, settings))
                    .await
            }
            Method::Configure => {
                let Configure { thread, settings } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| {
                    store::thread(tx.sql(), thread)?
                        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
                    configure(tx, author, thread, settings)?;
                    Ok(Value::Null)
                })
                .await
            }
            Method::Stop => {
                let OneTurn { turn } = decode(params)?;
                call.command(move |tx| stop(tx, turn)).await
            }
            Method::Retry => {
                let OneTurn { turn } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| retry(tx, author, turn)).await
            }
            Method::Answer => {
                let Answer {
                    item,
                    choice,
                    values,
                } = decode(params)?;
                let author = call.participant();
                let live = self.live.clone();
                call.command(move |tx| answer(tx, &live, author, item, choice, values))
                    .await
            }
            Method::Attach => {
                let Attach { mime, data, name } = decode(params)?;
                let bytes = BASE64
                    .decode(data.as_bytes())
                    .map_err(|_| Refusal::invalid("The image's bytes are not base64."))?;
                rules::may_attach(&mime, &bytes)?;
                let image = Image {
                    id: ImageId::new(),
                    mime,
                    size: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
                    name,
                };
                let images = Images::of(space.folder());
                // The file first: a row never names bytes that are not
                // there. A file left without a row goes with the sweep.
                images.keep(image.id, bytes).await.map_err(Error::from)?;
                let author = call.participant();
                let kept = call
                    .command(move |tx| {
                        store::attach_image(tx.sql(), &image, author, tx.now())?;
                        Ok(serde_json::to_value(&image)?)
                    })
                    .await;
                tokio::spawn(sweep(space.clone(), images));
                kept
            }
            Method::Image => {
                let OneImage { image } = decode(params)?;
                let kind = space.read(move |sql| store::image_kind(sql, image)).await?;
                let gone = || Refusal::not_found("There is no such image.");
                let mime = kind.ok_or_else(gone)?;
                let bytes = Images::of(space.folder())
                    .read(image)
                    .await
                    .map_err(|_| gone())?;
                value(ImageData {
                    mime,
                    data: BASE64.encode(bytes),
                })
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

/// Changes a Thread's settings, if they differ. Its next turn runs with them.
fn configure(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    settings: Settings,
) -> Result<(), Error> {
    if store::settings(tx.sql(), thread)? == settings {
        return Ok(());
    }
    store::set_settings(tx.sql(), thread, &settings)?;
    emit(
        tx,
        author,
        thread,
        &Fact::ThreadConfigured { thread, settings },
    )
}

/// What a Person writes to an Agent: text, images, or both.
/// Lets go of the images no message took within a day: their rows, then
/// their files. A file whose row went first is swept the next time.
async fn sweep(space: ModuleSpace, images: Images) {
    let found = space
        .write(|tx| {
            let last = images::UNSENT_LAST.as_millis() as i64;
            let gone = store::drop_unsent_images(tx.sql(), tx.now() - last)?;
            Ok((gone, store::image_ids(tx.sql())?))
        })
        .await;
    let swept = match found {
        Ok((gone, known)) => images.sweep(gone, known).await.map_err(Error::from),
        Err(error) => Err(error),
    };
    if let Err(error) = swept {
        tracing::warn!(%error, "could not sweep the images no message took");
    }
}

struct Message {
    text: String,
    images: Vec<ImageId>,
}

/// A message to an Agent, in its Thread or in a new one, and a turn that
/// waits behind the Thread's earlier turns. A new Thread starts with
/// `settings`; an existing one changes to them, if they are given.
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    agent: AgentId,
    thread: Option<ThreadId>,
    Message { text, images }: Message,
    settings: Option<Settings>,
) -> Result<Value, Error> {
    let now = tx.now();
    let images = store::unsent_images(tx.sql(), &images, author)?;
    rules::may_carry(&images)?;
    let thread = match thread {
        Some(id) => {
            let found = store::thread(tx.sql(), id)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            if found.agent != agent {
                return Err(Refusal::invalid("This Thread belongs to another Agent.").into());
            }
            if let Some(settings) = settings {
                configure(tx, author, id, settings)?;
            }
            id
        }
        None => {
            let summary = ThreadSummary {
                id: ThreadId::new(),
                agent,
                title: rules::title(&text, &images),
                updated_at: now,
            };
            let settings = settings.unwrap_or_default();
            store::insert_thread(tx.sql(), &summary, author, &settings)?;
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
        body: Body::Message {
            text: text.clone(),
            images: images.clone(),
        },
    };
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: item.id,
        state: TurnState::Queued,
    };
    store::insert_item(tx.sql(), thread, &item)?;
    store::carry_images(tx.sql(), &images, item.id)?;
    let settings = store::settings(tx.sql(), thread)?;
    store::insert_turn(tx.sql(), &turn, author, now, &settings)?;
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
        images,
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
            turn::end(tx, &found, rules::Ending::new(TurnState::Stopped, None))?;
        }
        rules::Stop::AskHarness => {
            tx.enqueue(turn::STOP, &turn.to_string(), &TurnEffect { turn })?;
        }
        rules::Stop::Nothing => {}
    }
    Ok(Value::Null)
}

/// Tries a failed turn's message again, in a new turn that waits behind the
/// Thread's earlier turns, with the Thread's settings now. The failed turn
/// stays as it ended.
fn retry(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Value, Error> {
    let found =
        store::turn(tx.sql(), turn)?.ok_or_else(|| Refusal::not_found("There is no such turn."))?;
    let latest = store::last_turn(tx.sql(), found.thread)? == Some(found.id);
    rules::retry(found.state, latest)?;
    let again = store::Turn {
        id: TurnId::new(),
        state: TurnState::Queued,
        ..found
    };
    let now = tx.now();
    let settings = store::settings(tx.sql(), again.thread)?;
    store::insert_turn(tx.sql(), &again, author, now, &settings)?;
    store::touch_thread(tx.sql(), again.thread, now)?;
    let queued = Fact::TurnQueued {
        turn: again.id,
        message: again.message,
    };
    emit(tx, author, again.thread, &queued)?;
    tx.enqueue(
        turn::START,
        &again.thread.to_string(),
        &TurnEffect { turn: again.id },
    )?;
    value(Sent {
        thread: again.thread,
        turn: again.id,
        item: again.message,
    })
    .map_err(Error::from)
}

/// A Person's answer to a Question. It goes to the Harness from the outbox.
fn answer(
    tx: &mut Tx<'_>,
    live: &Live,
    author: Participant,
    item: ItemId,
    choice: String,
    values: Option<model::Values>,
) -> Result<Value, Error> {
    let (thread, mut found) = store::item(tx.sql(), item)?
        .ok_or_else(|| Refusal::not_found("There is no such Question."))?;
    let filled = rules::answer(&mut found.body, &choice, values)?;
    store::set_body(tx.sql(), item, &found.body)?;
    let fact = Fact::QuestionAnswered {
        item,
        choice: choice.clone(),
        values: filled.as_ref().map(|f| f.kept.clone()),
    };
    emit(tx, author, thread, &fact)?;
    // Neither the log nor the outbox holds a secret: memory does.
    let (values, secret) = match filled {
        Some(rules::Filled { mut kept, secret }) => {
            kept.retain(|id, _| !secret.contains_key(id));
            (Some(kept), secret)
        }
        None => (None, model::Values::new()),
    };
    let kept_secret = !secret.is_empty();
    if kept_secret {
        live.keep_secret(item, secret);
    }
    let reply = ReplyEffect {
        item,
        choice,
        values,
        secret: kept_secret,
    };
    tx.enqueue(turn::REPLY, &item.to_string(), &reply)?;
    Ok(Value::Null)
}
