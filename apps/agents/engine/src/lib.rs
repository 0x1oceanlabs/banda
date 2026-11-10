//! The agents module: a Person works with Agents in Threads. A Thread is
//! one session with a Harness in a Project, and the Agent at work in it is
//! its own, with no name or settings (ADR 0006).
//!
//! - The **Harness list** is a text file of the machine, the module
//!   `harnesses`'s (`banda-harnesses`), and `agents.toml` says how
//!   messages are sent ([`sending`]): the module's [`SETTINGS`]. A
//!   Project's hosts of a Harness are let go as the machine says its
//!   account changed.
//! - **Threads, turns and Questions** are this module's tables and facts
//!   ([`model`]). A message queues a turn, or goes into the turn that runs
//!   (steering); the outbox runs a Thread's turns one at a time, and
//!   Threads run side by side. A waiting message can be changed, taken
//!   back or sent now, and a stop or a restart holds the queue until a
//!   Person lets it go (ADR 0003, decision 8).
//! - **Harnesses** are reached through ACP, one process per Project and
//!   Harness entry (`hosts.rs`). ACP's words stop in `acp.rs` and `acp/`.
//! - **An Agent reaches Banda** through `banda mcp`, which every session
//!   gets with the Agent's pass ([`Pipe`]). Its tools are the methods
//!   marked `tool` below (ADR 0019). The `banda` it runs in its shell acts
//!   under a pass too (`live.rs`).
//!
//! Its methods, each with its right, params and answer, are the
//! `methods!` table below (ADR 0014).

mod acp;
mod aside;
mod between;
mod changes;
pub mod chosen_modes;
pub mod counts;
mod deleting;
mod doing;
mod drive;
mod effects;
mod full_access;
mod handoff;
mod images;
mod issues;
mod kept;
mod lanes;
mod laters;
mod live;
mod marks;
pub mod model;
mod notes;
mod notices;
mod old_agents;
mod questions;
mod retirements;
mod rules;
mod search;
pub mod sending;
mod skills;
mod store;
mod switching;
mod time_comes;
mod titles;
mod touching;
mod transcript;
mod visual_page;
mod visuals;
mod writer;

use acp::Connection;
use banda_harnesses::hosts::IDLE;
use banda_harnesses::{Harness, Harnesses};
use banda_kernel::{
    AgentId, Call, Effect, Error, Fence, Holes, Kind, Module, ModuleProject, Nothing, OnRestart,
    Outcome, Participant, Pass, Picture, Program, Refusal, Right, Settled, Tool, Tx, Working,
    pass_env,
};
use banda_look::OneFile as _;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use changes::{ChangesAsk, TurnChanges};
use doing::ThreadsDoing;
use full_access::Chosen;
use images::Images;
use issues::{AnswerIssue, DraftIssue};
use laters::{LaterAsk, SeeWokeAsk, WakeAsk};
use live::Live;
use marks::{ImportMarks, Imported, ReadAsk};
use model::{
    AccountUse, Body, Fact, Fit, Image, ImageId, Item, ItemId, Offer, Opener, Settings, SubagentId,
    SubagentView, ThreadId, ThreadList, ThreadSummary, ThreadView, TurnId, TurnState, VERSION,
    VisualId,
};
use notes::Notify;
use rules::Event;
use schemars::JsonSchema;
use search::{Found, SearchAsk};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::Display;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use touching::Touching;
use ts_rs::TS;
use visuals::{Inlined, Visuals};

/// The module's settings file in `~/.config/banda` (ADR 0016): how
/// messages are sent and what a new Thread starts with, which the look
/// resolves for the window. How a new Thread starts is the machine's, as
/// it runs there; what Enter does and the Flow, the Person means
/// everywhere; the rest, as how soon a Thread counts as seen, is the
/// device's (ADR 0101, decision 3).
pub const SETTINGS: [banda_look::SettingsFile; 1] = [FILE];

const FILE: banda_look::SettingsFile = banda_look::SettingsFile::of::<sending::AgentsSettings>()
    .class(
        banda_look::Class::Device,
        &[
            ("start", banda_look::Class::Machine),
            ("enter", banda_look::Class::Shared),
            ("flow", banda_look::Class::Shared),
        ],
    );

pub struct Agents {
    harnesses: Harnesses,
    /// The folder of its settings files, `~/.config/banda`; none in a
    /// test that gives none.
    config: Option<PathBuf>,
    /// The file that keeps the modes the Person chose for each Harness's
    /// new Threads in Settings ([`chosen_modes`]); none in a test that
    /// gives none, where none was chosen.
    modes: Option<PathBuf>,
    live: Arc<Live>,
    idle: Duration,
    quiet: Duration,
    pipe: Option<Pipe>,
    /// The count each running turn holds one of: the engine's, which keeps
    /// its machine awake while it is above nothing (ADR 0097).
    working: Working,
    /// Whether each Harness it starts is told it shows sub-agents (ADR
    /// 0103, decision 7): off until the window draws them.
    subagents: bool,
}

/// How an Agent reaches Banda from its session: the engine's own program
/// runs as `banda mcp` and talks to the engine's API (ADR 0019, decision
/// 1). Without it, a session gets no Banda.
#[derive(Clone, Debug)]
pub struct Pipe {
    /// The `banda` program.
    pub program: PathBuf,
    /// Where the engine's API listens: `ws://127.0.0.1:<port>/ws`.
    pub engine: String,
}

impl Pipe {
    /// `banda mcp` as `agent`'s session of `thread` in `project` starts it,
    /// with a new pass that names the Thread and the entry `harness`, which
    /// runs it, which the session holds; `None`, said in the log, if there
    /// is no pass. The Harness's process starts it, behind that process's
    /// fence, so it has no holes in it of its own (ADR 0083, decision 1).
    fn program(
        &self,
        project: &ModuleProject,
        agent: AgentId,
        thread: ThreadId,
        harness: &str,
    ) -> Option<(Program, Pass)> {
        let (env, pass) = self.variables(project, agent, Some(thread), harness)?;
        let banda = self.program.display().to_string();
        let mut program = Program::harness(banda, vec!["mcp".to_owned()], Holes::default());
        program.env = env;
        Some((program, pass))
    }

    /// The variables that hand `banda` a new pass of `agent`'s, which the
    /// kernel walls in `project` and which names `thread`, the Thread whose
    /// session it is for, when there is one (ADR 0083, decision 2), and the
    /// entry `harness`, whose process or session holds it: a gateway
    /// account's key goes only to its own (ADR 0078, decision 1). And
    /// where the engine listens, and the pass, which the session it goes to
    /// holds; `None`, said in the log, if there is no pass.
    fn variables(
        &self,
        project: &ModuleProject,
        agent: AgentId,
        thread: Option<ThreadId>,
        harness: &str,
    ) -> Option<(BTreeMap<String, String>, Pass)> {
        let pass = project
            .pass(agent, thread.map(Into::into), Some(harness))
            .inspect_err(|error| tracing::warn!(%error, "an Agent goes without Banda"))
            .ok()?;
        let variables = pass_env(pass.secret().to_owned(), self.engine.clone());
        let variables = variables
            .map(|(name, value)| (name.to_owned(), value))
            .into();
        Some((variables, pass))
    }

    /// `env`'s PATH, or the host's, with the folder of this `banda`
    /// first: a session's `banda keys` and `banda settings` are this
    /// Banda's (ADR 0071, decision 5). On Windows `env`'s may be `Path`.
    fn first_on_path(&self, env: &mut std::collections::BTreeMap<String, String>) {
        let Some(folder) = self.program.parent() else {
            return;
        };
        let named = banda_kernel::host::named(env, "PATH").cloned();
        let rest = (named.as_ref())
            .and_then(|name| env.get(name))
            .map_or_else(banda_kernel::host::path, std::ffi::OsString::from);
        let paths = std::iter::once(folder.to_owned()).chain(std::env::split_paths(&rest));
        if let Some(path) = std::env::join_paths(paths)
            .ok()
            .and_then(|p| p.into_string().ok())
        {
            env.insert(named.unwrap_or_else(|| "PATH".to_owned()), path);
        }
    }
}

impl Agents {
    pub fn new(harnesses: Harnesses) -> Self {
        let working = Working::new();
        Self {
            harnesses,
            config: None,
            modes: None,
            live: Arc::new(Live::new(
                IDLE,
                between::QUIET,
                None,
                working.clone(),
                false,
            )),
            idle: IDLE,
            quiet: between::QUIET,
            pipe: None,
            working,
            subagents: false,
        }
    }

    /// Reads its settings files in `config`, `~/.config/banda`: each new
    /// Thread starts as `agents.toml` there says for its Harness.
    pub fn config_in(self, config: PathBuf) -> Self {
        Self {
            config: Some(config),
            ..self
        }
    }

    /// Reads the modes the Person chose for each Harness's new Threads in
    /// Settings from `file`, in the engine's state folder
    /// ([`chosen_modes`]).
    pub fn modes_chosen_in(self, file: PathBuf) -> Self {
        Self {
            modes: Some(file),
            ..self
        }
    }

    /// Hands every session it opens `banda mcp` through `pipe`.
    pub fn piped(self, pipe: Pipe) -> Self {
        Self {
            pipe: Some(pipe),
            ..self
        }
        .live_again()
    }

