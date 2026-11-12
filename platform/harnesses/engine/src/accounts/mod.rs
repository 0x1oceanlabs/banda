//! One owner for Account discovery, connections and sign-in lifetimes.
//! The machine API delegates here. Settings only persists a prepared
//! connection; providers keep their credentials and report identity.
mod answer;
mod logins;
mod model;
mod omarchy;
mod profiles;
pub mod secrets;

use crate::acp::Process;
use crate::hosts::{Activity, Held, Host, Hosts};
use crate::model::{Account, AccountKind, HarnessView, SignedInAs};
use crate::{Failed, Harness, Harnesses};
use agent_client_protocol::Client;
use agent_client_protocol::schema::v1 as acp;
pub use answer::{AccountList, HarnessOf, NewAccount};
use banda_kernel::{Call, Environment, EventFilter, ModuleProject, Participant, Refusal, Stream};
use logins::Logins;
pub use model::*;
pub(crate) use omarchy::Omarchy;
use profiles::Profiles;
use secrets::{Kept, Secrets};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use ts_rs::TS;

/// The version of every event this module writes.
const VERSION: u32 = 1;

/// What a sign-in or sign-out writes; its subject is the Harness's ID.
const ACCOUNT_CHANGED: &str = "account_changed";

/// What a list that reads otherwise writes, with no subject: a window
/// reads the list again. A rename is one, and ends no Turn, as an
/// `account_changed` would (ADR 0108, decision 4).
const LIST_CHANGED: &str = "list_changed";

/// How long the module's own process of a Harness may sit with nothing
/// asked.
const IDLE: Duration = Duration::from_secs(5 * 60);

/// How long a sign-in waits for every holder of the Harness's process to
/// let go of it.
const REACTED: Duration = Duration::from_secs(5);

