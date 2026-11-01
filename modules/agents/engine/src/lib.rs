//! The agents module: a Person works with Agents in Threads (ADR 0001,
//! decision 10).
//!
//! - **Agents** are text files in the Space, and the **Harness list** is a
//!   text file of the machine ([`settings`]).
//! - **Threads, turns and Questions** are this module's tables and facts
//!   ([`model`]). A message queues a turn, or goes into the turn that runs
//!   (steering); the outbox runs a Thread's turns one at a time, and
//!   Threads run side by side. A waiting message can be changed, taken
//!   back or sent now, and a stop or a restart holds the queue until a
//!   Person lets it go (ADR 0003, decision 8).
//! - **Harnesses** are reached through ACP, one process per Space and
//!   Harness entry (`hosts.rs`). ACP's words stop in `acp.rs`.
//!
//! | Method | Right | What it does |
//! |---|---|---|
//! | `agents.harnesses` | read | the Harnesses this machine can start |
//! | `agents.account` | manage | a Harness as it says: its program, who is signed in, how to sign in: `{harness}` |
//! | `agents.sign_in` | manage | signs in with one of those ways, then the Harness starts again: `{harness, way}` |
//! | `agents.sign_out` | manage | asks the Harness to sign out, then it starts again: `{harness}` |
//! | `agents.list` | read | the Space's Agents |
//! | `agents.create` | manage | a new Agent: `{name, harness}` |
//! | `agents.threads` | read | Threads, the latest first: `{agent?}` |
//! | `agents.thread` | read | one Thread as a view: `{thread}` |
//! | `agents.defaults` | read | what an Agent's new Threads start with: `{agent}` |
//! | `agents.send` | write | a message that queues a turn, or with `steer` joins the one that runs: `{agent, thread?, text, images?, settings?, steer?}` |
//! | `agents.edit` | write | a waiting message's new text: `{turn, text}` |
//! | `agents.withdraw` | write | takes a waiting message back: `{turn}` |
//! | `agents.steer` | write | sends a waiting message into the turn that runs: `{turn}` |
//! | `agents.resume` | write | lets a held queue go on: `{thread}` |
//! | `agents.configure` | write | the Thread's settings, from its next turn on: `{thread, settings}` |
//! | `agents.stop` | write | stops a turn: `{turn}` |
//! | `agents.retry` | write | tries a failed turn's message again: `{turn}` |
//! | `agents.answer` | decide | answers a Question: `{item, choice, values?}`; `values` fill its form |
//! | `agents.attach` | write | an image a message will carry: `{mime, data, name?}` |
//! | `agents.image` | read | an image's bytes: `{image}` |

mod acp;
mod between;
mod cli;
mod hosts;
mod images;
mod live;
pub mod model;
mod rules;
pub mod settings;
mod store;
mod turn;

use acp::Connection;
use bandaso_kernel::{
    AgentId, Call, Effect, Error, Module, ModuleSpace, OnRestart, Outcome, Participant, Refusal,
    Right, Settled, SpaceId, Tx, decode,
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
use settings::{Harness, Harnesses};
use std::fmt::Display;
use std::sync::Arc;
use std::time::Duration;
use ts_rs::TS;
use turn::{ReplyEffect, TurnEffect};

pub struct Agents {
    harnesses: Harnesses,
    live: Arc<Live>,
    idle: Duration,
    quiet: Duration,
}

impl Agents {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            live: Arc::new(Live::new(hosts::IDLE, between::QUIET)),
            idle: hosts::IDLE,
            quiet: between::QUIET,
        }
    }

    /// Lets a Harness process go after `idle` with nothing to do, instead
    /// of half an hour.
    pub fn idle_after(self, idle: Duration) -> Self {
        Self { idle, ..self }.live_again()
    }

    /// Ends a turn the Agent went on with by itself after `quiet` with
    /// nothing said, instead of a minute.
    pub fn quiet_after(self, quiet: Duration) -> Self {
        Self { quiet, ..self }.live_again()
    }

    fn live_again(mut self) -> Self {
        self.live = Arc::new(Live::new(self.idle, self.quiet));
        self
    }

    fn harness(&self, id: &str) -> Result<&Harness, Refusal> {
        self.harnesses.find(id).ok_or_else(|| {
            Refusal::invalid(format!("This computer has no Harness named \"{id}\"."))
        })
    }

    /// After a sign-in or a sign-out: ACP has a client start the Harness
    /// again, so it reads the account anew, in every Space, since they
    /// share it. Then the receipt keeps the answer, and the kernel answers
    /// the same command, sent again, from it.
    async fn start_again(&self, call: &Call, harness: &str) -> Result<Value, Refusal> {
        self.live.let_go(harness).await;
        call.command(|_| Ok(Value::Null)).await
    }

    /// Harness entry `id` with its process in `space`, started if need be.
    async fn running(
        &self,
        space: SpaceId,
        id: &str,
    ) -> Result<(&Harness, Arc<Connection>), Refusal> {
        let harness = self.harness(id)?;
        let connection = self.live.connection(space, harness).await;
        Ok((harness, connection.map_err(Refusal::conflict)?))
    }
}

