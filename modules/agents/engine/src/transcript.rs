//! What a Harness says, written into its Thread as it says it: the
//! Agent's replies and thoughts, gathered a moment so they are written
//! together; its tool calls and what their commands print; its Questions,
//! its plan and its notices; and what it uses and offers, between turns
//! too. The turn's own state is the writer's (`writer.rs`).

mod content;
mod output;

use crate::acp::{Answer, Running, Said, ToolChange};
use crate::live::TurnRun;
use crate::model::{
    Body, Fact, Item, ItemId, Mode, Offer, PlanStep, Settings, ThreadId, ToolKind, ToolStatus,
    TurnId, Usage,
};
use crate::{emit, plain, questions, store};
use banda_kernel::{AgentId, Error, ModuleSpace, Participant, Tx};
use output::{Piece, Pieces, Text};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// How long pieces of a reply gather before they are written together.
const GATHER: Duration = Duration::from_millis(80);

/// Writes a line from Banda into the Thread.
pub fn notice(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    turn: TurnId,
    text: String,
) -> Result<(), Error> {
    let item = Item {
        id: ItemId::new(),
        turn: Some(turn),
        author: agent,
        at: tx.now(),
        body: Body::Notice { text: text.clone() },
    };
    store::put(tx.sql(), thread, &item, None)?;
    let fact = Fact::NoticePosted {
        item: item.id,
        turn: Some(turn),
        text,
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
/// only if the Harness moved that too.
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
    store::set_settings(tx.sql(), thread, &settings)?;
    emit(
        tx,
        agent,
        thread,
        &Fact::ThreadConfigured { thread, settings },
    )
}

/// A tool call the Thread shows.
struct Shown {
    item: ItemId,
    title: String,
    kind: ToolKind,
    printed: output::Printed,
}

/// Writes what the Harness says into the Thread.
pub struct Transcript {
    space: ModuleSpace,
    thread: ThreadId,
    turn: TurnId,
    agent: AgentId,
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
    /// The Harness's ID for the message it says now, when it gives one.
    message: Option<String>,
    due: Option<Instant>,
    /// When the account may be used again, if the Harness said it reached
    /// its limit.
    pub(crate) resets: Option<i64>,
}

impl Transcript {
    pub fn new(
        space: ModuleSpace,
        turn: &store::Turn,
        harness: String,
        settings: Settings,
        running: Running,
    ) -> Transcript {
        Transcript {
            space,
            thread: turn.thread,
            turn: turn.id,
            agent: turn.agent,
            harness,
            settings,
            running,
            pieces: Pieces::default(),
            tools: HashMap::new(),
            asked: HashMap::new(),
            plan: None,
            message: None,
            due: None,
            resets: None,
        }
    }

    /// Writes what the Harness says until it ends the turn.
    pub async fn listen(
        &mut self,
        run: &TurnRun,
        hear: &mut mpsc::UnboundedReceiver<Said>,
    ) -> Result<(), String> {
        loop {
            let due = self.due;
            let gathered = async move {
                match due {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                biased;
                said = hear.recv() => match said {
                    Some(said) => self.hear(run, said).await?,
                    None => break,
                },
                () = gathered => self.write_gathered().await?,
            }
        }
        self.close().await
    }

    async fn hear(&mut self, run: &TurnRun, said: Said) -> Result<(), String> {
        match said {
            Said::Reply { text, message } => {
                self.after_steer(run).await?;
                self.next_message(message).await?;
                self.gather(Text::Reply, &text).await
            }
            Said::Thought { text, message } => {
                self.after_steer(run).await?;
                self.next_message(message).await?;
                self.gather(Text::Thought, &text).await
            }
            Said::ToolStarted {
                call,
                title,
                tool,
                status,
                content,
            } => {
                self.close().await?;
                self.start_tool(call, title, tool, status, content).await
            }
            Said::ToolChanged {
                call,
                mut change,
                output,
            } => {
                // What the Agent says after a tool call moves on is a new
                // message; what the command prints is gathered still.
                self.end_text().await?;
                if !self.tools.contains_key(&call) {
                    let title = change.title.take().unwrap_or_else(|| "A tool".to_owned());
                    let status = change.status.take().unwrap_or(ToolStatus::Running);
                    let content = change.content.take().unwrap_or_default();
                    self.start_tool(call.clone(), title, ToolKind::Other, status, content)
                        .await?;
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
                answer,
            } => {
                self.close().await?;
                let known = self.tools.get(&call);
                let tool = tool.or(known.map(|shown| shown.kind));
                let title = title.or_else(|| known.map(|shown| shown.title.clone()));
                let by_mode = (!self.running.native).then_some(self.settings.mode);
                let tool = tool.unwrap_or(ToolKind::Other);
                let asked = questions::ask(self.turn, by_mode, tool, title, offered, form, plan);
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
                if !run.ask(id, answer) {
                    return Ok(());
                }
                let written = self.put(id, body, asked, None).await;
                if written.is_err() {
                    run.forget(id);
                } else {
                    self.asked.insert(call, id);
                }
                written
            }
            Said::Withdrawn(call) => {
                let Some(id) = self.asked.remove(&call) else {
                    return Ok(());
                };
                run.forget(id);
                let agent = Participant::Agent(self.agent);
                self.space
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
                    };
                    self.put(id, Body::Plan { steps }, made, None).await
                }
            },
            Said::Used { usage, resets } => {
                if resets.is_some() {
                    self.resets = resets;
                }
                let (thread, agent) = (self.thread, Participant::Agent(self.agent));
                self.space
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
                self.space
                    .write(move |tx| {
                        if planned {
                            switched(tx, agent, thread, &ran, &now)?;
                        }
                        if let Some(text) = moved {
                            notice(tx, agent, thread, turn, text)?;
                        }
                        offered(tx, agent, thread, &now)
                    })
                    .await
                    .map_err(plain)
            }
        }
    }

    async fn start_tool(
        &mut self,
        call: String,
        title: String,
        tool: ToolKind,
        status: ToolStatus,
        content: Vec<crate::acp::ToolPart>,
    ) -> Result<(), String> {
        let id = ItemId::new();
        let shown = Shown {
            item: id,
            title: title.clone(),
            kind: tool,
            printed: output::Printed::default(),
        };
        self.tools.insert(call, shown);
        let content = content::keep(&self.space, content).await?;
        let started = Fact::ToolStarted {
            item: id,
            turn: self.turn,
            title: title.clone(),
            tool,
            status,
            content: content.clone(),
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
            Some(parts) => Some(content::keep(&self.space, parts).await?),
            None => None,
        };
        self.space
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
        self.space
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
        self.space
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

    async fn write_gathered(&mut self) -> Result<(), String> {
        self.due = None;
        if let Some(piece) = self.pieces.take() {
            self.write(piece).await?;
        }
        self.write_output().await
    }

    /// Writes what is gathered and ends the open item.
    async fn close(&mut self) -> Result<(), String> {
        self.due = None;
        self.end_text().await?;
        self.write_output().await
    }

    /// A message a Person sent into the turn ends what the Agent said
    /// before it, for a Harness that does not name its messages.
    async fn after_steer(&mut self, run: &TurnRun) -> Result<(), String> {
        if run.take_steered() {
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
        let grew = kind.grew(item, self.turn, text.clone());
        let named = match kind {
            Text::Reply => self.message.clone(),
            Text::Thought => None,
        };
        self.put(item, kind.body(text), grew, named).await
    }

    /// Writes an item, or a piece of one, and the fact of it; a reply
    /// with `named`, the ID the Harness gave its message.
    async fn put(
        &self,
        id: ItemId,
        body: Body,
        fact: Fact,
        named: Option<String>,
    ) -> Result<(), String> {
        let (thread, turn, agent) = (self.thread, self.turn, Participant::Agent(self.agent));
        self.space
            .write(move |tx| {
                let item = Item {
                    id,
                    turn: Some(turn),
                    author: agent,
                    at: tx.now(),
                    body,
                };
                store::put(tx.sql(), thread, &item, named.as_deref())?;
                if let Body::Tool { content, .. } = &item.body {
                    store::tool_images(tx.sql(), content, id, agent, tx.now())?;
                }
                store::touch_thread(tx.sql(), thread, tx.now())?;
                emit(tx, agent, thread, &fact)
            })
            .await
            .map_err(plain)
    }
}
