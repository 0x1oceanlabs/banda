//! An App's export: its events and its tables, as lines (ADR 0085,
//! decision 10). What an App keeps in a Project reads without the App: a
//! Person takes their data elsewhere with it, and looks at it as it is.
//!
//! [`Registry::export`](crate::Registry::export) streams it in pieces,
//! each the lines of one file of the export:
//!
//! ```text
//! app.json           its id, its version, its ledger, each table's CREATE
//! events.ndjson      its events, in the log's order
//! <table>.ndjson     one row a line, by column
//! ```
//!
//! and last a piece `done`, with how many lines each file has: an export
//! with no `done` was cut short, and is not one.
//!
//! - The tables are those of the App's prefix and of the ids it had
//!   before. A full-text index is listed in `app.json` by its CREATE and
//!   has no rows of its own here: it is made again from what it indexes.
//! - It reads a page at a time, each from the last row's key on, so the
//!   Project's other reads go on beside it, and a row written or gone
//!   meanwhile moves no other row out of it. What it reads is not one
//!   moment's: for that, the App must write nothing while it is read.
//! - Bytes, and text that is not UTF-8, come as `{"$base64": "…"}`.
//! - An App's files are not in it yet: one from a folder keeps none.

use crate::events::EventFilter;
use crate::kernel::Kernel;
use crate::module::Stream;
use crate::project::Project;
use crate::tables::owned_by;
use crate::{Error, ProjectId, Refusal, module_name};
use base64::Engine as _;
use rusqlite::types::ValueRef;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::mpsc;

/// How many events, and how many rows of a table, one read takes and one
/// piece holds.
const PAGE: usize = 500;

/// The column a page's rows carry their key in, beside the table's own.
const KEY: &str = "__banda_rowid";

/// One table of an App, as its store has it.
struct Table {
    name: String,
    create: String,
    /// Whether its rows are read: not a full-text index's, nor those of a
    /// table with no rowid to read on from, which no App has yet.
    rows: bool,
}

/// A value of a row as JSON: bytes, and text that is not UTF-8, as
/// `bytes` says them.
pub fn cell<E>(
    value: ValueRef<'_>,
    bytes: impl FnOnce(&[u8]) -> Result<Value, E>,
) -> Result<Value, E> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(whole) => json!(whole),
        ValueRef::Real(real) => json!(real),
        ValueRef::Text(text) => match std::str::from_utf8(text) {
            Ok(text) => json!(text),
            Err(_) => bytes(text)?,
        },
        ValueRef::Blob(blob) => bytes(blob)?,
    })
}

fn base64(bytes: &[u8]) -> Result<Value, Error> {
    let said = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(json!({ "$base64": said }))
}

/// The export, as it is said: each piece's lines counted by file.
struct Said<'a> {
    say: &'a mpsc::Sender<Value>,
    lines: BTreeMap<String, usize>,
}

impl Said<'_> {
    /// Says `lines` of `file`; false once nobody hears.
    async fn piece(&mut self, file: &str, lines: Vec<Value>) -> bool {
        if lines.is_empty() {
            return true;
        }
        *self.lines.entry(file.to_owned()).or_default() += lines.len();
        let piece = json!({ "file": file, "lines": lines });
        self.say.send(piece).await.is_ok()
    }
}

impl Kernel {
    /// The export of the App `app` in `project`, in pieces. An App that
    /// keeps nothing there exports its `app.json` alone. Refused for a
    /// name that is no App's, or that another App's tables still go by.
    pub(crate) async fn export(&self, project: ProjectId, app: &str) -> Result<Stream, Refusal> {
        let runs = self.runs();
        let others = runs.modules.iter().filter(|module| module.name() != app);
        if !module_name(app)
            || others
                .flat_map(|m| m.legacy_prefixes())
                .any(|had| *had == app)
        {
            return Err(Refusal::invalid(format!("\"{app}\" is no App's id.")));
        }
        let project = self.project(project).await?;
        let running = runs.modules.iter().find(|module| module.name() == app);
        let legacy = running.map_or(&[][..], |module| module.legacy_prefixes());
        let version =
            (runs.apps.iter().find(|listed| listed.id == app)).map(|listed| listed.version.clone());
        let app = app.to_owned();
        let (say, hears) = mpsc::channel(4);
        tokio::spawn(async move {
            let mut said = Said {
                say: &say,
                lines: BTreeMap::new(),
            };
            match exported(&project, &app, version, legacy, &mut said).await {
                // Whole: said so, with what it holds.
                Ok(true) => drop(say.send(json!({ "done": said.lines })).await),
                Ok(false) => {}
                Err(error) => tracing::error!(%error, app, "an export was cut short"),
            }
        });
        Ok(hears)
    }
}