enum Method {
    Harnesses,
    Account,
    SignIn,
    SignOut,
    List,
    Create,
    Threads,
    Thread,
    Defaults,
    Send,
    Edit,
    Withdraw,
    Steer,
    Resume,
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
            "account" => Method::Account,
            "sign_in" => Method::SignIn,
            "sign_out" => Method::SignOut,
            "list" => Method::List,
            "create" => Method::Create,
            "threads" => Method::Threads,
            "thread" => Method::Thread,
            "defaults" => Method::Defaults,
            "send" => Method::Send,
            "edit" => Method::Edit,
            "withdraw" => Method::Withdraw,
            "steer" => Method::Steer,
            "resume" => Method::Resume,
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
            // A Harness's account serves every Space on this computer.
            Method::Create | Method::Account | Method::SignIn | Method::SignOut => Right::Manage,
            Method::Send
            | Method::Edit
            | Method::Withdraw
            | Method::Steer
            | Method::Resume
            | Method::Stop
            | Method::Retry
            | Method::Attach => Right::Write,
            // How freely an Agent acts decides what it asks a Person.
            Method::Configure | Method::Answer => Right::Decide,
        }
    }
}

#[derive(Deserialize)]
struct OneHarness {
    harness: String,
}

#[derive(Deserialize)]
struct SignIn {
    harness: String,
    way: String,
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
    /// It goes into the turn that runs, if one does, instead of waiting
    /// for a turn of its own.
    #[serde(default)]
    steer: bool,
}

/// A waiting message's new text, by the turn it waits for.
#[derive(Deserialize)]
struct Edit {
    turn: TurnId,
    text: String,
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
/// and what its Harness last offered. `at` is where the Space's log stood,
/// so a window hears when a Thread learns more of what the Harness offers.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Defaults {
    #[ts(type = "number")]
    pub at: i64,
    pub settings: Settings,
    pub offer: Offer,
}

