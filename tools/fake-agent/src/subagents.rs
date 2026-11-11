//! `sub-agents`: the Agent starts a sub-agent that reads `a.txt`, as Claude
//! Code's Agent tool does, in the shape its adapter gives the client
//! (`docs/research/2026-11-10-sub-agents/recordings.md`):
//!
//! - To a client that shows sub-agents (`clientCapabilities.subagents`),
//!   each has a session of its own (Part B). Its parent announces it with
//!   `subagent_update`, its role and title as mock 01 has them, and sends
//!   it its brief as a `session_message`, seen from both sessions. On its
//!   own session it says its agent, then its model, reads, replies and
//!   says what it used. It goes idle on its parent's, and its report
//!   comes there as a `session_message` `<launch>:reply`, Claude Code's
//!   tools tag first. Then the parent replies.
//! - To any other, Claude Code's old shape (Part A): a `think` call
//!   titled with the task, the sub-agent's own calls on the parent's
//!   session, stamped `_meta.claudeCode.parentToolUseId` with that call,
//!   then the call done with the report, and the parent's reply.
//!
//! Each word after `sub-agents` changes that, and they combine. All but
//! `three`, `codex` and `load` act on the last sub-agent started. Without the
//! client showing sub-agents, `outlive`, `later`, `again`, `queued`,
//! `codex`, `unnamed`, `unknown`, `refuses`, `load`, `background`,
//! `reworded` and `early` change nothing, and the rest come on the
//! parent's session: `asks` asks as the parent itself does, as Claude
//! Code's adapter asks today.
//!
//! - `three`: three at once, an Explore, a general-purpose and a
//!   Reviewer, which end in the order 3, 1, 2.
//! - `asks`: it waits on the Person (`requires_action`) and asks on its
//!   own session to run `pnpm vitest`: allowed, its call ends done, else
//!   failed. Then it works again, unless its session was cancelled
//!   meanwhile: then it goes idle cancelled.
//! - `form`: it asks a colour with a form on its own session.
//! - `fails`: it goes idle with an error, and sends no report.
//! - `nested`: it announces a sub-agent of its own, on its own session,
//!   which works and reports there.
//! - `outlive`: the parent answers its prompt while it still works; it
//!   works on two seconds after the answer, or as many milliseconds as
//!   `FAKE_AGENT_OUTLIVES_BY` says, and ends.
//! - `later`: the parent starts it only as long after its answer as
//!   `outlive` works on, by itself, as Claude Code goes on with what a
//!   background task found; it works and ends then.
//! - `again`: once it is idle, the parent resumes it and sends it more,
//!   "Read it once more.", as Claude Code's SendMessage does
//!   (`claude-message.jsonl`, lines 127–129): it says it runs again, then
//!   the message under an ID of its own; it replies and goes idle, with no
//!   report. As Codex, it is announced again, with no message.
//! - `queued`: while it works, the parent's SendMessage to it is queued,
//!   as Claude Code's is for a sub-agent at work (`claude-message.jsonl`,
//!   line 48): a call with no input, done as it comes, whose result names
//!   it. Its words never come.
//! - `slow`: its command works until its own session is cancelled, or the
//!   parent's. It goes idle cancelled, and only then does its call fail.
//! - `codex`: as Codex says sub-agents: each session is
//!   `<parent>:subagent:<n>`, announced with its title and no state, then
//!   running twice, then able to stop; no `session_message`, a `wait`
//!   call of the parent's while they work, no stop once idle, and the
//!   report is its last reply.
//! - `unnamed`: with `codex`, it is announced with Codex's own title for
//!   one its parent gave no name, "Agent", as Codex V1 names them.
//! - `unknown`: its state is unknown for a while, then running again.
//! - `refuses`: it can never be stopped on its own (`capabilities: {}`).
//! - `load`: with `FAKE_AGENT_SESSIONS` naming a folder, the session keeps
//!   there the sub-agents it announced, as a real Harness keeps its
//!   sessions, and a `session/load` of it replays each, as it last stood,
//!   and what it said, before it answers. A client loads a session it
//!   cannot resume: `FAKE_AGENT_NO_RESUME`.
//! - `late`: its read ends after it went idle.
//! - `background`: as one in the background: its only `:reply` is the
//!   receipt, "Async agent launched…", sent at once, and it goes idle with
//!   none after its last reply. The parent says it started, and replies
//!   once it is done.
//! - `reworded`: its report says its answer in more words than its last
//!   reply did.
//! - `early`: that report comes before it goes idle, not after.
//! - `edit`: it edits `src/util.ts` in the session's folder and shows the
//!   change, as `walk` does.
//! - `dies`: the fake agent's process ends while it works.

use super::{After, Fake, allowed, choose, say, select, text, util_edit};
use agent_client_protocol::schema::v1::{
    ConfigOptionUpdate, ContentBlock, ErrorStopReason, IdleStateUpdate, IdleStopReason, MessageId,
    Meta, PermissionOption, PermissionOptionKind, RequestPermissionRequest,
    RequiresActionStateUpdate, RunningStateUpdate, SessionCancelCapabilities, SessionConfigOption,
    SessionConfigOptionCategory, SessionId, SessionMessage, SessionUpdate, StateUpdate, StopReason,
    SubagentSessionCapabilities, SubagentUpdate, TextContent, ToolCall, ToolCallContent,
    ToolCallLocation, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UnknownStateUpdate, UsageUpdate,
};
use agent_client_protocol::{Client, ConnectionTo, Error};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