/// What hears that an account changed: the module's `account_changed`.
pub fn account_changed() -> EventFilter {
    EventFilter {
        module: Some("harnesses".into()),
        subject: None,
        kinds: Some(vec![ACCOUNT_CHANGED.into()]),
    }
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

/// The machine's Account service. One instance owns its connections,
/// sign-in sessions and the processes used to ask providers for identity.
pub struct Accounts {
    harnesses: Harnesses,
    profiles: Option<Profiles>,
    secrets: Option<Secrets>,
    logins: Logins,
    hosts: Arc<Hosts<Asker>>,
}
impl Accounts {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            profiles: None,
            secrets: None,
            logins: Logins::default(),
            hosts: Hosts::new(IDLE),
        }
    }

    fn secrets(&self) -> Result<&Secrets, Refusal> {
        self.secrets
            .as_ref()
            .ok_or_else(|| Refusal::conflict("This engine keeps no secrets."))
    }

    /// Adds a gateway account (ADR 0078, decision 1): a new folder for its
    /// Harness, which sends its requests to `url` and asks for its key
    /// with `banda secret get <id>`, and the key in the machine's secrets.
    pub(crate) async fn add_gateway(&self, args: AddGateway) -> Result<GatewayAdded, Refusal> {
        let url = gateway_url(&args.url)?;
        let profiles = self.owning()?;
        if self.harnesses.find(&args.id).is_some() {
            return Err(Refusal::conflict("That Account ID is already registered."));
        }
        if !matches!(args.harness.as_str(), "claude" | "codex") {
            return Err(Refusal::invalid("A gateway serves Claude Code or Codex."));
        }
        let kept = self.secrets()?.put(&args.id, &args.key).await?;
        let account = ConnectAccount {
            harness: args.harness,
            id: args.id.clone(),
            name: args.name,
            colour: args.colour,
            icon: args.icon,
            kind: Some(AccountKind::Gateway),
            folder: None,
        };
        let account = match profiles.connect_as(account, Some(url)) {
            Ok(account) => account,
            Err(refused) => {
                let _ = self.secrets()?.forget(&args.id).await;
                return Err(refused);
            }
        };
        Ok(GatewayAdded { account, kept })
    }

    /// Changes an entry's name, emblem, or whether it is offered.
    pub fn update_account(&self, change: UpdateAccount) -> Result<HarnessView, Refusal> {
        self.owning()?.update(change)
    }

    /// Chooses the account a new Thread starts on, or takes it back.
    pub fn set_start(&self, start: SetStart) -> Result<(), Refusal> {
        self.owning()?.set_start(start)
    }

    /// Sets the models in a Harness's menu, or takes them back (ADR 0114,
    /// decision 7).
    pub fn set_models(&self, set: SetModels) -> Result<(), Refusal> {
        self.owning()?.set_models(set)
    }

    /// The list of the machine's Accounts as of its log's position `at`
    /// (ADR 0108, decision 4).
    pub fn list(&self, at: i64) -> AccountList {
        self.reader()(at)
    }

    /// What reads the list as of a position, apart from the service, so a
    /// task can keep it.
    fn reader(&self) -> impl Fn(i64) -> AccountList + Clone + Send + 'static {
        let harnesses = self.harnesses.clone();
        let store = self.profiles.as_ref().map(Profiles::store);
        move |at| {
            let start = store.as_ref().map_or((None, None), |store| store.start());
            let models = (store.as_ref()).map_or_else(Default::default, |store| store.models());
            answer::answer(at, harnesses.views(), start, models)
        }
    }

    /// Follows the folders the list is made from, and writes
    /// `list_changed` each time it reads otherwise: after a command, the
    /// CLI or a change by hand alike.
    pub(crate) fn follow(&self, project: ModuleProject) {
        let mut watch = match project.watch(self.harnesses.folders()) {
            Ok(watch) => watch,
            Err(error) => {
                tracing::warn!(%error, "the Accounts are not followed: a window sees a change as it reads them again");
                return;
            }
        };
        if let [folder, ..] = watch.limited() {
            tracing::warn!(
                folder = %folder.display(),
                "the system had no watch left, so a change of the Accounts by hand is not told: \
                 raise inotify's max_user_watches"
            );
        }
        let reader = self.reader();
        // Held weakly: a strong hold keeps the machine's Project, and its
        // lock, open after the engine lets it go.
        let project = project.downgrade();
        let read = move || {
            let reader = reader.clone();
            tokio::task::spawn_blocking(move || reader(0))
        };
        tokio::spawn(async move {
            let Ok(mut was) = read().await else {
                return;
            };
            while watch.next().await.is_some() {
                let Ok(now) = read().await else {
                    return;
                };
                if now == was {
                    continue;
                }
                was = now;
                let Some(project) = project.upgrade() else {
                    return;
                };
                let owner = Participant::Person(project.owner());
                let wrote = project
                    .write(move |tx| {
                        tx.emit(LIST_CHANGED, VERSION, None, owner, &Value::Null)?;
                        Ok(())
                    })
                    .await;
                if let Err(error) = wrote {
                    tracing::warn!(%error, "a change of the Accounts was not told");
                }
            }
        });
    }

    fn owning(&self) -> Result<&Profiles, Refusal> {
        self.profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account folders are not configured on this engine."))
    }

    /// Keeps a new key for the gateway account `harness`.
    pub(crate) async fn set_key(&self, args: AccountKey) -> Result<Kept, Refusal> {
        self.gateway(&args.harness)?;
        self.secrets()?.put(&args.harness, &args.key).await
    }

    /// The key of the gateway account `id`, for its Harness's `banda secret
    /// get`: only the Person gets it, and a pass that account runs, of its
    /// own process or of a session in it, which its Claude Code and Codex
    /// ask with, and which its Agents' shells share.
    pub(crate) async fn secret(&self, call: &Call, id: &str) -> Result<String, Refusal> {
        self.gateway(id)?;
        if let Participant::Agent(_) = call.participant()
            && call.runs() != Some(id)
        {
            return Err(Refusal::forbidden(
                "Only this Account's own Harness reads its key.",
            ));
        }
        self.secrets()?.get(id).await
    }

    /// Hands `key` to Codex's own `codex login --with-api-key` for the
    /// account `harness`, which keeps it: Banda keeps none.
    pub(crate) async fn api_key(&self, call: Call, args: AccountKey) -> Result<(), Refusal> {
        let harness = self
            .harnesses
            .get(&args.harness)
            .map_err(Refusal::invalid)?;
        if harness.harness() != "codex" {
            return Err(Refusal::invalid(
                "Only Codex takes an API key here: Claude Code signs in to Anthropic Console itself.",
            ));
        }
        let key = args.key.trim();
        if key.is_empty() {
            return Err(Refusal::invalid("The key is empty."));
        }
        let environment = call.project().environment();
        let (harness, cli) = crate::cli::find(&*environment, &harness).await?;
        let cli = cli.ok_or_else(|| Refusal::conflict("This Account names no Codex CLI."))?;
        if let Err(error) = harness.make_shadow().await {
            tracing::warn!(%error, "an account's home does not shadow its Harness's");
        }
        // The Person's own act, with the key they typed on its input:
        // outside the fence, on pipes, as Codex reads a key only from them.
        let mut login =
            banda_kernel::Program::act(&cli.path, vec!["login".into(), "--with-api-key".into()]);
        login.env = harness.env.clone();
        login_with_key(&*environment, &login, key).await?;
        self.changed(&call, &harness.id).await
    }

    /// The entry `id`, if it is a gateway account whose key Banda keeps.
    fn gateway(&self, id: &str) -> Result<Harness, Refusal> {
        let harness = self.harnesses.get(id).map_err(Refusal::invalid)?;
        if harness.url.is_none() {
            return Err(Refusal::not_found(
                "Banda keeps no key for this Account: only a gateway has one.",
            ));
        }
        Ok(harness)
    }

    /// Who a gateway account is signed in as: its address, with its key
    /// kept or not. No Harness is asked: Banda holds what it would say.
    async fn gateway_signed_in(&self, harness: &Harness) -> SignedInAs {
        let url = harness.url.clone().unwrap_or_default();
        let host = reqwest::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_else(|| url.clone());
        let kept = match &self.secrets {
            Some(secrets) => secrets.has(&harness.id).await,
            None => false,
        };
        SignedInAs {
            signed_in: kept,
            label: if kept {
                format!("Gateway · {host}")
            } else {
                "No key".to_owned()
            },
            detail: Some(url),
            email: None,
            organization: None,
        }
    }

    pub fn with_store(
        mut self,
        owned: PathBuf,
        store: Arc<dyn AccountStore>,
        secrets: Secrets,
    ) -> Self {
        self.profiles = Some(Profiles::new(owned, self.harnesses.clone(), store));
        self.secrets = Some(secrets);
        self
    }

    pub fn profiles(&self) -> Result<Vec<AccountProfile>, Refusal> {
        self.owning()?.profiles()
    }

    pub(crate) async fn remove_account(
        &self,
        call: Call,
        args: RemoveAccount,
    ) -> Result<String, Refusal> {
        let gateway = self.gateway(&args.harness).is_ok();
        let to = self
            .profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account settings are not configured."))?
            .remove(&args.harness, args.to.as_deref(), call.participant())?;
        self.hosts.let_go(call.project().id(), Some(&args.harness));
        // A removed gateway's key does not outlive it in the keyring.
        if gateway
            && let Some(secrets) = &self.secrets
            && let Err(refused) = secrets.forget(&args.harness).await
        {
            tracing::warn!(error = %refused.message, "a removed gateway's key stays");
        }
        let author = call.participant();
        let to = call
            .command(move |tx| {
                tx.emit(
                    ACCOUNT_CHANGED,
                    VERSION,
                    Some(&args.harness),
                    author,
                    &serde_json::json!({"removed": true, "to": to}),
                )?;
                Ok(to)
            })
            .await?;
        if !call.project().reacted(REACTED).await {
            tracing::warn!("Account removed; some Projects will apply the move when they catch up");
        }
        Ok(to)
    }

    pub fn remove(
        &self,
        id: &str,
        expected: Option<&str>,
        by: banda_kernel::Participant,
    ) -> Result<String, Refusal> {
        self.profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account settings are not configured."))?
            .remove(id, expected, by)
    }

    pub fn connect(&self, account: ConnectAccount) -> Result<HarnessView, Refusal> {
        self.owning()?.connect(account)
    }

    pub(crate) async fn account(&self, call: Call, harness: String) -> Result<Accounted, Refusal> {
        // Read before the Harness is: a change after it is a later event.
        let at = call.project().at().await?;
        if let Ok(gateway) = self.gateway(&harness) {
            let account = Account {
                ways: Vec::new(),
                adapter: None,
                cli: None,
                signed_in_as: Some(self.gateway_signed_in(&gateway).await),
                signs_out: false,
            };
            return Ok(Accounted { at, account });
        }
        let (harness, asker, _asking) = self.asker(&call, &harness).await?;
        let account = asker.process.account(&harness).await?;
        Ok(Accounted { at, account })
    }

    pub(crate) async fn status(
        &self,
        call: Call,
        harness: String,
    ) -> Result<AccountStatus, Refusal> {
        let account = self.account(call, harness.clone()).await?;
        let mut ways: Vec<_> = account
            .account
            .ways
            .into_iter()
            .map(|way| AccountWay {
                id: way.id,
                name: way.name,
            })
            .collect();
        let entry = self.harnesses.find(&harness);
        if account.account.cli.is_some() && entry.as_ref().is_some_and(|h| h.harness() == "codex") {
            ways.insert(
                0,
                AccountWay {
                    id: "device-code".into(),
                    name: "ChatGPT (device code on another computer)".into(),
                },
            );
        }
        if let Some(entry) = &entry {
            ways.retain(|way| fits(entry, &way.id));
        }
        Ok(AccountStatus {
            harness,
            ways,
            signed_in_as: account.account.signed_in_as,
        })
    }

    pub(crate) async fn login_account(
        &self,
        call: Call,
        args: LoginAccount,
    ) -> Result<LoginStatus, Refusal> {
        let selected = self
            .harnesses
            .get(&args.harness)
            .map_err(Refusal::invalid)?;
        if !matches!(selected.harness(), "claude" | "codex") {
            return Err(Refusal::invalid(
                "Managed sign-in supports Claude Code and Codex Accounts.",
            ));
        }
        if selected.url.is_some() {
            return Err(Refusal::invalid(
                "A gateway signs in with its key: set_key gives it a new one.",
            ));
        }
        let (harness, asker, held) = self.asker(&call, &args.harness).await?;
        let ways = asker.process.ways();
        let way = if args.way.as_deref() == Some("device-code") && harness.harness() == "codex" {
            let (_, cli) = crate::cli::find(&*call.project().environment(), &harness).await?;
            let cli = cli.ok_or_else(|| Refusal::conflict("This Account names no Codex CLI."))?;
            // Codex's own device flow prints a URL and code, so the Person
            // can finish on their Mac while this engine runs on arc.
            let mut program = banda_kernel::Program::terminal(
                &cli.path,
                vec!["login".into(), "--device-auth".into()],
            );
            program.env = harness.env.clone();
            crate::model::SignInWay {
                id: "device-code".into(),
                name: "ChatGPT (device code)".into(),
                description: None,
                terminal: Some(program),
            }
        } else {
            match args.way {
                Some(id) => ways.iter().find(|way| way.id == id),
                None if ways.len() == 1 => ways.first(),
                _ => None,
            }
            .ok_or_else(|| Refusal::invalid("Choose a sign-in way from account_status.ways."))?
            .clone()
        };
        let (status, cancel) = self.logins.reserve(&harness.id)?;
        if let Some(program) = way.terminal {
            let started = call.project().environment().pty(
                &program,
                banda_kernel::PtySize {
                    rows: 30,
                    cols: 100,
                },
            );
            match started {
                Ok((process, pty)) => self.logins.terminal(
                    &status.login,
                    process.holding(held),
                    pty,
                    cancel,
                    self.finish(&call, &harness.id),
                ),
                Err(error) => {
                    self.logins.forget(&status.login);
                    return Err(Refusal::conflict(format!(
                        "The sign-in could not start: {error}"
                    )));
                }
            }
        } else {
            self.logins.agent(
                &status.login,
                async move {
                    let _held = held;
                    asker.process.sign_in(&way.id).await.map_err(Into::into)
                },
                cancel,
                self.finish(&call, &harness.id),
            );
        }
        Ok(status)
    }
    pub(crate) fn login_status(&self, args: LoginId) -> Result<LoginStatus, Refusal> {
        self.logins.status(&args.login)
    }
    pub(crate) async fn login_input(&self, args: LoginInput) -> Result<(), Refusal> {
        self.logins.input(&args.login, &args.text).await
    }
    pub(crate) fn login_cancel(&self, args: LoginId) -> Result<(), Refusal> {
        self.logins.cancel(&args.login)
    }
    /// A sign-in's status as it changes, one piece each, ending once it
    /// is done (ADR 0108, decision 5).
    pub(crate) fn login_watch(&self, args: LoginId) -> Result<Stream, Refusal> {
        let mut status = self.logins.watch(&args.login)?;
        let (say, said) = tokio::sync::mpsc::channel(1);
        tokio::spawn(async move {
            loop {
                let (now, done) = {
                    let now = status.borrow_and_update();
                    (serde_json::to_value(&*now), now.done)
                };
                let Ok(now) = now else { return };
                if say.send(now).await.is_err() || done {
                    return;
                }
                // Till it changes, or its watcher goes.
                tokio::select! {
                    changed = status.changed() => if changed.is_err() { return },
                    () = say.closed() => return,
                }
            }
        });
        Ok(said)
    }

    /// Lets go of an ended sign-in's report before it expires: the engine
    /// finished the sign-in as it ended, so the Account is read again
    /// already. It stays for Agents' tools (ADR 0108, decision 5).
    pub(crate) fn login_finish(&self, args: LoginId) -> Result<(), Refusal> {
        if !self.logins.status(&args.login)?.done {
            return Err(Refusal::conflict("Sign-in is still running."));
        }
        self.logins.forget(&args.login);
        Ok(())
    }

    /// What the engine does as a sign-in of `harness` ends, before it says
    /// so: lets go of the Harness's processes and says its account changed,
    /// so nothing waits for a window to finish it (ADR 0108, decision 5).
    fn finish(&self, call: &Call, harness: &str) -> impl Future<Output = ()> + Send + 'static {
        let hosts = self.hosts.clone();
        let project = call.project().downgrade();
        let (by, subject) = (call.participant(), harness.to_owned());
        async move {
            let Some(project) = project.upgrade() else {
                return;
            };
            hosts.let_go(project.id(), Some(&subject));
            let told = subject.clone();
            match project.write(move |tx| tell_changed(tx, by, &told)).await {
                Ok(()) => heard(&project, &subject).await,
                Err(error) => tracing::warn!(%error, "a sign-in's end was not told"),
            }
        }
    }

    pub(crate) async fn sign_in(
        &self,
        call: Call,
        harness: String,
        way: String,
    ) -> Result<(), Refusal> {
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

    pub(crate) async fn sign_out(&self, call: Call, harness: String) -> Result<(), Refusal> {
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
        let (by, subject) = (call.participant(), harness.to_owned());
        call.command(move |tx| tell_changed(tx, by, &subject))
            .await?;
        heard(call.project(), harness).await;
        Ok(())
    }
}

