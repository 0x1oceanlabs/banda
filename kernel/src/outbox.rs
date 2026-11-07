//! Side effects run from the outbox, never from a live subscription (ADR
//! 0002, decision 3).
//!
//! A module queues an effect in the same transaction as the change that
//! needs it. A module's effects with the same key run one at a time, in the
//! order they were queued, and effects with different keys side by side.
//! Outbox rows are the kernel's bookkeeping, not records of the work: what a
//! Person sees of an effect is the events its module writes.
//!
//! Who runs an effect, and how a run cut short is found (ADR 0082, A6):
//!
//! - The engine runs most, in one loop per Project, and owns what it runs
//!   by its boot. An effect it claimed under an earlier boot was cut short
//!   by a restart: its module says whether it runs again or is abandoned,
//!   and writes what that means. A process cannot sleep without its boot,
//!   so this needs no clock.
//! - A worker outside the engine runs the effects queued for one, under a
//!   lease it renews. A lease runs on the engine's monotonic clock, never
//!   the wall clock, and one that runs out is cut short as a restart cuts
//!   the engine's runs, at any time, not only as the engine starts. A
//!   restart gives a lease a fresh term once: one its worker did not renew
//!   through a whole run of the engine is cut short as the next starts.
//!   Each claim of an effect has its token, checked as the worker renews
//!   and settles, and as its module writes for it: once the effect was
//!   taken again or settled, its late worker writes nothing. So an effect
//!   a worker runs may run twice, and its end is written once: what it
//!   does outside Banda carries an idempotency key, or looks before it
//!   writes.
//!
//! How a run ended is written in one transaction with what its module
//! writes of it, and that transaction is tried again until it commits: a
//! write that fails once never leaves an effect running, which would hold
//! its key, and every effect after it, until the engine starts again.
//!
//! An effect that asks to retry waits longer after each try, for as long
//! as its kind's [`Retry`] says. The rows of effects that settled, and the
//! receipts, go once the kernel keeps them no longer (`Store::collect`).

use crate::events::json_column;
use crate::module::Module;
use crate::project::Project;
use crate::store::KERNEL;
use crate::{Error, Refusal, Tx, now_ms};
use futures::FutureExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::time::{Instant, MissedTickBehavior};

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

/// One claim of an effect: its row, and its token, which counts the times
/// the effect was taken. Only its latest claim holds an effect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Claim {
    pub effect: i64,
    pub token: i64,
}

/// An effect a worker outside the engine took, and the claim it renews,
/// writes and settles under.
#[derive(Clone, Debug)]
pub struct Lease {
    pub effect: Effect,
    pub claim: Claim,
}

/// How a run of an effect ended.
#[derive(Debug)]
pub enum Outcome {
    Done,
    /// It is done, and its module writes what came of it in the transaction
    /// that records that, as [`Outcome::done_writing`] says.
    DoneWriting(Writing),
    /// It may work later. It waits longer after each try, and gives up as
    /// its kind's [`Retry`] says.
    Retry(String),
    /// It will never work.
    Fail(String),
}

impl Outcome {
    /// Done, with `write` in the transaction that records it. The kernel
    /// tries that transaction again until it commits, so `write` may run
    /// more than once, and only its last run stays. After five tries the
    /// effect is settled as failed instead (see [`Settled`]).
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

/// What an effect that a restart cut short becomes, or one whose worker's
/// lease ran out.
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
/// cutting short, or whose module's writing keeps failing, is failed, unless
/// its kind's [`Retry`] says otherwise.
pub(crate) const ATTEMPTS: u32 = 5;

/// How an effect that asks to retry tries again: its module's
/// [`Module::retry`](crate::Module::retry) for its kind (ADR 0082, A6). A
/// run cut short, by a restart or a lease that ran out, counts as a try,
/// and waits as one. The wait doubles after each try, up to its longest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Retry {
    tries: u32,
    within: Option<Duration>,
    first: Duration,
    longest: Duration,
}

impl Retry {
    /// For work on this host, such as a Harness's: `tries` tries, the wait
    /// doubling from half a second up to thirty seconds. Five is the
    /// default.
    pub const fn tries(tries: u32) -> Retry {
        Retry {
            tries,
            within: None,
            first: Duration::from_millis(500),
            longest: Duration::from_secs(30),
        }
    }