    /// Counts each turn in `working` while it runs, a Question it waits on
    /// too: the engine's count, which keeps its machine awake (ADR 0097,
    /// decision 1).
    pub fn counted_in(self, working: Working) -> Self {
        Self { working, ..self }.live_again()
    }

    /// Lets a Harness process go after `idle` with nothing to do, instead
    /// of half an hour.
    pub fn idle_after(self, idle: Duration) -> Self {
        Self { idle, ..self }.live_again()
    }

    /// Ends a turn the Agent went on with by itself after `quiet` with
    /// nothing said, instead of a minute.
    pub fn quiet_after(self, quiet: Duration) -> Self {
        Self { quiet, ..self }.live_again()
    }

    /// Declares sub-agents to each Harness it starts, so the Harness says
    /// each one's session apart from its parent's (ADR 0103, decision 7).
    /// The engine does when `BANDA_SUBAGENTS=1` is set, until Banda always
    /// declares them.
    pub fn declaring_subagents(self) -> Self {
        Self {
            subagents: true,
            ..self
        }
        .live_again()
    }

    fn live_again(mut self) -> Self {
        self.live = Arc::new(Live::new(
            self.idle,
            self.quiet,
            self.pipe.clone(),
            self.working.clone(),
            self.subagents,
        ));
        self
    }

    /// What a new Thread on Harness entry `id` starts with, when Threads
    /// may start with it.
    /// Full access in `agents.toml` counts only as the Person chose it in
    /// Settings (ADR 0083, F0-3): one the file says by itself is no one's
    /// choice, and the fence's default holds.
    fn new_start(&self, id: &str) -> Result<sending::Start, Refusal> {
        self.harness(id)?;
        let file = self
            .config
            .as_ref()
            .map(|c| c.join(sending::AgentsSettings::NAME));
        let mut start = file.map_or_else(Default::default, |file| sending::start(&file, id));
        let chosen = (self.modes.as_deref()).and_then(|modes| chosen_modes::chosen(modes, id));
        if start.mode == Some(model::Mode::FullAccess) && chosen != start.mode {
            start.mode = None;
        }
        Ok(start)
    }

    /// Where a message goes, or who writes (`agents.write`): a Thread,
    /// else a new one on `harness`, with what its entry starts it with.
    fn target(&self, thread: Option<ThreadId>, harness: Option<String>) -> Result<Target, Refusal> {
        match (thread, harness) {
            (Some(thread), _) => Ok(Target::Thread(thread)),
            (None, Some(harness)) => {
                let start = self.new_start(&harness)?;
                Ok(Target::New(harness, start))
            }
            (None, None) => Err(Refusal::invalid(
                "Name a Thread, or a Harness to start one on.",
            )),
        }
    }

    /// The Harness list it starts from, which the machine's module
    /// `harnesses` shares (ADR 0040).
    pub fn harnesses(&self) -> Harnesses {
        self.harnesses.clone()
    }

    fn harness(&self, id: &str) -> Result<Harness, Refusal> {
        self.harnesses.get(id).map_err(Refusal::invalid)
    }

    /// Harness entry `id`'s process in `project`, started if need be.
    async fn running(&self, project: &ModuleProject, id: &str) -> Result<Arc<Connection>, Refusal> {
        let harness = self.harness(id)?;
        let connection = self.live.connection(project, &harness).await;
        connection.map_err(Refusal::from)
    }
}