/// What a parent asks of a sub-agent as it starts it: its role, its
/// task, its prompt, the file it reads and what it answers.
struct Brief {
    role: &'static str,
    title: &'static str,
    prompt: &'static str,
    reads: &'static str,
    answer: &'static str,
}

/// Mock 01's three. One alone is the second, which reads `a.txt`.
const THREE: [Brief; 3] = [
    Brief {
        role: "Explore",
        title: "Map where [row] keys are read",
        prompt: "Find where the [row] keys of sidebar.toml are read.",
        reads: "src/rows.ts",
        answer: "src/rows.ts reads them.",
    },
    Brief {
        role: "general-purpose",
        title: "Read a.txt one line",
        prompt: "Read a.txt and answer with its first line only.",
        reads: "a.txt",
        answer: "alpha",
    },
    Brief {
        role: "Reviewer",
        title: "Review the sidebar.toml schema",
        prompt: "Review the schema of sidebar.toml and say what is wrong.",
        reads: "sidebar.toml",
        answer: "The schema holds.",
    },
];

/// What `again` tells a sub-agent once it is done.
const AGAIN: &str = "Read it once more.";

/// The sub-agent a `nested` one starts.
const NESTED: Brief = Brief {
    role: "Explore",
    title: "Find b.txt",
    prompt: "Read b.txt and answer with its first line only.",
    reads: "b.txt",
    answer: "bravo",
};

/// The words that change nothing for a client that does not show
/// sub-agents: what they change, Claude Code's old shape has no frame of.
const APART_ONLY: [&str; 12] = [
    "outlive",
    "later",
    "again",
    "queued",
    "codex",
    "unnamed",
    "unknown",
    "refuses",
    "load",
    "background",
    "reworded",
    "early",
];

/// A sub-agent at work.
#[derive(Clone)]
struct Sub {
    brief: &'static Brief,
    /// The session that announced it: its parent's.
    parent: SessionId,
    /// Its own session, where the client shows sub-agents.
    session: SessionId,
    /// The Agent call that started it, which stamps what it does and
    /// names the messages between it and its parent.
    launch: String,
    /// What makes the IDs of its calls its own.
    n: u64,
    /// The one the words after `sub-agents` act on.
    acted: bool,
}

/// How a sub-agent's work ended.
#[derive(Clone, Serialize, Deserialize)]
enum Ended {
    /// With what it answered.
    Done(String),
    /// With what went wrong.
    Failed(String),
    Stopped,
}

/// The turn that starts sub-agents: their parent's.
#[derive(Clone)]
struct Parent {
    fake: Fake,
    cx: ConnectionTo<Client>,
    /// The turn's own session.
    session: SessionId,
    folder: PathBuf,
    /// The client shows sub-agents: each has a session of its own.
    apart: bool,
    /// As Codex says them, else as Claude Code does.
    codex: bool,
    /// The words after `sub-agents`.
    asked: Vec<String>,
}

/// Starts sub-agents as the words after `sub-agents` say (see the top),
/// and puts in `then` what goes on after the answer.
pub(super) async fn turn(
    fake: &Fake,
    cx: &ConnectionTo<Client>,
    session: &SessionId,
    words: &str,
    then: &mut Option<After>,
) -> Result<StopReason, Error> {
    let asked: Vec<String> = (words.split_whitespace())
        .skip_while(|word| *word != "sub-agents")
        .skip(1)
        .map(str::to_owned)
        .collect();
    let apart = fake.subagents.load(Ordering::Relaxed);
    let parent = Parent {
        fake: fake.clone(),
        cx: cx.clone(),
        session: session.clone(),
        folder: fake.setup(session).folder,
        apart,
        codex: apart && asked.iter().any(|word| word == "codex"),
        asked,
    };
    let (briefs, order): (&[Brief], &[usize]) = match parent.asks_for("three") {
        true => (&THREE, &[2, 0, 1]),
        false => (&THREE[1..2], &[0]),
    };
    let subs: Vec<Sub> = (briefs.iter().enumerate())
        .map(|(at, brief)| parent.sub(brief, &parent.session, at + 1 == briefs.len()))
        .collect();
    // What the Agent goes on with by itself after its answer.
    let after = |sub: &Sub| parent.on(sub, "outlive") || parent.on(sub, "later");
    for sub in subs.iter().filter(|sub| !parent.on(sub, "later")) {
        parent.start(sub)?;
    }
    let wait = format!("wait-{}", subs[0].n);
    if parent.codex {
        parent.wait(&wait, false)?;
    }
    let background = subs.iter().find(|sub| parent.on(sub, "background"));
    if let Some(sub) = background {
        // Codex sends no message between sessions.
        if !parent.codex {
            let receipt = format!(
                "Async agent launched successfully.\nagentId: {} (internal ID - do not mention to user.)",
                sub.session.0
            );
            parent.report(sub, &sub.launch, &receipt)?;
        }
        let started = format!("started-{}", sub.n);
        parent.says_itself("Started it in the background.", Some(started))?;
    }
    let mut said = Vec::new();
    for &at in order {
        let sub = &subs[at];
        if parent.on(sub, "later") {
            said.push(format!("{} starts later", sub.brief.role));
            continue;
        }
        if parent.on(sub, "outlive") {
            said.push(format!("{} is still at work", sub.brief.role));
            continue;
        }
        let ended = parent.work(sub).await?;
        parent.end(sub, &ended)?;
        if parent.fake.cancelled(&parent.session) {
            return Ok(StopReason::Cancelled);
        }
        said.push(match ended {
            Ended::Done(answer) => answer,
            Ended::Failed(_) => format!("{} failed", sub.brief.role),
            Ended::Stopped => format!("{} stopped", sub.brief.role),
        });
    }
    if parent.codex {
        parent.wait(&wait, true)?;
    }
    let reply = format!("The sub-agents said: {}.", said.join("; "));
    parent.says_itself(&reply, background.map(|sub| format!("reply-{}", sub.n)))?;
    if let Some(sub) = subs.iter().find(|sub| after(sub)).cloned() {
        let parent = parent.clone();
        *then = Some(Box::pin(async move {
            tokio::time::sleep(outlives_by()).await;
            if parent.on(&sub, "later") && parent.start(&sub).is_err() {
                return;
            }
            if let Ok(ended) = parent.work(&sub).await {
                let _ = parent.end(&sub, &ended);
            }
        }));
    }
    Ok(StopReason::EndTurn)
}