    /// For work over the network, which a dropped Wi-Fi or a host waking
    /// from sleep fails for a while: tries until `within` after the effect
    /// was queued, then five tries more, so a host that slept through its
    /// deadline still tries as it wakes; the wait doubling from half a
    /// second up to five minutes. Its runs cut short count up to five
    /// whatever the deadline: an effect that takes the engine down with it,
    /// or its worker, does not replay until then.
    pub const fn within(within: Duration) -> Retry {
        Retry {
            tries: ATTEMPTS,
            within: Some(within),
            first: Duration::from_millis(500),
            longest: Duration::from_secs(300),
        }
    }

    /// The same, with the wait doubling from `first` up to `longest`.
    pub const fn waiting(self, first: Duration, longest: Duration) -> Retry {
        Retry {
            first,
            longest,
            ..self
        }
    }

    /// The try from which an effect over the network counts its tries: the
    /// first that ended past its deadline. `late` is that try, if an earlier
    /// one ended past it, and `attempts` are the tries before the one that
    /// ends at `now`. None for work on this host, which counts every try,
    /// and before the deadline. A deadline is read on the wall clock: it
    /// bounds how long to try, and nothing that runs once rests on it.
    fn late_from(&self, late: Option<u32>, attempts: u32, queued: i64, now: i64) -> Option<u32> {
        let within = self.within?;
        late.or_else(|| (now >= queued.saturating_add(ms(within))).then_some(attempts))
    }

    /// Whether an effect gives up as its `tries`-th try asked to retry or
    /// was cut short, `late` being where it counts its tries from, as
    /// [`Retry::late_from`] says.
    fn gives_up(&self, tries: u32, late: Option<u32>) -> bool {
        match self.within {
            None => tries >= self.tries,
            Some(_) => late.is_some_and(|late| tries.saturating_sub(late) >= self.tries),
        }
    }

    /// How long an effect that ran `attempts` times before the try that
    /// asked to retry waits.
    fn wait_ms(&self, attempts: u32) -> i64 {
        doubling_ms(ms(self.first), attempts, ms(self.longest))
    }
}

impl Default for Retry {
    fn default() -> Retry {
        Retry::tries(ATTEMPTS)
    }
}

/// How often a Project's loop lets go of what the kernel keeps no longer.
const COLLECT_EVERY: Duration = Duration::from_secs(3600);

/// The longest lease a worker gets at once: an effect whose worker stopped
/// renewing it is taken again within it.
pub const LONGEST_LEASE: Duration = Duration::from_secs(600);

/// How long the loop waits when it could not read the outbox, or cut a
/// lease short.
const READ_AGAIN: Duration = Duration::from_secs(1);

/// How long it sleeps with nothing due.
const IDLE: Duration = Duration::from_secs(3600);

/// The tries recording a run's end waits between, short at first, as a
/// write that failed once mostly works the next time.
const RECORD_FIRST_MS: i64 = 50;
const RECORD_LONGEST_MS: i64 = 30_000;

/// `first`, doubled after each try, up to `longest`.
fn doubling_ms(first: i64, tries: u32, longest: i64) -> i64 {
    first.saturating_mul(1 << tries.min(20)).min(longest)
}

fn ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

/// How long recording an effect's end waits before it tries again.
fn record_wait(tries: u32) -> Duration {
    Duration::from_millis(doubling_ms(RECORD_FIRST_MS, tries, RECORD_LONGEST_MS).unsigned_abs())
}

/// This run of the engine: what marks the effects it runs, and the clock
/// its leases run on. That clock is monotonic: setting the wall clock moves
/// no lease, and on Linux and macOS it stands still while the host sleeps,
/// as a worker on the host does, so a laptop that wakes finds its leases as
/// it left them. That an end is written once never rests on it: the
/// claim's token sees to that.
#[derive(Clone, Debug)]
pub(crate) struct Boot {
    id: String,
    started: Instant,
}

