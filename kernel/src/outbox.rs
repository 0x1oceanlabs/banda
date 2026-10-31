//! Side effects run from the outbox, never from a live subscription (ADR
//! 0002, decision 3).
//!
//! A module queues an effect in the same transaction as the change that
//! needs it. Each Space has one worker. It runs a module's effects with the
//! same key one at a time, in the order they were queued, and effects with
//! different keys side by side. An effect claimed by an earlier run of the
//! engine was cut short by a restart: its module says whether it runs again
//! or is abandoned, and writes what that means.

use crate::module::Module;
use crate::space::Space;
use crate::store::KERNEL;
use crate::{Error, Tx, now_ms};
use rusqlite::{Connection, params};
use serde_json::Value;
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Done,
    /// It may work later. The worker waits longer after each try, and gives
    /// up after [`ATTEMPTS`] tries.
    Retry(String),
    /// It will never work.
    Fail(String),
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

/// Tries before an effect that keeps asking to retry is failed.
pub const ATTEMPTS: u32 = 5;

const LONGEST_WAIT_MS: i64 = 30_000;

fn backoff_ms(attempts: u32) -> i64 {
    (500_i64 << attempts.min(10)).min(LONGEST_WAIT_MS)
}

fn find<'m>(modules: &'m [Arc<dyn Module>], name: &str) -> Option<&'m Arc<dyn Module>> {
    modules.iter().find(|m| m.name() == name)
}

/// Settles the effects an earlier run claimed. Runs once, while the Space
/// opens, before its worker starts.
pub(crate) async fn recover(space: &Arc<Space>, run: &str) -> Result<(), Error> {
    let run = run.to_owned();
    let cut_short = space
        .store()
        .read(move |sql| running_before(sql, &run))
        .await?;
    for (module_name, effect) in cut_short {
        let Some(module) = find(space.modules(), &module_name).cloned() else {
            tracing::warn!(module = %module_name, id = effect.id, "an effect of a module this engine lacks stays as it is");
            continue;
        };
        let replay = module.on_restart(&effect.kind) == OnRestart::Replay;
        let name = module.name();
        space
            .store()
            .write(name, move |tx| {
                if replay {
                    tx.sql().execute(
                        "UPDATE kernel_outbox SET state = 'pending', run = NULL WHERE id = ?1",
                        params![effect.id],
                    )?;
                    Ok(())
                } else {
                    settle(tx, &*module, &effect, Settled::Abandoned)
                }
            })
            .await?;
    }
    Ok(())
}

/// The Space's worker: claims what is ready, runs it, records how it ended,
/// and sleeps until a commit queues more or a retry is due. It ends when the
/// Space is closed.
pub(crate) async fn work(space: Weak<Space>, run: String) {
    let Some(signal) = space.upgrade().map(|s| s.store().outbox_signal()) else {
        return;
    };
    loop {
        let Some(open) = space.upgrade() else { return };
        let claimed = {
            let run = run.clone();
            open.store().write(KERNEL, move |tx| claim(tx, &run)).await
        };
        match claimed {
            Ok(claimed) => {
                for (module_name, effect) in claimed {
                    start(&open, module_name, effect);
                }
            }
            Err(error) => tracing::error!(%error, "the outbox could not claim its effects"),
        }
        let next_due = open.store().read(next_due).await.ok().flatten();
        drop(open);
        let wait = next_due
            .map(|at| Duration::from_millis(u64::try_from((at - now_ms()).max(0)).unwrap_or(0)))
            .unwrap_or(Duration::from_secs(3600));
        tokio::select! {
            () = signal.notified() => {}
            () = tokio::time::sleep(wait) => {}
        }
    }
}

fn start(space: &Arc<Space>, module_name: String, effect: Effect) {
    let space = space.clone();
    tokio::spawn(async move {
        let Some(module) = find(space.modules(), &module_name).cloned() else {
            tracing::error!(module = %module_name, "a claimed effect has no module");
            return;
        };
        let outcome = module
            .run(space.module(module.name()), effect.clone())
            .await;
        let name = module.name();
        let recorded = space
            .store()
            .write(name, move |tx| finish(tx, &*module, &effect, outcome))
            .await;
        if let Err(error) = recorded {
            tracing::error!(%error, "the outbox could not record how an effect ended");
        }
        space.store().outbox_signal().notify_one();
    });
}

fn running_before(sql: &Connection, run: &str) -> Result<Vec<(String, Effect)>, Error> {
    let mut statement = sql.prepare(
        "SELECT module, id, kind, key, payload, attempts FROM kernel_outbox
         WHERE state = 'running' AND (run IS NULL OR run != ?1) ORDER BY id",
    )?;
    let rows = statement.query_map(params![run], read_effect)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The first pending effect of every key with nothing running, once it is due.
fn claim(tx: &mut Tx<'_>, run: &str) -> Result<Vec<(String, Effect)>, Error> {
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
            "UPDATE kernel_outbox SET state = 'running', run = ?1 WHERE id = ?2",
            params![run, effect.id],
        )?;
    }
    Ok(ready)
}

fn finish(
    tx: &mut Tx<'_>,
    module: &dyn Module,
    effect: &Effect,
    outcome: Outcome,
) -> Result<(), Error> {
    match outcome {
        Outcome::Done => {
            tx.sql().execute(
                "UPDATE kernel_outbox SET state = 'done', settled_at = ?1 WHERE id = ?2",
                params![tx.now(), effect.id],
            )?;
            Ok(())
        }
        Outcome::Retry(reason) if effect.attempts + 1 < ATTEMPTS => {
            tx.sql().execute(
                "UPDATE kernel_outbox SET state = 'pending', run = NULL, attempts = attempts + 1, next_at = ?1, error = ?2
                 WHERE id = ?3",
                params![tx.now() + backoff_ms(effect.attempts), reason, effect.id],
            )?;
            Ok(())
        }
        Outcome::Retry(reason) | Outcome::Fail(reason) => {
            settle(tx, module, effect, Settled::Failed(reason))
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
    let payload: String = row.get(4)?;
    Ok((
        row.get(0)?,
        Effect {
            id: row.get(1)?,
            kind: row.get(2)?,
            key: row.get(3)?,
            payload: serde_json::from_str(&payload).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?,
            attempts: row.get(5)?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::backoff_ms;

    #[test]
    fn the_wait_doubles_and_stops_at_thirty_seconds() {
        assert_eq!(backoff_ms(0), 500);
        assert_eq!(backoff_ms(1), 1000);
        assert_eq!(backoff_ms(5), 16_000);
        assert_eq!(backoff_ms(6), 30_000);
        assert_eq!(backoff_ms(40), 30_000);
    }
}
