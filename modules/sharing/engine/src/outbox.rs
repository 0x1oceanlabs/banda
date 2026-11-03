//! What goes, kept before it goes (ADR 0039, decision 8). The courier
//! hears the problems module's log from where it last heard: a Problem
//! that is new, or that broke again on a new day or in a new version,
//! which the problems module says once each, becomes `$exception` while
//! `problems` is on. What waits goes as it is made, and every few minutes
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
use crate::{Ids, KEPT_MS, Never};
use banda_kernel::{Error, Event, EventFilter, Heard, ModuleSpace, Participant};
use banda_problems::model::Problem;
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// How often what waits is tried again.
const AGAIN: Duration = Duration::from_secs(5 * 60);
/// How long the window may take to post one event.
const POSTING: Duration = Duration::from_secs(30);

pub(crate) struct Courier {
    pub file: PathBuf,
    pub ids: Arc<Ids>,
    pub never: Option<Never>,
    pub channel: &'static str,
}

/// Starts hearing the problems module and sending what waits.
pub(crate) async fn start(courier: Courier, space: ModuleSpace) -> Result<(), Error> {
    let after = match space.read(heard_at).await? {
        Some(at) => at,
        None => space.at().await?,
    };
    let filter = EventFilter {
        module: Some("problems".to_owned()),
        subject: None,
        kinds: Some(vec!["recorded".to_owned(), "again".to_owned()]),
    };
    tokio::spawn(courier.run(space.react(after, filter)));
    Ok(())
}

impl Courier {
    /// Sends what waits, then hears each Problem, till the machine's
    /// Space closes; while something waits, it tries again every few
    /// minutes.
    async fn run(self, mut heard: Heard) {
        // What waited as Banda last ran goes first.
        let mut waiting = true;
        loop {
            if waiting {
                let Some(space) = heard.space() else { return };
                waiting = self.send(&space).await.unwrap_or_else(|error| {
                    tracing::warn!(%error, "what sharing keeps was not sent");
                    true
                });
            }
            let next = if waiting {
                match tokio::time::timeout(AGAIN, heard.next()).await {
                    Ok(next) => next,
                    Err(_) => continue,
                }
            } else {
                heard.next().await
            };
            let event = match next {
                Ok(Some(event)) => event,
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(%error, "sharing stops hearing the problems");
                    return;
                }
            };
            let Some(space) = heard.space() else { return };
            match self.make(&space, &event).await {
                Ok(made) => waiting |= made,
                Err(error) => tracing::warn!(%error, "a Problem's event was not made"),
            }
        }
    }

    fn shares(&self) -> Shares {
        settings::read(&self.file)
    }

    /// Keeps `event`'s Problem as `$exception`, while problems are shared,
    /// and that it was heard; says whether it made one.
    async fn make(&self, space: &ModuleSpace, event: &Event) -> Result<bool, Error> {
        let seq = event.seq;
        let shares = self.shares();
        let made = match (self.never, shares.problems) {
            (None, true) => {
                let problem: Problem = serde_json::from_value(event.payload.clone())?;
                let id = self.ids.id(shares, false)?.unwrap_or_default();
                let banda = Banda {
                    version: banda_kernel::version().to_owned(),
                    channel: self.channel,
                    os: std::env::consts::OS,
                };
                let json = exception::exception(&problem, &id, &banda).to_string();
                Some((exception::about(&problem), json))
            }
            _ => None,
        };
        let making = made.is_some();
        space
            .write(move |tx| {
                if let Some((about, json)) = made {
                    tx.sql().execute(
                        "INSERT INTO sharing_sent (event, about, json, made)
                         VALUES ('$exception', ?1, ?2, ?3)",
                        params![about, json, banda_kernel::now_ms()],
                    )?;
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
    async fn send(&self, space: &ModuleSpace) -> Result<bool, Error> {
        if self.never.is_some() {
            return Ok(false);
        }
        let shares = self.shares();
        let id = self.ids.id(shares, false)?;
        let since = banda_kernel::now_ms() - KEPT_MS;
        let waiting: Vec<(i64, String)> = space
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
        let owner = Participant::Person(space.owner());
        for (row, json) in waiting {
            let event: Value = serde_json::from_str(&json)?;
            let asked = json!({ "event": event });
            if let Err(refusal) = space.ask_window(owner, "post", asked, POSTING).await {
                tracing::debug!(%refusal, "an event waits to be sent");
                return Ok(true);
            }
            let now = banda_kernel::now_ms();
            space
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
