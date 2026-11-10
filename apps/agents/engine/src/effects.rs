//! Running turns: each of the module's effects is here, and what the
//! Harness says while one runs is written by [`Transcript`]:
//!
//! - `turn.start`, keyed by the Thread, so a Thread's turns run one at a
//!   time and in order, while Threads run side by side: the outbox is each
//!   Thread's queue.
//! - `turn.stop`, keyed by the turn: it asks the Harness to stop.
//! - `question.reply`, a Person's answer: `questions.rs` runs it.
//! - `turn.steer`, keyed by the Thread's steering, so messages sent into a
//!   running turn reach it in order and never wait behind it. A message
//!   the turn cannot take waits for a turn of its own instead ([`requeue`]).
//!
//! A turn's state is the writer's to write (`writer.rs`): these effects
//! give it what happened. A Person's stop and a restart hold the Thread's
//! queue: its waiting turns start once a Person lets it go
//! ([`writer::resume`]), as in T3 Code.
//!
//! Each one dies with the Harness's process, so a restart abandons it and
//! [`settle`] writes what that means.
//!
//! A turn starts by setting the session's options to the Thread's settings.
//! A Harness with modes of its own enforces the mode; for any other, the
//! turn answers the Harness's Questions by the mode where the mode allows,
//! and asks the Person otherwise.

use crate::acp::{self, Opened, Prompt, PromptImage, Running, Session, Steered};
use crate::between;
use crate::doing::Doer;
use crate::drive::drive;
use crate::handoff;
use crate::images::Images;
use crate::kept;
use crate::live::{Live, TurnRun};
use crate::model::{
    Body, Fact, Failure, Image, Item, ItemId, Opener, Settings, SlashCommand, ThreadId, TurnId,
    TurnState,
};
use crate::rules::{self, Ending, Event};
use crate::transcript::{Transcript, notice, offered, used};
use crate::{emit, lanes, plain, store, writer};
use banda_harnesses::{Harness, Harnesses};
use banda_kernel::{Effect, Error, ModuleProject, Outcome, Participant, Settled, Tx};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

pub const START: &str = "turn.start";
pub const STOP: &str = "turn.stop";
pub const STEER: &str = "turn.steer";

/// How long a message sent into a turn waits for the turn's Harness to
/// start and take its prompt.
const BEGINNING: Duration = Duration::from_secs(acp::STARTING.as_secs() + acp::OPENING.as_secs());

#[derive(Serialize, Deserialize)]
pub struct TurnEffect {
    pub turn: TurnId,
}

/// A message sent into a running turn.
#[derive(Serialize, Deserialize)]
pub struct SteerEffect {
    pub item: ItemId,
    pub turn: TurnId,
}

/// Sends a message into the turn that runs: the Thread shows it there, and
/// the outbox hands it to the Harness. The message's item is written.
pub fn steer_into(
    tx: &mut Tx<'_>,
    author: Participant,
    running: &store::Turn,
    item: ItemId,
    Message { text, images }: Message,
) -> Result<(), Error> {
    let steered = Fact::MessageSteered {
        item,
        turn: running.id,
        text,
        images,
    };
    emit(tx, author, running.thread, &steered)?;
    let key = format!("{}/steer", running.thread);
    let steer = SteerEffect {
        item,
        turn: running.id,
    };
    tx.enqueue(STEER, &key, &steer)?;
    Ok(())
}

/// A message its turn could not take waits for a turn of its own, once.
pub fn requeue(tx: &mut Tx<'_>, item: ItemId) -> Result<(), Error> {
    let Some((thread, found)) = store::item(tx.sql(), item)? else {
        return Ok(());
    };
    if !store::turns_of(tx.sql(), item)?.is_empty() {
        return Ok(());
    }
    let Some(agent) = store::agent_of(tx.sql(), thread)? else {
        return Ok(());
    };
    store::set_item_turn(tx.sql(), item, None)?;
    // A message another Thread's Agent wrote never joins a turn.
    writer::queue(tx, found.author, thread, agent, item, Opener::Requeue, None)?;
    Ok(())
}

