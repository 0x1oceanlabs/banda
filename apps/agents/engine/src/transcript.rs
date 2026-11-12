//! What a Harness says, written into its Thread as it says it: the
//! Agent's replies and thoughts, gathered a moment so they are written
//! together; its tool calls and what their commands print; its Questions,
//! its plan and its notices; the sub-agents it starts, where it starts
//! them; and what it uses and offers, between turns too; and which file
//! its tool calls work on now, and what the turn does, which only memory
//! keeps (`touching.rs`, `doing.rs`). The turn's own state is the
//! writer's (`writer.rs`).
//!
//! A sub-agent's words are written the same way, by a Transcript of its
//! lane ([`Transcript::lane`]): its entries and their facts name the lane
//! by `sub`, and never touch the Thread. Its Questions are the Thread's
//! entries, which name the lane in their body, and are answered by the
//! Thread's mode as they come (ADR 0103, decisions 8 and 28).

mod content;
mod output;

use crate::acp::ToolPart;
use crate::acp::{Answer, Running, Said, ToolChange, unstarted};
use crate::doing::{Doer, Doings};
use crate::full_access::{Chosen, runs_supervised};
use crate::live::{CrewRun, LaneRun, TurnRun};
use crate::model::{
    Body, CrewId, Fact, Item, ItemId, Mode, Offer, PlanStep, Settings, SubagentId, ThreadId, ToolKind,
    ToolStatus, TurnId, Usage,
};
use crate::touching::{Place, Toucher, Touches, diffed};
use crate::{emit, lanes, plain, questions, store};
use banda_kernel::{AgentId, Error, ModuleProject, Participant, Tx};
use output::{Piece, Pieces, Text};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

/// How long pieces of a reply gather before they are written together.
const GATHER: Duration = Duration::from_millis(80);

/// Returns at `at`, or never without one.
pub async fn until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// Writes a line from Banda into the Thread.
pub fn notice(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    turn: Option<TurnId>,
    text: String,
) -> Result<ItemId, Error> {
    let item = Item {
        id: ItemId::new(),
        turn,
        author: agent,
        at: tx.now(),
        body: Body::Notice { text: text.clone() },
    };
    store::put(tx.sql(), thread, &item, None, None)?;
    let fact = Fact::NoticePosted {
        item: item.id,
        turn,
        text,
        sub: None,
    };
    emit(tx, agent, thread, &fact)?;
    Ok(item.id)
}

/// Writes the Thread's divider before `turn`'s replies, as it moved from
/// the Harness entry `from` to `to` (ADR 0078).
pub fn moved(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    turn: TurnId,
    from: String,
    to: String,
    how: crate::model::Moved,
) -> Result<(), Error> {
    let item = Item {
        id: ItemId::new(),
        turn: Some(turn),
        author: agent,
        at: tx.now(),
        body: Body::Moved {
            from: from.clone(),
            to: to.clone(),
            how: how.clone(),
        },
    };
    store::put(tx.sql(), thread, &item, None, None)?;
    let fact = Fact::ThreadMoved {
        item: item.id,
        turn,
        from,
        to,
        how,
    };
    emit(tx, agent, thread, &fact)
}

/// Writes what the Harness offers in the Thread, when that changed. A
/// session that has not said its commands yet leaves the Thread's slash
/// commands and skills.
pub fn offered(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    running: &Running,
) -> Result<(), Error> {
    let before = store::offer(tx.sql(), thread)?;
    let said = running.commands.as_ref();
    let offer = Offer {
        slash_commands: said
            .map_or(&before.slash_commands, |c| &c.slash_commands)
            .clone(),
        skills: said.map_or(&before.skills, |c| &c.skills).clone(),
        ..running.offer.clone()
    };
    if before == offer {
        return Ok(());
    }
    store::set_offer(tx.sql(), thread, &offer)?;
    emit(tx, agent, thread, &Fact::ThreadOffered { thread, offer })
}

/// Writes what the Agent has used in the Thread, when that changed.
pub fn used(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    usage: Usage,
) -> Result<(), Error> {
    if store::usage(tx.sql(), thread)?.as_ref() == Some(&usage) {
        return Ok(());
    }
    store::set_usage(tx.sql(), thread, &usage)?;
    emit(tx, agent, thread, &Fact::ThreadUsed { thread, usage })
}