impl Parent {
    /// A sub-agent `brief` starts for `parent`, with IDs of its own.
    fn sub(&self, brief: &'static Brief, parent: &SessionId, acted: bool) -> Sub {
        let n = self.fake.sessions.fetch_add(1, Ordering::Relaxed) + 1;
        let session = match self.codex {
            true => format!("{}:subagent:{n}", parent.0),
            false => format!("child-{}-{n}", std::process::id()),
        };
        Sub {
            brief,
            parent: parent.clone(),
            session: SessionId::new(session),
            launch: format!("toolu-{n}"),
            n,
            acted,
        }
    }

    /// Whether `word` follows `sub-agents`, and changes anything for this
    /// client.
    fn asks_for(&self, word: &str) -> bool {
        (self.apart || !APART_ONLY.contains(&word)) && self.asked.iter().any(|asked| asked == word)
    }

    /// Whether `word` follows `sub-agents` and acts on `sub`.
    fn on(&self, sub: &Sub, word: &str) -> bool {
        sub.acted && self.asks_for(word)
    }

    /// Where what `sub` does comes: its own session, or its parent's turn.
    fn its<'a>(&'a self, sub: &'a Sub) -> &'a SessionId {
        match self.apart {
            true => &sub.session,
            false => &self.session,
        }
    }

    /// The `_meta` Claude Code stamps on what `sub` does with `tool`: the
    /// call that started it.
    fn stamp(&self, sub: &Sub, tool: &str) -> Option<Meta> {
        claude(json!({ "toolName": tool, "parentToolUseId": sub.launch })).filter(|_| !self.codex)
    }

    /// What it may do to `sub` on its own: stop it, unless `refuses`.
    fn can(&self, sub: &Sub) -> SubagentSessionCapabilities {
        let can = SubagentSessionCapabilities::new();
        match self.on(sub, "refuses") {
            true => can,
            false => can.cancel(SessionCancelCapabilities::new()),
        }
    }

    fn says(&self, session: &SessionId, update: SessionUpdate) -> Result<(), Error> {
        say(&self.cx, session, update)
    }

    /// `sub`'s parent says `update` of it.
    fn of(&self, sub: &Sub, update: SubagentUpdate) -> Result<(), Error> {
        self.says(&sub.parent, SessionUpdate::SubagentUpdate(update))
    }

    fn state(&self, sub: &Sub, state: StateUpdate) -> Result<(), Error> {
        self.of(sub, SubagentUpdate::new(sub.session.clone()).state(state))
    }

    fn idle(&self, sub: &Sub, why: IdleStopReason) -> Result<(), Error> {
        let idle = IdleStateUpdate::new().stop_reason(why);
        self.state(sub, StateUpdate::Idle(idle))
    }

    /// The parent replies `words`, as a message `id` of its own when the
    /// turn has more than one.
    fn says_itself(&self, words: &str, id: Option<String>) -> Result<(), Error> {
        let reply = text(words).message_id(id.map(MessageId::new));
        self.says(&self.session, SessionUpdate::AgentMessageChunk(reply))
    }

    /// Starts `sub`: announced, with its prompt, or as an Agent call of its
    /// parent's turn.
    fn start(&self, sub: &Sub) -> Result<(), Error> {
        if !self.apart {
            return self.launch(sub, None);
        }
        self.announce(sub, &sub.launch, sub.brief.prompt)?;
        if !self.codex {
            self.says(&sub.session, self.options(sub, false))?;
        }
        self.save(sub, None);
        Ok(())
    }

