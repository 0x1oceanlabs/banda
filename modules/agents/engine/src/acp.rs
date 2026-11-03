//! The ACP adapter: one Harness process, spoken to over ACP v1 on its
//! stdio. ACP's words stop here and in `acp/`: the rest of the module hears
//! what the Harness [`Said`], and how a turn ended, in the module's own
//! words. A file per concept: opening a session (`opening`), the session a
//! turn holds ([`Session`]), what the Harness says (`said`), its options
//! and modes (`options`), failures (`failure`), what it asks (`asking`),
//! and who is signed in (`account`).
//!
//! The engine declares what it can show: notices, options that are on or
//! off, and forms, which Claude Code needs to ask a Person its own
//! questions and Codex to ask in a plan. The JetBrains AIR extension would
//! say more, but a client that declares it must render the rest of AIR too.
//!
//! The connection's handlers run on its dispatch loop, so none of them
//! waits there. A permission request is routed to its turn, and a task off
//! the loop answers it once the Person decides.
//!
//! Starting a Harness and opening a session are bounded; a turn is not: it
//! runs until the Harness ends it or a Person stops it.

use crate::model::{
    Account, Adapter, Choice, CliView, Cost, Exit, Failure, Field, FieldValue, HarnessOption,
    Input, Mode, Offer, OptionChoice, OptionValue, PlanStep, Program, Settings, SignInWay,
    SignedInAs, Skill, SlashCommand, StepState, TextFormat, ThreadId, ToolContent, ToolKind,
    ToolStatus, TurnState, Usage, Values,
};
use crate::plain;
use crate::record::{Recording, To};
use crate::rules::Ending;
use crate::settings::Harness;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;

mod account;
mod asking;
mod failure;
mod opening;
mod options;
mod routes;
mod said;
mod session;

use account::*;
use asking::*;
use failure::*;
pub use opening::{Evidence, ForkAt, Opened};
pub use options::Running;
use options::*;
pub use routes::Between;
use routes::*;
use said::*;
pub use said::{Answer, Said, ToolChange};
use session::*;
pub use session::{Prompt, PromptImage, Session, Steered, WeakSession};

/// How long a Harness may take to start and agree on ACP. The first start
/// may download it.
pub const STARTING: Duration = Duration::from_secs(120);
/// How long a Harness may take to open a session.
pub const OPENING: Duration = Duration::from_secs(60);
/// What the Harness said it can do with sessions.
#[derive(Clone, Copy)]
struct Agreed {
    loads: bool,
    resumes: bool,
    /// It takes images in a prompt.
    images: bool,
    /// It takes a message into a running turn (`_session/steering`).
    steers: bool,
    /// It forks a session (`session/fork`).
    forks: bool,
}

/// What a Harness said when it started: what it can do with sessions, and
/// how a Person signs in to it.
struct Started {
    cx: ConnectionTo<Agent>,
    agreed: Agreed,
    methods: Vec<acp::AuthMethod>,
    about: About,
}

/// What a Harness says of itself and its account when it starts.
struct About {
    adapter: Option<Adapter>,
    signs_out: bool,
    /// It pushes who is signed in (`_auth/status_update`).
    reports_account: bool,
}