/// Says the whole export; false when its hearer stopped first.
async fn exported(
    project: &Arc<Project>,
    app: &str,
    version: Option<String>,
    legacy: &'static [&'static str],
    said: &mut Said<'_>,
) -> Result<bool, Error> {
    let (id, ledger) = (app.to_owned(), app.to_owned());
    let (tables, steps) = project
        .store()
        .read(move |sql| {
            let mut found = sql.prepare(
                "SELECT m.name, m.sql, l.type = 'table' AND l.wr = 0
                 FROM sqlite_master m JOIN pragma_table_list l ON l.name = m.name
                 WHERE m.type = 'table' AND l.type IN ('table', 'virtual')
                 ORDER BY m.name",
            )?;
            let tables = found
                .query_map([], |row| {
                    Ok(Table {
                        name: row.get(0)?,
                        create: row.get(1)?,
                        rows: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let steps: i64 = sql.query_row(
                "SELECT COUNT(*) FROM kernel_migrations WHERE ledger = ?1",
                [&ledger],
                |row| row.get(0),
            )?;
            let owned = |table: &Table| owned_by(&id, legacy, &table.name);
            Ok((tables.into_iter().filter(owned).collect::<Vec<_>>(), steps))
        })
        .await?;
    let listed: Vec<Value> = (tables.iter())
        .map(|table| json!({ "name": table.name, "create": table.create }))
        .collect();
    let head = json!({ "id": app, "version": version, "ledger": steps, "tables": listed });
    if !said.piece("app.json", vec![head]).await {
        return Ok(false);
    }
    let filter = EventFilter {
        module: Some(app.to_owned()),
        ..EventFilter::default()
    };
    let mut after = 0;
    loop {
        let events = project.events_after(after, filter.clone(), PAGE).await?;
        let (count, last) = (events.len(), events.last().map(|event| event.seq));
        let lines = events.iter().map(serde_json::to_value);
        if !said
            .piece("events.ndjson", lines.collect::<Result<_, _>>()?)
            .await
        {
            return Ok(false);
        }
        match last {
            Some(seq) if count == PAGE => after = seq,
            _ => break,
        }
    }
    for table in tables.iter().filter(|table| table.rows) {
        let file = format!("{}.ndjson", table.name);
        let mut after = i64::MIN;
        loop {
            let (rows, last) = rows(project, &table.name, after).await?;
            let count = rows.len();
            if !said.piece(&file, rows).await {
                return Ok(false);
            }
            match last {
                Some(key) if count == PAGE => after = key,
                _ => break,
            }
        }
    }
    Ok(true)
}

/// A page of `table`'s rows past the key `after`, each an object by
/// column, and the last one's key.
async fn rows(
    project: &Arc<Project>,
    table: &str,
    after: i64,
) -> Result<(Vec<Value>, Option<i64>), Error> {
    // Named as its store names it, whatever is in the name. The first
    // page takes the least key too.
    let named = table.replace('"', "\"\"");
    let past = if after == i64::MIN { ">=" } else { ">" };
    let select = format!(
        "SELECT rowid AS {KEY}, * FROM \"{named}\" WHERE rowid {past} ?1 ORDER BY rowid LIMIT {PAGE}"
    );
    project
        .store()
        .read(move |sql| {
            let mut statement = sql.prepare(&select)?;
            let names: Vec<String> = statement.column_names().map(str::to_owned).collect();
            let mut rows = statement.query([after])?;
            let (mut page, mut last) = (Vec::new(), None);
            while let Some(row) = rows.next()? {
                last = Some(row.get(0)?);
                let mut object = Map::with_capacity(names.len());
                for (column, name) in names.iter().enumerate().skip(1) {
                    object.insert(name.clone(), cell(row.get_ref(column)?, base64)?);
                }
                page.push(Value::Object(object));
            }
            Ok((page, last))
        })
        .await
}
