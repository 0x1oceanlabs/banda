//! A Project's SQLite, with one writer (ADR 0002, decisions 2 and 4).
//!
//! The writer is one thread that owns the only writing connection. Every
//! change is a job that runs in one transaction. A change's events go out
//! to subscribers only after it commits, in commit order. A change that
//! panics is rolled back and refused, and the writer goes on. Readers use
//! their own connection: SQLite's WAL lets them read while the writer
//! writes.
//!
//! Both connections have an authorizer (`tables`): what a module's SQL
//! runs on them reaches only its own tables. All the kernel's SQL in a
//! [`Tx`], in a module's transaction or its own, goes through
//! [`Tx::kernel`].

use crate::events::{self, Event};
use crate::outbox::Claim;
use crate::tables::{AsKernel, Authorizer, Tables};
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
/// A resend comes within seven days of its command's first send. Today
/// that is a convention of Banda's clients, not a check: `banda mcp` sends
/// a command again at once, within its session. The host will check it: a
/// command will carry `not_after`, seven days at most, and past it the host
/// will refuse it, on its own clock (ADR 0082, decisions 4 and 16). A
/// receipt's `at` is when it was last written, as its command began or as
/// it was answered, so never before its command first came: every receipt
/// outlives its resends' window by three weeks, on the host's clock. Within
/// it a command sent again gets its first answer and runs nothing again,
/// `may_have_run` included; past it, the same command ID runs as a new
/// command. A receipt whose command still runs stays however old
/// ([`Store::collect`]).
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
    // How far each durable listener has heard this store's log, kept
    // beside it (ADR 0082, decision 6): `listener` is `<module>.<name>`,
    // with `@<Project>` for a Project's module that hears this machine's
    // log, and `source_scope` the scope whose log it is (`cursors.rs`).
    r#"
CREATE TABLE kernel_cursors (
    listener TEXT NOT NULL,
    source_scope TEXT NOT NULL,
    seq INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (listener, source_scope)
);
"#,
    // Whether a command's change was written is kept apart from its place
    // in the log, `seq`, which is now the last fact it wrote, or none: a
    // client has nothing to wait to hear of one that wrote none (#880). A
    // receipt answered before keeps its place, so a resend gets the same.
    r#"
ALTER TABLE kernel_receipts ADD COLUMN written INTEGER NOT NULL DEFAULT 0;
UPDATE kernel_receipts SET written = 1 WHERE answered = 0 AND seq IS NOT NULL;
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
    /// Who runs SQL on the writer, which its thread owns.
    writer_authorizer: Arc<Authorizer>,
    reader: Arc<Mutex<Reader>>,
    published: broadcast::Sender<Arc<Event>>,
    outbox: Arc<Notify>,
    running: Runs,
    /// The modules turned off here, as it opened: see [`Off`].
    off: Vec<Off>,
}

/// A module turned off in one store: its tables there did not come up to
/// date, so nothing of it runs there, and the store's other modules go on
/// (the architecture vision, D4). It stays off until the engine opens the
/// store again with steps that pass: a step that failed left nothing, so
/// it may be put right.
#[derive(Debug)]
pub(crate) struct Off {
    /// The module, which its ledger is named after.
    pub module: &'static str,
    /// The step that failed, counted from 1; none when its ledger was not
    /// read, or holds more steps than this engine knows.
    pub step: Option<i64>,
    pub why: Error,
}

impl Off {
    /// Why it is off, in words for whoever calls it.
    pub(crate) fn words(&self) -> String {
        let why = match &self.why {
            Error::Refused(refusal) => refusal.message.clone(),
            Error::Database(error) => format!("{error}."),
            other => format!("{other}."),
        };
        match self.step {
            Some(step) => format!("Step {step} of its tables failed: {why}"),
            None => why,
        }
    }
}

/// The reader connection, and who runs SQL on it.
struct Reader {
    sql: Connection,
    authorizer: Arc<Authorizer>,
}

/// One change, inside one transaction. A module sees only its own scope: the
/// events it emits carry its name, and its SQL reaches only its own tables.
pub struct Tx<'c> {
    tx: rusqlite::Transaction<'c>,
    authorizer: &'c Authorizer,
    module: &'static str,
    now: i64,
    emitted: Vec<Event>,
    enqueued: bool,
}

