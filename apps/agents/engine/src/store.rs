//! The agents module's tables. Only this module writes them, and only
//! through these functions.

use crate::full_access::Chosen;
use crate::model::{
    Archived, Asking, Body, Failure, Image, ImageId, Item, ItemId, LISTED_MESSAGE, Later,
    LatestTurn, ListedThread, Offer, Opener, PlanStep, QuestionState, Settings, ThreadId,
    ThreadSummary, ToolContent, TurnId, TurnState, TurnView, Usage, VisualId,
};
use banda_kernel::{AgentId, Error, Participant, Refusal};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};

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
-- The images messages carry; their bytes are files in .banda/images/.
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
    r#"
-- A Thread names its Harness; the module fills it in for older Threads
-- from their Agents' files (ADR 0006).
ALTER TABLE agents_threads ADD COLUMN harness TEXT;
"#,
    r#"
-- When each turn began to run and when it ended, so a Thread can say how
-- long the Agent worked (ADR 0010, decision 4). Older turns have neither.
ALTER TABLE agents_turns ADD COLUMN started_at INTEGER;
ALTER TABLE agents_turns ADD COLUMN ended_at INTEGER;
"#,
    r#"
-- Who opened each turn (ADR 0018, decision 2). A turn from
-- before was the Agent's own when its message is a notice from Banda, and
-- its Person's otherwise.
ALTER TABLE agents_turns ADD COLUMN opener TEXT NOT NULL DEFAULT 'person';
UPDATE agents_turns SET opener = 'by_itself' WHERE message IN
    (SELECT id FROM agents_items WHERE json_extract(body, '$.kind') = 'notice');
"#,
    r#"
-- The other Thread of a turn another Thread's Agent opened (ADR 0019,
-- decision 4): the one that asked, for 'asked'; the one that answers, for
-- 'answered'. NULL for every other turn.
ALTER TABLE agents_turns ADD COLUMN from_thread TEXT;
"#,
    r#"
-- The ID the Harness gave each reply's message, which a fork of its
-- session goes to (ADR 0027).
ALTER TABLE agents_items ADD COLUMN harness_message TEXT;
"#,
    r#"
-- The Thread a Thread was forked from (ADR 0027, decision 3).
ALTER TABLE agents_threads ADD COLUMN forked_from TEXT;
"#,
    r#"
-- A Thread runs one turn at a time (ADR 0018, decision 2). A Thread that
-- ran two, as the Agent's own turn beside one the outbox ran, keeps the
-- latter, and the other was cut short.
UPDATE agents_turns
SET state = 'interrupted', reason = 'Banda stopped while the Agent worked.',
    ended_at = COALESCE(started_at, created_at)
WHERE state = 'running' AND id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY thread
            ORDER BY opener = 'by_itself', created_at DESC, id DESC
        ) AS kept
        FROM agents_turns WHERE state = 'running'
    ) WHERE kept = 1
);
CREATE UNIQUE INDEX agents_turns_one_running ON agents_turns (thread)
    WHERE state = 'running';
"#,
    r#"
-- A running turn was asked to stop: by a Person, or by Banda for a
-- message its Harness cannot take while it works (ADR 0018, decision 3).
ALTER TABLE agents_turns ADD COLUMN stopping INTEGER NOT NULL DEFAULT 0;
"#,
    r#"
-- What the turn's Agent tells its Person when it ends (ADR 0057).
ALTER TABLE agents_turns ADD COLUMN note TEXT;
"#,
    r#"
-- The notices another module posted for the Thread's Agent, as git's
-- after a commit from the Thread's card, and the message whose prompt
-- took them: NULL until one did, which sends them again in each of its
-- turns.
CREATE TABLE agents_notices (
    item TEXT PRIMARY KEY,
    thread TEXT NOT NULL,
    taken_by TEXT
);
CREATE INDEX agents_notices_untaken ON agents_notices (thread)
    WHERE taken_by IS NULL;
CREATE INDEX agents_notices_taken ON agents_notices (taken_by)
    WHERE taken_by IS NOT NULL;
"#,
    r#"
-- The Thread's latest snooze, as JSON (ADR 0074).
ALTER TABLE agents_threads ADD COLUMN snooze TEXT;
"#,
    r#"
-- The Thread's title before its Person last renamed it (ADR 0077).
ALTER TABLE agents_threads ADD COLUMN was_title TEXT;
"#,
    r#"
-- The Harness entry, the account, each turn ran on, kept as it starts
-- (ADR 0078, decision 2).
ALTER TABLE agents_turns ADD COLUMN harness TEXT;
"#,
    r#"
-- How a Thread's Full access was chosen (ADR 0083): 'fenced' where the
-- fence held whole, 'unfenced' by its Person where it did not. NULL for
-- any other mode, and for Full access from before the fence.
ALTER TABLE agents_threads ADD COLUMN full_access TEXT;
"#,
    r#"
-- When its Person archived the Thread, as JSON (ADR 0096): its host
-- keeps it beside the Later, as each window kept it before.
ALTER TABLE agents_threads ADD COLUMN archived TEXT;
"#,
    r#"
-- The latest ended turn of the Thread its Person saw (ADR 0096), beside
-- the archive; a rewind that takes that turn out clears it.
ALTER TABLE agents_threads ADD COLUMN seen TEXT;
-- When its Person last took a mark off the Thread by hand, unread or
-- unarchived: a window's old marks moved after leave it as they chose.
ALTER TABLE agents_threads ADD COLUMN cleared_at INTEGER;
"#,
    r#"
-- A snooze is called Later now (ADR 0098, decision 28).
ALTER TABLE agents_threads RENAME COLUMN snooze TO later;
"#,
    r#"
-- The sessions of each Harness the Thread ran on but its own now, by
-- where they live, as JSON: a Thread that goes back to one goes on with
-- it (ADR 0078, decision 5).
ALTER TABLE agents_threads ADD COLUMN sessions TEXT;
"#,
    r#"
-- A handoff is pending until its first ordinary prompt succeeds. A failed
-- attempt, a slash command or a restart must not consume its history.
ALTER TABLE agents_threads ADD COLUMN arrival TEXT;
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

/// A JSON column that may hold nothing.
fn maybe_column<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<T>> {
    let text: Option<String> = row.get(index)?;
    let value = text.map(|text| serde_json::from_str(&text));
    value.transpose().map_err(|e| unreadable(index, e))
}

/// A turn's state or opener as its table keeps it: the word serde gives.
fn word<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn word_of<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let word: String = row.get(index)?;
    serde_json::from_value(serde_json::Value::String(word)).map_err(|e| unreadable(index, e))
}

/// A new Thread, and the Agent at work in it: its own, and only one.
pub fn insert_thread(
    sql: &Connection,
    thread: &ThreadSummary,
    agent: AgentId,
    author: Participant,
    settings: &Settings,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_threads
         (id, agent, harness, author, title, settings, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            thread.id,
            agent,
            thread.harness,
            json(&author)?,
            thread.title,
            json(settings)?,
            thread.updated_at
        ],
    )?;
    Ok(())
}

