//! The one writer of a turn's life (ADR 0018, decision 2). A turn is made
//! here, whoever opens it, and every move of one goes through [`apply`],
//! whoever asks: a Person's command, the outbox, or the Harness between
//! turns. It reads what the engine knows of the turn, asks
//! [`rules::next`], and writes the [`Step`] in the caller's transaction:
//! the turn's state, its facts, the hold, and what the step sets going.
//!
//! A move `next` refuses writes nothing, and comes back as the inner
//! `Err`: a command hands it to the Person; the outbox and the Harness
//! [`tell`] the turn, since a late ending of a turn that ended changes
//! nothing.

use crate::effects::{START, STOP, TurnEffect};
use crate::model::{Fact, ItemId, Opener, Settings, ThreadId, TurnId, TurnState};
use crate::rules::{self, Ending, Event, Step, Then, TurnFacts};
use crate::{emit, questions, store};
use banda_kernel::{AgentId, Error, Participant, Refusal, Tx};
use rusqlite::Connection;

/// The kind of [`Fact::TurnEnded`]: what waits for a turn to be written
/// as ended follows it (`ModuleSpace::committed`).
pub const ENDED: &str = "turn.ended";

/// Makes `turn`, new and waiting, and gives it `event`: [`Event::Queue`]
/// for one the outbox starts, [`Event::Open`] for one the Agent opens by
/// itself. The Thread hears of it by `posted`, a message's fact that
/// queues it too, or else by [`Fact::TurnQueued`]. It runs with the
/// settings its Thread has now, which it answers. A refusal comes back as
/// [`Error::Refused`], so the caller's transaction writes nothing.
pub fn make(
    tx: &mut Tx<'_>,
    author: Participant,
    turn: &store::Turn,
    event: Event,
    posted: Option<Fact>,
) -> Result<(Settings, Step), Error> {
    debug_assert_eq!(turn.state, TurnState::Queued, "a turn is made waiting");
    let step = rules::next(&known(tx.sql(), turn)?, event)?;
    let now = tx.now();
    let settings = store::settings(tx.sql(), turn.thread)?;
    store::insert_turn(tx.sql(), turn, author, now, &settings)?;
    store::touch_thread(tx.sql(), turn.thread, now)?;
    let posted = posted.unwrap_or(Fact::TurnQueued {
        turn: turn.id,
        message: turn.message,
    });
    emit(tx, author, turn.thread, &posted)?;
    write(tx, author, turn, TurnState::Queued, &step)?;
    Ok((settings, step))
}

/// A new turn for `message`, opened by `opener` (from `from_thread`, for
/// another Thread's Agent), which waits behind the Thread's earlier turns.
pub fn queue(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    agent: AgentId,
    message: ItemId,
    opener: Opener,
    from_thread: Option<ThreadId>,
) -> Result<TurnId, Error> {
    let turn = store::Turn {
        id: TurnId::new(),
        thread,
        agent,
        message,
        state: TurnState::Queued,
        opener,
        from_thread,
        stopping: false,
    };
    make(tx, author, &turn, Event::Queue, None)?;
    Ok(turn.id)
}

/// Gives `event` to `turn`, as the database has it now: what `author`
/// brought about is written, or nothing is, when [`rules::next`] refuses.
pub fn apply(
    tx: &mut Tx<'_>,
    author: Participant,
    turn: &store::Turn,
    event: Event,
) -> Result<Result<Step, Refusal>, Error> {
    let known = known(tx.sql(), turn)?;
    let step = match rules::next(&known, event) {
        Ok(step) => step,
        Err(refused) => return Ok(Err(refused)),
    };
    write(tx, author, turn, known.state, &step)?;
    Ok(Ok(step))
}

/// Tells `turn` what happened, as the outbox and the Harness do: an event
/// that comes too late, as an ending of a turn that ended, changes
/// nothing.
pub fn tell(
    tx: &mut Tx<'_>,
    author: Participant,
    turn: &store::Turn,
    event: Event,
) -> Result<(), Error> {
    apply(tx, author, turn, event).map(drop)
}

/// Whether [`rules::next`] takes `event` for `turn` now; nothing is
/// written.
pub fn takes(sql: &Connection, turn: &store::Turn, event: Event) -> Result<bool, Error> {
    Ok(rules::next(&known(sql, turn)?, event).is_ok())
}

