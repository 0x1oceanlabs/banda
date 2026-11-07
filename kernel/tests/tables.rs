//! Each module reaches only its own tables (ADR 0062, decision 5; ADR 0085,
//! decisions 10 and 12): the kernel's authorizer, through its interface,
//! with real SQLite in a temporary folder.

use banda_kernel::{
    Call, Code, CommandId, Error, Kernel, KernelBuilder, Kind, Module, ModuleProject, Participant,
    PersonId, ProjectSummary, Refusal, Right,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A stand-in for the agents module: its Threads in `agents_threads`, and
/// `start`, a command that starts one.
struct Agents;

#[async_trait::async_trait]
impl Module for Agents {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &["CREATE TABLE agents_threads (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"]
    }

    fn right(&self, method: &str) -> Option<Right> {
        (method == "start").then_some(Right::Write)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        (method == "start").then_some(Kind::Command)
    }

    async fn call(&self, call: Call, _: &str, _: Value) -> Result<Value, Refusal> {
        let author = call.participant();
        call.command(move |tx| {
            tx.sql()
                .execute("INSERT INTO agents_threads (title) VALUES ('first')", [])?;
            tx.enqueue("title", "thread", &json!({}))?;
            tx.emit("thread.started", 1, None, author, &json!({}))?;
            Ok(Value::Null)
        })
        .await
    }
}

/// A module that keeps each Project it opens in, for a test to read and
/// write as it; `peek` is a command that reads the kernel's receipts.
#[derive(Clone)]
struct Spy {
    name: &'static str,
    legacy: &'static [&'static str],
    migrations: &'static [&'static str],
    projects: Arc<Mutex<Vec<ModuleProject>>>,
}

impl Spy {
    fn new(
        name: &'static str,
        legacy: &'static [&'static str],
        migrations: &'static [&'static str],
    ) -> Spy {
        Spy {
            name,
            legacy,
            migrations,
            projects: Default::default(),
        }
    }

    /// The spy, with a table of its own.
    fn with_notes() -> Spy {
        Spy::new("spy", &[], &["CREATE TABLE spy_notes (text TEXT NOT NULL)"])
    }

    fn project(&self) -> ModuleProject {
        self.projects.lock().unwrap()[0].clone()
    }
}

#[async_trait::async_trait]
impl Module for Spy {
    fn name(&self) -> &'static str {
        self.name
    }

    fn legacy_prefixes(&self) -> &'static [&'static str] {
        self.legacy
    }

    fn migrations(&self) -> &'static [&'static str] {
        self.migrations
    }

    fn right(&self, method: &str) -> Option<Right> {
        (method == "peek").then_some(Right::Write)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        (method == "peek").then_some(Kind::Command)
    }

    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        self.projects.lock().unwrap().push(project);
        Ok(())
    }

    async fn call(&self, call: Call, _: &str, _: Value) -> Result<Value, Refusal> {
        let receipts = "SELECT count(*) FROM kernel_receipts";
        call.command(move |tx| {
            Ok(tx
                .sql()
                .query_row(receipts, [], |row| row.get::<_, i64>(0))?)
        })
        .await
        .map(Value::from)
    }
}

/// Whether `error` is the authorizer's refusal.
fn refused(error: &Error) -> bool {
    matches!(error, Error::Database(e)
        if e.sqlite_error_code() == Some(rusqlite::ErrorCode::AuthorizationForStatementDenied))
}

/// The count `sql` reads.
fn count(
    sql: &'static str,
) -> impl FnOnce(&rusqlite::Connection) -> Result<i64, Error> + Send + 'static {
    move |connection| Ok(connection.query_row(sql, [], |row| row.get(0))?)
}

/// A kernel over `root`, its data in `.data`.
fn builder(root: &Path, owner: PersonId) -> KernelBuilder {
    Kernel::builder(root, root.join(".data"), owner)
}

async fn create(kernel: &Kernel, owner: PersonId) -> Result<ProjectSummary, Refusal> {
    let params = json!({ "name": "Walls" });
    let created = kernel.call(
        Participant::Person(owner),
        "projects.create",
        None,
        Some(CommandId::new()),
        params,
    );
    Ok(serde_json::from_value(created.await?).unwrap())
}

async fn start(kernel: &Kernel, owner: PersonId, project: &ProjectSummary) {
    let command = Some(CommandId::new());
    let started = kernel.call(
        Participant::Person(owner),
        "agents.start",
        Some(project.id),
        command,
        json!({}),
    );
    started.await.unwrap();
}

