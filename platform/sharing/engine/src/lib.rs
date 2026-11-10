//! The sharing module: the one part of Banda that sends anything anywhere
//! (ADR 0039, decision 4). Nothing else in Banda calls PostHog, and this
//! sends only what the Person turned on in `sharing.toml`: problem
//! reports, usage counts, or neither, as it starts.
//!
//! It is the machine's, as the problems are. What it shares it reads from
//! the file each time; the ID it sends with is random, made when sharing
//! turns on and erased when all of it turns off, so turned on again, no
//! history joins up (decision 7). Each event is kept here before it goes,
//! for the Person to read in Settings → Sharing, and kept seven days
//! (decision 8). A Banda run from a checkout, as in CI and the tests,
//! never sends, nor one run with `BANDA_SHARING=0`.
//!
//! It sends two events: `$exception`, of each Problem, and `day`, the
//! usage counts of each day (decision 6).

mod courier;
pub mod events;
mod exception;
mod post;
pub mod settings;
pub mod usage;

use banda_kernel::{
    Call, Effect, Error, Kind, Module, ModuleProject, Nothing, OnRestart, Outcome, Refusal, Retry,
    Right, Scope,
};
pub use post::Post;
use post::{CAPTURE, Capture};
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use settings::Shares;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use ts_rs::TS;
use uuid::Uuid;

/// The module's settings file in `~/.config/banda` (ADR 0016): what the
/// Person shares, which the look resolves for the window. What a machine
/// sends is its own (ADR 0101, decision 3).
pub const SETTINGS: [banda_look::SettingsFile; 1] =
    [banda_look::SettingsFile::of::<settings::SharingSettings>()
        .class(banda_look::Class::Machine, &[])];

/// How long an event is kept, sent or waiting: seven days, in ms.
pub(crate) const KEPT_MS: i64 = 7 * 24 * 60 * 60 * 1000;

pub struct Sharing {
    /// `sharing.toml`.
    file: PathBuf,
    /// The ID it sends with.
    ids: Arc<Ids>,
    /// Why this Banda never sends, whatever is on.
    never: Option<Never>,
    /// Which Banda it is: `stable`, `dev` or `local`.
    channel: &'static str,
    /// The time now, in ms since the epoch: what tells a day has ended.
    clock: Clock,
    /// What posts an event.
    post: Arc<dyn Post>,
}

/// The time now, in ms since the epoch.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Why a Banda never sends, whatever its file turns on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "sharing/")]
pub enum Never {
    /// It runs from a checkout of Banda's source, as in CI and the tests.
    Checkout,
    /// `BANDA_SHARING=0` turned it off for this run.
    Run,
}

impl Sharing {
    /// Shares as `sharing.toml` in `config` says, with the ID kept in
    /// the `state` folder.
    pub fn new(config: impl Into<PathBuf>, state: impl Into<PathBuf>) -> Self {
        Self {
            file: config
                .into()
                .join(<settings::SharingSettings as banda_look::OneFile>::NAME),
            ids: Arc::new(Ids {
                path: state.into().join("sharing-id"),
                held: Mutex::new(()),
            }),
            never: None,
            channel: "local",
            clock: Arc::new(banda_kernel::now_ms),
            post: Arc::new(Capture::at(CAPTURE)),
        }
    }

    /// Never sends, for `why`.
    pub fn never(self, why: Never) -> Self {
        Self {
            never: Some(why),
            ..self
        }
    }

    /// Tells the time by `clock`, as a test lets a day end.
    pub fn clock(self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        Self {
            clock: Arc::new(clock),
            ..self
        }
    }

    /// Says it is Banda's `channel`: `stable` or `dev`.
    pub fn channel(self, channel: &'static str) -> Self {
        Self { channel, ..self }
    }

    /// Posts what goes with `post`, not to PostHog: only a test does.
    pub fn posting(self, post: impl Post + 'static) -> Self {
        Self {
            post: Arc::new(post),
            ..self
        }
    }

    fn courier(&self) -> courier::Courier {
        courier::Courier {
            file: self.file.clone(),
            ids: self.ids.clone(),
            never: self.never,
            channel: self.channel,
            clock: self.clock.clone(),
            post: self.post.clone(),
        }
    }

    async fn shared(&self, call: &Call, shares: Shares, anew: bool) -> Result<Shared, Refusal> {
        let id = self.ids.id(shares, anew)?;
        let since = banda_kernel::now_ms() - KEPT_MS;
        let sent = call.project().read(move |sql| kept(sql, since)).await?;
        Ok(Shared {
            shares,
            id,
            never: self.never,
            sent,
        })
    }
}

/// The random ID, in a file of its own in the state folder.
pub(crate) struct Ids {
    path: PathBuf,
    /// Held while it is made, read or erased.
    held: Mutex<()>,
}

impl Ids {
    /// The ID while anything is shared, made as sharing turns on, or made
    /// `anew`; none, and the one there was erased, while nothing is. It is
    /// looked at as the window reads the state, and as an event is made.
    pub(crate) fn id(&self, shares: Shares, anew: bool) -> Result<Option<String>, Error> {
        let _held = self.held.lock().unwrap_or_else(|held| held.into_inner());
        if !shares.any() {
            return match std::fs::remove_file(&self.path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
                _ => Ok(None),
            };
        }
        let kept = std::fs::read_to_string(&self.path).ok();
        let kept = kept.map(|kept| kept.trim().to_owned());
        if let Some(kept) = kept.filter(|kept| !anew && Uuid::parse_str(kept).is_ok()) {
            return Ok(Some(kept));
        }
        let id = Uuid::new_v4().to_string();
        if let Some(folder) = self.path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        std::fs::write(&self.path, &id)?;
        Ok(Some(id))
    }
}

