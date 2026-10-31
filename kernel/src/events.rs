//! A Space's event log: facts, appended and never rewritten (ADR 0002,
//! decision 6). Each event belongs to the module that emitted it and carries
//! that module's version of its shape.

use crate::{Actor, EventId};
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    /// Its place in the Space's log, from 1. A later event has a larger one.
    #[ts(type = "number")]
    pub seq: i64,
    pub id: EventId,
    /// The module that emitted it. Only that module emits this kind.
    pub module: String,
    pub kind: String,
    /// The version of this kind's payload. Old versions stay readable.
    pub version: u32,
    /// What the event is about, in the module's terms (an Agent, a Room).
    pub subject: Option<String>,
    pub author: Actor,
    #[ts(type = "number")]
    pub at: i64,
    #[ts(type = "unknown")]
    pub payload: serde_json::Value,
}

/// Which events a subscriber wants. Empty fields match everything.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EventFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

impl EventFilter {
    pub fn matches(&self, event: &Event) -> bool {
        self.module.as_ref().is_none_or(|m| *m == event.module)
            && self
                .subject
                .as_ref()
                .is_none_or(|s| event.subject.as_deref() == Some(s.as_str()))
    }
}

const COLUMNS: &str =
    "seq, id, module, kind, version, subject, author_kind, author_id, at, payload";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Event> {
    let author_kind: String = row.get(6)?;
    let author_id: String = row.get(7)?;
    let author = Actor::from_parts(&author_kind, &author_id).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            format!("unknown author {author_kind}/{author_id}").into(),
        )
    })?;
    let payload: String = row.get(9)?;
    Ok(Event {
        seq: row.get(0)?,
        id: row.get(1)?,
        module: row.get(2)?,
        kind: row.get(3)?,
        version: row.get(4)?,
        subject: row.get(5)?,
        author,
        at: row.get(8)?,
        payload: serde_json::from_str(&payload).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e))
        })?,
    })
}

/// Appends `event` and gives it its place in the log.
pub(crate) fn append(sql: &Connection, event: &mut Event) -> rusqlite::Result<()> {
    event.seq = sql.query_row(
        "INSERT INTO kernel_events (id, module, kind, version, subject, author_kind, author_id, at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING seq",
        params![
            event.id,
            event.module,
            event.kind,
            event.version,
            event.subject,
            event.author.kind(),
            event.author.id(),
            event.at,
            event.payload.to_string()
        ],
        |row| row.get(0),
    )?;
    Ok(())
}

/// The events after `after` that match `filter`, oldest first, at most
/// `limit` of them.
pub(crate) fn after(
    sql: &Connection,
    after: i64,
    filter: &EventFilter,
    limit: usize,
) -> rusqlite::Result<Vec<Event>> {
    let mut statement = sql.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM kernel_events
         WHERE seq > ?1 AND (?2 IS NULL OR module = ?2) AND (?3 IS NULL OR subject = ?3)
         ORDER BY seq LIMIT ?4"
    ))?;
    let rows = statement.query_map(
        params![
            after,
            filter.module,
            filter.subject,
            i64::try_from(limit).unwrap_or(i64::MAX)
        ],
        from_row,
    )?;
    rows.collect()
}

/// The newest position in the log, or 0 when it is empty.
pub(crate) fn head(sql: &Connection) -> rusqlite::Result<i64> {
    sql.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM kernel_events",
        [],
        |row| row.get(0),
    )
}
