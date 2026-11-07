//! A Project's SQLite, with one writer (ADR 0002, decisions 2 and 4).
//!
//! The writer is one thread that owns the only writing connection. Every
//! change is a job that runs in one transaction. A change's events go out
//! to subscribers only after it commits, in commit order. A change that
//! panics is rolled back and refused, and the writer goes on. Readers use
//! their own connection: SQLite's WAL lets them read while the writer
//! writes.

use crate::events::{self, Event};
use crate::outbox::Claim;
use crate::{CommandId, Error, EventId, Participant, Refusal, now_ms};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tokio::sync::{Notify, broadcast, oneshot, watch};

/// The kernel's name in the event log, the receipts and the ledger.
pub(crate) const KERNEL: &str = "kernel";

/// How many committed events a slow subscriber may fall behind before it is
/// told to read again.
const SUBSCRIBER_LAG: usize = 4096;

/// How long the kernel keeps a receipt past its `at`, and an effect's row
/// past `settled_at`.
///
/// A resend comes within seven days of its command's first send: a client
/// keeps a command to send again seven days at most (`not_after`, ADR 0082,
/// decisions 4 and 16), and `banda mcp` sends one again at once, within its
/// session. A receipt's `at` is when it was last written, as its command
/// began or as it was answered, so never before its command first came:
/// every receipt outlives its resends' window by three weeks, on the host's
/// clock, where `not_after` is checked too. Within it a command sent again
/// gets its first answer and runs nothing again, `may_have_run` included;
/// past it, the same command ID runs as a new command. A receipt whose
/// command still runs stays however old ([`Store::collect`]).
pub(crate) const KEPT: Duration = Duration::from_secs(30 * 24 * 3600);

/// How many rows [`Store::collect`] lets go of in one transaction.
const BATCH: u16 = 1000;

/// The kernel's own steps. Each module keeps its own ledger next to them.
pub(crate) const KERNEL_MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE kernel_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    module TEXT NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    subject TEXT,
    author_kind TEXT NOT NULL,
    author_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX kernel_events_by_subject ON kernel_events (module, subject, seq);
CREATE TRIGGER kernel_events_are_not_changed BEFORE UPDATE ON kernel_events
BEGIN SELECT RAISE(ABORT, 'the event log is never rewritten'); END;
CREATE TRIGGER kernel_events_are_not_deleted BEFORE DELETE ON kernel_events
BEGIN SELECT RAISE(ABORT, 'the event log is never rewritten'); END;

CREATE TABLE kernel_receipts (
    command TEXT PRIMARY KEY,
    module TEXT NOT NULL,
    method TEXT NOT NULL,
    author_kind TEXT NOT NULL,
    author_id TEXT NOT NULL,
    ok TEXT,
    refusal TEXT,
    at INTEGER NOT NULL
);

CREATE TABLE kernel_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'abandoned', 'failed')),
    boot TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
);
CREATE INDEX kernel_outbox_by_key ON kernel_outbox (module, key, state, id);
"#,
    // Who runs an effect: the engine, or a worker outside it under a lease,
    // `lease_until` on the clock of the boot that gave it, and `carried`
    // while a restart gave it a fresh term its worker has not renewed.
    // `claim` counts the times an effect was taken: its claim's token.
    // `late_from` is the try an effect over the network counts its tries
    // from, past its deadline, and `cuts` its runs cut short. The indexes
    // let the rows a resend no longer needs go (ADR 0082, A6).
    r#"
ALTER TABLE kernel_outbox ADD COLUMN runner TEXT NOT NULL DEFAULT 'engine'
    CHECK (runner IN ('engine', 'worker'));
ALTER TABLE kernel_outbox ADD COLUMN claim INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kernel_outbox ADD COLUMN worker TEXT;
ALTER TABLE kernel_outbox ADD COLUMN lease_ms INTEGER;
ALTER TABLE kernel_outbox ADD COLUMN lease_until INTEGER;
ALTER TABLE kernel_outbox ADD COLUMN carried INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kernel_outbox ADD COLUMN late_from INTEGER;
ALTER TABLE kernel_outbox ADD COLUMN cuts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX kernel_outbox_by_settled ON kernel_outbox (settled_at) WHERE settled_at IS NOT NULL;
CREATE INDEX kernel_receipts_by_at ON kernel_receipts (at);
"#,
    // A receipt is written as its command begins and answered as it ends,
    // with a hash of the params and the command's place in the log (ADR
    // 0082, decision 4). One kept before is answered, and has no hash.
    r#"
ALTER TABLE kernel_receipts ADD COLUMN params TEXT;
ALTER TABLE kernel_receipts ADD COLUMN seq INTEGER;
ALTER TABLE kernel_receipts ADD COLUMN answered INTEGER NOT NULL DEFAULT 1;
"#,
];

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// What a command's run answered, for the resends that wait on it: `None`
/// while it runs.
type Ended = Option<Result<Answer, Refusal>>;

/// The commands running in this engine, by ID: see [`Running`].
type Runs = Arc<Mutex<HashMap<CommandId, watch::Receiver<Ended>>>>;

/// One open Project database.
pub(crate) struct Store {
    jobs: mpsc::Sender<Job>,
    reader: Arc<Mutex<Connection>>,
    published: broadcast::Sender<Arc<Event>>,
    outbox: Arc<Notify>,
    running: Runs,
}

