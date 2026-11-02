//! Running turns: each of the module's effects is here, and what the
//! Harness says while one runs is written by [`Transcript`]:
//!
//! - `turn.start`, keyed by the Thread, so a Thread's turns run one at a
//!   time and in order, while Threads run side by side: the outbox is each
//!   Thread's queue.
//! - `turn.stop`, keyed by the turn: it asks the Harness to stop.
//! - `question.reply`, keyed by the Question, so an answer never waits
//!   behind the turn that asked.
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

use crate::acp::{self, Connection, Opened, Prompt, PromptImage, Running, Session, Steered};
use crate::between;
use crate::images::Images;
use crate::kept;
use crate::live::Live;
use crate::model::{Body, Fact, Failure, Image, Item, ItemId, Opener, Settings, TurnId, TurnState};
use crate::rules::{self, Ending, Event};
use crate::settings::Harnesses;
use crate::transcript::{Transcript, notice, offered, used};
use crate::{emit, plain, store, writer};
use banda_kernel::{Effect, Error, ModuleSpace, Outcome, Participant, Settled, Tx};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

pub const START: &str = "turn.start";
pub const STOP: &str = "turn.stop";
pub const REPLY: &str = "question.reply";
pub const STEER: &str = "turn.steer";

/// How long a Harness may take to stop a turn that cannot go on.
const STOPPING: Duration = Duration::from_secs(10);
/// How long a message sent into a turn waits for the turn's Harness to
/// start and take its prompt, and how often it looks.
const BEGINNING: Duration = Duration::from_secs(acp::STARTING.as_secs() + acp::OPENING.as_secs());
pub(crate) const LOOK_AGAIN: Duration = Duration::from_millis(100);

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