/// Writes lines from Banda into the turn.
async fn notices(
    project: &ModuleProject,
    turn: &store::Turn,
    texts: Vec<String>,
) -> Result<(), Error> {
    if texts.is_empty() {
        return Ok(());
    }
    let (thread, id, agent) = (turn.thread, turn.id, Participant::Agent(turn.agent));
    project
        .write(move |tx| {
            for text in texts {
                notice(tx, agent, thread, Some(id), text)?;
            }
            Ok(())
        })
        .await
}

/// Writes what it means that one of the module's effects will not run to
/// its end.
pub fn settle(tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
    match effect.kind.as_str() {
        START => {
            let start: TurnEffect = serde_json::from_value(effect.payload.clone())?;
            let Some(turn) = store::turn(tx.sql(), start.turn)? else {
                return Ok(());
            };
            let event = match settled {
                Settled::Abandoned => Event::CutShort,
                Settled::Failed(reason) => Event::End(Ending::failed(reason.clone(), None)),
            };
            writer::tell(tx, Participant::Agent(turn.agent), &turn, event)
        }
        // A message that never reached its turn is not lost.
        STEER => {
            let steer: SteerEffect = serde_json::from_value(effect.payload.clone())?;
            requeue(tx, steer.item)
        }
        _ => Ok(()),
    }
}

/// Asks the Harness to stop a running turn.
pub async fn stop(live: &Live, project: ModuleProject, effect: &Effect) -> Outcome {
    let Ok(stop) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The stop could not be read.".to_owned());
    };
    let state = project
        .read(move |sql| Ok(store::turn(sql, stop.turn)?.map(|t| t.state)))
        .await;
    match state {
        Ok(Some(state)) if rules::ongoing(state) => match live.stop(stop.turn) {
            Ok(()) => Outcome::Done,
            Err(error) => Outcome::Retry(error),
        },
        Ok(_) => Outcome::Done,
        Err(error) => Outcome::Retry(error.to_string()),
    }
}

/// The longest a turn waits for the modules reacting to its start.
const REACTED: Duration = Duration::from_secs(5);

/// Runs one turn to its end, and writes how it ended.
pub async fn start(
    live: &Arc<Live>,
    harnesses: &Harnesses,
    project: ModuleProject,
    effect: &Effect,
) -> Outcome {
    let Ok(start) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The turn could not be read.".to_owned());
    };
    // Memory holds the turn from now, a stop that comes while it starts
    // too, and lets go of it however this ends.
    let run = live.open(start.turn);
    if let Err(error) = after_questions(live, &project, start.turn).await {
        return Outcome::Retry(error.to_string());
    }
    let fence = project.environment().fence();
    // Banda keeps a Thread Supervised for its Person, not its Agent.
    let banda = Participant::Person(project.owner());
    let begun = project
        .write(move |tx| {
            let Some(turn) = store::turn(tx.sql(), start.turn)? else {
                return Ok(None);
            };
            let agent = Participant::Agent(turn.agent);
            // A turn stopped while it waited never runs; one in a held
            // queue waits until a Person lets the queue go. The outbox
            // starts a Thread's turns one at a time, so no turn but the
            // Agent's own runs beside it.
            if let Err(refused) = writer::apply(tx, agent, &turn, Event::Start)? {
                if store::running(tx.sql(), turn.thread)?.is_some() {
                    tracing::warn!(%refused, "a turn did not start beside another");
                }
                return Ok(None);
            }
            // A message reads where its turn starts, after what came while
            // it waited; a message tried again stays where it was.
            let first = store::turns_of(tx.sql(), turn.message)?
                .first()
                .map(|t| t.id);
            if first == Some(turn.id) {
                store::move_last(tx.sql(), turn.message)?;
            }
            let message = Message::read(tx.sql(), turn.message)?.unwrap_or(Message {
                text: String::new(),
                images: Vec::new(),
            });
            let mut settings = store::turn_settings(tx.sql(), &turn)?;
            // Full access the fence does not keep now runs Supervised,
            // unless its Person chose it so (ADR 0083).
            let chosen = store::full_access(tx.sql(), turn.thread)?;
            if let Some(why) = crate::full_access::runs_supervised(settings.mode, chosen, &fence) {
                settings.mode = crate::model::Mode::Supervised;
                store::set_turn_settings(tx.sql(), turn.id, &settings)?;
                crate::supervised(tx, banda, turn.thread, &fence, why)?;
            }
            Ok(Some((turn, message, settings)))
        })
        .await;
    let (turn, message, settings) = match begun {
        Ok(Some(begun)) => begun,
        Ok(None) => return Outcome::Done,
        Err(error) => return Outcome::Retry(error.to_string()),
    };
    // What reacts to the turn's start, as git keeping the work tree as it
    // began, does so before the Harness changes anything.
    if !project.reacted(REACTED).await {
        tracing::warn!(turn = %turn.id, "a turn started before all reacted to it");
    }
    // Memory lets go of the turn before its end is written.
    let ending = match work(live, run, harnesses, &project, &turn, message, settings).await {
        Ok(ending) | Err(ending) => ending,
    };
    // Written as the outbox records the turn's end, and tried again with
    // it. An ending that comes after the turn ended changes nothing.
    Outcome::done_writing(move |tx| {
        let agent = Participant::Agent(turn.agent);
        writer::tell(tx, agent, &turn, Event::End(ending.clone()))
    })
}