/// The Harness started or left its plan by itself, as Claude Code does
/// when a plan is accepted: the Thread's settings follow, and its mode
/// only if the Harness moved that too. Full access the Harness moved to is
/// no Person's choice (ADR 0083): the fence keeps it, or the next turn
/// runs Supervised.
fn switched(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    ran: &Running,
    now: &Running,
) -> Result<(), Error> {
    let before = store::settings(tx.sql(), thread)?;
    let mut settings = before.clone();
    settings.plan = now.plan;
    if now.mode != ran.mode
        && let Some(mode) = now.mode
    {
        settings.mode = mode;
    }
    if settings == before {
        return Ok(());
    }
    if settings.mode != before.mode {
        let chosen = (settings.mode == Mode::FullAccess).then_some(Chosen::Fenced);
        store::set_full_access(tx.sql(), thread, chosen)?;
    }
    store::set_settings(tx.sql(), thread, &settings)?;
    emit(
        tx,
        agent,
        thread,
        &Fact::ThreadConfigured {
            thread,
            settings,
            supervised: None,
        },
    )
}

/// Who holds what a Transcript hears, for its Questions: a turn that
/// runs, or a sub-agent's lane, held while it is at work.
#[derive(Clone, Copy)]
pub enum Holder<'a> {
    Turn(&'a TurnRun),
    /// None once the sub-agent ended: nobody waits on what it asks then.
    Lane(Option<&'a LaneRun>),
    /// A Crew at work, whose agents ask between turns; none once it ended.
    Crew(Option<&'a CrewRun>),
}

impl Holder<'_> {
    /// Holds a Question until a Person answers it; false, the Harness
    /// told at once, when nobody will.
    fn ask(self, item: ItemId, answer: oneshot::Sender<Answer>) -> bool {
        match self {
            Holder::Turn(run) => run.ask(item, answer),
            Holder::Lane(Some(run)) => run.ask(item, answer),
            Holder::Crew(Some(run)) => run.ask(item, answer),
            Holder::Lane(None) | Holder::Crew(None) => {
                let _ = answer.send(Answer::Cancelled);
                false
            }
        }
    }

    fn forget(self, item: ItemId) {
        match self {
            Holder::Turn(run) => run.forget(item),
            Holder::Lane(Some(run)) => run.forget(item),
            Holder::Crew(Some(run)) => run.forget(item),
            Holder::Lane(None) | Holder::Crew(None) => {}
        }
    }

    fn take_steered(self) -> bool {
        match self {
            Holder::Turn(run) => run.take_steered(),
            Holder::Lane(run) => run.is_some_and(LaneRun::take_steered),
            // No message goes into a Crew.
            Holder::Crew(_) => false,
        }
    }
}

/// A tool call the Thread shows.
struct Shown {
    item: ItemId,
    title: String,
    kind: ToolKind,
    printed: output::Printed,
}

/// Writes what the Harness says into the Thread, or what one of its
/// sub-agents says into its lane.
pub struct Transcript {
    project: ModuleProject,
    thread: ThreadId,
    /// The turn it writes in: a sub-agent's launch turn, for its lane.
    turn: TurnId,
    agent: AgentId,
    /// The sub-agent whose lane it writes; none for the Thread's own.
    sub: Option<SubagentId>,
    /// The Crew whose agents' calls and Questions it writes between turns,
    /// in the Crew's turn, as the Thread's entries (ADR 0103, decision 28).
    crew: Option<CrewId>,
    /// The Harness's name, for plain words.
    harness: String,
    /// What the turn started with, and what the session runs with now.
    settings: Settings,
    running: Running,
    pieces: Pieces,
    /// The tool calls the Thread shows, by the Harness's IDs.
    tools: HashMap<String, Shown>,
    /// The open Questions it asked, by the Harness's IDs for them.
    asked: HashMap<String, ItemId>,
    /// The item that shows the Agent's plan for this turn, once it made one.
    plan: Option<ItemId>,
    /// The messages to its sub-agents after their briefs, by the Harness's
    /// IDs for them: the item that shows each, and its words so far.
    messages: HashMap<String, (ItemId, Option<String>)>,
    /// The Harness's ID for the message it says now, when it gives one.
    message: Option<String>,
    due: Option<Instant>,
    /// When the account may be used again, if the Harness said it reached
    /// its limit.
    pub(crate) resets: Option<i64>,
    /// Which file its tool calls work on now; nothing once it is let go,
    /// and for a sub-agent nothing while it is not at work.
    toucher: Option<Toucher>,
    /// What the turn does now; nothing once it is let go, and none for a
    /// sub-agent, which adds no doing.
    doer: Option<Doer>,
    /// For a sub-agent, where its words move when the Thread last stepped
    /// (ADR 0103, decision 8).
    stepped: Option<Arc<Doings>>,
}

impl Transcript {
    /// `doer` says what the turn does from its start, before its Harness
    /// says anything.
    pub fn new(
        project: ModuleProject,
        turn: &store::Turn,
        harness: String,
        settings: Settings,
        running: Running,
        touches: &Arc<Touches>,
        doer: Doer,
    ) -> Transcript {
        Transcript {
            toucher: Some(Toucher::new(touches.clone(), project.id(), turn.thread)),
            doer: Some(doer),
            stepped: None,
            project,
            thread: turn.thread,
            turn: turn.id,
            agent: turn.agent,
            sub: None,
            crew: None,
            harness,
            settings,
            running,
            pieces: Pieces::default(),
            tools: HashMap::new(),
            asked: HashMap::new(),
            plan: None,
            messages: HashMap::new(),
            message: None,
            due: None,
            resets: None,
        }
    }

    /// Writes what sub-agent `sub`, started in `turn` of `thread`, says
    /// into its lane: `native` when its Thread's session keeps to the
    /// Thread's mode itself, as its Harness has modes of its own. Its words
    /// move when the Thread last stepped, in `doings`; it touches files
    /// only while it is at work ([`Transcript::set_toucher`]).
    #[expect(clippy::too_many_arguments, reason = "a lane's place and its Harness")]
    pub fn lane(
        project: ModuleProject,
        thread: ThreadId,
        agent: AgentId,
        turn: TurnId,
        sub: SubagentId,
        harness: String,
        native: bool,
        doings: Arc<Doings>,
    ) -> Transcript {
        Transcript {
            toucher: None,
            doer: None,
            stepped: Some(doings),
            project,
            thread,
            turn,
            agent,
            sub: Some(sub),
            crew: None,
            harness,
            settings: Settings::default(),
            running: Running {
                native,
                ..Running::default()
            },
            pieces: Pieces::default(),
            tools: HashMap::new(),
            asked: HashMap::new(),
            plan: None,
            messages: HashMap::new(),
            message: None,
            due: None,
            resets: None,
        }
    }

    /// Writes what the agents of Crew `crew`, started in `turn` of
    /// `thread`, do between turns: their calls and Questions, as the
    /// Thread's entries in that turn, which touch the Thread nowhere (ADR
    /// 0103, decision 28). Its Questions are answered as a sub-agent's,
    /// by the Thread's mode as they ask, unless its Harness keeps the mode.
    pub fn crew(
        project: ModuleProject,
        thread: ThreadId,
        agent: AgentId,
        turn: TurnId,
        crew: CrewId,
        harness: String,
        native: bool,
    ) -> Transcript {
        Transcript {
            toucher: None,
            doer: None,
            stepped: None,
            project,
            thread,
            turn,
            agent,
            sub: None,
            crew: Some(crew),
            harness,
            settings: Settings::default(),
            running: Running {
                native,
                ..Running::default()
            },
            pieces: Pieces::default(),
            tools: HashMap::new(),
            asked: HashMap::new(),
            plan: None,
            messages: HashMap::new(),
            message: None,
            due: None,
            resets: None,
        }
    }

    /// Which file a sub-agent's calls work on, while it is at work.
    pub fn set_toucher(&mut self, toucher: Option<Toucher>) {
        self.toucher = toucher;
    }

    /// Writes what the Harness says until it ends the turn.
    pub async fn listen(
        &mut self,
        holder: Holder<'_>,
        hear: &mut mpsc::UnboundedReceiver<Said>,
    ) -> Result<(), String> {
        loop {
            let due = self.due;
            let gathered = until(due);
            let saying = until(self.doer.as_ref().and_then(Doer::due));
            tokio::select! {
                biased;
                said = hear.recv() => match said {
                    Some(said) => self.hear(holder, said).await?,
                    None => break,
                },
                () = gathered => self.write_gathered().await?,
                () = saying => if let Some(doer) = &mut self.doer {
                    doer.say();
                },
            }
        }
        self.close().await
    }

    /// When what is gathered is written, if anything is.
    pub fn due(&self) -> Option<Instant> {
        self.due
    }

    /// Writes one thing the Harness said.
    pub async fn hear(&mut self, holder: Holder<'_>, said: Said) -> Result<(), String> {
        match (&mut self.doer, &self.stepped) {
            (Some(doer), _) => doer.hear(&said),
            (None, Some(doings)) => {
                let at = banda_kernel::now_ms();
                doings.stepped(self.project.id(), self.thread, at);
            }
            (None, None) => {}
        }
        match said {
            Said::Reply { text, message } => {
                self.after_steer(holder).await?;
                self.next_message(message).await?;
                self.gather(Text::Reply, &text).await
            }
            Said::Thought { text, message } => {
                self.after_steer(holder).await?;
                self.next_message(message).await?;
                self.gather(Text::Thought, &text).await
            }
            Said::ToolStarted {
                call,
                title,
                tool,
                status,
                content,
                places,
                ..
            } => {
                self.close().await?;
                self.start_tool(call, title, tool, status, content, &places)
                    .await
            }
            Said::ToolChanged {
                call,
                mut change,
                output,
                places,
            } => {
                // What the Agent says after a tool call moves on is a new
                // message; what the command prints is gathered still.
                self.end_text().await?;
                if !self.tools.contains_key(&call) {
                    let titled = change.title.take();
                    let (tool, title, status) = unstarted(titled.as_deref(), change.status.take());
                    let content = change.content.take().unwrap_or_default();
                    self.start_tool(
                        call.clone(),
                        title.to_owned(),
                        tool,
                        status,
                        content,
                        &places,
                    )
                    .await?;
                } else {
                    // What it works on now, if it says.
                    let shown = change.content.iter().flatten();
                    let diff = diffed(shown.filter_map(ToolPart::shown));
                    if (!places.is_empty() || diff.is_some())
                        && let Some(toucher) = &self.toucher
                    {
                        toucher.tool(self.tools[&call].kind, &places, diff);
                    }
                }
                let shown = self.tools.get_mut(&call).expect("started above");
                if let Some(text) = output {
                    shown.printed.add(&text);
                    self.due.get_or_insert_with(|| Instant::now() + GATHER);
                }
                if change.is_empty() {
                    return Ok(());
                }
                if let Some(title) = &change.title {
                    shown.title.clone_from(title);
                }
                let id = shown.item;
                // What it printed comes before how it ended.
                self.write_output().await?;
                self.change_tool(id, change).await
            }
            Said::Asks {
                call,
                title,
                tool,
                offered,
                form,
                plan,
                start,
                answer,
            } => {
                self.close().await?;
                let known = self.tools.get(&call);
                let tool = tool.or(known.map(|shown| shown.kind));
                let shown = known.map(|shown| shown.title.clone());
                // A sub-agent's permission says what its call says, as its
                // row does: Codex titles every one "Run command" (ADR 0103,
                // decision 28). The Agent's own keep the Harness's words.
                let called = shown.clone().filter(|said| {
                    self.sub.is_some()
                        && form.is_none()
                        && plan.is_none()
                        && !said.trim().is_empty()
                });
                let title = called.or(title).or(shown);
                let by_mode = match (self.sub, self.crew) {
                    // The Agent's own keep their turn's mode.
                    (None, None) => (!self.running.native).then_some(self.settings.mode),
                    _ if self.running.native => None,
                    // A sub-agent, or a Crew's agent, may ask after its turn
                    // ended: by the Thread's mode as it asks (ADR 0103,
                    // decision 28).
                    _ => Some(self.mode_now().await?),
                };
                let tool = tool.unwrap_or(ToolKind::Other);
                let (sub, crew) = (self.sub, self.crew);
                let asker = self
                    .project
                    .read(move |sql| match (sub, crew) {
                        (Some(sub), _) => store::lane_label(sql, sub),
                        (None, Some(crew)) => Ok(store::crew_title(sql, crew)?
                            .map(|title| crate::crews::asker(&title))),
                        (None, None) => Ok(None),
                    })
                    .await
                    .map_err(plain)?;
                let whose = questions::Whose {
                    sub: self.sub,
                    asker,
                    crew: self.crew,
                    start: start.map(|start| *start),
                };
                let asked = questions::ask(self.turn, by_mode, tool, title, offered, form, plan, whose);
                let (id, body, asked) = match asked {
                    Ok(questions::Asked::Open(opened)) => *opened,
                    Ok(questions::Asked::ByMode(once)) => {
                        let _ = answer.send(Answer::Chose(once));
                        return Ok(());
                    }
                    Err(error) => {
                        let _ = answer.send(Answer::Cancelled);
                        return Err(error);
                    }
                };
                // Held before it is written, so an answer finds it.
                if !holder.ask(id, answer) {
                    return Ok(());
                }
                let written = self.put(id, body, asked, None).await;
                if written.is_err() {
                    holder.forget(id);
                } else {
                    self.asked.insert(call, id);
                }
                written
            }
            Said::Withdrawn(call) => {
                let Some(id) = self.asked.remove(&call) else {
                    return Ok(());
                };
                holder.forget(id);
                let agent = Participant::Agent(self.agent);
                self.project
                    .write(move |tx| questions::withdrawn(tx, agent, id))
                    .await
                    .map_err(plain)
            }
            Said::Notice(text) => {
                self.close().await?;
                let id = ItemId::new();
                let posted = Fact::NoticePosted {
                    item: id,
                    turn: Some(self.turn),
                    text: text.clone(),
                    sub: self.sub,
                };
                self.put(id, Body::Notice { text }, posted, None).await
            }
            Said::Steps(steps) => match self.plan {
                Some(id) => self.change_plan(id, steps).await,
                // A plan cleared before there was one shows nothing.
                None if steps.is_empty() => Ok(()),
                None => {
                    self.end_text().await?;
                    let id = ItemId::new();
                    self.plan = Some(id);
                    let made = Fact::PlanMade {
                        item: id,
                        turn: self.turn,
                        steps: steps.clone(),
                        sub: self.sub,
                    };
                    self.put(id, Body::Plan { steps }, made, None).await
                }
            },
            Said::Used { usage, resets, .. } => {
                if resets.is_some() {
                    self.resets = resets;
                }
                let (thread, agent) = (self.thread, Participant::Agent(self.agent));
                self.project
                    .write(move |tx| used(tx, agent, thread, usage))
                    .await
                    .map_err(plain)
            }
            Said::Runs(now) => {
                let ran = std::mem::replace(&mut self.running, now.clone());
                let planned = now.native && now.plan != ran.plan;
                // A mode it moved to by itself, not leaving a plan, is not
                // the Person's choice: the Thread keeps theirs, and says so.
                let moved = (now.native && !planned && now.mode != ran.mode).then(|| {
                    let runs = now.mode.map_or("a mode of its own", Mode::name);
                    format!("{} switched itself to {runs} for this turn.", self.harness)
                });
                // What it says after a switch reads after it; a new list of
                // options or slash commands leaves its text whole.
                if planned || moved.is_some() {
                    self.close().await?;
                }
                let (thread, agent, turn) =
                    (self.thread, Participant::Agent(self.agent), self.turn);
                self.project
                    .write(move |tx| {
                        if planned {
                            switched(tx, agent, thread, &ran, &now)?;
                        }
                        if let Some(text) = moved {
                            notice(tx, agent, thread, Some(turn), text)?;
                        }
                        offered(tx, agent, thread, &now)
                    })
                    .await
                    .map_err(plain)
            }
            // A sub-agent starts here, after what was said before it: its
            // lane, under this one's for a nested one, and in this turn,
            // its root's launch turn (ADR 0103, decision 7).
            Said::Subagent { announced, started } => {
                self.close().await?;
                let (thread, agent) = (self.thread, Participant::Agent(self.agent));
                let (turn, parent) = (self.turn, self.sub);
                let kept = self
                    .project
                    .write(move |tx| lanes::start(tx, agent, thread, &announced, turn, parent))
                    .await
                    .map_err(plain)?;
                let _ = started.send(kept);
                Ok(())
            }
            Said::Messaged {
                child,
                message,
                text,
            } => {
                self.close().await?;
                self.messaged(child, message, text).await
            }
        }
    }

    /// Writes a message to sub-agent `child` after its brief, `message`,
    /// with its words so far (ADR 0103, decision 25): where its parent
    /// sent it, that it went; in its own lane, what it said. The same
    /// message again is the same entry, with its words now. One to a child
    /// the Thread keeps no lane for shows nothing.
    async fn messaged(
        &mut self,
        child: String,
        message: String,
        text: Option<String>,
    ) -> Result<(), String> {
        let item = match self.messages.get(&message) {
            Some((_, said)) if *said == text => return Ok(()),
            Some((item, _)) => *item,
            None => ItemId::new(),
        };
        let thread = self.thread;
        let to = self
            .project
            .read(move |sql| store::lane_of_child(sql, thread, &child))
            .await
            .map_err(plain)?;
        let Some(subagent) = to else {
            return Ok(());
        };
        self.messages.insert(message, (item, text.clone()));
        let fact = Fact::SubagentMessaged {
            item,
            turn: self.turn,
            subagent,
            text: text.clone(),
            sub: self.sub,
        };
        self.put(item, Body::Messaged { subagent, text }, fact, None)
            .await
    }

    /// The mode a sub-agent's Question is answered by as it asks: the
    /// Thread's now, Supervised where the fence does not keep its Full
    /// access, as a turn's start makes it.
    async fn mode_now(&self) -> Result<Mode, String> {
        let (thread, fence) = (self.thread, self.project.environment().fence());
        self.project
            .read(move |sql| {
                let mode = store::settings(sql, thread)?.mode;
                let chosen = store::full_access(sql, thread)?;
                Ok(match runs_supervised(mode, chosen, &fence) {
                    Some(_) => Mode::Supervised,
                    None => mode,
                })
            })
            .await
            .map_err(plain)
    }

    async fn start_tool(
        &mut self,
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<ToolPart>,
        places: &[Place],
    ) -> Result<(), String> {
        let id = ItemId::new();
        let shown = Shown {
            item: id,
            title: title.clone(),
            kind: tool,
            printed: output::Printed::default(),
        };
        self.tools.insert(call, shown);
        let content = content::keep(&self.project, content).await?;
        if let Some(toucher) = &self.toucher {
            toucher.tool(tool, places, diffed(&content));
        }
        let started = Fact::ToolStarted {
            item: id,
            turn: self.turn,
            title: title.clone(),
            tool,
            status,
            content: content.clone(),
            sub: self.sub,
        };
        let body = Body::Tool {
            title,
            tool,
            status,
            content,
            output: None,
        };
        self.put(id, body, started, None).await
    }

    async fn change_tool(&self, id: ItemId, change: ToolChange) -> Result<(), String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        let ToolChange {
            title,
            status,
            content,
            exit,
        } = change;
        let content = match content {
            Some(parts) => Some(content::keep(&self.project, parts).await?),
            None => None,
        };
        self.project
            .write(move |tx| {
                if let Some((_, mut item)) = store::item(tx.sql(), id)?
                    && let Body::Tool {
                        title: shown,
                        status: now,
                        content: shows,
                        output,
                        ..
                    } = &mut item.body
                {
                    if let Some(title) = &title {
                        shown.clone_from(title);
                    }
                    if let Some(status) = status {
                        *now = status;
                    }
                    if let Some(content) = &content {
                        store::tool_images(tx.sql(), content, id, agent, tx.now())?;
                        shows.clone_from(content);
                    }
                    if exit.is_some() {
                        output.get_or_insert_default().exit.clone_from(&exit);
                    }
                    store::set_body(tx.sql(), id, &item.body)?;
                }
                let changed = Fact::ToolChanged {
                    item: id,
                    title,
                    status,
                    content,
                    exit,
                };
                emit(tx, agent, thread, &changed)
            })
            .await
            .map_err(plain)
    }

    async fn change_plan(&self, id: ItemId, steps: Vec<PlanStep>) -> Result<(), String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        self.project
            .write(move |tx| {
                store::set_body(
                    tx.sql(),
                    id,
                    &Body::Plan {
                        steps: steps.clone(),
                    },
                )?;
                emit(tx, agent, thread, &Fact::PlanChanged { item: id, steps })
            })
            .await
            .map_err(plain)
    }

    /// Writes what each command printed since the last time, as far as the
    /// Thread keeps it.
    async fn write_output(&mut self) -> Result<(), String> {
        let printed: Vec<_> = self
            .tools
            .values_mut()
            .filter_map(|shown| {
                let (text, cut) = shown.printed.take()?;
                Some((shown.item, text, cut))
            })
            .collect();
        if printed.is_empty() {
            return Ok(());
        }
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        self.project
            .write(move |tx| {
                for (id, text, cut) in printed {
                    if let Some((_, mut item)) = store::item(tx.sql(), id)?
                        && let Body::Tool { output, .. } = &mut item.body
                    {
                        let output = output.get_or_insert_default();
                        output.text.push_str(&text);
                        output.cut |= cut;
                        store::set_body(tx.sql(), id, &item.body)?;
                    }
                    let fact = Fact::ToolOutput {
                        item: id,
                        text,
                        cut,
                    };
                    emit(tx, agent, thread, &fact)?;
                }
                Ok(())
            })
            .await
            .map_err(plain)
    }

    async fn gather(&mut self, kind: Text, text: &str) -> Result<(), String> {
        if let Some(ended) = self.pieces.add(kind, text, ItemId::new()) {
            self.write(ended).await?;
        }
        if self.due.is_none() {
            self.due = Some(Instant::now() + GATHER);
        }
        Ok(())
    }

    /// Writes what has gathered.
    pub async fn write_gathered(&mut self) -> Result<(), String> {
        self.due = None;
        if let Some(piece) = self.pieces.take() {
            self.write(piece).await?;
        }
        self.write_output().await
    }

    /// Writes what is gathered and ends the open item.
    pub async fn close(&mut self) -> Result<(), String> {
        self.due = None;
        self.end_text().await?;
        self.write_output().await
    }

    /// A message a Person sent into the turn ends what the Agent said
    /// before it, for a Harness that does not name its messages.
    async fn after_steer(&mut self, holder: Holder<'_>) -> Result<(), String> {
        if holder.take_steered() {
            self.end_text().await?;
        }
        Ok(())
    }

    /// A message the Harness names anew ends the one it said before.
    async fn next_message(&mut self, message: Option<String>) -> Result<(), String> {
        if message.is_none() {
            return Ok(());
        }
        if self.message.is_some() && message != self.message {
            self.end_text().await?;
        }
        self.message = message;
        Ok(())
    }

    /// Ends the open message or thought: what the Agent says next starts a
    /// new one.
    async fn end_text(&mut self) -> Result<(), String> {
        match self.pieces.close() {
            Some(piece) => self.write(piece).await,
            None => Ok(()),
        }
    }

    /// Writes a piece of a reply or a thought; a reply keeps the ID the
    /// Harness gave its message, which a fork goes to (ADR 0027).
    async fn write(&self, Piece { item, kind, text }: Piece) -> Result<(), String> {
        let grew = kind.grew(item, self.turn, text.clone(), self.sub);
        let named = match kind {
            Text::Reply => self.message.clone(),
            Text::Thought => None,
        };
        self.put(item, kind.body(text), grew, named).await
    }

    /// Writes an item, or a piece of one, and the fact of it; a reply
    /// with `named`, the ID the Harness gave its message. A sub-agent's
    /// goes into its lane, but for its Question, which is the Thread's
    /// (ADR 0103, decision 8), and touches the Thread nowhere.
    async fn put(
        &self,
        id: ItemId,
        body: Body,
        fact: Fact,
        named: Option<String>,
    ) -> Result<(), String> {
        let (thread, turn, agent) = (self.thread, self.turn, Participant::Agent(self.agent));
        let (sub, crew) = (self.sub, self.crew);
        let lane = if matches!(body, Body::Question { .. }) {
            None
        } else {
            sub
        };
        self.project
            .write(move |tx| {
                let item = Item {
                    id,
                    turn: Some(turn),
                    author: agent,
                    at: tx.now(),
                    body,
                };
                store::put(tx.sql(), thread, &item, named.as_deref(), lane)?;
                if let Body::Tool { content, .. } = &item.body {
                    store::tool_images(tx.sql(), content, id, agent, tx.now())?;
                }
                if let Some(crew) = crew {
                    store::set_item_crew(tx.sql(), id, crew)?;
                }
                if sub.is_none() && crew.is_none() {
                    store::touch_thread(tx.sql(), thread, tx.now())?;
                }
                emit(tx, agent, thread, &fact)
            })
            .await
            .map_err(plain)
    }
}
