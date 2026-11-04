//! What goes, kept before it goes (ADR 0039, decision 8). The courier
//! hears the problems module's log from where it last heard: a Problem
//! that is new, or that broke again on a new day or in a new version,
//! which the problems module says once each, becomes `$exception` while
//! `problems` is on. As a day ends, while `usage` is on, the day before
//! becomes `day`; it looks as it starts, as it hears, and every hour.
//! What waits goes as it is made, and every few minutes
//! while any waits, the oldest first, through Banda's window: the window's
//! main posts it to PostHog with Chromium's network, so the engine holds
//! no TLS of its own. With no window, or no network, it waits, and goes
//! once it can; after seven days it is dropped.
//!
//! What waits goes only as it was made: an event whose ID is no longer
//! the one sharing has, or whose kind was turned off since, is dropped
//! instead. A Banda that never sends makes nothing; it only hears on, so
//! a later run sends nothing of this one.

use crate::exception::{self, Banda};
use crate::settings::{self, Shares};
use crate::usage::{self, DAY_MS};
use crate::{Clock, Ids, KEPT_MS, Never};
use banda_kernel::{Error, Event, EventFilter, Heard, ModuleProject, Participant, Tx};
use banda_problems::model::Problem;
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// How often what waits is tried again.
const AGAIN: Duration = Duration::from_secs(5 * 60);
/// How often it looks whether a day ended, while nothing waits.
const HOURLY: Duration = Duration::from_secs(60 * 60);
/// How long the window may take to post one event.
const POSTING: Duration = Duration::from_secs(30);

pub(crate) struct Courier {
    pub file: PathBuf,
    pub ids: Arc<Ids>,
    pub never: Option<Never>,
    pub channel: &'static str,
    pub clock: Clock,
}

/// Starts hearing the problems module and sending what waits.
pub(crate) async fn start(courier: Courier, project: ModuleProject) -> Result<(), Error> {
    let after = match project.read(heard_at).await? {
        Some(at) => at,
        None => project.at().await?,
    };
    let filter = EventFilter {
        module: Some("problems".to_owned()),
        subject: None,
        kinds: Some(vec!["recorded".to_owned(), "again".to_owned()]),
    };
    tokio::spawn(courier.run(project.react(after, filter)));
    Ok(())
}

impl Courier {
    /// Sends what waits, then hears each Problem, till the machine's
    /// Project closes; while something waits, it tries again every few
    /// minutes.
    async fn run(self, mut heard: Heard) {
        // What waited as Banda last ran goes first.
        let mut waiting = true;
        loop {
            let Some(project) = heard.project() else {
                return;
            };
            match self.day(&project).await {
                Ok(made) => waiting |= made,
                Err(error) => tracing::warn!(%error, "the day's usage was not counted"),
            }
            if waiting {
                waiting = self.send(&project).await.unwrap_or_else(|error| {
                    tracing::warn!(%error, "what sharing keeps was not sent");
                    true
                });
            }
            let wait = if waiting { AGAIN } else { HOURLY };
            let event = match tokio::time::timeout(wait, heard.next()).await {
                Err(_) => continue,
                Ok(Ok(Some(event))) => event,
                Ok(Ok(None)) => return,
                Ok(Err(error)) => {
                    tracing::warn!(%error, "sharing stops hearing the problems");
                    return;
                }
            };
            match self.make(&project, &event).await {
                Ok(made) => waiting |= made,
                Err(error) => tracing::warn!(%error, "a Problem's event was not made"),
            }
        }
    }

    /// Keeps the day before as `day`, once, while usage is shared and was
    /// shared all that day; says whether it made one. Usage turned on, or
    /// the ID changed, it starts counting from the next whole day, so
    /// nothing goes of a day before the Person said yes.
    async fn day(&self, project: &ModuleProject) -> Result<bool, Error> {
        let shares = self.shares();
        let id = match (self.never, shares.usage) {
            (None, true) => self.ids.id(shares, false)?,
            _ => None,
        };
        let now = (self.clock)();
        let yesterday = usage::day_of(now) - 1;
        let kept = project.read(usage_kept).await?;
        let Some(id) = id else {
            if kept.is_some() {
                (project.write(|tx| Ok(tx.sql().execute("DELETE FROM sharing_usage", [])?)))
                    .await?;
            }
            return Ok(false);
        };
        let kept = kept.filter(|(kept, ..)| *kept == id);
        let Some((_, since, last)) = kept else {
            project
                .write(move |tx| {
                    tx.sql().execute(
                        "INSERT INTO sharing_usage (one, id, since) VALUES (1, ?1, ?2)
                         ON CONFLICT (one) DO UPDATE
                         SET id = excluded.id, since = excluded.since, last = NULL",
                        params![id, now],
                    )?;
                    Ok(())
                })
                .await?;
            return Ok(false);
        };
        if since > yesterday * DAY_MS || last >= Some(yesterday) {
            return Ok(false);
        }
        let counts = usage::count(project, yesterday).await?;
        let made = counts.any().then(|| {
            let banda = self.banda();
            let locale = usage::locale();
            let json = usage::day(yesterday, &counts, locale.as_deref(), &id, &banda);
            (usage::about(yesterday, &counts), json.to_string())
        });
        let making = made.is_some();
        project
            .write(move |tx| {
                if let Some((about, json)) = made {
                    keep(tx, "day", &about, &json)?;
                }
                tx.sql()
                    .execute("UPDATE sharing_usage SET last = ?1", [yesterday])?;
                Ok(())
            })
            .await?;
        Ok(making)
    }

