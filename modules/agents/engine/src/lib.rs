//! The agents module: a Person works with Agents in Threads. A Thread is
//! one session with a Harness in a Space, and the Agent at work in it is
//! its own, with no name or settings (ADR 0006).
//!
//! - The **Harness list** is a text file of the machine ([`settings`]),
//!   and `agents.toml` says how messages are sent ([`sending`]): the
//!   module's [`SETTINGS`].
//! - **Threads, turns and Questions** are this module's tables and facts
//!   ([`model`]). A message queues a turn, or goes into the turn that runs
//!   (steering); the outbox runs a Thread's turns one at a time, and
//!   Threads run side by side. A waiting message can be changed, taken
//!   back or sent now, and a stop or a restart holds the queue until a
//!   Person lets it go (ADR 0003, decision 8).
//! - **Harnesses** are reached through ACP, one process per Space and
//!   Harness entry (`hosts.rs`). ACP's words stop in `acp.rs`.
//! - **An Agent reaches Banda** through `banda mcp`, which every session
//!   gets with the Agent's pass ([`Pipe`]). Its tools are the methods
//!   marked `tool` below (ADR 0019).
//!
//! Its methods, each with its right, params and answer, are the
//! `methods!` table below (ADR 0014).

mod acp;
mod between;
mod cli;
mod effects;
mod files;
mod hosts;
mod images;
mod kept;
mod live;
pub mod model;
mod record;
mod rules;
pub mod sending;
pub mod settings;
mod skills;
mod store;
mod transcript;
mod writer;

use acp::Connection;
use banda_kernel::{
    AgentId, Call, Effect, Error, Module, ModuleSpace, Nothing, OnRestart, Outcome, Participant,
    Refusal, Right, Settled, SpaceId, Tool, Tx,
};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use effects::ReplyEffect;
use images::Images;
use live::Live;
use model::{
    Account, Body, Fact, HarnessView, Image, ImageId, Item, ItemId, Offer, Opener, Program,
    Settings, ThreadId, ThreadList, ThreadSummary, ThreadView, TurnId, TurnState, VERSION,
};
use rules::Event;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use settings::{Harness, Harnesses};
use std::fmt::Display;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use ts_rs::TS;

/// The module's settings files in `~/.config/banda` (ADR 0016): how
/// messages are sent, which the look resolves for the window, and the
/// Harness list, which the look only checks.
pub const SETTINGS: [banda_look::SettingsFile; 2] = [
    banda_look::SettingsFile::of::<sending::AgentsSettings>(),
    banda_look::SettingsFile::new::<settings::HarnessFile>(
        "harnesses.toml",
        settings::template,
        settings::check,
    ),
];

pub struct Agents {
    harnesses: Harnesses,
    live: Arc<Live>,
    idle: Duration,
    quiet: Duration,
    listings: Arc<files::Listings>,
    pipe: Option<Pipe>,
}

/// How an Agent reaches Banda from its session: the engine's own program
/// runs as `banda mcp` and talks to the engine's API (ADR 0019, decision
/// 1). Without it, a session gets no Banda.
#[derive(Clone, Debug)]
pub struct Pipe {
    /// The `banda` program.
    pub program: PathBuf,
    /// Where the engine's API listens: `ws://127.0.0.1:<port>/ws`.
    pub engine: String,
}

impl Pipe {
    /// `banda mcp` as a session of `agent`'s in `space` starts it, with a
    /// new pass; `None`, said in the log, if there is no pass.
    fn program(&self, space: &ModuleSpace, agent: AgentId) -> Option<Program> {
        let pass = space
            .pass(agent)
            .inspect_err(|error| tracing::warn!(%error, "a session goes without Banda"))
            .ok()?;
        Some(Program {
            program: self.program.display().to_string(),
            args: vec!["mcp".to_owned()],
            env: [("BANDA_TOKEN", pass), ("BANDA_ENGINE", self.engine.clone())]
                .map(|(name, value)| (name.to_owned(), value))
                .into(),
        })
    }
}

