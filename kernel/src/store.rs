//! A Space's SQLite, with one writer (ADR 0002, decisions 2 and 4).
//!
//! The writer is one thread that owns the only writing connection. Every
//! change is a job that runs in one transaction. A change's events go out
//! to subscribers only after it commits, in commit order. Readers use their
//! own connection: SQLite's WAL lets them read while the writer writes.

use crate::events::{self, Event};
use crate::{CommandId, Error, EventId, Participant, Refusal, now_ms};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex, mpsc};
use tokio::sync::{Notify, broadcast, oneshot};

/// The kernel's name in the event log, the receipts and the ledger.
pub(crate) const KERNEL: &str = "kernel";

/// How many committed events a slow subscriber may fall behind before it is
/// told to read again.
const SUBSCRIBER_LAG: usize = 4096;

/// The kernel's own steps. Each module keeps its own ledger next to them.
const KERNEL_MIGRATIONS: &[&str] = &[r#"
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
"#];

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// One open Space database.
pub(crate) struct Store {
    jobs: mpsc::Sender<Job>,
    reader: Arc<Mutex<Connection>>,
    published: broadcast::Sender<Arc<Event>>,
    outbox: Arc<Notify>,
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
    /// of this module with the same `key` (ADR 0002, decision 3).
    pub fn enqueue(
        &mut self,
        kind: &str,
        key: &str,
        payload: &impl Serialize,
    ) -> Result<(), Error> {
        let payload = serde_json::to_string(payload)?;
        self.tx.execute(
            "INSERT INTO kernel_outbox (module, kind, key, payload, state, next_at, created_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
            params![self.module, kind, key, payload, self.now],
        )?;
        self.enqueued = true;
        Ok(())
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
                    job(&mut writer);
                }
            })?;
        let (published, _) = broadcast::channel(SUBSCRIBER_LAG);
        Ok(Store {
            jobs,
            reader: Arc::new(Mutex::new(reader)),
            published,
            outbox: Arc::new(Notify::new()),
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

    /// Runs a command once. Its receipt commits with its events, so the same
    /// command ID returns the first result and changes nothing again. A
    /// refusal gets a receipt too. An engine failure does not, so the caller
    /// may try again (ADR 0002, decision 2).
    pub(crate) async fn command(
        &self,
        receipt: Receipt,
        change: impl FnOnce(&mut Tx<'_>) -> Result<Value, Error> + Send + 'static,
    ) -> Result<Value, Refusal> {
        let published = self.published.clone();
        let outbox = self.outbox.clone();
        let outcome = self
            .on_writer(move |sql| {
                if let Some(answer) = receipt.earlier(sql)? {
                    return Ok(answer);
                }
                let module = receipt.module;
                let attempt = transact(sql, module, |tx| {
                    let value = change(tx)?;
                    receipt.keep(tx.sql(), Ok(&value), tx.now())?;
                    Ok(value)
                });
                match attempt {
                    Ok((value, emitted, enqueued)) => {
                        publish(&published, &outbox, emitted, enqueued);
                        Ok(Ok(value))
                    }
                    Err(Error::Refused(refusal)) => {
                        receipt.keep(sql, Err(&refusal), now_ms())?;
                        Ok(Err(refusal))
                    }
                    Err(failure) => Err(failure),
                }
            })
            .await;
        outcome.unwrap_or_else(|failure| Err(failure.into()))
    }

    /// The first answer to a command, if it has one.
    pub(crate) async fn answered(
        &self,
        receipt: Receipt,
    ) -> Result<Option<Result<Value, Refusal>>, Error> {
        self.read(move |sql| receipt.earlier(sql)).await
    }

    /// Keeps a refusal made before the command ran, unless the command has
    /// an answer already.
    pub(crate) async fn refused(&self, receipt: Receipt, refusal: Refusal) -> Result<(), Error> {
        self.on_writer(move |sql| {
            if receipt.earlier(sql)?.is_none() {
                receipt.keep(sql, Err(&refusal), now_ms())?;
            }
            Ok(())
        })
        .await
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
        answer.await.map_err(|_| Error::Closed)?
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

/// A command's receipt: which call it answers and who made it.
#[derive(Clone)]
pub(crate) struct Receipt {
    pub(crate) command: CommandId,
    pub(crate) module: &'static str,
    pub(crate) method: String,
    pub(crate) author: Participant,
}

impl Receipt {
    /// The answer stored for this command ID. The same ID used for another
    /// call, or by someone else, is a conflict.
    fn earlier(&self, sql: &Connection) -> Result<Option<Result<Value, Refusal>>, Error> {
        let stored = sql
            .query_row(
                "SELECT module, method, author_kind, author_id, ok, refusal
                 FROM kernel_receipts WHERE command = ?1",
                params![self.command],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((module, method, author_kind, author_id, ok, refusal)) = stored else {
            return Ok(None);
        };
        let same_author = Participant::from_parts(&author_kind, &author_id) == Some(self.author);
        if module != self.module || method != self.method || !same_author {
            return Ok(Some(Err(Refusal::conflict(
                "This command ID was already used for another call.",
            ))));
        }
        Ok(Some(match (ok, refusal) {
            (Some(ok), _) => Ok(serde_json::from_str(&ok)?),
            (None, Some(refusal)) => Err(serde_json::from_str(&refusal)?),
            (None, None) => Ok(Value::Null),
        }))
    }

    fn keep(
        &self,
        sql: &Connection,
        result: Result<&Value, &Refusal>,
        at: i64,
    ) -> Result<(), Error> {
        let (ok, refusal) = match result {
            Ok(value) => (Some(value.to_string()), None),
            Err(refusal) => (None, Some(serde_json::to_string(refusal)?)),
        };
        sql.execute(
            "INSERT INTO kernel_receipts (command, module, method, author_kind, author_id, ok, refusal, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                self.command,
                self.module,
                self.method,
                self.author.kind(),
                self.author.id(),
                ok,
                refusal,
                at
            ],
        )?;
        Ok(())
    }
}

/// Applies the steps of `ledger` that this database has not seen, each in
/// its own transaction. A database that has seen more steps than this engine
/// knows was written by a newer engine and is not opened.
fn migrate(sql: &mut Connection, ledger: &str, steps: &[&str]) -> Result<(), Error> {
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
            &dir.path().join("space.sqlite3"),
            &[("notes", &["CREATE TABLE notes_items (text TEXT NOT NULL)"])],
        )
        .unwrap()
    }

    fn author() -> Participant {
        Participant::Person(PersonId::new())
    }

    fn receipt(command: CommandId, method: &str, author: Participant) -> Receipt {
        Receipt {
            command,
            module: "notes",
            method: method.to_owned(),
            author,
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

    #[tokio::test]
    async fn a_repeated_command_returns_its_first_result_and_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let command = CommandId::new();
        let who = author();
        for _ in 0..2 {
            let result = store
                .command(receipt(command, "add", who), move |tx| {
                    tx.sql()
                        .execute("INSERT INTO notes_items (text) VALUES ('one')", [])?;
                    tx.emit("added", 1, None, who, &"one")?;
                    Ok(Value::from(7))
                })
                .await;
            assert_eq!(result, Ok(Value::from(7)));
        }
        let rows: i64 = store
            .read(|sql| Ok(sql.query_row("SELECT COUNT(*) FROM notes_items", [], |r| r.get(0))?))
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[tokio::test]
    async fn a_refusal_gets_a_receipt_and_a_reused_id_is_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let command = CommandId::new();
        let who = author();
        let first = store
            .command(receipt(command, "add", who), |_| {
                Err(Refusal::invalid("empty").into())
            })
            .await;
        assert_eq!(first.unwrap_err().code, Code::Invalid);
        let again = store
            .command(receipt(command, "add", who), |_| Ok(Value::from(1)))
            .await;
        assert_eq!(
            again.unwrap_err().code,
            Code::Invalid,
            "the refusal is the command's answer"
        );
        let other = store
            .command(receipt(command, "remove", who), |_| Ok(Value::Null))
            .await;
        assert_eq!(other.unwrap_err().code, Code::Conflict);
        let someone_else = store
            .command(receipt(command, "add", author()), |_| Ok(Value::Null))
            .await;
        assert_eq!(someone_else.unwrap_err().code, Code::Conflict);
    }

    #[tokio::test]
    async fn a_refusal_before_the_command_is_its_answer_too() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let command = CommandId::new();
        let who = author();
        store
            .refused(receipt(command, "add", who), Refusal::forbidden("no"))
            .await
            .unwrap();
        let answer = store
            .answered(receipt(command, "add", who))
            .await
            .unwrap()
            .expect("an answer");
        assert_eq!(answer.unwrap_err().code, Code::Forbidden);
        let ran = store
            .command(receipt(command, "add", who), |_| Ok(Value::from(1)))
            .await;
        assert_eq!(ran.unwrap_err().code, Code::Forbidden);
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
        let path = dir.path().join("space.sqlite3");
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