banda_kernel::methods! {
    Agents(Call) as "AgentsMethods" in "agents/" {
        /// The Threads of this Project, the latest first: each one's ID, title
        /// and Harness, what it was last asked, how its latest turn stands,
        /// and the Questions it waits on.
        call threads(Nothing) -> ThreadList, Read, tool "threads";
        /// One Thread of this Project as its Person reads it: its messages and
        /// replies, its turns and what each may do now, and its settings.
        call thread(OneThread) -> ThreadView, Read, tool "read";
        /// One sub-agent of a Thread, read only, as its Pane and its row
        /// opened in place show it: its record, its own entries and the
        /// Questions it asked, and the sub-agents it started (ADR 0103,
        /// decision 21).
        call subagent(OneSubagent) -> SubagentView, Read;
        /// What a new Thread on a Harness starts with.
        call defaults(OneHarness) -> Defaults, Read;
        /// How much this Project's Threads use each account, a Harness
        /// entry, they ran on: its Threads now, not archived, when its
        /// latest turn began, and its turns begun since `since`
        /// (ADR 0093, decision 6).
        call accounts(Since) -> Vec<AccountUse>, Read;
        /// The turns of a Thread that changed files, the latest first, and
        /// the files one of them changed, from its tool calls: the Diff's
        /// Turn (ADR 0034).
        call changes(ChangesAsk) -> TurnChanges, Read;
        /// The Threads of this Project with a message, its Person's or an
        /// Agent's, that holds every one of `words`: in any case, with or
        /// without accents, and from two letters on as the start of a
        /// longer word too. Each Thread comes once, by its best such
        /// message, the best first, with a line of that message around the
        /// words and where they are in it (ADR 0098, decision 17). Titles
        /// are the window's to search.
        call search(SearchAsk) -> Vec<Found>, Read;
        /// What a Thread's Harness, or a Harness a new Thread starts on,
        /// replies to a prompt, in a short run of its own no Thread shows:
        /// on the Thread's model at the least effort it offers, asking
        /// before it changes anything, and refused whatever it asks. Git
        /// asks it for a commit's message. It says one piece, the reply or
        /// why there is none; let go before, it stops the run.
        stream write(WriteAsk) -> Written, Write;
        /// Which file each Thread at work in this Project reads or writes
        /// now, from its tool calls as they start, with the line they name:
        /// what Files pulses in its tree and follows (ADR 0073, decision 9).
        /// It says them all at once, then again each time one changes; a
        /// Thread's goes as its turn ends.
        stream touching(Nothing) -> Touching, Read;
        /// What each Thread at work in this Project does now, from its
        /// turn's events (ADR 0099, decision 11): a tool call and what it
        /// works on, a thought or its reply; when the turn last said
        /// anything; whether its Harness compacts the context; and when a
        /// usage limit it waits on lets it go on. It says all of them at
        /// once, then each Thread's as it changes, no more than once a
        /// second; a Thread's comes with nothing as its turn ends.
        stream doing(Nothing) -> ThreadsDoing, Read;
        /// Writes into a Thread of this Project, or starts a new Thread on a
        /// Harness. Its Agent reads that the message is from your Thread's
        /// Agent, not its Person; when the turn it asks for ends, its last
        /// reply comes back to your Thread by itself. A message waits its
        /// turn in a Thread that works; a Person's with `steer` joins the
        /// turn that runs.
        command send(Send) -> Sent, Write, tool "send";
        /// A waiting message's new text.
        command edit(Edit) -> (), Write;
        /// Takes a waiting message back.
        command withdraw(OneTurn) -> (), Write;
        /// Sends a waiting message into the turn that runs.
        command steer(OneTurn) -> (), Write;
        /// Lets a held queue go on.
        command resume(OneThread) -> (), Write;
        /// The Thread's settings, from its next turn on. How freely an Agent
        /// acts decides what it asks a Person.
        command configure(Configure) -> (), Decide;
        /// Stops a turn.
        command stop(OneTurn) -> (), Write;
        /// Tries a failed turn's message again. A turn whose message went
        /// again already leaves nothing to do, and answers none, as
        /// `mkdir -p` does: two windows, or a Person and a terminal, may
        /// both ask.
        command retry(OneTurn) -> Option<Sent>, Write;
        /// A new Thread with the conversation to the end of an ended turn:
        /// its turns and items, and a fork of its session there (ADR 0027).
        command fork(OneTurn) -> Forked, Write;
        /// Takes the Thread back to before a turn's message, to edit it:
        /// that turn and the ones after it leave it, and its session goes
        /// back to the reply before (ADR 0027).
        command rewind(OneTurn) -> (), Write;
        /// Answers a Question; `values` fill its form.
        command answer(Answer) -> (), Decide;
        /// An image a message will carry.
        command attach(Attach) -> Image, Write;
        /// An image's bytes.
        call image(OneImage) -> ImageData, Read;
        /// A file a message points at, kept in the Project: one dropped on
        /// the Thread, or a long text pasted.
        command keep(Keep) -> Kept, Write;
        /// Shows your Person a finished HTML page in your Thread, above
        /// your reply: a mockup, a chart, a diagram, how a feature works,
        /// an animation, a sound. Don't announce or describe it after;
        /// say only what it doesn't. The frame is your reply's width, on
        /// the Thread's own background, and fits the page's height up to
        /// 20000px. Leave html, body and the outer element with no
        /// background colour, no outer card, border, banner title or side
        /// padding; Banda adds an 8px gutter for focus rings and shadows.
        /// A box that needs its own background gets 16px padding and
        /// var(--radius) corners. Give charts fixed pixel heights and let
        /// the content set the height: no vh units and no height:100% on
        /// html or body, as the frame grows to fit the page. Use the
        /// window's colours as CSS variables on :root, not fixed colours:
        /// --background, --foreground, --muted, --card, --popover,
        /// --secondary, --border, --input, --ring, --primary, --accent,
        /// --destructive, --warning, --success, --info, --code-background
        /// (most have a matching -foreground; accent, destructive and
        /// warning also have -surface), --chart-1 to --chart-6, --radius,
        /// --font-sans, --font-mono. Banda's sheet sets the text colour
        /// and font. Inline <style> and <script>; web addresses load as
        /// they are. A local image goes in by its absolute path, in src,
        /// srcset, poster or CSS url(): PNG, JPEG, GIF, WebP or SVG, up
        /// to 10 MiB each and 25 MiB a page. Sound plays once your Person
        /// clicks in the page.
        command show_visual(ShowVisual) -> String, Write, tool "show_visual";
        /// Lays out an HTML page as show_visual would show it, and
        /// answers its picture, its height and what its console said:
        /// errors and warnings. Check every Visual with it before
        /// show_visual, fix what it shows, and pass show_visual its
        /// height. It shows your Person nothing and keeps nothing. The
        /// page's rules are show_visual's.
        call preview_visual(PreviewVisual) -> Previewed, Read, tool "preview_visual";
        /// Drafts an issue about a Problem of Banda's for your Person to
        /// send to Banda on GitHub, as the Banda skill's `problems` topic
        /// says: they see it as a card with Send, Edit and Cancel, and only
        /// they send it. `comment_on` an issue that has the fingerprint
        /// already, rather than open another.
        command draft_issue(DraftIssue) -> String, Write, tool "draft_issue";
        /// Keeps how the Person answered a drafted issue: sent, as the
        /// problems module sent it (`problems.send_issue`), or not.
        command answer_issue(AnswerIssue) -> (), Decide;
        /// Tells your Person, when this turn ends, in one line: what is
        /// done, or what you need of them. Their toast and system
        /// notification say it in place of what they asked. Call it last,
        /// once a turn worth telling of is done; a second call replaces
        /// the first. It shows nothing until the turn ends, and nothing
        /// while they look at your Thread.
        command notify(Notify) -> String, Write, tool "notify";
        /// A Visual's page, as the window serves it.
        call visual(OneVisual) -> VisualPage, Read;
        /// Puts off your own Thread: it leaves your Person's list for
        /// `after` (`30m`, `2h`, `1d`, a year at most), or until `until`,
        /// in milliseconds since the epoch. Give one of them: with
        /// neither, it leaves the list only until this turn ends.
        /// Anything that needs your Person wakes it early, and so does
        /// their message. It does not wake you or start a turn. Use it
        /// when you wait on something slow and have nothing for your
        /// Person meanwhile. A Thread that asks may be put off: it comes
        /// back with the same question, and a new one wakes it early. One
        /// your Person put off to go on by itself cannot be. A Person
        /// puts off any Thread, and also Someday, which never wakes by
        /// itself (ADR 0074; ADR 0098, decisions 11 and 12).
        command later(LaterAsk) -> (), Write, tool "later";
        /// Brings your own put-off Thread back to your Person's list now,
        /// as when what you waited on came early. One awake stays so. A
        /// Person wakes any Thread (ADR 0074).
        command wake(WakeAsk) -> (), Write, tool "wake";
        /// Marks that its Person saw a Thread wake by itself, or dismissed
        /// that it did (ADR 0074): its row no longer says it woke, and,
        /// dismissed, its Pane's line goes. It moves forward only, and a
        /// Thread that did not wake by itself stays as it is. The list says
        /// it, as the Later's `woke_seen`. Only a Person marks a Thread.
        command see_woke(SeeWokeAsk) -> (), Write;
        /// Marks a Thread read for its Person (ADR 0096): `turn`, or
        /// without it the latest that ended, is the last they saw, so it
        /// calls them no more. Seen moves forward only: a turn not of this
        /// Thread, one that has not ended, or one older than the mark
        /// changes nothing. The list says it, as `seen`. Only a Person
        /// marks a Thread.
        command read(ReadAsk) -> (), Write;
        /// Marks a Thread unread for its Person: what it said last calls
        /// them again. One with nothing seen stays as it is. Only a Person
        /// does.
        command unread(OneThread) -> (), Write;
        /// Archives a Thread for its Person (ADR 0096): it leaves their
        /// list until something new happens in it, and wakes if it sleeps.
        /// A Thread at work, or one that asks, is refused. The list says
        /// when, as `archived`. Only a Person archives a Thread.
        command archive(OneThread) -> (), Write;
        /// Brings an archived Thread back to its Person's list. One not
        /// archived stays as it is. Only a Person does.
        command unarchive(OneThread) -> (), Write;
        /// Deletes a Thread for good, as its Person asks from Archive (ADR
        /// 0098, decision 14): its messages, turns and marks leave the
        /// Project, and every list drops it. The Project's log keeps what
        /// it said, as after a rewind. A Thread not in Archive, one at
        /// work, or one that asks, is refused. Only a Person deletes a
        /// Thread.
        command delete(OneThread) -> (), Manage;
        /// Moves the marks a window kept of this Project's Threads to
        /// their host, once, by ID: the turn of each it saw last, which
        /// moves seen forward only, and the Threads it showed archived,
        /// each archived from now. A Thread the host does not know or has
        /// archived, one at work, one that asks and one asleep keep their
        /// archive, and one its Person took a mark off keeps both. Only a
        /// Person moves them.
        command import_marks(ImportMarks) -> Imported, Write;
        /// Renames a Thread: one line of up to 120 characters. Without a
        /// title, or with a blank one, its first message's title comes
        /// back. Only a Person renames a Thread (ADR 0077).
        command rename(Rename) -> (), Write;
        /// A title for a Thread, from what it does now, which its Harness's
        /// small model writes in a short run no Thread shows, as `write`
        /// runs. It renames nothing: the window renames the Thread with it.
        command suggest_title(OneThread) -> String, Write;
        /// Moves a Thread to another account, by its entry's ID: from its
        /// next turn it runs there, in the same session on an account of its
        /// Harness, else with its history (ADR 0078, decisions 4 and 5). Only
        /// a Person moves a Thread.
        command switch(Switch) -> (), Write;
        /// Goes on with a turn a usage limit stopped on account `harness`,
        /// as a limit's card does (ADR 0078, decision 6): its Thread wakes
        /// if it was put off, moves there, and the turn's message goes
        /// again, at once. Only a Person moves a Thread.
        command go_on(GoOn) -> Option<Sent>, Write;
    }
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneHarness {
    harness: String,
}

/// What `agents.accounts` is asked: from when its turns count.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Since {
    /// In milliseconds since the epoch: the start of the Person's week.
    #[ts(type = "number")]
    since: i64,
}

/// What `agents.write` is asked: who writes, a Thread or a Harness, one
/// of them, and the prompt.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "agents/")]
struct WriteAsk {
    /// The Thread whose Harness and model write.
    #[serde(default)]
    #[ts(optional)]
    thread: Option<ThreadId>,
    /// A Harness, as a new Thread starts on it, for a Thread not started
    /// yet.
    #[serde(default)]
    #[ts(optional)]
    harness: Option<String>,
    prompt: String,
}

/// What `agents.write` says, once: the reply, or why there is none.
#[derive(Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
enum Written {
    Reply { text: String },
    Refused { refusal: Refusal },
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct OneThread {
    /// The Thread's ID, as `threads` lists it.
    thread: ThreadId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneSubagent {
    /// The sub-agent's ID, as its Thread's `subagents` lists it.
    subagent: SubagentId,
}

/// A message in a Thread, or the first one of a new Thread on a Harness.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct Send {
    /// The Thread to write into, as `threads` lists it.
    #[serde(default)]
    #[ts(optional = nullable)]
    thread: Option<ThreadId>,
    /// Or the Harness a new Thread starts on, as `threads` names them.
    #[serde(default)]
    #[ts(optional = nullable)]
    harness: Option<String>,
    /// What you write.
    #[serde(default)]
    #[ts(as = "Option<String>", optional)]
    text: String,
    /// The images it carries, each added with `agents.attach` first.
    #[serde(default)]
    #[ts(as = "Option<Vec<ImageId>>", optional)]
    #[schemars(skip)]
    images: Vec<ImageId>,
    /// What a new Thread starts with, instead of its Harness's defaults;
    /// or the Thread's settings from this turn on.
    #[serde(default)]
    #[ts(optional = nullable)]
    #[schemars(skip)]
    settings: Option<Settings>,
    /// It goes into the turn that runs, if one does, instead of waiting
    /// for a turn of its own.
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    #[schemars(skip)]
    steer: bool,
}

/// A waiting message's new text, by the turn it waits for.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Edit {
    turn: TurnId,
    text: String,
}

/// An image a message will carry: its kind, its bytes in base64, and the
/// name of its file.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Attach {
    mime: String,
    data: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    name: Option<String>,
}

/// A file for a message to point at: the name it came with, and its bytes
/// in base64.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Keep {
    name: String,
    data: String,
}

/// Where a file kept for a message is: its path in the Project, which the
/// message writes as `@path`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Kept {
    pub path: String,
}

/// A page to show in your Thread.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct ShowVisual {
    /// A complete, self-contained HTML document.
    html: String,
    /// What it shows, in a few words.
    title: String,
    /// Its height in CSS pixels, 80 to 2000.
    height: u32,
}