    /// Its parent announces `sub` and sends it `prompt` as `message`; as
    /// Codex, its options instead, and no message.
    fn announce(&self, sub: &Sub, message: &str, prompt: &str) -> Result<(), Error> {
        let title = sub.brief.title;
        if self.codex {
            let named = match self.on(sub, "unnamed") {
                true => "Agent",
                false => title,
            };
            let first = SubagentUpdate::new(sub.session.clone())
                .title(named)
                .capabilities(SubagentSessionCapabilities::new());
            self.of(sub, first)?;
            self.says(&sub.session, self.options(sub, false))?;
            for _ in 0..2 {
                self.state(sub, StateUpdate::Running(RunningStateUpdate::new()))?;
            }
            if self.on(sub, "refuses") {
                return Ok(());
            }
            let can = SubagentUpdate::new(sub.session.clone()).capabilities(self.can(sub));
            return self.of(sub, can);
        }
        let announced = SubagentUpdate::new(sub.session.clone())
            .title(title)
            .description(sub.brief.role)
            .capabilities(self.can(sub))
            .state(StateUpdate::Running(RunningStateUpdate::new()));
        self.of(sub, announced)?;
        self.message(sub, message, prompt)
    }

    /// `sub`'s parent sends it `words` as `message`, seen from both
    /// sessions.
    fn message(&self, sub: &Sub, message: &str, words: &str) -> Result<(), Error> {
        let sent = SessionMessage::new(MessageId::new(message))
            .sender_session_id(sub.parent.clone())
            .recipient_session_id(sub.session.clone())
            .content(vec![ContentBlock::Text(TextContent::new(words))]);
        let out = sent.clone().recipient_message_id(MessageId::new(message));
        self.says(&sub.parent, SessionUpdate::SessionMessage(out))?;
        let came = sent.sender_message_id(MessageId::new(message));
        self.says(&sub.session, SessionUpdate::SessionMessage(came))
    }

    /// `sub`'s options as its session says them, as it starts or `later`:
    /// Claude Code's agent, with its model once it works; Codex's model
    /// and effort, then its model as it ends.
    fn options(&self, sub: &Sub, later: bool) -> SessionUpdate {
        let one = |id: &str, name: &str, value: &str, shown: &str| {
            SessionConfigOption::select(
                id.to_owned(),
                name,
                value.to_owned(),
                select(&[(value, shown)]),
            )
        };
        let model = |value, shown| {
            one("model", "Model", value, shown).category(SessionConfigOptionCategory::Model)
        };
        let role = sub.brief.role;
        let agent = || one("agent", "Agent", role, role).description("Subagent type");
        let options = match (self.codex, later) {
            (true, false) => vec![
                model("luna", "6 Luna"),
                one("reasoning_effort", "Reasoning effort", "low", "Low")
                    .category(SessionConfigOptionCategory::ThoughtLevel),
            ],
            (true, true) => vec![model("luna", "6 Luna")],
            (false, false) => vec![agent()],
            (false, true) => vec![model("haiku", "Haiku 5.5"), agent()],
        };
        SessionUpdate::ConfigOptionUpdate(ConfigOptionUpdate::new(options))
    }

    /// Claude Code's Agent call for `sub` in its parent's turn, as it comes
    /// to a client that does not show sub-agents: "Task", then titled with
    /// the task and carrying the prompt. A nested one comes whole, stamped
    /// with the call of the sub-agent `inside` which it started.
    fn launch(&self, sub: &Sub, inside: Option<&Sub>) -> Result<(), Error> {
        let brief = sub.brief;
        let input = json!({
            "description": brief.title,
            "prompt": brief.prompt,
            "subagent_type": brief.role,
            "run_in_background": false,
        });
        let prompt = || vec![ToolCallContent::from(brief.prompt.to_owned())];
        if let Some(by) = inside {
            let call = ToolCall::new(sub.launch.clone(), brief.title)
                .kind(ToolKind::Think)
                .status(ToolCallStatus::Pending)
                .raw_input(input)
                .content(prompt())
                .meta(self.stamp(by, "Agent"));
            return self.says(&self.session, SessionUpdate::ToolCall(call));
        }
        let call = ToolCall::new(sub.launch.clone(), "Task")
            .kind(ToolKind::Think)
            .status(ToolCallStatus::Pending)
            .raw_input(json!({}))
            .meta(agent_call());
        self.says(&self.session, SessionUpdate::ToolCall(call))?;
        let fields = ToolCallUpdateFields::new()
            .title(brief.title)
            .raw_input(input)
            .content(prompt());
        let titled = ToolCallUpdate::new(sub.launch.clone(), fields).meta(agent_call());
        self.says(&self.session, SessionUpdate::ToolCallUpdate(titled))
    }

    /// The Agent call that started `sub` ends as `ended` says: done with
    /// its report, Claude Code's tools tag in a block of its own first,
    /// but none from one that started a sub-agent of its own
    /// (`apps/agents/engine/tests/recordings/claude-subagents.jsonl:95`).
    fn launched(&self, sub: &Sub, ended: &Ended) -> Result<(), Error> {
        let block = |words: String| ToolCallContent::from(words);
        let fields = ToolCallUpdateFields::new();
        let fields = match ended {
            Ended::Done(answer) if self.on(sub, "nested") => fields
                .status(ToolCallStatus::Completed)
                .content(vec![block(answer.clone())]),
            Ended::Done(answer) => fields.status(ToolCallStatus::Completed).content(vec![
                block(tag(&self.tools(sub), "\n")),
                block(answer.clone()),
            ]),
            Ended::Failed(failure) => fields
                .status(ToolCallStatus::Failed)
                .content(vec![block(failure.clone())]),
            Ended::Stopped => fields.status(ToolCallStatus::Failed),
        };
        let ended = ToolCallUpdate::new(sub.launch.clone(), fields).meta(agent_call());
        self.says(&self.session, SessionUpdate::ToolCallUpdate(ended))
    }

