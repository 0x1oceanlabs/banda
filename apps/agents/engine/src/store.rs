//! The agents module's tables. Only this module writes them, and only
//! through these functions.

use crate::changes::ChangedLines;
use crate::doing::AtWork;
use crate::full_access::Chosen;
use crate::model::{
    AccountUse, Archived, Asking, Body, Failure, Image, ImageId, Item, ItemId, LISTED_MESSAGE,
    Later, LatestTurn, ListedThread, Offer, Opener, PlanStep, QuestionState, Settings, Subagent,
    SubagentId, SubagentState, ThreadId, ThreadSummary, ToolContent, TurnId, TurnState, TurnView,
    Usage, VisualId,
};
use crate::rules::Lanes;
use crate::search;
use banda_kernel::{AgentId, Error, Participant, Refusal};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::path::Path;

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
    r#"
-- A Thread's sub-agents, each a lane of it (ADR 0103, decision 8): the
-- turn it started in, its root's for a nested one; the lane that started
-- it; its anchor, the entry where it shows; and its own words and state.
-- `stopping` is unused: Banda stops no sub-agent (ADR 0103, call 11), so
-- nothing writes it.
-- `evidence` is the Harness's child session, as JSON (ADR 0002, decision
-- 7): a Thread keeps one lane for each.
CREATE TABLE agents_subagents (
    id TEXT PRIMARY KEY,
    thread TEXT NOT NULL,
    turn TEXT NOT NULL,
    parent TEXT,
    item TEXT NOT NULL,
    title TEXT NOT NULL,
    role TEXT,
    model TEXT,
    state TEXT NOT NULL,
    why TEXT,
    can_stop INTEGER NOT NULL DEFAULT 0,
    stopping TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    prompt TEXT,
    report TEXT,
    evidence TEXT
);
CREATE UNIQUE INDEX agents_subagents_by_evidence ON agents_subagents (thread, evidence)
    WHERE evidence IS NOT NULL;
CREATE INDEX agents_subagents_by_thread ON agents_subagents (thread);

-- The lane an entry is of; NULL for the Thread's own. A lane's Question
-- is the Thread's, NULL here, and names its lane in its body.
ALTER TABLE agents_items ADD COLUMN sub TEXT;
CREATE INDEX agents_items_by_sub ON agents_items (sub) WHERE sub IS NOT NULL;
"#,
    r#"
-- How many lines each turn's tool calls changed, with its sub-agents'
-- edits (ADR 0103, decision 8), as JSON, kept as it ends so the list says
-- it without reading its diffs again (ADR 0098, decision 8). NULL when it
-- changed none, and for turns that ended before.
ALTER TABLE agents_turns ADD COLUMN changed_lines TEXT;
"#,
    r#"
-- The Thread whose Agent started the Thread through Banda: its parent
-- (ADR 0098, decision 24). A Thread from before takes it from its
-- `author`, who wrote its `thread.started` too, when that is the Agent
-- of another Thread: the latest, as `thread_of` finds it. A fork is no
-- one's child.
ALTER TABLE agents_threads ADD COLUMN parent TEXT;
UPDATE agents_threads SET parent = (
    SELECT p.id FROM agents_threads p
    WHERE p.agent = json_extract(agents_threads.author, '$.id')
      AND p.id != agents_threads.id
    ORDER BY p.updated_at DESC, p.id DESC LIMIT 1
)
WHERE forked_from IS NULL AND json_extract(author, '$.kind') = 'agent';
"#,
    r#"
-- The messages a Person searches (ADR 0098, decision 17): each message's
-- text, its Person's and its Agents', under its item's rowid, and the
-- item's ID beside it (`search.rs`). The tokenizer folds case in every
-- script, and Latin accents.
CREATE VIRTUAL TABLE agents_search USING fts5(
    text, item UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
-- How far the index came with the messages written before it: those
-- with a rowid below this are not in it yet; 0 once none is left.
CREATE TABLE agents_backfill (below INTEGER NOT NULL);
INSERT INTO agents_backfill SELECT COALESCE(MAX(rowid), 0) + 1 FROM agents_items;
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

/// Keeps that the Agent of `parent` started `thread` (ADR 0098, decision
/// 24), as it starts: a Thread's parent never changes.
pub fn set_parent(sql: &Connection, thread: ThreadId, parent: ThreadId) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_threads SET parent = ?2 WHERE id = ?1",
        params![thread, parent],
    )?;
    Ok(())
}

