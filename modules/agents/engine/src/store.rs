//! The agents module's tables. Only this module writes them, and only
//! through these functions.

use crate::model::{
    Body, Failure, Image, ImageId, Item, ItemId, Offer, QuestionState, Settings, ThreadId,
    ThreadSummary, TurnId, TurnState, TurnView, Usage,
};
use bandaso_kernel::{AgentId, Error, Participant, Refusal};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::collections::HashSet;

pub const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE agents_threads (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    -- Who started it, as JSON.
    author TEXT NOT NULL,
    title TEXT NOT NULL,
    -- The Harness's session as JSON: evidence, not identity (ADR 0002,
    -- decision 7).
    evidence TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX agents_threads_by_agent ON agents_threads (agent, updated_at);

CREATE TABLE agents_turns (
    id TEXT PRIMARY KEY,
    thread TEXT NOT NULL REFERENCES agents_threads (id),
    agent TEXT NOT NULL,
    -- Who asked for it, as JSON.
    author TEXT NOT NULL,
    -- The message that asked for this turn.
    message TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX agents_turns_by_thread ON agents_turns (thread, created_at);

CREATE TABLE agents_items (
    id TEXT PRIMARY KEY,
    thread TEXT NOT NULL REFERENCES agents_threads (id),
    turn TEXT,
    author TEXT NOT NULL,
    at INTEGER NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX agents_items_by_thread ON agents_items (thread);
"#,
    r#"
-- What kind of failure ended the turn, as JSON.
ALTER TABLE agents_turns ADD COLUMN failure TEXT;
"#,
    r#"
-- What the Thread runs with, and what its Harness last offered, as JSON;
-- and what each turn was sent with. Threads from before ran in their
-- Harness's own mode and asked a Person, so they stay Supervised.
ALTER TABLE agents_threads ADD COLUMN settings TEXT;
ALTER TABLE agents_threads ADD COLUMN offer TEXT;
ALTER TABLE agents_turns ADD COLUMN settings TEXT;
UPDATE agents_threads SET settings = '{"mode":"supervised"}';
"#,
    r#"
-- How full the Agent's context in the Thread is, as JSON.
ALTER TABLE agents_threads ADD COLUMN usage TEXT;
"#,
    r#"
-- The images messages carry; their bytes are files in .bandaso/images/.
-- One is added before its message is sent, and belongs to that message
-- once it is.
CREATE TABLE agents_images (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    name TEXT,
    size INTEGER NOT NULL,
    -- Who added it, as JSON.
    author TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    item TEXT REFERENCES agents_items (id)
);
CREATE INDEX agents_images_by_item ON agents_images (item);
"#,
    r#"
-- The Thread's queue waits for a Person: a stop or a restart held it.
ALTER TABLE agents_threads ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
"#,
];

fn json<T: Serialize>(value: &T) -> Result<String, Error> {
    Ok(serde_json::to_string(value)?)
}

fn unreadable(index: usize, error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error))
}

fn column<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|e| unreadable(index, e))
}

/// A turn state as its table keeps it: the same word as on the wire.
fn state_word(state: TurnState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn state_of(row: &Row<'_>, index: usize) -> rusqlite::Result<TurnState> {
    let word: String = row.get(index)?;
    serde_json::from_value(serde_json::Value::String(word)).map_err(|e| unreadable(index, e))
}

pub fn insert_thread(
    sql: &Connection,
    thread: &ThreadSummary,
    author: Participant,
    settings: &Settings,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_threads (id, agent, author, title, settings, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            thread.id,
            thread.agent,
            json(&author)?,
            thread.title,
            json(settings)?,
            thread.updated_at
        ],
    )?;
    Ok(())
}