/// What the rules know of `turn` among its Thread's turns now.
fn known(sql: &Connection, turn: &store::Turn) -> Result<TurnFacts, Error> {
    let held = store::held(sql, turn.thread)?;
    let turns = store::turns(sql, turn.thread)?;
    let openers = store::openers(sql, turn.thread)?;
    // Read anew: the turn a caller holds may be as it was when it began.
    let stopping = store::turn(sql, turn.id)?.is_some_and(|now| now.stopping);
    Ok(rules::known(
        &turns,
        &openers,
        held,
        turn.id,
        turn.opener,
        stopping,
    ))
}

/// Writes `step`, which moves `turn` from `was`.
fn write(
    tx: &mut Tx<'_>,
    author: Participant,
    turn: &store::Turn,
    was: TurnState,
    step: &Step,
) -> Result<(), Error> {
    if step.held {
        hold(tx, author, turn.thread)?;
    }
    // The Agent's own turn ends before this one runs: a Thread runs one.
    if step.then == Some(Then::HandOver)
        && let Some(own) = store::running(tx.sql(), turn.thread)?
    {
        let done = Event::End(Ending::new(TurnState::Done, None));
        apply(tx, Participant::Agent(own.agent), &own, done)??;
    }
    match &step.ending {
        Some(ending) => end(tx, author, turn, ending)?,
        None if (was, step.state) == (TurnState::Queued, TurnState::Running) => {
            store::set_turn(tx.sql(), turn.id, step.state, None, None, tx.now())?;
            emit(
                tx,
                author,
                turn.thread,
                &Fact::TurnStarted { turn: turn.id },
            )?;
        }
        None => {}
    }
    match step.then {
        Some(Then::Start) => start_later(tx, turn.thread, turn.id)?,
        Some(Then::AskStop) => {
            store::set_stopping(tx.sql(), turn.id)?;
            let stop = TurnEffect { turn: turn.id };
            tx.enqueue(STOP, &turn.id.to_string(), &stop)?;
        }
        Some(Then::HandOver) | None => {}
    }
    Ok(())
}

/// The outbox starts `turn` after the Thread's turns queued before it.
fn start_later(tx: &mut Tx<'_>, thread: ThreadId, turn: TurnId) -> Result<(), Error> {
    tx.enqueue(START, &thread.to_string(), &TurnEffect { turn })
        .map(drop)
}

/// Ends a turn: its state, its Questions that never got an answer, the
/// fact that it ended, which `author` brought about, and the answer back
/// to the Thread that asked for it.
fn end(
    tx: &mut Tx<'_>,
    author: Participant,
    turn: &store::Turn,
    ending: &Ending,
) -> Result<(), Error> {
    let Ending {
        state,
        reason,
        failure,
    } = ending.clone();
    questions::close_unanswered(tx, author, turn.thread, turn.id)?;
    store::set_turn(
        tx.sql(),
        turn.id,
        state,
        reason.as_deref(),
        failure,
        tx.now(),
    )?;
    store::touch_thread(tx.sql(), turn.thread, tx.now())?;
    let ended = Fact::TurnEnded {
        turn: turn.id,
        state,
        reason: reason.clone(),
        failure,
        note: store::note(tx.sql(), turn.id)?,
    };
    emit(tx, author, turn.thread, &ended)?;
    // The answer goes back by itself, as a message from this Thread's
    // Agent, and waits its turn there (ADR 0019), unless that Thread is
    // gone.
    if let Some(asking) = turn.answers()
        && store::thread(tx.sql(), asking)?.is_some()
    {
        let reply = store::last_reply(tx.sql(), turn.thread, turn.id, turn.agent)?;
        let message = crate::Message {
            text: rules::to_thread::answer_of(state, reason.as_deref(), reply),
            images: Vec::new(),
        };
        let (agent, target) = (
            Participant::Agent(turn.agent),
            crate::Target::Thread(asking),
        );
        let by = Some((Opener::Answered, turn.thread));
        crate::send(tx, agent, target, message, None, false, by)?;
    }
    Ok(())
}

/// Holds the Thread's queue: its waiting turns start once a Person lets
/// it go.
fn hold(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    held_to(tx, author, thread, true).map(drop)
}

/// Lets a held queue go on: its waiting turns start in the order they were
/// sent, after any turn that was queued before.
pub fn resume(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    if !held_to(tx, author, thread, false)? {
        return Ok(());
    }
    for waiting in store::turns_in(tx.sql(), thread, TurnState::Queued)? {
        start_later(tx, thread, waiting.id)?;
    }
    Ok(())
}

/// Whether the Thread's queue was not `held` before.
fn held_to(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    held: bool,
) -> Result<bool, Error> {
    if store::held(tx.sql(), thread)? == held {
        return Ok(false);
    }
    store::set_held(tx.sql(), thread, held)?;
    emit(tx, author, thread, &Fact::ThreadHeld { thread, held })?;
    Ok(true)
}