/// Names the Harness of each older Thread whose Agent's file named one.
pub fn fill_harnesses(sql: &Connection, agents: &[(AgentId, String)]) -> Result<(), Error> {
    let mut statement =
        sql.prepare("UPDATE agents_threads SET harness = ?2 WHERE agent = ?1 AND harness IS NULL")?;
    for (agent, harness) in agents {
        statement.execute(params![agent, harness])?;
    }
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

/// The Thread's latest Later, asleep or woken (ADR 0074).
pub fn later(sql: &Connection, thread: ThreadId) -> Result<Option<Later>, Error> {
    thread_json(sql, thread, "later")
}

/// Each put-off Thread with a time that has yet to wake, with its time.
pub fn timed(sql: &Connection) -> Result<Vec<(ThreadId, i64)>, Error> {
    let mut statement = sql.prepare(
        "SELECT id, json_extract(later, '$.until') FROM agents_threads
         WHERE json_extract(later, '$.until') IS NOT NULL
           AND json_extract(later, '$.woke') IS NULL",
    )?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn set_later(sql: &Connection, thread: ThreadId, later: &Later) -> Result<(), Error> {
    set_thread_json(sql, thread, "later", later)
}

/// When its Person archived the Thread, unless it left Archive since
/// (ADR 0096).
pub fn archived(sql: &Connection, thread: ThreadId) -> Result<Option<Archived>, Error> {
    thread_json(sql, thread, "archived")
}

/// Marks the Thread archived, or with none, not. Its `updated_at` stays:
/// a mark moves it nowhere in a list.
pub fn set_archived(
    sql: &Connection,
    thread: ThreadId,
    archived: Option<Archived>,
) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET archived = ?2 WHERE id = ?1",
        params![thread, archived.as_ref().map(json).transpose()?],
    )?;
    Ok(())
}

/// The latest ended turn of the Thread its Person saw (ADR 0096).
pub fn seen(sql: &Connection, thread: ThreadId) -> Result<Option<TurnId>, Error> {
    Ok(sql
        .query_row(
            "SELECT seen FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten())
}

/// Marks the turn of the Thread its Person saw, or with none, that they
/// saw none. Its `updated_at` stays: a mark moves it nowhere in a list.
pub fn set_seen(sql: &Connection, thread: ThreadId, turn: Option<TurnId>) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET seen = ?2 WHERE id = ?1",
        params![thread, turn],
    )?;
    Ok(())
}

/// Whether its Person took a mark off the Thread by hand: what a window
/// kept of it before is theirs no longer (#853).
pub fn cleared(sql: &Connection, thread: ThreadId) -> Result<bool, Error> {
    Ok(sql
        .query_row(
            "SELECT cleared_at IS NOT NULL FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

/// Keeps that its Person took a mark off the Thread by hand, at `at`.
pub fn set_cleared(sql: &Connection, thread: ThreadId, at: i64) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET cleared_at = ?2 WHERE id = ?1",
        params![thread, at],
    )?;
    Ok(())
}

pub fn usage(sql: &Connection, thread: ThreadId) -> Result<Option<Usage>, Error> {
    thread_json(sql, thread, "usage")
}

pub fn set_usage(sql: &Connection, thread: ThreadId, usage: &Usage) -> Result<(), Error> {
    set_thread_json(sql, thread, "usage", usage)
}

/// What a Harness last offered, in any Thread of the Project.
pub fn latest_offer(sql: &Connection, harness: &str) -> Result<Option<Offer>, Error> {
    let text: Option<String> = sql
        .query_row(
            "SELECT offer FROM agents_threads WHERE harness = ?1 AND offer IS NOT NULL
             ORDER BY updated_at DESC, id DESC LIMIT 1",
            params![harness],
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
    let mut dropped = sql.prepare(
        "DELETE FROM agents_images WHERE item IS NULL AND added_at < ?1
         AND NOT EXISTS (
           SELECT 1 FROM agents_items, json_each(agents_items.body, '$.images') AS image
           WHERE json_extract(image.value, '$.id') = agents_images.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM agents_items, json_each(agents_items.body, '$.content') AS part
           WHERE json_extract(part.value, '$.kind') = 'image'
             AND json_extract(part.value, '$.image.id') = agents_images.id
         ) RETURNING id",
    )?;
    let ids = dropped.query_map(params![before], |row| row.get(0))?;
    Ok(ids.collect::<Result<_, _>>()?)
}

/// Every image the Project keeps.
pub fn image_ids(sql: &Connection) -> Result<HashSet<ImageId>, Error> {
    let mut all = sql.prepare("SELECT id FROM agents_images")?;
    let ids = all.query_map([], |row| row.get(0))?;
    Ok(ids.collect::<Result<_, _>>()?)
}

/// Every Visual an item of the Project names (ADR 0037).
pub fn visual_ids(sql: &Connection) -> Result<HashSet<VisualId>, Error> {
    let mut named = sql.prepare(
        "SELECT json_extract(body, '$.visual') FROM agents_items \
         WHERE json_extract(body, '$.kind') = 'visual'",
    )?;
    let ids = named.query_map([], |row| row.get(0))?;
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

/// Keep tool images in the same ledger as message images, linked to the
/// tool item so ordinary attachment sweeps do not remove them.
pub fn tool_images(
    sql: &Connection,
    content: &[ToolContent],
    item: ItemId,
    author: Participant,
    at: i64,
) -> Result<(), Error> {
    // A content update replaces the previous result. Its images wait a
    // day like unused attachments; references in surviving forks protect
    // them during the sweep.
    sql.execute(
        "UPDATE agents_images SET item = NULL, added_at = ?2 WHERE item = ?1",
        params![item, at],
    )?;
    for part in content {
        if let ToolContent::Image { image } = part {
            attach_image(sql, image, author, at)?;
            carry_images(sql, std::slice::from_ref(image), item)?;
        }
    }
    Ok(())
}

/// An image's kind, if the Project keeps it.
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

/// A Thread's summary, then its Agent.
const THREAD: &str = "SELECT id, COALESCE(harness, ''), title, updated_at, was_title, agent
    FROM agents_threads";

fn read_thread(row: &Row<'_>) -> rusqlite::Result<ThreadSummary> {
    Ok(ThreadSummary {
        id: row.get(0)?,
        harness: row.get(1)?,
        title: row.get(2)?,
        updated_at: row.get(3)?,
        was: row.get(4)?,
    })
}

pub fn thread(sql: &Connection, id: ThreadId) -> Result<Option<ThreadSummary>, Error> {
    Ok(sql
        .query_row(&format!("{THREAD} WHERE id = ?1"), params![id], read_thread)
        .optional()?)
}

/// The Thread `thread` was forked from, if it was.
pub fn forked_from(sql: &Connection, thread: ThreadId) -> Result<Option<ThreadId>, Error> {
    Ok(sql
        .query_row(
            "SELECT forked_from FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten())
}

/// How the Thread's Full access was chosen; none for any other mode, or
/// for Full access from before the fence.
pub fn full_access(sql: &Connection, thread: ThreadId) -> Result<Option<Chosen>, Error> {
    let word: Option<String> = sql
        .query_row(
            "SELECT full_access FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    // A word this build does not know is no mark.
    Ok(word.and_then(|word| serde_json::from_value(serde_json::Value::String(word)).ok()))
}

pub fn set_full_access(
    sql: &Connection,
    thread: ThreadId,
    chosen: Option<Chosen>,
) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET full_access = ?2 WHERE id = ?1",
        params![thread, chosen.map(word)],
    )?;
    Ok(())
}

/// What `turn` runs with, changed as it starts.
pub fn set_turn_settings(sql: &Connection, turn: TurnId, settings: &Settings) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_turns SET settings = ?2 WHERE id = ?1",
        params![turn, json(settings)?],
    )?;
    Ok(())
}

pub fn set_forked_from(sql: &Connection, thread: ThreadId, from: ThreadId) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET forked_from = ?2 WHERE id = ?1",
        params![thread, from],
    )?;
    Ok(())
}