/// A JSON column of a Thread; its default where it holds nothing.
fn thread_json<T: DeserializeOwned + Default>(
    sql: &Connection,
    thread: ThreadId,
    column: &str,
) -> Result<T, Error> {
    let text: Option<String> = sql
        .query_row(
            &format!("SELECT {column} FROM agents_threads WHERE id = ?1"),
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(match text {
        Some(text) => serde_json::from_str(&text)?,
        None => T::default(),
    })
}

fn set_thread_json<T: Serialize>(
    sql: &Connection,
    thread: ThreadId,
    column: &str,
    value: &T,
) -> Result<(), Error> {
    sql.execute(
        &format!("UPDATE agents_threads SET {column} = ?2 WHERE id = ?1"),
        params![thread, json(value)?],
    )?;
    Ok(())
}

pub fn settings(sql: &Connection, thread: ThreadId) -> Result<Settings, Error> {
    thread_json(sql, thread, "settings")
}

pub fn set_settings(sql: &Connection, thread: ThreadId, settings: &Settings) -> Result<(), Error> {
    set_thread_json(sql, thread, "settings", settings)
}

pub fn offer(sql: &Connection, thread: ThreadId) -> Result<Offer, Error> {
    thread_json(sql, thread, "offer")
}

pub fn set_offer(sql: &Connection, thread: ThreadId, offer: &Offer) -> Result<(), Error> {
    set_thread_json(sql, thread, "offer", offer)
}

pub fn usage(sql: &Connection, thread: ThreadId) -> Result<Option<Usage>, Error> {
    thread_json(sql, thread, "usage")
}

pub fn set_usage(sql: &Connection, thread: ThreadId, usage: &Usage) -> Result<(), Error> {
    set_thread_json(sql, thread, "usage", usage)
}

/// What a Harness last offered in a Thread of `agent`.
pub fn latest_offer(sql: &Connection, agent: AgentId) -> Result<Option<Offer>, Error> {
    let text: Option<String> = sql
        .query_row(
            "SELECT offer FROM agents_threads WHERE agent = ?1 AND offer IS NOT NULL
             ORDER BY updated_at DESC, id DESC LIMIT 1",
            params![agent],
            |row| row.get(0),
        )
        .optional()?;
    Ok(text.map(|text| serde_json::from_str(&text)).transpose()?)
}

/// Keeps what an image a message will carry is, and who added it.
pub fn attach_image(
    sql: &Connection,
    image: &Image,
    author: Participant,
    at: i64,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_images (id, mime, name, size, author, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            image.id,
            image.mime,
            image.name,
            image.size,
            json(&author)?,
            at
        ],
    )?;
    Ok(())
}

/// Lets go of the images added before `before` that no message carried,
/// and answers which they were.
pub fn drop_unsent_images(sql: &Connection, before: i64) -> Result<Vec<ImageId>, Error> {
    let mut dropped =
        sql.prepare("DELETE FROM agents_images WHERE item IS NULL AND added_at < ?1 RETURNING id")?;
    let ids = dropped.query_map(params![before], |row| row.get(0))?;
    Ok(ids.collect::<Result<_, _>>()?)
}

/// Every image the Space keeps.
pub fn image_ids(sql: &Connection) -> Result<HashSet<ImageId>, Error> {
    let mut all = sql.prepare("SELECT id FROM agents_images")?;
    let ids = all.query_map([], |row| row.get(0))?;
    Ok(ids.collect::<Result<_, _>>()?)
}

/// The images `author` added for a message and no message carries yet, in
/// the order given.
pub fn unsent_images(
    sql: &Connection,
    ids: &[ImageId],
    author: Participant,
) -> Result<Vec<Image>, Error> {
    let mut images = Vec::with_capacity(ids.len());
    for id in ids {
        let found = sql
            .query_row(
                "SELECT mime, name, size, author, item FROM agents_images WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        Image {
                            id: *id,
                            mime: row.get(0)?,
                            name: row.get(1)?,
                            size: row.get(2)?,
                        },
                        column::<Participant>(row, 3)?,
                        row.get::<_, Option<ItemId>>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((image, added_by, carried)) = found else {
            return Err(
                Refusal::not_found("An image this message carries is gone. Add it again.").into(),
            );
        };
        if added_by != author || carried.is_some() {
            return Err(Refusal::invalid("This message cannot carry that image.").into());
        }
        images.push(image);
    }
    Ok(images)
}

/// Gives `item` its images.
pub fn carry_images(sql: &Connection, images: &[Image], item: ItemId) -> Result<(), Error> {
    for image in images {
        sql.execute(
            "UPDATE agents_images SET item = ?2 WHERE id = ?1",
            params![image.id, item],
        )?;
    }
    Ok(())
}

/// An image's kind, if the Space keeps it.
pub fn image_kind(sql: &Connection, id: ImageId) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT mime FROM agents_images WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?)
}

/// Whether the Thread's queue waits for a Person.
pub fn held(sql: &Connection, thread: ThreadId) -> Result<bool, Error> {
    Ok(sql
        .query_row(
            "SELECT held FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

pub fn set_held(sql: &Connection, thread: ThreadId, held: bool) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET held = ?2 WHERE id = ?1",
        params![thread, held],
    )?;
    Ok(())
}

pub fn touch_thread(sql: &Connection, thread: ThreadId, at: i64) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET updated_at = ?2 WHERE id = ?1",
        params![thread, at],
    )?;
    Ok(())
}

pub fn set_evidence(
    sql: &Connection,
    thread: ThreadId,
    evidence: &impl Serialize,
) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET evidence = ?2 WHERE id = ?1",
        params![thread, json(evidence)?],
    )?;
    Ok(())
}