impl Tx<'_> {
    /// The transaction's connection, for the module's own tables: SQL that
    /// reaches another table is refused (ADR 0062, decision 5).
    pub fn sql(&self) -> &Connection {
        &self.tx
    }

    /// The transaction's connection for the kernel's own SQL, its tables
    /// open, until the guard is dropped.
    pub(crate) fn kernel(&self) -> AsKernel<'_> {
        self.authorizer.as_kernel(&self.tx)
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
        events::append(&self.kernel(), &mut event)?;
        self.emitted.push(event);
        Ok(self.emitted.last().expect("just pushed"))
    }

    /// The place in the log of the last fact this change wrote, if any.
    fn last_fact(&self) -> Option<i64> {
        self.emitted.last().map(|event| event.seq)
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
        self.kernel().execute(
            "INSERT INTO kernel_outbox (module, kind, key, payload, state, next_at, created_at, runner)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6)",
            params![self.module, kind, key, payload, self.now, runner],
        )?;
        self.enqueued = true;
        Ok(())
    }

    /// Acks the fact `ack` names, which one of this module's listeners
    /// heard ([`Listener::ack`](crate::Listener::ack)), in this
    /// transaction: the reaction it writes runs exactly once (ADR 0082,
    /// decision 6). Refused as `conflict` when the fact was acked already,
    /// so the change is not kept twice; and refused for a fact the
    /// listener had not given, or one whose cursor is in another scope's
    /// store.
    pub fn ack(&self, ack: &crate::Ack) -> Result<(), Error> {
        crate::cursors::ack(&self.kernel(), self.module, ack)
    }

    /// Refuses as `conflict` unless `claim` still holds its effect, which
    /// is this module's. A module checks it in each write it makes for a
    /// worker under a lease, so a worker writes nothing once its effect was
    /// taken again, after its lease ran out, or settled (ADR 0082, A6).
    pub fn holds(&self, claim: Claim) -> Result<(), Error> {
        if crate::outbox::holds(&self.kernel(), self.module, claim)? {
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
    /// Opens `path`, puts an authorizer on both its connections by
    /// `modules`' tables, brings the kernel's and every module's tables up
    /// to date, each module's steps reaching only its own, and starts the
    /// writer. A module whose tables do not come up to date is turned off
    /// here ([`Store::off`]), and the store opens with the rest; the
    /// kernel's own must, or it does not open.
    pub(crate) fn open(path: &Path, modules: &[Tables]) -> Result<Store, Error> {
        let owners: Arc<[Tables]> = modules.into();
        let mut writer = Connection::open(path)?;
        writer.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA trusted_schema = OFF;",
        )?;
        let writer_authorizer = Authorizer::install(&mut writer, owners.clone())?;
        migrate(&mut writer, KERNEL, KERNEL_MIGRATIONS)?;
        let mut off = Vec::new();
        for tables in modules {
            let of = Some((&*writer_authorizer, tables));
            if let Err(stuck) = migrate_in(&mut writer, tables.module, tables.migrations, of) {
                off.push(stuck);
            }
        }
        let mut reader = Connection::open(path)?;
        reader.execute_batch(
            "PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;",
        )?;
        let reader_authorizer = Authorizer::install(&mut reader, owners)?;

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
            writer_authorizer,
            reader: Arc::new(Mutex::new(Reader {
                sql: reader,
                authorizer: reader_authorizer,
            })),
            published,
            outbox: Arc::new(Notify::new()),
            running: Runs::default(),
            off,
        })
    }

    /// The modules turned off here, as it opened.
    pub(crate) fn off(&self) -> &[Off] {
        &self.off
    }

    /// Why `module` is turned off here; none when it runs.
    pub(crate) fn off_of(&self, module: &str) -> Option<&Off> {
        self.off.iter().find(|off| off.module == module)
    }

    /// Runs `change` in one transaction on the writer, as `module`, or as
    /// the kernel itself ([`KERNEL`]). Its events are published after
    /// commit; if it fails, nothing of it remains.
    pub(crate) async fn write<T: Send + 'static>(
        &self,
        module: &'static str,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let published = self.published.clone();
        let outbox = self.outbox.clone();
        let authorizer = self.writer_authorizer.clone();
        self.on_writer(move |sql| {
            let (value, emitted, enqueued) = transact(sql, &authorizer, module, change)?;
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
            receipt.written(tx)?;
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

    /// Reads as the kernel on the reader connection, off the async threads.
    pub(crate) async fn read<T: Send + 'static>(
        &self,
        query: impl FnOnce(&Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.read_as(KERNEL, query).await
    }

    /// Reads as `module` on the reader connection: its SQL reaches only its
    /// own tables.
    pub(crate) async fn read_as<T: Send + 'static>(
        &self,
        module: &'static str,
        query: impl FnOnce(&Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        self.on_reader(move |reader| {
            let _as = reader.authorizer.enter(&reader.sql, module);
            query(&reader.sql)
        })
        .await
    }

    /// Reads as `module` in one read transaction, with the log's head it
    /// is current at, which the kernel reads.
    pub(crate) async fn view<T: Send + 'static>(
        &self,
        module: &'static str,
        query: impl FnOnce(&Connection) -> Result<T, Error> + Send + 'static,
    ) -> Result<(i64, T), Error> {
        self.on_reader(move |reader| {
            // Ends when dropped, even if the query panics, as the kernel:
            // the guard below is dropped first.
            let snapshot = reader.sql.unchecked_transaction()?;
            let at = events::head(&snapshot)?;
            let _as = reader.authorizer.enter(&snapshot, module);
            Ok((at, query(&snapshot)?))
        })
        .await
    }

    async fn on_reader<T: Send + 'static>(
        &self,
        job: impl FnOnce(&Reader) -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let reader = self.reader.clone();
        tokio::task::spawn_blocking(move || {
            let reader = reader
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            job(&reader)
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

/// Runs `change` as `module` in one transaction, which the kernel begins
/// and ends.
fn transact<T>(
    sql: &mut Connection,
    authorizer: &Authorizer,
    module: &'static str,
    change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error>,
) -> Result<(T, Vec<Event>, bool), Error> {
    let tx = sql.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut scope = Tx {
        tx,
        authorizer,
        module,
        now: now_ms(),
        emitted: Vec::new(),
        enqueued: false,
    };
    // Dropped before the transaction is, as it fails or panics too, so
    // the kernel rolls it back.
    let value = {
        let _as = authorizer.enter(&scope.tx, module);
        change(&mut scope)?
    };
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

/// What a method answered: its value and, for a command that wrote a fact
/// with its change, its place in the log, `at`: the last fact it wrote, so
/// a view current there shows it (ADR 0082, decision 4). One that wrote no
/// fact has none: there is nothing in the log to wait to hear (#880).
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
    /// Its answer, and its place in the log: its last fact, if it wrote one.
    Answered(Result<Value, Refusal>, Option<i64>),
}

/// Why a command is refused whose ID a receipt keeps for another call.
const OTHER_CALL: &str = "This command ID was already used for another call.";

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
            Some(Kept::Other) => return answered(Err(Refusal::conflict(OTHER_CALL))),
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
        self.insert(sql, None)?;
        Ok(Ok(Begun::Run(Running::new(runs, self.clone()))))
    }

    /// Writes the receipt: begun, or answered with `ok` at its place in
    /// the log, if it has one.
    fn insert(&self, sql: &Connection, ok: Option<(&Value, Option<i64>)>) -> Result<(), Error> {
        let (answered, seq) = (ok.is_some(), ok.and_then(|(_, seq)| seq));
        sql.execute(
            "INSERT INTO kernel_receipts
                 (command, module, method, author_kind, author_id, params, answered, ok, seq, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                self.command,
                self.module,
                self.method,
                self.author.kind(),
                self.author.id(),
                self.params,
                answered,
                ok.map(|(value, _)| value.to_string()),
                seq,
                now_ms()
            ],
        )?;
        Ok(())
    }

    /// What this command's receipt holds. One for another call, by someone
    /// else or with other params, is [`Kept::Other`]; one kept before
    /// params were hashed matches any.
    fn kept(&self, sql: &Connection) -> Result<Option<Kept>, Error> {
        let stored = sql
            .query_row(
                "SELECT module, method, author_kind, author_id, params, answered, ok, refusal, seq,
                        written
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
                        written: row.get(9)?,
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
            return Ok(Some(Kept::Begun {
                written: stored.written,
            }));
        }
        let answer = match (stored.ok, stored.refusal) {
            (Some(ok), _) => Ok(serde_json::from_str(&ok)?),
            (None, Some(refusal)) => Err(serde_json::from_str(&refusal)?),
            (None, None) => Ok(Value::Null),
        };
        Ok(Some(Kept::Answered(answer, stored.seq)))
    }

    /// Marks, in the change's transaction, that the command's change was
    /// written, and its place in the log: the last fact it wrote, kept from
    /// an earlier change of the same command when this one wrote none.
    fn written(&self, tx: &Tx<'_>) -> Result<(), Error> {
        tx.kernel().execute(
            "UPDATE kernel_receipts SET written = 1, seq = COALESCE(?2, seq)
             WHERE command = ?1 AND answered = 0",
            params![self.command, tx.last_fact()],
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
    /// log: the last fact its command wrote, or none.
    fn keep(
        &self,
        sql: &Connection,
        answer: Result<&Value, &Refusal>,
    ) -> Result<Option<i64>, Error> {
        let (ok, refusal) = match answer {
            Ok(value) => (Some(value.to_string()), None),
            Err(refusal) => (None, Some(serde_json::to_string(refusal)?)),
        };
        let seq = sql.query_row(
            "UPDATE kernel_receipts SET answered = 1, ok = ?2, refusal = ?3, at = ?4
             WHERE command = ?1
             RETURNING seq",
            params![self.command, ok, refusal, now_ms()],
            |row| row.get(0),
        );
        Ok(seq.optional()?.flatten())
    }

    /// In the transaction of a reaction across scopes
    /// ([`Listener::once`](crate::Listener::once)): whether its command ran
    /// already, and so writes nothing again. Another call under its ID is
    /// refused as `conflict`.
    pub(crate) fn ran(&self, sql: &Connection) -> Result<bool, Error> {
        match self.kept(sql)? {
            None => Ok(false),
            Some(Kept::Other) => Err(Refusal::conflict(OTHER_CALL).into()),
            Some(Kept::Begun { .. } | Kept::Answered(..)) => Ok(true),
        }
    }

    /// Keeps, in that reaction's transaction once it wrote its change, that
    /// its command ran, answered with nothing, at the last fact it wrote.
    pub(crate) fn ran_now(&self, tx: &Tx<'_>) -> Result<(), Error> {
        self.insert(&tx.kernel(), Some((&Value::Null, tx.last_fact())))
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
    written: bool,
}

/// Applies the steps of `ledger` that this database has not seen, each in
/// its own transaction. A database that has seen more steps than this engine
/// knows was written by a newer engine and is not opened.
pub(crate) fn migrate(
    sql: &mut Connection,
    ledger: &'static str,
    steps: &[&str],
) -> Result<(), Error> {
    migrate_in(sql, ledger, steps, None).map_err(|stuck| stuck.why)
}

/// [`migrate`], with a module's tables: each step runs as the module
/// through the writer's authorizer, and the foreign keys it leaves are
/// read after it. A step that reaches past its module's tables is
/// refused, and so is a ledger with more steps than `steps`, which a newer
/// version of the module wrote. The steps before the one that failed are
/// kept, and it left nothing.
fn migrate_in(
    sql: &mut Connection,
    ledger: &'static str,
    steps: &[&str],
    module: Option<(&Authorizer, &Tables)>,
) -> Result<(), Off> {
    let stuck = |step| {
        move |why| Off {
            module: ledger,
            step,
            why,
        }
    };
    let done = seen(sql, ledger, steps.len(), module.is_some()).map_err(stuck(None))?;
    for (step, script) in (1_i64..).zip(steps.iter()).skip(done) {
        apply(sql, ledger, step, script, module).map_err(stuck(Some(step)))?;
    }
    Ok(())
}

/// How many steps of `ledger` this database has seen, of the `known` this
/// engine has; refused when it has seen more.
fn seen(sql: &Connection, ledger: &str, known: usize, module: bool) -> Result<usize, Error> {
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
    let done = usize::try_from(done).unwrap_or(usize::MAX);
    if done <= known {
        return Ok(done);
    }
    Err(Refusal::conflict(if module {
        format!(
            "Its data here was written by a newer {ledger} ({done} steps of its tables, this one knows {known})."
        )
    } else {
        format!(
            "This Project was opened by a newer Banda ({ledger} has {done} steps, this one knows {known})."
        )
    })
    .into())
}

/// Runs one step of `ledger` and writes it in the ledger, in one
/// transaction.
fn apply(
    sql: &mut Connection,
    ledger: &str,
    step: i64,
    script: &str,
    module: Option<(&Authorizer, &Tables)>,
) -> Result<(), Error> {
    let tx = sql.transaction()?;
    match module {
        None => tx.execute_batch(script)?,
        Some((authorizer, tables)) => {
            {
                let _as = authorizer.migrate(&tx, ledger);
                tx.execute_batch(script)?;
            }
            tables.parents_are_its_own(&tx)?;
        }
    }
    tx.execute(
        "INSERT INTO kernel_migrations (ledger, step, at) VALUES (?1, ?2, ?3)",
        params![ledger, step, now_ms()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Code, EventFilter, PersonId};

    /// The notes module's tables, with `migrations`.
    fn tables_of_notes(migrations: &'static [&'static str]) -> [Tables; 1] {
        [Tables {
            module: "notes",
            legacy: &[],
            migrations,
        }]
    }

    fn store(dir: &tempfile::TempDir) -> Store {
        Store::open(
            &dir.path().join("project.sqlite3"),
            &tables_of_notes(&["CREATE TABLE notes_items (text TEXT NOT NULL)"]),
        )
        .unwrap()
    }

    /// Whether `error` is the authorizer's refusal: SQLite's for a
    /// statement, or for a function it uses, which comes as a plain error.
    fn refused(error: &Error) -> bool {
        matches!(error, Error::Database(e)
            if e.sqlite_error_code() == Some(rusqlite::ErrorCode::AuthorizationForStatementDenied)
                || e.to_string().starts_with("not authorized to use function"))
    }

    /// Whether `opened` opened with the notes module turned off, for a
    /// reason `why` holds of.
    fn off_as(opened: &Result<Store, Error>, why: impl Fn(&Error) -> bool) -> bool {
        let Ok(store) = opened else { return false };
        matches!(store.off(), [off] if off.module == "notes" && why(&off.why))
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

    /// Writes a note under `receipt` as [`add`] does, with no fact.
    async fn add_quietly(store: &Store, receipt: Receipt) -> Result<(), Refusal> {
        let added = store.command(receipt, |tx| {
            tx.sql()
                .execute("INSERT INTO notes_items (text) VALUES ('quiet')", [])?;
            Ok(())
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
    async fn a_command_is_at_the_last_fact_it_wrote_and_nowhere_without_one() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let who = author();

        // Two facts, then a change of the same command with none.
        let (two, quiet) = (CommandId::new(), CommandId::new());
        let running = run(&store, receipt(two, "add", who)).await;
        let second = store.command(receipt(two, "add", who), move |tx| {
            tx.emit("added", 1, None, who, &"one")?;
            Ok(tx.emit("added", 1, None, who, &"two")?.seq)
        });
        let second = second.await.unwrap();
        add_quietly(&store, receipt(two, "add", who)).await.unwrap();
        let settled = store.settle(running, Ok(Value::Null)).await.unwrap();
        assert_eq!(settled.at, Some(second), "its last fact");

        // A change with no fact, as the log's head is another's: none.
        let running = run(&store, receipt(quiet, "add", who)).await;
        add_quietly(&store, receipt(quiet, "add", who))
            .await
            .unwrap();
        let settled = store.settle(running, Ok(Value::Null)).await.unwrap();
        assert_eq!(settled.at, None, "nothing of its own to hear");
        let again = answered(&store, receipt(quiet, "add", who)).await;
        assert_eq!(again, Some(Ok(settled)), "a resend, none either");
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
        let who = author();
        // With a fact, and with none: either change was written.
        for (count, quietly) in [(1, false), (2, true)] {
            let command = CommandId::new();
            let running = run(&store, receipt(command, "add", who)).await;
            if quietly {
                add_quietly(&store, receipt(command, "add", who))
                    .await
                    .unwrap();
            } else {
                add(&store, receipt(command, "add", who)).await.unwrap();
            }
            let settled = store.settle(running, Err(Refusal::internal())).await;
            assert_eq!(settled.unwrap_err().code, Code::Internal, "its caller's");
            for _ in 0..2 {
                let again = answered(&store, receipt(command, "add", who)).await;
                assert_eq!(again.unwrap().unwrap_err().code, Code::MayHaveRun);
            }
            assert_eq!(notes(&store).await, count, "never written again");
        }
    }

    #[test]
    fn a_receipt_kept_before_the_written_mark_answers_as_it_did() {
        let mut sql = Connection::open_in_memory().unwrap();
        // Up to the step that adds `written`, however many come after it.
        let step = KERNEL_MIGRATIONS
            .iter()
            .position(|text| text.contains("ADD COLUMN written"))
            .expect("the step that adds `written`");
        migrate(&mut sql, KERNEL, &KERNEL_MIGRATIONS[..step]).unwrap();
        let who = author();
        let (begun, done) = (CommandId::new(), CommandId::new());
        // Each at the log's head of then, 7: begun with its change
        // written, and answered.
        for (command, answered, ok) in [(begun, false, None), (done, true, Some("1"))] {
            sql.execute(
                "INSERT INTO kernel_receipts
                     (command, module, method, author_kind, author_id, params, answered, ok, seq, at)
                 VALUES (?1, 'notes', 'add', ?2, ?3, ?4, ?5, ?6, 7, 0)",
                params![
                    command,
                    who.kind(),
                    who.id(),
                    Receipt::hash(&Value::Null),
                    answered,
                    ok
                ],
            )
            .unwrap();
        }
        migrate(&mut sql, KERNEL, KERNEL_MIGRATIONS).unwrap();
        let kept = |command| receipt(command, "add", who).kept(&sql).unwrap();
        assert!(matches!(kept(begun), Some(Kept::Begun { written: true })));
        assert!(
            matches!(kept(done), Some(Kept::Answered(Ok(value), Some(7))) if value == 1),
            "a resend, the same place"
        );
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
            // Not even by the kernel, which the authorizer lets through.
            let rewritten = store
                .write(KERNEL, move |tx| Ok(tx.kernel().execute(rewrite, [])?))
                .await;
            assert!(rewritten.is_err_and(|e| !refused(&e)), "{rewrite}");
            let denied = store
                .write("notes", move |tx| Ok(tx.sql().execute(rewrite, [])?))
                .await;
            assert!(denied.is_err_and(|e| refused(&e)), "{rewrite}");
        }
    }

    #[tokio::test]
    async fn steps_run_once_and_a_newer_database_is_not_opened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.sqlite3");
        let notes_items = tables_of_notes(&["CREATE TABLE notes_items (text TEXT)"]);
        drop(Store::open(&path, &notes_items).unwrap());
        drop(Store::open(&path, &notes_items).unwrap());
        // A module's newer data turns off the module alone.
        let older = Store::open(&path, &tables_of_notes(&[]));
        let newer = |why: &Error| matches!(why, Error::Refused(r) if r.code == Code::Conflict);
        assert!(off_as(&older, newer));
        drop(older);
        // The kernel's own keeps the store shut.
        let sql = Connection::open(&path).unwrap();
        sql.execute(
            "INSERT INTO kernel_migrations (ledger, step, at) VALUES (?1, ?2, 0)",
            params![KERNEL, KERNEL_MIGRATIONS.len() as i64 + 1],
        )
        .unwrap();
        drop(sql);
        let older = Store::open(&path, &notes_items);
        assert!(matches!(older, Err(Error::Refused(r)) if r.code == Code::Conflict));
    }

    #[tokio::test]
    async fn a_step_that_fails_turns_off_its_module_alone_and_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.sqlite3");
        let other = Tables {
            module: "other",
            legacy: &[],
            migrations: &["CREATE TABLE other_items (text TEXT)"],
        };
        let with = |steps| [tables_of_notes(steps)[0], other];
        let broken = with(&[
            "CREATE TABLE notes_items (text TEXT)",
            "CREATE TABLE notes_tags (tag TEXT); INSERT INTO notes_tagz VALUES ('x')",
        ]);
        let store = Store::open(&path, &broken).unwrap();
        let [off] = store.off() else {
            panic!("notes alone is off");
        };
        assert_eq!((off.module, off.step), ("notes", Some(2)));
        assert_eq!(
            off.words(),
            "Step 2 of its tables failed: no such table: notes_tagz."
        );
        // The module after it came up to date, and runs.
        store
            .write("other", |tx| {
                tx.sql()
                    .execute("INSERT INTO other_items VALUES ('kept')", [])?;
                Ok(())
            })
            .await
            .unwrap();
        drop(store);
        // The steps before it are kept and the failed one left nothing, so
        // the step put right runs.
        let mended = with(&[
            "CREATE TABLE notes_items (text TEXT)",
            "CREATE TABLE notes_tags (tag TEXT)",
        ]);
        let store = Store::open(&path, &mended).unwrap();
        assert!(store.off().is_empty());
    }

    #[tokio::test]
    async fn a_module_s_change_and_reads_reach_its_own_tables_and_the_kernel_s_api() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let who = author();
        let seq = store
            .write("notes", move |tx| {
                tx.sql()
                    .execute("INSERT INTO notes_items (text) VALUES ('kept')", [])?;
                tx.enqueue("publish", "feed", &"kept")?;
                Ok(tx.emit("added", 1, None, who, &"kept")?.seq)
            })
            .await
            .unwrap();
        let receipts = "SELECT count(*) FROM kernel_receipts";
        let changed = store
            .write("notes", move |tx| {
                tx.sql()
                    .execute("INSERT INTO notes_items (text) VALUES ('lost')", [])?;
                Ok(tx
                    .sql()
                    .query_row(receipts, [], |row| row.get::<_, i64>(0))?)
            })
            .await;
        assert!(changed.is_err_and(|e| refused(&e)));
        let count = |sql: &Connection| {
            Ok(
                sql.query_row("SELECT count(*) FROM notes_items", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            )
        };
        assert_eq!(
            store.read_as("notes", count).await.unwrap(),
            1,
            "rolled back"
        );
        let log = |sql: &Connection| Ok(sql.query_row(receipts, [], |row| row.get::<_, i64>(0))?);
        let read = store.read_as("notes", log).await;
        assert!(read.is_err_and(|e| refused(&e)));
        let (at, notes) = store.view("notes", count).await.unwrap();
        assert_eq!((at, notes), (seq, 1));
        let viewed = store.view("notes", log).await;
        assert!(viewed.is_err_and(|e| refused(&e)));
        // The reader is the kernel's again, out of the view's transaction.
        assert_eq!(store.read(log).await.unwrap(), 0);
        let stranger = store.read_as("stranger", count).await;
        assert!(stranger.is_err_and(|e| refused(&e)));
    }

    /// The count of `table`'s rows.
    fn count(table: &'static str) -> impl FnOnce(&Connection) -> Result<i64, Error> + Send {
        move |sql| {
            Ok(
                sql.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?,
            )
        }
    }

    #[tokio::test]
    async fn a_module_runs_no_transaction_nor_any_change_of_shape_as_it_runs() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        for sql in [
            "INSERT INTO notes_items (text) VALUES ('early'); COMMIT",
            "SAVEPOINT inner; INSERT INTO notes_items (text) VALUES ('inner')",
            "CREATE TABLE notes_more (text TEXT)",
            "ALTER TABLE notes_items ADD COLUMN at INTEGER",
            "ALTER TABLE notes_items RENAME TO notes_old",
            "ATTACH DATABASE ':memory:' AS elsewhere",
            "PRAGMA writable_schema = ON",
            "PRAGMA table_info(notes_items)",
            "SELECT sql FROM sqlite_master",
            "SELECT name FROM sqlite_sequence",
            "DELETE FROM sqlite_sequence WHERE name = 'kernel_outbox'",
        ] {
            let ran = store
                .write("notes", move |tx| Ok(tx.sql().execute_batch(sql)?))
                .await;
            assert!(matches!(&ran, Err(e) if refused(e)), "{sql}: {ran:?}");
        }
        assert_eq!(
            store.read_as("notes", count("notes_items")).await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn a_module_s_read_holds_the_reader_in_no_transaction() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(
            &dir.path().join("project.sqlite3"),
            &[
                tables_of_notes(&["CREATE TABLE notes_items (text TEXT NOT NULL)"])[0],
                Tables {
                    module: "other",
                    legacy: &[],
                    migrations: &["CREATE TABLE other_items (text TEXT NOT NULL)"],
                },
            ],
        )
        .unwrap();
        let pinned = store
            .read_as("notes", |sql| {
                Ok(sql.execute_batch("SAVEPOINT pin; SELECT count(*) FROM notes_items")?)
            })
            .await;
        assert!(pinned.is_err_and(|e| refused(&e)));
        let who = author();
        let seq = store
            .write("notes", move |tx| {
                Ok(tx.emit("added", 1, None, who, &"kept")?.seq)
            })
            .await
            .unwrap();
        let (at, others) = store.view("other", count("other_items")).await.unwrap();
        assert_eq!((at, others), (seq, 0), "a view of now, from another module");
    }

    #[tokio::test]
    async fn a_module_is_not_given_a_statement_the_kernel_cached() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        // No value is bound, so SQLite would hand it back as it was.
        let receipts = "SELECT count(*) FROM kernel_receipts";
        let cached = move |sql: &Connection| Ok(sql.prepare_cached(receipts).map(drop)?);
        store.read(cached).await.unwrap();
        let read = store.read_as("notes", cached).await;
        assert!(read.is_err_and(|e| refused(&e)));
        let written = store
            .write("notes", move |tx| {
                cached(&tx.kernel())?;
                cached(tx.sql())
            })
            .await;
        assert!(written.is_err_and(|e| refused(&e)));
    }

    #[tokio::test]
    async fn both_connections_trust_no_function_the_schema_names() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let trusted = |sql: &Connection| {
            Ok(sql.query_row("PRAGMA trusted_schema", [], |row| row.get::<_, i64>(0))?)
        };
        assert_eq!(store.read(trusted).await.unwrap(), 0);
        let written = store.write(KERNEL, move |tx| trusted(&tx.kernel()));
        assert_eq!(written.await.unwrap(), 0);
    }

    #[tokio::test]
    async fn a_module_s_steps_reach_only_its_own_tables_and_those_it_kept_from_before() {
        let dir = tempfile::tempdir().unwrap();
        let refused_steps: [&'static [&'static str]; 10] = [
            &["CREATE TABLE other_items (text TEXT)"],
            &["CREATE INDEX notes_by_seq ON kernel_events (seq)"],
            &["DROP TRIGGER kernel_events_are_not_changed"],
            &["INSERT INTO kernel_migrations (ledger, step, at) VALUES ('other', 1, 0)"],
            &["DELETE FROM sqlite_sequence WHERE name = 'kernel_outbox'"],
            &["CREATE TABLE notes_old (text TEXT); DROP TABLE notes_old"],
            &["CREATE VIEW notes_recent AS SELECT 1"],
            &["CREATE TABLE notes_items (text TEXT);
               CREATE TRIGGER notes_t AFTER INSERT ON notes_items BEGIN SELECT 1; END"],
            &["CREATE TEMP TABLE notes_scratch (text TEXT)"],
            &["CREATE TABLE notes_items (text TEXT); ALTER TABLE notes_items RENAME TO kernel_x"],
        ];
        let path = dir.path().join("refused.sqlite3");
        for steps in refused_steps {
            let opened = Store::open(&path, &tables_of_notes(steps));
            assert!(off_as(&opened, refused), "{steps:?}");
        }
        // SQLite asks nothing of a key's parent: the kernel reads it after.
        let keyed: [&'static [&'static str]; 2] = [
            &["CREATE TABLE notes_items (seq INTEGER REFERENCES kernel_events (seq))"],
            &["CREATE TABLE notes_items (id INTEGER PRIMARY KEY);
               ALTER TABLE notes_items ADD COLUMN thread TEXT REFERENCES other_threads (id)"],
        ];
        for steps in keyed {
            let opened = Store::open(&path, &tables_of_notes(steps));
            let invalid = |why: &Error| matches!(why, Error::Refused(r) if r.code == Code::Invalid);
            assert!(off_as(&opened, invalid), "{steps:?}");
        }
        let renamed = [Tables {
            module: "notes",
            legacy: &["jots"],
            // A key SQLite makes an index for, and keys between its tables.
            migrations: &[
                "CREATE TABLE jots_items (text TEXT PRIMARY KEY, at INTEGER UNIQUE);
                 CREATE INDEX jots_by_at ON jots_items (at, text);
                 CREATE TABLE notes_tags (item TEXT REFERENCES jots_items (text));",
                "ALTER TABLE notes_tags ADD COLUMN seen INTEGER NOT NULL DEFAULT 0;
                 CREATE TABLE notes_counted (id INTEGER PRIMARY KEY AUTOINCREMENT);",
            ],
        }];
        let store = Store::open(&dir.path().join("kept.sqlite3"), &renamed).unwrap();
        store
            .write("notes", |tx| {
                tx.sql().execute_batch(
                    "INSERT INTO jots_items (text) VALUES ('kept');
                     INSERT INTO notes_tags (item) VALUES ('kept');
                     INSERT INTO notes_counted DEFAULT VALUES;",
                )?;
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_module_s_full_text_index_is_its_own_on_both_connections() {
        let dir = tempfile::tempdir().unwrap();
        let refused_steps: [&'static [&'static str]; 2] = [
            &["CREATE VIRTUAL TABLE other_search USING fts5(text)"],
            &["CREATE VIRTUAL TABLE notes_boxes USING rtree(id, low, high)"],
        ];
        let path = dir.path().join("refused.sqlite3");
        for steps in refused_steps {
            let opened = Store::open(&path, &tables_of_notes(steps));
            assert!(off_as(&opened, refused), "{steps:?}");
        }
        let store = Store::open(
            &dir.path().join("project.sqlite3"),
            &tables_of_notes(&["CREATE VIRTUAL TABLE notes_search USING fts5(text)"]),
        )
        .unwrap();
        // FTS5 writes its shadow tables and asks its change count.
        store
            .write("notes", |tx| {
                tx.sql().execute_batch(
                    "INSERT INTO notes_search (rowid, text) VALUES (1, 'a kept note');
                     INSERT OR REPLACE INTO notes_search (rowid, text) VALUES (1, 'a found note');
                     INSERT INTO notes_search (rowid, text) VALUES (2, 'another note');
                     DELETE FROM notes_search WHERE rowid = 2;",
                )?;
                Ok(())
            })
            .await
            .unwrap();
        let found = store
            .read_as("notes", |sql| {
                Ok(sql.query_row(
                    "SELECT highlight(notes_search, 0, '[', ']'), bm25(notes_search)
                     FROM notes_search WHERE notes_search MATCH 'fou*'",
                    [],
                    |row| row.get::<_, String>(0),
                )?)
            })
            .await
            .unwrap();
        assert_eq!(found, "a [found] note", "read on the reader");
        let made = store
            .write("notes", |tx| {
                Ok(tx
                    .sql()
                    .execute_batch("CREATE VIRTUAL TABLE notes_more USING fts5(text)")?)
            })
            .await;
        assert!(made.is_err_and(|e| refused(&e)), "only in a step");
    }
}