/// One change, inside one transaction. A module sees only its own scope: the
/// events it emits carry its name.
pub struct Tx<'c> {
    tx: rusqlite::Transaction<'c>,
    module: &'static str,
    now: i64,
    emitted: Vec<Event>,
    enqueued: bool,
}

impl Tx<'_> {
    /// The transaction's connection, for the module's own tables.
    pub fn sql(&self) -> &Connection {
        &self.tx
    }

    /// The time of this change, read once.
    pub fn now(&self) -> i64 {
        self.now
    }

    /// Appends one of this module's events. Subscribers hear it after commit.
    pub fn emit(
        &mut self,
        kind: &str,
        version: u32,
        subject: Option<&str>,
        author: Participant,
        payload: &impl Serialize,
    ) -> Result<&Event, Error> {
        let mut event = Event {
            seq: 0,
            id: EventId::new(),
            module: self.module.to_owned(),
            kind: kind.to_owned(),
            version,
            subject: subject.map(str::to_owned),
            author,
            at: self.now,
            payload: serde_json::to_value(payload)?,
        };
        events::append(&self.tx, &mut event)?;
        self.emitted.push(event);
        Ok(self.emitted.last().expect("just pushed"))
    }

    /// Queues a side effect to run after commit, after every earlier effect
    /// of this module with the same `key` (ADR 0002, decision 3). The
    /// engine runs it, through [`Module::run`](crate::Module::run).
    pub fn enqueue(
        &mut self,
        kind: &str,
        key: &str,
        payload: &impl Serialize,
    ) -> Result<(), Error> {
        self.queue("engine", kind, key, payload)
    }

    /// Queues a side effect as [`Tx::enqueue`] does, for a worker outside
    /// the engine to run: it takes it under a lease
    /// ([`ModuleProject::lease`](crate::ModuleProject::lease)), and the
    /// engine never runs it. Its order among its key's effects is the same.
    pub fn enqueue_for_worker(
        &mut self,
        kind: &str,
        key: &str,
        payload: &impl Serialize,
    ) -> Result<(), Error> {
        self.queue("worker", kind, key, payload)
    }

    fn queue(
        &mut self,
        runner: &str,
        kind: &str,
        key: &str,
        payload: &impl Serialize,
    ) -> Result<(), Error> {
        let payload = serde_json::to_string(payload)?;
        self.tx.execute(
            "INSERT INTO kernel_outbox (module, kind, key, payload, state, next_at, created_at, runner)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6)",
            params![self.module, kind, key, payload, self.now, runner],
        )?;
        self.enqueued = true;
        Ok(())
    }

    /// Refuses as `conflict` unless `claim` still holds its effect, which
    /// is this module's. A module checks it in each write it makes for a
    /// worker under a lease, so a worker writes nothing once its effect was
    /// taken again, after its lease ran out, or settled (ADR 0082, A6).
    pub fn holds(&self, claim: Claim) -> Result<(), Error> {
        if crate::outbox::holds(&self.tx, self.module, claim)? {
            Ok(())
        } else {
            Err(crate::outbox::lost_lease().into())
        }
    }

    pub(crate) fn module(&self) -> &'static str {
        self.module
    }
}

