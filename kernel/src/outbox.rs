//! Side effects run from the outbox, never from a live subscription (ADR
//! 0002, decision 3).
//!
//! A module queues an effect in the same transaction as the change that
//! needs it. Each Project has one worker. It runs a module's effects with the
//! same key one at a time, in the order they were queued, and effects with
//! different keys side by side. An effect claimed under an earlier boot of
//! the engine was cut short by a restart: its module says whether it runs
//! again or is abandoned, and writes what that means. Outbox rows are the
//! kernel's bookkeeping, not records of the work: what a Person sees of an
//! effect is the events its module writes.
//!
//! How a run ended is written in one transaction with what its module
//! writes of it, and that transaction is tried again until it commits: a
//! write that fails once never leaves an effect running, which would hold
//! its key, and every effect after it, until the engine starts again.

use crate::events::json_column;
use crate::module::Module;
use crate::project::Project;
use crate::store::KERNEL;
use crate::{Error, Tx, now_ms};
use futures::FutureExt;
use rusqlite::{Connection, params};
use serde_json::Value;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Weak};
use std::time::Duration;

/// One side effect, as its module queued it.
#[derive(Clone, Debug)]
pub struct Effect {
    pub id: i64,
    pub kind: String,
    pub key: String,
    pub payload: Value,
    /// How many times it ran before this run.
    pub attempts: u32,
}

/// How a run of an effect ended.
#[derive(Debug)]
pub enum Outcome {
    Done,
    /// It is done, and its module writes what came of it in the transaction
    /// that records that, as [`Outcome::done_writing`] says.
    DoneWriting(Writing),
    /// It may work later. The worker waits longer after each try, and gives
    /// up after [`ATTEMPTS`] tries.
    Retry(String),
    /// It will never work.
    Fail(String),
}

impl Outcome {
    /// Done, with `write` in the transaction that records it. The kernel
    /// tries that transaction again until it commits, so `write` may run
    /// more than once, and only its last run stays. After [`ATTEMPTS`]
    /// tries the effect is settled as failed instead (see [`Settled`]).
    pub fn done_writing(
        write: impl Fn(&mut Tx<'_>) -> Result<(), Error> + Send + Sync + 'static,
    ) -> Self {
        Self::DoneWriting(Writing(Box::new(write)))
    }
}

/// What a module writes as an effect ends: see [`Outcome::done_writing`].
pub struct Writing(Box<Write>);

type Write = dyn Fn(&mut Tx<'_>) -> Result<(), Error> + Send + Sync;

impl std::fmt::Debug for Writing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Writing")
    }
}

/// What an effect that a restart cut short becomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnRestart {
    /// Running it again is safe.
    Replay,
    /// It died with something that is gone, such as a Harness's process.
    Abandon,
}

/// Why an effect will not run to its end. Its module writes what this means
/// for its own state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settled {
    Abandoned,
    Failed(String),
}

/// Tries before an effect that keeps asking to retry, that restarts keep
/// cutting short, or whose module's writing keeps failing, is failed.
pub const ATTEMPTS: u32 = 5;

const LONGEST_WAIT_MS: i64 = 30_000;

/// How long the worker waits when it could not read the outbox.
const READ_AGAIN: Duration = Duration::from_secs(1);

/// `first`, doubled after each try, up to thirty seconds.
fn doubling_ms(first: i64, tries: u32) -> i64 {
    (first << tries.min(10)).min(LONGEST_WAIT_MS)
}

/// How long an effect that asked to retry waits.
fn backoff_ms(attempts: u32) -> i64 {
    doubling_ms(500, attempts)
}

/// How long recording an effect's end waits before it tries again: short at
/// first, as a write that failed once mostly works the next time.
fn record_wait(tries: u32) -> Duration {
    Duration::from_millis(doubling_ms(50, tries).unsigned_abs())
}

fn find<'m>(modules: &'m [Arc<dyn Module>], name: &str) -> Option<&'m Arc<dyn Module>> {
    modules.iter().find(|m| m.name() == name)
}