/// The Project's Threads, the latest first, each with where its work stands.
pub fn threads(sql: &Connection) -> Result<Vec<ListedThread>, Error> {
    // The Person's marks come with each row, not by a query of their own.
    let mut statement = sql.prepare(
        "SELECT id, COALESCE(harness, ''), title, updated_at, was_title, agent, later,
                seen, archived
         FROM agents_threads ORDER BY updated_at DESC, id DESC",
    )?;
    let rows = statement.query_map([], |row| {
        let marks = (maybe_column(row, 6)?, row.get(7)?, maybe_column(row, 8)?);
        Ok((read_thread(row)?, row.get(5)?, marks))
    })?;
    let summaries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    summaries
        .into_iter()
        .map(|(thread, agent, (later, seen, archived))| {
            Ok(ListedThread {
                agent,
                latest: last_begun(sql, thread.id)?,
                asking: asking(sql, thread.id)?,
                message: latest_message(sql, thread.id)?,
                later,
                seen,
                archived,
                thread,
            })
        })
        .collect()
}

/// One turn, with what running it needs.
pub struct Turn {
    pub id: TurnId,
    pub thread: ThreadId,
    pub agent: AgentId,
    pub message: ItemId,
    pub state: TurnState,
    pub opener: Opener,
    /// The other Thread, for a turn another Thread's Agent opened: the one
    /// that asked, kept when a Person tries it again; or the one that
    /// answers.
    pub from_thread: Option<ThreadId>,
    /// It runs and was asked to stop.
    pub stopping: bool,
}

