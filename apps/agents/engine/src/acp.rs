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
    Choice, Cost, CrewStart, Exit, Failure, Field, FieldValue, HarnessOption, Input, Mode, Offer,
    OptionChoice, OptionValue, PlanStep, Settings, Skill, SlashCommand, StepState, Subagent,
    TextFormat, ThreadId, ToolContent, ToolKind, ToolStatus, TurnState, Usage, Values,
};
use crate::plain;
use crate::rules::Ending;
use crate::touching::Place;
use agent_client_protocol::schema::MaybeUndefined;
use agent_client_protocol::schema::v1 as acp;
use agent_client_protocol::{Agent, Builder, Client, ConnectionTo, HandleDispatchFrom};
use banda_harnesses::acp::Process;
use banda_harnesses::hosts::{Activity, Held, Host};
use banda_harnesses::{Failed, Harness};
use banda_kernel::{Environment, Pass, Program};
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
mod script;
mod sdk;
mod session;

use asking::*;
use failure::*;
pub use opening::{Evidence, ForkAt, Opened};
pub use options::Running;
use options::*;
pub use routes::Between;
use routes::*;
use said::*;
pub use said::{
    Announced, Answer, IdleWhy, LaneSaid, LaneState, Said, StartedRx, Tie, ToolChange, ToolPart,
    unstarted,
};
pub use sdk::{Background, Notified, Progress, Sdk, Started, TaskEnd, TaskKind};
#[cfg(test)]
pub use sdk::Tree;
use sdk::SdkMessage;
/// What a Workflow's script says of the Crew it starts (ADR 0103, decision
/// 30).
pub use script::start as crew_meta;
use session::*;
pub use session::{CrewSaid, Prompt, PromptImage, Session, Steered, WeakSession};

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

/// A Thread's session open in a Harness process, and the pass it was
/// given, if it was given one.
pub(crate) type Open = (acp::SessionId, Option<Pass>);

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
    /// The Harness's session for each Thread, in this process, with the
    /// pass it was given, held while the session is open: revoked as it is
    /// let go, or as the process stops (ADR 0083, decision 2).
    sessions: tokio::sync::Mutex<HashMap<ThreadId, Open>>,
    /// Whether its sessions load what the Project's folder names, as the
    /// Project's trust was when it started (ADR 0083, decision 5).
    trusted: bool,
}

impl Host for Connection {
    /// Starts `harness` in `environment`, with the handlers its sessions
    /// need.
    async fn start(
        environment: Arc<dyn Environment>,
        harness: &Harness,
    ) -> Result<Arc<Connection>, Failed> {
        let (routes, learned) = (Routes::default(), Learned::default());
        let activity = Activity::default();
        let ended = routes.clone();
        let (process, answer) = Process::start(
            environment,
            harness,
            handlers(routes.clone(), learned.clone(), activity.clone()),
            shows(),
            move || ended.clear(),
        )
        .await?;
        Ok(Arc::new(Connection {
            process,
            agreed: agreed(&answer),
            routes,
            learned,
            activity,
            sessions: Default::default(),
            trusted: harness.trusted(),
        }))
    }

    fn alive(&self) -> bool {
        self.process.alive()
    }

    /// Since when no turn runs here, or `None` while one does, or while
    /// Claude says work of a Thread's goes on in the background that is no
    /// housekeeping of its own (ADR 0103, decision 11).
    fn idle_since(&self) -> Option<Instant> {
        if self.routes.busy() {
            return None;
        }
        self.activity.idle_since()
    }

    /// Whether a server or a trial an Agent started here still listens.
    fn serving(&self) -> bool {
        self.process.serving()
    }
}