    /// The parent's `wait` call, as Codex waits for its sub-agents:
    /// started, or `done`.
    fn wait(&self, id: &str, done: bool) -> Result<(), Error> {
        let (status, said) = match done {
            true => (ToolCallStatus::Completed, "completed"),
            false => (ToolCallStatus::InProgress, "inProgress"),
        };
        let input = json!({
            "prompt": null,
            "senderThreadId": self.session.0,
            "receiverThreadIds": [],
            "agentsStates": {},
            "status": said,
        });
        let update = match done {
            true => {
                let fields = ToolCallUpdateFields::new().status(status).raw_input(input);
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(id.to_owned(), fields))
            }
            false => SessionUpdate::ToolCall(
                ToolCall::new(id.to_owned(), "wait")
                    .kind(ToolKind::Other)
                    .status(status)
                    .raw_input(input),
            ),
        };
        self.says(&self.session, update)
    }

    /// `sub` starts to work: Claude Code says its model, its state may
    /// be unknown (`unknown`), and it reads its file.
    fn begin(&self, sub: &Sub) -> Result<(), Error> {
        if self.apart && !self.codex {
            self.says(&sub.session, self.options(sub, true))?;
        }
        if self.on(sub, "unknown") {
            self.state(sub, StateUpdate::Unknown(UnknownStateUpdate::new()))?;
        }
        self.read(sub)
    }

    /// `sub` reads its file, and the read ends unless `late`.
    fn read(&self, sub: &Sub) -> Result<(), Error> {
        let path = self.folder.join(sub.brief.reads);
        let title = match self.codex {
            true => format!("Read file '{}'", path.display()),
            false => format!("Read {}", sub.brief.reads),
        };
        let call = ToolCall::new(format!("{}-read", sub.launch), title)
            .kind(ToolKind::Read)
            .status(ToolCallStatus::Pending)
            .locations(vec![ToolCallLocation::new(path).line(1)])
            .meta(self.stamp(sub, "Read"));
        self.says(self.its(sub), SessionUpdate::ToolCall(call))?;
        match self.on(sub, "late") {
            true => Ok(()),
            false => self.read_ends(sub),
        }
    }

    fn read_ends(&self, sub: &Sub) -> Result<(), Error> {
        let printed = format!("```\n1\t{}\n```", sub.brief.answer);
        let fields = (ToolCallUpdateFields::new())
            .status(ToolCallStatus::Completed)
            .content(vec![printed.into()]);
        let id = format!("{}-read", sub.launch);
        let ended = ToolCallUpdate::new(id, fields).meta(self.stamp(sub, "Read"));
        self.says(self.its(sub), SessionUpdate::ToolCallUpdate(ended))
    }

    /// `sub` replies `words` on its own session, as `message`, then says
    /// what it used.
    fn replies(&self, sub: &Sub, words: &str, message: String) -> Result<(), Error> {
        let launch = claude(json!({ "parentToolUseId": sub.launch }));
        let reply = text(words)
            .message_id(MessageId::new(message))
            .meta(launch.filter(|_| !self.codex));
        self.says(&sub.session, SessionUpdate::AgentMessageChunk(reply))?;
        let used = UsageUpdate::new(12_000, 200_000);
        self.says(&sub.session, SessionUpdate::UsageUpdate(used))
    }

    /// `sub`'s report to its parent of `message`, as Claude Code sends it:
    /// a `session_message` `<message>:reply` from `sub`.
    fn report(&self, sub: &Sub, message: &str, words: &str) -> Result<(), Error> {
        let report = SessionMessage::new(MessageId::new(format!("{message}:reply")))
            .sender_session_id(sub.session.clone())
            .recipient_session_id(sub.parent.clone())
            .content(vec![ContentBlock::Text(TextContent::new(words))]);
        self.says(&sub.parent, SessionUpdate::SessionMessage(report))
    }

    /// What `sub` does, from its model on, as the words say; how it ended.
    async fn work(&self, sub: &Sub) -> Result<Ended, Error> {
        self.begin(sub)?;
        if self.on(sub, "queued") {
            self.queued(sub)?;
        }
        if self.on(sub, "edit") {
            self.edit(sub)?;
        }
        if self.on(sub, "asks") {
            self.asks(sub).await?;
            // Stopped while it asked, as Banda stops it when its Thread
            // moves.
            if self.apart && self.fake.cancelled(&sub.session) {
                return Ok(Ended::Stopped);
            }
        }
        let mut answer = sub.brief.answer.to_owned();
        if self.on(sub, "form") {
            let chose = match self.fake.forms.load(Ordering::Relaxed) {
                true => choose(&self.cx, self.its(sub), false, false).await,
                false => Ok("I cannot ask you here.".to_owned()),
            };
            let chose = chose.unwrap_or_else(|_| "The question was cancelled.".to_owned());
            answer = format!("{chose} {answer}");
        }
        if self.on(sub, "nested") {
            self.nested(sub)?;
        }
        if self.on(sub, "dies") {
            // What it said gets out first.
            tokio::time::sleep(Duration::from_millis(200)).await;
            std::process::exit(3);
        }
        if self.on(sub, "slow") {
            self.slow(sub).await?;
            return Ok(Ended::Stopped);
        }
        if self.on(sub, "unknown") {
            self.state(sub, StateUpdate::Running(RunningStateUpdate::new()))?;
        }
        if self.on(sub, "fails") {
            let brief = sub.brief;
            return Ok(Ended::Failed(format!(
                "{} could not read {}.",
                brief.role, brief.reads
            )));
        }
        if self.apart {
            self.replies(sub, &answer, format!("msg-{}", sub.n))?;
        }
        Ok(Ended::Done(answer))
    }

    /// `sub` ends as `ended` says, as its Harness says it.
    fn end(&self, sub: &Sub, ended: &Ended) -> Result<(), Error> {
        if !self.apart {
            if let Ended::Stopped = ended {
                self.slow_fails(sub)?;
            }
            self.launched(sub, ended)?;
            if self.on(sub, "late") {
                self.read_ends(sub)?;
            }
            return Ok(());
        }
        match ended {
            Ended::Done(answer) => {
                if self.codex {
                    self.says(&sub.session, self.options(sub, true))?;
                }
                let reports = !self.codex && !self.on(sub, "background");
                let early = reports && self.on(sub, "early");
                let answer = match self.on(sub, "reworded") || early {
                    true => format!("{answer}, the first line of {}", sub.brief.reads),
                    false => answer.clone(),
                };
                let report = tag(&self.tools(sub), &format!("\n\n{answer}"));
                if early {
                    self.report(sub, &sub.launch, &report)?;
                }
                self.idle(sub, why(ended))?;
                if self.on(sub, "late") {
                    self.read_ends(sub)?;
                }
                if reports && !early {
                    self.report(sub, &sub.launch, &report)?;
                }
            }
            Ended::Failed(_) => self.idle(sub, why(ended))?,
            Ended::Stopped if self.codex => {
                if self.on(sub, "slow") {
                    self.slow_fails(sub)?;
                }
                self.idle(sub, why(ended))?;
            }
            Ended::Stopped => {
                // Claude Code says its call failed only after it is idle.
                self.idle(sub, why(ended))?;
                if self.on(sub, "slow") {
                    self.slow_fails(sub)?;
                }
            }
        }
        self.no_stop(sub)?;
        self.save(sub, Some(ended));
        if let (Ended::Done(_), true) = (ended, self.on(sub, "again")) {
            self.again(sub)?;
        }
        Ok(())
    }

    /// As Codex, once `sub` is idle it can no longer be stopped: Codex
    /// says `{cancel: null}`, which is `{}`.
    fn no_stop(&self, sub: &Sub) -> Result<(), Error> {
        if !self.codex {
            return Ok(());
        }
        let none = SubagentSessionCapabilities::new();
        let update = SubagentUpdate::new(sub.session.clone()).capabilities(none);
        self.of(sub, update)
    }

    /// The tools `sub` used, as Claude Code's tag names them.
    fn tools(&self, sub: &Sub) -> String {
        let used = [
            ("Read", true),
            ("Edit", self.on(sub, "edit")),
            ("Bash", self.on(sub, "asks") || self.on(sub, "slow")),
            ("Agent", self.on(sub, "nested")),
        ];
        let used: Vec<&str> = (used.iter())
            .filter(|(_, it)| *it)
            .map(|(tool, _)| *tool)
            .collect();
        used.join(", ")
    }

    /// `edit`: `sub` adds a line to `src/util.ts`, as `walk` does, and
    /// shows the change.
    fn edit(&self, sub: &Sub) -> Result<(), Error> {
        let id = format!("{}-edit", sub.launch);
        let call = util_edit(id, &self.folder, "export const four = 4", None)
            .meta(self.stamp(sub, "Edit"));
        self.says(self.its(sub), SessionUpdate::ToolCall(call))
    }

    /// `asks`: `sub` waits on the Person and asks on its own session to run
    /// `pnpm vitest`; in Claude Code's old shape, its parent asks.
    async fn asks(&self, sub: &Sub) -> Result<(), Error> {
        let id = format!("{}-vitest", sub.launch);
        let call = ToolCall::new(id.clone(), "pnpm vitest")
            .kind(ToolKind::Execute)
            .status(ToolCallStatus::Pending)
            .meta(self.stamp(sub, "Bash"));
        self.says(self.its(sub), SessionUpdate::ToolCall(call))?;
        if self.apart {
            let waits = RequiresActionStateUpdate::new();
            self.state(sub, StateUpdate::RequiresAction(waits))?;
        }
        let options = vec![
            PermissionOption::new("allow-once", "Yes", PermissionOptionKind::AllowOnce),
            PermissionOption::new(
                "allow-with-updates",
                "Yes, and allow pnpm vitest commands",
                PermissionOptionKind::AllowAlways,
            ),
            PermissionOption::new("reject", "No", PermissionOptionKind::RejectOnce),
        ];
        let fields = ToolCallUpdateFields::new()
            .title("pnpm vitest")
            .kind(ToolKind::Execute)
            .status(ToolCallStatus::Pending);
        let asked = ToolCallUpdate::new(id.clone(), fields).meta(self.stamp(sub, "Bash"));
        let question = RequestPermissionRequest::new(self.its(sub).clone(), asked, options);
        let allowed = allowed(&self.cx, question, &["allow-once", "allow-with-updates"]).await;
        if self.apart {
            self.state(sub, StateUpdate::Running(RunningStateUpdate::new()))?;
        }
        let status = match allowed {
            true => ToolCallStatus::Completed,
            false => ToolCallStatus::Failed,
        };
        let ran = ToolCallUpdate::new(id, ToolCallUpdateFields::new().status(status))
            .meta(self.stamp(sub, "Bash"));
        self.says(self.its(sub), SessionUpdate::ToolCallUpdate(ran))
    }

    /// `nested`: `sub` starts one of its own, which works and reports on
    /// `sub`'s session. In Claude Code's old shape only its Agent call
    /// comes, stamped with `sub`'s, done with its report: its work does
    /// not come at all.
    fn nested(&self, sub: &Sub) -> Result<(), Error> {
        let inner = self.sub(&NESTED, &sub.session, false);
        if self.apart {
            self.start(&inner)?;
            self.begin(&inner)?;
            self.replies(&inner, NESTED.answer, format!("msg-{}", inner.n))?;
            return self.end(&inner, &Ended::Done(NESTED.answer.to_owned()));
        }
        self.launch(&inner, Some(sub))?;
        let report = tag("Read", &format!("\n\n{}", NESTED.answer));
        let fields = (ToolCallUpdateFields::new())
            .status(ToolCallStatus::Completed)
            .content(vec![report.into()]);
        let ended =
            ToolCallUpdate::new(inner.launch.clone(), fields).meta(self.stamp(sub, "Agent"));
        self.says(&self.session, SessionUpdate::ToolCallUpdate(ended))
    }

    /// `slow`: `sub`'s command works until its own session is cancelled,
    /// or its parent's turn.
    async fn slow(&self, sub: &Sub) -> Result<(), Error> {
        let id = format!("{}-tail", sub.launch);
        let call = ToolCall::new(id, "timeout 60 tail -f /dev/null")
            .kind(ToolKind::Execute)
            .status(ToolCallStatus::InProgress)
            .meta(self.stamp(sub, "Bash"));
        self.says(self.its(sub), SessionUpdate::ToolCall(call))?;
        while !self.fake.cancelled(self.its(sub)) && !self.fake.cancelled(&self.session) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok(())
    }

    fn slow_fails(&self, sub: &Sub) -> Result<(), Error> {
        let fields = ToolCallUpdateFields::new().status(ToolCallStatus::Failed);
        let failed = ToolCallUpdate::new(format!("{}-tail", sub.launch), fields)
            .meta(self.stamp(sub, "Bash"));
        self.says(self.its(sub), SessionUpdate::ToolCallUpdate(failed))
    }

    /// `again`: once `sub` is idle, its parent resumes it and sends it
    /// more, as Claude Code's SendMessage does (`claude-message.jsonl`,
    /// lines 127–129): it says it runs again, and nothing more of it, then
    /// the message under an ID of its own, seen from both sessions. It
    /// replies and goes idle, and no report comes of it, as none did
    /// there. As Codex, it is announced again, with no message.
    fn again(&self, sub: &Sub) -> Result<(), Error> {
        let message = format!("{}-again", sub.launch);
        if self.codex {
            self.announce(sub, &message, AGAIN)?;
        } else {
            self.state(sub, StateUpdate::Running(RunningStateUpdate::new()))?;
            self.message(sub, &message, AGAIN)?;
        }
        self.replies(sub, sub.brief.answer, format!("msg-{}-again", sub.n))?;
        self.idle(sub, IdleStopReason::EndTurn)?;
        self.no_stop(sub)
    }

    /// `queued`: while `sub` works, its parent's SendMessage to it is
    /// queued, as Claude Code's is for a sub-agent at work
    /// (`claude-message.jsonl`, line 48): a call with no input, done as it
    /// comes, whose result names `sub`. Its words never come.
    fn queued(&self, sub: &Sub) -> Result<(), Error> {
        let id = &sub.session.0;
        let result = json!({
            "success": true,
            "message": format!(
                "Message queued for delivery to {id} at its next tool round. If it finishes first, it is resumed with the message and notifies again, so wait for that notification before resending."
            ),
            "pin": { "id": id, "name": id, "ref": format!("{:06x}", sub.n) },
        })
        .to_string();
        let call = ToolCall::new(format!("{}-queued", sub.launch), "SendMessage")
            .kind(ToolKind::Other)
            .status(ToolCallStatus::Completed)
            .raw_input(json!({}))
            .content(vec![result.clone().into()])
            .raw_output(json!([{ "type": "text", "text": result }]))
            .meta(claude(json!({ "toolName": "SendMessage" })));
        self.says(&sub.parent, SessionUpdate::ToolCall(call))
    }

    /// `load`: saves `sub` as its turn's session announced it, and how it
    /// `ended` once it has. A sub-agent of a sub-agent is not saved.
    fn save(&self, sub: &Sub, ended: Option<&Ended>) {
        if !self.asks_for("load") || sub.parent != self.session {
            return;
        }
        let Some(file) = file_of(&self.session) else {
            return;
        };
        let mut all = announced(&self.session);
        let now = Announced {
            session: sub.session.0.to_string(),
            title: sub.brief.title.to_owned(),
            role: (!self.codex).then(|| sub.brief.role.to_owned()),
            cancel: !self.on(sub, "refuses") && !(self.codex && ended.is_some()),
            ended: ended.cloned(),
        };
        // In the order they were announced.
        match all.iter_mut().find(|before| before.session == now.session) {
            Some(before) => *before = now,
            None => all.push(now),
        }
        if let Some(folder) = file.parent() {
            let _ = std::fs::create_dir_all(folder);
        }
        let _ = std::fs::write(file, serde_json::to_vec(&all).unwrap_or_default());
    }
}