/// One Harness process and its ACP connection. Dropping it stops the
/// process and everything it started.
pub struct Connection {
    cx: ConnectionTo<Agent>,
    harness: String,
    /// The Harness's name, for plain words.
    name: String,
    agreed: Agreed,
    /// The ways it offers to sign in.
    ways: Vec<SignInWay>,
    about: About,
    /// The Person's CLI it runs, as last found: when it started, or when a
    /// Person last asked who is signed in.
    cli: Mutex<Option<CliView>>,
    /// Who it last said is signed in.
    account: watch::Receiver<Option<AuthStatus>>,
    routes: Routes,
    learned: Learned,
    /// When a turn last began or ended here.
    active: Arc<Mutex<Instant>>,
    /// The turns the Agent went on with by itself here, which keep the
    /// host as the engine's turns do.
    kept: Arc<AtomicUsize>,
    /// The Harness's session for each Thread, in this process.
    sessions: tokio::sync::Mutex<HashMap<ThreadId, acp::SessionId>>,
    driver: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

/// While it lives, its host is not let go as idle.
pub struct Kept {
    kept: Arc<AtomicUsize>,
    active: Arc<Mutex<Instant>>,
}

impl Drop for Kept {
    fn drop(&mut self) {
        *self.active.lock().unwrap() = Instant::now();
        self.kept.fetch_sub(1, Ordering::SeqCst);
    }
}

/// What a Harness's error says, in the words it has for a Person.
fn in_words(error: &agent_client_protocol::Error) -> &str {
    let said = error.data.as_ref().and_then(|d| d.get("message"));
    said.and_then(|m| m.as_str())
        .unwrap_or(error.message.trim())
}

impl Connection {
    /// Starts `harness` and agrees on ACP v1 with it.
    pub async fn start(harness: &Harness) -> Result<Arc<Connection>, String> {
        // The entry as it starts, with its CLI's path when it runs one.
        let (harness, cli) = crate::cli::find(harness).await?;
        let harness = &harness;
        let config = AcpAgentConfig::new(&harness.command)
            .args(harness.args.iter().cloned())
            .envs(harness.env.clone());
        let recording = match &harness.record {
            Some(folder) => Some(Recording::start(folder, &harness.id)?),
            None => None,
        };
        let name = harness.id.clone();
        let process = AcpAgent::new(config).with_debug(move |line, direction| {
            let to = match direction {
                LineDirection::Stdin => To::Harness,
                LineDirection::Stdout => To::Banda,
                LineDirection::Stderr => {
                    tracing::debug!(harness = %name, "{line}");
                    return;
                }
            };
            if let Some(recording) = &recording {
                recording.write(to, line);
            }
        });
        let (routes, learned) = (Routes::default(), Learned::default());
        let (ready, started) = oneshot::channel();
        let (told, account) = watch::channel(None);
        let driver = tokio::spawn(drive(process, routes.clone(), learned.clone(), told, ready));
        let Started {
            cx,
            agreed,
            methods,
            about,
        } = match timeout(STARTING, started).await {
            Ok(Ok(Ok(agreed))) => agreed,
            Ok(Ok(Err(error))) => return Err(error),
            Ok(Err(_)) => return Err("The Harness stopped while it started.".to_owned()),
            Err(_) => {
                driver.abort();
                return Err("The Harness did not start within two minutes.".to_owned());
            }
        };
        Ok(Arc::new(Connection {
            cx,
            harness: harness.id.clone(),
            name: harness.name.clone(),
            agreed,
            ways: ways(harness, methods),
            about,
            cli: Mutex::new(cli),
            account,
            routes,
            learned,
            active: Arc::new(Mutex::new(Instant::now())),
            kept: Arc::default(),
            sessions: Default::default(),
            driver,
        }))
    }

    /// Whether the process still answers.
    pub fn alive(&self) -> bool {
        !self.driver.is_finished() && !self.cx.is_incoming_closed()
    }

    /// Since when no turn runs here, or `None` while one does.
    pub fn idle_since(&self) -> Option<Instant> {
        let busy = self.routes.busy() || self.kept.load(Ordering::SeqCst) > 0;
        (!busy).then(|| *self.active.lock().unwrap())
    }

    /// Keeps the host while the Agent goes on by itself, as a turn does.
    pub fn keep(&self) -> Kept {
        self.kept.fetch_add(1, Ordering::SeqCst);
        Kept {
            kept: self.kept.clone(),
            active: self.active.clone(),
        }
    }

    /// Marks the host as just used, so it is not let go as idle.
    pub fn touch(&self) {
        *self.active.lock().unwrap() = Instant::now();
    }

    /// What a session runs with, as `known` holds it, with what the
    /// Harness agreed to take.
    fn runs(&self, known: &Known) -> Running {
        let mut running = running(known);
        running.offer.no_images = !self.agreed.images;
        let cli = self.cli.lock().unwrap();
        running.offer.outdated = cli.as_ref().and_then(|c| c.outdated.clone());
        running
    }

