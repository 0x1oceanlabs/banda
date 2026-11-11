//! The module `harnesses` (ADR 0040, decisions 1 and 2): the Harnesses
//! this computer can start, and who is signed in to each. It is the
//! machine's, so its methods name no Project, and a Person signs in before
//! there is one.
//!
//! It asks through a Harness process of its own, with no session, in a
//! pool keyed by the machine's ID, let go after five minutes with nothing
//! asked. A sign-in or sign-out writes `account_changed`, whose subject is
//! the Harness's ID: every holder of that Harness's process lets go of it,
//! this module first, and the command answers once every reaction has
//! handled it.
//!
//! It reads how much of each account's limits is spent, too (ADR 0043):
//! [`crate::limits`].

use crate::accounts::secrets::{Kept, Secrets};
use crate::accounts::{
    AccountKey, AccountList, AccountProfile, AccountStatus, AccountStore, Accounted, Accounts,
    AddGateway, ConnectAccount, GatewayAdded, LoginAccount, LoginId, LoginInput, LoginStatus,
    RemoveAccount, SetModels, SetStart, UpdateAccount,
};
use crate::limits::Reader;
use crate::model::{HarnessView, Limits, LimitsLook};
use crate::usage::UsageNow;
use crate::{FILE, Harnesses};
use banda_kernel::{
    Call, Error, Kind, Module, ModuleProject, Nothing, Refusal, Right, Scope, Tool,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use ts_rs::TS;

/// The module's settings files in `~/.config/banda` (ADR 0016).
pub const SETTINGS: [banda_look::SettingsFile; 1] = [FILE];

pub struct HarnessesModule {
    harnesses: Harnesses,
    accounts: Accounts,
    limits: Reader,
    usage: crate::usage::Reader,
}

impl HarnessesModule {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            limits: Reader::new(harnesses.clone()),
            usage: crate::usage::Reader::new(harnesses.clone()),
            accounts: Accounts::new(harnesses.clone()),
            harnesses,
        }
    }

    /// Makes accounts' folders in `owned`, keeps them with `store`, and
    /// gateways' keys in `secrets` (ADR 0078, decision 1).
    pub fn with_accounts(
        mut self,
        owned: std::path::PathBuf,
        store: Arc<dyn AccountStore>,
        secrets: Secrets,
    ) -> Self {
        self.accounts = self.accounts.with_store(owned, store, secrets);
        self
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
        call list(Nothing) -> Vec<HarnessView>, Read, tool "accounts";
        /// The machine's Accounts in one answer (ADR 0108, decision 4):
        /// each entry, the Harnesses they are accounts of with what a new
        /// one is called, and the default and the fallback a new Thread
        /// starts on. Read it again on a `list_changed` after its `at`.
        call accounts(Nothing) -> AccountList, Read;
        /// Profile folders on this machine. A discovered folder is not proof
        /// of sign-in; no credentials are returned (ADR 0104).
        call account_profiles(Nothing) -> Vec<AccountProfile>, Read, tool "account_profiles";
        /// Connects a profile or creates an empty Account folder, without
        /// changing what the registered Harness runs (ADR 0104).
        command connect_account(ConnectAccount) -> HarnessView, Write, tool "connect_account";
        /// Changes an entry's name, emblem, or whether it is offered; what
        /// it runs stays the Person's (ADR 0108, decision 1). Any Agent's
        /// pass answers here, as `banda account` is theirs too (ADR 0104,
        /// decision 4).
        command update_account(UpdateAccount) -> HarnessView, Write, pass;
        /// Chooses the account a new Thread starts on, or the one it starts
        /// on while that one is out of its limits (ADR 0108, decision 1).
        /// Any Agent's pass answers here (ADR 0104, decision 4).
        command set_start(SetStart) -> (), Write, pass;
        /// Sets the models in a Harness's menu, the stars of "All models"
        /// (ADR 0114, decision 7). The Person's alone: no pass answers.
        command set_models(SetModels) -> (), Write;
        /// A Harness as it says: its program, who is signed in, how to sign
        /// in, at the machine's log's position it is current at.
        // It needs Manage, and only asks the Harness who is signed in.
        call account(OneHarness) -> Accounted, Manage, read;
        /// Who is signed in, as the Harness says. No sign-in program,
        /// environment or credentials are returned (ADR 0104).
        call account_status(OneHarness) -> AccountStatus, Read, tool "account_status";
        /// Starts the Harness's own sign-in. The Person completes its
        /// browser or terminal step; poll login_status for its output.
        call login_account(LoginAccount) -> LoginStatus, Write, tool "login_account";
        /// Reads a sign-in's bounded terminal output and whether it ended.
        call login_status(LoginId) -> LoginStatus, Read, tool "login_status";
        /// Sends input to the running sign-in terminal, not to a shell.
        call login_input(LoginInput) -> (), Write, tool "login_input";
        /// Stops a running sign-in; finish it to refresh the Account.
        call login_cancel(LoginId) -> (), Write, tool "login_cancel";
        /// Removes an Account from choices and moves its Threads to the
        /// default after their current Turn. Keeps profiles and history;
        /// refuses removing the default.
        command remove_account(RemoveAccount) -> String, Write, tool "remove_account";
        /// Refreshes the Account after a completed sign-in. Then ask
        /// account_status to confirm the Harness's report.
        command login_finish(LoginId) -> (), Write, tool "login_finish";
        /// Signs in with one of the Harness's ways. A way in a terminal ran
        /// there already: the Person signed in in it.
        command sign_in(SignIn) -> (), Manage;
        /// Asks the Harness to sign out.
        command sign_out(OneHarness) -> (), Manage;
        /// Adds an Account that reaches its models through a gateway, its
        /// key kept in the machine's keyring, never in a file the Harness
        /// reads (ADR 0078, decision 1).
        command add_gateway(AddGateway) -> GatewayAdded, Manage;
        /// Keeps a new key for a gateway account.
        command set_key(AccountKey) -> Kept, Manage;
        /// A gateway account's key, for the Person and for that account's
        /// own Harness process, as its `banda secret get` asks.
        call secret(OneHarness) -> String, Read, pass;
        /// Signs a Codex account in with an OpenAI API key, which Codex
        /// keeps.
        command api_key(AccountKey) -> (), Manage;
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

#[derive(Deserialize, TS, JsonSchema)]
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

    fn passes_reach(&self, method: &str) -> bool {
        Self::method_passes(method)
    }

    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        self.accounts.follow(project.clone());
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

    async fn accounts(&self, call: Call, _: Nothing) -> Result<AccountList, Refusal> {
        // Where the log is first: a change after it is told after it.
        let at = call.project().at().await?;
        Ok(self.accounts.list(at))
    }

    async fn account_profiles(&self, _: Call, _: Nothing) -> Result<Vec<AccountProfile>, Refusal> {
        self.accounts.profiles()
    }
    async fn connect_account(
        &self,
        _: Call,
        account: ConnectAccount,
    ) -> Result<HarnessView, Refusal> {
        self.accounts.connect(account)
    }
    async fn update_account(&self, _: Call, change: UpdateAccount) -> Result<HarnessView, Refusal> {
        self.accounts.update_account(change)
    }

    async fn set_start(&self, _: Call, start: SetStart) -> Result<(), Refusal> {
        self.accounts.set_start(start)
    }

    async fn set_models(&self, _: Call, set: SetModels) -> Result<(), Refusal> {
        self.accounts.set_models(set)
    }

    async fn remove_account(&self, call: Call, args: RemoveAccount) -> Result<String, Refusal> {
        self.accounts.remove_account(call, args).await
    }

    async fn account(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<Accounted, Refusal> {
        self.accounts.account(call, harness).await
    }
    async fn account_status(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<AccountStatus, Refusal> {
        self.accounts.status(call, harness).await
    }
    async fn login_account(&self, call: Call, args: LoginAccount) -> Result<LoginStatus, Refusal> {
        self.accounts.login_account(call, args).await
    }
    async fn login_status(&self, _: Call, args: LoginId) -> Result<LoginStatus, Refusal> {
        self.accounts.login_status(args)
    }
    async fn login_input(&self, _: Call, args: LoginInput) -> Result<(), Refusal> {
        self.accounts.login_input(args).await
    }
    async fn login_cancel(&self, _: Call, args: LoginId) -> Result<(), Refusal> {
        self.accounts.login_cancel(args)
    }
    async fn login_finish(&self, call: Call, args: LoginId) -> Result<(), Refusal> {
        self.accounts.login_finish(call, args).await
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
        self.accounts.sign_in(call, harness, way).await
    }
    async fn sign_out(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<(), Refusal> {
        self.accounts.sign_out(call, harness).await
    }
    async fn add_gateway(&self, _: Call, args: AddGateway) -> Result<GatewayAdded, Refusal> {
        self.accounts.add_gateway(args).await
    }
    async fn set_key(&self, _: Call, args: AccountKey) -> Result<Kept, Refusal> {
        self.accounts.set_key(args).await
    }
    async fn secret(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<String, Refusal> {
        self.accounts.secret(&call, &harness).await
    }
    async fn api_key(&self, call: Call, args: AccountKey) -> Result<(), Refusal> {
        self.accounts.api_key(call, args).await
    }
}