/// Drops `kernel` and waits until nothing holds its Projects.
async fn let_go(kernel: Arc<Kernel>, data: &Path) {
    drop(kernel);
    let locks: Vec<PathBuf> = std::fs::read_dir(data.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path().join("project.lock"))
        .collect();
    let free = |lock: &PathBuf| {
        std::fs::File::open(lock).is_ok_and(|file| file.try_lock().is_ok()) || !lock.exists()
    };
    for _ in 0..500 {
        if locks.iter().all(free) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("a Project was never let go");
}

#[tokio::test]
async fn a_module_that_reads_the_kernel_s_receipts_or_another_s_threads_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let spy = Spy::with_notes();
    let opened = builder(root.path(), owner)
        .module(Agents)
        .module(spy.clone());
    let kernel = opened.open().await.unwrap();
    let project = create(&kernel, owner).await.unwrap();
    start(&kernel, owner, &project).await;
    let spying = spy.project();

    for read in [
        "SELECT count(*) FROM kernel_receipts",
        "SELECT count(*) FROM kernel_events",
        "SELECT count(*) FROM kernel_outbox",
        "SELECT count(*) FROM kernel_migrations",
        "SELECT count(*) FROM agents_threads",
        "SELECT max(id) FROM agents_threads",
        "SELECT count(*) FROM spy_notes WHERE text IN (SELECT title FROM agents_threads)",
    ] {
        let read_now = spying.read(count(read)).await;
        assert!(read_now.is_err_and(|e| refused(&e)), "{read}");
        let viewed = spying.view(count(read)).await;
        assert!(viewed.is_err_and(|e| refused(&e)), "{read}");
    }
    for write in [
        "INSERT INTO agents_threads (title) VALUES ('planted')",
        "UPDATE kernel_receipts SET ok = 'null'",
        "DELETE FROM kernel_outbox",
        "INSERT INTO kernel_events (id, module, kind, version, author_kind, author_id, at, payload)
         VALUES ('e', 'agents', 'forged', 1, 'person', 'p', 0, '{}')",
        "DROP TABLE agents_threads",
    ] {
        let written = spying
            .write(move |tx| Ok(tx.sql().execute(write, [])?))
            .await;
        assert!(written.is_err_and(|e| refused(&e)), "{write}");
    }

    // Its own tables, and the kernel's API, it reaches as before.
    let author = Participant::Person(owner);
    spying
        .write(move |tx| {
            tx.sql()
                .execute("INSERT INTO spy_notes (text) VALUES ('mine')", [])?;
            tx.emit("noted", 1, None, author, &json!({}))?;
            Ok(())
        })
        .await
        .unwrap();
    let (at, notes) = (spying.view(count("SELECT count(*) FROM spy_notes")).await).unwrap();
    assert_eq!(notes, 1);
    assert!(at > 0);
    let log = spying
        .events_after(0, Default::default(), 10)
        .await
        .unwrap();
    let kinds: Vec<&str> = log.iter().map(|event| event.kind.as_str()).collect();
    assert_eq!(kinds, ["thread.started", "noted"]);

    // Through the API, a command that reaches past its tables breaks, and
    // keeps no answer; the Project's writer goes on.
    let peek = kernel.call(
        Participant::Person(owner),
        "spy.peek",
        Some(project.id),
        Some(CommandId::new()),
        json!({}),
    );
    assert_eq!(peek.await.unwrap_err().code, Code::Internal);
    start(&kernel, owner, &project).await;
}

#[tokio::test]
async fn an_app_whose_id_changed_reaches_the_tables_it_kept_under_its_legacy_prefix() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = builder(root.path(), owner).module(Agents).open().await;
    let kernel = kernel.unwrap();
    let project = create(&kernel, owner).await.unwrap();
    start(&kernel, owner, &project).await;
    let_go(kernel, &root.path().join(".data")).await;

    // Agents by its new id: no migration of its own yet, its tables kept.
    let threads = Spy::new("threads", &["agents"], &[]);
    let kernel = builder(root.path(), owner)
        .module(threads.clone())
        .open()
        .await;
    let kernel = kernel.unwrap();
    let kept = threads.project();
    let titles = kept
        .read(|sql| {
            Ok(sql.query_row("SELECT title FROM agents_threads", [], |r| {
                r.get::<_, String>(0)
            })?)
        })
        .await;
    assert_eq!(titles.unwrap(), "first");
    kept.write(|tx| {
        let add = "INSERT INTO agents_threads (title) VALUES ('second')";
        Ok(tx.sql().execute(add, [])?)
    })
    .await
    .unwrap();
    let receipts = kept
        .read(count("SELECT count(*) FROM kernel_receipts"))
        .await;
    assert!(receipts.is_err_and(|e| refused(&e)));
    drop(kernel);
}

#[tokio::test]
async fn a_module_whose_steps_reach_past_its_tables_opens_no_project() {
    let owner = PersonId::new();
    let created = async |steps: &'static [&'static str]| {
        let root = tempfile::tempdir().unwrap();
        let spy = Spy::new("spy", &[], steps);
        let kernel = builder(root.path(), owner).module(Agents).module(spy);
        create(&kernel.open().await.unwrap(), owner).await
    };
    let own = &["CREATE TABLE spy_notes (module TEXT); CREATE INDEX spy_by ON spy_notes (module)"];
    created(own).await.unwrap();
    let past = created(&["CREATE INDEX spy_by ON kernel_events (module)"]).await;
    assert_eq!(past.unwrap_err().code, Code::Internal);
    let keyed = created(&["CREATE TABLE spy_x (thread INTEGER REFERENCES agents_threads (id))"]);
    let keyed = keyed.await.unwrap_err();
    assert_eq!(keyed.code, Code::Invalid);
    assert!(
        keyed.message.contains("agents_threads"),
        "{}",
        keyed.message
    );
}

#[tokio::test]
async fn names_and_legacy_prefixes_that_meet_another_s_tables_are_refused() {
    let root = tempfile::tempdir().unwrap();
    let refused = async |builder: KernelBuilder| match builder.open().await {
        Err(Error::Refused(refusal)) => refusal.code == Code::Invalid,
        _ => false,
    };
    let modules = || builder(root.path(), PersonId::new());
    let renamed = |legacy: &'static [&'static str]| Spy::new("threads", legacy, &[]);
    assert!(refused(modules().module(Agents).module(renamed(&["agents"]))).await);
    for legacy in [
        &["kernel"][..],
        &["sqlite"],
        &["pragma"],
        &["json"],
        &["Old"],
        &["old_ones"],
        &[""],
        &["threads"],
    ] {
        assert!(
            refused(modules().module(renamed(legacy))).await,
            "{legacy:?}"
        );
    }
    let other = Spy::new("other", &["old"], &[]);
    assert!(refused(modules().module(renamed(&["old"])).module(other)).await);
    for name in ["sqlite", "pragma", "json"] {
        let reserved = Spy::new(name, &[], &[]);
        assert!(refused(modules().module(reserved)).await, "{name}");
    }
}