/// Says that `harness`'s sign-in changed: every process of it goes.
fn tell_changed(
    tx: &mut banda_kernel::Tx<'_>,
    by: Participant,
    harness: &str,
) -> Result<(), banda_kernel::Error> {
    let changed = tx.emit(ACCOUNT_CHANGED, VERSION, Some(harness), by, &Value::Null);
    changed.map(|_| ())
}

/// Waits a while for everything that lets go of `harness`'s processes to
/// hear it changed.
async fn heard(project: &ModuleProject, harness: &str) {
    if !project.reacted(REACTED).await {
        tracing::warn!(harness, "an account changed before all heard it");
    }
}

/// Whether the way `way` signs in an account of `harness`'s kind (ADR
/// 0078, decision 1): an API key account of Claude Code signs in to
/// Anthropic Console, and one of Codex takes its key (`api_key`), with no
/// way of its Harness's; any other account every way.
fn fits(harness: &Harness, way: &str) -> bool {
    match harness.kind {
        AccountKind::Api => harness.harness() == "claude" && way == "console-login",
        AccountKind::Subscription | AccountKind::Gateway => true,
    }
}

/// `url` as a gateway's address: an absolute http(s) URL with no
/// credentials in it, which go in the key.
fn gateway_url(url: &str) -> Result<String, Refusal> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| {
        Refusal::invalid("A gateway's address is a URL, such as https://openrouter.ai/api.")
    })?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err(Refusal::invalid(
            "A gateway's address starts with https://.",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(Refusal::invalid(
            "A gateway's address carries no credentials: the key goes in the key.",
        ));
    }
    Ok(url.trim().trim_end_matches('/').to_owned())
}

