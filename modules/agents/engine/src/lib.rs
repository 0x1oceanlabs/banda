//! The agents module: a Person works with Agents in Threads. A Thread is
//! one session with a Harness in a Space, and the Agent at work in it is
//! its own, with no name or settings (ADR 0006).
//!
//! - The **Harness list** is a text file of the machine ([`settings`]).
//! - **Threads, turns and Questions** are this module's tables and facts
//!   ([`model`]). A message queues a turn, or goes into the turn that runs
//!   (steering); the outbox runs a Thread's turns one at a time, and
//!   Threads run side by side. A waiting message can be changed, taken
//!   back or sent now, and a stop or a restart holds the queue until a
//!   Person lets it go (ADR 0003, decision 8).
//! - **Harnesses** are reached through ACP, one process per Space and
//!   Harness entry (`hosts.rs`). ACP's words stop in `acp.rs`.
//!
//! Its methods, each with its right, params and answer, are the
//! `methods!` table below (ADR 0014).

mod acp;
mod between;
mod cli;
mod files;
mod hosts;
mod images;
mod live;
pub mod model;
mod record;
mod rules;
pub mod settings;
mod store;
mod turn;

use acp::Connection;
use banda_kernel::{
    AgentId, Call, Effect, Error, Module, ModuleSpace, Nothing, OnRestart, Outcome, Participant,
    Refusal, Right, Settled, SpaceId, Tx,
};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use images::Images;
use live::Live;
use model::{
    Account, Body, Fact, HarnessView, Image, ImageId, Item, ItemId, Offer, Settings, ThreadId,
    ThreadList, ThreadSummary, ThreadView, TurnId, TurnState, VERSION,
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
    listings: Arc<files::Listings>,
}

impl Agents {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            live: Arc::new(Live::new(hosts::IDLE, between::QUIET)),
            idle: hosts::IDLE,
            quiet: between::QUIET,
            listings: Arc::default(),
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

    fn harness(&self, id: &str) -> Result<Harness, Refusal> {
        self.harnesses.get(id).map_err(Refusal::invalid)
    }

    /// After a sign-in or a sign-out: ACP has a client start the Harness
    /// again, so it reads the account anew, in every Space, since they
    /// share it. Then the receipt keeps the answer, and the kernel answers
    /// the same command, sent again, from it.
    async fn start_again(&self, call: &Call, harness: &str) -> Result<(), Refusal> {
        self.live.let_go(harness).await;
        call.command(|_| Ok(())).await
    }

    /// Harness entry `id` with its process in `space`, started if need be.
    async fn running(
        &self,
        space: SpaceId,
        id: &str,
    ) -> Result<(Harness, Arc<Connection>), Refusal> {
        let harness = self.harness(id)?;
        let connection = self.live.connection(space, &harness).await;
        Ok((harness, connection.map_err(Refusal::conflict)?))
    }
}

banda_kernel::methods! {
    Agents(Call) as "AgentsMethods" in "agents/" {
        /// The Harnesses this machine can start.
        call harnesses(Nothing) -> Vec<HarnessView>, Read;
        /// A Harness as it says: its program, who is signed in, how to sign
        /// in. A Harness's account serves every Space on this computer.
        call account(OneHarness) -> Account, Manage;
        /// Signs in with one of those ways, then the Harness starts again,
        /// and the `turn` that needed it goes again.
        command sign_in(SignIn) -> Option<Sent>, Manage;
        /// Asks the Harness to sign out, then it starts again.
        command sign_out(OneHarness) -> (), Manage;
        /// The Space's Threads, the latest first.
        call threads(Nothing) -> ThreadList, Read;
        /// One Thread as a view.
        call thread(OneThread) -> ThreadView, Read;
        /// What a new Thread on a Harness starts with.
        call defaults(OneHarness) -> Defaults, Read;
        /// A message that queues a turn, or with `steer` joins the one that
        /// runs: in a Thread, or in a new one on a Harness.
        command send(Send) -> Sent, Write;
        /// A waiting message's new text.
        command edit(Edit) -> (), Write;
        /// Takes a waiting message back.
        command withdraw(OneTurn) -> (), Write;
        /// Sends a waiting message into the turn that runs.
        command steer(OneTurn) -> (), Write;
        /// Lets a held queue go on.
        command resume(OneThread) -> (), Write;
        /// The Thread's settings, from its next turn on. How freely an Agent
        /// acts decides what it asks a Person.
        command configure(Configure) -> (), Decide;
        /// Stops a turn.
        command stop(OneTurn) -> (), Write;
        /// Tries a failed turn's message again.
        command retry(OneTurn) -> Sent, Write;
        /// Answers a Question; `values` fill its form.
        command answer(Answer) -> (), Decide;
        /// An image a message will carry.
        command attach(Attach) -> Image, Write;
        /// An image's bytes.
        call image(OneImage) -> ImageData, Read;
        /// The files in the Space's folder, for `@` in the composer.
        call files(FileQuery) -> Vec<String>, Read;
    }
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneHarness {
    harness: String,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct SignIn {
    harness: String,
    way: String,
    /// The turn that failed for it, which goes again in the same command:
    /// a terminal that sends it once its program ended well sends one
    /// command, which its ID keeps from being done twice.
    #[serde(default)]
    #[ts(optional = nullable)]
    turn: Option<TurnId>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneThread {
    thread: ThreadId,
}

/// A message in a Thread, or the first one of a new Thread on a Harness.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Send {
    #[serde(default)]
    #[ts(optional = nullable)]
    thread: Option<ThreadId>,
    #[serde(default)]
    #[ts(optional = nullable)]
    harness: Option<String>,
    #[serde(default)]
    #[ts(as = "Option<String>", optional)]
    text: String,
    /// The images it carries, each added with `agents.attach` first.
    #[serde(default)]
    #[ts(as = "Option<Vec<ImageId>>", optional)]
    images: Vec<ImageId>,
    /// What a new Thread starts with, instead of its Harness's defaults;
    /// or the Thread's settings from this turn on.
    #[serde(default)]
    #[ts(optional = nullable)]
    settings: Option<Settings>,
    /// It goes into the turn that runs, if one does, instead of waiting
    /// for a turn of its own.
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    steer: bool,
}

/// A waiting message's new text, by the turn it waits for.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Edit {
    turn: TurnId,
    text: String,
}

/// An image a message will carry: its kind, its bytes in base64, and the
/// name of its file.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Attach {
    mime: String,
    data: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    name: Option<String>,
}