impl Agents {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            live: Arc::new(Live::new(hosts::IDLE, between::QUIET, None)),
            idle: hosts::IDLE,
            quiet: between::QUIET,
            listings: Arc::default(),
            pipe: None,
        }
    }

    /// Hands every session it opens `banda mcp` through `pipe`.
    pub fn piped(self, pipe: Pipe) -> Self {
        Self {
            pipe: Some(pipe),
            ..self
        }
        .live_again()
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
        self.live = Arc::new(Live::new(self.idle, self.quiet, self.pipe.clone()));
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
        /// The Threads of this Space, the latest first: each one's ID, title
        /// and Harness, what it was last asked, how its latest turn stands,
        /// and the Questions it waits on.
        call threads(Nothing) -> ThreadList, Read, tool "threads";
        /// One Thread of this Space as its Person reads it: its messages and
        /// replies, its turns and what each may do now, and its settings.
        call thread(OneThread) -> ThreadView, Read, tool "read";
        /// What a new Thread on a Harness starts with.
        call defaults(OneHarness) -> Defaults, Read;
        /// Writes into a Thread of this Space, or starts a new Thread on a
        /// Harness. Its Agent reads that the message is from your Thread's
        /// Agent, not its Person; when the turn it asks for ends, its last
        /// reply comes back to your Thread by itself. A message waits its
        /// turn in a Thread that works; a Person's with `steer` joins the
        /// turn that runs.
        command send(Send) -> Sent, Write, tool "send";
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
        /// A new Thread with the conversation to the end of an ended turn:
        /// its turns and items, and a fork of its session there (ADR 0027).
        command fork(OneTurn) -> Forked, Write;
        /// Takes the Thread back to before a turn's message, to edit it:
        /// that turn and the ones after it leave it, and its session goes
        /// back to the reply before (ADR 0027).
        command rewind(OneTurn) -> (), Write;
        /// Answers a Question; `values` fill its form.
        command answer(Answer) -> (), Decide;
        /// An image a message will carry.
        command attach(Attach) -> Image, Write;
        /// An image's bytes.
        call image(OneImage) -> ImageData, Read;
        /// A file a message points at, kept in the Space: one dropped on
        /// the Thread, or a long text pasted.
        command keep(Keep) -> Kept, Write;
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

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct OneThread {
    /// The Thread's ID, as `threads` lists it.
    thread: ThreadId,
}

/// A message in a Thread, or the first one of a new Thread on a Harness.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct Send {
    /// The Thread to write into, as `threads` lists it.
    #[serde(default)]
    #[ts(optional = nullable)]
    thread: Option<ThreadId>,
    /// Or the Harness a new Thread starts on, as `threads` names them.
    #[serde(default)]
    #[ts(optional = nullable)]
    harness: Option<String>,
    /// What you write.
    #[serde(default)]
    #[ts(as = "Option<String>", optional)]
    text: String,
    /// The images it carries, each added with `agents.attach` first.
    #[serde(default)]
    #[ts(as = "Option<Vec<ImageId>>", optional)]
    #[schemars(skip)]
    images: Vec<ImageId>,
    /// What a new Thread starts with, instead of its Harness's defaults;
    /// or the Thread's settings from this turn on.
    #[serde(default)]
    #[ts(optional = nullable)]
    #[schemars(skip)]
    settings: Option<Settings>,
    /// It goes into the turn that runs, if one does, instead of waiting
    /// for a turn of its own.
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    #[schemars(skip)]
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

/// A file for a message to point at: the name it came with, and its bytes
/// in base64.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Keep {
    name: String,
    data: String,
}

/// Where a file kept for a message is: its path in the Space, which the
/// message writes as `@path`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Kept {
    pub path: String,
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

/// What `agents.fork` answers: the new Thread.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Forked {
    pub thread: ThreadId,
    /// Its title, "<title> fork".
    pub title: String,
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