impl Boot {
    pub(crate) fn new() -> Boot {
        Boot {
            id: uuid::Uuid::now_v7().to_string(),
            started: Instant::now(),
        }
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    /// Milliseconds since this boot began, on its own clock.
    fn now(&self) -> i64 {
        ms(self.started.elapsed())
    }
}

/// An effect as the kernel holds it while it runs: its module, its claim,
/// and how it counts its tries.
struct Claimed {
    module: String,
    effect: Effect,
    token: i64,
    /// When it was queued, on the wall clock.
    queued: i64,
    /// Where it counts its tries from, past its deadline
    /// ([`Retry::late_from`]).
    late_from: Option<u32>,
    /// How many of its runs were cut short.
    cuts: u32,
    /// The worker it was leased to last, for one a worker runs.
    worker: Option<String>,
}

/// The columns [`read_claimed`] reads, of the outbox as `o`.
const CLAIMED: &str = "o.module, o.id, o.kind, o.key, o.payload, o.attempts, o.claim, o.created_at,
     o.late_from, o.cuts, o.worker";

/// A pending effect that may run now: the first of its key, with nothing of
/// its key running, whoever runs it.
const FIRST_OF_ITS_KEY: &str = "o.id = (SELECT MIN(p.id) FROM kernel_outbox p
                 WHERE p.module = o.module AND p.key = o.key AND p.state = 'pending')
           AND NOT EXISTS (SELECT 1 FROM kernel_outbox r
                 WHERE r.module = o.module AND r.key = o.key AND r.state = 'running')";

fn find<'m>(modules: &'m [Arc<dyn Module>], name: &str) -> Option<&'m Arc<dyn Module>> {
    modules.iter().find(|m| m.name() == name)
}

/// What cut a run short.
#[derive(Clone, Copy)]
enum Cut {
    /// The engine started again: the run died with the boot before, or its
    /// worker renewed its lease at no time on that boot, which gave it a
    /// fresh term.
    Restart,
    /// Its worker's lease ran out by `at`, on this boot's clock.
    Lease { at: i64 },
}

/// Settles what a restart cut short: the effects an earlier boot ran in
/// the engine, and the leases an earlier boot gave a fresh term that their
/// workers did not renew. Every other lease gets a fresh term on this
/// boot's clock, once: a worker that still runs renews or settles under
/// its claim, and one that went lets the term run out, or the next restart
/// cut it short. Runs once, while the Project opens, before its loop starts
/// and before any worker can reach it.
pub(crate) async fn recover(project: &Arc<Project>) -> Result<(), Error> {
    let boot = project.boot();
    let (id, now) = (boot.id.clone(), boot.now());
    project
        .store()
        .write(KERNEL, move |tx| {
            tx.kernel().execute(
                "UPDATE kernel_outbox SET boot = ?1, lease_until = ?2 + COALESCE(lease_ms, 0),
                   carried = 1
                 WHERE state = 'running' AND runner = 'worker' AND carried = 0
                   AND boot IS NOT ?1",
                params![id, now],
            )?;
            Ok(())
        })
        .await?;
    let id = boot.id.clone();
    let cut = project
        .store()
        .read(move |sql| running_before(sql, &id))
        .await?;
    for claimed in cut {
        cut_short(project, claimed, Cut::Restart).await?;
    }
    Ok(())
}

/// Ends a run that was cut short: its module says whether the effect runs
/// again, which counts as a try, or is abandoned. A lease renewed or
/// settled meanwhile is left as it is.
async fn cut_short(project: &Arc<Project>, claimed: Claimed, cut: Cut) -> Result<(), Error> {
    let (id, worker) = (claimed.effect.id, claimed.worker.clone());
    let Some(module) = find(project.modules(), &claimed.module).cloned() else {
        tracing::warn!(module = %claimed.module, id, "an effect of a module this engine lacks stays as it is");
        // It no longer counts among the leases to wait for.
        return project
            .store()
            .write(KERNEL, move |tx| {
                tx.kernel().execute(
                    "UPDATE kernel_outbox SET lease_until = NULL WHERE id = ?1",
                    params![id],
                )?;
                Ok(())
            })
            .await;
    };
    let name = module.name();
    let was_cut = project
        .store()
        .write(name, move |tx| {
            if let Cut::Lease { at } = cut {
                let ran_out: bool = tx.kernel().query_row(
                    "SELECT EXISTS (SELECT 1 FROM kernel_outbox WHERE id = ?1 AND claim = ?2
                       AND state = 'running' AND lease_until <= ?3)",
                    params![id, claimed.token, at],
                    |row| row.get(0),
                )?;
                if !ran_out {
                    return Ok(false);
                }
            }
            let kind = &claimed.effect.kind;
            if module.on_restart(kind) == OnRestart::Abandon {
                return settle(tx, &*module, &claimed, Settled::Abandoned);
            }
            let (retry, now, attempts) = (module.retry(kind), tx.now(), claimed.effect.attempts);
            let late = retry.late_from(claimed.late_from, attempts, claimed.queued, now);
            // An effect that takes the engine down with it, or its worker,
            // must not replay forever, nor until a deadline far off.
            if retry.gives_up(attempts + 1, late) || claimed.cuts + 1 >= retry.tries {
                let reason = match claimed.worker {
                    None => "Restarts cut it short too many times.",
                    Some(_) => "Its worker stopped renewing its lease too many times.",
                };
                return settle(tx, &*module, &claimed, Settled::Failed(reason.to_owned()));
            }
            tx.kernel().execute(
                "UPDATE kernel_outbox SET state = 'pending', boot = NULL, lease_until = NULL,
                   attempts = attempts + 1, cuts = cuts + 1, late_from = ?1, next_at = ?2
                 WHERE id = ?3 AND claim = ?4 AND state = 'running'",
                params![late, now + retry.wait_ms(attempts), id, claimed.token],
            )?;
            Ok(true)
        })
        .await?;
    if let (true, Some(worker)) = (was_cut, worker) {
        tracing::warn!(id, %worker, "a worker renewed its lease no longer: its run was cut short");
    }
    Ok(())
}