/// Settles the effects an earlier boot claimed. Runs once, while the Project
/// opens, before its worker starts.
pub(crate) async fn recover(project: &Arc<Project>, boot: &str) -> Result<(), Error> {
    let boot = boot.to_owned();
    let cut_short = project
        .store()
        .read(move |sql| running_before(sql, &boot))
        .await?;
    for (module_name, effect) in cut_short {
        let Some(module) = find(project.modules(), &module_name).cloned() else {
            tracing::warn!(module = %module_name, id = effect.id, "an effect of a module this engine lacks stays as it is");
            continue;
        };
        let replay = module.on_restart(&effect.kind) == OnRestart::Replay;
        let name = module.name();
        project
            .store()
            .write(name, move |tx| {
                if !replay {
                    return settle(tx, &*module, &effect, Settled::Abandoned);
                }
                // An effect that takes the engine down with it must not
                // replay forever.
                if effect.attempts + 1 >= ATTEMPTS {
                    let reason = "Restarts cut it short too many times.".to_owned();
                    return settle(tx, &*module, &effect, Settled::Failed(reason));
                }
                tx.sql().execute(
                    "UPDATE kernel_outbox SET state = 'pending', boot = NULL, attempts = attempts + 1
                     WHERE id = ?1",
                    params![effect.id],
                )?;
                Ok(())
            })
            .await?;
    }
    Ok(())
}

/// The Project's worker: claims what is ready, runs it, records how it ended,
/// and sleeps until a commit queues more or a retry is due. It ends when the
/// Project is closed.
pub(crate) async fn work(project: Weak<Project>, boot: String) {
    let Some(signal) = project.upgrade().map(|s| s.store().outbox_signal()) else {
        return;
    };
    loop {
        let Some(open) = project.upgrade() else {
            return;
        };
        let wait = start_ready(&open, &boot).await.unwrap_or_else(|error| {
            tracing::error!(%error, "the outbox could not claim its effects");
            READ_AGAIN
        });
        drop(open);
        tokio::select! {
            () = signal.notified() => {}
            () = tokio::time::sleep(wait) => {}
        }
    }
}

/// Starts what is ready, and answers how long until the next effect is due.
async fn start_ready(project: &Arc<Project>, boot: &str) -> Result<Duration, Error> {
    let boot = boot.to_owned();
    let claimed = project
        .store()
        .write(KERNEL, move |tx| claim(tx, &boot))
        .await?;
    for (module_name, effect) in claimed {
        start(project, module_name, effect);
    }
    Ok(match project.store().read(next_due).await? {
        Some(at) => Duration::from_millis(u64::try_from((at - now_ms()).max(0)).unwrap_or(0)),
        None => Duration::from_secs(3600),
    })
}

fn start(project: &Arc<Project>, module_name: String, effect: Effect) {
    let project = project.clone();
    tokio::spawn(async move {
        let Some(module) = find(project.modules(), &module_name).cloned() else {
            tracing::error!(module = %module_name, "a claimed effect has no module");
            return;
        };
        // A run that panics ends as failed, not running forever.
        let run = module.run(project.module(module.name()), effect.clone());
        let outcome = AssertUnwindSafe(run)
            .catch_unwind()
            .await
            .unwrap_or_else(|_| {
                tracing::error!(kind = %effect.kind, "an effect panicked");
                Outcome::Fail("The engine broke off while it ran this.".to_owned())
            });
        let weak = Arc::downgrade(&project);
        drop(project);
        record(weak, module, effect, outcome).await;
    });
}

/// Records how a run of `effect` ended, trying again with a wait until it
/// commits or the Project closes. A module whose own writing keeps failing has
/// its effect settled as failed instead, which it writes too.
async fn record(project: Weak<Project>, module: Arc<dyn Module>, effect: Effect, outcome: Outcome) {
    let effect = Arc::new(effect);
    let mut outcome = Arc::new(outcome);
    let mut tries = 0;
    loop {
        if tries == ATTEMPTS && matches!(*outcome, Outcome::DoneWriting(_)) {
            let reason = "Banda could not write how it ended.".to_owned();
            outcome = Arc::new(Outcome::Fail(reason));
        }
        let Some(open) = project.upgrade() else {
            return;
        };
        let written = {
            let module = module.clone();
            let effect = effect.clone();
            let outcome = outcome.clone();
            open.store()
                .write(module.name(), move |tx| {
                    finish(tx, &*module, &effect, &outcome)
                })
                .await
        };
        match written {
            Ok(()) => {
                open.store().outbox_signal().notify_one();
                return;
            }
            Err(Error::Closed) => return,
            Err(error) => {
                tracing::error!(%error, id = effect.id, tries, "the outbox could not record how an effect ended");
            }
        }
        drop(open);
        tokio::time::sleep(record_wait(tries)).await;
        tries += 1;
    }
}