/// The message a turn sends: its text and the images it carries.
pub struct Message {
    pub text: String,
    pub images: Vec<Image>,
}

/// Waits while the Agent asks a Person in a turn of its own in the Thread
/// of `turn`: the Harness takes a prompt into what it does, and the
/// Question would go unanswered.
async fn after_questions(live: &Live, project: &ModuleProject, turn: TurnId) -> Result<(), Error> {
    let own = project
        .read(move |sql| {
            let Some(turn) = store::turn(sql, turn)? else {
                return Ok(None);
            };
            let Some(running) = store::running(sql, turn.thread)? else {
                return Ok(None);
            };
            Ok(running.opener.by_itself().then_some(running.id))
        })
        .await?;
    if let Some(own) = own {
        live.answered(own).await;
    }
    Ok(())
}

impl Message {
    /// `item`'s message, if it is one.
    pub fn read(sql: &rusqlite::Connection, item: ItemId) -> Result<Option<Message>, Error> {
        Ok(match store::item(sql, item)? {
            Some((
                _,
                Item {
                    body: Body::Message { text, images, .. },
                    ..
                },
            )) => Some(Message { text, images }),
            _ => None,
        })
    }
}

/// Whose message a prompt sends: its Thread and item, and, when another
/// Thread's Agent wrote it, that Thread and whether it answers.
pub struct Whose {
    pub thread: ThreadId,
    pub item: ItemId,
    pub from: Option<(ThreadId, bool)>,
}

impl Whose {
    /// The message of `turn`.
    fn of(turn: &store::Turn) -> Whose {
        let answers = turn.opener == Opener::Answered;
        Whose {
            thread: turn.thread,
            item: turn.message,
            from: turn.from_thread.map(|from| (from, answers)),
        }
    }
}

/// What `message` sends `harness`, in order: who wrote it, when another
/// Thread's Agent did; the skills it names, run as commands; and, unless
/// the Harness runs it as a command, the notices it takes before it. And
/// what Banda tells the Person it left out; why nothing of it can go, if
/// nothing can.
async fn prompt_of(
    project: &ModuleProject,
    harness: &str,
    running: &Running,
    Whose { thread, item, from }: Whose,
    Message { mut text, images }: Message,
) -> Result<(Prompt, Vec<String>), String> {
    // Another Thread's Agent wrote it: the Harness reads which.
    if let Some((from, answers)) = from {
        let title = project
            .read(move |sql| Ok(store::thread(sql, from)?.map(|t| t.title)))
            .await
            .map_err(plain)?;
        text = rules::to_thread::from_agent(answers, from, &title.unwrap_or_default(), &text);
    }
    let mut prompt = as_skill(
        Prompt {
            text,
            command: None,
            images: Vec::new(),
        },
        running,
    );
    // What the Person did meanwhile, as a commit from the Thread's card,
    // goes before it.
    if !runs_command(project, thread, running, &prompt).await? {
        let notices = project
            .write(move |tx| store::notices_of(tx.sql(), thread, item, true))
            .await
            .map_err(plain)?;
        prompt.text = crate::notices::before(&notices, &prompt.text);
    }
    let mut refused = Vec::new();
    if running.offer.no_images && !images.is_empty() {
        refused.push(rules::message::without_images(harness, &prompt.text)?);
        return Ok((prompt, refused));
    }
    let files = Images::of(project.data());
    for image in images {
        match files.read(image.id).await {
            Ok(bytes) => prompt.images.push(PromptImage {
                mime: image.mime,
                bytes,
            }),
            Err(_) => refused.push(format!(
                "{} is gone, so {harness} got the message without it.",
                image.name.as_deref().unwrap_or("An image"),
            )),
        }
    }
    Ok((prompt, refused))
}