impl Store {
    /// Opens `path`, brings the kernel's and every module's tables up to
    /// date, and starts the writer.
    pub(crate) fn open(
        path: &Path,
        ledgers: &[(&'static str, &'static [&'static str])],
    ) -> Result<Store, Error> {
        let mut writer = Connection::open(path)?;
        writer.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        migrate(&mut writer, KERNEL, KERNEL_MIGRATIONS)?;
        for (module, steps) in ledgers {
            migrate(&mut writer, module, steps)?;
        }
        let reader = Connection::open(path)?;
        reader.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;")?;

        let (jobs, inbox) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name(format!("banda-writer {}", path.display()))
            .spawn(move || {
                while let Ok(job) = inbox.recv() {
                    run(job, &mut writer);
                }
            })?;
        let (published, _) = broadcast::channel(SUBSCRIBER_LAG);
        Ok(Store {
            jobs,
            reader: Arc::new(Mutex::new(reader)),
            published,
            outbox: Arc::new(Notify::new()),
            running: Runs::default(),
        })
    }

    /// Runs `change` in one transaction on the writer. Its events are
    /// published after commit; if it fails, nothing of it remains.
    pub(crate) async fn write<T: Send + 'static>(
        &self,
        module: &'static str,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let published = self.published.clone();
        let outbox = self.outbox.clone();
        self.on_writer(move |sql| {
            let (value, emitted, enqueued) = transact(sql, module, change)?;
            publish(&published, &outbox, emitted, enqueued);
            Ok(value)
        })
        .await
    }

    /// Looks at a command's receipt as it arrives, as
    /// [`Kernel::answer`](crate::Kernel::answer) says. [`Begun::Run`]: the
    /// caller runs it, then calls [`Store::settle`].
    pub(crate) async fn begin(&self, receipt: Receipt) -> Result<Begun, Error> {
        loop {
            let (runs, receipt) = (self.running.clone(), receipt.clone());
            let mut run = match self.on_writer(move |sql| receipt.look(sql, runs)).await? {
                Ok(begun) => return Ok(begun),
                Err(run) => run,
            };
            let ended = match run.wait_for(Option::is_some).await {
                Ok(ended) => ended.clone(),
                Err(_) => None,
            };
            if let Some(answer) = ended {
                return Ok(Begun::Answered(answer));
            }
            // The run was let go of with no answer: look again.
        }
    }

    /// Keeps a command's answer on its receipt, and hands it to the
    /// resends waiting on it.
    pub(crate) async fn settle(
        &self,
        running: Running,
        answer: Result<Value, Refusal>,
    ) -> Result<Answer, Refusal> {
        let (receipt, kept) = (running.receipt.clone(), answer.clone());
        let at = self.on_writer(move |sql| receipt.settle(sql, &kept)).await;
        let at = at.unwrap_or_else(|error| {
            // The answer stands; a resend hears that it may have run.
            tracing::error!(%error, "a command's answer was not kept");
            None
        });
        let answer = answer.map(|value| Answer { value, at });
        running.ended.send_replace(Some(answer.clone()));
        answer
    }

    /// Writes a command's change in one transaction, with a mark on its
    /// receipt that it was written: see [`Call::command`](crate::Call::command).
    pub(crate) async fn command<T: Send + 'static>(
        &self,
        receipt: Receipt,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Refusal> {
        let written = self.write(receipt.module, move |tx| {
            let value = change(tx)?;
            receipt.written(tx.sql())?;
            Ok(value)
        });
        Ok(written.await?)
    }

    /// Lets go of the receipts, and of the rows of effects that settled,
    /// older than [`KEPT`], a batch at a time, so the writer is never held
    /// long. Answers how many rows went.
    ///
    /// A receipt whose command runs in this engine stays, however old: its
    /// resends wait on the run, and the run keeps its answer there. One cut
    /// short, answered or not, goes as any other, past every resend's
    /// window. An effect pending or running stays, however old: only one
    /// that settled has `settled_at`.
    pub(crate) async fn collect(&self) -> Result<usize, Error> {
        let before = now_ms().saturating_sub(i64::try_from(KEPT.as_millis()).unwrap_or(i64::MAX));
        let runs = self.running.clone();
        let receipts = move |sql: &Connection| {
            // Read on the writer, where a run begins: one that begins after
            // this has a receipt younger than `before`.
            let running: Vec<String> = lock(&runs).keys().map(ToString::to_string).collect();
            Ok(sql.execute(
                "DELETE FROM kernel_receipts WHERE rowid IN
                   (SELECT rowid FROM kernel_receipts
                    WHERE at < ?1 AND command NOT IN (SELECT value FROM json_each(?3))
                    LIMIT ?2)",
                params![before, BATCH, serde_json::to_string(&running)?],
            )?)
        };
        let settled = move |sql: &Connection| {
            Ok(sql.execute(
                "DELETE FROM kernel_outbox WHERE id IN
                   (SELECT id FROM kernel_outbox WHERE settled_at < ?1 LIMIT ?2)",
                params![before, BATCH],
            )?)
        };
        Ok(self.batches(receipts).await? + self.batches(settled).await?)
    }

    /// Runs `delete` on the writer until it lets go of less than a batch,
    /// and answers how many rows went.
    async fn batches(
        &self,
        delete: impl Fn(&Connection) -> Result<usize, Error> + Clone + Send + 'static,
    ) -> Result<usize, Error> {
        let mut gone = 0;
        loop {
            let delete = delete.clone();
            let went = self.on_writer(move |sql| delete(sql)).await?;
            gone += went;
            if went < usize::from(BATCH) {
                return Ok(gone);
            }
        }
    }

    /// Reads on the reader connection, off the async threads.
    pub(crate) async fn read<T: Send + 'static>(
        &self,
        query: impl FnOnce(&Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let reader = self.reader.clone();
        tokio::task::spawn_blocking(move || {
            let sql = reader
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            query(&sql)
        })
        .await
        .map_err(|_| Error::Closed)?
    }

    /// Committed events from now on, in commit order.
    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<Event>> {
        self.published.subscribe()
    }

    /// Woken after a commit that queued a side effect.
    pub(crate) fn outbox_signal(&self) -> Arc<Notify> {
        self.outbox.clone()
    }

    async fn on_writer<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let (reply, answer) = oneshot::channel();
        self.jobs
            .send(Box::new(move |sql| {
                let _ = reply.send(job(sql));
            }))
            .map_err(|_| Error::Closed)?;
        // The writer drops a job's answer unsent only as it panics.
        answer.await.map_err(|_| Error::Panicked)?
    }
}

/// Runs one job on the writer. A job that panics loses its change, never
/// the writer, which would leave the Project unable to write until the
/// engine restarts: its transaction rolls back as it unwinds, its caller
/// hears [`Error::Panicked`], an engine failure that ran nothing, and the
/// next job runs. The engine's panic hook keeps the panic as a Problem
/// (ADR 0039).
fn run(job: Job, writer: &mut Connection) {
    if catch_unwind(AssertUnwindSafe(|| job(writer))).is_err() && !writer.is_autocommit() {
        // A transaction its drop did not end.
        if let Err(error) = writer.execute_batch("ROLLBACK") {
            tracing::error!(%error, "a change that panicked could not be rolled back");
        }
    }
}

fn transact<T>(
    sql: &mut Connection,
    module: &'static str,
    change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error>,
) -> Result<(T, Vec<Event>, bool), Error> {
    let tx = sql.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut scope = Tx {
        tx,
        module,
        now: now_ms(),
        emitted: Vec::new(),
        enqueued: false,
    };
    let value = change(&mut scope)?;
    let Tx {
        tx,
        emitted,
        enqueued,
        ..
    } = scope;
    tx.commit()?;
    Ok((value, emitted, enqueued))
}

fn publish(
    published: &broadcast::Sender<Arc<Event>>,
    outbox: &Notify,
    emitted: Vec<Event>,
    enqueued: bool,
) {
    for event in emitted {
        // No subscriber is not a failure: the log keeps the event.
        let _ = published.send(Arc::new(event));
    }
    if enqueued {
        outbox.notify_one();
    }
}

/// What a method answered: its value and, for a command, its place in
/// the log, `at`. What the command wrote is at or before `at`, so a view
/// current there shows it (ADR 0082, decision 4).
#[derive(Clone, Debug, PartialEq)]
pub struct Answer {
    pub value: Value,
    pub at: Option<i64>,
}

/// Where a command stands once [`Store::begin`] looked.
pub(crate) enum Begun {
    /// Nothing answered it yet: the caller runs it, then settles it.
    Run(Running),
    /// What it answers without running.
    Answered(Result<Answer, Refusal>),
}

/// A command running in this engine. A resend waits for its answer. Let go
/// of without [`Store::settle`], it leaves its receipt unanswered.
pub(crate) struct Running {
    receipt: Receipt,
    runs: Runs,
    ended: watch::Sender<Ended>,
}

impl Running {
    fn new(runs: Runs, receipt: Receipt) -> Running {
        let (ended, waits) = watch::channel(None);
        lock(&runs).insert(receipt.command, waits);
        Running {
            receipt,
            runs,
            ended,
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let mut runs = lock(&self.runs);
        // Once a passing answer forgot the receipt, a resend may have begun
        // a run of its own under the same ID: that one stays.
        let ours = self.ended.subscribe();
        if (runs.get(&self.receipt.command)).is_some_and(|waits| waits.same_channel(&ours)) {
            runs.remove(&self.receipt.command);
        }
    }
}

fn lock(runs: &Runs) -> std::sync::MutexGuard<'_, HashMap<CommandId, watch::Receiver<Ended>>> {
    runs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether a receipt keeps an answer for as long as it is kept
/// ([`KEPT`]): a value, or a final refusal.
fn is_kept(answer: &Result<Value, Refusal>) -> bool {
    answer
        .as_ref()
        .err()
        .is_none_or(|refusal| refusal.code.is_final())
}

/// What a receipt keeps for a run that left no answer to keep: cut short,
/// or, once its change was written, ended by a passing refusal.
fn unanswered(written: bool) -> Refusal {
    Refusal::may_have_run(if written {
        "This command ran, but its answer was lost: look at what it did."
    } else {
        "This command ended before it answered, and may have run: look before you ask again."
    })
}

/// What a command's receipt holds now.
enum Kept {
    /// Another call under the same command ID.
    Other,
    /// No answer yet; `written` once [`Call::command`](crate::Call::command)
    /// wrote its change.
    Begun { written: bool },
    /// Its answer, and its place in the log.
    Answered(Result<Value, Refusal>, Option<i64>),
}

/// A command's receipt: which call it answers, who made it, and a hash of
/// its params.
#[derive(Clone)]
pub(crate) struct Receipt {
    pub(crate) command: CommandId,
    pub(crate) module: &'static str,
    pub(crate) method: String,
    pub(crate) author: Participant,
    /// [`Receipt::hash`] of its params.
    pub(crate) params: String,
}

impl Receipt {
    /// SHA-256 of the params' JSON with each object's keys sorted, in hex:
    /// the same params hash alike however their fields are ordered.
    pub(crate) fn hash(params: &Value) -> String {
        let mut sorted = params.clone();
        sorted.sort_all_objects();
        format!("{:x}", Sha256::digest(sorted.to_string()))
    }