/// A page to lay out as a Visual.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
struct PreviewVisual {
    /// A complete, self-contained HTML document.
    html: String,
    /// CSS pixels, 240 to 1600; 728 by default, your reply's width. About
    /// 390 for a phone.
    #[serde(default)]
    #[ts(optional = nullable)]
    width: Option<u32>,
    /// The window's colours to lay it out in; dark by default.
    #[serde(default)]
    #[ts(optional = nullable)]
    appearance: Option<Appearance>,
}

/// Light or dark, as the window shows a Visual.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum Appearance {
    Light,
    #[default]
    Dark,
}

/// What the window asks main to lay out (ADR 0037, decision 3).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct LayOut {
    pub html: String,
    pub width: u32,
    pub appearance: Appearance,
}

/// A line the page's console said.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Logged {
    /// `error` or `warning`.
    pub level: String,
    pub text: String,
}

/// What `preview_visual` answers, as main lays the page out: its width
/// and height, and its picture.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Previewed {
    pub width: u32,
    /// What to pass show_visual.
    pub height: u32,
    /// Its console's errors and warnings, the first 20.
    pub console: Vec<Logged>,
    pub pictures: Vec<Picture>,
    /// The local images it names that did not go in, each `path: why`;
    /// show_visual refuses the page until they do.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub unread_images: Vec<String>,
}

/// What the window lays out at several widths for a Visual's heights.
#[derive(Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Fitting<'a> {
    pub html: &'a str,
    pub widths: &'a [u32],
}

/// How long main has to lay a page out.
const LAYING_OUT: Duration = Duration::from_secs(20);
/// How long a show waits for its page's heights.
const FITTING: Duration = Duration::from_secs(5);

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneVisual {
    visual: VisualId,
}

/// What `agents.visual` answers: a Visual's page.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct VisualPage {
    pub html: String,
}

/// What an Agent hears once its Visual shows, as T3 Code says it.
const SHOWN: &str = "Shown to your Person above your reply. Don't mention or describe \
    it; reply with only what it doesn't already say.";

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneImage {
    image: ImageId,
}

/// What `agents.image` answers: an image's kind and its bytes in base64.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ImageData {
    pub mime: String,
    pub data: String,
}

/// What `agents.rename` is asked: a Thread, and its new title; none, or a
/// blank one, gives back its first message's title.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Rename {
    thread: ThreadId,
    #[serde(default)]
    #[ts(optional)]
    title: Option<String>,
}

/// What `agents.switch` is asked: a Thread, and the Harness entry, the
/// account, it runs on from its next turn.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Switch {
    thread: ThreadId,
    harness: String,
}

/// What `agents.go_on` is asked: the stopped turn, and the account it
/// goes on with.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct GoOn {
    turn: TurnId,
    harness: String,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Configure {
    thread: ThreadId,
    settings: Settings,
}

/// What `agents.defaults` answers: what a new Thread on a Harness starts
/// with, and what the Harness last offered in this Project. `at` is where the Project's log stood,
/// so a window hears when a Thread learns more of what the Harness offers.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Defaults {
    #[ts(type = "number")]
    pub at: i64,
    pub settings: Settings,
    pub offer: Offer,
}

/// What `agents.send` answers: the turn that will run the message, or
/// the running one it went into.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Sent {
    pub thread: ThreadId,
    pub turn: TurnId,
    pub item: ItemId,
}