/// The Project's loop: cuts short the leases that ran out, starts what the
/// engine runs once it is ready, records how each run ended, and sleeps
/// until a commit queues more, a retry is due or a lease runs out. As it
/// starts, and then every hour, it lets go of what the kernel keeps no
/// longer. It ends when the Project is closed.
pub(crate) async fn work(project: Weak<Project>) {
    let Some(signal) = project.upgrade().map(|open| open.store().outbox_signal()) else {
        return;
    };
    // Its first tick is at once.
    let mut collect = tokio::time::interval(COLLECT_EVERY);
    collect.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        let Some(open) = project.upgrade() else {
            return;
        };
        let wait = start_ready(&open).await.unwrap_or_else(|error| {
            tracing::error!(%error, "the outbox could not claim its effects");
            READ_AGAIN
        });
        drop(open);
        tokio::select! {
            () = signal.notified() => {}
            () = tokio::time::sleep(wait) => {}
            _ = collect.tick() => {
                let Some(open) = project.upgrade() else {
                    return;
                };
                match open.store().collect().await {
                    Ok(0) => {}
                    Ok(gone) => tracing::info!(gone, "the outbox let go of old rows"),
                    Err(error) => tracing::error!(%error, "the outbox could not let go of old rows"),
                }
            }
        }
    }
}

/// Cuts short the leases that ran out, starts what is ready, and answers
/// how long until the next effect is due or the next lease runs out. A
/// lease that could not be cut short holds up only its own key, and is
/// tried again soon.
async fn start_ready(project: &Arc<Project>) -> Result<Duration, Error> {
    let boot = project.boot();
    let (id, now) = (boot.id.clone(), boot.now());
    let ran_out = project
        .store()
        .read(move |sql| leases_ran_out(sql, &id, now))
        .await?;
    let mut wait = IDLE;
    for claimed in ran_out {
        let id = claimed.effect.id;
        if let Err(error) = cut_short(project, claimed, Cut::Lease { at: now }).await {
            tracing::error!(%error, id, "the outbox could not cut short a lease that ran out");
            wait = READ_AGAIN;
        }
    }
    let id = boot.id.clone();
    let claimed = project
        .store()
        .write(KERNEL, move |tx| claim(tx, &id))
        .await?;
    for claimed in claimed {
        start(project, claimed);
    }
    let id = boot.id.clone();
    let (due, runs_out) = project
        .store()
        .read(move |sql| next_due(sql, &id, now))
        .await?;
    let until = |at: i64, now: i64| Duration::from_millis((at - now).max(0).unsigned_abs());
    if let Some(at) = due {
        wait = wait.min(until(at, now_ms()));
    }
    if let Some(at) = runs_out {
        wait = wait.min(until(at, boot.now()));
    }
    Ok(wait)
}

fn start(project: &Arc<Project>, claimed: Claimed) {
    let project = project.clone();
    tokio::spawn(async move {
        let Some(module) = find(project.modules(), &claimed.module).cloned() else {
            tracing::error!(module = %claimed.module, "a claimed effect has no module");
            return;
        };
        // A run that panics ends as failed, not running forever.
        let run = module.run(project.module(module.name()), claimed.effect.clone());
        let outcome = AssertUnwindSafe(run)
            .catch_unwind()
            .await
            .unwrap_or_else(|_| {
                tracing::error!(kind = %claimed.effect.kind, "an effect panicked");
                Outcome::Fail("The engine broke off while it ran this.".to_owned())
            });
        let weak = Arc::downgrade(&project);
        drop(project);
        record(weak, module, claimed, outcome).await;
    });
}