/// How long after its parent's answer a sub-agent that outlives its turn
/// goes on: `FAKE_AGENT_OUTLIVES_BY` milliseconds, else two seconds, so
/// a test on a busy machine (a CI runner among eleven others) sees its
/// turn end while it works.
fn outlives_by() -> Duration {
    let set = std::env::var("FAKE_AGENT_OUTLIVES_BY").ok();
    Duration::from_millis(set.and_then(|ms| ms.parse().ok()).unwrap_or(2000))
}

/// The `_meta` Claude Code's adapter puts on what it says: `fields` under
/// `claudeCode`.
fn claude(fields: serde_json::Value) -> Option<Meta> {
    json!({ "claudeCode": fields }).as_object().cloned()
}

/// The `_meta` of Claude Code's Agent call.
fn agent_call() -> Option<Meta> {
    claude(json!({ "toolName": "Agent" }))
}

/// Claude Code's tag of the tools a sub-agent used, then `after`.
fn tag(tools: &str, after: &str) -> String {
    format!("<tools-used-before-summary>{tools}</tools-used-before-summary>{after}")
}

/// Why a sub-agent that `ended` went idle, as its Harness says it.
fn why(ended: &Ended) -> IdleStopReason {
    match ended {
        Ended::Done(_) => IdleStopReason::EndTurn,
        Ended::Failed(failure) => {
            let error = Error::new(-32603, failure.clone());
            ErrorStopReason::new().error(error).into()
        }
        Ended::Stopped => IdleStopReason::Cancelled,
    }
}