/// What `agents.fork` answers: the new Thread.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Forked {
    pub thread: ThreadId,
    /// Its title, "<title> fork".
    pub title: String,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct OneTurn {
    turn: TurnId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
struct Answer {
    item: ItemId,
    choice: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    values: Option<model::Values>,
}

/// An error in plain words, for a turn that fails by it.
fn plain(error: impl Display) -> String {
    error.to_string()
}

/// Writes one of the module's facts about `thread`, and wakes the Thread
/// if it sleeps and the fact calls its Person (ADR 0074).
fn emit(tx: &mut Tx<'_>, author: Participant, thread: ThreadId, fact: &Fact) -> Result<(), Error> {
    write_fact(tx, author, Some(thread), fact)?;
    laters::heard(tx, author, thread, fact)
}

/// Writes one of the module's facts about the Project's Threads together:
/// no one Thread is its subject.
fn emit_in_project(tx: &mut Tx<'_>, author: Participant, fact: &Fact) -> Result<(), Error> {
    write_fact(tx, author, None, fact)
}

fn write_fact(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: Option<ThreadId>,
    fact: &Fact,
) -> Result<(), Error> {
    let mut both = serde_json::to_value(fact)?;
    let kind = both["kind"].as_str().unwrap_or_default().to_owned();
    let payload = both["payload"].take();
    let subject = thread.map(|thread| thread.to_string());
    tx.emit(&kind, VERSION, subject.as_deref(), author, &payload)?;
    Ok(())
}

/// The handlers of the module's methods, one each (ADR 0014).
impl Agents {
    async fn threads(&self, call: Call, _: Nothing) -> Result<ThreadList, Refusal> {
        let doing = self.live.doings().now(call.project().id());
        let listed = move |sql: &_| store::threads(sql, &doing);
        let (at, threads) = call.project().view(listed).await?;
        Ok(ThreadList { at, threads })
    }

    async fn thread(
        &self,
        call: Call,
        OneThread { thread }: OneThread,
    ) -> Result<ThreadView, Refusal> {
        let (at, found) = call
            .project()
            .view(move |sql| {
                let Some(summary) = store::thread(sql, thread)? else {
                    return Ok(None);
                };
                let items = store::items(sql, thread)?;
                let mut turns = store::turns(sql, thread)?;
                let held = store::held(sql, thread)?;
                // One read: `can` sees the lanes the view gives.
                let lanes = store::lanes_at_work(sql, thread)?;
                rules::can(&mut turns, &store::openers(sql, thread)?, held, lanes);
                let settings = store::settings(sql, thread)?;
                let unfenced = settings.mode == model::Mode::FullAccess
                    && store::full_access(sql, thread)? == Some(Chosen::Unfenced);
                Ok(Some(ThreadView {
                    at: 0,
                    items,
                    turns,
                    settings,
                    offer: store::offer(sql, thread)?,
                    usage: store::usage(sql, thread)?,
                    held,
                    forked_from: store::forked_from(sql, thread)?,
                    unfenced,
                    subagents: store::subagents(sql, thread)?,
                    edits: store::edits(sql, thread)?,
                    thread: summary,
                }))
            })
            .await?;
        let view = found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
        Ok(ThreadView { at, ..view })
    }

    async fn subagent(
        &self,
        call: Call,
        OneSubagent { subagent }: OneSubagent,
    ) -> Result<SubagentView, Refusal> {
        let (at, found) = call
            .project()
            .view(move |sql| {
                let Some((thread, lane)) = store::subagent(sql, subagent)? else {
                    return Ok(None);
                };
                Ok(Some(SubagentView {
                    at: 0,
                    thread,
                    subagent: lane,
                    items: store::lane_items(sql, subagent)?,
                    subagents: store::children(sql, subagent)?,
                }))
            })
            .await?;
        let view = found.ok_or_else(|| Refusal::not_found("There is no such sub-agent."))?;
        Ok(SubagentView { at, ..view })
    }

    async fn changes(
        &self,
        call: Call,
        ChangesAsk { thread, turn }: ChangesAsk,
    ) -> Result<TurnChanges, Refusal> {
        let (at, found) = call
            .project()
            .view(move |sql| {
                if store::thread(sql, thread)?.is_none() {
                    return Ok(None);
                }
                let items = store::items(sql, thread)?;
                let edits = store::edits(sql, thread)?;
                let turns = store::turns(sql, thread)?;
                Ok(Some(changes::changes(&items, &edits, &turns, turn)))
            })
            .await?;
        let (turns, mut files) =
            found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
        // A file in the Project's folder is named from there, as git names it.
        let folder = call.project().folder();
        for file in &mut files {
            if let Ok(inside) = std::path::Path::new(&file.path).strip_prefix(&folder) {
                file.path = inside.to_string_lossy().replace('\\', "/");
            }
        }
        Ok(TurnChanges { at, turns, files })
    }

    async fn search(
        &self,
        call: Call,
        SearchAsk { words, limit }: SearchAsk,
    ) -> Result<Vec<Found>, Refusal> {
        let found = call
            .project()
            .read(move |sql| search::search(sql, &words, limit));
        Ok(found.await?)
    }

    async fn write(
        &self,
        call: Call,
        WriteAsk {
            thread,
            harness,
            prompt,
        }: WriteAsk,
    ) -> Result<banda_kernel::Stream, Refusal> {
        let (harness, settings) = match self.target(thread, harness)? {
            Target::Thread(thread) => {
                let found = call
                    .project()
                    .read(move |sql| {
                        let Some(summary) = store::thread(sql, thread)? else {
                            return Ok(None);
                        };
                        Ok(Some((summary.harness, store::settings(sql, thread)?)))
                    })
                    .await?;
                found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?
            }
            // As a new Thread on it starts.
            Target::New(harness, start) => {
                let on = harness.clone();
                let fence = call.project().environment().fence();
                let (settings, _) = call
                    .project()
                    .read(move |sql| fresh(sql, &on, &start, &fence))
                    .await?;
                (harness, settings)
            }
        };
        if harness.is_empty() {
            return Err(Refusal::conflict("This Thread's Harness is gone."));
        }
        let connection = self.running(call.project(), &harness).await?;
        let folder = call.project().folder();
        let (say, heard) = tokio::sync::mpsc::channel(1);
        // Let go, the stream stops the run: its turn and its session.
        tokio::spawn(async move {
            let model = aside::Model::Thread;
            let ran =
                aside::write(connection, &folder, &settings, model, prompt, say.closed()).await;
            let written = match ran {
                Ok(text) => Written::Reply { text },
                Err(refusal) => Written::Refused { refusal },
            };
            if let Ok(piece) = serde_json::to_value(written) {
                let _ = say.send(piece).await;
            }
        });
        Ok(heard)
    }

    async fn touching(&self, call: Call, _: Nothing) -> Result<banda_kernel::Stream, Refusal> {
        Ok(self.live.touches().hear(call.project().id()))
    }

    async fn doing(&self, call: Call, _: Nothing) -> Result<banda_kernel::Stream, Refusal> {
        Ok(self.live.doings().hear(call.project().id()))
    }

    async fn defaults(
        &self,
        call: Call,
        OneHarness { harness }: OneHarness,
    ) -> Result<Defaults, Refusal> {
        let start = self.new_start(&harness)?;
        let fence = call.project().environment().fence();
        // What the composer shows is what the new Thread gets.
        let (at, (settings, offer)) = call
            .project()
            .view(move |sql| fresh(sql, &harness, &start, &fence))
            .await?;
        Ok(Defaults {
            at,
            settings,
            offer,
        })
    }

    async fn accounts(
        &self,
        call: Call,
        Since { since }: Since,
    ) -> Result<Vec<AccountUse>, Refusal> {
        let uses = call
            .project()
            .read(move |sql| store::account_uses(sql, since));
        Ok(uses.await?)
    }

    async fn send(&self, call: Call, params: Send) -> Result<Sent, Refusal> {
        let Send {
            thread,
            harness,
            text,
            images,
            settings,
            steer,
        } = params;
        rules::message::may_send(&text, &images)?;
        let target = self.target(thread, harness)?;
        let author = call.participant();
        if settings.is_some() {
            rules::message::may_choose(author)?;
        }
        let message = Message { text, images };
        let fence = call.project().environment().fence();
        call.command(move |tx| {
            // An Agent writes from its Thread, which waits for the answer.
            let by = match author {
                Participant::Agent(agent) => {
                    let from = rules::to_thread::own_thread(store::thread_of(tx.sql(), agent)?)?;
                    Some((Opener::Asked, from))
                }
                Participant::Person(_) => None,
            };
            send(tx, author, target, message, settings, steer, by, &fence)
        })
        .await
    }

    async fn edit(&self, call: Call, Edit { turn, text }: Edit) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| edit(tx, author, turn, text)).await
    }

    async fn withdraw(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| withdraw(tx, author, turn)).await
    }

    async fn steer(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| send_now(tx, author, turn)).await
    }

    async fn resume(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| {
            store::thread(tx.sql(), thread)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            writer::resume(tx, author, thread)
        })
        .await
    }

    async fn configure(
        &self,
        call: Call,
        Configure { thread, settings }: Configure,
    ) -> Result<(), Refusal> {
        let author = call.participant();
        let fence = call.project().environment().fence();
        call.command(move |tx| {
            store::thread(tx.sql(), thread)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            configure(tx, author, thread, settings, &fence, None)
        })
        .await
    }

    async fn stop(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| stop(tx, author, turn)).await
    }

    async fn fork(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<Forked, Refusal> {
        let author = call.participant();
        call.command(move |tx| fork(tx, author, turn)).await
    }

    async fn rewind(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| rewind(tx, author, turn)).await
    }

    async fn retry(&self, call: Call, OneTurn { turn }: OneTurn) -> Result<Option<Sent>, Refusal> {
        let author = call.participant();
        call.command(move |tx| retry(tx, author, turn)).await
    }

    async fn answer(&self, call: Call, params: Answer) -> Result<(), Refusal> {
        let Answer {
            item,
            choice,
            values,
        } = params;
        let author = call.participant();
        let live = self.live.clone();
        call.command(move |tx| questions::answer(tx, &live, author, item, choice, values))
            .await
    }

    async fn attach(
        &self,
        call: Call,
        Attach { mime, data, name }: Attach,
    ) -> Result<Image, Refusal> {
        let (image, bytes) = images::prepare(mime, &data, name)?;
        let project = call.project();
        let images = Images::of(project.data());
        // The file first: a row never names bytes that are not
        // there. A file left without a row goes with the sweep.
        images.keep(image.id, bytes).await.map_err(Error::from)?;
        let author = call.participant();
        let kept = call
            .command(move |tx| {
                store::attach_image(tx.sql(), &image, author, tx.now())?;
                Ok(image)
            })
            .await;
        tokio::spawn(sweep(project.clone(), images));
        kept
    }

    async fn keep(&self, call: Call, Keep { name, data }: Keep) -> Result<Kept, Refusal> {
        let bytes = decoded(&data, "file")?;
        let name = rules::message::kept_name(&name, &bytes)?;
        let path = kept::keep(call.project().data(), name, bytes)
            .await
            .map_err(Error::from)?;
        Ok(Kept { path })
    }

    async fn image(&self, call: Call, OneImage { image }: OneImage) -> Result<ImageData, Refusal> {
        let project = call.project();
        let kind = project
            .read(move |sql| store::image_kind(sql, image))
            .await?;
        let gone = || Refusal::not_found("There is no such image.");
        let mime = kind.ok_or_else(gone)?;
        let bytes = Images::of(project.data())
            .read(image)
            .await
            .map_err(|_| gone())?;
        Ok(ImageData {
            mime,
            data: BASE64.encode(bytes),
        })
    }

    async fn draft_issue(&self, call: Call, draft: DraftIssue) -> Result<String, Refusal> {
        let Participant::Agent(agent) = call.participant() else {
            return Err(Refusal::forbidden(
                "Only a Thread's Agent drafts an issue, in its own Thread.",
            ));
        };
        call.command(move |tx| issues::draft(tx, agent, draft))
            .await?;
        Ok(issues::DRAFTED.to_owned())
    }

    async fn notify(&self, call: Call, notify: Notify) -> Result<String, Refusal> {
        let Participant::Agent(agent) = call.participant() else {
            return Err(Refusal::forbidden(
                "Only a Thread's Agent tells its Person, from its own Thread.",
            ));
        };
        call.command(move |tx| notes::note(tx, agent, notify))
            .await?;
        Ok(notes::NOTED.to_owned())
    }

    async fn later(&self, call: Call, ask: LaterAsk) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| laters::later(tx, author, ask)).await
    }

    async fn wake(&self, call: Call, WakeAsk { thread }: WakeAsk) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| laters::wake(tx, author, thread))
            .await
    }

    async fn see_woke(&self, call: Call, ask: SeeWokeAsk) -> Result<(), Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| laters::see_woke(tx, author, ask))
            .await
    }

    async fn read(&self, call: Call, ask: ReadAsk) -> Result<(), Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| marks::read(tx, author, ask)).await
    }

    async fn unread(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| marks::unread(tx, author, thread))
            .await
    }

    async fn archive(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| marks::archive(tx, author, thread))
            .await
    }

    async fn unarchive(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| marks::unarchive(tx, author, thread))
            .await
    }

    async fn delete(&self, call: Call, OneThread { thread }: OneThread) -> Result<(), Refusal> {
        // The kernel refuses an Agent: deleting a Thread takes its Agent
        // out of the Project, which only a Person manages.
        let author = call.participant();
        call.command(move |tx| deleting::delete(tx, author, thread))
            .await?;
        deleting::let_go(&self.live, call.project(), thread);
        Ok(())
    }

    async fn import_marks(&self, call: Call, ask: ImportMarks) -> Result<Imported, Refusal> {
        let author = marks::person(&call)?;
        call.command(move |tx| marks::import(tx, author, ask)).await
    }

    async fn rename(&self, call: Call, Rename { thread, title }: Rename) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| titles::rename(tx, author, thread, title))
            .await
    }

    async fn switch(&self, call: Call, Switch { thread, harness }: Switch) -> Result<(), Refusal> {
        let author = call.participant();
        if author.agent().is_some() {
            return Err(Refusal::forbidden(
                "Only a Person moves a Thread to another account.",
            ));
        }

        let was = (call.project())
            .read(move |sql| store::thread(sql, thread))
            .await?
            .ok_or_else(|| Refusal::not_found("There is no such Thread."))?
            .harness;
        self.harness(&harness)?;
        call.command(move |tx| switching::switch(tx, author, thread, was, harness))
            .await
    }

    async fn go_on(
        &self,
        call: Call,
        GoOn { turn, harness }: GoOn,
    ) -> Result<Option<Sent>, Refusal> {
        let author = call.participant();
        if author.agent().is_some() {
            return Err(Refusal::forbidden(
                "Only a Person moves a Thread to another account.",
            ));
        }
        self.harness(&harness)?;
        call.command(move |tx| {
            let found = turn_of(tx, turn)?;
            let thread = found.thread;
            let turns = store::turns(tx.sql(), thread)?;
            let at = rules::position(&turns, turn);
            // A stale card must neither wake nor move a Thread whose
            // stopped turn has already gone on.
            if !rules::retry(found.state, &at, found.opener.by_itself())? {
                return Ok(None);
            }
            let was = (store::thread(tx.sql(), thread)?)
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?
                .harness;
            laters::wake(tx, author, Some(thread))?;
            switching::switch(tx, author, thread, was, harness)?;
            retry(tx, author, turn)
        })
        .await
    }

    async fn suggest_title(
        &self,
        call: Call,
        OneThread { thread }: OneThread,
    ) -> Result<String, Refusal> {
        let found = call
            .project()
            .read(move |sql| titles::asking(sql, thread))
            .await?;
        let (harness, settings, prompt) =
            found.ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
        if harness.is_empty() {
            return Err(Refusal::conflict("This Thread's Harness is gone."));
        }
        let connection = self.running(call.project(), &harness).await?;
        let name = connection.process().name().to_owned();
        let folder = titles::folder(call.project().data())
            .await
            .map_err(Error::from)?;
        // A caller that goes away stops the run: its turn and its session.
        let (_held, let_go) = tokio::sync::oneshot::channel::<()>();
        let ran = tokio::spawn(async move {
            let stopped = async {
                let _ = let_go.await;
            };
            let small = aside::Model::Small;
            aside::write(connection, &folder, &settings, small, prompt, stopped).await
        });
        let reply = ran.await.map_err(|_| Refusal::internal())??;
        rules::title::suggested(&reply)
            .ok_or_else(|| Refusal::conflict(format!("{name} suggested no title.")))
    }

    async fn answer_issue(&self, call: Call, answer: AnswerIssue) -> Result<(), Refusal> {
        let author = call.participant();
        call.command(move |tx| issues::answer(tx, author, answer))
            .await
    }

    async fn show_visual(&self, call: Call, params: ShowVisual) -> Result<String, Refusal> {
        let ShowVisual {
            html,
            title,
            height,
        } = params;
        let Participant::Agent(agent) = call.participant() else {
            return Err(Refusal::forbidden(
                "Only a Thread's Agent shows a Visual, in its own Thread.",
            ));
        };
        let (title, height) = visuals::may_show(&html, &title, height)?;
        let Inlined { html, unread } = visuals::inlined(html).await.map_err(Error::from)?;
        if !unread.is_empty() {
            return Err(Refusal::invalid(format!(
                "These images did not go into the page: {}.",
                unread.join("; ")
            )));
        }
        // The window lays the page out at each width the Thread may be, so
        // its frame is as tall as it will be before it loads. With no
        // window, or none in a few seconds, the frame takes the Agent's
        // height: a hint holds no show up for long.
        let fitting = Fitting {
            html: &html,
            widths: &visuals::FIT_WIDTHS,
        };
        let heights = call
            .ask_window("heights", &fitting, FITTING)
            .await
            .inspect_err(|refusal| tracing::debug!(%refusal.message, "no heights for a Visual"))
            .unwrap_or_default();
        let visual = VisualId::new();
        let project = call.project();
        let visuals = Visuals::of(project.data());
        // The file first: an item never names a page that is not there.
        visuals.keep(visual, html).await.map_err(Error::from)?;
        let shown = call
            .command(move |tx| show_visual(tx, agent, visual, title, height, heights))
            .await;
        if shown.is_err() {
            visuals.forget(visual).await;
        }
        tokio::spawn(sweep_visuals(project.clone(), visuals));
        shown.map(|()| SHOWN.to_owned())
    }

    async fn preview_visual(
        &self,
        call: Call,
        params: PreviewVisual,
    ) -> Result<Previewed, Refusal> {
        let PreviewVisual {
            html,
            width,
            appearance,
        } = params;
        visuals::may_lay_out(&html)?;
        let Inlined { html, unread } = visuals::inlined(html).await.map_err(Error::from)?;
        let width = width
            .unwrap_or(visuals::WIDTH)
            .clamp(visuals::NARROWEST, visuals::WIDEST);
        let asked = LayOut {
            html,
            width,
            appearance: appearance.unwrap_or_default(),
        };
        let mut previewed: Previewed = call.ask_window("lay_out", &asked, LAYING_OUT).await?;
        previewed.unread_images = unread;
        Ok(previewed)
    }

    async fn visual(
        &self,
        call: Call,
        OneVisual { visual }: OneVisual,
    ) -> Result<VisualPage, Refusal> {
        let html = Visuals::of(call.project().data())
            .read(visual)
            .await
            .map_err(|_| Refusal::not_found("There is no such Visual."))?;
        Ok(VisualPage { html })
    }
}