#[derive(Serialize, Deserialize)]
pub struct ReplyEffect {
    pub item: ItemId,
    pub choice: String,
    /// What the Person filled in, for a form Question, but its secret
    /// fields: [`Live`] holds those.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<crate::model::Values>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secret: bool,
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
async fn notices(space: &ModuleSpace, turn: &store::Turn, texts: Vec<String>) -> Result<(), Error> {
    if texts.is_empty() {
        return Ok(());
    }
    let (thread, id, agent) = (turn.thread, turn.id, Participant::Agent(turn.agent));
    space
        .write(move |tx| {
            for text in texts {
                notice(tx, agent, thread, id, text)?;
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
        REPLY => {
            let reply: ReplyEffect = serde_json::from_value(effect.payload.clone())?;
            let Some((thread, mut item)) = store::item(tx.sql(), reply.item)? else {
                return Ok(());
            };
            if !rules::close(&mut item.body) {
                return Ok(());
            }
            store::set_body(tx.sql(), item.id, &item.body)?;
            let agent = store::agent_of(tx.sql(), thread)?;
            let author = agent.map_or(item.author, Participant::Agent);
            emit(tx, author, thread, &Fact::QuestionClosed { item: item.id })
        }
        _ => Ok(()),
    }
}

/// Hands a Person's answer to the Harness that waits for it.
pub fn reply(live: &Live, effect: &Effect) -> Outcome {
    let Ok(reply) = serde_json::from_value::<ReplyEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The answer could not be read.".to_owned());
    };
    let mut values = reply.values;
    if reply.secret {
        // Only memory held the secret: after a restart it is gone, and
        // so is the turn that asked.
        let Some(secret) = live.take_secret(reply.item) else {
            return Outcome::Fail("The turn that asked has ended.".to_owned());
        };
        values.get_or_insert_default().extend(secret);
    }
    if live.answer(reply.item, reply.choice, values) {
        Outcome::Done
    } else {
        Outcome::Fail("The turn that asked has ended.".to_owned())
    }
}

/// Asks the Harness to stop a running turn.
pub async fn stop(live: &Live, space: ModuleSpace, effect: &Effect) -> Outcome {
    let Ok(stop) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The stop could not be read.".to_owned());
    };
    let state = space
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

/// Runs one turn to its end, and writes how it ended.
pub async fn start(
    live: &Arc<Live>,
    harnesses: &Harnesses,
    space: ModuleSpace,
    effect: &Effect,
) -> Outcome {
    let Ok(start) = serde_json::from_value::<TurnEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The turn could not be read.".to_owned());
    };
    if let Err(error) = after_questions(live, &space, start.turn).await {
        return Outcome::Retry(error.to_string());
    }
    let begun = space
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
            let mut message = Message::read(tx.sql(), turn.message)?.unwrap_or(Message {
                text: String::new(),
                images: Vec::new(),
            });
            // Another Thread's Agent wrote it: the Harness reads which.
            if let Some(from) = turn.from_thread {
                let title = store::thread(tx.sql(), from)?.map(|t| t.title);
                let answers = turn.opener == Opener::Answered;
                let title = title.unwrap_or_default();
                message.text = rules::from_agent(answers, from, &title, &message.text);
            }
            let settings = store::turn_settings(tx.sql(), &turn)?;
            Ok(Some((turn, message, settings)))
        })
        .await;
    let (turn, message, settings) = match begun {
        Ok(Some(begun)) => begun,
        Ok(None) => return Outcome::Done,
        Err(error) => return Outcome::Retry(error.to_string()),
    };
    let ending = work(live, harnesses, &space, &turn, message, settings).await;
    // Stopped only if someone asked: the rules read that from the turn.
    live.end(turn.id);
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
async fn after_questions(live: &Live, space: &ModuleSpace, turn: TurnId) -> Result<(), Error> {
    let own = space
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
        while live.asking(own) {
            tokio::time::sleep(LOOK_AGAIN).await;
        }
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

/// What `message` sends `harness`, and what Banda tells the Person it
/// left out; why nothing of it can go, if nothing can.
async fn prompt_of(
    space: &ModuleSpace,
    harness: &str,
    running: &Running,
    Message { text, images }: Message,
) -> Result<(Prompt, Vec<String>), String> {
    let mut refused = Vec::new();
    let mut prompt = Prompt {
        text,
        command: None,
        images: Vec::new(),
    };
    if running.offer.no_images && !images.is_empty() {
        refused.push(rules::without_images(harness, &prompt.text)?);
        return Ok((as_skill(prompt, running), refused));
    }
    let files = Images::of(space.data());
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
    Ok((as_skill(prompt, running), refused))
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
pub async fn steer(live: &Live, space: ModuleSpace, effect: &Effect) -> Outcome {
    let Ok(SteerEffect { item, turn }) = serde_json::from_value(effect.payload.clone()) else {
        return Outcome::Fail("The message could not be read.".to_owned());
    };
    let found = space
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
    let Some((connection, session)) = begun(live, &space, &turn).await else {
        return requeued();
    };
    // A turn that is stopping takes nothing more.
    let id = turn.id;
    let takes = space
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
    if !connection.steers() {
        let text = format!(
            "{} cannot take a message while it works, so Banda stopped it to send yours.",
            connection.name()
        );
        let (thread, agent) = (turn.thread, Participant::Agent(turn.agent));
        let gave_way = space
            .write(move |tx| {
                let Some(now) = store::turn(tx.sql(), id)? else {
                    return Ok(());
                };
                if writer::apply(tx, agent, &now, Event::GiveWay)?.is_ok() {
                    notice(tx, agent, thread, id, text)?;
                }
                Ok(())
            })
            .await;
        if let Err(error) = gave_way {
            return Outcome::Retry(error.to_string());
        }
        return requeued();
    }
    let running = connection.running(&session);
    let Ok((prompt, refused)) = prompt_of(&space, connection.name(), &running, message).await
    else {
        return requeued();
    };
    if let Err(error) = notices(&space, &turn, refused).await {
        return Outcome::Retry(error.to_string());
    }
    // Marked first: what the Agent says of the message reads after it.
    live.mark_steered(turn.id);
    match connection.steer(&session, &prompt).await {
        Ok(Steered::Joined) => Outcome::Done,
        Ok(Steered::NotNow) => requeued(),
        Err(error) => {
            tracing::warn!(%error, "a message could not join its turn");
            requeued()
        }
    }
}

/// The Harness and session of a turn that runs, once its prompt reached
/// them, which takes a while for a Harness that starts; `None` when the
/// turn ended first, or never began.
async fn begun(
    live: &Live,
    space: &ModuleSpace,
    turn: &store::Turn,
) -> Option<(Arc<Connection>, Session)> {
    let given_up = Instant::now() + BEGINNING;
    let mut state = turn.state;
    loop {
        if state != TurnState::Running {
            return None;
        }
        if let Some(begun) = live.running(turn.id) {
            return Some(begun);
        }
        if Instant::now() >= given_up {
            return None;
        }
        tokio::time::sleep(LOOK_AGAIN).await;
        let id = turn.id;
        state = space
            .read(move |sql| Ok(store::turn(sql, id)?.map(|turn| turn.state)))
            .await
            .ok()
            .flatten()?;
    }
}

async fn work(
    live: &Arc<Live>,
    harnesses: &Harnesses,
    space: &ModuleSpace,
    turn: &store::Turn,
    message: Message,
    settings: Settings,
) -> Ending {
    match run(live, harnesses, space, turn, message, settings).await {
        Ok(ending) | Err(ending) => ending,
    }
}

async fn run(
    live: &Arc<Live>,
    harnesses: &Harnesses,
    space: &ModuleSpace,
    turn: &store::Turn,
    message: Message,
    settings: Settings,
) -> Result<Ending, Ending> {
    let unplanned = |reason: String| Ending::failed(reason, None);
    let thread = turn.thread;
    let harness_id = space
        .read(move |sql| store::thread(sql, thread))
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
        .connection(space.id(), &harness)
        .await
        .map_err(|reason| Ending::failed(reason, Some(Failure::HarnessStopped)))?;
    let earlier = space
        .read(move |sql| store::evidence(sql, thread))
        .await
        .map_err(|e| unplanned(plain(e)))?;
    // A session that opens reaches Banda with a pass of its own (ADR 0019).
    let banda = || live.banda(space, turn.agent);
    let (session, opened) = connection
        .session(
            thread,
            space.folder(),
            &[kept::folder(space.data())],
            earlier.as_ref(),
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
        space
            .write(move |tx| {
                store::set_evidence(tx.sql(), thread, &evidence)?;
                if lost {
                    notice(tx, agent, thread, id, afresh)?;
                }
                Ok(())
            })
            .await
            .map_err(|e| unplanned(plain(e)))?;
    }
    let (running, mut refused) = connection.settle(&session, &settings).await;
    let (prompt, left_out) = prompt_of(space, &harness.name, &running, message)
        .await
        .map_err(unplanned)?;
    refused.extend(left_out);
    let (id, agent, now) = (turn.id, Participant::Agent(turn.agent), running.clone());
    // What the Agent used, as it last said, between turns too.
    let usage = connection.usage(&session);
    space
        .write(move |tx| {
            offered(tx, agent, thread, &now)?;
            if let Some(usage) = usage {
                used(tx, agent, thread, usage)?;
            }
            for text in refused {
                notice(tx, agent, thread, id, text)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| unplanned(plain(e)))?;
    let (mut hear, mut done) = connection.prompt(&session, &prompt);
    live.begin(turn.id, connection.clone(), session.clone());
    // What the session says once the turn ends is the Agent's own.
    let listener = between::Listener {
        live: live.clone(),
        space: space.clone(),
        thread,
        agent: turn.agent,
        name,
        harness: harness.name.clone(),
    };
    listener.hear(&connection, &session);
    let mut transcript =
        Transcript::new(space.clone(), turn, harness.name.clone(), settings, running);
    if let Err(reason) = transcript.listen(live, &mut hear).await {
        // What the Harness says cannot be written: the turn stops and fails.
        let _ = connection.cancel(&session);
        if tokio::time::timeout(STOPPING, &mut done).await.is_err() {
            done.abort();
        }
        return Err(unplanned(reason));
    }
    let ending = done
        .await
        .unwrap_or_else(|_| unplanned("The turn's task ended.".to_owned()));
    // What it said while the turn began but heard nothing yet, such as
    // Claude Code's slash commands just after its session opened.
    // The turn ended as it did, whether or not this is written.
    let now = connection.running(&session);
    if let Err(error) = space
        .write(move |tx| offered(tx, agent, thread, &now))
        .await
    {
        tracing::warn!(%error, "what the Harness offers could not be written");
    }
    Ok(ending.resets(transcript.resets))
}