/// Records how a run of the engine's ended, trying again with a wait until
/// it commits or the Project closes. A module whose own writing keeps
/// failing has its effect settled as failed instead, which it writes too.
async fn record(
    project: Weak<Project>,
    module: Arc<dyn Module>,
    claimed: Claimed,
    outcome: Outcome,
) {
    let claimed = Arc::new(claimed);
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
            let claimed = claimed.clone();
            let outcome = outcome.clone();
            open.store()
                .write(module.name(), move |tx| {
                    finish(tx, &*module, &claimed, &outcome)
                })
                .await
        };
        match written {
            // The boot that claimed it holds it until then.
            Ok(_) => {
                open.store().outbox_signal().notify_one();
                return;
            }
            Err(Error::Closed) => return,
            Err(error) => {
                let id = claimed.effect.id;
                tracing::error!(%error, id, tries, "the outbox could not record how an effect ended");
            }
        }
        drop(open);
        tokio::time::sleep(record_wait(tries)).await;
        tries += 1;
    }
}

/// Takes for `worker` the first ready effect of `module`'s `kinds` queued
/// for a worker, leased for `term` on this boot's clock.
pub(crate) async fn lease(
    project: &Arc<Project>,
    module: &'static str,
    worker: &str,
    kinds: &[&str],
    term: Duration,
) -> Result<Option<Lease>, Error> {
    let boot = project.boot();
    let (id, now, term) = (boot.id.clone(), boot.now(), ms(term.min(LONGEST_LEASE)));
    let (worker, kinds) = (worker.to_owned(), serde_json::to_string(kinds)?);
    let taken = project
        .store()
        .write(KERNEL, move |tx| {
            let ready = tx
                .kernel()
                .query_row(
                    &format!(
                        "SELECT {CLAIMED} FROM kernel_outbox o
                         WHERE o.module = ?1 AND o.state = 'pending' AND o.runner = 'worker'
                           AND o.kind IN (SELECT value FROM json_each(?2)) AND o.next_at <= ?3
                           AND {FIRST_OF_ITS_KEY}
                         ORDER BY o.id LIMIT 1"
                    ),
                    params![module, kinds, tx.now()],
                    read_claimed,
                )
                .optional()?;
            let Some(mut claimed) = ready else {
                return Ok(None);
            };
            take(&tx.kernel(), &mut claimed, &id)?;
            tx.kernel().execute(
                "UPDATE kernel_outbox SET worker = ?1, lease_ms = ?2, lease_until = ?3, carried = 0
                 WHERE id = ?4",
                params![worker, term, now + term, claimed.effect.id],
            )?;
            let claim = claimed.claim();
            Ok(Some(Lease {
                effect: claimed.effect,
                claim,
            }))
        })
        .await?;
    if taken.is_some() {
        // Its loop now waits for this lease to run out, too.
        project.store().outbox_signal().notify_one();
    }
    Ok(taken)
}

/// Renews `claim`'s lease for `term` from now, on this boot's clock.
pub(crate) async fn renew(
    project: &Arc<Project>,
    module: &'static str,
    claim: Claim,
    term: Duration,
) -> Result<(), Refusal> {
    let (now, term) = (project.boot().now(), ms(term.min(LONGEST_LEASE)));
    let renewed = project
        .store()
        .write(KERNEL, move |tx| {
            Ok(tx.kernel().execute(
                "UPDATE kernel_outbox SET lease_ms = ?1, lease_until = ?2, carried = 0
                 WHERE id = ?3 AND module = ?4 AND claim = ?5 AND state = 'running'
                   AND runner = 'worker'",
                params![term, now + term, claim.effect, module, claim.token],
            )?)
        })
        .await?;
    if renewed == 0 {
        return Err(lost_lease());
    }
    // A shorter term runs out before its loop would wake.
    project.store().outbox_signal().notify_one();
    Ok(())
}