#[async_trait::async_trait]
impl Module for Agents {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn migrations(&self) -> &'static [&'static str] {
        store::MIGRATIONS
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    /// A title waits for a Harness's model to write it.
    fn runs_on(&self, method: &str) -> bool {
        method == "suggest_title"
    }

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(
        &self,
        call: Call,
        method: &str,
        params: Value,
    ) -> Result<banda_kernel::Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }

    async fn run(&self, project: ModuleProject, effect: Effect) -> Outcome {
        match effect.kind.as_str() {
            effects::START => effects::start(&self.live, &self.harnesses, project, &effect).await,
            effects::STOP => effects::stop(&self.live, project, &effect).await,
            questions::REPLY => questions::reply(&self.live, &effect),
            effects::STEER => effects::steer(&self.live, project, &effect).await,
            other => Outcome::Fail(format!("agents runs no effect of kind {other}")),
        }
    }

    /// From now on, a Project lets go of its hosts of a Harness whose
    /// account changed (ADR 0040, decision 4).
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        let agents = old_agents::read(project.data());
        project
            .write(move |tx| {
                store::fill_harnesses(tx.sql(), &agents)?;
                between::cut_short(tx)?;
                lanes::lost(tx)
            })
            .await?;
        let harnesses = self.harnesses.clone();
        project
            .write(move |tx| retirements::quiet(tx, &harnesses))
            .await?;
        if let Some(heard) = project
            .listen_to_machine("removed-accounts", banda_harnesses::account_changed())
            .await?
        {
            tokio::spawn(retirements::follow(heard, self.harnesses.clone(), true));
        }
        let ended = banda_kernel::EventFilter {
            module: Some("agents".into()),
            subject: None,
            kinds: Some(vec!["turn.ended".into()]),
        };
        tokio::spawn(retirements::follow(
            project.listen("removed-accounts-turns", ended).await?,
            self.harnesses.clone(),
            false,
        ));
        // What git did from a Thread's card, and the tabs its Person lent
        // it, its Agent reads next, each once.
        for (name, filter) in notices::heard() {
            tokio::spawn(notices::follow(project.listen(name, filter).await?));
        }
        // A put-off Thread's failed turn goes on as its time comes.
        let heard = project.listen(time_comes::LISTENER, time_comes::put_off());
        tokio::spawn(time_comes::watch(heard.await?));
        let filter = banda_harnesses::account_changed();
        if let Some(heard) = project.listen_to_machine(Live::ACCOUNTS, filter).await? {
            let live = self.live.clone();
            tokio::spawn(live.let_go_as_accounts_change(project.id(), heard));
        }
        // The messages from before the message index join it meanwhile.
        tokio::spawn(search::backfill(project.downgrade()));
        Ok(())
    }

    async fn can_move(&self, project: ModuleProject) -> Result<(), Refusal> {
        let (_, busy) = project.view(|sql| {
            Ok(sql.query_row("SELECT EXISTS(SELECT 1 FROM agents_turns WHERE state IN ('running', 'queued'))", [], |row| row.get::<_, bool>(0))?)
        }).await?;
        if busy {
            return Err(Refusal::conflict(
                "A Turn is running or queued in this Project. Stop it before moving the folder.",
            ));
        }
        if project.read(store::any_lane_at_work).await? {
            return Err(Refusal::conflict(
                "A sub-agent still works in this Project.",
            ));
        }
        Ok(())
    }

    async fn moving(&self, project: ModuleProject) {
        self.live.close(project.id()).await;
    }

    /// Its Harness processes go, and the next turn's reads the Project's
    /// trust as it is now (ADR 0083, decision 5).
    async fn trust_changed(&self, project: ModuleProject) {
        self.live.let_go(project.id());
    }

    async fn closing(&self, project: ModuleProject) {
        self.live.close(project.id()).await;
    }

    /// Every effect of this module dies with the Harness's process.
    fn on_restart(&self, _kind: &str) -> OnRestart {
        OnRestart::Abandon
    }

    fn settle(&self, tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
        match effect.kind.as_str() {
            // An answer that never reached the Harness closes its Question.
            questions::REPLY => questions::abandoned(tx, effect),
            _ => effects::settle(tx, effect, settled),
        }
    }
}

/// Changes a Thread's settings, if they differ. Its next turn runs with
/// them. A mode that changes is marked as chosen with `fence` as it is
/// (ADR 0083); `why` says why Banda changed it, when Banda did.
fn configure(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    settings: Settings,
    fence: &Fence,
    why: Option<model::WhySupervised>,
) -> Result<(), Error> {
    let before = store::settings(tx.sql(), thread)?;
    if before == settings {
        return Ok(());
    }
    if before.mode != settings.mode {
        let chosen = full_access::chosen(settings.mode, fence);
        store::set_full_access(tx.sql(), thread, chosen)?;
    }
    store::set_settings(tx.sql(), thread, &settings)?;
    let configured = Fact::ThreadConfigured {
        thread,
        settings,
        supervised: why,
    };
    emit(tx, author, thread, &configured)
}