    /// What its command answers as it arrives, or its run to wait for. Once
    /// nothing answers it, the receipt is written as begun.
    fn look(
        &self,
        sql: &Connection,
        runs: Runs,
    ) -> Result<Result<Begun, watch::Receiver<Ended>>, Error> {
        let answered = |answer: Result<Answer, Refusal>| Ok(Ok(Begun::Answered(answer)));
        match self.kept(sql)? {
            Some(Kept::Other) => {
                let other = "This command ID was already used for another call.";
                return answered(Err(Refusal::conflict(other)));
            }
            Some(Kept::Answered(answer, seq)) if is_kept(&answer) => {
                return answered(answer.map(|value| Answer { value, at: seq }));
            }
            // A passing refusal kept before ADR 0082 is no answer.
            Some(Kept::Answered(..)) => self.forget(sql)?,
            Some(Kept::Begun { written }) => {
                if let Some(run) = lock(&runs).get(&self.command) {
                    return Ok(Err(run.clone()));
                }
                let refusal = unanswered(written);
                self.keep(sql, Err(&refusal))?;
                return answered(Err(refusal));
            }
            None => {}
        }
        sql.execute(
            "INSERT INTO kernel_receipts
                 (command, module, method, author_kind, author_id, params, answered, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
            params![
                self.command,
                self.module,
                self.method,
                self.author.kind(),
                self.author.id(),
                self.params,
                now_ms()
            ],
        )?;
        Ok(Ok(Begun::Run(Running::new(runs, self.clone()))))
    }

    /// What this command's receipt holds. One for another call, by someone
    /// else or with other params, is [`Kept::Other`]; one kept before
    /// params were hashed matches any.
    fn kept(&self, sql: &Connection) -> Result<Option<Kept>, Error> {
        let stored = sql
            .query_row(
                "SELECT module, method, author_kind, author_id, params, answered, ok, refusal, seq
                 FROM kernel_receipts WHERE command = ?1",
                params![self.command],
                |row| {
                    Ok(Stored {
                        module: row.get(0)?,
                        method: row.get(1)?,
                        author_kind: row.get(2)?,
                        author_id: row.get(3)?,
                        params: row.get(4)?,
                        answered: row.get(5)?,
                        ok: row.get(6)?,
                        refusal: row.get(7)?,
                        seq: row.get(8)?,
                    })
                },
            )
            .optional()?;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let author = Participant::from_parts(&stored.author_kind, &stored.author_id);
        let same = stored.module == self.module
            && stored.method == self.method
            && author == Some(self.author)
            && (stored.params.as_ref()).is_none_or(|params| *params == self.params);
        if !same {
            return Ok(Some(Kept::Other));
        }
        if !stored.answered {
            let written = stored.seq.is_some();
            return Ok(Some(Kept::Begun { written }));
        }
        let answer = match (stored.ok, stored.refusal) {
            (Some(ok), _) => Ok(serde_json::from_str(&ok)?),
            (None, Some(refusal)) => Err(serde_json::from_str(&refusal)?),
            (None, None) => Ok(Value::Null),
        };
        Ok(Some(Kept::Answered(answer, stored.seq)))
    }

    /// Marks, in the change's transaction, that the command's change was
    /// written, with the log's head after it.
    fn written(&self, sql: &Connection) -> Result<(), Error> {
        sql.execute(
            "UPDATE kernel_receipts SET seq = ?2 WHERE command = ?1 AND answered = 0",
            params![self.command, events::head(sql)?],
        )?;
        Ok(())
    }

    /// Keeps the answer the run ended with, and returns its place in the
    /// log. A passing refusal is not kept: the receipt is forgotten, or,
    /// once the change was written, answers `may_have_run`.
    fn settle(
        &self,
        sql: &Connection,
        answer: &Result<Value, Refusal>,
    ) -> Result<Option<i64>, Error> {
        if is_kept(answer) {
            return self.keep(sql, answer.as_ref());
        }
        match self.kept(sql)? {
            Some(Kept::Begun { written: true }) => self.keep(sql, Err(&unanswered(true))),
            _ => self.forget(sql).map(|()| None),
        }
    }

    /// Keeps an answer, from now for [`KEPT`], and returns its place in the
    /// log: where the change was written, or else the log's head now.
    fn keep(
        &self,
        sql: &Connection,
        answer: Result<&Value, &Refusal>,
    ) -> Result<Option<i64>, Error> {
        let (ok, refusal, head) = match answer {
            Ok(value) => (Some(value.to_string()), None, Some(events::head(sql)?)),
            Err(refusal) => (None, Some(serde_json::to_string(refusal)?), None),
        };
        let seq = sql.query_row(
            "UPDATE kernel_receipts
             SET answered = 1, ok = ?2, refusal = ?3, seq = COALESCE(seq, ?4), at = ?5
             WHERE command = ?1
             RETURNING seq",
            params![self.command, ok, refusal, head, now_ms()],
            |row| row.get(0),
        );
        Ok(seq.optional()?.flatten())
    }

    /// Forgets the receipt, so a resend runs.
    fn forget(&self, sql: &Connection) -> Result<(), Error> {
        sql.execute(
            "DELETE FROM kernel_receipts WHERE command = ?1",
            params![self.command],
        )?;
        Ok(())
    }
}

/// A receipt's row.
struct Stored {
    module: String,
    method: String,
    author_kind: String,
    author_id: String,
    params: Option<String>,
    answered: bool,
    ok: Option<String>,
    refusal: Option<String>,
    seq: Option<i64>,
}

/// Applies the steps of `ledger` that this database has not seen, each in
/// its own transaction. A database that has seen more steps than this engine
/// knows was written by a newer engine and is not opened.
pub(crate) fn migrate(sql: &mut Connection, ledger: &str, steps: &[&str]) -> Result<(), Error> {
    sql.execute_batch(
        "CREATE TABLE IF NOT EXISTS kernel_migrations (
            ledger TEXT NOT NULL,
            step INTEGER NOT NULL,
            at INTEGER NOT NULL,
            PRIMARY KEY (ledger, step)
        )",
    )?;
    let done: i64 = sql.query_row(
        "SELECT COUNT(*) FROM kernel_migrations WHERE ledger = ?1",
        params![ledger],
        |row| row.get(0),
    )?;
    let known = i64::try_from(steps.len()).unwrap_or(i64::MAX);
    if done > known {
        return Err(Refusal::conflict(format!(
            "This Project was opened by a newer Banda ({ledger} has {done} steps, this one knows {known})."
        ))
        .into());
    }
    for (step, script) in (1_i64..)
        .zip(steps.iter())
        .skip(usize::try_from(done).unwrap_or(usize::MAX))
    {
        let tx = sql.transaction()?;
        tx.execute_batch(script)?;
        tx.execute(
            "INSERT INTO kernel_migrations (ledger, step, at) VALUES (?1, ?2, ?3)",
            params![ledger, step, now_ms()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Code, EventFilter, PersonId};

    fn store(dir: &tempfile::TempDir) -> Store {
        Store::open(
            &dir.path().join("project.sqlite3"),
            &[("notes", &["CREATE TABLE notes_items (text TEXT NOT NULL)"])],
        )
        .unwrap()
    }

    fn author() -> Participant {
        Participant::Person(PersonId::new())
    }

    fn receipt(command: CommandId, method: &str, author: Participant) -> Receipt {
        with(command, method, author, &Value::Null)
    }

    fn with(command: CommandId, method: &str, author: Participant, params: &Value) -> Receipt {
        Receipt {
            command,
            module: "notes",
            method: method.to_owned(),
            author,
            params: Receipt::hash(params),
        }
    }

    /// Begins `receipt`, which no earlier one answered.
    async fn run(store: &Store, receipt: Receipt) -> Running {
        match store.begin(receipt).await.unwrap() {
            Begun::Run(running) => running,
            Begun::Answered(answer) => panic!("answered already: {answer:?}"),
        }
    }

    /// What `receipt` answers without running, if anything.
    async fn answered(store: &Store, receipt: Receipt) -> Option<Result<Answer, Refusal>> {
        match store.begin(receipt).await.unwrap() {
            Begun::Run(_) => None,
            Begun::Answered(answer) => Some(answer),
        }
    }

    #[tokio::test]
    async fn events_are_published_only_after_commit() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let mut heard = store.subscribe();
        let who = author();

        let failed: Result<(), Error> = store
            .write("notes", move |tx| {
                tx.emit("added", 1, None, who, &"lost")?;
                Err(Refusal::invalid("no").into())
            })
            .await;
        assert!(failed.is_err());

        store
            .write("notes", move |tx| {
                tx.emit("added", 1, Some("a"), who, &"kept")?;
                Ok(())
            })
            .await
            .unwrap();

        let event = heard.recv().await.unwrap();
        assert_eq!(event.payload, Value::from("kept"));
        assert_eq!(event.module, "notes");
        let stored = store
            .read(|sql| Ok(events::after(sql, 0, &EventFilter::default(), 10)?))
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].payload, Value::from("kept"));
    }