/// What `agents.send` answers: the turn that will run the message, or
/// the running one it went into.
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
            Method::Account => {
                let OneHarness { harness } = decode(params)?;
                let (_, connection) = self.running(space.id(), &harness).await?;
                value(connection.account().await)
            }
            Method::SignIn => {
                let SignIn { harness, way } = decode(params)?;
                call.command_id()?;
                let (harness, connection) = self.running(space.id(), &harness).await?;
                let found = connection
                    .ways()
                    .iter()
                    .find(|w| w.id == way)
                    .ok_or_else(|| {
                        Refusal::not_found(format!(
                            "{} offers no such way to sign in.",
                            harness.name
                        ))
                    })?;
                // A way in a terminal ran already: the Person signed in there.
                if found.terminal.is_none() {
                    connection.sign_in(&way).await.map_err(Refusal::conflict)?;
                }
                drop(connection);
                self.start_again(&call, &harness.id).await
            }
            Method::SignOut => {
                let OneHarness { harness } = decode(params)?;
                call.command_id()?;
                let (harness, connection) = self.running(space.id(), &harness).await?;
                connection.sign_out().await.map_err(Refusal::conflict)?;
                drop(connection);
                self.start_again(&call, &harness.id).await
            }
            Method::Create => {
                let Create { name, harness } = decode(params)?;
                self.harness(&harness)?;
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
                            held: store::held(sql, thread)?,
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
                let (at, offer) = space
                    .view(move |sql| {
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
                value(Defaults {
                    at,
                    settings,
                    offer,
                })
            }
            Method::Send => {
                let Send {
                    agent,
                    thread,
                    text,
                    images,
                    settings,
                    steer,
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
                call.command(move |tx| send(tx, author, agent, thread, message, settings, steer))
                    .await
            }
            Method::Edit => {
                let Edit { turn, text } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| edit(tx, author, turn, text)).await
            }
            Method::Withdraw => {
                let OneTurn { turn } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| withdraw(tx, author, turn)).await
            }
            Method::Steer => {
                let OneTurn { turn } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| send_now(tx, author, turn)).await
            }
            Method::Resume => {
                let OneThread { thread } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| {
                    store::thread(tx.sql(), thread)?
                        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
                    turn::resume(tx, author, thread)?;
                    Ok(Value::Null)
                })
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
                let author = call.participant();
                call.command(move |tx| stop(tx, author, turn)).await
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
            turn::STEER => turn::steer(&self.live, space, &effect).await,
            other => Outcome::Fail(format!("agents runs no effect of kind {other}")),
        }
    }

    async fn opened(&self, space: ModuleSpace) -> Result<(), Error> {
        space.write(between::cut_short).await
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
/// waits behind the Thread's earlier turns; or, to `steer`, a message into
/// the turn that runs, if one does. A new Thread starts with `settings`;
/// an existing one changes to them, if they are given. A message that
/// waits for its own turn lets a held queue go on.
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    agent: AgentId,
    thread: Option<ThreadId>,
    Message { text, images }: Message,
    settings: Option<Settings>,
    steer: bool,
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
    let running = match steer {
        true => steerable(tx, thread)?,
        false => None,
    };
    let item = Item {
        id: ItemId::new(),
        turn: running.as_ref().map(|running| running.id),
        author,
        at: now,
        body: Body::Message {
            text: text.clone(),
            images: images.clone(),
        },
    };
    store::insert_item(tx.sql(), thread, &item)?;
    store::carry_images(tx.sql(), &images, item.id)?;
    if let Some(running) = running {
        store::touch_thread(tx.sql(), thread, now)?;
        turn::steer_into(
            tx,
            author,
            &running,
            item.id,
            turn::Message { text, images },
        )?;
        let sent = Sent {
            thread,
            turn: running.id,
            item: item.id,
        };
        return Ok(serde_json::to_value(sent)?);
    }
    turn::resume(tx, author, thread)?;
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: item.id,
        state: TurnState::Queued,
    };
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