/// The Harness's session the Thread had, if it had one.
pub fn evidence<T: DeserializeOwned>(
    sql: &Connection,
    thread: ThreadId,
) -> Result<Option<T>, Error> {
    let text: Option<String> = sql
        .query_row(
            "SELECT evidence FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    // Evidence a newer engine wrote in another shape is no evidence.
    Ok(text.and_then(|text| serde_json::from_str(&text).ok()))
}

const THREAD: &str = "SELECT id, agent, title, updated_at FROM agents_threads";

fn read_thread(row: &Row<'_>) -> rusqlite::Result<ThreadSummary> {
    Ok(ThreadSummary {
        id: row.get(0)?,
        agent: row.get(1)?,
        title: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

pub fn thread(sql: &Connection, id: ThreadId) -> Result<Option<ThreadSummary>, Error> {
    Ok(sql
        .query_row(&format!("{THREAD} WHERE id = ?1"), params![id], read_thread)
        .optional()?)
}

/// The Threads of one Agent, or of every Agent, the latest first.
pub fn threads(sql: &Connection, agent: Option<AgentId>) -> Result<Vec<ThreadSummary>, Error> {
    let mut statement = sql.prepare(&format!(
        "{THREAD} WHERE ?1 IS NULL OR agent = ?1 ORDER BY updated_at DESC, id DESC"
    ))?;
    let rows = statement.query_map(params![agent], read_thread)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// One turn, with what running it needs.
pub struct Turn {
    pub id: TurnId,
    pub thread: ThreadId,
    pub agent: AgentId,
    pub message: ItemId,
    pub state: TurnState,
}

/// A turn, with the settings it runs with: its Thread's when it was sent.
pub fn insert_turn(
    sql: &Connection,
    turn: &Turn,
    author: Participant,
    at: i64,
    settings: &Settings,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_turns (id, thread, agent, author, message, state, settings, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            turn.id,
            turn.thread,
            turn.agent,
            json(&author)?,
            turn.message,
            state_word(turn.state),
            json(settings)?,
            at
        ],
    )?;
    Ok(())
}

/// What a turn runs with; a turn from before turns kept it runs with its
/// Thread's.
pub fn turn_settings(sql: &Connection, turn: &Turn) -> Result<Settings, Error> {
    let text: Option<String> = sql.query_row(
        "SELECT settings FROM agents_turns WHERE id = ?1",
        params![turn.id],
        |row| row.get(0),
    )?;
    match text {
        Some(text) => Ok(serde_json::from_str(&text)?),
        None => settings(sql, turn.thread),
    }
}

const TURN: &str = "SELECT id, thread, agent, message, state FROM agents_turns";

fn read_turn(row: &Row<'_>) -> rusqlite::Result<Turn> {
    Ok(Turn {
        id: row.get(0)?,
        thread: row.get(1)?,
        agent: row.get(2)?,
        message: row.get(3)?,
        state: state_of(row, 4)?,
    })
}

pub fn turn(sql: &Connection, id: TurnId) -> Result<Option<Turn>, Error> {
    Ok(sql
        .query_row(&format!("{TURN} WHERE id = ?1"), params![id], read_turn)
        .optional()?)
}

/// The Thread's turns in `state`, in the order they were sent.
pub fn turns_in(sql: &Connection, thread: ThreadId, state: TurnState) -> Result<Vec<Turn>, Error> {
    let mut statement = sql.prepare(&format!(
        "{TURN} WHERE thread = ?1 AND state = ?2 ORDER BY created_at, id"
    ))?;
    let rows = statement.query_map(params![thread, state_word(state)], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every Thread's turns that run.
pub fn every_running(sql: &Connection) -> Result<Vec<Turn>, Error> {
    let mut statement = sql.prepare(&format!("{TURN} WHERE state = ?1"))?;
    let rows = statement.query_map(params![state_word(TurnState::Running)], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Thread's turn that runs, if one does.
pub fn running(sql: &Connection, thread: ThreadId) -> Result<Option<Turn>, Error> {
    Ok(turns_in(sql, thread, TurnState::Running)?.pop())
}

/// The turns that ran or will run `message`, the first first. A turn a
/// Person took back never ran it.
pub fn turns_of(sql: &Connection, message: ItemId) -> Result<Vec<Turn>, Error> {
    let mut statement = sql.prepare(&format!(
        "{TURN} WHERE message = ?1 AND state != ?2 ORDER BY created_at, id"
    ))?;
    let withdrawn = state_word(TurnState::Withdrawn);
    let rows = statement.query_map(params![message, withdrawn], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn set_turn(
    sql: &Connection,
    turn: TurnId,
    state: TurnState,
    reason: Option<&str>,
    failure: Option<Failure>,
) -> Result<(), Error> {
    let failure = failure.as_ref().map(json).transpose()?;
    sql.execute(
        "UPDATE agents_turns SET state = ?2, reason = ?3, failure = ?4 WHERE id = ?1",
        params![turn, state_word(state), reason, failure],
    )?;
    Ok(())
}

/// The Thread's latest turn that began: one that waits, or that a Person
/// took back, never did.
pub fn last_begun(sql: &Connection, thread: ThreadId) -> Result<Option<TurnId>, Error> {
    Ok(sql
        .query_row(
            "SELECT id FROM agents_turns WHERE thread = ?1 AND state NOT IN (?2, ?3)
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![
                thread,
                state_word(TurnState::Queued),
                state_word(TurnState::Withdrawn)
            ],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn turns(sql: &Connection, thread: ThreadId) -> Result<Vec<TurnView>, Error> {
    let mut statement = sql.prepare(
        "SELECT id, message, state, reason, failure FROM agents_turns
         WHERE thread = ?1 ORDER BY created_at, id",
    )?;
    let rows = statement.query_map(params![thread], |row| {
        let failure: Option<String> = row.get(4)?;
        Ok(TurnView {
            id: row.get(0)?,
            message: row.get(1)?,
            state: state_of(row, 2)?,
            reason: row.get(3)?,
            failure: failure
                .map(|text| serde_json::from_str(&text).map_err(|e| unreadable(4, e)))
                .transpose()?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn insert_item(sql: &Connection, thread: ThreadId, item: &Item) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_items (id, thread, turn, author, at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            item.id,
            thread,
            item.turn,
            json(&item.author)?,
            item.at,
            json(&item.body)?
        ],
    )?;
    Ok(())
}

const ITEM: &str = "SELECT id, turn, author, at, body, thread FROM agents_items";

fn read_item(row: &Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get(0)?,
        turn: row.get(1)?,
        author: column(row, 2)?,
        at: row.get(3)?,
        body: column(row, 4)?,
    })
}

/// One item and its Thread.
pub fn item(sql: &Connection, id: ItemId) -> Result<Option<(ThreadId, Item)>, Error> {
    Ok(sql
        .query_row(&format!("{ITEM} WHERE id = ?1"), params![id], |row| {
            Ok((row.get(5)?, read_item(row)?))
        })
        .optional()?)
}

/// Which turn an item belongs to, if any.
pub fn set_item_turn(sql: &Connection, id: ItemId, turn: Option<TurnId>) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_items SET turn = ?2 WHERE id = ?1",
        params![id, turn],
    )?;
    Ok(())
}

/// Moves an item after every other: the Thread shows it there now.
pub fn move_last(sql: &Connection, id: ItemId) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_items SET rowid = (SELECT MAX(rowid) + 1 FROM agents_items) WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn set_body(sql: &Connection, id: ItemId, body: &Body) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_items SET body = ?2 WHERE id = ?1",
        params![id, json(body)?],
    )?;
    Ok(())
}

/// Writes an item the Agent sends. A reply or a thought comes in pieces:
/// a piece of an item that is already written adds its text to it.
pub fn put(sql: &Connection, thread: ThreadId, item: &Item) -> Result<(), Error> {
    let Some((_, mut stored)) = self::item(sql, item.id)? else {
        return insert_item(sql, thread, item);
    };
    match (&mut stored.body, &item.body) {
        (Body::Message { text, .. }, Body::Message { text: more, .. })
        | (Body::Thought { text }, Body::Thought { text: more }) => text.push_str(more),
        _ => return Err(Refusal::conflict(format!("Item {} is written already.", item.id)).into()),
    }
    set_body(sql, item.id, &stored.body)
}

/// A Thread's items, in the order they came.
pub fn items(sql: &Connection, thread: ThreadId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!("{ITEM} WHERE thread = ?1 ORDER BY rowid"))?;
    let rows = statement.query_map(params![thread], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Questions of a turn that still wait for an answer.
pub fn open_questions(sql: &Connection, turn: TurnId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE turn = ?1 AND json_extract(body, '$.kind') = 'question'
           AND json_extract(body, '$.state') = ?2 ORDER BY rowid"
    ))?;
    let open = json(&QuestionState::Open)?;
    let rows = statement.query_map(params![turn, open.trim_matches('"')], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Agent a Thread belongs to.
pub fn agent_of(sql: &Connection, thread: ThreadId) -> Result<Option<AgentId>, Error> {
    Ok(sql
        .query_row(
            "SELECT agent FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?)
}