/// An error in plain words, for a turn that fails by it.
fn plain(error: impl Display) -> String {
    error.to_string()
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
                rules::can(&mut turns, &store::openers(sql, thread)?, held);
                Ok(Some(ThreadView {
                    at: 0,
                    items,
                    turns,
                    settings: store::settings(sql, thread)?,
                    offer: store::offer(sql, thread)?,
                    usage: store::usage(sql, thread)?,
                    held,
                    forked_from: store::forked_from(sql, thread)?,
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
        let start = self.harness(&harness)?.start;
        // What the composer shows is what the new Thread gets.
        let (at, (settings, offer)) = call
            .space()
            .view(move |sql| fresh(sql, &harness, &start))
            .await?;
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
            (None, Some(harness)) => {
                let harness = self.harness(&harness)?;
                Target::New(harness.id, harness.start)
            }
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
        call.command(move |tx| {
            // An Agent writes from its Thread, which waits for the answer.
            let by = match author {
                Participant::Agent(agent) => {
                    let from = rules::own_thread(store::thread_of(tx.sql(), agent)?)?;
                    Some((Opener::Asked, from))
                }
                Participant::Person(_) => None,
            };
            send(tx, author, target, message, settings, steer, by)
        })
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
            writer::resume(tx, author, thread)
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

    async fn fork(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<Forked, Refusal> {
        let author = call.participant();
        call.command(move |tx| fork(tx, author, turn)).await
    }

    async fn rewind(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| rewind(tx, author, turn)).await
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
        let bytes = decoded(&data, "image")?;
        rules::may_attach(&mime, &bytes)?;
        let image = Image {
            id: ImageId::new(),
            mime,
            size: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
            name,
        };
        let space = call.space();
        let images = Images::of(space.data());
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

    async fn keep(&self, call: Call, Keep { name, data }: Keep) -> Result<Kept, Refusal> {
        let bytes = decoded(&data, "file")?;
        let name = rules::kept_name(&name, &bytes)?;
        let path = kept::keep(call.space().data(), name, bytes)
            .await
            .map_err(Error::from)?;
        Ok(Kept { path })
    }

    async fn image(&self, call: Call, OneImage { image }: OneImage) -> Result<ImageData, Refusal> {
        let space = call.space();
        let kind = space.read(move |sql| store::image_kind(sql, image)).await?;
        let gone = || Refusal::not_found("There is no such image.");
        let mime = kind.ok_or_else(gone)?;
        let bytes = Images::of(space.data())
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

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn run(&self, space: ModuleSpace, effect: Effect) -> Outcome {
        match effect.kind.as_str() {
            effects::START => effects::start(&self.live, &self.harnesses, space, &effect).await,
            effects::STOP => effects::stop(&self.live, space, &effect).await,
            effects::REPLY => effects::reply(&self.live, &effect),
            effects::STEER => effects::steer(&self.live, space, &effect).await,
            other => Outcome::Fail(format!("agents runs no effect of kind {other}")),
        }
    }

    async fn opened(&self, space: ModuleSpace) -> Result<(), Error> {
        let agents = settings::old_agents(space.data());
        space
            .write(move |tx| {
                store::fill_harnesses(tx.sql(), &agents)?;
                between::cut_short(tx)
            })
            .await
    }

    async fn closing(&self, space: ModuleSpace) {
        self.live.close(space.id()).await;
    }

    /// Every effect of this module dies with the Harness's process.
    fn on_restart(&self, _kind: &str) -> OnRestart {
        OnRestart::Abandon
    }

    fn settle(&self, tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
        effects::settle(tx, effect, settled)
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

/// The bytes of `data`, which a call sends in base64, of `what`.
fn decoded(data: &str, what: &str) -> Result<Vec<u8>, Refusal> {
    BASE64
        .decode(data.as_bytes())
        .map_err(|_| Refusal::invalid(format!("The {what}'s bytes are not base64.")))
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
    /// A new Thread on a Harness, and what its entry starts one with.
    New(String, settings::Start),
}

/// What a new Thread on `harness` starts with, as the composer shows it:
/// the Harness's own values for what it last offered in this Space, under
/// its entry's `start`; and that offer.
fn fresh(
    sql: &rusqlite::Connection,
    harness: &str,
    start: &settings::Start,
) -> Result<(Settings, Offer), Error> {
    let offer = store::latest_offer(sql, harness)?;
    let settings = start.over(offer.as_ref());
    Ok((settings, offer.unwrap_or_default()))
}

/// A message in a Thread, or the first of a new Thread on a Harness, and
/// a turn that waits behind the Thread's earlier turns; or, to `steer`, a
/// message into the turn that runs, if one does. A new Thread starts with
/// `settings`; an existing one changes to them, if they are given. `by`
/// says how another Thread's Agent wrote it, and from which Thread: then
/// the rules of ADR 0019 (decision 4) say whether it may. Only a Person's
/// word joins the turn that runs or lets a held queue go on.
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    target: Target,
    Message { text, images }: Message,
    settings: Option<Settings>,
    steer: bool,
    by: Option<(Opener, ThreadId)>,
) -> Result<Sent, Error> {
    let now = tx.now();
    let opener = by.map_or(Opener::Person, |(opener, _)| opener);
    let answers = opener == Opener::Answered;
    let by_person = opener.by_person();
    let images = store::unsent_images(tx.sql(), &images, author)?;
    rules::may_carry(&images)?;
    let (thread, agent) = match target {
        Target::Thread(id) => {
            let (title, agent) = store::title_and_agent(tx.sql(), id)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            if let Some((Opener::Asked, from)) = by {
                let (asks, waiting) = (
                    store::asks(tx.sql(), id)?,
                    store::waiting_for(tx.sql(), from)?,
                );
                rules::may_write(from, id, &title, asks, &waiting)?;
            }
            if let Some(settings) = settings {
                configure(tx, author, id, settings)?;
            }
            (id, agent)
        }
        Target::New(harness, start) => {
            let title = rules::title(&text, &images);
            // No one chose: as the composer would have shown it.
            let settings = match settings {
                Some(settings) => settings,
                None => fresh(tx.sql(), &harness, &start)?.0,
            };
            start_thread(tx, author, harness, title, &settings)?
        }
    };
    let running = match steer && by_person {
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
            answers,
        },
    };
    store::insert_item(tx.sql(), thread, &item)?;
    store::carry_images(tx.sql(), &images, item.id)?;
    if let Some(running) = running {
        store::touch_thread(tx.sql(), thread, now)?;
        effects::steer_into(
            tx,
            author,
            &running,
            item.id,
            effects::Message { text, images },
        )?;
        let sent = Sent {
            thread,
            turn: running.id,
            item: item.id,
        };
        return Ok(sent);
    }
    if by_person {
        writer::resume(tx, author, thread)?;
    }
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: item.id,
        state: TurnState::Queued,
        opener,
        from_thread: by.map(|(_, from)| from),
        stopping: false,
    };
    let posted = Fact::MessagePosted {
        item: item.id,
        turn: turn.id,
        text,
        images,
        answers,
    };
    writer::make(tx, author, &turn, Event::Queue, Some(posted))?;
    Ok(Sent {
        thread,
        turn: turn.id,
        item: item.id,
    })
}

/// Stops a turn: at once if it waits, through the Harness if it runs. A
/// stop of the turn that runs holds the queue behind it. A turn that ended
/// already stays as it ended.
fn stop(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = turn_of(tx, turn)?;
    writer::tell(tx, author, &found, Event::Stop)
}

/// The Thread's turn a message can go into: one that runs, unless it is
/// stopping, or is the Agent's own, which takes a message as a turn of
/// its own, whose prompt the Harness takes into what it does.
fn steerable(tx: &mut Tx<'_>, thread: ThreadId) -> Result<Option<store::Turn>, Error> {
    let Some(running) = store::running(tx.sql(), thread)? else {
        return Ok(None);
    };
    Ok(writer::takes(tx.sql(), &running, Event::Steer)?.then_some(running))
}

/// Forks the Thread of `turn`, an ended turn, at its end: a new Thread,
/// "<title> fork", on the same Harness and settings, with a copy of the
/// conversation to there, whose session is to be a fork of the Thread's at
/// the turn's last reply (ADR 0027).
fn fork(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Forked, Error> {
    let found = turn_of(tx, turn)?;
    let from = found.thread;
    let works = store::running(tx.sql(), from)?.is_some();
    rules::may_fork(found.state, works)?;
    let source = store::thread(tx.sql(), from)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let cannot = || Refusal::conflict("Its Agent named no reply of this turn to fork from.");
    let message = store::last_named_reply(tx.sql(), from, turn)?.ok_or_else(cannot)?;
    let evidence: acp::Evidence = store::evidence(tx.sql(), from)?.ok_or_else(cannot)?;
    let settings = store::settings(tx.sql(), from)?;
    let title = format!("{} fork", source.title);
    let (thread, agent) = start_thread(tx, author, source.harness, title.clone(), &settings)?;
    store::set_forked_from(tx.sql(), thread, from)?;
    store::copy_turns(tx.sql(), (from, found.agent), turn, (thread, agent))?;
    store::set_offer(tx.sql(), thread, &store::offer(tx.sql(), from)?)?;
    let forked = evidence.forked_at(acp::ForkAt {
        message: Some(message),
    });
    store::set_evidence(tx.sql(), thread, &forked)?;
    Ok(Forked { thread, title })
}

fn rewind(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = turn_of(tx, turn)?;
    let thread = found.thread;
    let turns = store::turns(tx.sql(), thread)?;
    rules::may_rewind(turn, &turns, &store::openers(tx.sql(), thread)?)?;
    // Its session goes back to the last reply before the message, or
    // starts anew before the first.
    let reply = store::named_reply_before(tx.sql(), thread, found.message)?;
    let ran_before = (turns.iter().take_while(|one| one.id != turn))
        .any(|one| one.state != TurnState::Withdrawn);
    if reply.is_none() && ran_before {
        let cannot = "Its Agent named no reply before this message to go back to.";
        return Err(Refusal::conflict(cannot).into());
    }
    if let Some(evidence) = store::evidence::<acp::Evidence>(tx.sql(), thread)? {
        let back = evidence.forked_at(acp::ForkAt { message: reply });
        store::set_evidence(tx.sql(), thread, &back)?;
    }
    store::rewind(tx.sql(), thread, turn, tx.now())?;
    emit(tx, author, thread, &Fact::ThreadRewound { thread, turn })?;
    Ok(())
}

/// A new Thread on `harness`, and its own Agent, the only one.
fn start_thread(
    tx: &mut Tx<'_>,
    author: Participant,
    harness: String,
    title: String,
    settings: &Settings,
) -> Result<(ThreadId, AgentId), Error> {
    let summary = ThreadSummary {
        id: ThreadId::new(),
        harness,
        title,
        updated_at: tx.now(),
    };
    let agent = AgentId::new();
    store::insert_thread(tx.sql(), &summary, agent, author, settings)?;
    let fact = Fact::ThreadStarted {
        thread: summary.id,
        title: summary.title,
        harness: Some(summary.harness),
        agent: Some(agent),
    };
    emit(tx, author, summary.id, &fact)?;
    Ok((summary.id, agent))
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
    let Body::Message {
        text: was, images, ..
    } = &mut message.body
    else {
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
    let found = turn_of(tx, turn)?;
    writer::apply(tx, author, &found, Event::Withdraw)??;
    Ok(())
}

/// Sends a waiting message now: into the turn that runs, whose Harness
/// takes it as it works. With no turn that can take it, as one a Person
/// stopped, it waits its turn, and a held queue goes on.
fn send_now(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let Some(running) = steerable(tx, found.thread)? else {
        writer::resume(tx, author, found.thread)?;
        return Ok(());
    };
    let message = effects::Message::read(tx.sql(), found.message)?
        .ok_or_else(|| Refusal::invalid("Only a message can be sent."))?;
    writer::apply(tx, author, &found, Event::Withdraw)??;
    store::set_item_turn(tx.sql(), found.message, Some(running.id))?;
    store::move_last(tx.sql(), found.message)?;
    effects::steer_into(tx, author, &running, found.message, message)?;
    Ok(())
}

/// Tries a failed turn's message again, in a new turn with the Thread's
/// settings now; a held queue goes on after it. The failed turn stays as
/// it ended.
fn retry(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Sent, Error> {
    let found = turn_of(tx, turn)?;
    let turns = store::turns(tx.sql(), found.thread)?;
    let latest = rules::position(&turns, found.id).latest;
    rules::retry(found.state, latest, found.opener.by_itself())?;
    // Queued first, it starts before a held queue goes on.
    // One another Thread's Agent asked for still answers that Thread.
    let (thread, agent, message) = (found.thread, found.agent, found.message);
    let from = found.answers();
    let again = writer::queue(tx, author, thread, agent, message, Opener::Retry, from)?;
    writer::resume(tx, author, found.thread)?;
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
    tx.enqueue(effects::REPLY, &item.to_string(), &reply)?;
    Ok(())
}