/// Records how a run a worker held under `claim` ended, as `outcome` says.
pub(crate) async fn finish_leased(
    project: &Arc<Project>,
    module: &'static str,
    claim: Claim,
    outcome: Outcome,
) -> Result<(), Refusal> {
    let Some(of) = find(project.modules(), module).cloned() else {
        return Err(Refusal::not_found(format!("No module is named {module}.")));
    };
    let held = project
        .store()
        .write(module, move |tx| {
            let claimed = tx
                .kernel()
                .query_row(
                    &format!(
                        "SELECT {CLAIMED} FROM kernel_outbox o
                         WHERE o.id = ?1 AND o.module = ?2 AND o.claim = ?3
                           AND o.state = 'running' AND o.runner = 'worker'"
                    ),
                    params![claim.effect, module, claim.token],
                    read_claimed,
                )
                .optional()?;
            let Some(claimed) = claimed else {
                return Ok(false);
            };
            finish(tx, &*of, &claimed, &outcome)
        })
        .await?;
    if !held {
        return Err(lost_lease());
    }
    project.store().outbox_signal().notify_one();
    Ok(())
}

/// Whether `claim` still holds its effect, of `module`.
pub(crate) fn holds(sql: &Connection, module: &str, claim: Claim) -> Result<bool, Error> {
    Ok(sql.query_row(
        "SELECT EXISTS (SELECT 1 FROM kernel_outbox
           WHERE id = ?1 AND module = ?2 AND claim = ?3 AND state = 'running')",
        params![claim.effect, module, claim.token],
        |row| row.get(0),
    )?)
}

/// What a worker whose claim no longer holds its effect is told.
pub(crate) fn lost_lease() -> Refusal {
    Refusal::conflict(
        "This effect was taken again, as its lease ran out, or it was settled: \
         nothing was written.",
    )
}

