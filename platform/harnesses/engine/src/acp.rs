//! A Harness process, spoken to over ACP v1 on its stdio: starting it in
//! its Project's environment (ADR 0084), recording what it says, agreeing
//! on ACP, and who is signed in to it (`account`). A client adds what it
//! needs to the connection: the agents module its sessions' handlers and
//! the capabilities they declare ([`Process::start`]).
//!
//! Starting a Harness is bounded: [`STARTING`].

use crate::cli::Located;
use crate::model::{Adapter, SignInWay};
use crate::record::{Recording, To};
use crate::{Failed, Harness};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{
    Agent, Builder, Client, ConnectionTo, HandleConnectionClose, HandleDispatchFrom,
    RunWithConnectionTo,
};
use banda_kernel::Environment;
use pipes::{Pipes, Said};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;

mod account;
mod pipes;

use account::*;

/// How long a Harness may take to start and agree on ACP. The first start
/// may download it.
pub const STARTING: Duration = Duration::from_secs(120);

/// What a Harness says of itself and its account when it starts.
struct About {
    adapter: Option<Adapter>,
    signs_out: bool,
    /// It pushes who is signed in (`_auth/status_update`).
    reports_account: bool,
}

/// One Harness process and its ACP connection. Dropping it stops the
/// process and everything it started.
pub struct Process {
    cx: ConnectionTo<Agent>,
    harness: String,
    /// The Harness's name, for plain words.
    name: String,
    /// The ways it offers to sign in.
    ways: Vec<SignInWay>,
    about: About,
    /// Where the Person's CLI it runs was found when it started.
    cli: Option<Located>,
    /// Where it runs, which looks for its CLI again.
    environment: Arc<dyn Environment>,
    /// Who it last said is signed in.
    account: watch::Receiver<Option<AuthStatus>>,
    driver: JoinHandle<()>,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

/// What a Harness's error says, in the words it has for a Person.
fn in_words(error: &agent_client_protocol::Error) -> &str {
    let said = error.data.as_ref().and_then(|d| d.get("message"));
    said.and_then(|m| m.as_str())
        .unwrap_or(error.message.trim())
}

impl Process {
    /// Starts `harness` in `environment`, its Project's or the machine's,
    /// and agrees on ACP v1 with it. `client` holds the caller's handlers
    /// and `shows` what it declares it can show; terminal sign-in is
    /// declared here. `ended` runs once the connection ends, in
    /// whatever way, a failed start too, which the builder's own close
    /// hook does not see. Answers the process and what the Harness agreed
    /// to, less its account's part: its information and ways to sign in.
    /// Only a CLI that is not installed and an ACP version Banda does not
    /// speak stop it for good; any other start that fails may pass.
    pub async fn start<H, R, C>(
        environment: Arc<dyn Environment>,
        harness: &Harness,
        client: Builder<Client, H, R, C>,
        shows: acp::ClientCapabilities,
        ended: impl FnOnce() + Send + 'static,
    ) -> Result<(Process, acp::InitializeResponse), Failed>
    where
        H: HandleDispatchFrom<Agent> + 'static,
        R: RunWithConnectionTo<Agent> + 'static,
        C: HandleConnectionClose<Agent> + 'static,
    {
        // The entry as it starts, with its CLI's path when it runs one.
        let (harness, cli) = crate::cli::find(&*environment, harness).await?;
        let recording = match &harness.record {
            Some(folder) => Some(Recording::start(folder, &harness.id).map_err(Failed::Passing)?),
            None => None,
        };
        let id = harness.id.clone();
        let process = Pipes {
            environment: environment.clone(),
            program: harness.start(),
            hears: Arc::new(move |line, said| {
                let to = match said {
                    Said::ToHarness => To::Harness,
                    Said::ToBanda => To::Banda,
                    Said::Stderr => {
                        tracing::debug!(harness = %id, "{line}");
                        return;
                    }
                };
                if let Some(recording) = &recording {
                    recording.write(to, line);
                }
            }),
        };
        let (ready, started) = oneshot::channel();
        let (told, account) = watch::channel(None);
        let shows = shows.auth(acp::AuthCapabilities::new().terminal(true));
        let driver = tokio::spawn(async move {
            drive(process, client, shows, told, ready).await;
            ended();
        });
        let (cx, mut answer) = match timeout(STARTING, started).await {
            Ok(Ok(Ok(started))) => started,
            Ok(Ok(Err(failed))) => return Err(failed),
            Ok(Err(_)) => {
                return Err(Failed::Passing(
                    "The Harness stopped while it started.".to_owned(),
                ));
            }
            Err(_) => {
                driver.abort();
                return Err(Failed::Passing(
                    "The Harness did not start within two minutes.".to_owned(),
                ));
            }
        };
        let capabilities = &answer.agent_capabilities;
        let about = About {
            adapter: answer.agent_info.take().map(|info| Adapter {
                name: info.title.unwrap_or(info.name),
                version: info.version,
            }),
            signs_out: capabilities.auth.logout.is_some(),
            reports_account: (capabilities.meta.as_ref())
                .is_some_and(|meta| meta.contains_key(REPORTS_ACCOUNT_META)),
        };
        let process = Process {
            cx,
            harness: harness.id.clone(),
            name: harness.name.clone(),
            ways: ways(&harness, std::mem::take(&mut answer.auth_methods)),
            about,
            cli: cli.map(|cli| Located::new(cli.path, &harness)),
            environment,
            account,
            driver,
        };
        Ok((process, answer))
    }

