//! The problems module: what broke in Banda itself, kept on this computer
//! (ADR 0039, decision 1).
//!
//! It is the machine's, as the workspaces are: a Problem is Banda's, not a
//! Project's. A part of Banda that broke says so with `record`: the window's
//! page and main through the API, the engine's panics through a file the
//! panic hook writes ([`catch_panics`]). One fault is one Problem, by its
//! fingerprint, however often it broke; a new one is said in an event, so
//! a window that follows shows it, and one that broke again on a new day
//! or in a new version in another, which sharing hears. It keeps the
//! newest 200.
//!
//! It sends nothing anywhere but an issue the Person sends to Banda on
//! GitHub (`send_issue`, decision 3): sharing a Problem is the `sharing`
//! module's, and only when the Person turned it on (decision 4).

mod issue;
pub mod model;
mod panics;
mod report;

use banda_kernel::{
    Call, Error, Kind, Module, ModuleProject, Nothing, Participant, Refusal, Right, Scope, Tool, Tx,
};
use issue::{Issue, Sent};
use model::{Fingerprint, Log, Problem, Record, Recorded, Report, word};
use rusqlite::{OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use ts_rs::TS;

pub use panics::{append_private, catch as catch_panics, keep as keep_crash};

/// The version of every event this module writes.
pub const VERSION: u32 = 1;

/// How many Problems it keeps: the newest.
const KEPT: u32 = 200;

/// The logs a report ends with, in the logs' folder, and how many of
/// their last lines, read from their last [`TAIL_BYTES`].
const LOGS: [&str; 2] = ["engine.log", "window.log"];
const TAIL: usize = 100;
const TAIL_BYTES: u64 = 64 << 10;

pub struct Problems {
    /// Where the panic hook leaves the engine's panics.
    panics: PathBuf,
    /// Where the engine and the window write their logs.
    logs: PathBuf,
    /// The checkout of Banda's source the engine runs from, if it does.
    checkout: Option<PathBuf>,
    /// The `gh` that files a Person's issue.
    gh: PathBuf,
}

impl Problems {
    /// `panics` is the folder [`catch_panics`] was given; `logs` the one
    /// the logs are in.
    pub fn new(panics: impl Into<PathBuf>, logs: impl Into<PathBuf>) -> Self {
        Self {
            panics: panics.into(),
            logs: logs.into(),
            checkout: None,
            gh: PathBuf::from("gh"),
        }
    }

    /// Files a Person's issue with the `gh` at `gh`, not the one on PATH.
    pub fn gh(self, gh: PathBuf) -> Self {
        Self { gh, ..self }
    }

    /// Says Banda runs from the checkout it was built in, where an Agent
    /// can fix a Problem (ADR 0039, decision 3): not a released Banda's,
    /// whose build's folder is another machine's.
    pub fn from_checkout(mut self) -> Self {
        self.checkout = panics::root().and_then(|root| root.canonicalize().ok());
        self
    }
}

banda_kernel::methods! {
    Problems(Call) as "ProblemsMethods" in "problems/" {
        /// What broke in Banda, the newest first, at the log's position: a
        /// window shows them, then follows the module's events. See the
        /// Banda skill's `problems` topic before looking into one.
        call list(Nothing) -> Listed, Read, tool "problems";
        /// One Problem by its fingerprint, or the start of it, with what
        /// it takes to look into it: the system, and the last lines of
        /// the logs; and all of it in Markdown, as `text`.
        call problem(Fingerprint) -> Report, Read, tool "problem";
        /// Keeps what broke in a part of Banda, as one Problem by its
        /// fingerprint: a new one is said in an event, one known counts
        /// once more.
        command record(Record) -> Recorded, Write;
        /// Sends an issue about a Problem to Banda on GitHub, as the
        /// Person wrote it, the one thing this module sends anywhere: `gh`
        /// files it, or the answer is the page that sends it from the
        /// browser.
        command send_issue(Issue) -> Sent, Decide;
    }
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Listed {
    #[ts(type = "number")]
    pub at: i64,
    pub problems: Vec<Problem>,
}

#[async_trait::async_trait]
impl Module for Problems {
    fn name(&self) -> &'static str {
        "problems"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn tools(&self) -> Vec<Tool> {
        Self::method_tools(self.name())
    }

    fn migrations(&self) -> &'static [&'static str] {
        // One row a Problem, with how it broke the last time.
        &["CREATE TABLE problems_kept (
               fingerprint TEXT PRIMARY KEY,
               source TEXT NOT NULL,
               kind TEXT NOT NULL,
               message TEXT NOT NULL,
               frames TEXT NOT NULL,
               version TEXT NOT NULL,
               first INTEGER NOT NULL,
               last INTEGER NOT NULL,
               times INTEGER NOT NULL
           )"]
    }

    /// The panics of the engine's last run, then each as the hook keeps
    /// it, while the engine runs on.
    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        take_panics(&project, &self.panics).await?;
        let folder = self.panics.clone();
        tokio::spawn(async move {
            loop {
                panics::PANICKED.notified().await;
                if let Err(error) = take_panics(&project, &folder).await {
                    tracing::warn!(%error, "the engine's panics were not kept");
                }
            }
        });
        Ok(())
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }
}

impl Problems {
    async fn list(&self, call: Call, _: Nothing) -> Result<Listed, Refusal> {
        let (at, problems) = call.project().view(all).await?;
        Ok(Listed { at, problems })
    }