    #[tokio::test]
    async fn a_filter_picks_events_by_module_subject_and_kind() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let who = author();
        store
            .write("notes", move |tx| {
                tx.emit("added", 1, Some("a"), who, &"one")?;
                tx.emit("grew", 1, Some("a"), who, &"two")?;
                tx.emit("added", 1, Some("b"), who, &"three")?;
                Ok(())
            })
            .await
            .unwrap();
        let filters = [
            (EventFilter::default(), vec!["one", "two", "three"]),
            (
                EventFilter {
                    kinds: Some(vec!["added".into()]),
                    ..EventFilter::default()
                },
                vec!["one", "three"],
            ),
            (
                EventFilter {
                    subject: Some("a".into()),
                    kinds: Some(vec!["grew".into(), "gone".into()]),
                    ..EventFilter::default()
                },
                vec!["two"],
            ),
            (
                EventFilter {
                    module: Some("other".into()),
                    ..EventFilter::default()
                },
                vec![],
            ),
        ];
        let all = store
            .read(|sql| Ok(events::after(sql, 0, &EventFilter::default(), 10)?))
            .await
            .unwrap();
        for (filter, expected) in filters {
            let stored = store
                .read({
                    let filter = filter.clone();
                    move |sql| Ok(events::after(sql, 0, &filter, 10)?)
                })
                .await
                .unwrap();
            let texts: Vec<_> = stored.iter().map(|e| e.payload.clone()).collect();
            assert_eq!(texts, expected, "the log, {filter:?}");
            // A live event passes the same filter as a stored one.
            let live: Vec<_> = all
                .iter()
                .filter(|e| filter.matches(e))
                .map(|e| e.payload.clone())
                .collect();
            assert_eq!(live, expected, "live, {filter:?}");
        }
    }