impl Connection {
    /// Lets go of `thread`'s session in this process, if it has one: the
    /// Thread runs on another account now, and this process does not know
    /// what was said there (ADR 0078, decision 4). Its sub-agents' lanes
    /// end with the session; Live stops those at work first (ADR 0103,
    /// decision 11).
    pub async fn forget_thread(self: &Arc<Self>, thread: ThreadId) {
        let open = self.sessions.lock().await.remove(&thread);
        if let Some((session, _pass)) = open {
            Session::new(self, session).close().await;
        }
    }

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

/// What the sessions hear and are asked: routed to their turns, and their
/// sub-agents' to their lanes; `activity` is the process's, which a
/// sub-agent holds from its announcement.
fn handlers(
    routes: Routes,
    learned: Learned,
    activity: Activity,
) -> Builder<Client, impl HandleDispatchFrom<Agent> + 'static> {
    let heard = routes.clone();
    let raw = routes.clone();
    let asked = routes;
    let filling = asked.clone();
    Client
        .builder()
        .on_receive_notification(
            async move |frame: SdkMessage, _cx: ConnectionTo<Agent>| {
                if let Some(said) = sdk::read(&frame.message) {
                    raw_frame(&raw, &frame.session_id, said);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_notification(
            async move |note: acp::SessionNotification, _cx: ConnectionTo<Agent>| {
                let session = note.session_id;
                match note.update {
                    acp::SessionUpdate::SubagentUpdate(update) => {
                        announced(&heard, &activity, &session, update);
                    }
                    acp::SessionUpdate::SessionMessage(message) => sent(&heard, &session, message),
                    acp::SessionUpdate::SessionMessageChunk(chunk) => {
                        let id = chunk.message_id.0.to_string();
                        let more = text_of_blocks([&chunk.content]);
                        let now = heard.message(&session, &id, |kept| {
                            kept.text.push_str(&more);
                            kept.clone()
                        });
                        if let Some(now) = now {
                            told(&heard, &session, &id, now);
                        }
                    }
                    update => match heard.child(&session) {
                        Some(_) => in_lane(&heard, &session, update),
                        None => in_thread(&heard, &learned, &session, update),
                    },
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
                    start: crew_start(fields).map(Box::new),
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
                    start: None,
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

/// What a Thread's own session says: to its turn, or to whoever hears it
/// between turns.
fn in_thread(
    routes: &Routes,
    learned: &Learned,
    session: &acp::SessionId,
    heard: acp::SessionUpdate,
) {
    let said = match heard {
        acp::SessionUpdate::ConfigOptionUpdate(now) => {
            let known = learn(learned, session, now.config_options);
            Some(Said::Runs(running(&known)))
        }
        acp::SessionUpdate::AvailableCommandsUpdate(now) => {
            Some(Said::Runs(update(learned, session, |known| {
                known.said = Some(now.available_commands);
                known.read_commands();
                running(known)
            })))
        }
        now => said_in(routes, session, now),
    };
    // What it has used may come between turns: the next turn
    // writes what it last said.
    if let Some(Said::Used { usage, .. }) = &said {
        update(learned, session, |known| {
            known.usage = Some(usage.clone());
        });
    }
    if let Some(said) = said
        && let Some(route) = routes.of(session)
    {
        route.send(said);
    }
}

/// What a sub-agent says on its own session `session`: to its lane. Its
/// options say its model and role, never the Thread's, and its commands
/// and what it used are not its Thread's (ADR 0103, decision 7).
fn in_lane(routes: &Routes, session: &acp::SessionId, update: acp::SessionUpdate) {
    let Some(lane) = routes.lane_of(session) else {
        return;
    };
    let child = session.0.to_string();
    let said = match update {
        acp::SessionUpdate::ConfigOptionUpdate(now) => {
            let (model, role) = lane_runs(&now.config_options);
            LaneSaid::Runs { child, model, role }
        }
        acp::SessionUpdate::UsageUpdate(_) => return,
        now => match said_in(routes, session, now) {
            Some(said) => LaneSaid::Said { child, said },
            None => return,
        },
    };
    let _ = lane.send(said);
}

/// A sub-agent announced on `on`, or changed: a child Banda knows goes on
/// in its lane; a new one is mapped only from a session Banda listens to,
/// and its start goes where it came, after what came before it, so the
/// entry that shows it is written there (ADR 0103, decision 7). One nobody
/// listens to, as a load's replay, is heard by nobody. A new one holds the
/// process of `activity` from now, before its turn can end, until its
/// lane holds it (decision 11).
fn announced(
    routes: &Routes,
    activity: &Activity,
    on: &acp::SessionId,
    update: acp::SubagentUpdate,
) {
    let session = update.session_id;
    if let Some(cancel) = routes.patch_cancel(&session, &update.capabilities) {
        let Some(lane) = routes.lane_of(&session) else {
            return;
        };
        let _ = lane.send(LaneSaid::Changed {
            child: session.0.to_string(),
            title: update.title.into(),
            role: update.description.into(),
            cancel: (!update.capabilities.is_undefined()).then_some(cancel),
            state: lane_state(update.state),
        });
        return;
    }
    let Some(root) = routes.announce(on) else {
        return;
    };
    let Some(lane) = routes.lane(&root) else {
        return;
    };
    let cancel = cancel_of(false, &update.capabilities);
    let announced = Announced {
        child: session.0.to_string(),
        title: update.title.take(),
        role: update.description.take(),
        cancel,
        state: lane_state(update.state),
    };
    let child = Child {
        root: root.clone(),
        cancel,
        brief: None,
    };
    routes.adopt(session, child);
    let (started, heard) = oneshot::channel();
    let start = Said::Subagent {
        announced: announced.clone(),
        started,
    };
    // Where its parent speaks: the Thread's own turn, or what hears it
    // between turns, which opens one; or its parent's lane, which writes
    // where it shows.
    if let Some(route) = routes.of(on) {
        route.send(start);
    }
    let parent = (*on != root).then(|| on.0.to_string());
    let _ = lane.send(LaneSaid::Seen {
        announced,
        parent,
        started: heard,
        held: activity.hold(),
    });
}

/// A message between sessions, or a change of it, that came on `on`.
fn sent(routes: &Routes, on: &acp::SessionId, message: acp::SessionMessage) {
    let id = message.message_id.0.to_string();
    let kept = routes.message(on, &id, |kept| {
        message.sender_session_id.update_to(&mut kept.sender);
        message.recipient_session_id.update_to(&mut kept.recipient);
        match message.content {
            MaybeUndefined::Undefined => {}
            MaybeUndefined::Null => kept.text.clear(),
            MaybeUndefined::Value(blocks) => kept.text = text_of_blocks(&blocks),
        }
        kept.clone()
    });
    if let Some(kept) = kept {
        told(routes, on, &id, kept);
    }
}

/// What a message between sessions, `id` on `on`, tells a lane: a
/// child's report to its parent, `<call>:reply`, which comes on its
/// parent's session; or the brief its parent sent a child, on the parent's
/// own view of it. The child's own view of its brief tells nothing more.
fn told(routes: &Routes, on: &acp::SessionId, id: &str, message: Message) {
    let Message {
        sender,
        recipient,
        text,
    } = message;
    if text.is_empty() {
        return;
    }
    if id.ends_with(":reply") {
        if let Some(from) = sender
            && let Some(text) = report(&text)
            && let Some(lane) = routes.lane_of(&from)
        {
            let child = from.0.to_string();
            let _ = lane.send(LaneSaid::Report { child, text });
        }
        return;
    }
    if sender.as_ref() != Some(on) {
        return;
    }
    let Some(to) = recipient.filter(|to| to != on) else {
        return;
    };
    let Some(lane) = routes.lane_of(&to) else {
        return;
    };
    let (child, message) = (to.0.to_string(), id.to_owned());
    if routes.briefs(&to, id) {
        let tie = routes.tie(on, id);
        let _ = lane.send(LaneSaid::Brief {
            child,
            message,
            text,
            tie,
        });
        return;
    }
    // A message after its brief, as Claude's SendMessage to one it
    // resumes: where its parent speaks, and in its own lane (ADR 0103,
    // decision 25).
    let messaged = || Said::Messaged {
        child: child.clone(),
        message: message.clone(),
        text: Some(text.clone()),
    };
    if let Some(parent) = routes.of(on) {
        parent.send(messaged());
    }
    let said = messaged();
    let _ = lane.send(LaneSaid::Said { child, said });
}

/// What a session says, as the module hears it: a call that queued a
/// message for a sub-agent of the same Thread, which Claude Code sends
/// with no words to one at work, shows that it went to it (ADR 0103,
/// decision 25); the rest as [`said`] has it.
fn said_in(routes: &Routes, session: &acp::SessionId, update: acp::SessionUpdate) -> Option<Said> {
    if let acp::SessionUpdate::ToolCall(call) = &update
        && let Some(child) = queued_for(call)
        && let Some(to) = routes.child(&acp::SessionId::new(child.as_str()))
        && routes.announce(session) == Some(to.root)
    {
        return Some(Said::Messaged {
            child,
            message: call.tool_call_id.0.to_string(),
            text: None,
        });
    }
    said(update)
}

/// The Crew a permission request asks to start: Claude's Workflow call,
/// whose input carries its script (ADR 0103, decision 30).
fn crew_start(fields: &acp::ToolCallUpdateFields) -> Option<CrewStart> {
    let script = fields.raw_input.as_ref()?.get("script")?.as_str()?;
    script::start(script)
}

/// A raw frame Claude sent on `session`, a Thread's (ADR 0103, decision 9):
/// what goes on in the background holds its process; a sub-agent's task
/// ties to its lane by the tool use that launched it; and all of it goes
/// to whoever hears the session's Crews.
fn raw_frame(routes: &Routes, session: &acp::SessionId, said: Sdk) {
    match &said {
        Sdk::Background(tasks) => routes.set_background(session, tasks.clone()),
        Sdk::Started(started) if started.kind == TaskKind::Agent => {
            if let Some(launch) = &started.tool_use {
                let tie = Tie {
                    launch: launch.clone(),
                    background: started.background,
                    task: started.parent.clone(),
                };
                // Its brief came first: its lane hears the tie now.
                if let Some(child) = routes.briefed(session, launch)
                    && let Some(lane) = routes.lane_of(&child)
                {
                    let child = child.0.to_string();
                    let _ = lane.send(LaneSaid::Tied {
                        child,
                        tie: tie.clone(),
                    });
                }
                routes.keep_tie(session, tie);
            }
        }
        _ => {}
    }
    if let Some(crews) = routes.crews_of(session) {
        let _ = crews.send(CrewSaid::Raw(said));
    }
}

/// What the engine declares it can show, sub-agents among it (ADR 0103,
/// decision 7).
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
        .subagents(acp::SubagentCapabilities::new())
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
