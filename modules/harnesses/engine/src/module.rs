//! The module `harnesses` (ADR 0040, decisions 1 and 2): the Harnesses
//! this computer can start, and who is signed in to each. It is the
//! machine's, so its methods name no Space, and a Person signs in before
//! there is one.
//!
//! It asks through a Harness process of its own, with no session, in a
//! pool keyed by the machine's ID, let go after [`IDLE`] with nothing
//! asked. A sign-in or sign-out writes `account_changed`, whose subject is
//! the Harness's ID: every holder of that Harness's process lets go of it,
//! this module first, and the command answers once every reaction has
//! handled it.

use crate::acp::Process;
use crate::hosts::{Activity, Held, Host, Hosts};
use crate::model::{Account, HarnessView};
use crate::{FILE, Harness, Harnesses};
use agent_client_protocol::Client;
use agent_client_protocol::schema::v1 as acp;
use banda_kernel::{Call, EventFilter, Module, Nothing, Refusal, Right, Scope};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use ts_rs::TS;

/// The version of every event this module writes.
pub const VERSION: u32 = 1;

/// What a sign-in or sign-out writes; its subject is the Harness's ID.
pub const ACCOUNT_CHANGED: &str = "account_changed";

/// How long the module's own process of a Harness may sit with nothing
/// asked.
pub const IDLE: Duration = Duration::from_secs(5 * 60);

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
}

impl HarnessesModule {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            hosts: Hosts::new(IDLE),
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
    }
}

#[derive(Deserialize, TS)]
#[ts(export_to = "harnesses/")]
struct OneHarness {
    harness: String,
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
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
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
        let at = call.space().at().await?;
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        let account = asker.process.account(&harness).await;
        Ok(Accounted {
            at,
            account: account.map_err(Refusal::conflict)?,
        })
    }

    async fn sign_in(&self, call: Call, SignIn { harness, way }: SignIn) -> Result<(), Refusal> {
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        let process = &asker.process;
        let found = (process.ways().iter().find(|w| w.id == way)).ok_or_else(|| {
            Refusal::not_found(format!("{} offers no such way to sign in.", harness.name))
        })?;
        if found.terminal.is_none() {
            process.sign_in(&way).await.map_err(Refusal::conflict)?;
        }
        self.changed(&call, &harness.id).await
    }

    async fn sign_out(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<(), Refusal> {
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        asker.process.sign_out().await.map_err(Refusal::conflict)?;
        self.changed(&call, &harness.id).await
    }

    /// Harness entry `id` with the module's process of it, started if need
    /// be, held busy while the guard lives.
    async fn asker(&self, call: &Call, id: &str) -> Result<(Harness, Arc<Asker>, Held), Refusal> {
        let harness = self.harnesses.get(id).map_err(Refusal::invalid)?;
        let asker = self.hosts.get(call.space().id(), &harness).await;
        let asker = asker.map_err(Refusal::conflict)?;
        let held = asker.activity.hold();
        Ok((harness, asker, held))
    }

    /// After a sign-in or a sign-out: ACP has a client start the Harness
    /// again, so it reads the account anew. The module lets go of its own
    /// process, says the account changed, and answers once every holder of
    /// the Harness's process has heard it. The receipt keeps the answer,
    /// and the kernel answers the same command, sent again, from it.
    async fn changed(&self, call: &Call, harness: &str) -> Result<(), Refusal> {
        self.hosts.let_go(call.space().id(), harness);
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
        if !call.space().reacted(REACTED).await {
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
    async fn start(harness: &Harness) -> Result<Arc<Self>, String> {
        let shows = acp::ClientCapabilities::new();
        let (process, _) = Process::start(harness, Client.builder(), shows, || {}).await?;
        let activity = Activity::new();
        Ok(Arc::new(Asker { process, activity }))
    }

    fn alive(&self) -> bool {
        self.process.alive()
    }

    fn idle_since(&self) -> Option<Instant> {
        self.activity.idle_since()
    }
}