/// Whether the Harness runs `prompt` as a command: a skill it starts
/// with, or `/` and a slash command the session offers, or the Thread
/// does while the session has said none.
async fn runs_command(
    project: &ModuleProject,
    thread: ThreadId,
    running: &Running,
    prompt: &Prompt,
) -> Result<bool, String> {
    if prompt.command.is_some() && prompt.text.is_empty() {
        return Ok(true);
    }
    let Some(rest) = prompt.text.strip_prefix('/') else {
        return Ok(false);
    };
    let name = rest
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    let runs = |commands: &[SlashCommand]| commands.iter().any(|c| c.name == name);
    Ok(match &running.commands {
        Some(said) => runs(&said.slash_commands),
        None => project
            .read(move |sql| Ok(store::offer(sql, thread)?.slash_commands))
            .await
            .map(|offered| runs(&offered))
            .map_err(plain)?,
    })
}

/// The prompt with the skills it names that are slash commands run as
/// one, as Claude Code runs its skills (issue #149).
fn as_skill(prompt: Prompt, running: &Running) -> Prompt {
    let Some(said) = &running.commands else {
        return prompt;
    };
    match crate::skills::dispatch(&prompt.text, &said.slashed) {
        Some((lead, command)) => Prompt {
            text: lead,
            command: Some(command),
            ..prompt
        },
        None => prompt,
    }
}

/// Sends a message into the turn it was sent to. A turn that cannot take
/// it leaves it to a turn of its own: one that ended or never began, one
/// whose Harness says no turn runs, and one whose Harness cannot take a
/// message while it works, which stops for it, as in T3 Code.
pub async fn steer(live: &Live, project: ModuleProject, effect: &Effect) -> Outcome {
    let Ok(SteerEffect { item, turn }) = serde_json::from_value(effect.payload.clone()) else {
        return Outcome::Fail("The message could not be read.".to_owned());
    };
    let found = project
        .read(move |sql| {
            let Some(turn) = store::turn(sql, turn)? else {
                return Ok(None);
            };
            Ok(Message::read(sql, item)?.map(|message| (turn, message)))
        })
        .await;
    let (turn, message) = match found {
        Ok(Some(found)) => found,
        Ok(None) => return Outcome::Done,
        Err(error) => return Outcome::Retry(error.to_string()),
    };
    // Written as the outbox records the effect's end, and tried again with it.
    let requeued = || Outcome::done_writing(move |tx| requeue(tx, item));
    let Some(session) = begun(live, &project, &turn).await else {
        return requeued();
    };
    // A turn that is stopping takes nothing more.
    let id = turn.id;
    let takes = project
        .read(move |sql| match store::turn(sql, id)? {
            Some(now) => writer::takes(sql, &now, Event::Steer),
            None => Ok(false),
        })
        .await;
    match takes {
        Ok(true) => {}
        Ok(false) => return requeued(),
        Err(error) => return Outcome::Retry(error.to_string()),
    }
    if !session.steers() {
        let text = format!(
            "{} cannot take a message while it works, so Banda stopped it to send yours.",
            session.name()
        );
        let (thread, agent) = (turn.thread, Participant::Agent(turn.agent));
        let gave_way = project
            .write(move |tx| {
                let Some(now) = store::turn(tx.sql(), id)? else {
                    return Ok(());
                };
                if writer::apply(tx, agent, &now, Event::GiveWay)?.is_ok() {
                    notice(tx, agent, thread, Some(id), text)?;
                }
                Ok(())
            })
            .await;
        if let Err(error) = gave_way {
            return Outcome::Retry(error.to_string());
        }
        return requeued();
    }
    let running = session.running();
    let whose = Whose {
        thread: turn.thread,
        item,
        from: None,
    };
    let Ok((prompt, refused)) = prompt_of(&project, session.name(), &running, whose, message).await
    else {
        return requeued();
    };
    if let Err(error) = notices(&project, &turn, refused).await {
        return Outcome::Retry(error.to_string());
    }
    // Marked first: what the Agent says of the message reads after it.
    live.mark_steered(turn.id);
    match session.steer(&prompt).await {
        Ok(Steered::Joined) => Outcome::Done,
        Ok(Steered::NotNow) => requeued(),
        Err(error) => {
            tracing::warn!(%error, "a message could not join its turn");
            requeued()
        }
    }
}

