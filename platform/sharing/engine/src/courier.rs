//! What goes, kept before it goes (ADR 0039, decision 8). The courier
//! hears the problems module's log through the kernel's listener, from
//! where it last acked (ADR 0082, decision 6): a Problem that is new, or
//! that broke again on a new day or in a new version, which the problems
//! module says once each, becomes `$exception` while `problems` is on,
//! kept in the transaction that acks it, so it is made once. As a day
//! ends, while `usage` is on, the day before becomes `day`; it looks as
//! it starts, as it hears, and every hour.
//!
//! Each event queues its post in the kernel's outbox, in the transaction
//! that keeps it: the posts go one at a time, the oldest first, from the
//! host ([`crate::post`]) with no window needed. With no network, a post
//! waits and tries again, every few minutes at most; after seven days the
//! event is dropped.
//!
//! What waits goes only as it was made: an event whose ID is no longer
//! the one sharing has, or whose kind was turned off since, is dropped
//! instead. A Banda that never sends makes nothing; it only hears on, so
//! a later run sends nothing of this one.
//!
//! Before the kernel kept them, sharing kept its own cursor,
//! `sharing_heard`, and sent what waited in `sharing_sent` itself. Its
//! listener begins where that cursor stood, and what waited is queued
//! once, as it opens; `sharing_heard` counts no more after that.

use crate::exception::{self, Banda};
use crate::post::Post;
use crate::settings::{self, Shares};
use crate::usage::{self, DAY_MS};
use crate::{Clock, Ids, KEPT_MS, Never};
use banda_kernel::{
    Effect, Error, Event, EventFilter, Listener, ModuleProject, Outcome, Retry, Tx,
};
use banda_problems::model::Problem;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// How often it looks whether a day ended, while it hears nothing.
const HOURLY: Duration = Duration::from_secs(60 * 60);

/// The name of its listener of the Problems, which makes each an `$exception`.
const LISTENER: &str = "exceptions";

/// The effect that posts one event, and the key its posts go in order by.
pub(crate) const POST: &str = "post";
const POSTS: &str = "posthog";

/// How long a post is tried: as long as its event is kept.
pub(crate) const TRIED: Retry = Retry::within(Duration::from_millis(KEPT_MS.unsigned_abs()));

#[derive(Clone)]
pub(crate) struct Courier {
    pub file: PathBuf,
    pub ids: Arc<Ids>,
    pub never: Option<Never>,
    pub channel: &'static str,
    pub clock: Clock,
    pub post: Arc<dyn Post>,
}

/// One post the outbox runs: the event kept as `sharing_sent`'s `row`.
#[derive(Serialize, Deserialize)]
struct Posting {
    row: i64,
}

/// Starts hearing the problems module, from where its own cursor stood
/// before the kernel kept one, and queues what waited to be sent then.
pub(crate) async fn start(courier: Courier, project: ModuleProject) -> Result<(), Error> {
    let filter = EventFilter {
        module: Some("problems".to_owned()),
        subject: None,
        kinds: Some(vec!["recorded".to_owned(), "again".to_owned()]),
    };
    let carried = project.read(heard_at).await?;
    let heard = project.listen_from(LISTENER, filter, carried).await?;
    project.write(carry).await?;
    tokio::spawn(courier.run(heard));
    Ok(())
}

impl Courier {
    /// Makes the day, then hears each Problem, till the machine's Project
    /// closes; it looks at the day every hour meanwhile.
    async fn run(self, mut heard: Listener) {
        loop {
            let Some(project) = heard.project() else {
                return;
            };
            if let Err(error) = self.day(&project).await {
                tracing::warn!(%error, "the day's usage was not counted");
            }
            drop(project);
            let event = match tokio::time::timeout(HOURLY, heard.next()).await {
                Err(_) => continue,
                Ok(Ok(Some(event))) => event,
                Ok(Ok(None)) => return,
                Ok(Err(error)) => {
                    tracing::warn!(%error, "sharing stops hearing the problems");
                    return;
                }
            };
            let Some(project) = heard.project() else {
                return;
            };
            if let Err(error) = self.make(&project, &heard, &event).await {
                tracing::warn!(%error, "a Problem's event was not made");
            }
        }
    }