/// Idle Threads still assigned to a removed Account, including archived
/// Threads. Queued Turns follow the new Account when they start.
pub fn idle_on(sql: &Connection, harness: &str) -> Result<Vec<ThreadId>, Error> {
    let mut statement = sql.prepare("SELECT id FROM agents_threads WHERE harness = ?1 AND NOT EXISTS (SELECT 1 FROM agents_turns WHERE thread = agents_threads.id AND state = 'running')")?;
    Ok(statement
        .query_map([harness], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The Project's Threads, the latest first, each with where its work
/// stands and what it does now, from `doing`: memory's, not the store's,
/// read before them. A Thread takes what its latest turn does while that
/// runs, so one whose turn ended or was handed over meanwhile takes none.
pub fn threads(sql: &Connection, doing: &AtWork) -> Result<Vec<ListedThread>, Error> {
    // The Person's marks come with each row, not by a query of their own.
    let mut statement = sql.prepare(
        "SELECT id, COALESCE(harness, ''), title, updated_at, was_title, agent, later,
                seen, archived, parent
         FROM agents_threads ORDER BY updated_at DESC, id DESC",
    )?;
    let rows = statement.query_map([], |row| {
        let marks = (maybe_column(row, 6)?, row.get(7)?, maybe_column(row, 8)?);
        Ok((read_thread(row)?, (row.get(5)?, row.get(9)?), marks))
    })?;
    let summaries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    summaries
        .into_iter()
        .map(|(thread, (agent, parent), (later, seen, archived))| {
            let latest = last_begun(sql, thread.id)?;
            let now = latest.as_ref().and_then(|latest| {
                let (turn, now) = doing.get(&thread.id)?;
                let runs = latest.turn == *turn && latest.state == TurnState::Running;
                runs.then(|| now.clone())
            });
            Ok(ListedThread {
                agent,
                parent,
                latest,
                asking: asking(sql, thread.id)?,
                message: latest_message(sql, thread.id)?,
                later,
                seen,
                archived,
                now: now.unwrap_or_default(),
                changed_lines: last_changed_lines(sql, thread.id)?,
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

/// The Thread's latest turn that ended, with `?1` the Thread and `?2` to
/// `?4` bound to [`unended`]. One clause, so what the list says that turn
/// changed and what a Person's seen names are always the same turn.
const LATEST_ENDED: &str = "FROM agents_turns WHERE thread = ?1 AND state NOT IN (?2, ?3, ?4)
     ORDER BY rowid DESC LIMIT 1";

/// The Thread's latest turn that ended, if one did.
pub fn latest_ended(sql: &Connection, thread: ThreadId) -> Result<Option<TurnId>, Error> {
    let [queued, running, withdrawn] = unended();
    Ok(sql
        .query_row(
            &format!("SELECT id {LATEST_ENDED}"),
            params![thread, queued, running, withdrawn],
            |row| row.get(0),
        )
        .optional()?)
}

/// Keeps how many lines `turn`'s tool calls changed, as it ends.
pub fn set_changed_lines(
    sql: &Connection,
    turn: TurnId,
    lines: Option<ChangedLines>,
) -> Result<(), Error> {
    let lines = lines.as_ref().map(json).transpose()?;
    sql.execute(
        "UPDATE agents_turns SET changed_lines = ?2 WHERE id = ?1",
        params![turn, lines],
    )?;
    Ok(())
}

/// How many lines the Thread's latest turn that ended changed, if it
/// changed any and was kept so: the same turn [`latest_ended`] names.
fn last_changed_lines(sql: &Connection, thread: ThreadId) -> Result<Option<ChangedLines>, Error> {
    let [queued, running, withdrawn] = unended();
    Ok(sql
        .query_row(
            &format!("SELECT changed_lines {LATEST_ENDED}"),
            params![thread, queued, running, withdrawn],
            |row| maybe_column(row, 0),
        )
        .optional()?
        .flatten())
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
/// order, and the last of its Agent's own items each one holds: not a
/// lane's, nor a Question a lane asked, which may come after the next
/// turn's message (ADR 0103, decision 8).
pub fn turns_ran(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
) -> Result<Vec<(String, Option<ItemId>)>, Error> {
    let mut statement = sql.prepare(
        "SELECT t.harness, (SELECT i.id FROM agents_items i
                            WHERE i.turn = t.id AND i.sub IS NULL
                              AND json_extract(i.body, '$.sub') IS NULL
                            ORDER BY i.rowid DESC LIMIT 1)
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

/// How much the Project's Threads use each account they ran on: its
/// Threads now, not archived, its latest turn, and its turns begun since
/// `since` (ADR 0093, decision 6). A turn from before turns named their
/// account ran on its Thread's.
pub fn account_uses(sql: &Connection, since: i64) -> Result<Vec<AccountUse>, Error> {
    let mut statement = sql.prepare(
        "WITH turns AS (
             SELECT COALESCE(t.harness, h.harness) AS harness, t.started_at
             FROM agents_turns t JOIN agents_threads h ON h.id = t.thread
             WHERE t.started_at IS NOT NULL
         ), threads AS (
             SELECT harness FROM agents_threads
             WHERE harness IS NOT NULL
               AND (archived IS NULL OR updated_at > json_extract(archived, '$.at'))
         )
         SELECT harness,
                (SELECT COUNT(*) FROM threads WHERE threads.harness = a.harness),
                (SELECT MAX(started_at) FROM turns WHERE turns.harness = a.harness),
                (SELECT COUNT(*) FROM turns WHERE turns.harness = a.harness AND started_at >= ?1)
         FROM (SELECT harness FROM turns UNION SELECT harness FROM threads) a
         WHERE harness IS NOT NULL
         ORDER BY harness",
    )?;
    let rows = statement.query_map(params![since], |row| {
        Ok(AccountUse {
            harness: row.get(0)?,
            threads: row.get(1)?,
            last: row.get(2)?,
            turns: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Who opened each of the Thread's turns.
pub fn openers(sql: &Connection, thread: ThreadId) -> Result<HashMap<TurnId, Opener>, Error> {
    let mut statement = sql.prepare("SELECT id, opener FROM agents_turns WHERE thread = ?1")?;
    let rows = statement.query_map(params![thread], |row| Ok((row.get(0)?, word_of(row, 1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Writes `item` into `thread`: its own, or with `sub`, a lane's.
pub fn insert_item(
    sql: &Connection,
    thread: ThreadId,
    item: &Item,
    sub: Option<SubagentId>,
) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO agents_items (id, thread, turn, author, at, body, sub)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            item.id,
            thread,
            item.turn,
            json(&item.author)?,
            item.at,
            json(&item.body)?,
            sub
        ],
    )?;
    // A message is searched as soon as it is written (ADR 0098, decision
    // 17).
    if matches!(item.body, Body::Message { .. }) {
        search::index(sql, item.id)?;
    }
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

/// Copies the turns of the Thread `from`, to `through` and with it, their
/// items and their sub-agents, into the new Thread `to`: each with an ID
/// of its own, in the same order, `to`'s Agent for `from`'s (ADR 0027;
/// ADR 0103, Open questions). A fork waits for its sub-agents to end, so
/// each it copies has ended; none keeps its child session.
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
    // The lanes of those turns, each under an ID of its own.
    let mut listed = sql.prepare(
        "SELECT id, turn, parent, item FROM agents_subagents WHERE thread = ?1 ORDER BY rowid",
    )?;
    let lanes = listed
        .query_map(params![from], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<Vec<(SubagentId, TurnId, Option<SubagentId>, ItemId)>>>()?;
    let lanes: Vec<_> = (lanes.into_iter())
        .filter(|(_, turn, ..)| new_turns.contains_key(turn))
        .collect();
    let new_lanes: HashMap<SubagentId, SubagentId> = lanes
        .iter()
        .map(|(id, ..)| (*id, SubagentId::new()))
        .collect();
    // Its own items to the last of `through`'s, but for a later turn's, as
    // a message queued while it ran; and its lanes' items and the
    // Questions they asked, which may come after and end nothing. An
    // anchor, or a Question a lane asked, names the lane's copy.
    let mut listed = sql.prepare(
        "SELECT id, turn, author, sub,
                CASE WHEN json_extract(body, '$.kind') = 'subagent'
                       OR json_extract(body, '$.sub') IS NOT NULL THEN body END
         FROM agents_items WHERE thread = ?1
         AND (sub IS NOT NULL OR json_extract(body, '$.sub') IS NOT NULL
              OR rowid <= (SELECT MAX(rowid) FROM agents_items
                           WHERE thread = ?1 AND turn = ?2 AND sub IS NULL
                             AND json_extract(body, '$.sub') IS NULL))
         ORDER BY rowid",
    )?;
    let items = listed
        .query_map(params![from, through], |row| {
            Ok((
                row.get::<_, ItemId>(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                maybe_column::<Body>(row, 4)?,
            ))
        })?
        .collect::<rusqlite::Result<
            Vec<(
                ItemId,
                Option<TurnId>,
                String,
                Option<SubagentId>,
                Option<Body>,
            )>,
        >>()?;
    let mut new_items = HashMap::new();
    let mut insert = sql.prepare(
        "INSERT INTO agents_items (id, thread, turn, author, at, body, harness_message, sub)
         SELECT ?2, ?3, ?4, ?5, at, COALESCE(?6, body), harness_message, ?7
         FROM agents_items WHERE id = ?1",
    )?;
    let lane_of = |id: SubagentId| new_lanes.get(&id).copied();
    for (id, turn, author, sub, body) in items {
        let turn = match turn.map(|turn| new_turns.get(&turn)) {
            Some(None) => continue,
            new => new.flatten(),
        };
        // A lane's entry, and a Question it asked, go with its copy.
        let asker = match &body {
            Some(Body::Question { sub, .. }) => *sub,
            _ => None,
        };
        if sub.or(asker).is_some_and(|lane| lane_of(lane).is_none()) {
            continue;
        }
        let body = body.map(|body| lanes_named(body, lane_of));
        let new = ItemId::new();
        new_items.insert(id, new);
        insert.execute(params![
            id,
            new,
            to,
            turn,
            whose(author),
            body.as_ref().map(json).transpose()?,
            sub.and_then(lane_of)
        ])?;
    }
    let mut insert = sql.prepare(
        "INSERT INTO agents_subagents (id, thread, turn, parent, item, title, role, model,
             state, why, can_stop, started_at, ended_at, prompt, report)
         SELECT ?2, ?3, ?4, ?5, ?6, title, role, model, state, why, can_stop, started_at,
             ended_at, prompt, report FROM agents_subagents WHERE id = ?1",
    )?;
    for (id, turn, parent, item) in lanes {
        insert.execute(params![
            id,
            new_lanes[&id],
            to,
            new_turns[&turn],
            parent.and_then(lane_of),
            new_items.get(&item).copied().unwrap_or(item)
        ])?;
    }
    let mut insert = sql.prepare(
        "INSERT INTO agents_turns (id, thread, agent, author, message, state, reason,
             created_at, failure, settings, started_at, ended_at, opener, from_thread,
             changed_lines)
         SELECT ?2, ?3, ?4, ?5, ?6, state, reason, created_at, failure, settings,
             started_at, ended_at, opener, from_thread, changed_lines
         FROM agents_turns WHERE id = ?1",
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
    // Its messages are found in the fork too, once its turns say which
    // of them it shows.
    search::index_thread(sql, to)?;
    Ok(())
}

/// `body` with the lane it names, its anchor's or the one that asks, as
/// `lane_of` renames it.
fn lanes_named(mut body: Body, lane_of: impl Fn(SubagentId) -> Option<SubagentId>) -> Body {
    match &mut body {
        Body::Subagent { subagent: lane }
        | Body::Question {
            sub: Some(lane), ..
        } => {
            *lane = lane_of(*lane).unwrap_or(*lane);
        }
        _ => {}
    }
    body
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
             WHERE thread = ?1 AND turn = ?2 AND harness_message IS NOT NULL AND sub IS NULL
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
             WHERE thread = ?1 AND harness_message IS NOT NULL AND sub IS NULL
             AND rowid < (SELECT rowid FROM agents_items WHERE id = ?2)
             ORDER BY rowid DESC LIMIT 1",
            params![thread, message],
            |row| row.get(0),
        )
        .optional()?)
}

/// Takes `turn` and every turn of the Thread after it out, with their
/// items and their sub-agents (ADR 0103, Open questions). The images their
/// messages carried wait from `now` as a draft's do, so a message put back
/// in the composer keeps them.
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
    // What they said is no longer found in it.
    search::unindex(sql, &items, params![thread, turn])?;
    sql.execute(
        &format!("DELETE FROM agents_items WHERE id IN ({items})"),
        params![thread, turn],
    )?;
    // A seen that named one of them names none (ADR 0096, decision 2).
    sql.execute(
        &format!("UPDATE agents_threads SET seen = NULL WHERE id = ?1 AND seen IN ({LATER})"),
        params![thread, turn],
    )?;
    // Their sub-agents never happened in the session either; a nested one
    // has its root's turn, and its entries went with the items above.
    sql.execute(
        &format!("DELETE FROM agents_subagents WHERE thread = ?1 AND turn IN ({LATER})"),
        params![thread, turn],
    )?;
    sql.execute(
        &format!("DELETE FROM agents_turns WHERE id IN ({LATER})"),
        params![thread, turn],
    )?;
    Ok(())
}

/// Takes `thread` out of the Project for good, as its Person deletes it
/// (ADR 0098, decision 14): its turns, its items, its sub-agents' lanes,
/// the notices left for its Agent, and the row with its marks and its
/// Later. The images its
/// messages and tools carried wait as a draft's do, from when they were
/// added, so the sweep lets them go unless a fork's item shows them still.
/// Another Thread's turn it asked or answered keeps naming it, as what
/// happened there.
pub fn delete_thread(sql: &Connection, thread: ThreadId) -> Result<(), Error> {
    const ITEMS: &str = "SELECT id FROM agents_items WHERE thread = ?1";
    sql.execute(
        &format!("UPDATE agents_images SET item = NULL WHERE item IN ({ITEMS})"),
        params![thread],
    )?;
    // What it said is found nowhere (ADR 0098, decision 17).
    search::unindex(sql, ITEMS, params![thread])?;
    for each in [
        "DELETE FROM agents_notices WHERE thread = ?1",
        "DELETE FROM agents_items WHERE thread = ?1",
        "DELETE FROM agents_subagents WHERE thread = ?1",
        "DELETE FROM agents_turns WHERE thread = ?1",
        "DELETE FROM agents_threads WHERE id = ?1",
    ] {
        sql.execute(each, params![thread])?;
    }
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
    // Its row in the message index goes by its rowid, so it moves too.
    search::unindex(sql, "?1", params![id])?;
    sql.execute(
        "UPDATE agents_items SET rowid = (SELECT MAX(rowid) + 1 FROM agents_items) WHERE id = ?1",
        params![id],
    )?;
    search::index(sql, id)?;
    Ok(())
}

pub fn set_body(sql: &Connection, id: ItemId, body: &Body) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_items SET body = ?2 WHERE id = ?1",
        params![id, json(body)?],
    )?;
    // A message is searched as it reads now: edited, or grown by a piece.
    // Each piece indexes the whole reply again: on a reply of 20 KB in 400
    // pieces, about 0.3 ms a piece at its end, while the transcript gathers
    // pieces for 80 ms (`search::tests::cost` measures it on a real log).
    if matches!(body, Body::Message { .. }) {
        search::index(sql, id)?;
    }
    Ok(())
}

/// Writes an item the Agent sends, its own or, with `sub`, a lane's. A
/// reply or a thought comes in pieces: a piece of an item that is already
/// written adds its text to it. A reply keeps `named`, the ID the Harness
/// gave its message.
pub fn put(
    sql: &Connection,
    thread: ThreadId,
    item: &Item,
    named: Option<&str>,
    sub: Option<SubagentId>,
) -> Result<(), Error> {
    let Some((_, mut stored)) = self::item(sql, item.id)? else {
        insert_item(sql, thread, item, sub)?;
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

/// A Thread's items, in the order they came: its own, with its
/// sub-agents' Questions, which are the Thread's (ADR 0103, decision 8),
/// and none of its lanes' work.
pub fn items(sql: &Connection, thread: ThreadId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE thread = ?1 AND sub IS NULL ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![thread], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A Question of the Thread's that a lane asked, `?1`.
const ASKED_BY: &str = "sub IS NULL AND json_extract(body, '$.kind') = 'question' AND json_extract(body, '$.sub') = ?1";

/// The Thread of lane `?1`.
const LANES_THREAD: &str = "SELECT thread FROM agents_subagents WHERE id = ?1";

/// A lane's items, in the order they came: its own, and the Questions it
/// asked, which are its Thread's.
pub fn lane_items(sql: &Connection, sub: SubagentId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE thread = ({LANES_THREAD}) AND (sub = ?1 OR ({ASKED_BY})) ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![sub], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A lane's call that edits, deletes or moves files: what of a lane's work
/// its launch turn's changes count (ADR 0103, decision 8).
const LANE_EDIT: &str = "sub IS NOT NULL AND json_extract(body, '$.kind') = 'tool'
    AND json_extract(body, '$.tool') IN ('edit', 'delete', 'move')";

/// The calls of the Thread's lanes that edit, delete or move files, in the
/// order they came: what of their work its turns' changes count (ADR
/// 0103, decision 8). A call's kind is set as it starts, so a window that
/// follows the Thread's facts keeps the same ones.
pub fn edits(sql: &Connection, thread: ThreadId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE thread = ?1 AND {LANE_EDIT} ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![thread], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What `thread`'s `turn` changed in files is in the diffs of these, each
/// list in the order it came (`changes.rs`): the Agent's own tool calls of
/// it, and the [`edits`] of its sub-agents, which count in the turn they
/// started in.
pub fn turn_calls(
    sql: &Connection,
    thread: ThreadId,
    turn: TurnId,
) -> Result<(Vec<Item>, Vec<Item>), Error> {
    let of = |which: &str| -> Result<Vec<Item>, Error> {
        let mut statement = sql.prepare(&format!(
            "{ITEM} WHERE thread = ?1 AND turn = ?2 AND {which} ORDER BY rowid"
        ))?;
        let rows = statement.query_map(params![thread, turn], read_item)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    };
    let own = of("sub IS NULL AND json_extract(body, '$.kind') = 'tool'")?;
    Ok((own, of(LANE_EDIT)?))
}

/// An item that is a Question still waiting for an answer, with `?2`
/// bound to [`open_word`].
const OPEN_QUESTION: &str =
    "json_extract(body, '$.kind') = 'question' AND json_extract(body, '$.state') = ?2";

fn open_word() -> Result<String, Error> {
    Ok(json(&QuestionState::Open)?.trim_matches('"').to_owned())
}

/// The Agent's own Questions of a turn that still wait for an answer. A
/// lane's, which has its launch turn, closes as the lane ends, not with
/// the turn (ADR 0103, decision 8).
pub fn open_questions(sql: &Connection, turn: TurnId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE turn = ?1 AND {OPEN_QUESTION} AND json_extract(body, '$.sub') IS NULL
         ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![turn, open_word()?], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Questions lane `sub` asked that still wait for an answer.
pub fn lane_questions(sql: &Connection, sub: SubagentId) -> Result<Vec<Item>, Error> {
    let mut statement = sql.prepare(&format!(
        "{ITEM} WHERE thread = ({LANES_THREAD}) AND {ASKED_BY} AND {OPEN_QUESTION} ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![sub, open_word()?], read_item)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Thread's Questions that still wait for an answer, the first asked
/// first.
pub fn asking(sql: &Connection, thread: ThreadId) -> Result<Vec<Asking>, Error> {
    let mut statement = sql.prepare(&format!(
        "SELECT id, json_extract(body, '$.title'),
                CASE WHEN json_extract(body, '$.form') IS NULL
                      AND json_extract(body, '$.plan') IS NULL
                     THEN json_extract(body, '$.choices') END,
                json_extract(body, '$.sub')
         FROM agents_items
         WHERE thread = ?1 AND {OPEN_QUESTION} ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![thread, open_word()?], |row| {
        let choices = row
            .get::<_, Option<String>>(2)?
            .and_then(|said| serde_json::from_str(&said).ok())
            .unwrap_or_default();
        let question = Asking {
            item: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            choices,
            asker: None,
        };
        Ok((question, row.get::<_, Option<SubagentId>>(3)?))
    })?;
    rows.map(|row| {
        let (question, sub) = row?;
        let asker = match sub {
            Some(sub) => lane_label(sql, sub)?,
            None => None,
        };
        Ok(Asking { asker, ..question })
    })
    .collect()
}

/// What names sub-agent `sub` (ADR 0103, decision 17), among those started
/// beside it, by the same parent in the same turn; none for a lane no
/// longer kept.
pub fn lane_label(sql: &Connection, sub: SubagentId) -> Result<Option<String>, Error> {
    let Some(lane) = sql
        .query_row(&format!("{LANE} WHERE id = ?1"), params![sub], read_lane)
        .optional()?
    else {
        return Ok(None);
    };
    let mut statement = sql.prepare(&format!(
        "{LANE} WHERE thread = ({LANES_THREAD}) AND turn = ?2 AND parent IS ?3 ORDER BY rowid"
    ))?;
    let siblings = statement
        .query_map(params![sub, lane.turn, lane.parent], read_lane)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(crate::lanes::label(&lane, &siblings)))
}

/// The start of the latest message sent into the Thread: one a turn was
/// asked for, not an Agent's reply.
pub fn latest_message(sql: &Connection, thread: ThreadId) -> Result<Option<String>, Error> {
    let text: Option<Option<String>> = sql
        .query_row(
            "SELECT json_extract(i.body, '$.text') FROM agents_items i
             WHERE i.thread = ?1 AND i.sub IS NULL
             AND EXISTS (SELECT 1 FROM agents_turns t WHERE t.message = i.id)
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

/// A message item of `thread`'s that its Agent, `agent`, did not write,
/// nor any of its lanes: `?1` is the Thread and `?2` the Agent.
const SENT_IN: &str =
    "thread = ?1 AND sub IS NULL AND json_extract(body, '$.kind') = 'message' AND author != ?2";

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
             WHERE thread = ?1 AND author = ?2 AND sub IS NULL
                 AND json_extract(body, '$.kind') = 'message'
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
                "{ITEM} WHERE thread = ?1 AND sub IS NULL AND json_extract(body, '$.kind') = 'plan'
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
             WHERE thread = ?1 AND turn = ?2 AND author = ?3 AND sub IS NULL
                 AND json_extract(body, '$.kind') = 'message'
             ORDER BY rowid DESC LIMIT 1",
            params![thread, turn, json(&Participant::Agent(agent))?],
            |row| row.get(0),
        )
        .optional()?)
}

/// A lane as its row reads, then its Thread.
const LANE: &str = "SELECT id, turn, parent, title, role, model, state, why, can_stop,
    started_at, ended_at, prompt, report, thread FROM agents_subagents";

fn read_lane(row: &Row<'_>) -> rusqlite::Result<Subagent> {
    Ok(Subagent {
        id: row.get(0)?,
        turn: row.get(1)?,
        parent: row.get(2)?,
        title: row.get(3)?,
        role: row.get(4)?,
        model: row.get(5)?,
        state: word_of(row, 6)?,
        why: row.get(7)?,
        can_stop: row.get(8)?,
        started: row.get(9)?,
        ended: row.get(10)?,
        prompt: row.get(11)?,
        report: row.get(12)?,
    })
}

/// What [`insert_lane`] did.
#[derive(Debug, PartialEq)]
pub enum Upserted {
    /// The lane is new, and kept.
    New,
    /// The Thread keeps a lane for that child session already: this one, as
    /// kept. Nothing was written.
    Known(Box<Subagent>),
}

/// Keeps `lane`, a new sub-agent of `thread` that shows at `item`, for the
/// Harness's child session `evidence`; or, when the Thread keeps a lane
/// for that session already, as a child announced again, resumed or
/// replayed goes on in it, answers that one and writes nothing (ADR 0103,
/// decision 7).
pub fn insert_lane(
    sql: &Connection,
    thread: ThreadId,
    lane: &Subagent,
    item: ItemId,
    evidence: &impl Serialize,
) -> Result<Upserted, Error> {
    let evidence = json(evidence)?;
    let known = sql
        .query_row(
            &format!("{LANE} WHERE thread = ?1 AND evidence = ?2"),
            params![thread, evidence],
            read_lane,
        )
        .optional()?;
    if let Some(known) = known {
        return Ok(Upserted::Known(Box::new(known)));
    }
    sql.execute(
        "INSERT INTO agents_subagents (id, thread, turn, parent, item, title, role, model, state,
             why, can_stop, started_at, ended_at, prompt, report, evidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            lane.id,
            thread,
            lane.turn,
            lane.parent,
            item,
            lane.title,
            lane.role,
            lane.model,
            word(lane.state),
            lane.why,
            lane.can_stop,
            lane.started,
            lane.ended,
            lane.prompt,
            lane.report,
            evidence
        ],
    )?;
    Ok(Upserted::New)
}

/// Keeps what `lane` is now, by its ID; its Thread, turn, parent and
/// anchor stay.
pub fn set_lane(sql: &Connection, lane: &Subagent) -> Result<(), Error> {
    sql.execute(
        "UPDATE agents_subagents SET title = ?2, role = ?3, model = ?4, state = ?5, why = ?6,
             can_stop = ?7, ended_at = ?8, prompt = ?9, report = ?10
         WHERE id = ?1",
        params![
            lane.id,
            lane.title,
            lane.role,
            lane.model,
            word(lane.state),
            lane.why,
            lane.can_stop,
            lane.ended,
            lane.prompt,
            lane.report
        ],
    )?;
    Ok(())
}

/// One lane and its Thread.
pub fn subagent(sql: &Connection, id: SubagentId) -> Result<Option<(ThreadId, Subagent)>, Error> {
    Ok(sql
        .query_row(&format!("{LANE} WHERE id = ?1"), params![id], |row| {
            Ok((row.get(13)?, read_lane(row)?))
        })
        .optional()?)
}

/// The Thread's lanes, nested ones too, in the order they started.
pub fn subagents(sql: &Connection, thread: ThreadId) -> Result<Vec<Subagent>, Error> {
    let mut statement = sql.prepare(&format!("{LANE} WHERE thread = ?1 ORDER BY rowid"))?;
    let rows = statement.query_map(params![thread], read_lane)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The lanes lane `sub` started, in the order they started.
pub fn children(sql: &Connection, sub: SubagentId) -> Result<Vec<Subagent>, Error> {
    let mut statement = sql.prepare(&format!(
        "{LANE} WHERE thread = ({LANES_THREAD}) AND parent = ?1 ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![sub], read_lane)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The states of a lane at work, as its row keeps them: it runs or asks.
fn at_work() -> [String; 2] {
    AT_WORK.map(word)
}

/// The states of a lane at work, as [`SubagentState::works`] has them.
const AT_WORK: [SubagentState; 2] = [SubagentState::Running, SubagentState::Asks];

/// Whether a lane of the Thread is at work, and a direct one.
pub fn lanes_at_work(sql: &Connection, thread: ThreadId) -> Result<Lanes, Error> {
    let [running, asks] = at_work();
    let (work, direct) = sql.query_row(
        "SELECT EXISTS (SELECT 1 FROM agents_subagents
                        WHERE thread = ?1 AND state IN (?2, ?3)),
                EXISTS (SELECT 1 FROM agents_subagents
                        WHERE thread = ?1 AND state IN (?2, ?3) AND parent IS NULL)",
        params![thread, running, asks],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(Lanes { work, direct })
}

/// Whether a lane of the Thread has not ended: it works, or waits for a
/// slot in a Crew (ADR 0103).
pub fn lanes_unended(sql: &Connection, thread: ThreadId) -> Result<bool, Error> {
    let [running, asks] = at_work();
    Ok(sql.query_row(
        "SELECT EXISTS (SELECT 1 FROM agents_subagents
                        WHERE thread = ?1 AND state IN (?2, ?3, ?4))",
        params![thread, running, asks, word(SubagentState::Queued)],
        |row| row.get(0),
    )?)
}

/// Whether a lane of any of the Project's Threads is at work.
pub fn any_lane_at_work(sql: &Connection) -> Result<bool, Error> {
    let [running, asks] = at_work();
    Ok(sql.query_row(
        "SELECT EXISTS (SELECT 1 FROM agents_subagents WHERE state IN (?1, ?2))",
        params![running, asks],
        |row| row.get(0),
    )?)
}

/// The Project's lanes at work, each with its Thread, in the order they
/// started.
pub fn every_lane_at_work(sql: &Connection) -> Result<Vec<(ThreadId, Subagent)>, Error> {
    let [running, asks] = at_work();
    let mut statement = sql.prepare(&format!("{LANE} WHERE state IN (?1, ?2) ORDER BY rowid"))?;
    let rows = statement.query_map(params![running, asks], |row| {
        Ok((row.get(13)?, read_lane(row)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The words of lane `sub`'s last reply, if it replied.
pub fn last_lane_reply(sql: &Connection, sub: SubagentId) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT json_extract(body, '$.text') FROM agents_items
             WHERE sub = ?1 AND json_extract(body, '$.kind') = 'message'
             ORDER BY rowid DESC LIMIT 1",
            params![sub],
            |row| row.get(0),
        )
        .optional()?)
}

/// The Thread's lane at work that started last, if one is.
pub fn newest_lane_at_work(sql: &Connection, thread: ThreadId) -> Result<Option<Subagent>, Error> {
    Ok(lanes_in(sql, thread, &AT_WORK)?.pop())
}

/// The Thread's lanes in any of `states`, in the order they started.
pub fn lanes_in(
    sql: &Connection,
    thread: ThreadId,
    states: &[SubagentState],
) -> Result<Vec<Subagent>, Error> {
    let words: Vec<String> = states.iter().copied().map(word).collect();
    let mut statement = sql.prepare(&format!(
        "{LANE} WHERE thread = ?1 AND state IN (SELECT value FROM json_each(?2)) ORDER BY rowid"
    ))?;
    let rows = statement.query_map(params![thread, json(&words)?], read_lane)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Whether another Thread works on what `thread`'s Agent asked it (ADR
/// 0019, decision 4): its last reply comes back here once its turn ends.
pub fn awaited(sql: &Connection, thread: ThreadId) -> Result<bool, Error> {
    let ongoing = [TurnState::Queued, TurnState::Running].map(word);
    Ok(sql.query_row(
        "SELECT EXISTS (SELECT 1 FROM agents_turns
         WHERE from_thread = ?1 AND opener = ?2 AND state IN (?3, ?4))",
        params![thread, word(Opener::Asked), ongoing[0], ongoing[1]],
        |row| row.get(0),
    )?)
}

/// Every Visual an item of `thread` names (ADR 0037).
pub fn thread_visuals(sql: &Connection, thread: ThreadId) -> Result<Vec<VisualId>, Error> {
    let mut named = sql.prepare(
        "SELECT json_extract(body, '$.visual') FROM agents_items \
         WHERE thread = ?1 AND json_extract(body, '$.kind') = 'visual' ORDER BY rowid",
    )?;
    let ids = named.query_map(params![thread], |row| row.get(0))?;
    Ok(ids.collect::<Result<_, _>>()?)
}

/// Each table that holds a Thread's rows, its own first, and which of
/// their rows are the Thread's, with `?1` its ID. A table added later that
/// holds a Thread's rows joins it, or a move leaves them behind. Its
/// images' rows go apart ([`thread_images`]), and the index of its
/// messages is written again where they go ([`search`]).
const THREAD_TABLES: [(&str, &str); 5] = [
    ("agents_threads", "id = ?1"),
    ("agents_turns", "thread = ?1"),
    ("agents_items", "thread = ?1"),
    ("agents_notices", "thread = ?1"),
    // Its sub-agents' lanes (ADR 0103), whose entries are its items.
    ("agents_subagents", "thread = ?1"),
];

/// A Thread whole, as the module's tables hold it: each table's rows of
/// it, in the order they were written, with the columns' names. Every
/// Project's store has the same columns, as each ran the same migrations,
/// so a Thread moves to another Project as these rows (ADR 0098,
/// decision 14).
#[derive(Clone, Debug, PartialEq)]
pub struct ThreadRows(Vec<TableRows>);

#[derive(Clone, Debug, PartialEq)]
struct TableRows {
    table: &'static str,
    columns: Vec<String>,
    rows: Vec<Vec<rusqlite::types::Value>>,
}

impl ThreadRows {
    /// `thread`'s rows, or none for a Thread there is not.
    pub fn read(sql: &Connection, thread: ThreadId) -> Result<Option<ThreadRows>, Error> {
        let mut tables = Vec::with_capacity(THREAD_TABLES.len());
        for (table, whose) in THREAD_TABLES {
            let mut statement = sql.prepare(&format!(
                "SELECT * FROM {table} WHERE {whose} ORDER BY rowid"
            ))?;
            let columns: Vec<String> = statement.column_names().map(str::to_owned).collect();
            let width = columns.len();
            let rows = statement.query_map(params![thread], |row| {
                (0..width).map(|at| row.get(at)).collect()
            })?;
            let rows = rows.collect::<rusqlite::Result<Vec<Vec<_>>>>()?;
            tables.push(TableRows {
                table,
                columns,
                rows,
            });
        }
        let found = tables.first().is_some_and(|own| !own.rows.is_empty());
        Ok(found.then_some(ThreadRows(tables)))
    }

    /// Writes the rows in another Project's store, in the order they were
    /// written, so each list reads as it did.
    pub fn insert(&self, sql: &Connection) -> Result<(), Error> {
        for TableRows {
            table,
            columns,
            rows,
        } in &self.0
        {
            let marks = vec!["?"; columns.len()].join(", ");
            let mut statement = sql.prepare(&format!(
                "INSERT INTO {table} ({}) VALUES ({marks})",
                columns.join(", ")
            ))?;
            for row in rows {
                statement.execute(rusqlite::params_from_iter(row))?;
            }
        }
        Ok(())
    }

    /// Whether these rows, a Thread's in the Project it moved to, are
    /// `came`, the rows it moved with, and the one notice that says it
    /// came, kept for its Agent: nothing of it went on there since.
    pub fn came_with(&self, came: &ThreadRows) -> bool {
        const SAID: [&str; 2] = ["agents_items", "agents_notices"];
        self.0.len() == came.0.len()
            && self.0.iter().zip(&came.0).all(|(here, came)| {
                let said = usize::from(SAID.contains(&here.table));
                here.table == came.table
                    && here.rows.len() == came.rows.len() + said
                    && here.rows.starts_with(&came.rows)
            })
    }

    /// The folders of kept files beneath `kept`, a Project's
    /// ([`crate::kept::folder`]), its Person's messages in these rows name:
    /// each by its name, a UUID, as a message names a file in one by its
    /// absolute path. Only a Person keeps a file for a message
    /// (`agents.keep`), so what an Agent wrote names none that goes.
    pub fn kept_in(&self, kept: &Path) -> Vec<String> {
        let [_, way] = beneath(kept);
        let mut named = std::collections::BTreeSet::new();
        for text in self.persons_messages() {
            for (at, _) in text.match_indices(&way) {
                let id = text.get(at + way.len()..at + way.len() + 36);
                // Named as the folder is, which is how it is named there.
                let named_so =
                    |id: &&str| uuid::Uuid::try_parse(id).is_ok_and(|u| u.to_string() == *id);
                if let Some(id) = id.filter(named_so) {
                    named.insert(id.to_owned());
                }
            }
        }
        named.into_iter().collect()
    }

    /// These rows, each path they name in one of `kept`, folders of kept
    /// files beneath `from`, the Project's they leave, named beneath `to`
    /// instead, the one's they move to.
    pub fn kept_moved(&self, from: &Path, to: &Path, kept: &[String]) -> ThreadRows {
        let ways: Vec<(String, String)> = (beneath(from).into_iter().zip(beneath(to)))
            .flat_map(|(from, to)| {
                let named = |name: &String| (format!("{from}{name}"), format!("{to}{name}"));
                kept.iter().map(named).collect::<Vec<_>>()
            })
            .collect();
        let mut moved = self.clone();
        let values = moved.0.iter_mut().flat_map(|table| &mut table.rows);
        for value in values.flatten() {
            if let rusqlite::types::Value::Text(text) = value {
                for (from, to) in &ways {
                    if text.contains(from.as_str()) {
                        *text = text.replace(from.as_str(), to);
                    }
                }
            }
        }
        moved
    }

    /// These rows, the Thread's own row's `column` `text` instead.
    pub fn with_own(mut self, column: &str, text: String) -> ThreadRows {
        if let Some(own) = self.0.first_mut()
            && let Some(at) = own.columns.iter().position(|named| named == column)
            && let Some(row) = own.rows.first_mut()
        {
            row[at] = rusqlite::types::Value::Text(text);
        }
        self
    }

    /// The text of each message its Person wrote in these rows.
    fn persons_messages(&self) -> impl Iterator<Item = String> + '_ {
        use rusqlite::types::Value;
        let items = self.0.iter().filter(|table| table.table == "agents_items");
        items.flat_map(|table| {
            let at = |name: &str| table.columns.iter().position(|named| named == name);
            let (author, body) = (at("author"), at("body"));
            table.rows.iter().filter_map(move |row| {
                let text = |at: Option<usize>| match row.get(at?)? {
                    Value::Text(text) => Some(text.as_str()),
                    _ => None,
                };
                let by: Participant = serde_json::from_str(text(author)?).ok()?;
                if by.agent().is_some() {
                    return None;
                }
                match serde_json::from_str(text(body)?).ok()? {
                    Body::Message { text, .. } => Some(text),
                    _ => None,
                }
            })
        })
    }
}

/// How a row's text names a path beneath `folder`: as a JSON string
/// writes it, as an item's body does, then as it is.
fn beneath(folder: &Path) -> [String; 2] {
    let plain = folder.join("").display().to_string();
    let json = serde_json::Value::from(plain.as_str()).to_string();
    [json[1..json.len() - 1].to_owned(), plain]
}

/// An image a Thread's items name, as the store keeps it, for another
/// Project's store as the Thread moves there: with the item that carries
/// it when that is one of the Thread's. A fork's items name their
/// source's images, whose items stay the source's (ADR 0027).
#[derive(Clone, Debug, PartialEq)]
pub struct ImageRow {
    pub image: Image,
    author: String,
    added_at: i64,
    item: Option<ItemId>,
}

/// The images `thread`'s items name, as [`drop_unsent_images`] reads
/// what an item names, and those its items carry.
pub fn thread_images(sql: &Connection, thread: ThreadId) -> Result<Vec<ImageRow>, Error> {
    const ITEMS: &str = "SELECT id FROM agents_items WHERE thread = ?1";
    let mut named = sql.prepare(&format!(
        "SELECT id, mime, name, size, author, added_at,
           CASE WHEN item IN ({ITEMS}) THEN item END
         FROM agents_images WHERE item IN ({ITEMS}) OR id IN (
           SELECT json_extract(image.value, '$.id')
           FROM agents_items, json_each(agents_items.body, '$.images') AS image
           WHERE agents_items.thread = ?1
           UNION
           SELECT json_extract(part.value, '$.image.id')
           FROM agents_items, json_each(agents_items.body, '$.content') AS part
           WHERE agents_items.thread = ?1 AND json_extract(part.value, '$.kind') = 'image'
         ) ORDER BY rowid"
    ))?;
    let rows = named.query_map(params![thread], |row| {
        Ok(ImageRow {
            image: Image {
                id: row.get(0)?,
                mime: row.get(1)?,
                name: row.get(2)?,
                size: row.get(3)?,
            },
            author: row.get(4)?,
            added_at: row.get(5)?,
            item: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Keeps `images`, a Thread's that came here whole, after its items. One
/// kept here already stays, given its item if it had none.
pub fn keep_images(sql: &Connection, images: &[ImageRow]) -> Result<(), Error> {
    let mut keep = sql.prepare(
        "INSERT INTO agents_images (id, mime, name, size, author, added_at, item)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET item = COALESCE(agents_images.item, excluded.item)",
    )?;
    for ImageRow {
        image,
        author,
        added_at,
        item,
    } in images
    {
        keep.execute(params![
            image.id, image.mime, image.name, image.size, author, added_at, item
        ])?;
    }
    Ok(())
}

/// Takes `thread` out of the module's tables, every row of it, and its
/// messages out of the index. The images its items carried wait from
/// `now` as a draft's do, and go with the sweep unless an item left here
/// names them, as a fork's.
pub fn forget_thread(sql: &Connection, thread: ThreadId, now: i64) -> Result<(), Error> {
    const ITEMS: &str = "SELECT id FROM agents_items WHERE thread = ?1";
    sql.execute(
        &format!("UPDATE agents_images SET item = NULL, added_at = ?2 WHERE item IN ({ITEMS})"),
        params![thread, now],
    )?;
    search::unindex(sql, ITEMS, params![thread])?;
    for (table, whose) in THREAD_TABLES.iter().rev() {
        sql.execute(
            &format!("DELETE FROM {table} WHERE {whose}"),
            params![thread],
        )?;
    }
    Ok(())
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
        // As an engine of then wrote its items.
        let old = |body: Body| {
            let item = ItemId::new();
            sql.execute(
                "INSERT INTO agents_items (id, thread, author, at, body) VALUES (?1, ?2, ?3, 0, ?4)",
                params![item, summary.id, json(&author).unwrap(), json(&body).unwrap()],
            )
            .unwrap();
            let turn = TurnId::new();
            sql.execute(
                "INSERT INTO agents_turns (id, thread, agent, author, message, state, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'done', 0)",
                params![turn, summary.id, agent, json(&author).unwrap(), item],
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
        let listed = || threads(&sql, &AtWork::new()).unwrap().remove(0);
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
                    sub: None,
                },
            };
            insert_item(&sql, summary.id, &item, None).unwrap();
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
    fn a_listed_thread_says_how_many_lines_its_latest_turn_that_ended_changed() {
        let sql = migrated();
        let agent = AgentId::new();
        let author = Participant::Agent(agent);
        let settings = Settings::default();
        let summary = |title: &str| ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: title.to_owned(),
            updated_at: 0,
            was: None,
        };
        let (thread, fork) = (summary("Hello"), summary("Hello fork"));
        insert_thread(&sql, &thread, agent, author, &settings).unwrap();
        insert_thread(&sql, &fork, agent, author, &settings).unwrap();
        let listed = |id: ThreadId| {
            let all = threads(&sql, &AtWork::new()).unwrap();
            all.into_iter().find(|t| t.thread.id == id).unwrap()
        };
        let mut at = 0;
        let mut add = |state: TurnState| {
            at += 1;
            let turn = Turn {
                id: TurnId::new(),
                thread: thread.id,
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
        let lines = Some(ChangedLines {
            added: 38,
            removed: 9,
        });
        let first = add(TurnState::Running);
        set_turn(&sql, first, TurnState::Done, None, None, 5).unwrap();
        set_changed_lines(&sql, first, lines).unwrap();
        assert_eq!(listed(thread.id).changed_lines, lines);

        let second = add(TurnState::Running);
        add(TurnState::Withdrawn);
        assert_eq!(
            listed(thread.id).changed_lines,
            lines,
            "the one before's, while another runs or was taken back"
        );
        copy_turns(&sql, (thread.id, agent), first, (fork.id, agent)).unwrap();
        assert_eq!(listed(fork.id).changed_lines, lines, "a fork keeps it");
        set_turn(&sql, second, TurnState::Stopped, None, None, 9).unwrap();
        set_changed_lines(&sql, second, None).unwrap();
        assert_eq!(listed(thread.id).changed_lines, None, "it changed none");
    }

    #[test]
    fn a_turn_s_calls_are_its_own_tools_and_its_lanes_edits() {
        use crate::model::ToolKind;
        let kept = kept();
        let (turn, _) = kept.turn("Fix it");
        let (other, _) = kept.turn("And this");
        let lane = kept.lane(turn, None);
        let first = kept.put(Some(turn), call(ToolKind::Read), None);
        kept.put(Some(turn), reply("Looking"), None);
        let edited = kept.put(Some(turn), call(ToolKind::Edit), Some(lane.id));
        kept.put(Some(turn), call(ToolKind::Read), Some(lane.id));
        let later = kept.lane(other, None);
        kept.put(Some(other), call(ToolKind::Edit), Some(later.id));
        kept.put(Some(other), call(ToolKind::Edit), None);
        kept.put(None, call(ToolKind::Edit), None);
        let moved = kept.put(Some(turn), call(ToolKind::Move), Some(lane.id));
        let last = kept.put(Some(turn), call(ToolKind::Edit), None);
        let (own, edits) = turn_calls(&kept.sql, kept.thread, turn).unwrap();
        assert_eq!(kept.ids(own), [first, last], "its own tool calls");
        assert_eq!(kept.ids(edits), [edited, moved], "its lanes' edits");
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
        let mut named: Vec<_> = threads(&sql, &AtWork::new())
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
    fn a_thread_from_before_is_the_child_of_the_agent_that_started_it() {
        let sql = Connection::open_in_memory().unwrap();
        let at = MIGRATIONS
            .iter()
            .position(|m| m.contains("ADD COLUMN parent"))
            .unwrap();
        let (before, from) = MIGRATIONS.split_at(at);
        for migration in before {
            sql.execute_batch(migration).unwrap();
        }
        let person = Participant::Person(banda_kernel::PersonId::new());
        let started = |title: &str, author: Participant, updated_at: i64| {
            let summary = ThreadSummary {
                id: ThreadId::new(),
                harness: "fake".to_owned(),
                title: title.to_owned(),
                updated_at,
                was: None,
            };
            let agent = AgentId::new();
            insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
            (summary.id, agent)
        };
        let (plan, planner) = started("Plan", person, 1);
        let (child, _) = started("Look around", Participant::Agent(planner), 2);
        let (own, _) = started("By hand", person, 3);
        let (fork, _) = started("Plan fork", Participant::Agent(planner), 4);
        set_forked_from(&sql, fork, plan).unwrap();
        let (stray, _) = started(
            "By an Agent now gone",
            Participant::Agent(AgentId::new()),
            5,
        );
        for migration in from {
            sql.execute_batch(migration).unwrap();
        }
        let parents: HashMap<_, _> = threads(&sql, &AtWork::new())
            .unwrap()
            .into_iter()
            .map(|t| (t.thread.id, t.parent))
            .collect();
        assert_eq!(parents[&child], Some(plan), "its Agent's Thread");
        for none in [plan, own, fork, stray] {
            assert_eq!(parents[&none], None);
        }
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
            put(&sql, summary.id, &item, None, None).unwrap();
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
        put(&sql, summary.id, &item, None, None).unwrap();
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

    /// A Thread of its own Agent, kept in a store of every step, to write
    /// turns, items and lanes into.
    struct Kept {
        sql: Connection,
        thread: ThreadId,
        agent: AgentId,
    }

    fn kept() -> Kept {
        let kept = Kept {
            sql: migrated(),
            thread: ThreadId::new(),
            agent: AgentId::new(),
        };
        kept.thread_of(kept.thread, kept.agent);
        kept
    }

    fn reply(text: &str) -> Body {
        Body::Message {
            text: text.into(),
            images: Vec::new(),
            answers: false,
        }
    }

    fn call(tool: crate::model::ToolKind) -> Body {
        Body::Tool {
            title: format!("{tool:?}"),
            tool,
            status: crate::model::ToolStatus::Done,
            content: Vec::new(),
            output: None,
        }
    }

    fn question(title: &str, sub: Option<SubagentId>) -> Body {
        Body::Question {
            title: title.into(),
            choices: Vec::new(),
            form: None,
            plan: None,
            state: QuestionState::Open,
            answer: None,
            values: None,
            sub,
        }
    }

    impl Kept {
        fn thread_of(&self, thread: ThreadId, agent: AgentId) {
            let summary = ThreadSummary {
                id: thread,
                harness: "fake".into(),
                title: "Move the settings".into(),
                updated_at: 0,
                was: None,
            };
            let author = Participant::Agent(agent);
            insert_thread(&self.sql, &summary, agent, author, &Settings::default()).unwrap();
        }

        /// A Person's message and the turn that ran it, done.
        fn turn(&self, text: &str) -> (TurnId, ItemId) {
            let message = Item {
                id: ItemId::new(),
                turn: None,
                author: Participant::Person(PersonId::new()),
                at: 0,
                body: reply(text),
            };
            insert_item(&self.sql, self.thread, &message, None).unwrap();
            let turn = Turn {
                id: TurnId::new(),
                thread: self.thread,
                agent: self.agent,
                message: message.id,
                state: TurnState::Done,
                opener: Opener::Person,
                from_thread: None,
                stopping: false,
            };
            let author = message.author;
            insert_turn(&self.sql, &turn, author, 0, &Settings::default()).unwrap();
            set_item_turn(&self.sql, message.id, Some(turn.id)).unwrap();
            (turn.id, message.id)
        }

        /// What the Agent writes in `turn`: its own, or with `sub`, a lane's.
        fn put(&self, turn: Option<TurnId>, body: Body, sub: Option<SubagentId>) -> ItemId {
            self.named(turn, body, None, sub)
        }

        fn named(
            &self,
            turn: Option<TurnId>,
            body: Body,
            named: Option<&str>,
            sub: Option<SubagentId>,
        ) -> ItemId {
            let item = Item {
                id: ItemId::new(),
                turn,
                author: Participant::Agent(self.agent),
                at: 0,
                body,
            };
            put(&self.sql, self.thread, &item, named, sub).unwrap();
            item.id
        }

        /// A lane that started in `turn`, under `parent` if given, and its
        /// anchor where it started: the Thread's, or its parent's lane's.
        fn lane(&self, turn: TurnId, parent: Option<SubagentId>) -> Subagent {
            let lane = Subagent {
                id: SubagentId::new(),
                turn,
                parent,
                title: "Read the settings".into(),
                role: Some("Explore".into()),
                model: None,
                state: SubagentState::Done,
                why: None,
                can_stop: false,
                started: 1,
                ended: Some(2),
                prompt: Some("Find where the sidebar reads them".into()),
                report: Some("In sidebar.ts".into()),
            };
            let anchor = Body::Subagent { subagent: lane.id };
            let item = self.put(Some(turn), anchor, parent);
            let child = json!({ "session": lane.id.to_string() });
            let kept = insert_lane(&self.sql, self.thread, &lane, item, &child).unwrap();
            assert_eq!(kept, Upserted::New);
            lane
        }

        fn ids(&self, items: Vec<Item>) -> Vec<ItemId> {
            items.into_iter().map(|item| item.id).collect()
        }
    }

    use banda_kernel::PersonId;
    use serde_json::json;

    #[test]
    fn the_lanes_migration_keeps_every_thread() {
        let sql = Connection::open_in_memory().unwrap();
        let at = MIGRATIONS
            .iter()
            .position(|m| m.contains("CREATE TABLE agents_subagents"))
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
        let old = Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 3,
            body: reply("From before sub-agents"),
        };
        // As an engine from before wrote it.
        sql.execute(
            "INSERT INTO agents_items (id, thread, turn, author, at, body)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![
                old.id,
                summary.id,
                json(&author).unwrap(),
                old.at,
                json(&old.body).unwrap()
            ],
        )
        .unwrap();
        for migration in from {
            sql.execute_batch(migration).unwrap();
        }
        assert_eq!(items(&sql, summary.id).unwrap(), [old]);
        assert!(edits(&sql, summary.id).unwrap().is_empty());
        assert!(subagents(&sql, summary.id).unwrap().is_empty());
        let listed = threads(&sql, &AtWork::new()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].thread, summary);
        assert!(!lanes_at_work(&sql, summary.id).unwrap().work);
    }

    #[test]
    fn a_lanes_question_is_the_threads_entry_and_its_work_the_lanes() {
        let kept = kept();
        let (turn, message) = kept.turn("Review it");
        let lane = kept.lane(turn, None);
        let own_reply = kept.put(Some(turn), reply("Looking"), None);
        let work = kept.put(
            Some(turn),
            call(crate::model::ToolKind::Execute),
            Some(lane.id),
        );
        let asked = kept.put(Some(turn), question("Run pnpm test?", Some(lane.id)), None);
        let own = kept.put(Some(turn), question("Edit a.ts?", None), None);

        let anchor = kept.ids(items(&kept.sql, kept.thread).unwrap())[1];
        assert_eq!(
            kept.ids(items(&kept.sql, kept.thread).unwrap()),
            [message, anchor, own_reply, asked, own],
            "the Thread keeps its sub-agent's Question, not its work"
        );
        assert_eq!(
            kept.ids(open_questions(&kept.sql, turn).unwrap()),
            [own],
            "the turn's end closes only the Agent's own"
        );
        assert_eq!(
            kept.ids(lane_questions(&kept.sql, lane.id).unwrap()),
            [asked]
        );
        assert_eq!(
            kept.ids(lane_items(&kept.sql, lane.id).unwrap()),
            [work, asked]
        );
        let asking: Vec<_> = (asking(&kept.sql, kept.thread).unwrap().into_iter())
            .map(|a| a.item)
            .collect();
        assert_eq!(asking, [asked, own], "the Thread asks for both");
        assert!(asks(&kept.sql, kept.thread).unwrap());
    }

    #[test]
    fn a_listed_question_says_its_sub_agents_label() {
        let kept = kept();
        let (turn, _) = kept.turn("Review it");
        let lane = kept.lane(turn, None);
        let asks = |sub| question("Run pnpm test?", sub);
        kept.put(Some(turn), asks(Some(lane.id)), None);
        kept.put(Some(turn), asks(None), None);
        let askers: Vec<_> = (asking(&kept.sql, kept.thread).unwrap().into_iter())
            .map(|a| a.asker)
            .collect();
        assert_eq!(
            askers,
            [Some("Explore".to_owned()), None],
            "by its role, and none for the Agent's own"
        );
        // A Codex one of its turn, named by its number among its siblings.
        let mut bare = kept.lane(turn, None);
        bare.title = "Agent".into();
        bare.role = None;
        set_lane(&kept.sql, &bare).unwrap();
        assert_eq!(
            lane_label(&kept.sql, bare.id).unwrap().as_deref(),
            Some("Agent 2")
        );
        assert_eq!(lane_label(&kept.sql, SubagentId::new()).unwrap(), None);
    }

    #[test]
    fn a_lane_is_kept_once_per_child_session() {
        let kept = kept();
        let (turn, _) = kept.turn("Review it");
        let lane = kept.lane(turn, None);
        let rowid = |id: SubagentId| -> i64 {
            kept.sql
                .query_row(
                    "SELECT rowid FROM agents_subagents WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        let first = rowid(lane.id);
        let child = json!({ "session": lane.id.to_string() });
        let again = Subagent {
            id: SubagentId::new(),
            title: "Announced again".into(),
            ..lane.clone()
        };
        let kept_again =
            insert_lane(&kept.sql, kept.thread, &again, ItemId::new(), &child).unwrap();
        assert_eq!(
            kept_again,
            Upserted::Known(Box::new(lane.clone())),
            "as it was kept"
        );
        assert_eq!(rowid(lane.id), first, "in its place");
        assert_eq!(
            subagents(&kept.sql, kept.thread).unwrap(),
            std::slice::from_ref(&lane)
        );

        // Another Thread keeps its own lane for a session of that name.
        let (other, agent) = (ThreadId::new(), AgentId::new());
        kept.thread_of(other, agent);
        let theirs = insert_lane(&kept.sql, other, &again, ItemId::new(), &child).unwrap();
        assert_eq!(theirs, Upserted::New);
        assert_eq!(subagents(&kept.sql, other).unwrap(), [again]);
    }

    #[test]
    fn a_lane_changes_in_place_and_says_whether_it_works() {
        let kept = kept();
        let (turn, _) = kept.turn("Review it");
        let done = kept.lane(turn, None);
        let mut working = kept.lane(turn, None);
        let nested = kept.lane(turn, Some(working.id));
        assert!(!lanes_at_work(&kept.sql, kept.thread).unwrap().work);
        assert!(!any_lane_at_work(&kept.sql).unwrap());

        working.state = SubagentState::Asks;
        working.ended = None;
        working.title = String::new();
        working.can_stop = true;
        set_lane(&kept.sql, &working).unwrap();
        assert_eq!(
            subagent(&kept.sql, working.id).unwrap(),
            Some((kept.thread, working.clone()))
        );
        let lanes = lanes_at_work(&kept.sql, kept.thread).unwrap();
        assert!(lanes.work && lanes.direct);
        assert!(any_lane_at_work(&kept.sql).unwrap());

        // Only a nested one at work: fork and rewind wait, Stop does not
        // reach it.
        working.state = SubagentState::Stopped;
        set_lane(&kept.sql, &working).unwrap();
        let running = Subagent {
            state: SubagentState::Running,
            ..nested.clone()
        };
        set_lane(&kept.sql, &running).unwrap();
        let lanes = lanes_at_work(&kept.sql, kept.thread).unwrap();
        assert!(lanes.work && !lanes.direct);
        let all = subagents(&kept.sql, kept.thread).unwrap();
        assert_eq!(
            all.iter().map(|lane| lane.id).collect::<Vec<_>>(),
            [done.id, working.id, nested.id],
            "in the order they started"
        );
        let by_state = |states: &[SubagentState]| -> Vec<SubagentId> {
            (lanes_in(&kept.sql, kept.thread, states)
                .unwrap()
                .into_iter())
            .map(|lane| lane.id)
            .collect()
        };
        assert_eq!(by_state(&[SubagentState::Running]), [nested.id]);
        assert_eq!(
            by_state(&[SubagentState::Done, SubagentState::Stopped]),
            [done.id, working.id]
        );
        assert_eq!(children(&kept.sql, working.id).unwrap(), [running]);
        assert_eq!(subagent(&kept.sql, SubagentId::new()).unwrap(), None);
    }

    #[test]
    fn lanes_keep_the_order_they_were_kept_in_not_their_starts_or_ids() {
        let kept = kept();
        let (turn, _) = kept.turn("Review it");
        // Kept last, with an ID made first and a start said as earlier.
        let late = SubagentId::new();
        let parent = kept.lane(turn, None);
        let first = kept.lane(turn, Some(parent.id));
        let last = Subagent {
            id: late,
            started: 0,
            ..first.clone()
        };
        let anchor = kept.put(
            Some(turn),
            Body::Subagent { subagent: late },
            Some(parent.id),
        );
        let child = json!({ "session": late.to_string() });
        let new = insert_lane(&kept.sql, kept.thread, &last, anchor, &child).unwrap();
        assert_eq!(new, Upserted::New);
        let ids = (subagents(&kept.sql, kept.thread).unwrap().into_iter())
            .map(|lane| lane.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, [parent.id, first.id, late]);
        assert_eq!(children(&kept.sql, parent.id).unwrap(), [first, last]);
    }

    #[test]
    fn lane_rows_stay_out_of_replies_plans_and_handoff_turns() {
        use crate::model::StepState;
        let kept = kept();
        let (turn, _) = kept.turn("Review it");
        run_on(&kept.sql, turn).unwrap();
        let lane = kept.lane(turn, None);
        let steps = |text: &str| Body::Plan {
            steps: vec![PlanStep {
                text: text.into(),
                state: StepState::Pending,
            }],
        };
        let own_plan = kept.put(Some(turn), steps("The Agent's plan"), None);
        let own = kept.named(Some(turn), reply("The Agent's reply"), Some("own"), None);
        kept.put(Some(turn), steps("The lane's plan"), Some(lane.id));
        kept.named(
            Some(turn),
            reply("The lane's reply"),
            Some("lane's"),
            Some(lane.id),
        );
        // What a lane's parent wrote to it, which no Person sent.
        let brief = Item {
            id: ItemId::new(),
            turn: Some(turn),
            author: Participant::Person(PersonId::new()),
            at: 0,
            body: reply("The lane's brief"),
        };
        insert_item(&kept.sql, kept.thread, &brief, Some(lane.id)).unwrap();
        let (next, message) = kept.turn("Go on");
        // The lane asks late: its Question has the lane's launch turn and
        // comes after the next turn's message.
        kept.put(Some(turn), question("Run it?", Some(lane.id)), None);

        let (sql, thread, agent) = (&kept.sql, kept.thread, kept.agent);
        assert_eq!(
            last_named_reply(sql, thread, turn).unwrap().as_deref(),
            Some("own")
        );
        assert_eq!(
            named_reply_before(sql, thread, message).unwrap().as_deref(),
            Some("own")
        );
        let own_words = Some("The Agent's reply".to_owned());
        assert_eq!(latest_reply(sql, thread, agent).unwrap(), own_words);
        assert_eq!(last_reply(sql, thread, turn, agent).unwrap(), own_words);
        let plan = latest_plan(sql, thread).unwrap();
        assert_eq!(plan[0].text, "The Agent's plan", "not {own_plan}'s lane");
        assert_eq!(
            latest_messages(sql, thread, agent, 5).unwrap(),
            ["Go on", "Review it"]
        );
        assert_eq!(
            turns_ran(sql, thread, next).unwrap(),
            [("fake".to_owned(), Some(own))],
            "a handoff reads to the Agent's own last item"
        );
    }

    #[test]
    fn edits_are_a_lanes_edit_delete_and_move_calls() {
        use crate::model::ToolKind;
        let kept = kept();
        let (turn, _) = kept.turn("Fix it");
        let lane = kept.lane(turn, None);
        kept.put(Some(turn), call(ToolKind::Edit), None);
        let mut lanes = Vec::new();
        for tool in [
            ToolKind::Read,
            ToolKind::Edit,
            ToolKind::Execute,
            ToolKind::Delete,
            ToolKind::Move,
            ToolKind::Search,
        ] {
            let id = kept.put(Some(turn), call(tool), Some(lane.id));
            if matches!(tool, ToolKind::Edit | ToolKind::Delete | ToolKind::Move) {
                lanes.push(id);
            }
        }
        assert_eq!(kept.ids(edits(&kept.sql, kept.thread).unwrap()), lanes);
    }

    #[test]
    fn a_rewind_takes_the_lanes_of_its_turns_with_them() {
        let kept = kept();
        let (first, _) = kept.turn("Look");
        let stays = kept.lane(first, None);
        let stays_work = kept.put(
            Some(first),
            call(crate::model::ToolKind::Read),
            Some(stays.id),
        );
        let (second, _) = kept.turn("Look again");
        let goes = kept.lane(second, None);
        let nested = kept.lane(second, Some(goes.id));
        kept.put(
            Some(second),
            call(crate::model::ToolKind::Edit),
            Some(nested.id),
        );
        kept.put(Some(second), question("Run it?", Some(goes.id)), None);

        rewind(&kept.sql, kept.thread, second, 9).unwrap();
        assert_eq!(
            subagents(&kept.sql, kept.thread).unwrap(),
            std::slice::from_ref(&stays)
        );
        assert_eq!(
            kept.ids(lane_items(&kept.sql, stays.id).unwrap()),
            [stays_work]
        );
        assert!(lane_items(&kept.sql, goes.id).unwrap().is_empty());
        let left: i64 = kept
            .sql
            .query_row(
                "SELECT COUNT(*) FROM agents_items WHERE sub IN (?1, ?2)",
                params![goes.id, nested.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0, "a whole tree leaves with its turn");
        assert!(edits(&kept.sql, kept.thread).unwrap().is_empty());
        assert_eq!(items(&kept.sql, kept.thread).unwrap().len(), 2);
    }

    #[test]
    fn a_fork_copies_lanes_under_new_ids_and_rewrites_who_asks() {
        use crate::model::ToolKind;
        let kept = kept();
        let (first, _) = kept.turn("Review it");
        kept.put(Some(first), reply("Starting"), None);
        let lane = kept.lane(first, None);
        let edited = kept.put(Some(first), call(ToolKind::Edit), Some(lane.id));
        let nested = kept.lane(first, Some(lane.id));
        kept.put(Some(first), call(ToolKind::Read), Some(nested.id));
        kept.put(Some(first), question("Run it?", Some(lane.id)), None);
        kept.put(Some(first), reply("Reviewed"), None);
        // Between turns, after the Agent's last word in the first.
        kept.put(
            None,
            Body::Notice {
                text: "Later on".into(),
            },
            None,
        );
        let (second, _) = kept.turn("Go on");
        kept.put(Some(second), reply("Went on"), None);
        // The first turn's lane still at it after the second began.
        kept.put(Some(first), call(ToolKind::Edit), Some(lane.id));
        kept.put(Some(first), question("And this?", Some(lane.id)), None);

        let (to, agent) = (ThreadId::new(), AgentId::new());
        kept.thread_of(to, agent);
        copy_turns(&kept.sql, (kept.thread, kept.agent), first, (to, agent)).unwrap();

        let lanes = subagents(&kept.sql, to).unwrap();
        assert_eq!(lanes.len(), 2);
        let (copy, nested_copy) = (&lanes[0], &lanes[1]);
        let new_turn = turns(&kept.sql, to).unwrap()[0].id;
        assert!(copy.id != lane.id && nested_copy.id != nested.id);
        assert_eq!(
            (copy.turn, copy.parent, nested_copy.turn, nested_copy.parent),
            (new_turn, None, new_turn, Some(copy.id))
        );
        assert_eq!(
            Subagent {
                id: lane.id,
                turn: lane.turn,
                ..copy.clone()
            },
            lane,
            "the rest as it was"
        );
        let unkept: Vec<Option<String>> = {
            let mut rows = kept
                .sql
                .prepare("SELECT evidence FROM agents_subagents WHERE thread = ?1")
                .unwrap();
            rows.query_map(params![to], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(unkept, [None, None]);

        let bodies =
            |items: Vec<Item>| -> Vec<Body> { items.into_iter().map(|i| i.body).collect() };
        let thread = items(&kept.sql, to).unwrap();
        assert_eq!(
            bodies(thread.clone()),
            [
                reply("Review it"),
                reply("Starting"),
                Body::Subagent { subagent: copy.id },
                question("Run it?", Some(copy.id)),
                reply("Reviewed"),
                question("And this?", Some(copy.id)),
            ],
            "neither the later turn's nor what came between, though the lane went on"
        );
        let anchor = |lane: &Subagent| -> ItemId {
            kept.sql
                .query_row(
                    "SELECT item FROM agents_subagents WHERE id = ?1",
                    params![lane.id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(anchor(copy), thread[2].id);
        let own = lane_items(&kept.sql, copy.id).unwrap();
        assert_eq!(
            bodies(own.clone()),
            [
                call(ToolKind::Edit),
                Body::Subagent {
                    subagent: nested_copy.id
                },
                question("Run it?", Some(copy.id)),
                call(ToolKind::Edit),
                question("And this?", Some(copy.id)),
            ]
        );
        assert_eq!(anchor(nested_copy), own[1].id);
        assert!(own[0].id != edited);
        assert_eq!(
            bodies(lane_items(&kept.sql, nested_copy.id).unwrap()),
            [call(ToolKind::Read)]
        );
        assert_eq!(edits(&kept.sql, to).unwrap().len(), 2);
    }

    #[test]
    fn a_deleted_thread_takes_its_rows_and_leaves_its_images_to_the_sweep() {
        let sql = migrated();
        let agent = AgentId::new();
        let author = Participant::Agent(agent);
        let started = |title: &str| {
            let summary = ThreadSummary {
                id: ThreadId::new(),
                harness: "fake".into(),
                title: title.into(),
                updated_at: 0,
                was: None,
            };
            insert_thread(&sql, &summary, agent, author, &Settings::default()).unwrap();
            summary.id
        };
        let (gone, fork) = (started("Gone"), started("Gone fork"));
        let image = || Image {
            id: ImageId::new(),
            mime: "image/png".into(),
            name: None,
            size: 8,
        };
        let (shot, shown) = (image(), image());
        let said = |body: Body| Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 0,
            body,
        };
        // Its message carries both images, and the fork's copy of it shows
        // one of them still.
        let message = said(Body::Message {
            text: "Look".into(),
            images: vec![shot.clone(), shown.clone()],
            answers: false,
        });
        insert_item(&sql, gone, &message, None).unwrap();
        for one in [&shot, &shown] {
            attach_image(&sql, one, author, 0).unwrap();
        }
        carry_images(&sql, &[shot.clone(), shown.clone()], message.id).unwrap();
        let copy = said(Body::Message {
            text: "Look".into(),
            images: vec![shown.clone()],
            answers: false,
        });
        insert_item(&sql, fork, &copy, None).unwrap();
        let turn = Turn {
            id: TurnId::new(),
            thread: gone,
            agent,
            message: message.id,
            state: TurnState::Done,
            opener: Opener::Person,
            from_thread: None,
            stopping: false,
        };
        insert_turn(&sql, &turn, author, 1, &Settings::default()).unwrap();
        let notice = said(Body::Notice {
            text: "Committed.".into(),
        });
        insert_item(&sql, gone, &notice, None).unwrap();
        keep_notice(&sql, gone, notice.id).unwrap();
        // A sub-agent's lane of the turn, and an entry of its own.
        let lane = Subagent {
            id: SubagentId::new(),
            turn: turn.id,
            parent: None,
            title: "Read the settings".into(),
            role: None,
            model: None,
            state: SubagentState::Done,
            why: None,
            can_stop: false,
            started: 1,
            ended: Some(2),
            prompt: None,
            report: None,
        };
        let anchor = said(Body::Subagent { subagent: lane.id });
        insert_item(&sql, gone, &anchor, None).unwrap();
        let child = json!({ "session": lane.id.to_string() });
        insert_lane(&sql, gone, &lane, anchor.id, &child).unwrap();
        let work = said(call(crate::model::ToolKind::Read));
        insert_item(&sql, gone, &work, Some(lane.id)).unwrap();

        delete_thread(&sql, gone).unwrap();
        assert!(thread(&sql, gone).unwrap().is_none());
        assert!(items(&sql, gone).unwrap().is_empty());
        assert!(turns(&sql, gone).unwrap().is_empty());
        assert!(subagents(&sql, gone).unwrap().is_empty());
        assert!(lane_items(&sql, lane.id).unwrap().is_empty());
        let notices: i64 = sql
            .query_row("SELECT COUNT(*) FROM agents_notices", [], |row| row.get(0))
            .unwrap();
        assert_eq!(notices, 0);
        assert_eq!(
            threads(&sql, &AtWork::new())
                .unwrap()
                .iter()
                .map(|t| t.thread.id)
                .collect::<Vec<_>>(),
            [fork],
            "the other Thread stays"
        );
        assert_eq!(items(&sql, fork).unwrap().len(), 1);
        // The sweep takes the image no item shows, and leaves the fork's.
        assert_eq!(drop_unsent_images(&sql, 10).unwrap(), vec![shot.id]);
        assert!(image_kind(&sql, shown.id).unwrap().is_some());
    }

    /// A Thread with a turn, its message, the image it carries, a notice
    /// its Agent has yet to read, the lines its turn changed, a sub-agent's
    /// lane with an entry of its own, and the Thread that is its parent, in
    /// `sql`.
    fn a_whole_thread(sql: &Connection) -> ThreadId {
        let agent = AgentId::new();
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: "Hello".to_owned(),
            updated_at: 0,
            was: None,
        };
        let author = Participant::Agent(agent);
        insert_thread(sql, &summary, agent, author, &Settings::default()).unwrap();
        set_parent(sql, summary.id, ThreadId::new()).unwrap();
        let image = Image {
            id: ImageId::new(),
            mime: "image/png".into(),
            name: None,
            size: 8,
        };
        attach_image(sql, &image, author, 0).unwrap();
        let message = Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 0,
            body: Body::Message {
                text: "Hi apples".to_owned(),
                images: vec![image.clone()],
                answers: false,
            },
        };
        insert_item(sql, summary.id, &message, None).unwrap();
        carry_images(sql, &[image], message.id).unwrap();
        let turn = Turn {
            id: TurnId::new(),
            thread: summary.id,
            agent,
            message: message.id,
            state: TurnState::Done,
            opener: Opener::Person,
            from_thread: None,
            stopping: false,
        };
        insert_turn(sql, &turn, author, 1, &Settings::default()).unwrap();
        let lines = ChangedLines {
            added: 2,
            removed: 1,
        };
        set_changed_lines(sql, turn.id, Some(lines)).unwrap();
        let said = |at: i64, body: Body| Item {
            id: ItemId::new(),
            turn: Some(turn.id),
            author,
            at,
            body,
        };
        let lane = Subagent {
            id: SubagentId::new(),
            turn: turn.id,
            parent: None,
            title: "Read the notes".into(),
            role: None,
            model: None,
            state: SubagentState::Done,
            why: None,
            can_stop: false,
            started: 1,
            ended: Some(2),
            prompt: None,
            report: None,
        };
        let anchor = said(1, Body::Subagent { subagent: lane.id });
        insert_item(sql, summary.id, &anchor, None).unwrap();
        let child = json!({ "session": lane.id.to_string() });
        insert_lane(sql, summary.id, &lane, anchor.id, &child).unwrap();
        let own = said(1, call(crate::model::ToolKind::Read));
        insert_item(sql, summary.id, &own, Some(lane.id)).unwrap();
        let notice = Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 2,
            body: Body::Notice {
                text: "Committed".to_owned(),
            },
        };
        insert_item(sql, summary.id, &notice, None).unwrap();
        keep_notice(sql, summary.id, notice.id).unwrap();
        summary.id
    }

    #[test]
    fn a_thread_goes_to_another_store_as_its_rows_whole_and_leaves_none_behind() {
        let (here, there) = (migrated(), migrated());
        let thread = a_whole_thread(&here);
        let other = a_whole_thread(&here);
        let rows = ThreadRows::read(&here, thread).unwrap().unwrap();
        let images = thread_images(&here, thread).unwrap();
        assert_eq!(images.len(), 1);
        let (said, ran) = (items(&here, thread).unwrap(), turns(&here, thread).unwrap());
        let lanes = subagents(&here, thread).unwrap();
        assert_eq!(lanes.len(), 1);
        let found = |sql: &Connection| {
            let found = search::search(sql, "apples", None).unwrap();
            found.into_iter().map(|one| one.thread).collect::<Vec<_>>()
        };
        rows.insert(&there).unwrap();
        search::index_thread(&there, thread).unwrap();
        keep_images(&there, &images).unwrap();
        assert_eq!(
            ThreadRows::read(&there, thread).unwrap(),
            Some(rows.clone())
        );
        // Its parent, the lines its turn changed, its lanes and their
        // entries go with it, and its messages are found there.
        assert_eq!(thread_parent(&there, thread), thread_parent(&here, thread));
        assert!(thread_parent(&there, thread).is_some());
        assert_eq!(subagents(&there, thread).unwrap(), lanes);
        assert_eq!(
            lane_items(&there, lanes[0].id).unwrap(),
            lane_items(&here, lanes[0].id).unwrap()
        );
        assert_eq!(found(&there), [thread]);
        assert_eq!(thread_images(&there, thread).unwrap(), images);
        assert_eq!(
            items(&there, thread).unwrap(),
            said,
            "in the order they came"
        );
        assert_eq!(turns(&there, thread).unwrap(), ran);
        assert_eq!(
            notices_of(&there, thread, said[0].id, true).unwrap(),
            ["Committed"]
        );

        assert_eq!(found(&here).len(), 2);
        forget_thread(&here, thread, 5).unwrap();
        assert_eq!(ThreadRows::read(&here, thread).unwrap(), None);
        assert_eq!(found(&here), [other], "found no more where it was");
        let kept = ThreadRows::read(&here, other).unwrap().unwrap();
        forget_thread(&here, other, 5).unwrap();
        for (table, _) in THREAD_TABLES {
            let count = format!("SELECT COUNT(*) FROM {table}");
            let left: i64 = here.query_row(&count, [], |row| row.get(0)).unwrap();
            assert_eq!(left, 0, "nothing of either is left in {table}");
        }
        // Their images wait for the sweep, as a draft's do.
        assert!(drop_unsent_images(&here, 5).unwrap().is_empty());
        assert_eq!(drop_unsent_images(&here, 6).unwrap().len(), 2);
        kept.insert(&here).unwrap();
        assert_eq!(ThreadRows::read(&here, other).unwrap(), Some(kept));
    }

    /// The parent `thread` names, as its row keeps it.
    fn thread_parent(sql: &Connection, thread: ThreadId) -> Option<String> {
        sql.query_row(
            "SELECT parent FROM agents_threads WHERE id = ?1",
            params![thread],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// A fork of `source`, whose message names the image `source`'s
    /// carries, as a fork's copied items do (ADR 0027).
    fn a_fork(sql: &Connection, source: ThreadId) -> ThreadId {
        let agent = AgentId::new();
        let fork = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: "Hello again".to_owned(),
            updated_at: 0,
            was: None,
        };
        let author = Participant::Agent(agent);
        insert_thread(sql, &fork, agent, author, &Settings::default()).unwrap();
        let image = thread_images(sql, source).unwrap().remove(0).image;
        let message = Item {
            id: ItemId::new(),
            turn: None,
            author,
            at: 0,
            body: Body::Message {
                text: "Hi".to_owned(),
                images: vec![image],
                answers: false,
            },
        };
        insert_item(sql, fork.id, &message, None).unwrap();
        fork.id
    }

    #[test]
    fn a_fork_and_its_source_each_move_with_the_images_both_name() {
        let (here, there) = (migrated(), migrated());
        let source = a_whole_thread(&here);
        let fork = a_fork(&here, source);
        let named = thread_images(&here, fork).unwrap();
        let carried = thread_images(&here, source).unwrap();
        assert_eq!(named.len(), 1);
        assert_eq!(named[0].image, carried[0].image, "the same image");
        assert_eq!((named[0].item, carried[0].item.is_some()), (None, true));

        // The fork moves: the image goes with it, kept there for it.
        let rows = ThreadRows::read(&here, fork).unwrap().unwrap();
        rows.insert(&there).unwrap();
        keep_images(&there, &named).unwrap();
        let id = named[0].image.id;
        assert!(image_kind(&there, id).unwrap().is_some());
        assert!(drop_unsent_images(&there, i64::MAX).unwrap().is_empty());
        forget_thread(&here, fork, 5).unwrap();
        assert_eq!(thread_images(&here, source).unwrap(), carried);

        // Then its source: the image it carries is its own there too.
        let rows = ThreadRows::read(&here, source).unwrap().unwrap();
        rows.insert(&there).unwrap();
        keep_images(&there, &carried).unwrap();
        assert_eq!(thread_images(&there, source).unwrap(), carried);

        // A source that moves while its fork stays leaves the image for it.
        let (here, there) = (migrated(), migrated());
        let source = a_whole_thread(&here);
        let fork = a_fork(&here, source);
        let carried = thread_images(&here, source).unwrap();
        let rows = ThreadRows::read(&here, source).unwrap().unwrap();
        rows.insert(&there).unwrap();
        keep_images(&there, &carried).unwrap();
        forget_thread(&here, source, 5).unwrap();
        let id = carried[0].image.id;
        assert!(drop_unsent_images(&here, i64::MAX).unwrap().is_empty());
        assert!(image_kind(&here, id).unwrap().is_some(), "the fork's still");
        assert_eq!(thread_images(&here, fork).unwrap()[0].image.id, id);
    }

    #[test]
    fn a_thread_that_came_is_told_from_one_that_went_on_where_it_came() {
        let (here, there) = (migrated(), migrated());
        let thread = a_whole_thread(&here);
        let rows = ThreadRows::read(&here, thread).unwrap().unwrap();
        rows.insert(&there).unwrap();
        let notice = |sql: &Connection, text: &str| {
            let item = Item {
                id: ItemId::new(),
                turn: None,
                author: Participant::Agent(AgentId::new()),
                at: 9,
                body: Body::Notice {
                    text: text.to_owned(),
                },
            };
            insert_item(sql, thread, &item, None).unwrap();
            keep_notice(sql, thread, item.id).unwrap();
        };
        assert!(
            !ThreadRows::read(&there, thread)
                .unwrap()
                .unwrap()
                .came_with(&rows)
        );
        notice(&there, "Moved here");
        let came = ThreadRows::read(&there, thread).unwrap().unwrap();
        assert!(came.came_with(&rows));
        assert!(!rows.came_with(&came));
        notice(&there, "Committed");
        let went_on = ThreadRows::read(&there, thread).unwrap().unwrap();
        assert!(!went_on.came_with(&rows));
    }

    #[test]
    fn every_table_of_the_module_that_holds_a_threads_rows_goes_with_it() {
        // A table that holds no Thread's rows, or whose rows go apart, is
        // named here instead: the images', and the backfill's mark. The
        // index of messages and its own tables, `agents_search*`, are
        // written again where the messages go.
        const APART: [&str; 2] = ["agents_images", "agents_backfill"];
        let sql = migrated();
        let mut statement = sql
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agents_%'")
            .unwrap();
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap();
        let mut tables: Vec<String> = names.collect::<rusqlite::Result<_>>().unwrap();
        tables.retain(|table| {
            !APART.contains(&table.as_str()) && !table.starts_with("agents_search")
        });
        tables.sort();
        let mut moved: Vec<String> = THREAD_TABLES.iter().map(|(t, _)| t.to_string()).collect();
        moved.sort();
        assert_eq!(
            tables, moved,
            "name a new table in THREAD_TABLES, or in APART"
        );
        // An image's row goes as `keep_images` names its columns.
        let mut columns = sql
            .prepare("SELECT name FROM pragma_table_info('agents_images')")
            .unwrap();
        let columns: Vec<String> = (columns.query_map([], |row| row.get(0)).unwrap())
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            columns,
            ["id", "mime", "name", "size", "author", "added_at", "item"]
        );
    }

    #[test]
    fn a_thread_takes_the_files_kept_for_its_persons_messages_named_as_json_writes_them() {
        use rusqlite::types::Value;
        // A folder whose name JSON writes otherwise, as Windows' are.
        let (from, to) = (Path::new(r"/data\one/files"), Path::new(r"/data\two/files"));
        let (ours, theirs) = (uuid::Uuid::now_v7(), uuid::Uuid::now_v7());
        let path = |folder: &Path, id: uuid::Uuid| {
            let path = folder.join(id.to_string()).join("notes.md");
            path.display().to_string()
        };
        let said = |text: String| {
            let body = Body::Message {
                text,
                images: Vec::new(),
                answers: false,
            };
            Value::Text(json(&body).unwrap())
        };
        let tool = |title: String| {
            Value::Text(serde_json::json!({ "kind": "tool", "title": title }).to_string())
        };
        let by = |who: Participant| Value::Text(json(&who).unwrap());
        let person = by(Participant::Person(banda_kernel::PersonId::new()));
        let agent = by(Participant::Agent(AgentId::new()));
        // Its title, plain text, names a kept file; its Person's message
        // names it, which its Agent's tool reads; its Agent's message names
        // another Thread's.
        let rows = |folder: &Path| {
            let title = Value::Text(format!("About {}", path(folder, ours)));
            ThreadRows(vec![
                TableRows {
                    table: "agents_threads",
                    columns: vec!["title".to_owned(), "sessions".to_owned()],
                    rows: vec![vec![title, Value::Text("{}".to_owned())]],
                },
                TableRows {
                    table: "agents_items",
                    columns: vec!["author".to_owned(), "body".to_owned()],
                    rows: vec![
                        vec![
                            person.clone(),
                            said(format!("read @{}", path(folder, ours))),
                        ],
                        vec![agent.clone(), tool(format!("Read {}", path(folder, ours)))],
                        vec![agent.clone(), said(format!("see @{}", path(from, theirs)))],
                    ],
                },
            ])
        };
        let here = rows(from);
        let kept = here.kept_in(from);
        assert_eq!(kept, [ours.to_string()]);
        assert!(here.kept_in(to).is_empty());
        // There they name its copy, as JSON writes it and as plain text;
        // another Thread's stays named where it is, as it is not copied.
        let there = here.kept_moved(from, to, &kept);
        assert_eq!(there, rows(to));
        // The Thread's own row takes what it has there instead.
        let there = there.with_own("sessions", "[]".to_owned());
        assert_eq!(
            there.0[0].rows,
            [[
                Value::Text(format!("About {}", path(to, ours))),
                Value::Text("[]".to_owned())
            ]]
        );
    }
}
