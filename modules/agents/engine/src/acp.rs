//! The ACP adapter: the sessions of one Harness process, which
//! `banda-harnesses` starts ([`Process`]). ACP's words stop here and in
//! `acp/`: the rest of the module hears what the Harness [`Said`], and how
//! a turn ended, in the module's own words. A file per concept: opening a
//! session (`opening`), the session a turn holds ([`Session`]), what the
//! Harness says (`said`), its options and modes (`options`), failures
//! (`failure`), and what it asks (`asking`).
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
    Choice, Cost, Exit, Failure, Field, FieldValue, HarnessOption, Input, Mode, Offer,
    OptionChoice, OptionValue, PlanStep, Settings, Skill, SlashCommand, StepState, TextFormat,
    ThreadId, ToolContent, ToolKind, ToolStatus, TurnState, Usage, Values,
};
use crate::plain;
use crate::rules::Ending;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{Agent, Builder, Client, ConnectionTo, HandleDispatchFrom};
use banda_harnesses::Harness;
use banda_harnesses::acp::Process;
use banda_harnesses::hosts::{Activity, Held, Host};
use banda_harnesses::model::Program;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::timeout;

mod asking;
mod failure;
mod opening;
mod options;
mod routes;
mod said;
mod session;

use asking::*;
use failure::*;
pub use opening::{Evidence, ForkAt, Opened};
pub use options::Running;
use options::*;
pub use routes::Between;
use routes::*;
use said::*;
pub use said::{Answer, Said, ToolChange, ToolPart};
use session::*;
pub use session::{Prompt, PromptImage, Session, Steered, WeakSession};

pub use banda_harnesses::acp::STARTING;

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
    /// It closes a session (`session/close`).
    closes: bool,
}

/// One Harness process and its Threads' sessions in it. Dropping it stops
/// the process and everything it started.
pub struct Connection {
    process: Process,
    agreed: Agreed,
    routes: Routes,
    learned: Learned,
    /// When a turn last began or ended here, and the turns the Agent went
    /// on with by itself here, which keep the host as the engine's do.
    activity: Activity,
    /// The Harness's session for each Thread, in this process.
    sessions: tokio::sync::Mutex<HashMap<ThreadId, acp::SessionId>>,
}

impl Host for Connection {
    /// Starts `harness`, with the handlers its sessions need.
    async fn start(harness: &Harness) -> Result<Arc<Connection>, String> {
        let (routes, learned) = (Routes::default(), Learned::default());
        let ended = routes.clone();
        let (process, answer) = Process::start(
            harness,
            handlers(routes.clone(), learned.clone()),
            shows(),
            move || ended.clear(),
        )
        .await?;
        Ok(Arc::new(Connection {
            process,
            agreed: agreed(&answer),
            routes,
            learned,
            activity: Activity::default(),
            sessions: Default::default(),
        }))
    }

    fn alive(&self) -> bool {
        self.process.alive()
    }

    /// Since when no turn runs here, or `None` while one does.
    fn idle_since(&self) -> Option<Instant> {
        if self.routes.busy() {
            return None;
        }
        self.activity.idle_since()
    }
}

impl Connection {
    /// The Harness process.
    pub fn process(&self) -> &Process {
        &self.process
    }

    /// Keeps the host while the Agent goes on by itself, as a turn does.
    pub fn keep(&self) -> Held {
        self.activity.hold()
    }

    /// Marks the host as just used, so it is not let go as idle.
    pub fn touch(&self) {
        self.activity.touch();
    }

    /// What a session runs with, as `known` holds it, with what the
    /// Harness agreed to take.
    fn runs(&self, known: &Known) -> Running {
        let mut running = running(known);
        running.offer.no_images = !self.agreed.images;
        running.offer.outdated = self.process.outdated();
        running
    }

    /// Whether the Harness takes a message into a running turn.
    pub fn steers(&self) -> bool {
        self.agreed.steers
    }
}

/// What the sessions hear and are asked: routed to their turns.
fn handlers(
    routes: Routes,
    learned: Learned,
) -> Builder<Client, impl HandleDispatchFrom<Agent> + 'static> {
    let heard = routes.clone();
    let asked = routes;
    let filling = asked.clone();
    Client
        .builder()
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
}

/// What the engine declares it can show.
fn shows() -> acp::ClientCapabilities {
    let options = acp::SessionConfigOptionsCapabilities::new()
        .boolean(acp::BooleanConfigOptionCapabilities::new());
    let forms = acp::ElicitationCapabilities::new().form(acp::ElicitationFormCapabilities::new());
    let mut output = acp::Meta::new();
    output.insert(OUTPUT_META.to_owned(), true.into());
    acp::ClientCapabilities::new()
        .elicitation(forms)
        .session(
            acp::ClientSessionCapabilities::new()
                .notices(acp::NoticeCapabilities::new())
                .config_options(options),
        )
        .meta(output)
}

/// What the Harness said it can do with sessions.
fn agreed(answer: &acp::InitializeResponse) -> Agreed {
    let capabilities = &answer.agent_capabilities;
    let steering = (answer.meta.as_ref()).and_then(|meta| meta.get(STEERING_META));
    Agreed {
        loads: capabilities.load_session,
        resumes: capabilities.session_capabilities.resume.is_some(),
        images: capabilities.prompt_capabilities.image,
        forks: capabilities.session_capabilities.fork.is_some(),
        closes: capabilities.session_capabilities.close.is_some(),
        steers: steering
            .and_then(|steering| steering.get("supported"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}