/// Keeps a Thread in Full access Supervised from its turn that starts
/// now, as `why` says (ADR 0083): `fence` does not keep its Full access
/// now. Its `thread.configured` says why, for the window to say.
fn supervised(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    fence: &Fence,
    why: model::WhySupervised,
) -> Result<(), Error> {
    let mut settings = store::settings(tx.sql(), thread)?;
    if settings.mode != model::Mode::FullAccess {
        return Ok(());
    }
    settings.mode = model::Mode::Supervised;
    configure(tx, author, thread, settings, fence, Some(why))
}

/// The bytes of `data`, which a call sends in base64, of `what`.
fn decoded(data: &str, what: &str) -> Result<Vec<u8>, Refusal> {
    BASE64
        .decode(data.as_bytes())
        .map_err(|_| Refusal::invalid(format!("The {what}'s bytes are not base64.")))
}

/// Writes a Visual into the Agent's own Thread, in its turn that runs.
fn show_visual(
    tx: &mut Tx<'_>,
    agent: AgentId,
    visual: VisualId,
    title: String,
    height: u32,
    heights: Vec<Fit>,
) -> Result<(), Error> {
    let body = Body::Visual {
        visual,
        title,
        height,
        heights,
    };
    let refused = "A Visual shows in a turn that runs.";
    let (thread, item, turn) = agent_item(tx, agent, refused, body)?;
    let Body::Visual { title, heights, .. } = item.body else {
        unreachable!("a Visual was written")
    };
    let fact = Fact::VisualShown {
        item: item.id,
        turn,
        visual,
        title,
        height,
        heights,
    };
    emit(tx, Participant::Agent(agent), thread, &fact)
}

/// Writes `body` by the Agent into its own Thread, in its turn that runs,
/// or refuses with `refused` while none runs: an item an Agent's tool
/// shows its Person, which the caller then says. While no turn runs but
/// a sub-agent works, its tool shows it: the item is the Thread's, in the
/// launch turn of the newest at work, and moves the Thread nowhere (ADR
/// 0103, decision 8).
fn agent_item(
    tx: &mut Tx<'_>,
    agent: AgentId,
    refused: &str,
    body: Body,
) -> Result<(ThreadId, Item, TurnId), Error> {
    let thread = rules::to_thread::own_thread(store::thread_of(tx.sql(), agent)?)?;
    let (turn, by_lane) = match store::running(tx.sql(), thread)? {
        Some(running) => (running.id, false),
        None => {
            let lane = store::newest_lane_at_work(tx.sql(), thread)?;
            (lane.ok_or_else(|| Refusal::conflict(refused))?.turn, true)
        }
    };
    let item = Item {
        id: ItemId::new(),
        turn: Some(turn),
        author: Participant::Agent(agent),
        at: tx.now(),
        body,
    };
    store::insert_item(tx.sql(), thread, &item, None)?;
    if !by_lane {
        store::touch_thread(tx.sql(), thread, item.at)?;
    }
    Ok((thread, item, turn))
}

/// Lets go of the pages a day old that no item names, as after a rewind.
async fn sweep_visuals(project: ModuleProject, visuals: Visuals) {
    let named = project.read(store::visual_ids).await;
    let swept = match named {
        Ok(named) => visuals.sweep(named).await.map_err(Error::from),
        Err(error) => Err(error),
    };
    if let Err(error) = swept {
        tracing::warn!(%error, "could not sweep the Visuals no item names");
    }
}

/// Lets go of the images no message took within a day: their rows, then
/// their files. A file whose row went first is swept the next time.
async fn sweep(project: ModuleProject, images: Images) {
    let found = project
        .write(|tx| {
            let last = images::UNSENT_LAST.as_millis() as i64;
            let gone = store::drop_unsent_images(tx.sql(), tx.now() - last)?;
            Ok((gone, store::image_ids(tx.sql())?))
        })
        .await;
    let swept = match found {
        Ok((gone, known)) => images.sweep(gone, known).await.map_err(Error::from),
        Err(error) => Err(error),
    };
    if let Err(error) = swept {
        tracing::warn!(%error, "could not sweep the images no message took");
    }
}

/// What a Person writes to an Agent: text, images, or both.
struct Message {
    text: String,
    images: Vec<ImageId>,
}

/// Where a message goes: into a Thread, or into a new one on a Harness.
enum Target {
    Thread(ThreadId),
    /// A new Thread on a Harness, and what its entry starts one with.
    New(String, sending::Start),
}

/// What a new Thread on `harness` starts with, as the composer shows it:
/// the Harness's own values for what it last offered in this Project, under
/// its entry's `start`; and that offer.
fn fresh(
    sql: &rusqlite::Connection,
    harness: &str,
    start: &sending::Start,
    fence: &Fence,
) -> Result<(Settings, Offer), Error> {
    let offer = store::latest_offer(sql, harness)?;
    let settings = start.over(offer.as_ref(), full_access::unchosen(fence));
    Ok((settings, offer.unwrap_or_default()))
}

/// A message in a Thread, or the first of a new Thread on a Harness, and
/// a turn that waits behind the Thread's earlier turns; or, to `steer`, a
/// message into the turn that runs, if one does. A new Thread starts with
/// `settings`; an existing one changes to them, if they are given. `by`
/// says how another Thread's Agent wrote it, and from which Thread: then
/// the rules of ADR 0019 (decision 4) say whether it may. Only a Person's
/// word joins the turn that runs or lets a held queue go on. `fence` is the
/// fence as it stands, which a new Thread's mode follows and a mode chosen
/// is marked with (ADR 0083).
#[allow(clippy::too_many_arguments)]
fn send(
    tx: &mut Tx<'_>,
    author: Participant,
    target: Target,
    Message { text, images }: Message,
    settings: Option<Settings>,
    steer: bool,
    by: Option<(Opener, ThreadId)>,
    fence: &Fence,
) -> Result<Sent, Error> {
    let now = tx.now();
    let opener = by.map_or(Opener::Person, |(opener, _)| opener);
    let answers = opener == Opener::Answered;
    let by_person = opener.by_person();
    let images = store::unsent_images(tx.sql(), &images, author)?;
    rules::message::may_carry(&images)?;
    let (thread, agent) = match target {
        Target::Thread(id) => {
            let (title, agent) = store::title_and_agent(tx.sql(), id)?
                .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
            if let Some((Opener::Asked, from)) = by {
                let (asks, waiting) = (
                    store::asks(tx.sql(), id)?,
                    store::waiting_for(tx.sql(), from)?,
                );
                rules::to_thread::may_write(from, id, &title, asks, &waiting)?;
            }
            if let Some(settings) = settings {
                configure(tx, author, id, settings, fence, None)?;
            }
            (id, agent)
        }
        Target::New(harness, start) => {
            let title = rules::message::title(&text, &images);
            // No one chose: as the composer would have shown it.
            let settings = match settings {
                Some(settings) => settings,
                None => fresh(tx.sql(), &harness, &start, fence)?.0,
            };
            let chosen = full_access::chosen(settings.mode, fence);
            // An Agent's new Thread is the child of the Thread it writes
            // from (ADR 0098, decision 24).
            let parent = by.map(|(_, from)| from);
            start_thread(tx, author, harness, title, &settings, chosen, parent)?
        }
    };
    let running = match steer && by_person {
        true => steerable(tx, thread)?,
        false => None,
    };
    let item = Item {
        id: ItemId::new(),
        turn: running.as_ref().map(|running| running.id),
        author,
        at: now,
        body: Body::Message {
            text: text.clone(),
            images: images.clone(),
            answers,
        },
    };
    store::insert_item(tx.sql(), thread, &item, None)?;
    store::carry_images(tx.sql(), &images, item.id)?;
    if let Some(running) = running {
        store::touch_thread(tx.sql(), thread, now)?;
        effects::steer_into(
            tx,
            author,
            &running,
            item.id,
            effects::Message { text, images },
        )?;
        let sent = Sent {
            thread,
            turn: running.id,
            item: item.id,
        };
        return Ok(sent);
    }
    if by_person {
        writer::resume(tx, author, thread)?;
    }
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message: item.id,
        state: TurnState::Queued,
        opener,
        from_thread: by.map(|(_, from)| from),
        stopping: false,
    };
    let posted = Fact::MessagePosted {
        item: item.id,
        turn: turn.id,
        text,
        images,
        answers,
    };
    writer::make(tx, author, &turn, Event::Queue, Some(posted))?;
    Ok(Sent {
        thread,
        turn: turn.id,
        item: item.id,
    })
}

/// Stops a turn: at once if it waits, through the Harness if it runs. A
/// stop of the turn that runs holds the queue behind it. A turn that ended
/// already stays as it ended.
fn stop(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = turn_of(tx, turn)?;
    writer::tell(tx, author, &found, Event::Stop)
}

/// The Thread's turn a message can go into: one that runs, unless it is
/// stopping, or is the Agent's own, which takes a message as a turn of
/// its own, whose prompt the Harness takes into what it does.
fn steerable(tx: &mut Tx<'_>, thread: ThreadId) -> Result<Option<store::Turn>, Error> {
    let Some(running) = store::running(tx.sql(), thread)? else {
        return Ok(None);
    };
    Ok(writer::takes(tx.sql(), &running, Event::Steer)?.then_some(running))
}