impl Turn {
    /// The Thread that waits for this turn's answer, if one does.
    pub fn answers(&self) -> Option<ThreadId> {
        self.from_thread.filter(|_| self.opener != Opener::Answered)
    }
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
        "INSERT INTO agents_turns
         (id, thread, agent, author, message, state, settings, created_at, started_at, opener,
          from_thread)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            turn.id,
            turn.thread,
            turn.agent,
            json(&author)?,
            turn.message,
            word(turn.state),
            json(settings)?,
            at,
            (turn.state == TurnState::Running).then_some(at),
            word(turn.opener),
            turn.from_thread
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

const TURN: &str =
    "SELECT id, thread, agent, message, state, opener, from_thread, stopping FROM agents_turns";

fn read_turn(row: &Row<'_>) -> rusqlite::Result<Turn> {
    Ok(Turn {
        id: row.get(0)?,
        thread: row.get(1)?,
        agent: row.get(2)?,
        message: row.get(3)?,
        state: word_of(row, 4)?,
        opener: word_of(row, 5)?,
        from_thread: row.get(6)?,
        stopping: row.get(7)?,
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
    let rows = statement.query_map(params![thread, word(state)], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every Thread's turns that run.
pub fn every_running(sql: &Connection) -> Result<Vec<Turn>, Error> {
    let mut statement = sql.prepare(&format!("{TURN} WHERE state = ?1"))?;
    let rows = statement.query_map(params![word(TurnState::Running)], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Thread's turn that runs, if one does.
pub fn running(sql: &Connection, thread: ThreadId) -> Result<Option<Turn>, Error> {
    Ok(turns_in(sql, thread, TurnState::Running)?.pop())
}

/// Marks `turn`, which runs, as asked to stop.
pub fn set_stopping(sql: &Connection, turn: TurnId) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_turns SET stopping = 1 WHERE id = ?1",
        params![turn],
    )?;
    Ok(())
}

/// The turns that ran or will run `message`, the first first. A turn a
/// Person took back never ran it.
pub fn turns_of(sql: &Connection, message: ItemId) -> Result<Vec<Turn>, Error> {
    let mut statement = sql.prepare(&format!(
        "{TURN} WHERE message = ?1 AND state != ?2 ORDER BY created_at, id"
    ))?;
    let withdrawn = word(TurnState::Withdrawn);
    let rows = statement.query_map(params![message, withdrawn], read_turn)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Sets `turn`'s state at `at`: a turn that runs began then, and one that
/// no longer runs or waits ended then.
pub fn set_turn(
    sql: &Connection,
    turn: TurnId,
    state: TurnState,
    reason: Option<&str>,
    failure: Option<Failure>,
    at: i64,
) -> Result<(), Error> {
    let failure = failure.as_ref().map(json).transpose()?;
    let started = (state == TurnState::Running).then_some(at);
    let ended = !matches!(state, TurnState::Queued | TurnState::Running);
    sql.execute(
        "UPDATE agents_turns SET state = ?2, reason = ?3, failure = ?4,
         started_at = COALESCE(?5, started_at), ended_at = ?6 WHERE id = ?1",
        params![
            turn,
            word(state),
            reason,
            failure,
            started,
            ended.then_some(at)
        ],
    )?;
    Ok(())
}

/// The states of a turn that has not ended, or never began: one that
/// waits, or that a Person took back. A Person sees any other settled.
fn unended() -> [String; 3] {
    [TurnState::Queued, TurnState::Running, TurnState::Withdrawn].map(word)
}

/// Where `turn` stands among `thread`'s turns, if it is one of them and
/// it ended: what a Person's seen may name (ADR 0096, decision 2).
pub fn ended_turn(sql: &Connection, thread: ThreadId, turn: TurnId) -> Result<Option<i64>, Error> {
    let [queued, running, withdrawn] = unended();
    Ok(sql
        .query_row(
            "SELECT rowid FROM agents_turns
             WHERE id = ?2 AND thread = ?1 AND state NOT IN (?3, ?4, ?5)",
            params![thread, turn, queued, running, withdrawn],
            |row| row.get(0),
        )
        .optional()?)
}

/// The Thread's latest turn that ended, if one did.
pub fn latest_ended(sql: &Connection, thread: ThreadId) -> Result<Option<TurnId>, Error> {
    let [queued, running, withdrawn] = unended();
    Ok(sql
        .query_row(
            "SELECT id FROM agents_turns WHERE thread = ?1 AND state NOT IN (?2, ?3, ?4)
             ORDER BY rowid DESC LIMIT 1",
            params![thread, queued, running, withdrawn],
            |row| row.get(0),
        )
        .optional()?)
}

/// The Thread's latest turn that began, and where it stands: one that
/// waits, or that a Person took back, never did.
pub fn last_begun(sql: &Connection, thread: ThreadId) -> Result<Option<LatestTurn>, Error> {
    Ok(sql
        .query_row(
            "SELECT id, state, COALESCE(started_at, created_at), reason, note, failure
             FROM agents_turns
             WHERE thread = ?1 AND state NOT IN (?2, ?3)
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![thread, word(TurnState::Queued), word(TurnState::Withdrawn)],
            |row| {
                Ok(LatestTurn {
                    turn: row.get(0)?,
                    state: word_of(row, 1)?,
                    began: row.get(2)?,
                    reason: row.get(3)?,
                    note: row.get(4)?,
                    failure: row
                        .get::<_, Option<String>>(5)?
                        .and_then(|said| serde_json::from_str(&said).ok()),
                })
            },
        )
        .optional()?)
}

/// Keeps what `turn`'s Agent tells its Person when it ends, in place of
/// what it told before (ADR 0057).
pub fn set_note(sql: &Connection, turn: TurnId, note: &str) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_turns SET note = ?2 WHERE id = ?1",
        params![turn, note],
    )?;
    Ok(())
}

/// What `turn`'s Agent tells its Person when it ends, if it said.
pub fn note(sql: &Connection, turn: TurnId) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT note FROM agents_turns WHERE id = ?1",
            params![turn],
            |row| row.get(0),
        )
        .optional()?
        .flatten())
}

pub fn turns(sql: &Connection, thread: ThreadId) -> Result<Vec<TurnView>, Error> {
    let mut statement = sql.prepare(
        "SELECT id, message, state, reason, failure, started_at, ended_at, settings, harness
         FROM agents_turns WHERE thread = ?1 ORDER BY created_at, id",
    )?;
    let rows = statement.query_map(params![thread], |row| {
        let failure: Option<String> = row.get(4)?;
        // A turn from before turns kept their settings made no plan.
        let settings: Option<String> = row.get(7)?;
        let settings: Option<Settings> = settings
            .map(|text| serde_json::from_str(&text).map_err(|e| unreadable(7, e)))
            .transpose()?;
        Ok(TurnView {
            id: row.get(0)?,
            message: row.get(1)?,
            state: word_of(row, 2)?,
            reason: row.get(3)?,
            failure: failure
                .map(|text| serde_json::from_str(&text).map_err(|e| unreadable(4, e)))
                .transpose()?,
            started: row.get(5)?,
            ended: row.get(6)?,
            harness: row.get(8)?,
            plan: settings.is_some_and(|settings| settings.plan),
            can: Default::default(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Keeps the Harness entry `turn` runs on, its Thread's now, and says it.
pub fn run_on(sql: &Connection, turn: TurnId) -> Result<Option<String>, Error> {
    Ok(sql.query_row(
        "UPDATE agents_turns SET harness =
             (SELECT harness FROM agents_threads WHERE id = agents_turns.thread)
         WHERE id = ?1 RETURNING harness",
        params![turn],
        |row| row.get(0),
    )?)
}

/// The sessions of the Harnesses the Thread ran on before, by where they
/// live (ADR 0078, decision 5).
pub fn sessions<T: DeserializeOwned>(
    sql: &Connection,
    thread: ThreadId,
) -> Result<std::collections::BTreeMap<String, T>, Error> {
    let text: Option<String> = sql
        .query_row(
            "SELECT sessions FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(text
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

/// Keeps the Thread's earlier sessions, and its session now: `None` when
/// the Harness it moves to opens one of its own.
pub fn set_sessions(
    sql: &Connection,
    thread: ThreadId,
    now: Option<&impl Serialize>,
    earlier: &std::collections::BTreeMap<String, impl Serialize>,
) -> Result<(), Error> {
    let now = now.map(json).transpose()?;
    sql.execute(
        "UPDATE agents_threads SET evidence = ?2, sessions = ?3 WHERE id = ?1",
        params![thread, now, json(earlier)?],
    )?;
    Ok(())
}

/// The handoff still owed to this Thread's next Harness.
pub fn arrival<T: DeserializeOwned>(
    sql: &Connection,
    thread: ThreadId,
) -> Result<Option<T>, Error> {
    let text: Option<String> = sql.query_row(
        "SELECT arrival FROM agents_threads WHERE id = ?1",
        params![thread],
        |row| row.get(0),
    )?;
    Ok(text.map(|text| serde_json::from_str(&text)).transpose()?)
}

pub fn set_arrival(
    sql: &Connection,
    thread: ThreadId,
    arrival: Option<&impl Serialize>,
) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET arrival = ?2 WHERE id = ?1",
        params![thread, arrival.map(json).transpose()?],
    )?;
    Ok(())
}

/// The Harness entry each of the Thread's turns but `turn` ran on, in
/// order, and the last of its items each one holds.
pub fn turns_ran(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
) -> Result<Vec<(String, Option<ItemId>)>, Error> {
    let mut statement = sql.prepare(
        "SELECT t.harness, (SELECT i.id FROM agents_items i WHERE i.turn = t.id ORDER BY i.rowid DESC LIMIT 1)
         FROM agents_turns t
         WHERE t.thread = ?1 AND t.id != ?2 AND t.harness IS NOT NULL
         ORDER BY t.created_at, t.id",
    )?;
    let rows = statement.query_map(params![thread, turn], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Harness entry the Thread's latest turn but `turn` ran on: the
/// account a session moves from, when it moved (ADR 0078).
pub fn ran_before(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT harness FROM agents_turns
             WHERE thread = ?1 AND id != ?2 AND harness IS NOT NULL
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![thread, turn],
            |row| row.get(0),
        )
        .optional()?)
}

/// Who opened each of the Thread's turns.
pub fn openers(sql: &Connection, thread: ThreadId) -> Result<HashMap<TurnId, Opener>, Error> {
    let mut statement = sql.prepare("SELECT id, opener FROM agents_turns WHERE thread = ?1")?;
    let rows = statement.query_map(params![thread], |row| Ok((row.get(0)?, word_of(row, 1)?)))?;
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

/// Keeps `item`, a notice of `thread`, for the next message its Agent
/// gets.
pub fn keep_notice(sql: &Connection, thread: ThreadId, item: ItemId) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_notices (item, thread) VALUES (?1, ?2)",
        params![item, thread],
    )?;
    Ok(())
}

/// The notices of `thread` the message `by` sends before it, in the order
/// they came: those it took already, as a turn of it tried again; and,
/// when it `takes`, those no message took yet, now its.
pub fn notices_of(
    sql: &Connection,
    thread: ThreadId,
    by: ItemId,
    takes: bool,
) -> Result<Vec<String>, Error> {
    let untaken = takes
        && sql.query_row(
            "SELECT EXISTS(SELECT 1 FROM agents_notices WHERE thread = ?1 AND taken_by IS NULL)",
            params![thread],
            |row| row.get::<_, bool>(0),
        )?;
    if untaken {
        sql.execute(
            "UPDATE agents_notices SET taken_by = ?2 WHERE thread = ?1 AND taken_by IS NULL",
            params![thread, by],
        )?;
    }
    let mut statement = sql.prepare(
        "SELECT i.body FROM agents_notices n JOIN agents_items i ON i.id = n.item
         WHERE n.taken_by = ?1 ORDER BY i.rowid",
    )?;
    let bodies = statement
        .query_map(params![by], |row| column::<Body>(row, 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(bodies
        .into_iter()
        .filter_map(|body| match body {
            Body::Notice { text } => Some(text),
            _ => None,
        })
        .collect())
}

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

/// Copies the turns of the Thread `from`, to `through` and with it, and
/// their items, into the new Thread `to`: each with an ID of its own, in
/// the same order, `to`'s Agent for `from`'s (ADR 0027).
pub fn copy_turns(
    sql: &Connection,
    (from, old): (ThreadId, AgentId),
    through: TurnId,
    (to, agent): (ThreadId, AgentId),
) -> Result<(), Error> {
    let (was, now) = (
        json(&Participant::Agent(old))?,
        json(&Participant::Agent(agent))?,
    );
    let whose = |author: String| if author == was { now.clone() } else { author };
    let mut listed = sql.prepare(
        "SELECT id, author, message FROM agents_turns WHERE thread = ?1
         AND rowid <= (SELECT rowid FROM agents_turns WHERE id = ?2) ORDER BY rowid",
    )?;
    let turns = listed
        .query_map(params![from, through], |row| {
            Ok((row.get::<_, TurnId>(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<(TurnId, String, ItemId)>>>()?;
    let new_turns: HashMap<TurnId, TurnId> =
        turns.iter().map(|(id, ..)| (*id, TurnId::new())).collect();
    // Its items to the last of `through`'s, but for a later turn's, as a
    // message queued while it ran.
    let mut listed = sql.prepare(
        "SELECT id, turn, author FROM agents_items WHERE thread = ?1
         AND rowid <= (SELECT MAX(rowid) FROM agents_items WHERE thread = ?1 AND turn = ?2)
         ORDER BY rowid",
    )?;
    let items = listed
        .query_map(params![from, through], |row| {
            Ok((row.get::<_, ItemId>(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<(ItemId, Option<TurnId>, String)>>>()?;
    let mut new_items = HashMap::new();
    let mut insert = sql.prepare(
        "INSERT INTO agents_items (id, thread, turn, author, at, body, harness_message)
         SELECT ?2, ?3, ?4, ?5, at, body, harness_message FROM agents_items WHERE id = ?1",
    )?;
    for (id, turn, author) in items {
        let turn = match turn.map(|turn| new_turns.get(&turn)) {
            Some(None) => continue,
            new => new.flatten(),
        };
        let new = ItemId::new();
        new_items.insert(id, new);
        insert.execute(params![id, new, to, turn, whose(author)])?;
    }
    let mut insert = sql.prepare(
        "INSERT INTO agents_turns (id, thread, agent, author, message, state, reason,
             created_at, failure, settings, started_at, ended_at, opener, from_thread)
         SELECT ?2, ?3, ?4, ?5, ?6, state, reason, created_at, failure, settings,
             started_at, ended_at, opener, from_thread FROM agents_turns WHERE id = ?1",
    )?;
    for (id, author, message) in turns {
        let message = new_items.get(&message).copied().unwrap_or(message);
        insert.execute(params![
            id,
            new_turns[&id],
            to,
            agent,
            whose(author),
            message
        ])?;
    }
    Ok(())
}

/// The ID the Harness gave the last reply of `turn` that it named.
pub fn last_named_reply(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT harness_message FROM agents_items
             WHERE thread = ?1 AND turn = ?2 AND harness_message IS NOT NULL
             ORDER BY rowid DESC LIMIT 1",
            params![thread, turn],
            |row| row.get(0),
        )
        .optional()?)
}

/// The ID the Harness gave the last reply it named before `message`.
pub fn named_reply_before(
    sql: &Connection,
    thread: ThreadId,
    message: ItemId,
) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT harness_message FROM agents_items
             WHERE thread = ?1 AND harness_message IS NOT NULL
             AND rowid < (SELECT rowid FROM agents_items WHERE id = ?2)
             ORDER BY rowid DESC LIMIT 1",
            params![thread, message],
            |row| row.get(0),
        )
        .optional()?)
}

/// Takes `turn` and every turn of the Thread after it out, with their
/// items. The images their messages carried wait from `now` as a draft's
/// do, so a message put back in the composer keeps them.
pub fn rewind(sql: &Connection, thread: ThreadId, turn: TurnId, now: i64) -> Result<(), Error> {
    const LATER: &str = "SELECT id FROM agents_turns WHERE thread = ?1
        AND rowid >= (SELECT rowid FROM agents_turns WHERE id = ?2)";
    // Their messages, and what the Agent wrote in them.
    let items = format!(
        "SELECT id FROM agents_items WHERE thread = ?1 AND (turn IN ({LATER})
         OR id IN (SELECT message FROM agents_turns WHERE id IN ({LATER})))"
    );
    sql.execute(
        &format!("UPDATE agents_images SET item = NULL, added_at = ?3 WHERE item IN ({items})"),
        params![thread, turn, now],
    )?;
    // The session goes back to before them: the notices they took go with
    // the next message again.
    sql.execute(
        &format!("UPDATE agents_notices SET taken_by = NULL WHERE taken_by IN ({items})"),
        params![thread, turn],
    )?;
    sql.execute(
        &format!("DELETE FROM agents_items WHERE id IN ({items})"),
        params![thread, turn],
    )?;
    // A seen that named one of them names none (ADR 0096, decision 2).
    sql.execute(
        &format!("UPDATE agents_threads SET seen = NULL WHERE id = ?1 AND seen IN ({LATER})"),
        params![thread, turn],
    )?;
    sql.execute(
        &format!("DELETE FROM agents_turns WHERE id IN ({LATER})"),
        params![thread, turn],
    )?;
    Ok(())
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
/// A reply keeps `named`, the ID the Harness gave its message.
pub fn put(
    sql: &Connection,
    thread: ThreadId,
    item: &Item,
    named: Option<&str>,
) -> Result<(), Error> {
    let Some((_, mut stored)) = self::item(sql, item.id)? else {
        insert_item(sql, thread, item)?;
        sql.execute(
            "UPDATE agents_items SET harness_message = ?2 WHERE id = ?1",
            params![item.id, named],
        )?;
        return Ok(());
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

/// An item that is a Question still waiting for an answer, with `?2`
/// bound to [`open_word`].
const OPEN_QUESTION: &str =
    "json_extract(body, '$.kind') = 'question' AND json_extract(body, '$.state') = ?2";

fn open_word() -> Result<String, Error> {
    Ok(json(&QuestionState::Open)?.trim_matches('"').to_owned())
}

/// The Questions of a turn that still wait for an answer.
pub fn open_questions(sql: &Connection, turn: TurnId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE turn = ?1 AND {OPEN_QUESTION} ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![turn, open_word()?], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Thread's Questions that still wait for an answer, the first asked
/// first.
pub fn asking(sql: &Connection, thread: ThreadId) -> Result<Vec<Asking>, Error> {
    let mut statement = sql.prepare(&format!(
        "SELECT id, json_extract(body, '$.title'),
                CASE WHEN json_extract(body, '$.form') IS NULL
                      AND json_extract(body, '$.plan') IS NULL
                     THEN json_extract(body, '$.choices') END
         FROM agents_items
         WHERE thread = ?1 AND {OPEN_QUESTION} ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![thread, open_word()?], |row| {
        let choices = row
            .get::<_, Option<String>>(2)?
            .and_then(|said| serde_json::from_str(&said).ok())
            .unwrap_or_default();
        Ok(Asking {
            item: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            choices,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The start of the latest message sent into the Thread: one a turn was
/// asked for, not an Agent's reply.
pub fn latest_message(sql: &Connection, thread: ThreadId) -> Result<Option<String>, Error> {
    let text: Option<Option<String>> = sql
        .query_row(
            "SELECT json_extract(i.body, '$.text') FROM agents_items i
             WHERE i.thread = ?1 AND EXISTS (SELECT 1 FROM agents_turns t WHERE t.message = i.id)
             ORDER BY i.at DESC, i.rowid DESC LIMIT 1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?;
    Ok(text
        .flatten()
        .map(|text| text.chars().take(LISTED_MESSAGE).collect()))
}

/// The Agent at work in a Thread.
pub fn agent_of(sql: &Connection, thread: ThreadId) -> Result<Option<AgentId>, Error> {
    Ok(sql
        .query_row(
            "SELECT agent FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .optional()?)
}

/// A Thread's title and its Agent.
pub fn title_and_agent(
    sql: &Connection,
    thread: ThreadId,
) -> Result<Option<(String, AgentId)>, Error> {
    Ok(sql
        .query_row(
            "SELECT title, agent FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// Moves a Thread to the Harness entry `harness` (ADR 0078).
pub fn switch(sql: &Connection, thread: ThreadId, harness: &str) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET harness = ?2 WHERE id = ?1",
        params![thread, harness],
    )?;
    Ok(())
}

/// Renames a Thread to `title`, keeping `was`, the title it had (ADR
/// 0077).
pub fn rename(sql: &Connection, thread: ThreadId, title: &str, was: &str) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET title = ?2, was_title = ?3 WHERE id = ?1",
        params![thread, title, was],
    )?;
    Ok(())
}

/// A message item of `thread`'s that its Agent, `agent`, did not write:
/// `?1` is the Thread and `?2` the Agent.
const SENT_IN: &str = "thread = ?1 AND json_extract(body, '$.kind') = 'message' AND author != ?2";

/// The first message sent into the Thread, its text and its images: what
/// its title was taken from. None once a rewind took every message.
pub fn first_message(
    sql: &Connection,
    thread: ThreadId,
    agent: AgentId,
) -> Result<Option<(String, Vec<Image>)>, Error> {
    let agent = json(&Participant::Agent(agent))?;
    let item = sql
        .query_row(
            &format!("{ITEM} WHERE {SENT_IN} ORDER BY rowid LIMIT 1"),
            params![thread, agent],
            read_item,
        )
        .optional()?;
    Ok(item.and_then(|item| match item.body {
        Body::Message { text, images, .. } => Some((text, images)),
        _ => None,
    }))
}

/// The texts of the latest `count` messages sent into the Thread, with
/// any text, the latest first.
pub fn latest_messages(
    sql: &Connection,
    thread: ThreadId,
    agent: AgentId,
    count: usize,
) -> Result<Vec<String>, Error> {
    let mut statement = sql.prepare(&format!(
        "SELECT json_extract(body, '$.text') FROM agents_items
         WHERE {SENT_IN} AND TRIM(COALESCE(json_extract(body, '$.text'), '')) != ''
         ORDER BY rowid DESC LIMIT ?3"
    ))?;
    let agent = json(&Participant::Agent(agent))?;
    let rows = statement.query_map(params![thread, agent, count as i64], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What the Thread's Agent, `agent`, said last, in any turn.
pub fn latest_reply(
    sql: &Connection,
    thread: ThreadId,
    agent: AgentId,
) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT json_extract(body, '$.text') FROM agents_items
             WHERE thread = ?1 AND author = ?2 AND json_extract(body, '$.kind') = 'message'
             ORDER BY rowid DESC LIMIT 1",
            params![thread, json(&Participant::Agent(agent))?],
            |row| row.get(0),
        )
        .optional()?)
}

/// The steps of the Agent's latest plan in the Thread; none without one.
pub fn latest_plan(sql: &Connection, thread: ThreadId) -> Result<Vec<PlanStep>, Error> {
    let item = sql
        .query_row(
            &format!(
                "{ITEM} WHERE thread = ?1 AND json_extract(body, '$.kind') = 'plan'
                 ORDER BY rowid DESC LIMIT 1"
            ),
            params![thread],
            read_item,
        )
        .optional()?;
    Ok(match item.map(|item| item.body) {
        Some(Body::Plan { steps }) => steps,
        _ => Vec::new(),
    })
}

/// Whether the Thread's Agent waits for its Person to answer a Question.
pub fn asks(sql: &Connection, thread: ThreadId) -> Result<bool, Error> {
    Ok(sql.query_row(
        &format!(
            "SELECT EXISTS (SELECT 1 FROM agents_items
             WHERE thread = ?1 AND {OPEN_QUESTION} LIMIT 1)"
        ),
        params![thread, open_word()?],
        |row| row.get(0),
    )?)
}

/// The Thread whose Agent this is. An Agent from before ADR 0006 may work
/// in several: the latest.
pub fn thread_of(sql: &Connection, agent: AgentId) -> Result<Option<ThreadId>, Error> {
    Ok(sql
        .query_row(
            "SELECT id FROM agents_threads WHERE agent = ?1 ORDER BY updated_at DESC LIMIT 1",
            params![agent],
            |row| row.get(0),
        )
        .optional()?)
}

/// The Threads that wait for an answer from `thread`'s Agent: those whose
/// Agent asked it in a turn still going, and up the chain from them.
pub fn waiting_for(sql: &Connection, thread: ThreadId) -> Result<Vec<ThreadId>, Error> {
    let mut statement = sql.prepare(
        "WITH RECURSIVE up (thread) AS (
             SELECT ?1
             UNION
             SELECT t.from_thread FROM agents_turns t JOIN up ON t.thread = up.thread
             WHERE t.from_thread IS NOT NULL AND t.opener != ?2 AND t.state IN (?3, ?4)
         )
         SELECT thread FROM up WHERE thread != ?1",
    )?;
    let ongoing = [TurnState::Queued, TurnState::Running].map(word);
    let answered = word(Opener::Answered);
    let rows = statement.query_map(params![thread, answered, ongoing[0], ongoing[1]], |row| {
        row.get(0)
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What the Agent last said in `turn` of `thread`: its last message there.
pub fn last_reply(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
    agent: AgentId,
) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT json_extract(body, '$.text') FROM agents_items
             WHERE thread = ?1 AND turn = ?2 AND author = ?3
                 AND json_extract(body, '$.kind') = 'message'
             ORDER BY rowid DESC LIMIT 1",
            params![thread, turn, json(&Participant::Agent(agent))?],
            |row| row.get(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Choice, Field};

    fn migrated() -> Connection {
        let sql = Connection::open_in_memory().unwrap();
        for migration in MIGRATIONS {
            sql.execute_batch(migration).unwrap();
        }
        sql
    }

    #[test]
    fn a_thread_runs_one_turn_and_one_that_ran_two_keeps_the_outboxs() {
        let sql = Connection::open_in_memory().unwrap();
        let at = MIGRATIONS
            .iter()
            .position(|m| m.contains("agents_turns_one_running"))
            .unwrap();
        let (before, from) = MIGRATIONS.split_at(at);
        for migration in before {
            sql.execute_batch(migration).unwrap();
        }
        let agent = AgentId::new();
        let thread = ThreadId::new();
        let summary = ThreadSummary {
            id: thread,
            harness: "fake".to_owned(),
            title: "Hello".to_owned(),
            updated_at: 0,
            was: None,
        };
        let author = Participant::Agent(agent);
        insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
        let running = |opener: Opener, at: i64| {
            let turn = Turn {
                id: TurnId::new(),
                thread,
                agent,
                message: ItemId::new(),
                state: TurnState::Running,
                opener,
                from_thread: None,
                stopping: false,
            };
            insert_turn(&sql, &turn, author, at, &Settings::default()).unwrap();
            turn.id
        };
        let sent = running(Opener::Person, 1);
        let own = running(Opener::ByItself, 2);
        for migration in from {
            sql.execute_batch(migration).unwrap();
        }
        let state = |id| turn(&sql, id).unwrap().unwrap().state;
        assert_eq!(state(sent), TurnState::Running);
        assert_eq!(state(own), TurnState::Interrupted);
        assert!(
            sql.execute(
                "UPDATE agents_turns SET state = 'running' WHERE id = ?1",
                params![own],
            )
            .is_err(),
            "a second turn cannot run"
        );
    }

    #[test]
    fn a_turn_from_before_was_opened_by_its_message() {
        let sql = Connection::open_in_memory().unwrap();
        let at = MIGRATIONS
            .iter()
            .position(|m| m.contains("opener"))
            .unwrap();
        let (before, from) = MIGRATIONS.split_at(at);
        for migration in before {
            sql.execute_batch(migration).unwrap();
        }
        let agent = AgentId::new();
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: "Hello".to_owned(),
            updated_at: 0,
            was: None,
        };
        let author = Participant::Agent(agent);
        insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
        let old = |body: Body| {
            let item = Item {
                id: ItemId::new(),
                turn: None,
                author,
                at: 0,
                body,
            };
            insert_item(&sql, summary.id, &item).unwrap();
            let turn = TurnId::new();
            sql.execute(
                "INSERT INTO agents_turns (id, thread, agent, author, message, state, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'done', 0)",
                params![turn, summary.id, agent, json(&author).unwrap(), item.id],
            )
            .unwrap();
            turn
        };
        let asked = old(Body::Message {
            text: "Hi".to_owned(),
            images: Vec::new(),
            answers: false,
        });
        let own = old(Body::Notice {
            text: "It went on by itself.".to_owned(),
        });
        for migration in from {
            sql.execute_batch(migration).unwrap();
        }
        let opener = |id| turn(&sql, id).unwrap().unwrap().opener;
        assert_eq!(opener(asked), Opener::Person);
        assert_eq!(opener(own), Opener::ByItself, "its message is a notice");
        let openers = openers(&sql, summary.id).unwrap();
        assert_eq!(
            openers,
            HashMap::from([(asked, Opener::Person), (own, Opener::ByItself)])
        );
    }

    #[test]
    fn a_turn_keeps_when_it_ran() {
        let sql = migrated();
        let agent = AgentId::new();
        let thread = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: "Hello".to_owned(),
            updated_at: 0,
            was: None,
        };
        insert_thread(
            &sql,
            &thread,
            agent,
            Participant::Agent(agent),
            &Settings::default(),
        )
        .unwrap();
        let turn = Turn {
            id: TurnId::new(),
            thread: thread.id,
            agent,
            message: ItemId::new(),
            state: TurnState::Queued,
            opener: Opener::Person,
            from_thread: None,
            stopping: false,
        };
        let settings = Settings::default();
        insert_turn(&sql, &turn, Participant::Agent(agent), 10, &settings).unwrap();
        let times = || {
            let view = turns(&sql, thread.id).unwrap().pop().unwrap();
            (view.started, view.ended)
        };
        assert_eq!(times(), (None, None), "a turn that waits has not run");
        set_turn(&sql, turn.id, TurnState::Running, None, None, 20).unwrap();
        assert_eq!(times(), (Some(20), None));
        set_turn(&sql, turn.id, TurnState::Done, None, None, 85).unwrap();
        assert_eq!(times(), (Some(20), Some(85)));
        let planned = Turn {
            id: TurnId::new(),
            ..turn
        };
        let plan = Settings {
            plan: true,
            ..Settings::default()
        };
        insert_turn(&sql, &planned, Participant::Agent(agent), 90, &plan).unwrap();
        let plans: Vec<bool> = turns(&sql, thread.id)
            .unwrap()
            .iter()
            .map(|t| t.plan)
            .collect();
        assert_eq!(plans, [false, true], "a turn keeps whether it made a plan");
    }

    #[test]
    fn a_listed_thread_says_where_its_work_stands() {
        let sql = migrated();
        let agent = AgentId::new();
        let author = Participant::Agent(agent);
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: "Hello".to_owned(),
            updated_at: 0,
            was: None,
        };
        let settings = Settings::default();
        insert_thread(&sql, &summary, agent, author, &settings).unwrap();
        let listed = || threads(&sql).unwrap().remove(0);
        assert_eq!(listed().latest, None, "no turn began yet");

        let mut at = 0;
        let mut add = |state: TurnState| {
            at += 1;
            let turn = Turn {
                id: TurnId::new(),
                thread: summary.id,
                agent,
                message: ItemId::new(),
                state,
                opener: Opener::Person,
                from_thread: None,
                stopping: false,
            };
            insert_turn(&sql, &turn, author, at, &settings).unwrap();
            turn.id
        };
        let ran = add(TurnState::Running);
        add(TurnState::Queued);
        let running = Some(LatestTurn {
            turn: ran,
            state: TurnState::Running,
            began: 1,
            reason: None,
            note: None,
            failure: None,
        });
        assert_eq!(listed().latest, running, "a turn that waits never began");
        set_turn(&sql, ran, TurnState::Running, None, None, 7).unwrap();
        assert_eq!(listed().latest.unwrap().began, 7, "it began when it ran");
        set_turn(&sql, ran, TurnState::Failed, Some("It broke."), None, 100).unwrap();
        set_note(&sql, ran, "Tried twice.").unwrap();
        add(TurnState::Withdrawn);
        assert_eq!(
            listed().latest,
            Some(LatestTurn {
                turn: ran,
                state: TurnState::Failed,
                began: 7,
                reason: Some("It broke.".to_owned()),
                note: Some("Tried twice.".to_owned()),
                failure: None,
            }),
            "nor one a Person took back"
        );

        let allow = Choice {
            id: "allow".to_owned(),
            name: "Allow".to_owned(),
            allows: true,
            always: false,
        };
        let asked = |state: QuestionState, form: Option<Vec<Field>>| {
            let item = Item {
                id: ItemId::new(),
                turn: Some(ran),
                author,
                at: 0,
                body: Body::Question {
                    title: "Which?".to_owned(),
                    choices: vec![allow.clone()],
                    form: form.clone(),
                    plan: None,
                    state,
                    answer: None,
                    values: None,
                },
            };
            insert_item(&sql, summary.id, &item).unwrap();
            item.id
        };
        let question = |state| asked(state, None);
        question(QuestionState::Answered);
        let first = question(QuestionState::Open);
        question(QuestionState::Closed);
        let second = question(QuestionState::Open);
        let asking: Vec<_> = listed().asking.into_iter().map(|a| a.item).collect();
        assert_eq!(asking, [first, second], "only open Questions ask");
        assert_eq!(
            listed().asking[0].title,
            "Which?",
            "each names what it asks"
        );
        // A click answers one with no form: its choices are listed.
        assert_eq!(listed().asking[0].choices, std::slice::from_ref(&allow));
        asked(QuestionState::Open, Some(Vec::new()));
        assert!(
            listed().asking[2].choices.is_empty(),
            "one with a form is answered in its Thread"
        );
    }

    #[test]
    fn older_threads_learn_their_harness_from_their_agents_files() {
        let sql = Connection::open_in_memory().unwrap();
        for migration in MIGRATIONS {
            sql.execute_batch(migration).unwrap();
        }
        let (writer, gone) = (AgentId::new(), AgentId::new());
        for (title, agent) in [("by Writer", writer), ("by one whose file went", gone)] {
            sql.execute(
                "INSERT INTO agents_threads (id, agent, author, title, created_at, updated_at)
                 VALUES (?1, ?2, '{}', ?3, 0, 0)",
                params![ThreadId::new(), agent, title],
            )
            .unwrap();
        }
        let agents = [(writer, "codex".to_owned())];
        fill_harnesses(&sql, &agents).unwrap();
        fill_harnesses(&sql, &[(writer, "claude".to_owned())]).unwrap();
        let mut named: Vec<_> = threads(&sql)
            .unwrap()
            .into_iter()
            .map(|t| (t.thread.title, t.thread.harness))
            .collect();
        named.sort();
        assert_eq!(
            named,
            [
                ("by Writer".to_owned(), "codex".to_owned()),
                ("by one whose file went".to_owned(), String::new()),
            ],
            "a Harness once named stays"
        );
    }
    #[test]
    fn an_unsent_sweep_keeps_images_still_referenced_by_a_fork() {
        let sql = migrated();
        let agent = AgentId::new();
        let author = Participant::Agent(agent);
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".into(),
            title: "Fork".into(),
            updated_at: 0,
            was: None,
        };
        insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
        for tool in [false, true] {
            let image = Image {
                id: ImageId::new(),
                mime: "image/png".into(),
                name: None,
                size: 8,
            };
            attach_image(&sql, &image, author, 0).unwrap();
            let body = if tool {
                Body::Tool {
                    title: "Shot".into(),
                    tool: crate::model::ToolKind::Fetch,
                    status: crate::model::ToolStatus::Done,
                    content: vec![ToolContent::Image {
                        image: image.clone(),
                    }],
                    output: None,
                }
            } else {
                Body::Message {
                    text: "Shot".into(),
                    images: vec![image.clone()],
                    answers: false,
                }
            };
            let item = Item {
                id: ItemId::new(),
                turn: None,
                author,
                at: 0,
                body,
            };
            put(&sql, summary.id, &item, None).unwrap();
            assert!(
                drop_unsent_images(&sql, 10).unwrap().is_empty(),
                "the surviving fork still names it"
            );
            sql.execute("DELETE FROM agents_items WHERE id = ?1", params![item.id])
                .unwrap();
            assert_eq!(drop_unsent_images(&sql, 10).unwrap(), vec![image.id]);
        }
    }
    #[test]
    fn replaced_tool_images_wait_the_grace_period_before_they_are_swept() {
        let sql = migrated();
        let agent = AgentId::new();
        let author = Participant::Agent(agent);
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".into(),
            title: "Shot".into(),
            updated_at: 0,
            was: None,
        };
        insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
        let image = || Image {
            id: ImageId::new(),
            mime: "image/png".into(),
            name: None,
            size: 8,
        };
        let old = image();
        let new = image();
        let mut item = Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 0,
            body: Body::Tool {
                title: "Shot".into(),
                tool: crate::model::ToolKind::Fetch,
                status: crate::model::ToolStatus::Running,
                content: vec![ToolContent::Image { image: old.clone() }],
                output: None,
            },
        };
        put(&sql, summary.id, &item, None).unwrap();
        tool_images(
            &sql,
            &[ToolContent::Image { image: old.clone() }],
            item.id,
            author,
            0,
        )
        .unwrap();
        let content = vec![ToolContent::Image { image: new.clone() }];
        tool_images(&sql, &content, item.id, author, 20).unwrap();
        if let Body::Tool { content: shown, .. } = &mut item.body {
            *shown = content;
        }
        set_body(&sql, item.id, &item.body).unwrap();
        assert!(drop_unsent_images(&sql, 20).unwrap().is_empty());
        assert_eq!(drop_unsent_images(&sql, 21).unwrap(), vec![old.id]);
        assert!(image_kind(&sql, new.id).unwrap().is_some());
    }
}