banda_kernel::methods! {
    Sharing(Call) as "SharingMethods" in "sharing/" {
        /// What Banda shares, the ID it sends with, why it never sends if
        /// it does not, and each event of the last seven days, as it went.
        call state(Nothing) -> Shared, Read;
        /// A new random ID, so that what goes from now on joins up with
        /// nothing sent before. Only while something is shared.
        command new_id(Nothing) -> Shared, Decide;
        /// An example of each event, exactly as this Banda would send it,
        /// for "See exactly what is sent".
        call example(Nothing) -> events::Examples, Read;
    }
}

/// What Banda shares, and what it sent.
#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "sharing/")]
pub struct Shared {
    #[serde(flatten)]
    #[ts(flatten)]
    pub shares: Shares,
    /// The random ID it sends with, while anything is shared.
    pub id: Option<String>,
    /// Why this Banda never sends, whatever is on.
    pub never: Option<Never>,
    /// The events of the last seven days, the newest first.
    pub sent: Vec<Sent>,
}

/// One event, kept before it goes.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "sharing/")]
pub struct Sent {
    /// Its name: `$exception` or `day`.
    pub event: String,
    /// What it is about, in a few words.
    pub about: String,
    /// The exact JSON that goes.
    pub json: String,
    /// When it was made, and when it went: none while it waits. In ms
    /// since the epoch.
    #[ts(type = "number")]
    pub made: i64,
    #[ts(type = "number | null")]
    pub sent: Option<i64>,
}

#[async_trait::async_trait]
impl Module for Sharing {
    fn name(&self) -> &'static str {
        "sharing"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        // Each event, as it goes or waits to.
        &[
            "CREATE TABLE sharing_sent (
               id INTEGER PRIMARY KEY,
               event TEXT NOT NULL,
               about TEXT NOT NULL,
               json TEXT NOT NULL,
               made INTEGER NOT NULL,
               sent INTEGER
           )",
            // How far into the log it had heard, until the kernel kept its
            // cursor (ADR 0082, decision 6): read as it starts, and used
            // once, as its listener begins there.
            "CREATE TABLE sharing_heard (
               one INTEGER PRIMARY KEY CHECK (one = 1),
               at INTEGER NOT NULL
             )",
            // While usage is shared: the ID it counts for, since when, and
            // the last day, in days since the epoch, it counted.
            "CREATE TABLE sharing_usage (
               one INTEGER PRIMARY KEY CHECK (one = 1),
               id TEXT NOT NULL,
               since INTEGER NOT NULL,
               last INTEGER
             )",
            // Whether what waited in `sharing_sent` was queued in the
            // kernel's outbox, which sends it now (ADR 0082, A5): once.
            "CREATE TABLE sharing_carried (one INTEGER PRIMARY KEY CHECK (one = 1))",
        ]
    }

    /// From where it last heard, it makes an event of each Problem as the
    /// problems module says it, and the kernel's outbox posts each from
    /// the host, the oldest first.
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        courier::start(self.courier(), project).await
    }

    /// Posts one event it kept.
    async fn run(&self, project: ModuleProject, effect: Effect) -> Outcome {
        match effect.kind.as_str() {
            courier::POST => self.courier().post(project, &effect).await,
            other => Outcome::Fail(format!("sharing runs no effect of kind {other}")),
        }
    }

    /// A post cut short goes again: PostHog may take it twice, as it may
    /// when its answer is lost.
    fn on_restart(&self, _: &str) -> OnRestart {
        OnRestart::Replay
    }

    /// A post is tried for as long as its event is kept.
    fn retry(&self, _: &str) -> Retry {
        courier::TRIED
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

impl Sharing {
    async fn state(&self, call: Call, _: Nothing) -> Result<Shared, Refusal> {
        self.shared(&call, settings::read(&self.file), false).await
    }

    async fn example(&self, _: Call, _: Nothing) -> Result<events::Examples, Refusal> {
        let banda = exception::Banda::this(self.channel);
        Ok(events::examples(&banda, usage::locale().as_deref()))
    }

    async fn new_id(&self, call: Call, _: Nothing) -> Result<Shared, Refusal> {
        let shares = settings::read(&self.file);
        if !shares.any() {
            return Err(Refusal::conflict(
                "Nothing is shared: an ID is made as sharing turns on.",
            ));
        }
        self.shared(&call, shares, true).await
    }
}

/// The events made `since`, the newest first.
fn kept(sql: &rusqlite::Connection, since: i64) -> Result<Vec<Sent>, Error> {
    let mut query = sql.prepare(
        "SELECT event, about, json, made, sent FROM sharing_sent
         WHERE made >= ?1 ORDER BY made DESC, id DESC",
    )?;
    let rows = query.query_map([since], sent)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn sent(row: &Row<'_>) -> rusqlite::Result<Sent> {
    Ok(Sent {
        event: row.get(0)?,
        about: row.get(1)?,
        json: row.get(2)?,
        made: row.get(3)?,
        sent: row.get(4)?,
    })
}