    async fn problem(&self, call: Call, one: Fingerprint) -> Result<Report, Refusal> {
        let start = one.fingerprint;
        let problems = call.project().read(all).await?;
        let mut found = problems
            .into_iter()
            .filter(|problem| problem.fingerprint.starts_with(&start));
        let (Some(problem), None) = (found.next(), found.next()) else {
            return Err(Refusal::not_found(format!(
                "No one Problem's fingerprint starts with \"{start}\"."
            )));
        };
        let logs = LOGS
            .iter()
            .filter_map(|&name| {
                let lines = tail(&self.logs.join(name)).ok()?;
                Some(Log {
                    name: name.to_owned(),
                    lines,
                })
            })
            .collect();
        let mut report = Report {
            problem,
            system: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            logs,
            checkout: self.checkout.as_ref().map(|at| at.display().to_string()),
            text: String::new(),
        };
        report.text = report::markdown(&report);
        Ok(report)
    }

    async fn send_issue(&self, call: Call, issue: Issue) -> Result<Sent, Refusal> {
        issue::may_send(&issue)?;
        let fingerprint = issue.problem.fingerprint.clone();
        let problems = call.project().read(all).await?;
        if !problems.iter().any(|one| one.fingerprint == fingerprint) {
            return Err(Refusal::not_found(format!(
                "No Problem has the fingerprint \"{fingerprint}\"."
            )));
        }
        Ok(issue::send(&self.gh, &issue).await)
    }

    async fn record(&self, call: Call, record: Record) -> Result<Recorded, Refusal> {
        let author = call.participant();
        call.command(move |tx| keep(tx, record, author)).await
    }
}

async fn take_panics(project: &ModuleProject, folder: &Path) -> Result<(), Error> {
    let panics = panics::take(folder);
    if panics.is_empty() {
        return Ok(());
    }
    // The kernel has no Participant of its own: the engine's panics are
    // the owner's, who runs it.
    let owner = Participant::Person(project.owner());
    project
        .write(move |tx| {
            for record in panics {
                keep(tx, record, owner)?;
            }
            Ok(())
        })
        .await
}

/// Keeps `record` as its Problem, and says a new one, or one that broke
/// again on a day or in a version it had not: once a day and version at
/// most, as sharing sends it (ADR 0039, decision 6).
fn keep(tx: &mut Tx<'_>, record: Record, author: Participant) -> Result<Recorded, Error> {
    let record = record.cut();
    let fingerprint = record.fingerprint();
    let version = banda_kernel::version();
    let now = banda_kernel::now_ms();
    let before: Option<(String, i64)> = tx
        .sql()
        .query_row(
            "SELECT version, last FROM problems_kept WHERE fingerprint = ?1",
            [&fingerprint],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (first, times): (i64, u32) = tx.sql().query_row(
        "INSERT INTO problems_kept
         (fingerprint, source, kind, message, frames, version, first, last, times)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)
         ON CONFLICT (fingerprint) DO UPDATE SET
             source = excluded.source, kind = excluded.kind,
             message = excluded.message, frames = excluded.frames,
             version = excluded.version, last = excluded.last,
             times = times + 1
         RETURNING first, times",
        rusqlite::params![
            fingerprint,
            word(record.source),
            record.kind,
            record.message,
            serde_json::to_string(&record.frames)?,
            version,
            now
        ],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let new = before.is_none();
    if new {
        tx.sql().execute(
            "DELETE FROM problems_kept WHERE fingerprint IN
             (SELECT fingerprint FROM problems_kept ORDER BY last DESC LIMIT -1 OFFSET ?1)",
            [KEPT],
        )?;
    }
    let again = before.is_some_and(|(was, last)| was != version || day(last) != day(now));
    if new || again {
        let problem = Problem {
            first,
            times,
            ..Problem::first(record, fingerprint.clone(), version, now)
        };
        let kind = if new { "recorded" } else { "again" };
        tx.emit(kind, VERSION, Some(&fingerprint), author, &problem)?;
    }
    Ok(Recorded { fingerprint, new })
}

/// The day `at` is in, in UTC.
fn day(at: i64) -> i64 {
    at.div_euclid(24 * 60 * 60 * 1000)
}

fn all(sql: &rusqlite::Connection) -> Result<Vec<Problem>, Error> {
    let mut query = sql.prepare(
        "SELECT fingerprint, source, kind, message, frames, version, first, last, times
         FROM problems_kept ORDER BY last DESC",
    )?;
    let problems = query.query_map([], |row| {
        Ok(Problem {
            fingerprint: row.get(0)?,
            source: parsed(row, 1, |word| Ok(Value::String(word)))?,
            kind: row.get(2)?,
            message: row.get(3)?,
            frames: parsed(row, 4, |text| serde_json::from_str(&text))?,
            version: row.get(5)?,
            first: row.get(6)?,
            last: row.get(7)?,
            times: row.get(8)?,
        })
    })?;
    Ok(problems.collect::<Result<_, _>>()?)
}

/// A column this module wrote as JSON, or as the word serde gives.
fn parsed<T: DeserializeOwned>(
    row: &Row<'_>,
    index: usize,
    json: impl FnOnce(String) -> serde_json::Result<Value>,
) -> rusqlite::Result<T> {
    json(row.get(index)?)
        .and_then(serde_json::from_value)
        .map_err(|error| {
            let text = rusqlite::types::Type::Text;
            rusqlite::Error::FromSqlConversionFailure(index, text, Box::new(error))
        })
}

/// A log's last lines.
fn tail(path: &Path) -> std::io::Result<Vec<String>> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(TAIL_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    // Read from inside the file, the first line may be cut in two.
    let cut = usize::from(size > TAIL_BYTES);
    let from = lines.len().saturating_sub(TAIL).max(cut);
    Ok(lines[from.min(lines.len())..]
        .iter()
        .map(|&line| line.to_owned())
        .collect())
}