    /// Keeps the day before as `day`, once, while usage is shared and was
    /// shared all that day. Usage turned on, or the ID changed, it starts
    /// counting from the next whole day, so nothing goes of a day before
    /// the Person said yes. It lets go of events past seven days too.
    async fn day(&self, project: &ModuleProject) -> Result<(), Error> {
        let since = banda_kernel::now_ms() - KEPT_MS;
        let old = move |tx: &mut Tx<'_>| {
            tx.sql()
                .execute("DELETE FROM sharing_sent WHERE made < ?1", [since])?;
            Ok(())
        };
        project.write(old).await?;
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
            return Ok(());
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
            return Ok(());
        };
        if since > yesterday * DAY_MS || last >= Some(yesterday) {
            return Ok(());
        }
        let counts = usage::count(project, yesterday).await?;
        let made = counts.any().then(|| {
            let banda = self.banda();
            let locale = usage::locale();
            let json = usage::day(yesterday, &counts, locale.as_deref(), &id, &banda);
            (usage::about(yesterday, &counts), json.to_string())
        });
        project
            .write(move |tx| {
                if let Some((about, json)) = made {
                    keep(tx, "day", &about, &json)?;
                }
                tx.sql()
                    .execute("UPDATE sharing_usage SET last = ?1", [yesterday])?;
                Ok(())
            })
            .await
    }

    fn banda(&self) -> Banda {
        Banda::this(self.channel)
    }

    fn shares(&self) -> Shares {
        settings::read(&self.file)
    }

    /// Keeps `event`'s Problem as `$exception`, while problems are shared,
    /// in the transaction that acks it, so it is made once.
    async fn make(
        &self,
        project: &ModuleProject,
        heard: &Listener,
        event: &Event,
    ) -> Result<(), Error> {
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
        let ack = heard.ack(event);
        project
            .write(move |tx| {
                tx.ack(&ack)?;
                if let Some((about, json)) = made {
                    keep(tx, "$exception", &about, &json)?;
                }
                Ok(())
            })
            .await
    }

    /// Posts the event kept as the effect's row, as the kernel's outbox
    /// runs it, and keeps when it went. One that should no longer go is
    /// dropped instead: gone, older than seven days, made for another ID,
    /// or of a kind turned off since. One PostHog did not take, or that
    /// this Banda does not send, tries again later.
    pub(crate) async fn post(&self, project: ModuleProject, effect: &Effect) -> Outcome {
        let Ok(Posting { row }) = serde_json::from_value(effect.payload.clone()) else {
            return Outcome::Fail("The post could not be read.".to_owned());
        };
        if let Some(never) = self.never {
            return Outcome::Retry(format!("This Banda never sends ({never:?})."));
        }
        let shares = self.shares();
        let (id, waiting) = match (
            self.ids.id(shares, false),
            project.read(move |sql| waiting(sql, row)).await,
        ) {
            (Ok(id), Ok(waiting)) => (id, waiting),
            (Err(error), _) | (_, Err(error)) => return Outcome::Retry(error.to_string()),
        };
        let Some(waiting) = waiting else {
            return Outcome::Done;
        };
        let on = match waiting.event.as_str() {
            "$exception" => shares.problems,
            _ => shares.usage,
        };
        let since = banda_kernel::now_ms() - KEPT_MS;
        if waiting.made < since || waiting.id != id || !on {
            return Outcome::done_writing(move |tx| {
                let drop = "DELETE FROM sharing_sent WHERE id = ?1 AND sent IS NULL";
                tx.sql().execute(drop, [row])?;
                Ok(())
            });
        }
        if let Err(why) = self.post.post(&waiting.json).await {
            tracing::debug!(%why, "an event waits to be sent");
            return Outcome::Retry(why);
        }
        let sent = banda_kernel::now_ms();
        Outcome::done_writing(move |tx| {
            tx.sql().execute(
                "UPDATE sharing_sent SET sent = ?1 WHERE id = ?2",
                [sent, row],
            )?;
            Ok(())
        })
    }
}

/// An event kept, waiting to go.
struct Waiting {
    event: String,
    json: String,
    made: i64,
    /// The ID it was made for.
    id: Option<String>,
}

/// The event kept as `row`, while it waits to go.
fn waiting(sql: &rusqlite::Connection, row: i64) -> Result<Option<Waiting>, Error> {
    let waiting = sql
        .query_row(
            "SELECT event, json, made, json_extract(json, '$.distinct_id') FROM sharing_sent
             WHERE id = ?1 AND sent IS NULL",
            [row],
            |row| {
                Ok(Waiting {
                    event: row.get(0)?,
                    json: row.get(1)?,
                    made: row.get(2)?,
                    id: row.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(waiting)
}

/// Where in the log its own cursor stood, before the kernel kept one.
fn heard_at(sql: &rusqlite::Connection) -> Result<Option<i64>, Error> {
    let at = sql
        .query_row("SELECT at FROM sharing_heard WHERE one = 1", [], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(at)
}

/// Queues the post of each event that waited in sharing's own outbox, once:
/// as the first engine whose kernel keeps the outbox opens it.
fn carry(tx: &mut Tx<'_>) -> Result<(), Error> {
    let carried: bool =
        tx.sql()
            .query_row("SELECT EXISTS (SELECT 1 FROM sharing_carried)", [], |row| {
                row.get(0)
            })?;
    if carried {
        return Ok(());
    }
    let waited: Vec<i64> = {
        let mut query = tx
            .sql()
            .prepare("SELECT id FROM sharing_sent WHERE sent IS NULL ORDER BY id")?;
        let rows = query.query_map([], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for row in waited {
        tx.enqueue(POST, POSTS, &Posting { row })?;
    }
    tx.sql()
        .execute("INSERT INTO sharing_carried (one) VALUES (1)", [])?;
    Ok(())
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

/// Keeps `event` to go, as made now, and queues its post.
fn keep(tx: &mut Tx<'_>, event: &str, about: &str, json: &str) -> Result<(), Error> {
    let row: i64 = tx.sql().query_row(
        "INSERT INTO sharing_sent (event, about, json, made) VALUES (?1, ?2, ?3, ?4)
         RETURNING id",
        params![event, about, json, banda_kernel::now_ms()],
        |row| row.get(0),
    )?;
    tx.enqueue(POST, POSTS, &Posting { row })
}