fn running_before(sql: &Connection, boot: &str) -> Result<Vec<(String, Effect)>, Error> {
    let mut statement = sql.prepare(
        "SELECT module, id, kind, key, payload, attempts FROM kernel_outbox
         WHERE state = 'running' AND (boot IS NULL OR boot != ?1) ORDER BY id",
    )?;
    let rows = statement.query_map(params![boot], read_effect)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The first pending effect of every key with nothing running, once it is due.
fn claim(tx: &mut Tx<'_>, boot: &str) -> Result<Vec<(String, Effect)>, Error> {
    let now = tx.now();
    let ready = {
        let mut statement = tx.sql().prepare(
            "SELECT o.module, o.id, o.kind, o.key, o.payload, o.attempts FROM kernel_outbox o
             WHERE o.state = 'pending' AND o.next_at <= ?1
               AND o.id = (SELECT MIN(p.id) FROM kernel_outbox p
                           WHERE p.module = o.module AND p.key = o.key AND p.state = 'pending')
               AND NOT EXISTS (SELECT 1 FROM kernel_outbox r
                               WHERE r.module = o.module AND r.key = o.key AND r.state = 'running')
             ORDER BY o.id",
        )?;
        let rows = statement.query_map(params![now], read_effect)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (_, effect) in &ready {
        tx.sql().execute(
            "UPDATE kernel_outbox SET state = 'running', boot = ?1 WHERE id = ?2",
            params![boot, effect.id],
        )?;
    }
    Ok(ready)
}

fn finish(
    tx: &mut Tx<'_>,
    module: &dyn Module,
    effect: &Effect,
    outcome: &Outcome,
) -> Result<(), Error> {
    match outcome {
        Outcome::Done | Outcome::DoneWriting(_) => {
            tx.sql().execute(
                "UPDATE kernel_outbox SET state = 'done', settled_at = ?1 WHERE id = ?2",
                params![tx.now(), effect.id],
            )?;
            if let Outcome::DoneWriting(Writing(write)) = outcome {
                debug_assert_eq!(tx.module(), module.name());
                write(tx)?;
            }
            Ok(())
        }
        Outcome::Retry(reason) if effect.attempts + 1 < ATTEMPTS => {
            tx.sql().execute(
                "UPDATE kernel_outbox SET state = 'pending', boot = NULL, attempts = attempts + 1, next_at = ?1, error = ?2
                 WHERE id = ?3",
                params![tx.now() + backoff_ms(effect.attempts), reason, effect.id],
            )?;
            Ok(())
        }
        Outcome::Retry(reason) | Outcome::Fail(reason) => {
            settle(tx, module, effect, Settled::Failed(reason.clone()))
        }
    }
}

fn settle(
    tx: &mut Tx<'_>,
    module: &dyn Module,
    effect: &Effect,
    settled: Settled,
) -> Result<(), Error> {
    let (state, error) = match &settled {
        Settled::Abandoned => ("abandoned", None),
        Settled::Failed(reason) => ("failed", Some(reason.as_str())),
    };
    tx.sql().execute(
        "UPDATE kernel_outbox SET state = ?1, error = COALESCE(?2, error), settled_at = ?3 WHERE id = ?4",
        params![state, error, tx.now(), effect.id],
    )?;
    debug_assert_eq!(tx.module(), module.name());
    module.settle(tx, effect, &settled)
}

fn next_due(sql: &Connection) -> Result<Option<i64>, Error> {
    Ok(sql.query_row(
        "SELECT MIN(next_at) FROM kernel_outbox WHERE state = 'pending'",
        [],
        |row| row.get(0),
    )?)
}

fn read_effect(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Effect)> {
    Ok((
        row.get(0)?,
        Effect {
            id: row.get(1)?,
            kind: row.get(2)?,
            key: row.get(3)?,
            payload: json_column(row, 4)?,
            attempts: row.get(5)?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{backoff_ms, record_wait};
    use std::time::Duration;

    #[test]
    fn recording_an_end_tries_again_soon_then_every_thirty_seconds() {
        assert_eq!(record_wait(0), Duration::from_millis(50));
        assert_eq!(record_wait(4), Duration::from_millis(800));
        assert_eq!(record_wait(20), Duration::from_secs(30));
    }

    #[test]
    fn the_wait_doubles_and_stops_at_thirty_seconds() {
        assert_eq!(backoff_ms(0), 500);
        assert_eq!(backoff_ms(1), 1000);
        assert_eq!(backoff_ms(5), 16_000);
        assert_eq!(backoff_ms(6), 30_000);
        assert_eq!(backoff_ms(40), 30_000);
    }
}
