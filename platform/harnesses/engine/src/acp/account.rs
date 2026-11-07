//! Who is signed in to a Harness, and the ways it offers to sign in. The
//! engine declares terminal sign-in, so a Harness offers its ways, Claude
//! Code's in a terminal among them ([`Process::ways`]). Who is signed in
//! comes from the Harness's own reports (`_auth/status_update`, which
//! Claude Code's and Codex's adapters push), never from its files. A
//! Harness that does not report it shows no one.

use super::{Process, in_words};
use crate::model::{Account, SignInWay, SignedInAs};
use crate::{Failed, Harness};
use agent_client_protocol::schema::v1 as acp;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::timeout;

/// How long a Harness that signs in by itself may wait for its Person.
const SIGNING_IN: Duration = Duration::from_secs(10 * 60);
/// How long a Harness may take to sign out.
const SIGNING_OUT: Duration = Duration::from_secs(60);
/// How long a Harness that reports who is signed in may take to first say
/// it: Claude Code's adapter asks its CLI, for up to 5 seconds.
const FIRST_REPORT: Duration = Duration::from_secs(6);

/// Where a Harness declares that it reports who is signed in.
pub(super) const REPORTS_ACCOUNT_META: &str = "authStatus";

/// Who the Harness says is signed in, pushed once it started and at each
/// change. The adapters' extension, until ACP has it.
#[derive(Clone, Debug, Serialize, Deserialize, agent_client_protocol::JsonRpcNotification)]
#[notification(method = "_auth/status_update")]
pub(super) struct AuthStatusUpdate {
    #[serde(rename = "authStatus")]
    pub(super) status: AuthStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct AuthStatus {
    /// `account`, `api_key`, `gateway`, `external`, or `none`.
    kind: String,
    label: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    account: Option<AuthAccount>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct AuthAccount {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organization: Option<String>,
}

impl From<AuthStatus> for SignedInAs {
    fn from(status: AuthStatus) -> Self {
        let account = status.account.unwrap_or_default();
        SignedInAs {
            signed_in: status.kind != "none",
            label: status.label,
            detail: status.detail,
            email: account.email,
            organization: account.organization,
        }
    }
}

/// The ways `harness` offers to sign in, from what it said when it
/// started. A way in a terminal runs the Harness's own program with the
/// way's arguments after its own, and the way's environment over its own,
/// as ACP has a client do; a kind Banda does not know is left out.
pub(super) fn ways(harness: &Harness, methods: Vec<acp::AuthMethod>) -> Vec<SignInWay> {
    methods
        .into_iter()
        .filter_map(|method| {
            let terminal = match &method {
                acp::AuthMethod::Terminal(way) => Some(harness.program(&way.args, &way.env)),
                acp::AuthMethod::Agent(_) => None,
                _ => return None,
            };
            Some(SignInWay {
                id: method.id().0.to_string(),
                name: method.name().to_owned(),
                description: method.description().map(str::to_owned),
                terminal,
            })
        })
        .collect()
}

impl Process {
    /// The ways the Harness offers to sign in.
    pub fn ways(&self) -> &[SignInWay] {
        &self.ways
    }

    /// This Harness entry as its process says, and how to sign in to it.
    /// A Harness that reports who is signed in says it soon after it
    /// starts: until then this waits, a few seconds at most.
    /// Who is signed in, what the Harness runs, and the Person's CLI as
    /// `harness` finds it now: updated since the start, its Threads stop
    /// warning that it is old.
    pub async fn account(&self, harness: &Harness) -> Result<Account, Failed> {
        let (_, cli) = crate::cli::find(&*self.environment, harness).await?;
        let mut account = self.account.clone();
        if self.about.reports_account {
            let _ = timeout(FIRST_REPORT, account.wait_for(Option::is_some)).await;
        }
        let status = account.borrow().clone();
        let by_account = status.as_ref().is_some_and(|s| s.kind == "account");
        Ok(Account {
            ways: self.ways.clone(),
            adapter: self.about.adapter.clone(),
            cli,
            signed_in_as: status.map(SignedInAs::from),
            signs_out: self.about.signs_out && by_account,
        })
    }

    /// Asks the Harness to sign out, when it says it does. One that does
    /// not stays so; one that did not answer, or answered an error, may
    /// sign out when asked again.
    pub async fn sign_out(&self) -> Result<(), Failed> {
        let name = &self.name;
        if !self.about.signs_out {
            return Err(Failed::Lasting(format!(
                "{name} does not sign out from Banda: sign out in a terminal."
            )));
        }
        let asked = self.cx.send_request(acp::LogoutRequest::new()).block_task();
        let signed_out = timeout(SIGNING_OUT, asked).await.map_err(|_| {
            Failed::Passing(format!("Signing out of {name} took too long: try again."))
        })?;
        signed_out.map(|_| ()).map_err(|error| {
            Failed::Passing(format!("{name} could not sign out: {}", in_words(&error)))
        })
    }

    /// Signs in with `way`, which the Harness does by itself: Codex opens
    /// the browser and waits there for the Person. One that did not answer,
    /// or answered an error, may sign in when asked again.
    pub async fn sign_in(&self, way: &str) -> Result<(), Failed> {
        let name = &self.name;
        let request = acp::AuthenticateRequest::new(way.to_owned());
        let asked = self.cx.send_request(request).block_task();
        let signed_in = timeout(SIGNING_IN, asked).await.map_err(|_| {
            Failed::Passing(format!("Signing in to {name} took too long: try again."))
        })?;
        signed_in.map(|_| ()).map_err(|error| {
            Failed::Passing(format!("{name} could not sign in: {}", in_words(&error)))
        })
    }
}
