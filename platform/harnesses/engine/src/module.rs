//! The module `harnesses` (ADR 0040, decisions 1 and 2): the Harnesses
//! this computer can start, and who is signed in to each. It is the
//! machine's, so its methods name no Project, and a Person signs in before
//! there is one.
//!
//! It asks through a Harness process of its own, with no session, in a
//! pool keyed by the machine's ID, let go after [`IDLE`] with nothing
//! asked. A sign-in or sign-out writes `account_changed`, whose subject is
//! the Harness's ID: every holder of that Harness's process lets go of it,
//! this module first, and the command answers once every reaction has
//! handled it.
//!
//! It reads how much of each account's limits is spent, too (ADR 0043):
//! [`crate::limits`].

use crate::acp::Process;
use crate::hosts::{Activity, Held, Host, Hosts};
use crate::limits::Reader;
use crate::model::{Account, HarnessView, Limits, LimitsLook};
use crate::usage::UsageNow;
use crate::{FILE, Failed, Harness, Harnesses};
use agent_client_protocol::Client;
use agent_client_protocol::schema::v1 as acp;
use banda_kernel::{
    Call, Environment, Error, EventFilter, Kind, Module, ModuleProject, Nothing, Refusal, Right,
    Scope, Tool,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use ts_rs::TS;

/// The version of every event this module writes.
const VERSION: u32 = 1;

/// What a sign-in or sign-out writes; its subject is the Harness's ID.
const ACCOUNT_CHANGED: &str = "account_changed";

/// How long the module's own process of a Harness may sit with nothing
/// asked.
const IDLE: Duration = Duration::from_secs(5 * 60);

/// How long a sign-in waits for every holder of the Harness's process to
/// let go of it.
const REACTED: Duration = Duration::from_secs(5);

/// The module's settings files in `~/.config/banda` (ADR 0016).
pub const SETTINGS: [banda_look::SettingsFile; 1] = [FILE];

/// What hears that an account changed: the module's `account_changed`.
pub fn account_changed() -> EventFilter {
    EventFilter {
        module: Some("harnesses".into()),
        subject: None,
        kinds: Some(vec![ACCOUNT_CHANGED.into()]),
    }
}

pub struct HarnessesModule {
    harnesses: Harnesses,
    hosts: Arc<Hosts<Asker>>,
    limits: Reader,
    usage: crate::usage::Reader,
}

impl HarnessesModule {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            limits: Reader::new(harnesses.clone()),
            usage: crate::usage::Reader::new(harnesses.clone()),
            harnesses,
            hosts: Hosts::new(IDLE),
        }
    }

    /// Asks for Claude Code's limits at `url`, a stand-in of Anthropic's,
    /// which gets the token: only a test does.
    pub fn anthropic_at(self, url: &str) -> Self {
        Self {
            limits: self.limits.anthropic_at(url),
            ..self
        }
    }
}

banda_kernel::methods! {
    HarnessesModule(Call) as "HarnessesMethods" in "harnesses/" {
        /// The Harnesses this computer can start.
        call list(Nothing) -> Vec<HarnessView>, Read;
        /// A Harness as it says: its program, who is signed in, how to sign
        /// in, at the machine's log's position it is current at.
        call account(OneHarness) -> Accounted, Manage;
        /// Signs in with one of the Harness's ways. A way in a terminal ran
        /// there already: the Person signed in in it.
        command sign_in(SignIn) -> (), Manage;
        /// Asks the Harness to sign out.
        command sign_out(OneHarness) -> (), Manage;
        /// How much of each Harness account's usage limits is spent: a
        /// window for its session and its week, each with the share spent
        /// out of 100 and when it starts again, as last read. Before a long
        /// task, look how much is left. `read` reads them anew, at most
        /// once a minute; `limits_changed` says when that read is kept.
        call limits(AskLimits) -> LimitsNow, Read, tool "limits";
        /// Local journal token usage and USD API estimates, including
        /// sessions outside Banda. UTC daily rows for a bounded interval;
        /// unpriced requests are explicit. `read` collects new records.
        call usage(AskUsage) -> UsageNow, Read;
    }
}

#[derive(Deserialize, TS)]
#[ts(export_to = "harnesses/")]
struct OneHarness {
    harness: String,
}

/// What `limits` asks.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "harnesses/")]
struct AskLimits {
    /// Read them anew, as a popover opens: within a minute of the last
    /// read, it is not read again.
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    read: bool,
}

/// A half-open interval of at most 90 days. Defaults to the past 24 hours.
#[derive(Deserialize, TS)]
#[ts(export_to = "harnesses/")]
struct AskUsage {
    #[serde(default)]
    #[ts(optional, type = "number")]
    since: Option<i64>,
    #[serde(default)]
    #[ts(optional, type = "number")]
    until: Option<i64>,
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    read: bool,
}

/// The limits as last read, at the machine's log's position `at`: a
/// window asks again on a `limits_changed` after it.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct LimitsNow {
    #[ts(type = "number")]
    pub at: i64,
    /// Every Harness Banda reads the limits of; none while `[limits]
    /// read` is off.
    pub limits: Vec<Limits>,
    /// The share spent from which the bar's widget warns: `[limits] warn`.
    pub warn: u8,
    /// How the bar's widget shows the room left: `[limits] look`.
    pub look: LimitsLook,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "harnesses/")]
