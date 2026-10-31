//! The agents module's tables. Only this module writes them, and only
//! through these functions.

use crate::model::{
    Body, Item, ItemId, QuestionState, ThreadId, ThreadSummary, TurnId, TurnState, TurnView,
};
use bandaso_kernel::{AgentId, Error, Participant, Refusal};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

pub const MIGRATIONS: &[&str] = &[r#"
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
"#];

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
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_threads (id, agent, author, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![
            thread.id,
            thread.agent,
            json(&author)?,
            thread.title,
            thread.updated_at
        ],
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

pub fn insert_turn(
    sql: &Connection,
    turn: &Turn,
    author: Participant,
    at: i64,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_turns (id, thread, agent, author, message, state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            turn.id,
            turn.thread,
            turn.agent,
            json(&author)?,
            turn.message,
            state_word(turn.state),
            at
        ],
    )?;
    Ok(())
}

pub fn turn(sql: &Connection, id: TurnId) -> Result<Option<Turn>, Error> {
    Ok(sql
        .query_row(
            "SELECT id, thread, agent, message, state FROM agents_turns WHERE id = ?1",
            params![id],
            |row| {
                Ok(Turn {
                    id: row.get(0)?,
                    thread: row.get(1)?,
                    agent: row.get(2)?,
                    message: row.get(3)?,
                    state: state_of(row, 4)?,
                })
            },
        )
        .optional()?)
}

pub fn set_turn(
    sql: &Connection,
    turn: TurnId,
    state: TurnState,
    reason: Option<&str>,
) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_turns SET state = ?2, reason = ?3 WHERE id = ?1",
        params![turn, state_word(state), reason],
    )?;
    Ok(())
}

pub fn turns(sql: &Connection, thread: ThreadId) -> Result<Vec<TurnView>, Error> {
    let mut statement = sql.prepare(
        "SELECT id, message, state, reason FROM agents_turns
         WHERE thread = ?1 ORDER BY created_at, id",
    )?;
    let rows = statement.query_map(params![thread], |row| {
        Ok(TurnView {
            id: row.get(0)?,
            message: row.get(1)?,
            state: state_of(row, 2)?,
            reason: row.get(3)?,
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
        (Body::Message { text }, Body::Message { text: more })
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