    /// The connection, to ask the Harness.
    pub fn cx(&self) -> &ConnectionTo<Agent> {
        &self.cx
    }

    /// The ID of the Harness entry it runs.
    pub fn harness(&self) -> &str {
        &self.harness
    }

    /// The Harness's name, for plain words.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether the process still answers.
    pub fn alive(&self) -> bool {
        !self.driver.is_finished() && !self.cx.is_incoming_closed()
    }

    /// Why the Person's CLI it runs is old, as the latest look at it
    /// found, by any process of the Harness.
    pub fn outdated(&self) -> Option<String> {
        self.cli.as_ref()?.outdated(&self.name)
    }
}

type Started = (ConnectionTo<Agent>, acp::InitializeResponse);

async fn drive<H, R, C>(
    process: Pipes,
    client: Builder<Client, H, R, C>,
    shows: acp::ClientCapabilities,
    told: watch::Sender<Option<AuthStatus>>,
    ready: oneshot::Sender<Result<Started, Failed>>,
) where
    H: HandleDispatchFrom<Agent>,
    R: RunWithConnectionTo<Agent>,
    C: HandleConnectionClose<Agent>,
{
    let served = Client
        .builder()
        .name("banda")
        .on_receive_notification(
            async move |note: AuthStatusUpdate, _cx: ConnectionTo<Agent>| {
                told.send_replace(Some(note.status));
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .with_connection_builder(client)
        .connect_with(process, async move |cx: ConnectionTo<Agent>| {
            let hello = acp::InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(shows)
                .client_info(acp::Implementation::new("banda", banda_kernel::version()));
            match cx.send_request(hello).block_task().await {
                Ok(answer) if answer.protocol_version == ProtocolVersion::V1 => {
                    let _ = ready.send(Ok((cx.clone(), answer)));
                }
                Ok(answer) => {
                    let _ = ready.send(Err(Failed::Lasting(format!(
                        "The Harness speaks ACP {:?}; Banda speaks version 1.",
                        answer.protocol_version
                    ))));
                    return Ok(());
                }
                Err(error) => {
                    let said = format!("The Harness did not start: {error}");
                    let _ = ready.send(Err(Failed::Passing(said)));
                    return Ok(());
                }
            }
            cx.incoming_closed().await;
            Ok(())
        })
        .await;
    if let Err(error) = served {
        tracing::warn!(%error, "a Harness connection ended with an error");
    }
}