    fn banda(&self) -> Banda {
        Banda::this(self.channel)
    }

    fn shares(&self) -> Shares {
        settings::read(&self.file)
    }

    /// Keeps `event`'s Problem as `$exception`, while problems are shared,
    /// and that it was heard; says whether it made one.
    async fn make(&self, project: &ModuleProject, event: &Event) -> Result<bool, Error> {
        let seq = event.seq;
        let shares = self.shares();
        let made = match (self.never, shares.problems) {
            (None, true) => {
                let problem: Problem = serde_json::from_value(event.payload.clone())?;
                let id = self.ids.id(shares, false)?.unwrap_or_default();
                let json = exception::exception(&problem, &id, &self.banda()).to_string();
                Some((exception::about(&problem), json))
            }
            _ => None,
        };
        let making = made.is_some();
        project
            .write(move |tx| {
                if let Some((about, json)) = made {
                    keep(tx, "$exception", &about, &json)?;
                }
                tx.sql().execute(
                    "INSERT INTO sharing_heard (one, at) VALUES (1, ?1)
                     ON CONFLICT (one) DO UPDATE SET at = excluded.at",
                    [seq],
                )?;
                Ok(())
            })
            .await?;
        Ok(making)
    }

    /// Drops what is too old, or no longer to go, then posts the rest,
    /// the oldest first, till one does not go; says whether any waits.
    async fn send(&self, project: &ModuleProject) -> Result<bool, Error> {
        if self.never.is_some() {
            return Ok(false);
        }
        let shares = self.shares();
        let id = self.ids.id(shares, false)?;
        let since = banda_kernel::now_ms() - KEPT_MS;
        let waiting: Vec<(i64, String)> = project
            .write(move |tx| {
                tx.sql().execute(
                    "DELETE FROM sharing_sent WHERE made < ?1 OR (sent IS NULL AND (
                         json_extract(json, '$.distinct_id') IS NOT ?2
                         OR (event = '$exception' AND NOT ?3)
                         OR (event <> '$exception' AND NOT ?4)))",
                    params![since, id, shares.problems, shares.usage],
                )?;
                let mut query = tx
                    .sql()
                    .prepare("SELECT id, json FROM sharing_sent WHERE sent IS NULL ORDER BY id")?;
                let rows = query.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
                Ok(rows.collect::<Result<_, _>>()?)
            })
            .await?;
        let owner = Participant::Person(project.owner());
        for (row, json) in waiting {
            let event: Value = serde_json::from_str(&json)?;
            let asked = json!({ "event": event });
            if let Err(refusal) = project.ask_window(owner, "post", asked, POSTING).await {
                tracing::debug!(%refusal, "an event waits to be sent");
                return Ok(true);
            }
            let now = banda_kernel::now_ms();
            project
                .write(move |tx| {
                    tx.sql().execute(
                        "UPDATE sharing_sent SET sent = ?1 WHERE id = ?2",
                        [now, row],
                    )?;
                    Ok(())
                })
                .await?;
        }
        Ok(false)
    }
}

/// Where in the log it last heard.
fn heard_at(sql: &rusqlite::Connection) -> Result<Option<i64>, Error> {
    let at = sql
        .query_row("SELECT at FROM sharing_heard WHERE one = 1", [], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(at)
}

/// The ID usage is counted for, since when, and the last day it made.
fn usage_kept(sql: &rusqlite::Connection) -> Result<Option<(String, i64, Option<i64>)>, Error> {
    let kept = sql
        .query_row("SELECT id, since, last FROM sharing_usage", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()?;
    Ok(kept)
}

/// Keeps `event` to go, as made now.
fn keep(tx: &Tx, event: &str, about: &str, json: &str) -> Result<(), Error> {
    tx.sql().execute(
        "INSERT INTO sharing_sent (event, about, json, made) VALUES (?1, ?2, ?3, ?4)",
        params![event, about, json, banda_kernel::now_ms()],
    )?;
    Ok(())
}
