//! A Thread's title is its Person's (ADR 0077). `agents.rename` names a
//! Thread, and nothing else does: not the engine as the work moves on,
//! and not its Agent. `agents.suggest_title` asks the Thread's Harness for
//! a name in a short run apart from the Thread ([`crate::aside`]), on its
//! small model, in an empty folder of the engine's ([`folder`]), and
//! renames nothing: the window does, with what comes back.
//!
//! Once, as a Thread's first turn ends done, the engine names it with
//! what the small model suggests, quietly, unless its Person renamed it
//! before (ADR 0118): [`after_first`] queues it, [`auto`] writes it.

use crate::images::blocking;
use crate::model::{Fact, Settings, ThreadId, TurnState};
use crate::rules::{message, title};
use crate::{emit, store};
use banda_kernel::{Error, Participant, Refusal, Tx};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The effect that names a Thread after its first turn (ADR 0118).
pub const AUTO: &str = "thread.title";

/// What [`AUTO`] names.
#[derive(Serialize, Deserialize)]
pub struct AutoTitle {
    pub thread: ThreadId,
}

/// Queues [`AUTO`] for `thread` as its first turn ends done, once: none
/// for a Thread its Person renamed, nor after a later turn. Its key is
/// its own, so the Thread's next turn does not wait for it.
pub fn after_first(tx: &mut Tx<'_>, thread: ThreadId) -> Result<(), Error> {
    let Some(summary) = store::thread(tx.sql(), thread)? else {
        return Ok(());
    };
    let done = store::turns(tx.sql(), thread)?
        .iter()
        .filter(|turn| turn.state == TurnState::Done)
        .count();
    if summary.was.is_some() || done != 1 {
        return Ok(());
    }
    tx.enqueue(AUTO, &format!("title:{thread}"), &AutoTitle { thread })
}

/// Names `thread` `title`, for its Person, unless it was renamed since
/// its first turn ended: a title the Person gave is never taken over.
pub fn auto(
    tx: &mut Tx<'_>,
    person: Participant,
    thread: ThreadId,
    title: String,
) -> Result<(), Error> {
    let Some(summary) = store::thread(tx.sql(), thread)? else {
        return Ok(());
    };
    if summary.was.is_some() || summary.title == title {
        return Ok(());
    }
    store::rename(tx.sql(), thread, &title, &summary.title)?;
    let was = summary.title;
    emit(
        tx,
        person,
        thread,
        &Fact::ThreadRenamed { thread, title, was },
    )
}

/// Renames `thread` to `title`, or, with none or a blank one, to its
/// first message's title again. A title it has already writes nothing.
/// Only a Person renames a Thread.
pub fn rename(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    title: Option<String>,
) -> Result<(), Error> {
    if author.agent().is_some() {
        return Err(Refusal::forbidden("Only a Person renames a Thread.").into());
    }
    let named = title::named(title.as_deref())?;
    let (was, agent) = store::title_and_agent(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let title = match named {
        Some(title) => title,
        None => {
            let (text, images) = store::first_message(tx.sql(), thread, agent)?
                .ok_or_else(|| Refusal::conflict("This Thread has no message to name it by."))?;
            message::title(&text, &images)
        }
    };
    if title == was {
        return Ok(());
    }
    store::rename(tx.sql(), thread, &title, &was)?;
    emit(
        tx,
        author,
        thread,
        &Fact::ThreadRenamed { thread, title, was },
    )
}

/// What a title for `thread` is asked of: its Harness, its settings, and
/// the prompt, from what the Thread says lately; none for no such Thread.
pub fn asking(
    sql: &rusqlite::Connection,
    thread: ThreadId,
) -> Result<Option<(String, Settings, String)>, Error> {
    let Some(summary) = store::thread(sql, thread)? else {
        return Ok(None);
    };
    let Some(agent) = store::agent_of(sql, thread)? else {
        return Ok(None);
    };
    let messages = store::latest_messages(sql, thread, agent, title::MESSAGES)?;
    let reply = store::latest_reply(sql, thread, agent)?;
    let plan = store::latest_plan(sql, thread)?;
    let prompt = title::prompt(&messages, reply.as_deref(), &plan, &summary.title);
    Ok(Some((
        summary.harness,
        store::settings(sql, thread)?,
        prompt,
    )))
}

/// The folder a title is written in, made if need be: one of its own in
/// the Project's data, never the Project's folder, so a Harness reads nothing
/// of the Project's there, as Claude Code reads its `CLAUDE.md`. The
/// prompt holds all the run needs.
pub async fn folder(data: &Path) -> std::io::Result<PathBuf> {
    let folder = data.join("titles");
    let made = folder.clone();
    blocking(move || std::fs::create_dir_all(made)).await?;
    Ok(folder)
}