/// The session of a turn that runs, once its prompt reached it, which
/// takes a while for a Harness that starts; `None` when the turn ended
/// first, or never began.
async fn begun(live: &Live, project: &ModuleProject, turn: &store::Turn) -> Option<Session> {
    // Following the Thread's turn endings before it reads, so an end
    // between the two is not missed.
    let mut ended = project.committed(turn.thread, &[writer::ENDED]);
    let id = turn.id;
    let ended = async {
        loop {
            let state = project
                .read(move |sql| Ok(store::turn(sql, id)?.map(|turn| turn.state)))
                .await;
            if !matches!(state, Ok(Some(TurnState::Running))) {
                return;
            }
            ended.next().await;
        }
    };
    tokio::select! {
        biased;
        begun = live.begun(id) => Some(begun),
        () = ended => None,
        () = tokio::time::sleep(BEGINNING) => None,
    }
}

async fn work(
    live: &Arc<Live>,
    run: TurnRun,
    harnesses: &Harnesses,
    project: &ModuleProject,
    turn: &store::Turn,
    message: Message,
    settings: Settings,
) -> Result<Ending, Ending> {
    let unplanned = |reason: String| Ending::failed(reason, None);
    let thread = turn.thread;
    // What the turn does is said from its start, while its Harness starts
    // too, so one that never gets going shows as stuck.
    let doer = Doer::new(live.doings().clone(), project.id(), thread, turn.id);
    let choices = harnesses.clone();
    let harness_id = project
        .write(move |tx| {
            crate::retirements::one(tx, &choices, thread)?;
            store::thread(tx.sql(), thread)
        })
        .await
        .map_err(|e| unplanned(plain(e)))?
        .map(|summary| summary.harness)
        .unwrap_or_default();
    let harness = match harness_id.as_str() {
        "" => Err("This Thread names no Harness: its Agent's file is gone.".to_owned()),
        id => harnesses.get(id),
    }
    .map_err(unplanned)?;
    // The Agent has no name of its own: its Harness's is the one to show.
    let name = harness.name.clone();
    let connection = live
        .connection(project, &harness)
        .await
        .map_err(|failed| Ending::failed(failed.to_string(), Some(Failure::HarnessStopped)))?;
    // The process is not let go as idle while the turn opens its session
    // in it: a sub-agent the turn starts holds it only once announced.
    let opening = connection.keep();
    // The session the Thread had, and the account its turn before this
    // one ran on.
    let turn_id = turn.id;
    let (earlier, before, pending): (Option<acp::Evidence>, _, Option<Arrived>) = project
        .read(move |sql| {
            let before = store::ran_before(sql, thread, turn_id)?;
            Ok((
                store::evidence(sql, thread)?,
                before,
                store::arrival(sql, thread)?,
            ))
        })
        .await
        .map_err(|e| unplanned(plain(e)))?;
    // The Thread's session lives in this process alone: one another account
    // of it had goes (ADR 0078, decision 4).
    live.forget_elsewhere(project.id(), thread, &harness).await;
    // Another account of the same Harness goes on with the same session.
    let kin = |other: &str| (harnesses.find(other)).is_some_and(|o| o.shares_sessions(&harness));
    // A failed process start records a turn on the new entry before it
    // ever opens a session. Its retry still owes the old session's history.
    let before = earlier
        .as_ref()
        .filter(|e| before.as_deref() == Some(&harness.id) && !kin(e.harness()))
        .map(|e| e.harness().to_owned())
        .or(before);
    let (earlier, arrived) = if let Some(pending) = pending.filter(|p| p.divider.1 == harness.id) {
        (earlier, Some(pending))
    } else {
        match before.filter(|before| *before != harness.id) {
            Some(before) => {
                let (earlier, arrived) =
                    arrive(project, harnesses, turn, &harness, &before, earlier).await?;
                (earlier, Some(arrived))
            }
            None => (earlier, None),
        }
    };
    // A session that opens reaches Banda with a pass of its own, which
    // names its Thread (ADR 0019; ADR 0083, decision 2).
    let banda = || live.banda(project, turn.agent, thread, &harness.id);
    let (session, opened) = connection
        .session(
            thread,
            &project.folder(),
            &kept::roots(project.data()),
            earlier.as_ref(),
            &kin,
            banda,
        )
        .await?;
    if let Opened::New { evidence, lost } = opened {
        let (id, agent) = (turn.id, Participant::Agent(turn.agent));
        let afresh = format!(
            "{} could not pick up this Thread's earlier conversation, \
             so it starts afresh and does not remember what was said before.",
            harness.name
        );
        project
            .write(move |tx| {
                store::set_evidence(tx.sql(), thread, &evidence)?;
                if lost {
                    notice(tx, agent, thread, Some(id), afresh)?;
                }
                Ok(())
            })
            .await
            .map_err(|e| unplanned(plain(e)))?;
    }
    let (running, mut refused) = session.settle(&settings).await;
    let (mut prompt, left_out) =
        prompt_of(project, &harness.name, &running, Whose::of(turn), message)
            .await
            .map_err(unplanned)?;
    refused.extend(left_out);
    // A command runs as it is. Keep the handoff for the first ordinary
    // prompt that succeeds, including across a restart or retry.
    let command = runs_command(project, thread, &running, &prompt)
        .await
        .map_err(unplanned)?;
    let handed = arrived.is_some() && !command;
    if let Some(history) = arrived.as_ref().and_then(|a| a.history.as_ref())
        && !command
    {
        prompt.text = history.clone() + &prompt.text;
    }
    let (id, agent, now) = (turn.id, Participant::Agent(turn.agent), running.clone());
    // What the Agent used, as it last said, between turns too.
    let usage = session.usage();
    project
        .write(move |tx| {
            if let Some(mut arrived) = arrived {
                if !arrived.shown {
                    let (from, to, how) = arrived.divider.clone();
                    crate::transcript::moved(tx, agent, thread, id, from, to, how)?;
                    arrived.shown = true;
                }
                store::set_arrival(tx.sql(), thread, Some(&arrived))?;
            }
            offered(tx, agent, thread, &now)?;
            if let Some(usage) = usage {
                used(tx, agent, thread, usage)?;
            }
            for text in refused {
                notice(tx, agent, thread, Some(id), text)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| unplanned(plain(e)))?;
    // What the session says once the turn ends is the Agent's own. Heard
    // before the prompt goes, so what follows its answer is heard in a
    // session's first turn too.
    let listener = between::Listener {
        live: live.clone(),
        project: project.clone(),
        thread,
        agent: turn.agent,
        name,
        harness: harness.name.clone(),
    };
    listener.hear(&session);
    // Its sub-agents are heard apart, in lanes of the Thread, from before
    // the prompt goes: a load's replay came before, and maps none.
    let lanes = lanes::Hearer {
        live: live.clone(),
        project: project.clone(),
        thread,
        agent: turn.agent,
        harness: harness.name.clone(),
    };
    lanes.hear(&session);
    let (mut hear, done) = session.prompt(&prompt);
    // The prompt holds it now.
    drop(opening);
    run.begin(session.clone());
    let transcript = Transcript::new(
        project.clone(),
        turn,
        harness.name.clone(),
        settings,
        running,
        live.touches(),
        doer,
    );
    let ended = async {
        done.await
            .unwrap_or_else(|_| unplanned("The turn's task ended.".to_owned()))
    };
    let ending = drive(&run, transcript, &mut hear, ended).await;
    if handed && ending.state == TurnState::Done {
        project
            .write(move |tx| store::set_arrival(tx.sql(), thread, None::<&Arrived>))
            .await
            .map_err(|e| unplanned(plain(e)))?;
    }
    // What it said while the turn began but heard nothing yet, such as
    // Claude Code's slash commands just after its session opened.
    // The turn ended as it did, whether or not this is written.
    let now = session.running();
    if let Err(error) = project
        .write(move |tx| offered(tx, agent, thread, &now))
        .await
    {
        tracing::warn!(%error, "what the Harness offers could not be written");
    }
    Ok(ending)
}

/// What a turn on a Thread that moved before it starts with (ADR 0078).
#[derive(Clone, Serialize, Deserialize)]
struct Arrived {
    /// The divider was written already, even if its prompt failed.
    shown: bool,
    /// The history it reads before the message, from another Harness.
    history: Option<String>,
    /// The Thread's divider: from, to, and how.
    divider: (String, String, crate::model::Moved),
}

/// Readies `turn`, the first of its Thread on `harness` since it ran on
/// the entry `before`, and the session it goes on with: the one the
/// Thread had, on another account of the Harness; one this Harness had
/// before; or none, for a session of its own.
///
/// - Another account of the same Harness goes on with the same session,
///   readied for it (decisions 3 and 4).
/// - Another Harness starts a session of its own and reads the Thread's
///   history from Banda's log, or, one the Thread ran on before, goes on
///   with its own session and reads what it missed (decision 5). The
///   session the Thread had is kept for when it comes back.
async fn arrive(
    project: &ModuleProject,
    harnesses: &Harnesses,
    turn: &store::Turn,
    harness: &Harness,
    before: &str,
    earlier: Option<acp::Evidence>,
) -> Result<(Option<acp::Evidence>, Arrived), Ending> {
    use crate::model::Moved;
    let unplanned = |e: Error| Ending::failed(plain(e), None);
    let from_entry = harnesses.find(before);
    let named = |entry: &Harness| match &entry.of {
        Some(of) => match harnesses.find(of) {
            Some(of) => format!("{} · {}", of.name, entry.name),
            None => entry.name.clone(),
        },
        None => entry.name.clone(),
    };
    let from = from_entry.as_ref().map_or_else(|| before.to_owned(), named);
    // Where an entry's sessions live: one gone from the list, its own.
    let store_of = |id: &str| {
        harnesses
            .find(id)
            .map_or_else(|| id.to_owned(), |h| h.sessions().to_owned())
    };
    let here = harness.sessions().to_owned();
    let divider = |how| (before.to_owned(), harness.id.clone(), how);
    if store_of(before) == here {
        if let (Some(from), Some(earlier)) = (&from_entry, &earlier)
            && let Err(error) = harness.take_session(from, earlier.session()).await
        {
            tracing::warn!(%error, "a moved session was not readied for its new account");
        }
        let arrived = Arrived {
            shown: false,
            history: None,
            divider: divider(Moved::Same),
        };
        return Ok((earlier, arrived));
    }
    let (thread, turn_id, message) = (turn.thread, turn.id, turn.message);
    let (mut sessions, items, ran) = project
        .read(move |sql| {
            let sessions = store::sessions::<acp::Evidence>(sql, thread)?;
            let items = store::items(sql, thread)?;
            Ok((sessions, items, store::turns_ran(sql, thread, turn_id)?))
        })
        .await
        .map_err(unplanned)?;
    let items: Vec<_> = (items.into_iter())
        .filter(|item| item.id != message && item.turn != Some(turn_id))
        .collect();
    if let Some(had) = earlier {
        sessions.insert(store_of(had.harness()), had);
    }
    let back = sessions.remove(&here);
    let (history, how) = match &back {
        Some(_) => {
            // What came after this Harness's last turn.
            let last = (ran.iter().rev())
                .find(|(entry, _)| store_of(entry) == here)
                .and_then(|(_, item)| *item);
            let after = last
                .and_then(|last| items.iter().position(|item| item.id == last))
                .map_or(0, |at| at + 1);
            let missed = handoff::missed(thread, &from, &items[after..]);
            let handed = missed
                .as_ref()
                .map(|m| m.handed.clone())
                .unwrap_or_default();
            (missed.map(|m| m.text), Moved::Back { handed })
        }
        None => {
            let history = handoff::handoff(thread, &from, &items);
            let handed = history
                .as_ref()
                .map(|h| h.handed.clone())
                .unwrap_or_default();
            (history.map(|h| h.text), Moved::Handoff { handed })
        }
    };
    let now = back.clone();
    let arrived = Arrived {
        shown: false,
        history,
        divider: divider(how),
    };
    let pending = arrived.clone();
    project
        .write(move |tx| {
            store::set_sessions(tx.sql(), thread, now.as_ref(), &sessions)?;
            store::set_arrival(tx.sql(), thread, Some(&pending))
        })
        .await
        .map_err(unplanned)?;
    Ok((back, arrived))
}