    /// Writes a note under `receipt`, as `Call::command` does, and returns
    /// its event's place in the log.
    async fn add(store: &Store, receipt: Receipt) -> Result<i64, Refusal> {
        let who = receipt.author;
        let added = store.command(receipt, move |tx| {
            tx.sql()
                .execute("INSERT INTO notes_items (text) VALUES ('one')", [])?;
            Ok(tx.emit("added", 1, None, who, &"one")?.seq)
        });
        added.await
    }

    async fn notes(store: &Store) -> i64 {
        let count = store
            .read(|sql| Ok(sql.query_row("SELECT COUNT(*) FROM notes_items", [], |r| r.get(0))?));
        count.await.unwrap()
    }

    #[tokio::test]
    async fn a_resend_gets_the_first_answer_and_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let (command, who) = (CommandId::new(), author());
        let running = run(&store, receipt(command, "add", who)).await;
        let seq = add(&store, receipt(command, "add", who)).await.unwrap();
        // The handler answers other than its change: that is the answer.
        let settled = store.settle(running, Ok(Value::from("added"))).await;
        let first = Answer {
            value: Value::from("added"),
            at: Some(seq),
        };
        assert_eq!(settled, Ok(first.clone()));
        for _ in 0..2 {
            let again = answered(&store, receipt(command, "add", who)).await;
            assert_eq!(again, Some(Ok(first.clone())));
        }
        assert_eq!(notes(&store).await, 1);
    }

    #[tokio::test]
    async fn a_final_refusal_is_kept_and_another_call_under_its_id_is_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let (command, who) = (CommandId::new(), author());
        let running = run(&store, receipt(command, "add", who)).await;
        let refused = store.settle(running, Err(Refusal::invalid("empty"))).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid);
        let again = answered(&store, receipt(command, "add", who)).await;
        assert_eq!(again.unwrap().unwrap_err().code, Code::Invalid);

        let other_params = with(command, "add", who, &serde_json::json!({ "text": "b" }));
        for other in [
            receipt(command, "remove", who),
            receipt(command, "add", author()),
            other_params,
        ] {
            let refused = answered(&store, other).await;
            assert_eq!(refused.unwrap().unwrap_err().code, Code::Conflict);
        }
    }

    #[tokio::test]
    async fn a_passing_refusal_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let (command, who) = (CommandId::new(), author());
        let running = run(&store, receipt(command, "add", who)).await;
        let failed = store.command(receipt(command, "add", who), |_| -> Result<(), _> {
            Err(Error::Closed)
        });
        let failed = failed.await.unwrap_err();
        assert_eq!(failed.code, Code::Internal);
        let settled = store.settle(running, Err(failed)).await;
        assert_eq!(settled.unwrap_err().code, Code::Internal);

        let running = run(&store, receipt(command, "add", who)).await;
        let settled = store.settle(running, Ok(Value::from(1))).await;
        assert_eq!(settled.unwrap().value, Value::from(1), "a resend runs");
    }

    #[tokio::test]
    async fn a_passing_refusal_after_the_change_is_written_may_have_run() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let (command, who) = (CommandId::new(), author());
        let running = run(&store, receipt(command, "add", who)).await;
        add(&store, receipt(command, "add", who)).await.unwrap();
        let settled = store.settle(running, Err(Refusal::internal())).await;
        assert_eq!(settled.unwrap_err().code, Code::Internal, "its caller's");
        for _ in 0..2 {
            let again = answered(&store, receipt(command, "add", who)).await;
            assert_eq!(again.unwrap().unwrap_err().code, Code::MayHaveRun);
        }
        assert_eq!(notes(&store).await, 1, "never written again");
    }

    #[tokio::test]
    async fn params_hash_alike_however_their_fields_are_ordered() {
        let one = serde_json::json!({ "a": 1, "b": { "c": [1, "x"], "d": null } });
        let two: Value =
            serde_json::from_str(r#"{ "b": { "d": null, "c": [1, "x"] }, "a": 1 }"#).unwrap();
        assert_eq!(Receipt::hash(&one), Receipt::hash(&two));
        for other in [
            serde_json::json!({ "a": 1, "b": { "c": ["x", 1], "d": null } }),
            serde_json::json!({ "a": "1", "b": { "c": [1, "x"], "d": null } }),
            serde_json::json!({ "a": 1 }),
            Value::Null,
        ] {
            assert_ne!(Receipt::hash(&one), Receipt::hash(&other), "{other}");
        }
    }

    #[tokio::test]
    async fn a_resend_while_it_runs_gets_what_the_run_answers() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(store(&dir));
        let (command, who) = (CommandId::new(), author());
        let running = run(&store, receipt(command, "add", who)).await;
        let waits = tokio::spawn({
            let store = store.clone();
            async move { answered(&store, receipt(command, "add", who)).await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waits.is_finished(), "it waits for the run");
        let settled = store.settle(running, Err(Refusal::internal())).await;
        let waited = waits.await.unwrap();
        assert_eq!(waited, Some(settled), "the run's own answer, run once");
    }

    #[tokio::test]
    async fn a_run_cut_short_by_a_restart_may_have_run_for_good() {
        let dir = tempfile::tempdir().unwrap();
        let (command, who) = (CommandId::new(), author());
        let store = store(&dir);
        let running = run(&store, receipt(command, "add", who)).await;
        // The engine stops while the command runs.
        drop(running);
        drop(store);

        let store = Arc::new(self::store(&dir));
        let resend = || {
            let store = store.clone();
            tokio::spawn(async move { answered(&store, receipt(command, "add", who)).await })
        };
        let (one, two) = (resend(), resend());
        for unsure in [
            one.await.unwrap(),
            two.await.unwrap(),
            resend().await.unwrap(),
        ] {
            assert_eq!(unsure.unwrap().unwrap_err().code, Code::MayHaveRun);
        }
    }

    #[tokio::test]
    async fn a_change_written_and_never_answered_may_have_run_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let (command, who) = (CommandId::new(), author());
        let store = store(&dir);
        let running = run(&store, receipt(command, "add", who)).await;
        add(&store, receipt(command, "add", who)).await.unwrap();
        // The engine stops before the handler answers.
        drop(running);
        drop(store);

        let store = self::store(&dir);
        for _ in 0..2 {
            let unsure = answered(&store, receipt(command, "add", who)).await;
            let refusal = unsure.unwrap().unwrap_err();
            assert_eq!(refusal, unanswered(true), "not the change's own value");
        }
        assert_eq!(notes(&store).await, 1);
    }

    /// Sets `command`'s receipt as last written `age` ago.
    async fn age(store: &Store, command: CommandId, age: Duration) {
        let at = now_ms() - i64::try_from(age.as_millis()).unwrap();
        let aged = store.on_writer(move |sql| {
            let set = "UPDATE kernel_receipts SET at = ?1 WHERE command = ?2";
            Ok(sql.execute(set, params![at, command])?)
        });
        assert_eq!(aged.await.unwrap(), 1, "{command} has a receipt");
    }

    #[tokio::test]
    async fn collect_keeps_every_receipt_a_resend_in_its_window_needs() {
        const DAY: Duration = Duration::from_secs(24 * 3600);
        // A resend comes within seven days of its command's first send
        // (ADR 0082, decision 16), and a receipt is last written no sooner.
        let window = DAY * 7;
        assert!(window < KEPT - DAY);
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(store(&dir));
        let who = author();
        let of = move |command| receipt(command, "add", who);

        for age in [window, KEPT - DAY] {
            // A value, a final refusal, and a run cut short.
            let (done, refused, cut) = (CommandId::new(), CommandId::new(), CommandId::new());
            let first = store.settle(run(&store, of(done)).await, Ok(Value::from(1)));
            let first = first.await;
            let refusal = Err(Refusal::invalid("empty"));
            let _ = store.settle(run(&store, of(refused)).await, refusal).await;
            drop(run(&store, of(cut)).await);
            for command in [done, refused, cut] {
                self::age(&store, command, age).await;
            }
            store.collect().await.unwrap();
            assert_eq!(answered(&store, of(done)).await, Some(first), "{age:?}");
            let again = answered(&store, of(refused)).await.unwrap();
            assert_eq!(again.unwrap_err().code, Code::Invalid);
            // Its first resend hears it may have run, and so does each
            // after, however late in its window.
            let unsure = answered(&store, of(cut)).await.unwrap();
            assert_eq!(unsure.unwrap_err().code, Code::MayHaveRun);
            self::age(&store, cut, age).await;
            store.collect().await.unwrap();
            let unsure = answered(&store, of(cut)).await.unwrap();
            assert_eq!(unsure.unwrap_err().code, Code::MayHaveRun);
        }

        // A command that still runs keeps its receipt however old, so a
        // resend waits for its answer. Past `KEPT`, one no run holds goes,
        // answered or not.
        let (long, old, old_cut) = (CommandId::new(), CommandId::new(), CommandId::new());
        let running = run(&store, of(long)).await;
        let _ = store
            .settle(run(&store, of(old)).await, Ok(Value::from(1)))
            .await;
        drop(run(&store, of(old_cut)).await);
        self::age(&store, long, KEPT + DAY * 10).await;
        for command in [old, old_cut] {
            self::age(&store, command, KEPT + DAY).await;
        }
        assert_eq!(store.collect().await.unwrap(), 2, "old and old_cut");
        let waits = tokio::spawn({
            let store = store.clone();
            async move { answered(&store, of(long)).await }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waits.is_finished(), "it waits for the run");
        let settled = store.settle(running, Ok(Value::from("long"))).await;
        assert_eq!(waits.await.unwrap(), Some(settled), "run once");
        for gone in [old, old_cut] {
            let again = store.begin(of(gone)).await.unwrap();
            assert!(matches!(again, Begun::Run(_)), "a new command");
        }
    }

    #[tokio::test]
    async fn a_change_that_panics_is_refused_and_the_writer_goes_on() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let mut heard = store.subscribe();
        let (command, who) = (CommandId::new(), author());
        let add = move |tx: &mut Tx<'_>, text: &str| -> Result<(), Error> {
            tx.sql()
                .execute("INSERT INTO notes_items (text) VALUES (?1)", [text])?;
            tx.emit("added", 1, None, who, &text)?;
            Ok(())
        };
        let refused = store
            .command(
                receipt(command, "add", who),
                move |tx| -> Result<(), Error> {
                    add(tx, "lost")?;
                    panic!("a handler's bug");
                },
            )
            .await
            .unwrap_err();
        assert_eq!(
            refused.code,
            Code::Internal,
            "an engine failure, not maybe run"
        );
        let panicked = store.write("notes", |_| -> Result<(), Error> { panic!("again") });
        assert!(matches!(panicked.await, Err(Error::Panicked)));

        // The writer goes on, and nothing of either change was kept.
        store
            .write("notes", move |tx| add(tx, "kept"))
            .await
            .unwrap();
        let texts = store
            .read(|sql| {
                let mut rows = sql.prepare("SELECT text FROM notes_items")?;
                let texts = rows.query_map([], |row| row.get::<_, String>(0))?;
                Ok(texts.collect::<Result<Vec<_>, _>>()?)
            })
            .await
            .unwrap();
        assert_eq!(texts, ["kept"]);
        assert_eq!(heard.recv().await.unwrap().payload, Value::from("kept"));
        // It kept no receipt, so the same command may go again.
        let again = store
            .command(receipt(command, "add", who), |_| Ok(Value::from(1)))
            .await;
        assert_eq!(again, Ok(Value::from(1)));
    }

    #[tokio::test]
    async fn the_event_log_is_never_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let who = author();
        store
            .write("notes", move |tx| {
                tx.emit("added", 1, None, who, &"kept")?;
                Ok(())
            })
            .await
            .unwrap();
        for rewrite in [
            "UPDATE kernel_events SET payload = '\"changed\"'",
            "DELETE FROM kernel_events",
        ] {
            let refused = store
                .write("notes", move |tx| Ok(tx.sql().execute(rewrite, [])?))
                .await;
            assert!(refused.is_err(), "{rewrite}");
        }
    }

    #[tokio::test]
    async fn steps_run_once_and_a_newer_database_is_not_opened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.sqlite3");
        drop(
            Store::open(
                &path,
                &[("notes", &["CREATE TABLE notes_items (text TEXT)"])],
            )
            .unwrap(),
        );
        drop(
            Store::open(
                &path,
                &[("notes", &["CREATE TABLE notes_items (text TEXT)"])],
            )
            .unwrap(),
        );
        let older = Store::open(&path, &[("notes", &[])]);
        assert!(matches!(older, Err(Error::Refused(r)) if r.code == Code::Conflict));
    }
}