/// Has Claude Code in `folder`, a gateway account's own, ask for its key
/// with `banda secret get <id>`: its `apiKeyHelper` (ADR 0078, decision 1).
/// `banda` is first on the PATH of each Harness process Banda starts.
fn ask_for_key(folder: &Path, id: &str) -> std::io::Result<()> {
    let file = folder.join("settings.json");
    let mut settings = match std::fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({})),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(error) => return Err(error),
    };
    settings["apiKeyHelper"] = format!("banda secret get {id}").into();
    let text = serde_json::to_string_pretty(&settings).map_err(std::io::Error::other)?;
    std::fs::write(file, text + "\n")
}

/// Runs `login`, Codex's `login --with-api-key`, in `environment` with
/// `key` on its input.
async fn login_with_key(
    environment: &dyn Environment,
    login: &banda_kernel::Program,
    key: &str,
) -> Result<(), Refusal> {
    use tokio::io::AsyncWriteExt;
    let mut started = environment
        .spawn(login, banda_kernel::Input::Piped)
        .map_err(|e| Refusal::conflict(format!("Codex could not start: {e}.")))?;
    if let Some(mut input) = started.stdin.take() {
        input
            .write_all(format!("{key}\n").as_bytes())
            .await
            .map_err(|e| Refusal::conflict(format!("Codex took no key: {e}.")))?;
    }
    let output = tokio::time::timeout(Duration::from_secs(60), started.wait_with_output())
        .await
        .map_err(|_| Refusal::conflict("Codex's sign-in did not end in a minute."))?
        .map_err(|e| Refusal::conflict(format!("Codex's sign-in failed: {e}.")))?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        return Err(Refusal::conflict(format!(
            "Codex refused the key: {}",
            said.trim()
        )));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_api_key_account_signs_in_to_console_or_with_its_key_alone() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("harnesses.toml");
        let text = concat!(
            "[omarchy]\nenabled = false\n",
            "[[harness]]\nid = \"claude\"\n[[harness]]\nid = \"codex\"\n",
            "[[harness]]\nid = \"ca\"\nof = \"claude\"\nkind = \"api\"\n",
            "[[harness]]\nid = \"xa\"\nof = \"codex\"\nkind = \"api\"\n",
        );
        std::fs::write(&file, text).unwrap();
        let list = Harnesses::load(&file).unwrap();
        let ways = |id: &str| {
            let harness = list.find(id).unwrap();
            [
                "claude-ai-login",
                "console-login",
                "chat-gpt",
                "device-code",
            ]
            .into_iter()
            .filter(|way| fits(&harness, way))
            .collect::<Vec<_>>()
        };
        assert_eq!(ways("ca"), ["console-login"]);
        assert_eq!(ways("xa"), Vec::<&str>::new());
        assert_eq!(
            ways("claude").len(),
            4,
            "a subscription's are all its Harness's"
        );
    }

    /// Codex reads a key only from its input, on pipes: the Person's
    /// act's, which the environment starts so.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_key_goes_to_its_sign_in_on_its_input() {
        let check = r#"read key; [ "$key" = sk-1 ] || { echo "got $key" >&2; exit 1; }"#;
        let login = banda_kernel::Program::act("sh", vec!["-c".into(), check.into()]);
        let local = banda_environments::Local;
        login_with_key(&local, &login, "sk-1").await.unwrap();
        let refused = login_with_key(&local, &login, "sk-2").await.unwrap_err();
        assert!(refused.message.contains("got sk-2"), "{}", refused.message);
    }
    /// A store that keeps nothing.
    struct Refuses;
    impl AccountStore for Refuses {
        fn save(&self, _: &ConnectedAccount) -> Result<(), Refusal> {
            Err(Refusal::invalid("no"))
        }
    }

    #[tokio::test]
    async fn a_gateway_that_cannot_be_saved_leaves_no_folder_and_no_key() {
        let root = tempfile::tempdir().unwrap();
        let keyring = keyring_core::mock::Store::new().unwrap();
        let secrets =
            Secrets::with_keyring("banda-test", root.path().join("secrets"), Some(keyring));
        let owned = root.path().join("accounts");
        let accounts = Accounts::new(Harnesses::known()).with_store(
            owned.clone(),
            Arc::new(Refuses),
            secrets.clone(),
        );
        let refused = accounts
            .add_gateway(AddGateway {
                harness: "claude".into(),
                id: "or".into(),
                name: Some("OpenRouter".into()),
                colour: None,
                icon: None,
                url: "https://openrouter.ai/api".into(),
                key: "sk-test".into(),
            })
            .await;
        assert!(refused.is_err());
        assert!(!owned.join("or").exists(), "no folder is left behind");
        assert!(!secrets.has("or").await, "no key is left behind");
    }

    #[test]
    fn missing_persistence_is_a_refusal_not_a_partial_connection() {
        let accounts = Accounts::new(Harnesses::known());
        assert!(accounts.profiles().is_err());
        assert!(
            accounts
                .connect(ConnectAccount {
                    harness: "claude".into(),
                    id: "work".into(),
                    name: None,
                    colour: None,
                    icon: None,
                    kind: None,
                    folder: None
                })
                .is_err()
        );
    }
}