/// What `agents.files` asks: the files in the Space's folder that hold
/// these words.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct FileQuery {
    query: String,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
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

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Configure {
    thread: ThreadId,
    settings: Settings,
}

/// What `agents.defaults` answers: what a new Thread on a Harness starts
/// with, and what the Harness last offered in this Space. `at` is where the Space's log stood,
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

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneTurn {
    turn: TurnId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Answer {
    item: ItemId,
    choice: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    values: Option<model::Values>,
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

/// The handlers of the module's methods, one each (ADR 0014).
impl Agents {
    async fn harnesses(&self, _: Call, _: Nothing) -> Result<Vec<HarnessView>, Refusal> {
        Ok(self.harnesses.views())
    }

    async fn account(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<Account, Refusal> {
        let (harness, connection) = self.running(call.space().id(), &harness).await?;
        connection
            .account(&harness)
            .await
            .map_err(Refusal::conflict)
    }

    async fn sign_in(
        &self,
        call: Call,
        SignIn { harness, way, turn }: SignIn,
    ) -> Result<Option<Sent>, Refusal> {
        let (harness, connection) = self.running(call.space().id(), &harness).await?;
        let found = connection
            .ways()
            .iter()
            .find(|w| w.id == way)
            .ok_or_else(|| {
                Refusal::not_found(format!("{} offers no such way to sign in.", harness.name))
            })?;
        // A way in a terminal ran already: the Person signed in there.
        if found.terminal.is_none() {
            connection.sign_in(&way).await.map_err(Refusal::conflict)?;
        }
        drop(connection);
        self.live.let_go(&harness.id).await;
        let author = call.participant();
        call.command(move |tx| match turn {
            // A turn that went again already, or cannot, leaves the
            // sign-in as it is: the Person is signed in.
            Some(turn) => match retry(tx, author, turn) {
                Err(Error::Refused(_)) => Ok(None),
                answer => answer.map(Some),
            },
            None => Ok(None),
        })
        .await
    }

    async fn sign_out(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<(), Refusal> {
        let (harness, connection) = self.running(call.space().id(), &harness).await?;
        connection.sign_out().await.map_err(Refusal::conflict)?;
        drop(connection);
        self.start_again(&call, &harness.id).await
    }

    async fn threads(&self, call: Call, _: Nothing) -> Result<ThreadList, Refusal> {
        let (at, threads) = call.space().view(store::threads).await?;
        Ok(ThreadList { at, threads })
    }

    async fn thread(
        &self,
        call: Call,
        OneThread { thread }: OneThread,
    ) -> Result<ThreadView, Refusal> {
        let (at, found) = call
            .space()
            .view(move |sql| {
                let Some(summary) = store::thread(sql, thread)? else {
                    return Ok(None);
                };
                let items = store::items(sql, thread)?;
                let mut turns = store::turns(sql, thread)?;
                let held = store::held(sql, thread)?;
                rules::can(&mut turns, &items, held);
                Ok(Some(ThreadView {
                    at: 0,
                    items,
                    turns,
                    settings: store::settings(sql, thread)?,
                    offer: store::offer(sql, thread)?,
                    usage: store::usage(sql, thread)?,
                    held,
                    thread: summary,
                }))
            })
            .await?;
        let view = found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
        Ok(ThreadView { at, ..view })
    }

    async fn defaults(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<Defaults, Refusal> {
        self.harness(&harness)?;
        let (at, offer) = call
            .space()
            .view(move |sql| Ok(store::latest_offer(sql, &harness)?.unwrap_or_default()))
            .await?;
        // What the composer shows is what the new Thread gets: the
        // Harness's own values for its options.
        let mut settings = Settings::default();
        for option in &offer.options {
            settings
                .options
                .insert(option.id.clone(), option.value.clone());
        }
        Ok(Defaults {
            at,
            settings,
            offer,
        })
    }

    async fn send(&self, call: Call, params: Send) -> Result<Sent, Refusal> {
        let Send {
            thread,
            harness,
            text,
            images,
            settings,
            steer,
        } = params;
        rules::may_send(&text, &images)?;
        let target = match (thread, harness) {
            (Some(thread), _) => Target::Thread(thread),
            (None, Some(harness)) => Target::New(self.harness(&harness)?.id),
            (None, None) => {
                return Err(Refusal::invalid(
                    "A message goes into a Thread, or starts one on a Harness.",
                ));
            }
        };
        let author = call.participant();
        if settings.is_some() {
            rules::may_choose(author)?;
        }
        let message = Message { text, images };
        call.command(move |tx| send(tx, author, target, message, settings, steer))
            .await
    }

    async fn edit(&self, call: Call, Edit { turn, text }: Edit) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| edit(tx, author, turn, text)).await
    }

    async fn withdraw(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| withdraw(tx, author, turn)).await
    }

    async fn steer(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| send_now(tx, author, turn)).await
    }

    async fn resume(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| {
            store::thread(tx.sql(), thread)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            turn::resume(tx, author, thread)
        })
        .await
    }

    async fn configure(
        &self,
        call: Call,
        Configure { thread, settings }: Configure,
    ) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| {
            store::thread(tx.sql(), thread)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            configure(tx, author, thread, settings)
        })
        .await
    }

    async fn stop(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| stop(tx, author, turn)).await
    }

    async fn retry(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<Sent, Refusal> {
        let author = call.participant();
        call.command(move |tx| retry(tx, author, turn)).await
    }

    async fn answer(&self, call: Call, params: Answer) -> Result<(), Refusal> {
        let Answer {
            item,
            choice,
            values,
        } = params;
        let author = call.participant();
        let live = self.live.clone();
        call.command(move |tx| answer(tx, &live, author, item, choice, values))
            .await
    }

    async fn attach(
        &self,
        call: Call,
        Attach { mime, data, name }: Attach,
    ) -> Result<Image, Refusal> {
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
        let space = call.space();
        let images = Images::of(space.folder());
        // The file first: a row never names bytes that are not
        // there. A file left without a row goes with the sweep.
        images.keep(image.id, bytes).await.map_err(Error::from)?;
        let author = call.participant();
        let kept = call
            .command(move |tx| {
                store::attach_image(tx.sql(), &image, author, tx.now())?;
                Ok(image)
            })
            .await;
        tokio::spawn(sweep(space.clone(), images));
        kept
    }

    async fn image(&self, call: Call, OneImage { image }: OneImage) -> Result<ImageData, Refusal> {
        let space = call.space();
        let kind = space.read(move |sql| store::image_kind(sql, image)).await?;
        let gone = || Refusal::not_found("There is no such image.");
        let mime = kind.ok_or_else(gone)?;
        let bytes = Images::of(space.folder())
            .read(image)
            .await
            .map_err(|_| gone())?;
        Ok(ImageData {
            mime,
            data: BASE64.encode(bytes),
        })
    }

    async fn files(
        &self,
        call: Call,
        FileQuery { query }: FileQuery,
    ) -> Result<Vec<String>, Refusal> {
        let folder = call.space().folder().to_path_buf();
        let listings = self.listings.clone();
        tokio::task::spawn_blocking(move || files::matching(&listings.of(&folder), &query))
            .await
            .map_err(|_| Refusal::invalid("The files could not be listed."))
    }
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
        Self::method_right(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
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
        let agents = settings::old_agents(space.folder());
        space
            .write(move |tx| {
                store::fill_harnesses(tx.sql(), &agents)?;
                between::cut_short(tx)
            })
            .await
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

/// Where a message goes: into a Thread, or into a new one on a Harness.
enum Target {
    Thread(ThreadId),
    New(String),
}

/// A message in a Thread, or the first of a new Thread on a Harness, and
/// a turn that waits behind the Thread's earlier turns; or, to `steer`, a
/// message into the turn that runs, if one does. A new Thread starts with
/// `settings`; an existing one changes to them, if they are given. A
/// message that waits for its own turn lets a held queue go on.
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    target: Target,
    Message { text, images }: Message,
    settings: Option<Settings>,
    steer: bool,
) -> Result<Sent, Error> {
    let now = tx.now();
    let images = store::unsent_images(tx.sql(), &images, author)?;
    rules::may_carry(&images)?;
    let (thread, agent) = match target {
        Target::Thread(id) => {
            let agent = store::agent_of(tx.sql(), id)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            if let Some(settings) = settings {
                configure(tx, author, id, settings)?;
            }
            (id, agent)
        }
        Target::New(harness) => {
            let summary = ThreadSummary {
                id: ThreadId::new(),
                harness,
                title: rules::title(&text, &images),
                updated_at: now,
            };
            // The Thread's own Agent, and only one.
            let agent = AgentId::new();
            let settings = settings.unwrap_or_default();
            store::insert_thread(tx.sql(), &summary, agent, author, &settings)?;
            let fact = Fact::ThreadStarted {
                thread: summary.id,
                title: summary.title.clone(),
                harness: Some(summary.harness.clone()),
            };
            emit(tx, author, summary.id, &fact)?;
            (summary.id, agent)
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
        return Ok(sent);
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
    Ok(sent)
}

/// Stops a turn: at once if it waits, through the Harness if it runs. A
/// stop of the turn that runs holds the queue behind it.
fn stop(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
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
    Ok(())
}

/// The Thread's turn a message can go into. A turn a Person stopped takes
/// nothing more, and one the Agent went on with by itself takes a message
/// as a turn of its own, whose prompt the Harness takes into what it does.
fn steerable(tx: &mut Tx<'_>, thread: ThreadId) -> Result<Option<store::Turn>, Error> {
    let held = store::held(tx.sql(), thread)?;
    let Some(running) = store::running(tx.sql(), thread)? else {
        return Ok(None);
    };
    let by_itself = turn::by_itself(tx.sql(), &running)?;
    Ok(rules::steers(running.state, held, by_itself).then_some(running))
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
fn edit(tx: &mut Tx<'_>, author: Participant, turn: TurnId, text: String) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let turns = store::turns(tx.sql(), found.thread)?;
    rules::may_change(rules::position(&turns, found.id).first)?;
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
        return Ok(());
    }
    was.clone_from(&text);
    store::set_body(tx.sql(), item, &message.body)?;
    emit(tx, author, thread, &Fact::MessageEdited { item, text })?;
    Ok(())
}

/// Takes a waiting message back: its turn never runs, and the Thread no
/// longer shows it.
fn withdraw(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let withdrawn = rules::Ending::new(TurnState::Withdrawn, None);
    turn::end(tx, author, &found, withdrawn)?;
    Ok(())
}

/// Sends a waiting message now: into the turn that runs, whose Harness
/// takes it as it works. With no turn that can take it, as one a Person
/// stopped, it waits its turn, and a held queue goes on.
fn send_now(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let Some(running) = steerable(tx, found.thread)? else {
        turn::resume(tx, author, found.thread)?;
        return Ok(());
    };
    let message = turn::Message::read(tx.sql(), found.message)?
        .ok_or_else(|| Refusal::invalid("Only a message can be sent."))?;
    let withdrawn = rules::Ending::new(TurnState::Withdrawn, None);
    turn::end(tx, author, &found, withdrawn)?;
    store::set_item_turn(tx.sql(), found.message, Some(running.id))?;
    store::move_last(tx.sql(), found.message)?;
    turn::steer_into(tx, author, &running, found.message, message)?;
    Ok(())
}

/// Tries a failed turn's message again, in a new turn with the Thread's
/// settings now; a held queue goes on after it. The failed turn stays as
/// it ended.
fn retry(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Sent, Error> {
    let found = turn_of(tx, turn)?;
    let turns = store::turns(tx.sql(), found.thread)?;
    let latest = rules::position(&turns, found.id).latest;
    let by_itself = turn::by_itself(tx.sql(), &found)?;
    rules::retry(found.state, latest, by_itself)?;
    // Queued first, it starts before a held queue goes on.
    let again = turn::queue(tx, author, found.thread, found.agent, found.message)?;
    turn::resume(tx, author, found.thread)?;
    Ok(Sent {
        thread: found.thread,
        turn: again,
        item: found.message,
    })
}

/// A Person's answer to a Question. It goes to the Harness from the outbox.
fn answer(
    tx: &mut Tx<'_>,
    live: &Live,
    author: Participant,
    item: ItemId,
    choice: String,
    values: Option<model::Values>,
) -> Result<(), Error> {
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
    Ok(())
}
