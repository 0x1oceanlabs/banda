//! One owner for Account discovery, connections and sign-in lifetimes.
//! The machine API delegates here. Settings only persists a prepared
//! connection; providers keep their credentials and report identity.
mod logins;
mod model;
mod omarchy;
mod profiles;

use crate::acp::Process;
use crate::hosts::{Activity, Held, Host, Hosts};
use crate::model::{Account, HarnessView};
use crate::{Failed, Harness, Harnesses};
use agent_client_protocol::Client;
use agent_client_protocol::schema::v1 as acp;
use banda_kernel::{Call, Environment, EventFilter, Refusal};
use logins::Logins;
pub use model::*;
pub(crate) use omarchy::Omarchy;
use profiles::Profiles;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
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
    logins: Logins,
    hosts: Arc<Hosts<Asker>>,
}
impl Accounts {
    pub fn new(harnesses: Harnesses) -> Self {
        Self {
            harnesses,
            profiles: None,
            logins: Logins::default(),
            hosts: Hosts::new(IDLE),
        }
    }

    pub fn with_store(mut self, owned: PathBuf, store: Arc<dyn AccountStore>) -> Self {
        self.profiles = Some(Profiles::new(owned, self.harnesses.clone(), store));
        self
    }

    pub fn profiles(&self) -> Result<Vec<AccountProfile>, Refusal> {
        self.profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account folders are not configured on this engine."))?
            .profiles()
    }

    pub(crate) async fn remove_account(
        &self,
        call: Call,
        args: RemoveAccount,
    ) -> Result<String, Refusal> {
        let to = self
            .profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account settings are not configured."))?
            .remove(&args.harness, args.to.as_deref(), call.participant())?;
        self.hosts.let_go(call.project().id(), Some(&args.harness));
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
        self.profiles
            .as_ref()
            .ok_or_else(|| Refusal::conflict("Account folders are not configured on this engine."))?
            .connect(account)
    }

    pub(crate) async fn account(&self, call: Call, harness: String) -> Result<Accounted, Refusal> {
        // Read before the Harness is: a change after it is a later event.
        let at = call.project().at().await?;
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
        if account.account.cli.is_some()
            && self
                .harnesses
                .find(&harness)
                .is_some_and(|h| h.harness() == "codex")
        {
            ways.insert(
                0,
                AccountWay {
                    id: "device-code".into(),
                    name: "ChatGPT (device code on another computer)".into(),
                },
            );
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
                Ok((process, pty)) => {
                    self.logins
                        .terminal(&status.login, process.holding(held), pty, cancel)
                }
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
    pub(crate) async fn login_finish(&self, call: Call, args: LoginId) -> Result<(), Refusal> {
        let status = self.logins.status(&args.login)?;
        if !status.done {
            return Err(Refusal::conflict("Sign-in is still running."));
        }
        self.changed(&call, &status.harness).await?;
        self.logins.forget(&args.login);
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
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
                    folder: None
                })
                .is_err()
        );
    }
}