/// A sub-agent a session announced, as `load` saves it.
#[derive(Serialize, Deserialize)]
struct Announced {
    session: String,
    title: String,
    role: Option<String>,
    cancel: bool,
    /// How it ended, once it has.
    ended: Option<Ended>,
}

/// Where `load` saves the sub-agents `session` announced: in the folder
/// `FAKE_AGENT_SESSIONS` names, so that a load in another process finds
/// them. None without it, or for an ID that is no file's name.
fn file_of(session: &SessionId) -> Option<PathBuf> {
    let folder = PathBuf::from(std::env::var_os("FAKE_AGENT_SESSIONS")?);
    let id = &*session.0;
    let named = (id.chars()).all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    (named && !id.is_empty()).then(|| folder.join(format!("{id}.json")))
}

/// The sub-agents `session` announced, as `load` saved them.
fn announced(session: &SessionId) -> Vec<Announced> {
    let file = file_of(session).and_then(|file| std::fs::read(file).ok());
    (file.and_then(|file| serde_json::from_slice(&file).ok())).unwrap_or_default()
}

/// Forgets what `load` saved of `session`, as it closes.
pub(super) fn forget(session: &SessionId) {
    if let Some(file) = file_of(session) {
        let _ = std::fs::remove_file(file);
    }
}

/// Says again, as a load of `session` replays it, each sub-agent it
/// announced as it last stood, and what each said.
pub(super) fn replay(cx: &ConnectionTo<Client>, session: &SessionId) -> Result<(), Error> {
    for announced in announced(session) {
        let child = SessionId::new(announced.session);
        let can = SubagentSessionCapabilities::new();
        let can = match announced.cancel {
            true => can.cancel(SessionCancelCapabilities::new()),
            false => can,
        };
        let state = match &announced.ended {
            Some(ended) => StateUpdate::Idle(IdleStateUpdate::new().stop_reason(why(ended))),
            None => StateUpdate::Running(RunningStateUpdate::new()),
        };
        let mut update = SubagentUpdate::new(child.clone())
            .title(announced.title)
            .capabilities(can)
            .state(state);
        if let Some(role) = announced.role {
            update = update.description(role);
        }
        say(cx, session, SessionUpdate::SubagentUpdate(update))?;
        if let Some(Ended::Done(said)) = announced.ended {
            say(cx, &child, SessionUpdate::AgentMessageChunk(text(&said)))?;
        }
    }
    Ok(())
}