/// Stops a turn: at once if it waits, through the Harness if it runs. A
/// stop of the turn that runs holds the queue behind it.
fn stop(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Value, Error> {
    let found = turn_of(tx, turn)?;
    match rules::stop(found.state) {
        rules::Stop::Now => {
            let stopped = rules::Ending::new(TurnState::Stopped, None);
            turn::end(tx, author, &found, stopped)?;
        }
        rules::Stop::AskHarness => {
            turn::hold(tx, author, found.thread)?;
            tx.enqueue(turn::STOP, &turn.to_string(), &TurnEffect { turn })?;
        }
        rules::Stop::Nothing => {}
    }
    Ok(Value::Null)
}

/// The Thread's turn a message can go into. A turn a Person stopped takes
/// nothing more, and one the Agent went on with by itself takes a message
/// as a turn of its own, whose prompt the Harness takes into what it does.
fn steerable(tx: &mut Tx<'_>, thread: ThreadId) -> Result<Option<store::Turn>, Error> {
    if store::held(tx.sql(), thread)? {
        return Ok(None);
    }
    let Some(running) = store::running(tx.sql(), thread)? else {
        return Ok(None);
    };
    Ok((!turn::by_itself(tx.sql(), &running)?).then_some(running))
}

fn turn_of(tx: &mut Tx<'_>, turn: TurnId) -> Result<store::Turn, Error> {
    Ok(store::turn(tx.sql(), turn)?.ok_or_else(|| Refusal::not_found("There is no such turn."))?)
}

/// The turn that waits for `turn`, as the methods that change it need it.
fn waiting(tx: &mut Tx<'_>, turn: TurnId) -> Result<store::Turn, Error> {
    let found = turn_of(tx, turn)?;
    rules::waits(found.state)?;
    Ok(found)
}

/// Changes the text of the message that waits for `turn`. Its images stay.
fn edit(tx: &mut Tx<'_>, author: Participant, turn: TurnId, text: String) -> Result<Value, Error> {
    let found = waiting(tx, turn)?;
    let first = store::turns_of(tx.sql(), found.message)?
        .first()
        .map(|t| t.id);
    rules::may_change(first == Some(turn))?;
    let item = found.message;
    let Some((thread, mut message)) = store::item(tx.sql(), item)? else {
        return Err(Refusal::not_found("There is no such message.").into());
    };
    let Body::Message { text: was, images } = &mut message.body else {
        return Err(Refusal::invalid("Only a message can be changed.").into());
    };
    let carried: Vec<ImageId> = images.iter().map(|image| image.id).collect();
    rules::may_send(&text, &carried)?;
    if *was == text {
        return Ok(Value::Null);
    }
    was.clone_from(&text);
    store::set_body(tx.sql(), item, &message.body)?;
    emit(tx, author, thread, &Fact::MessageEdited { item, text })?;
    Ok(Value::Null)
}

/// Takes a waiting message back: its turn never runs, and the Thread no
/// longer shows it.
fn withdraw(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Value, Error> {
    let found = waiting(tx, turn)?;
    let withdrawn = rules::Ending::new(TurnState::Withdrawn, None);
    turn::end(tx, author, &found, withdrawn)?;
    Ok(Value::Null)
}

/// Sends a waiting message now: into the turn that runs, whose Harness
/// takes it as it works. With no turn that can take it, as one a Person
/// stopped, it waits its turn, and a held queue goes on.
fn send_now(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Value, Error> {
    let found = waiting(tx, turn)?;
    let Some(running) = steerable(tx, found.thread)? else {
        turn::resume(tx, author, found.thread)?;
        return Ok(Value::Null);
    };
    let message = turn::Message::read(tx.sql(), found.message)?
        .ok_or_else(|| Refusal::invalid("Only a message can be sent."))?;
    let withdrawn = rules::Ending::new(TurnState::Withdrawn, None);
    turn::end(tx, author, &found, withdrawn)?;
    store::set_item_turn(tx.sql(), found.message, Some(running.id))?;
    store::move_last(tx.sql(), found.message)?;
    turn::steer_into(tx, author, &running, found.message, message)?;
    Ok(Value::Null)
}

/// Tries a failed turn's message again, in a new turn with the Thread's
/// settings now; a held queue goes on after it. The failed turn stays as
/// it ended.
fn retry(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Value, Error> {
    let found = turn_of(tx, turn)?;
    if turn::by_itself(tx.sql(), &found)? {
        return Err(Refusal::invalid("Only a turn a Person asked for can be tried again.").into());
    }
    let latest = store::last_begun(tx.sql(), found.thread)? == Some(found.id)
        && store::turns_of(tx.sql(), found.message)?
            .last()
            .map(|t| t.id)
            == Some(found.id);
    rules::retry(found.state, latest)?;
    // Queued first, it starts before a held queue goes on.
    let again = turn::queue(tx, author, found.thread, found.agent, found.message)?;
    turn::resume(tx, author, found.thread)?;
    value(Sent {
        thread: found.thread,
        turn: again,
        item: found.message,
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
