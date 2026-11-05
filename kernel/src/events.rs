//! A Project's event log: facts, appended and never rewritten (ADR 0002,
//! decision 6). Each event belongs to the module that emitted it and carries
//! that module's version of its shape.

use crate::{EventId, Participant};
use rusqlite::OptionalExtension;
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    /// Its place in the Project's log, from 1. A later event has a larger one.
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
    pub author: Participant,
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
    /// Only these kinds, so a view hears just the facts it shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<String>>,
}

impl EventFilter {
    pub fn matches(&self, event: &Event) -> bool {
        self.module.as_ref().is_none_or(|m| *m == event.module)
            && self
                .subject
                .as_ref()
                .is_none_or(|s| event.subject.as_deref() == Some(s.as_str()))
            && self.kinds.as_ref().is_none_or(|k| k.contains(&event.kind))
    }
}

const COLUMNS: &str =
    "seq, id, module, kind, version, subject, author_kind, author_id, at, payload";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Event> {
    let author_kind: String = row.get(6)?;
    let author_id: String = row.get(7)?;
    let author = Participant::from_parts(&author_kind, &author_id).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            format!("unknown author {author_kind}/{author_id}").into(),
        )
    })?;
    Ok(Event {
        seq: row.get(0)?,
        id: row.get(1)?,
        module: row.get(2)?,
        kind: row.get(3)?,
        version: row.get(4)?,
        subject: row.get(5)?,
        author,
        at: row.get(8)?,
        payload: json_column(row, 9)?,
    })
}

/// A column that holds JSON text.
pub(crate) fn json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<serde_json::Value> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e))
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
           AND (?5 IS NULL OR kind IN (SELECT value FROM json_each(?5)))
         ORDER BY seq LIMIT ?4"
    ))?;
    let kinds = filter
        .kinds
        .as_ref()
        .map(|kinds| serde_json::json!(kinds).to_string());
    let rows = statement.query_map(
        params![
            after,
            filter.module,
            filter.subject,
            i64::try_from(limit).unwrap_or(i64::MAX),
            kinds
        ],
        from_row,
    )?;
    rows.collect()
}

/// The log's position as it stood at `at`, in ms since the epoch: its
/// last event made before then, or 0.
pub(crate) fn position_at(sql: &Connection, at: i64) -> rusqlite::Result<i64> {
    sql.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM kernel_events WHERE at < ?1",
        [at],
        |row| row.get(0),
    )
}

/// The newest event before `before` in the log that matches `filter`.
pub(crate) fn before(
    sql: &Connection,
    before: i64,
    filter: &EventFilter,
) -> rusqlite::Result<Option<Event>> {
    let mut statement = sql.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM kernel_events
         WHERE seq < ?1 AND (?2 IS NULL OR module = ?2) AND (?3 IS NULL OR subject = ?3)
           AND (?4 IS NULL OR kind IN (SELECT value FROM json_each(?4)))
         ORDER BY seq DESC LIMIT 1"
    ))?;
    let kinds = filter
        .kinds
        .as_ref()
        .map(|kinds| serde_json::json!(kinds).to_string());
    let params = params![before, filter.module, filter.subject, kinds];
    statement.query_row(params, from_row).optional()
}

/// How many events of `tally`'s module and kind the log took in its span,
/// by the text at `path` in their payload, or `""`.
pub(crate) fn tally(
    sql: &Connection,
    tally: &crate::Tally,
    path: &str,
) -> rusqlite::Result<Vec<(String, u64)>> {
    let mut statement = sql.prepare_cached(
        "SELECT CASE WHEN json_type(payload, ?3) = 'text'
                THEN json_extract(payload, ?3) ELSE '' END, COUNT(*)
         FROM kernel_events
         WHERE module = ?1 AND kind = ?2 AND at >= ?4 AND at < ?5
         GROUP BY 1",
    )?;
    let params = params![tally.module, tally.kind, path, tally.from, tally.to];
    let rows = statement.query_map(params, |row| {
        Ok((row.get(0)?, row.get::<_, i64>(1)?.unsigned_abs()))
    })?;
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