struct SignIn {
    harness: String,
    way: String,
}

/// Who is signed in to a Harness, as of the machine's log's position `at`:
/// a window reads it again on an `account_changed` after it.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct Accounted {
    #[ts(type = "number")]
    pub at: i64,
    pub account: Account,
}

#[async_trait::async_trait]
impl Module for HarnessesModule {
    fn name(&self) -> &'static str {
        "harnesses"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[
            crate::limits::TABLE,
            crate::usage::TABLES,
            crate::usage::REREAD_CODEX,
        ]
    }

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        self.limits.start(project.clone()).await?;
        self.usage.start(project).await
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    /// A sign-in waits for the Person, up to ten minutes.
    fn runs_on(&self, method: &str) -> bool {
        method == "sign_in"
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

impl HarnessesModule {
    async fn list(&self, _: Call, _: Nothing) -> Result<Vec<HarnessView>, Refusal> {
        Ok(self.harnesses.views())
    }

    async fn account(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<Accounted, Refusal> {
        // Read before the Harness is: a change after it is a later event.
        let at = call.project().at().await?;
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        let account = asker.process.account(&harness).await?;
        Ok(Accounted { at, account })
    }

    async fn limits(
        &self,
        call: Call,
        AskLimits { read }: AskLimits,
    ) -> Result<LimitsNow, Refusal> {
        let project = call.project();
        // Read before the limits are: a read kept after it is a later event.
        let at = project.at().await?;
        let (limits, settings) = self.limits.now(project, read).await?;
        let (warn, look) = (settings.warn, settings.look);
        Ok(LimitsNow {
            at,
            limits,
            warn,
            look,
        })
    }

    async fn usage(&self, call: Call, args: AskUsage) -> Result<UsageNow, Refusal> {
        const DAY: i64 = 86_400_000;
        let now = banda_kernel::now_ms();
        let until = args.until.unwrap_or(now);
        let since = args.since.unwrap_or(until.saturating_sub(DAY));
        if since < now - 92 * DAY
            || until > now
            || since >= until
            || until.saturating_sub(since) > 90 * DAY
        {
            return Err(Refusal::invalid(
                "Usage needs an interval of at most 90 days within the last 92 days.",
            ));
        }
        if args.read {
            self.usage.scan(call.project()).await?;
        }
        self.usage
            .now(call.project(), since, until)
            .await
            .map_err(Into::into)
    }

    async fn sign_in(&self, call: Call, SignIn { harness, way }: SignIn) -> Result<(), Refusal> {
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        let process = &asker.process;
        let found = (process.ways().iter().find(|w| w.id == way)).ok_or_else(|| {
            Refusal::not_found(format!("{} offers no such way to sign in.", harness.name))
        })?;
        if found.terminal.is_none() {
            process.sign_in(&way).await?;
        }
        self.changed(&call, &harness.id).await
    }

    async fn sign_out(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<(), Refusal> {
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        asker.process.sign_out().await?;
        self.changed(&call, &harness.id).await
    }

    /// Harness entry `id` with the module's process of it, started if need
    /// be, held busy while the guard lives. A start that failed is refused
    /// as [`Failed`] says: `conflict` only when it lasts.
    async fn asker(&self, call: &Call, id: &str) -> Result<(Harness, Arc<Asker>, Held), Refusal> {
        let harness = self.harnesses.get(id).map_err(Refusal::invalid)?;
        let project = call.project();
        let asker = (self.hosts)
            .get(project.id(), project.environment(), &harness)
            .await?;
        let held = asker.activity.hold();
        Ok((harness, asker, held))
    }

    /// After a sign-in or a sign-out: ACP has a client start the Harness
    /// again, so it reads the account anew. The module lets go of its own
    /// process, says the account changed, and answers once every holder of
    /// the Harness's process has heard it. The receipt keeps the answer,
    /// and the kernel answers the same command, sent again, from it.
    async fn changed(&self, call: &Call, harness: &str) -> Result<(), Refusal> {
        self.hosts.let_go(call.project().id(), Some(harness));
        let (author, subject) = (call.participant(), harness.to_owned());
        call.command(move |tx| {
            tx.emit(
                ACCOUNT_CHANGED,
                VERSION,
                Some(&subject),
                author,
                &Value::Null,
            )
            .map(|_| ())
        })
        .await?;
        if !call.project().reacted(REACTED).await {
            tracing::warn!(harness, "an account changed before all heard it");
        }
        Ok(())
    }
}

/// The module's own process of a Harness: no session, only asked.
struct Asker {
    process: Process,
    activity: Activity,
}

impl Host for Asker {
    async fn start(
        environment: Arc<dyn Environment>,
        harness: &Harness,
    ) -> Result<Arc<Self>, Failed> {
        let shows = acp::ClientCapabilities::new();
        let (process, _) =
            Process::start(environment, harness, Client.builder(), shows, || {}).await?;
        let activity = Activity::default();
        Ok(Arc::new(Asker { process, activity }))
    }

    fn alive(&self) -> bool {
        self.process.alive()
    }

    fn idle_since(&self) -> Option<Instant> {
        self.activity.idle_since()
    }
}