    /// Whether the Harness takes a message into a running turn.
    pub fn steers(&self) -> bool {
        self.agreed.steers
    }

    /// The Harness's name, for plain words.
    pub fn name(&self) -> &str {
        &self.name
    }
}

async fn drive(
    process: AcpAgent,
    routes: Routes,
    learned: Learned,
    told: watch::Sender<Option<AuthStatus>>,
    ready: oneshot::Sender<Result<Started, String>>,
) {
    let heard = routes.clone();
    let asked = routes.clone();
    let filling = routes.clone();
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
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
                let said = match note.update {
                    acp::SessionUpdate::ConfigOptionUpdate(now) => {
                        let known = learn(&learned, &note.session_id, now.config_options);
                        Some(Said::Runs(running(&known)))
                    }
                    acp::SessionUpdate::AvailableCommandsUpdate(now) => {
                        Some(Said::Runs(update(&learned, &note.session_id, |known| {
                            known.said = Some(now.available_commands);
                            known.read_commands();
                            running(known)
                        })))
                    }
                    now => said(now),
                };
                // What it has used may come between turns: the next turn
                // writes what it last said.
                if let Some(Said::Used { usage, .. }) = &said {
                    update(&learned, &note.session_id, |known| {
                        known.usage = Some(usage.clone());
                    });
                }
                if let Some(said) = said
                    && let Some(route) = heard.of(&note.session_id)
                {
                    route.send(said);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: acp::RequestPermissionRequest,
                        responder: agent_client_protocol::Responder<
                acp::RequestPermissionResponse,
            >,
                        cx: ConnectionTo<Agent>| {
                let (answer, decided) = oneshot::channel();
                let fields = &request.tool_call.fields;
                let call = request.tool_call.tool_call_id.0.to_string();
                let question = Said::Asks {
                    call: call.clone(),
                    title: fields.title.clone(),
                    tool: fields.kind.map(tool_kind),
                    offered: request.options.iter().map(offered).collect(),
                    form: None,
                    plan: proposed(fields),
                    answer,
                };
                let route = asked.of(&request.session_id);
                let Some(route) = route.filter(|route| route.send(question)) else {
                    return responder.respond(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    ));
                };
                let withdrawn = responder.cancellation();
                cx.spawn(async move {
                    let decided = tokio::select! {
                        decided = decided => decided,
                        () = withdrawn.cancelled() => {
                            let _ = route.send(Said::Withdrawn(call));
                            Ok(Answer::Cancelled)
                        }
                    };
                    let outcome = match decided {
                        Ok(Answer::Chose(option)) => acp::RequestPermissionOutcome::Selected(
                            acp::SelectedPermissionOutcome::new(option),
                        ),
                        Ok(Answer::Filled(_) | Answer::Cancelled) | Err(_) => {
                            acp::RequestPermissionOutcome::Cancelled
                        }
                    };
                    responder.respond(acp::RequestPermissionResponse::new(outcome))
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: acp::CreateElicitationRequest,
                        responder: agent_client_protocol::Responder<
                acp::CreateElicitationResponse,
            >,
                        cx: ConnectionTo<Agent>| {
                let cancel = || acp::CreateElicitationResponse::new(acp::ElicitationAction::Cancel);
                // Only a form in a session can be asked in a Thread.
                let acp::ElicitationMode::Form(form) = &request.mode else {
                    return responder.respond(cancel());
                };
                let acp::ElicitationScope::Session(scope) = &form.scope else {
                    return responder.respond(cancel());
                };
                let Some(route) = filling.of(&scope.session_id) else {
                    return responder.respond(cancel());
                };
                let Some(fields) = form_fields(&form.requested_schema) else {
                    let _ = route.send(Said::Notice(
                        "The Agent asked with a form Banda cannot show, so it went unanswered."
                            .to_owned(),
                    ));
                    return responder.respond(cancel());
                };
                let call = scope.tool_call_id.as_ref().map_or_else(
                    || format!("form-{}", uuid::Uuid::now_v7()),
                    |id| id.0.to_string(),
                );
                let (answer, decided) = oneshot::channel();
                let choice = |id: &str, name: &str, allows| Choice {
                    id: id.to_owned(),
                    name: name.to_owned(),
                    allows,
                    always: false,
                };
                let question = Said::Asks {
                    call: call.clone(),
                    title: Some(request.message.clone()),
                    tool: None,
                    offered: vec![choice(SUBMIT, "Submit", true), choice(SKIP, "Skip", false)],
                    form: Some(fields.clone()),
                    plan: None,
                    answer,
                };
                if !route.send(question) {
                    return responder.respond(cancel());
                }
                let withdrawn = responder.cancellation();
                cx.spawn(async move {
                    let decided = tokio::select! {
                        decided = decided => decided,
                        // The Harness stopped waiting, as Codex does when
                        // its question times out: the Question closes.
                        () = withdrawn.cancelled() => {
                            let _ = route.send(Said::Withdrawn(call));
                            Ok(Answer::Cancelled)
                        }
                    };
                    let action = match decided {
                        Ok(Answer::Filled(values)) => acp::ElicitationAction::Accept(
                            acp::ElicitationAcceptAction::new().content(content(&fields, values)),
                        ),
                        Ok(Answer::Chose(_)) => acp::ElicitationAction::Decline,
                        Ok(Answer::Cancelled) | Err(_) => acp::ElicitationAction::Cancel,
                    };
                    responder.respond(acp::CreateElicitationResponse::new(action))
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(process, async move |cx: ConnectionTo<Agent>| {
            let options = acp::SessionConfigOptionsCapabilities::new()
                .boolean(acp::BooleanConfigOptionCapabilities::new());
            let forms =
                acp::ElicitationCapabilities::new().form(acp::ElicitationFormCapabilities::new());
            let mut output = acp::Meta::new();
            output.insert(OUTPUT_META.to_owned(), true.into());
            let shows = acp::ClientCapabilities::new()
                .auth(acp::AuthCapabilities::new().terminal(true))
                .elicitation(forms)
                .session(
                    acp::ClientSessionCapabilities::new()
                        .notices(acp::NoticeCapabilities::new())
                        .config_options(options),
                )
                .meta(output);
            let hello = acp::InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(shows)
                .client_info(acp::Implementation::new("banda", banda_kernel::version()));
            let agreed = cx.send_request(hello).block_task().await;
            match agreed {
                Ok(answer) if answer.protocol_version == ProtocolVersion::V1 => {
                    let capabilities = &answer.agent_capabilities;
                    let steering = answer
                        .meta
                        .as_ref()
                        .and_then(|meta| meta.get(STEERING_META));
                    let agreed = Agreed {
                        loads: capabilities.load_session,
                        resumes: capabilities.session_capabilities.resume.is_some(),
                        images: capabilities.prompt_capabilities.image,
                        forks: capabilities.session_capabilities.fork.is_some(),
                        steers: steering
                            .and_then(|steering| steering.get("supported"))
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                    };
                    let reports_account = capabilities
                        .meta
                        .as_ref()
                        .is_some_and(|meta| meta.contains_key(REPORTS_ACCOUNT_META));
                    let adapter = answer.agent_info.map(|info| Adapter {
                        name: info.title.unwrap_or(info.name),
                        version: info.version,
                    });
                    let about = About {
                        adapter,
                        signs_out: capabilities.auth.logout.is_some(),
                        reports_account,
                    };
                    let _ = ready.send(Ok(Started {
                        cx: cx.clone(),
                        agreed,
                        methods: answer.auth_methods,
                        about,
                    }));
                }
                Ok(answer) => {
                    let _ = ready.send(Err(format!(
                        "The Harness speaks ACP {:?}; Banda speaks version 1.",
                        answer.protocol_version
                    )));
                    return Ok(());
                }
                Err(error) => {
                    let _ = ready.send(Err(format!("The Harness did not start: {error}")));
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
    routes.clear();
}