/// Forks the Thread of `turn`, an ended turn, at its end: a new Thread,
/// "<title> fork", on the same Harness and settings, with a copy of the
/// conversation to there, whose session is to be a fork of the Thread's at
/// the turn's last reply (ADR 0027).
fn fork(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Forked, Error> {
    let found = turn_of(tx, turn)?;
    let from = found.thread;
    let works = store::running(tx.sql(), from)?.is_some();
    rules::may_fork(found.state, works, store::lanes_at_work(tx.sql(), from)?)?;
    let source = store::thread(tx.sql(), from)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let cannot = || Refusal::conflict("Its Agent named no reply of this turn to fork from.");
    let message = store::last_named_reply(tx.sql(), from, turn)?.ok_or_else(cannot)?;
    let evidence: acp::Evidence = store::evidence(tx.sql(), from)?.ok_or_else(cannot)?;
    let settings = store::settings(tx.sql(), from)?;
    let title = format!("{} fork", source.title);
    // As its Thread's mode was chosen, so is the fork's.
    let chosen = store::full_access(tx.sql(), from)?;
    // A fork is no one's child, whoever forked it: it names its source.
    let (thread, agent) = start_thread(
        tx,
        author,
        source.harness,
        title.clone(),
        &settings,
        chosen,
        None,
    )?;
    store::set_forked_from(tx.sql(), thread, from)?;
    store::copy_turns(tx.sql(), (from, found.agent), turn, (thread, agent))?;
    store::set_offer(tx.sql(), thread, &store::offer(tx.sql(), from)?)?;
    let forked = evidence.forked_at(acp::ForkAt {
        message: Some(message),
    });
    store::set_evidence(tx.sql(), thread, &forked)?;
    Ok(Forked { thread, title })
}

fn rewind(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = turn_of(tx, turn)?;
    let thread = found.thread;
    let turns = store::turns(tx.sql(), thread)?;
    let lanes = store::lanes_at_work(tx.sql(), thread)?;
    rules::may_rewind(turn, &turns, &store::openers(tx.sql(), thread)?, lanes)?;
    // Its session goes back to the last reply before the message, or
    // starts anew before the first.
    let reply = store::named_reply_before(tx.sql(), thread, found.message)?;
    let ran_before = (turns.iter().take_while(|one| one.id != turn))
        .any(|one| one.state != TurnState::Withdrawn);
    if reply.is_none() && ran_before {
        let cannot = "Its Agent named no reply before this message to go back to.";
        return Err(Refusal::conflict(cannot).into());
    }
    if let Some(evidence) = store::evidence::<acp::Evidence>(tx.sql(), thread)? {
        let back = evidence.forked_at(acp::ForkAt { message: reply });
        store::set_evidence(tx.sql(), thread, &back)?;
    }
    store::rewind(tx.sql(), thread, turn, tx.now())?;
    emit(tx, author, thread, &Fact::ThreadRewound { thread, turn })?;
    Ok(())
}

/// A new Thread on `harness`, and its own Agent, the only one: in
/// `settings`, its Full access marked as `chosen` (ADR 0083), and the
/// child of `parent`, the Thread whose Agent started it, if one did.
fn start_thread(
    tx: &mut Tx<'_>,
    author: Participant,
    harness: String,
    title: String,
    settings: &Settings,
    chosen: Option<Chosen>,
    parent: Option<ThreadId>,
) -> Result<(ThreadId, AgentId), Error> {
    let summary = ThreadSummary {
        id: ThreadId::new(),
        harness,
        title,
        updated_at: tx.now(),
        was: None,
    };
    let agent = AgentId::new();
    store::insert_thread(tx.sql(), &summary, agent, author, settings)?;
    store::set_full_access(tx.sql(), summary.id, chosen)?;
    if let Some(parent) = parent {
        store::set_parent(tx.sql(), summary.id, parent)?;
    }
    let fact = Fact::ThreadStarted {
        thread: summary.id,
        title: summary.title,
        harness: Some(summary.harness),
        agent: Some(agent),
        parent,
    };
    emit(tx, author, summary.id, &fact)?;
    Ok((summary.id, agent))
}

fn turn_of(tx: &mut Tx<'_>, turn: TurnId) -> Result<store::Turn, Error> {
    Ok(store::turn(tx.sql(), turn)?.ok_or_else(|| Refusal::not_found("There is no such turn."))?)
}

/// The turn that waits for `turn`, as the methods that change it need it.
fn waiting(tx: &mut Tx<'_>, turn: TurnId) -> Result<store::Turn, Error> {
    let found = turn_of(tx, turn)?;
    rules::waits(found.state)?;
    Ok(found)
}

/// Changes the text of the message that waits for `turn`. Its images stay.
fn edit(tx: &mut Tx<'_>, author: Participant, turn: TurnId, text: String) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let turns = store::turns(tx.sql(), found.thread)?;
    rules::may_change(rules::position(&turns, found.id).first)?;
    let item = found.message;
    let Some((thread, mut message)) = store::item(tx.sql(), item)? else {
        return Err(Refusal::not_found("There is no such message.").into());
    };
    let Body::Message {
        text: was, images, ..
    } = &mut message.body
    else {
        return Err(Refusal::invalid("Only a message can be changed.").into());
    };
    let carried: Vec<ImageId> = images.iter().map(|image| image.id).collect();
    rules::message::may_send(&text, &carried)?;
    if *was == text {
        return Ok(());
    }
    was.clone_from(&text);
    store::set_body(tx.sql(), item, &message.body)?;
    emit(tx, author, thread, &Fact::MessageEdited { item, text })?;
    Ok(())
}

/// Takes a waiting message back: its turn never runs, and the Thread no
/// longer shows it.
fn withdraw(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = turn_of(tx, turn)?;
    writer::apply(tx, author, &found, Event::Withdraw)??;
    // Once taken back before any turn ran it, the message shows nowhere in
    // its Thread, so it is found nowhere either (ADR 0098, decision 17).
    search::index(tx.sql(), found.message)?;
    Ok(())
}

/// Sends a waiting message now: into the turn that runs, whose Harness
/// takes it as it works. With no turn that can take it, as one a Person
/// stopped, it waits its turn, and a held queue goes on.
fn send_now(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<(), Error> {
    let found = waiting(tx, turn)?;
    let Some(running) = steerable(tx, found.thread)? else {
        writer::resume(tx, author, found.thread)?;
        return Ok(());
    };
    let message = effects::Message::read(tx.sql(), found.message)?
        .ok_or_else(|| Refusal::invalid("Only a message can be sent."))?;
    writer::apply(tx, author, &found, Event::Withdraw)??;
    store::set_item_turn(tx.sql(), found.message, Some(running.id))?;
    store::move_last(tx.sql(), found.message)?;
    effects::steer_into(tx, author, &running, found.message, message)?;
    Ok(())
}

/// Tries a failed turn's message again, in a new turn with the Thread's
/// settings now; a held queue goes on after it. The failed turn stays as
/// it ended.
fn retry(tx: &mut Tx<'_>, author: Participant, turn: TurnId) -> Result<Option<Sent>, Error> {
    let found = turn_of(tx, turn)?;
    let turns = store::turns(tx.sql(), found.thread)?;
    let at = rules::position(&turns, found.id);
    if !rules::retry(found.state, &at, found.opener.by_itself())? {
        return Ok(None);
    }
    // Queued first, it starts before a held queue goes on.
    // One another Thread's Agent asked for still answers that Thread.
    let (thread, agent, message) = (found.thread, found.agent, found.message);
    let from = found.answers();
    let again = writer::queue(tx, author, thread, agent, message, Opener::Retry, from)?;
    writer::resume(tx, author, found.thread)?;
    Ok(Some(Sent {
        thread: found.thread,
        turn: again,
        item: found.message,
    }))
}

#[cfg(test)]
mod tests {
    use super::Pipe;
    use std::collections::BTreeMap;

    #[test]
    fn this_banda_comes_first_on_a_session_s_path() {
        let pipe = Pipe {
            program: "/opt/banda/bin/banda".into(),
            engine: String::new(),
        };
        // PATH's folders are apart by `;` on Windows.
        let apart = if cfg!(windows) { ';' } else { ':' };
        let path = format!("/usr/bin{apart}/bin");
        let mut env = BTreeMap::from([("PATH".to_owned(), path.clone())]);
        pipe.first_on_path(&mut env);
        assert_eq!(
            env["PATH"],
            format!("/opt/banda/bin{apart}/usr/bin{apart}/bin")
        );
        // Windows' names of variables ignore case: there `Path` is PATH.
        let mut env = BTreeMap::from([("Path".to_owned(), path)]);
        pipe.first_on_path(&mut env);
        let first = format!("/opt/banda/bin{apart}");
        if cfg!(windows) {
            assert_eq!(env.keys().collect::<Vec<_>>(), ["Path"]);
            assert_eq!(env["Path"], format!("{first}/usr/bin{apart}/bin"));
        } else {
            assert!(env["PATH"].starts_with(&first), "the host's, after it");
        }
    }
}