/// What runs under an earlier boot: the engine's runs, and the leases an
/// earlier boot gave a fresh term that their workers did not renew.
fn running_before(sql: &Connection, boot: &str) -> Result<Vec<Claimed>, Error> {
    let mut statement = sql.prepare(&format!(
        "SELECT {CLAIMED} FROM kernel_outbox o
         WHERE o.state = 'running' AND o.boot IS NOT ?1
         ORDER BY o.id"
    ))?;
    let rows = statement.query_map(params![boot], read_claimed)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The leases `boot` gave that ran out by `now` on its clock.
fn leases_ran_out(sql: &Connection, boot: &str, now: i64) -> Result<Vec<Claimed>, Error> {
    let mut statement = sql.prepare(&format!(
        "SELECT {CLAIMED} FROM kernel_outbox o
         WHERE o.state = 'running' AND o.runner = 'worker' AND o.boot = ?1
           AND o.lease_until <= ?2
         ORDER BY o.id"
    ))?;
    let rows = statement.query_map(params![boot, now], read_claimed)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Claims for this boot the first pending effect the engine runs of every
/// key with nothing running, once it is due.
fn claim(tx: &mut Tx<'_>, boot: &str) -> Result<Vec<Claimed>, Error> {
    let (now, sql) = (tx.now(), tx.kernel());
    let mut ready = {
        let mut statement = sql.prepare(&format!(
            "SELECT {CLAIMED} FROM kernel_outbox o
             WHERE o.state = 'pending' AND o.runner = 'engine' AND o.next_at <= ?1
               AND {FIRST_OF_ITS_KEY}
             ORDER BY o.id"
        ))?;
        let rows = statement.query_map(params![now], read_claimed)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for claimed in &mut ready {
        take(&sql, claimed, boot)?;
    }
    Ok(ready)
}

/// Takes a pending effect for `boot`, under a claim whose token counts one
/// take more.
fn take(sql: &Connection, claimed: &mut Claimed, boot: &str) -> Result<(), Error> {
    claimed.token += 1;
    sql.execute(
        "UPDATE kernel_outbox SET state = 'running', boot = ?1, claim = ?2 WHERE id = ?3",
        params![boot, claimed.token, claimed.effect.id],
    )?;
    Ok(())
}

/// Records how a run ended, as its kind's [`Retry`] says, if its claim
/// still holds it: false, writing nothing, once the effect was taken again
/// or settled.
fn finish(
    tx: &mut Tx<'_>,
    module: &dyn Module,
    claimed: &Claimed,
    outcome: &Outcome,
) -> Result<bool, Error> {
    let effect = &claimed.effect;
    let (retry, now, attempts) = (module.retry(&effect.kind), tx.now(), effect.attempts);
    let late = retry.late_from(claimed.late_from, attempts, claimed.queued, now);
    match outcome {
        Outcome::Done | Outcome::DoneWriting(_) => {
            // Its module writes while the claim holds, as a worker's
            // writes check it with `Tx::holds`.
            if !holds(&tx.kernel(), &claimed.module, claimed.claim())? {
                return Ok(false);
            }
            if let Outcome::DoneWriting(Writing(write)) = outcome {
                debug_assert_eq!(tx.module(), module.name());
                write(tx)?;
            }
            tx.kernel().execute(
                "UPDATE kernel_outbox SET state = 'done', settled_at = ?1, lease_until = NULL
                 WHERE id = ?2",
                params![now, effect.id],
            )?;
            Ok(true)
        }
        Outcome::Retry(reason) if !retry.gives_up(attempts + 1, late) => Ok(tx.kernel().execute(
            "UPDATE kernel_outbox SET state = 'pending', boot = NULL, lease_until = NULL,
               attempts = attempts + 1, late_from = ?1, next_at = ?2, error = ?3
             WHERE id = ?4 AND claim = ?5 AND state = 'running'",
            params![
                late,
                now + retry.wait_ms(attempts),
                reason,
                effect.id,
                claimed.token
            ],
        )? == 1),
        Outcome::Retry(reason) | Outcome::Fail(reason) => {
            settle(tx, module, claimed, Settled::Failed(reason.clone()))
        }
    }
}

/// Settles an effect that will not run to its end, and has its module write
/// what that means, if its claim still holds it.
fn settle(
    tx: &mut Tx<'_>,
    module: &dyn Module,
    claimed: &Claimed,
    settled: Settled,
) -> Result<bool, Error> {
    let (state, error) = match &settled {
        Settled::Abandoned => ("abandoned", None),
        Settled::Failed(reason) => ("failed", Some(reason.as_str())),
    };
    let held = tx.kernel().execute(
        "UPDATE kernel_outbox SET state = ?1, error = COALESCE(?2, error), settled_at = ?3,
           lease_until = NULL
         WHERE id = ?4 AND claim = ?5 AND state = 'running'",
        params![state, error, tx.now(), claimed.effect.id, claimed.token],
    )? == 1;
    if !held {
        return Ok(false);
    }
    debug_assert_eq!(tx.module(), module.name());
    module.settle(tx, &claimed.effect, &settled)?;
    Ok(true)
}

/// When the first effect the engine runs that may start is due, on the
/// wall clock, and when the first lease `boot` gave that had not run out by
/// `now` runs out, on its own. One that waits behind a run of its key is
/// not due: the loop wakes as that run ends.
fn next_due(sql: &Connection, boot: &str, now: i64) -> Result<(Option<i64>, Option<i64>), Error> {
    let due = sql.query_row(
        &format!(
            "SELECT MIN(o.next_at) FROM kernel_outbox o
             WHERE o.state = 'pending' AND o.runner = 'engine' AND {FIRST_OF_ITS_KEY}"
        ),
        [],
        |row| row.get(0),
    )?;
    let runs_out = sql.query_row(
        "SELECT MIN(lease_until) FROM kernel_outbox
         WHERE state = 'running' AND runner = 'worker' AND boot = ?1 AND lease_until > ?2",
        params![boot, now],
        |row| row.get(0),
    )?;
    Ok((due, runs_out))
}

fn read_claimed(row: &rusqlite::Row<'_>) -> rusqlite::Result<Claimed> {
    Ok(Claimed {
        module: row.get(0)?,
        effect: Effect {
            id: row.get(1)?,
            kind: row.get(2)?,
            key: row.get(3)?,
            payload: json_column(row, 4)?,
            attempts: row.get(5)?,
        },
        token: row.get(6)?,
        queued: row.get(7)?,
        late_from: row.get(8)?,
        cuts: row.get(9)?,
        worker: row.get(10)?,
    })
}

impl Claimed {
    fn claim(&self) -> Claim {
        Claim {
            effect: self.effect.id,
            token: self.token,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ATTEMPTS, Retry, next_due, record_wait, running_before};
    use crate::store::{KERNEL, KERNEL_MIGRATIONS, migrate};
    use rusqlite::Connection;
    use std::time::Duration;

    #[test]
    fn recording_an_end_tries_again_soon_then_every_thirty_seconds() {
        assert_eq!(record_wait(0), Duration::from_millis(50));
        assert_eq!(record_wait(4), Duration::from_millis(800));
        assert_eq!(record_wait(20), Duration::from_secs(30));
    }

    #[test]
    fn the_wait_doubles_and_stops_at_its_longest() {
        let here = Retry::default();
        assert_eq!(here.wait_ms(0), 500);
        assert_eq!(here.wait_ms(1), 1000);
        assert_eq!(here.wait_ms(5), 16_000);
        assert_eq!(here.wait_ms(6), 30_000);
        assert_eq!(here.wait_ms(40), 30_000);
        let away = Retry::within(Duration::from_secs(3600));
        assert_eq!(away.wait_ms(6), 32_000);
        assert_eq!(away.wait_ms(9), 256_000);
        assert_eq!(away.wait_ms(40), 300_000);
        let quick = here.waiting(Duration::from_millis(1), Duration::from_millis(4));
        assert_eq!((quick.wait_ms(0), quick.wait_ms(9)), (1, 4));
    }

    #[test]
    fn work_on_this_host_gives_up_after_its_tries() {
        let here = Retry::default();
        assert_eq!(here.late_from(None, 40, 0, i64::MAX), None);
        assert!(!here.gives_up(ATTEMPTS - 1, None));
        assert!(here.gives_up(ATTEMPTS, None));
        assert!(Retry::tries(1).gives_up(1, None));
    }

    #[test]
    fn work_over_the_network_tries_until_its_deadline_then_five_times_more() {
        let hour = 3_600_000;
        let away = Retry::within(Duration::from_secs(3600));
        // Before its deadline, it goes on however many tries it had.
        assert_eq!(away.late_from(None, 40, 0, hour - 1), None);
        assert!(!away.gives_up(41, None));
        // Its tries count from the first that ends past it.
        let late = away.late_from(None, 40, 0, hour);
        assert_eq!(late, Some(40));
        assert!(!away.gives_up(44, late));
        assert!(away.gives_up(45, late));
        // A host that slept through the hour, ten tries in, still tries
        // five times as it wakes, and the first late try is where they
        // count from, however late the next ones are.
        let woke = away.late_from(None, 10, 0, 10 * hour);
        assert_eq!(woke, Some(10));
        assert!(!away.gives_up(11, woke));
        assert_eq!(away.late_from(woke, 13, 0, 11 * hour), Some(10));
        assert!(!away.gives_up(14, woke));
        assert!(away.gives_up(15, woke));
    }

    #[test]
    fn an_effect_queued_before_workers_had_leases_is_the_engines_after_the_step() {
        let mut sql = Connection::open_in_memory().unwrap();
        migrate(&mut sql, KERNEL, &KERNEL_MIGRATIONS[..1]).unwrap();
        sql.execute(
            "INSERT INTO kernel_outbox (module, kind, key, payload, state, boot, next_at, created_at)
             VALUES ('notes', 'publish', 'a', '{}', 'running', 'an-earlier-boot', 0, 0)",
            [],
        )
        .unwrap();
        migrate(&mut sql, KERNEL, KERNEL_MIGRATIONS).unwrap();
        let cut = running_before(&sql, "this boot").unwrap();
        assert_eq!(cut.len(), 1);
        let claimed = &cut[0];
        assert_eq!(
            (
                claimed.token,
                claimed.cuts,
                claimed.late_from,
                &claimed.worker
            ),
            (0, 0, None, &None)
        );
        let (runner, carried): (String, i64) = sql
            .query_row("SELECT runner, carried FROM kernel_outbox", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!((runner.as_str(), carried), ("engine", 0));
    }

    #[test]
    fn an_effect_behind_a_run_of_its_key_is_not_due() {
        let mut sql = Connection::open_in_memory().unwrap();
        migrate(&mut sql, KERNEL, KERNEL_MIGRATIONS).unwrap();
        let queue = |key: &str, state: &str, next_at: i64| {
            sql.execute(
                "INSERT INTO kernel_outbox (module, kind, key, payload, state, boot, next_at, created_at)
                 VALUES ('notes', 'publish', ?1, '{}', ?2, 'this boot', ?3, 0)",
                rusqlite::params![key, state, next_at],
            )
            .unwrap();
        };
        queue("a", "running", 0);
        queue("a", "pending", 0);
        // Due at once, it would wake the loop with nothing to start, again
        // and again, for as long as the run lasts.
        assert_eq!(next_due(&sql, "this boot", 0).unwrap(), (None, None));
        queue("b", "pending", 7);
        assert_eq!(next_due(&sql, "this boot", 0).unwrap(), (Some(7), None));
    }
}
