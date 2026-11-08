//! The kernel through its interface: a small test module, real SQLite in a
//! temporary folder, and the real API over a WebSocket.

use banda_kernel::api::Identity;
use banda_kernel::{
    AgentId, Call, Caller, Code, CommandId, Effect, Error, Event, EventFilter, Kernel, Kind, Lease,
    Listener, Module, ModuleProject, OnRestart, Outcome, Participant, Pass, PersonId, ProjectId,
    ProjectSummary, Refusal, Retry, Right, Scope, Settled, SignKind, Stream, Tx, decode, now_ms,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Notes: `add` writes a note and queues `publish`, keyed by one feed.
/// `stamp` is a command that acts outside the store and writes nothing
/// there, as a file's rename does; `post` writes a note, then answers
/// other than its change; `touch` is a call that acts and keeps no
/// receipt.
#[derive(Clone, Default)]
struct Notes {
    published: Arc<Mutex<Vec<String>>>,
    /// How many times `stamp` acted.
    stamped: Arc<AtomicUsize>,
    /// How the next runs of `stamp` and `post` are refused, after acting;
    /// they answer once the script is empty.
    stamp_refusals: Arc<Mutex<VecDeque<Refusal>>>,
    /// Said as each run of `stamp` begins; a run waits while it is held.
    stamp_began: Arc<tokio::sync::Notify>,
    stamp_held: Arc<tokio::sync::RwLock<()>>,
    /// How many times `touch` acted.
    touched: Arc<AtomicUsize>,
    /// How the next runs of `publish` end; `Done` once the script is empty.
    script: Arc<Mutex<VecDeque<Outcome>>>,
    /// Whether the next run of `publish` panics.
    panics: Arc<AtomicBool>,
    /// The Projects it was told were removed.
    closed: Arc<Mutex<Vec<ProjectId>>>,
    /// Each Project it was told changed its trust, as it read it then.
    trusts: Arc<Mutex<Vec<(ProjectId, bool)>>>,
    /// The passes it gave, held as a session holds its own.
    passes: Arc<Mutex<Vec<Pass>>>,
}

#[derive(Deserialize)]
struct Add {
    text: String,
}

#[async_trait::async_trait]
impl Module for Notes {
    fn name(&self) -> &'static str {
        "notes"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &["CREATE TABLE notes_items (id INTEGER PRIMARY KEY, text TEXT NOT NULL)"]
    }

    async fn closing(&self, project: ModuleProject) {
        self.closed.lock().unwrap().push(project.id());
    }

    async fn trust_changed(&self, project: ModuleProject) {
        (self.trusts.lock().unwrap()).push((project.id(), project.trusted()));
    }

    fn right(&self, method: &str) -> Option<Right> {
        match method {
            "add" | "stamp" | "post" | "touch" => Some(Right::Write),
            "list" => Some(Right::Read),
            "purge" => Some(Right::Manage),
            "count" => Some(Right::Read),
            "pass" => Some(Right::Read),
            "show" => Some(Right::Read),
            _ => None,
        }
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        match method {
            "add" | "purge" | "stamp" | "post" => Some(Kind::Command),
            "list" | "pass" | "show" | "touch" => Some(Kind::Call),
            "count" => Some(Kind::Stream),
            _ => None,
        }
    }

    /// `count` says the numbers up to `to`, then ends.
    async fn stream(&self, _call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        if method != "count" {
            return Err(Refusal::invalid("No such stream."));
        }
        let to = params["to"].as_u64().unwrap_or(0);
        let (say, heard) = tokio::sync::mpsc::channel(4);
        tokio::spawn(async move {
            for n in 1..=to {
                if say.send(json!({ "n": n })).await.is_err() {
                    return;
                }
            }
        });
        Ok(heard)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        match method {
            "add" => {
                let Add { text } = decode(params)?;
                let author = call.participant();
                call.command(move |tx| {
                    tx.sql()
                        .execute("INSERT INTO notes_items (text) VALUES (?1)", [&text])?;
                    let seq = tx
                        .emit("added", 1, Some("feed"), author, &json!({ "text": text }))?
                        .seq;
                    tx.enqueue(
                        "publish",
                        "feed",
                        &json!({ "text": text, "author": author }),
                    )?;
                    Ok(json!({ "seq": seq }))
                })
                .await
            }
            // Acts, and writes nothing in the store: the kernel keeps its
            // receipt all the same.
            "stamp" => {
                self.stamp_began.notify_one();
                let _held = self.stamp_held.read().await;
                let stamp = self.stamped.fetch_add(1, Ordering::SeqCst) + 1;
                match self.stamp_refusals.lock().unwrap().pop_front() {
                    Some(refusal) => Err(refusal),
                    None => Ok(json!({ "stamp": stamp, "params": params })),
                }
            }
            "post" => {
                let author = call.participant();
                call.command(move |tx| {
                    tx.sql()
                        .execute("INSERT INTO notes_items (text) VALUES ('post')", [])?;
                    Ok(tx.emit("added", 1, Some("feed"), author, &"post")?.seq)
                })
                .await?;
                match self.stamp_refusals.lock().unwrap().pop_front() {
                    Some(refusal) => Err(refusal),
                    None => Ok(json!("posted")),
                }
            }
            "touch" => Ok(json!(self.touched.fetch_add(1, Ordering::SeqCst) + 1)),
            // The pass of the Agent `agent` in this Project, as the agents
            // module asks for one when it opens a session.
            "pass" => {
                let agent: AgentId = decode(params["agent"].clone())?;
                let pass = call.project().pass(agent)?;
                let secret = pass.secret().to_owned();
                self.passes.lock().unwrap().push(pass);
                Ok(json!(secret))
            }
            // Asks the window to show what it is given, as the browser asks
            // it for a page.
            "show" => (call.ask_window("show", &params, Duration::from_secs(5))).await,
            "list" => {
                let (at, items) = call
                    .project()
                    .view(|sql| {
                        let mut statement =
                            sql.prepare("SELECT text FROM notes_items ORDER BY id")?;
                        let items = statement.query_map([], |row| row.get::<_, String>(0))?;
                        Ok(items.collect::<rusqlite::Result<Vec<_>>>()?)
                    })
                    .await?;
                Ok(json!({ "at": at, "items": items }))
            }
            _ => {
                call.command(|tx| {
                    tx.sql().execute("DELETE FROM notes_items", [])?;
                    Ok(Value::Null)
                })
                .await
            }
        }
    }

    async fn run(&self, _project: ModuleProject, effect: Effect) -> Outcome {
        assert!(
            !self.panics.swap(false, Ordering::SeqCst),
            "a scripted panic"
        );
        let outcome = self
            .script
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Outcome::Done);
        if matches!(outcome, Outcome::Done) {
            let text = effect.payload["text"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            self.published.lock().unwrap().push(text);
        }
        outcome
    }

    fn on_restart(&self, kind: &str) -> OnRestart {
        if kind == "publish" {
            OnRestart::Replay
        } else {
            OnRestart::Abandon
        }
    }

    fn settle(&self, tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
        let author: Participant = serde_json::from_value(effect.payload["author"].clone())?;
        let how = match settled {
            Settled::Abandoned => "abandoned".to_owned(),
            Settled::Failed(reason) => format!("failed: {reason}"),
        };
        tx.emit(
            "lost",
            1,
            Some("feed"),
            author,
            &json!({ "kind": effect.kind, "how": how }),
        )?;
        Ok(())
    }
}

/// Posts: `post` queues an effect of the kind it is given for a worker
/// outside the engine, keyed by one feed, or for the engine when asked. A
/// `post` goes over the network, and tries until its deadline; a `ping`
/// tries three times; a `notify` whose worker went is abandoned, and one
/// of the text `stuck` cannot write that. It keeps each Project it opens
/// in, so a test acts as its worker (ADR 0082, A6).
#[derive(Clone, Default)]
struct Posts {
    projects: Arc<Mutex<Vec<ModuleProject>>>,
    /// The kinds of its effects the engine ran: none, as workers run them.
    ran: Arc<Mutex<Vec<String>>>,
}

#[async_trait::async_trait]
impl Module for Posts {
    fn name(&self) -> &'static str {
        "posts"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        (method == "post").then_some(Right::Write)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        (method == "post").then_some(Kind::Command)
    }

    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        self.projects.lock().unwrap().push(project);
        Ok(())
    }

    async fn call(&self, call: Call, _: &str, params: Value) -> Result<Value, Refusal> {
        let kind = params["kind"].as_str().unwrap_or("post").to_owned();
        let (text, engine) = (params["text"].clone(), params["engine"] == true);
        let author = call.participant();
        call.command(move |tx| {
            let payload = json!({ "text": text, "author": author });
            if engine {
                tx.enqueue(&kind, "engine", &payload)?;
            } else {
                tx.enqueue_for_worker(&kind, "feed", &payload)?;
            }
            Ok(Value::Null)
        })
        .await
    }

    async fn run(&self, _project: ModuleProject, effect: Effect) -> Outcome {
        self.ran.lock().unwrap().push(effect.kind);
        Outcome::Done
    }

    fn on_restart(&self, kind: &str) -> OnRestart {
        if kind == "notify" {
            OnRestart::Abandon
        } else {
            OnRestart::Replay
        }
    }

    fn retry(&self, kind: &str) -> Retry {
        let soon = Duration::from_millis(1);
        let retry = match kind {
            "ping" => Retry::tries(3),
            _ => Retry::within(Duration::from_secs(3600)),
        };
        retry.waiting(soon, soon)
    }

    fn settle(&self, tx: &mut Tx<'_>, effect: &Effect, settled: &Settled) -> Result<(), Error> {
        if effect.payload["text"] == "stuck" {
            return Err(Refusal::invalid("This one never settles.").into());
        }
        Notes::default().settle(tx, effect, settled)
    }
}

/// Desk: a module of this machine, as the workspaces are (ADR 0025).
struct Desk;

#[async_trait::async_trait]
impl Module for Desk {
    fn name(&self) -> &'static str {
        "desk"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &["CREATE TABLE desk_panes (id INTEGER PRIMARY KEY, kind TEXT NOT NULL)"]
    }

    fn right(&self, method: &str) -> Option<Right> {
        match method {
            "open" => Some(Right::Write),
            "list" => Some(Right::Read),
            _ => None,
        }
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        match method {
            "open" => Some(Kind::Command),
            "list" => Some(Kind::Call),
            _ => None,
        }
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        if method == "open" {
            let kind = params["kind"].as_str().unwrap_or_default().to_owned();
            let author = call.participant();
            return call
                .command(move |tx| {
                    tx.sql()
                        .execute("INSERT INTO desk_panes (kind) VALUES (?1)", [&kind])?;
                    tx.emit("opened", 1, None, author, &json!({ "kind": kind }))?;
                    Ok(Value::Null)
                })
                .await;
        }
        let (_, kinds) = call
            .project()
            .view(|sql| {
                let mut statement = sql.prepare("SELECT kind FROM desk_panes ORDER BY id")?;
                let kinds = statement.query_map([], |row| row.get::<_, String>(0))?;
                Ok(kinds.collect::<rusqlite::Result<Vec<_>>>()?)
            })
            .await?;
        Ok(json!(kinds))
    }
}

/// A module that keeps each Project it opens in, to react to the log as a
/// test says: a Project's, or, as `listens`, the machine's. A Project's
/// keeps the texts it copies of what it hears in `hears_copies`.
#[derive(Clone, Default)]
struct Hears {
    projects: Arc<Mutex<Vec<ModuleProject>>>,
    machine: bool,
}

#[async_trait::async_trait]
impl Module for Hears {
    fn name(&self) -> &'static str {
        if self.machine { "listens" } else { "hears" }
    }

    fn scope(&self) -> Scope {
        if self.machine {
            Scope::Machine
        } else {
            Scope::Project
        }
    }

    fn migrations(&self) -> &'static [&'static str] {
        if self.machine {
            &[]
        } else {
            &["CREATE TABLE hears_copies (text TEXT NOT NULL)"]
        }
    }

    fn right(&self, _: &str) -> Option<Right> {
        None
    }

    fn kind(&self, _: &str) -> Option<Kind> {
        None
    }

    async fn opened(&self, project: ModuleProject) -> Result<(), Error> {
        self.projects.lock().unwrap().push(project);
        Ok(())
    }

    async fn call(&self, _: Call, _: &str, _: Value) -> Result<Value, Refusal> {
        Err(Refusal::invalid("No methods."))
    }
}

async fn open(root: &Path, owner: PersonId, notes: &Notes) -> Arc<Kernel> {
    Kernel::builder(root, root.join(".data"), owner)
        .module(notes.clone())
        .open()
        .await
        .unwrap()
}

async fn create_project(
    kernel: &Kernel,
    participant: Participant,
    command: CommandId,
    name: &str,
) -> Result<ProjectSummary, Refusal> {
    let created = kernel
        .call(
            participant,
            "projects.create",
            None,
            Some(command),
            json!({ "name": name }),
        )
        .await?;
    Ok(serde_json::from_value(created).unwrap())
}

async fn create(kernel: &Kernel, owner: PersonId, name: &str) -> ProjectSummary {
    create_project(kernel, Participant::Person(owner), CommandId::new(), name)
        .await
        .unwrap()
}

async fn add(
    kernel: &Kernel,
    participant: Participant,
    project: &ProjectSummary,
    text: &str,
) -> Result<Value, Refusal> {
    kernel
        .call(
            participant,
            "notes.add",
            Some(project.id),
            Some(CommandId::new()),
            json!({ "text": text }),
        )
        .await
}

/// Calls one of the kernel's own Project methods as the owner, a new command.
async fn projects(
    kernel: &Kernel,
    owner: PersonId,
    method: &str,
    params: Value,
) -> Result<Value, Refusal> {
    let method = format!("projects.{method}");
    let command = Some(CommandId::new());
    kernel
        .call(Participant::Person(owner), &method, None, command, params)
        .await
}

async fn add_folder(
    kernel: &Kernel,
    owner: PersonId,
    params: Value,
) -> Result<ProjectSummary, Refusal> {
    let added = projects(kernel, owner, "add", params).await?;
    Ok(serde_json::from_value(added).unwrap())
}

/// Opens the kernel again once the one before let go of its Projects: an
/// effect still running holds a Project a moment longer.
async fn reopen(root: &Path, owner: PersonId, notes: &Notes, count: usize) -> Arc<Kernel> {
    for _ in 0..500 {
        let again = open(root, owner, notes).await;
        if again.projects().await.len() == count {
            return again;
        }
        drop(again);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the Projects never opened again");
}

/// Drops `kernel` and waits until nothing holds the Projects whose data
/// is under `data`, the machine's in `folders` too: an effect still
/// running, or a Project the machine is held by, lets go a moment later.
async fn let_go(kernel: Arc<Kernel>, data: &Path, folders: &[&Path]) {
    drop(kernel);
    let mut locks: Vec<PathBuf> = std::fs::read_dir(data.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path().join("project.lock"))
        .collect();
    locks.extend(folders.iter().map(|folder| folder.join("project.lock")));
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

/// Waits for `check` to hold, for up to five seconds.
async fn eventually<F: Future<Output = bool>>(mut check: impl FnMut() -> F) {
    for _ in 0..500 {
        if check().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the condition never held");
}

async fn kinds(kernel: &Kernel, project: &ProjectSummary) -> Vec<String> {
    let project = kernel.project(project.id).await.unwrap();
    let events = project
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    events.into_iter().map(|e| e.kind).collect()
}

/// How the effect its module settled was lost, as the `lost` event says.
async fn lost_how(kernel: &Kernel, project: &ProjectSummary) -> Value {
    let project = kernel.project(project.id).await.unwrap();
    let events = project
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    let lost = events.into_iter().find(|e| e.kind == "lost");
    lost.expect("an effect was settled").payload["how"].clone()
}

#[tokio::test]
async fn a_project_is_a_folder_and_opens_again_after_a_restart() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let person = Participant::Person(owner);
    let command = CommandId::new();
    let project = create_project(&kernel, person, command, "Research")
        .await
        .unwrap();
    let data = root
        .path()
        .join(".data/projects")
        .join(project.id.to_string());
    assert!(data.join("project.json").is_file());
    assert!(!root.path().join("Research/.banda").exists());
    add(&kernel, person, &project, "first").await.unwrap();

    let again = create_project(&kernel, person, command, "Research").await;
    assert_eq!(
        again,
        Ok(project.clone()),
        "the same command gets the same Project"
    );
    let twin = create_project(&kernel, person, CommandId::new(), "Research").await;
    assert_eq!(twin.unwrap_err().code, Code::Conflict);
    for bad in ["", ".hidden", "a/b", "..", &"x".repeat(65)] {
        let refused = create_project(&kernel, person, CommandId::new(), bad).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad:?}");
    }

    let second = open(root.path(), owner, &notes).await;
    assert!(
        second.projects().await.is_empty(),
        "a Project opens in one engine at a time"
    );
    drop(second);
    drop(kernel);

    // An effect still running holds the Project a moment longer; a real
    // restart ends the process, and the lock with it.
    let again = reopen(root.path(), owner, &notes, 1).await;
    assert_eq!(again.projects().await, vec![project.clone()]);
    let listed = again
        .call(
            Participant::Person(owner),
            "notes.list",
            Some(project.id),
            None,
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(listed["items"], json!(["first"]));
}

#[tokio::test]
async fn the_kernel_s_methods_answer_by_their_names_before_adr_0069() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner, &Notes::default()).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);

    let listed = kernel
        .call(person, "spaces.list", None, None, json!({}))
        .await
        .unwrap();
    assert_eq!(listed[0]["id"], json!(project.id));
}

#[tokio::test]
async fn a_command_runs_once_and_its_effect_runs_after_commit() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);

    let command = CommandId::new();
    let call = || {
        kernel.call(
            person,
            "notes.add",
            Some(project.id),
            Some(command),
            json!({ "text": "once" }),
        )
    };
    let first = call().await.unwrap();
    let second = call().await.unwrap();
    assert_eq!(first, second);

    let missing = kernel
        .call(
            person,
            "notes.add",
            Some(project.id),
            None,
            json!({ "text": "x" }),
        )
        .await;
    assert_eq!(
        missing.unwrap_err().code,
        Code::Invalid,
        "a command needs its ID"
    );

    eventually(|| async { notes.published.lock().unwrap().len() == 1 }).await;
    let listed = kernel
        .call(person, "notes.list", Some(project.id), None, Value::Null)
        .await
        .unwrap();
    assert_eq!(listed["items"], json!(["once"]));
    assert_eq!(
        listed["at"], first["seq"],
        "the view is current at the log's head"
    );
}

/// Calls `notes.stamp` with `params` under `command`, as the owner.
async fn stamp(
    kernel: &Kernel,
    owner: PersonId,
    project: &ProjectSummary,
    command: CommandId,
    params: Value,
) -> Result<Value, Refusal> {
    let person = Participant::Person(owner);
    let stamped = kernel.call(
        person,
        "notes.stamp",
        Some(project.id),
        Some(command),
        params,
    );
    stamped.await
}

#[tokio::test]
async fn every_command_keeps_a_receipt_whatever_its_handler_does() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let command = CommandId::new();
    let params = json!({ "to": "a.txt", "from": "b.txt" });

    let first = stamp(&kernel, owner, &project, command, params.clone()).await;
    let again = stamp(&kernel, owner, &project, command, params).await;
    assert_eq!(first, again, "the same command gets the same answer");
    assert_eq!(first.unwrap()["stamp"], 1);
    let reordered = json!({ "from": "b.txt", "to": "a.txt" });
    let reordered = stamp(&kernel, owner, &project, command, reordered).await;
    assert_eq!(reordered, again, "the same params, however ordered");
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 1, "it acted once");

    let other = json!({ "to": "c.txt", "from": "b.txt" });
    let other = stamp(&kernel, owner, &project, command, other).await;
    assert_eq!(other.unwrap_err().code, Code::Conflict, "other params");
    let person = Participant::Person(owner);
    let added = kernel.call(
        person,
        "notes.add",
        Some(project.id),
        Some(command),
        json!({ "text": "x" }),
    );
    assert_eq!(
        added.await.unwrap_err().code,
        Code::Conflict,
        "another method"
    );
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_call_keeps_no_receipt_whatever_it_changes() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let id = CommandId::new();
    for touch in 1..=2 {
        let touched = kernel.call(
            person,
            "notes.touch",
            Some(project.id),
            Some(id),
            Value::Null,
        );
        assert_eq!(touched.await, Ok(json!(touch)), "a call runs each time");
    }
    let stamped = stamp(&kernel, owner, &project, id, Value::Null).await;
    assert!(stamped.is_ok(), "the ID was never a command's");
}

#[tokio::test]
async fn a_passing_refusal_is_not_kept_and_a_final_one_is() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let refuse = |refusal| notes.stamp_refusals.lock().unwrap().push_back(refusal);

    let command = CommandId::new();
    refuse(Refusal::internal());
    let broke = stamp(&kernel, owner, &project, command, Value::Null).await;
    assert_eq!(broke.unwrap_err().code, Code::Internal);
    let again = stamp(&kernel, owner, &project, command, Value::Null).await;
    assert_eq!(again.unwrap()["stamp"], 2, "a resend goes through");

    // What may have run never runs again under its ID.
    for refusal in [
        Refusal::may_have_run("no answer in time"),
        Refusal::conflict("already there"),
    ] {
        let (command, code) = (CommandId::new(), refusal.code);
        refuse(refusal);
        for _ in 0..2 {
            let refused = stamp(&kernel, owner, &project, command, Value::Null).await;
            assert_eq!(refused.unwrap_err().code, code);
        }
    }
    assert_eq!(
        notes.stamped.load(Ordering::SeqCst),
        4,
        "a final refusal is the command's answer: it does not run again"
    );
}

#[tokio::test]
async fn a_command_sent_again_while_it_runs_waits_for_its_answer() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let command = CommandId::new();

    let held = notes.stamp_held.clone().write_owned().await;
    let first = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    notes.stamp_began.notified().await;
    let second = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!second.is_finished(), "the second waits for the first");
    drop(held);

    let (first, second) = (first.await.unwrap(), second.await.unwrap());
    assert_eq!(first, second);
    assert_eq!(first.unwrap()["stamp"], 1);
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 1, "it acted once");

    // A run that fails as it may pass: the resend that waited hears the
    // same, and runs nothing.
    let command = CommandId::new();
    notes
        .stamp_refusals
        .lock()
        .unwrap()
        .push_back(Refusal::internal());
    let held = notes.stamp_held.clone().write_owned().await;
    let first = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    notes.stamp_began.notified().await;
    let second = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    drop(held);
    let (first, second) = (first.await.unwrap(), second.await.unwrap());
    assert_eq!(first.unwrap_err().code, Code::Internal);
    assert_eq!(second.unwrap_err().code, Code::Internal);
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_command_cut_short_may_have_run_and_never_runs_again() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let command = CommandId::new();

    // The run stops where it acts, outside the store, and its caller goes.
    let held = notes.stamp_held.clone().write_owned().await;
    let cut = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    notes.stamp_began.notified().await;
    cut.abort();
    assert!(cut.await.unwrap_err().is_cancelled());
    drop(held);

    for _ in 0..2 {
        let unsure = stamp(&kernel, owner, &project, command, Value::Null).await;
        assert_eq!(unsure.unwrap_err().code, Code::MayHaveRun);
    }
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 0, "never run again");
}

#[tokio::test]
async fn a_command_begun_before_a_restart_may_have_run_for_every_resend() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let command = CommandId::new();

    // The engine stops while the command acts: its receipt says it began.
    let held = notes.stamp_held.clone().write_owned().await;
    let cut = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, command, Value::Null).await }
    });
    notes.stamp_began.notified().await;
    cut.abort();
    let _ = cut.await;
    drop(held);
    let data = root.path().join(".data");
    let_go(kernel, &data, &[]).await;

    // Two resends at once, as two clients after the restart: neither runs.
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let resend = || stamp(&kernel, owner, &project, command, Value::Null);
    let (one, two) = tokio::join!(resend(), resend());
    for unsure in [one, two, resend().await] {
        assert_eq!(unsure.unwrap_err().code, Code::MayHaveRun);
    }
    assert_eq!(notes.stamped.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_command_whose_change_was_written_never_writes_it_again() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let post = |command| {
        kernel.call(
            person,
            "notes.post",
            Some(project.id),
            Some(command),
            json!({}),
        )
    };
    let count = || async {
        let listed = kernel.call(person, "notes.list", Some(project.id), None, Value::Null);
        listed.await.unwrap()["items"].as_array().unwrap().len()
    };

    let command = CommandId::new();
    let posted = post(command).await;
    assert_eq!(posted, Ok(json!("posted")));
    assert_eq!(
        post(command).await,
        posted,
        "the handler's answer, not its change's"
    );

    // It fails after its change, as a failure that may pass: a resend
    // hears that it ran, and writes nothing.
    let command = CommandId::new();
    notes
        .stamp_refusals
        .lock()
        .unwrap()
        .push_back(Refusal::internal());
    assert_eq!(post(command).await.unwrap_err().code, Code::Internal);
    for _ in 0..2 {
        assert_eq!(post(command).await.unwrap_err().code, Code::MayHaveRun);
    }
    assert_eq!(count().await, 2);
}

#[tokio::test]
async fn a_passing_refusal_kept_before_adr_0082_is_no_answer() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let data = root.path().join(".data");
    let_go(kernel, &data, &[]).await;

    // Receipts as the kernel kept them before, just now: every refusal, no
    // params.
    let database =
        rusqlite::Connection::open(data.join(format!("projects/{}/project.sqlite3", project.id)))
            .unwrap();
    let (broke, refused) = (CommandId::new(), CommandId::new());
    for (command, code) in [(broke, "internal"), (refused, "forbidden")] {
        let refusal = json!({ "code": code, "message": "kept before" }).to_string();
        database
            .execute(
                "INSERT INTO kernel_receipts (command, module, method, author_kind, author_id, refusal, at)
                 VALUES (?1, 'notes', 'notes.stamp', 'person', ?2, ?3, ?4)",
                rusqlite::params![command.to_string(), owner.to_string(), refusal, now_ms()],
            )
            .unwrap();
    }
    drop(database);

    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let ran = stamp(&kernel, owner, &project, broke, json!({ "any": 1 })).await;
    assert_eq!(ran.unwrap()["stamp"], 1);
    let kept = stamp(&kernel, owner, &project, refused, json!({ "any": 2 })).await;
    assert_eq!(kept.unwrap_err().code, Code::Forbidden);
}

#[tokio::test]
async fn a_command_s_answer_carries_its_place_in_the_log() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let (command, text) = (CommandId::new(), json!({ "text": "one" }));

    let add = || {
        kernel.answer(
            person,
            "notes.add",
            Some(project.id),
            Some(command),
            text.clone(),
        )
    };
    let added = add().await.unwrap();
    assert_eq!(added.at, added.value["seq"].as_i64(), "where its event is");
    assert_eq!(add().await.unwrap(), added, "a resend, the same place");

    let stamped = kernel.answer(
        person,
        "notes.stamp",
        Some(project.id),
        Some(CommandId::new()),
        Value::Null,
    );
    assert_eq!(
        stamped.await.unwrap().at,
        added.at,
        "one that wrote no event: where the log stood as it ended"
    );
    let listed = kernel.answer(person, "notes.list", Some(project.id), None, Value::Null);
    assert_eq!(listed.await.unwrap().at, None, "a call has no place");
}

#[tokio::test]
async fn effects_with_one_key_run_in_order_even_across_a_retry() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    notes
        .script
        .lock()
        .unwrap()
        .push_back(Outcome::Retry("not yet".into()));
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);

    add(&kernel, person, &project, "a").await.unwrap();
    add(&kernel, person, &project, "b").await.unwrap();
    eventually(|| async { notes.published.lock().unwrap().len() == 2 }).await;
    assert_eq!(*notes.published.lock().unwrap(), vec!["a", "b"]);
}

#[tokio::test]
async fn an_effect_that_fails_is_settled_by_its_module() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    notes
        .script
        .lock()
        .unwrap()
        .push_back(Outcome::Fail("the feed is gone".into()));
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;

    add(&kernel, Participant::Person(owner), &project, "a")
        .await
        .unwrap();
    eventually(|| async { kinds(&kernel, &project).await == ["added", "lost"] }).await;
    assert_eq!(
        lost_how(&kernel, &project).await,
        "failed: the feed is gone"
    );
}

/// A disk that failed a write once, as SQLite says it.
fn disk_failed() -> Error {
    Error::Database(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_IOERR),
        Some("disk I/O error".into()),
    ))
}

/// `publish` ends done, writing a `noted` event, after `failures` tries of
/// that write fail.
fn noted_after(failures: usize, author: Participant) -> Outcome {
    let tried = Arc::new(Mutex::new(0));
    Outcome::done_writing(move |tx| {
        let mut tried = tried.lock().unwrap();
        *tried += 1;
        if *tried <= failures {
            return Err(disk_failed());
        }
        tx.emit("noted", 1, Some("feed"), author, &json!({}))?;
        Ok(())
    })
}

#[tokio::test]
async fn an_end_whose_write_fails_once_is_written_and_its_key_goes_on() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let notes = Notes::default();
    notes
        .script
        .lock()
        .unwrap()
        .push_back(noted_after(1, person));
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;

    add(&kernel, person, &project, "a").await.unwrap();
    add(&kernel, person, &project, "b").await.unwrap();
    // The next effect of the feed waited for the first one's end.
    eventually(|| async { *notes.published.lock().unwrap() == ["b"] }).await;
    let mut kinds = kinds(&kernel, &project).await;
    kinds.sort();
    assert_eq!(kinds, ["added", "added", "noted"]);
}

#[tokio::test]
async fn an_end_whose_write_keeps_failing_is_settled_as_failed() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let notes = Notes::default();
    notes
        .script
        .lock()
        .unwrap()
        .push_back(noted_after(usize::MAX, person));
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;

    add(&kernel, person, &project, "a").await.unwrap();
    eventually(|| async { kinds(&kernel, &project).await == ["added", "lost"] }).await;
    assert_eq!(
        lost_how(&kernel, &project).await,
        "failed: Banda could not write how it ended."
    );
}

#[tokio::test]
async fn an_effect_that_panics_is_settled_as_failed() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let notes = Notes::default();
    notes.panics.store(true, Ordering::SeqCst);
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;

    add(&kernel, person, &project, "a").await.unwrap();
    add(&kernel, person, &project, "b").await.unwrap();
    eventually(|| async { *notes.published.lock().unwrap() == ["b"] }).await;
    assert_eq!(
        lost_how(&kernel, &project).await,
        "failed: The engine broke off while it ran this."
    );
}

#[tokio::test]
async fn a_restart_replays_or_abandons_what_it_cut_short() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    drop(kernel);
    tokio::time::sleep(Duration::from_millis(50)).await;

    // An earlier run claimed two effects and then the engine stopped.
    let author = serde_json::to_string(&Participant::Person(owner)).unwrap();
    let database = rusqlite::Connection::open(
        root.path()
            .join(format!(".data/projects/{}/project.sqlite3", project.id)),
    )
    .unwrap();
    for (kind, key, text, attempts) in [
        ("publish", "a", "replayed", "0"),
        ("notify", "b", "abandoned", "0"),
        ("publish", "c", "worn out", "4"),
    ] {
        database
            .execute(
                "INSERT INTO kernel_outbox (module, kind, key, payload, state, boot, attempts, next_at, created_at)
                 VALUES ('notes', ?1, ?2, ?3, 'running', 'an-earlier-boot', ?4, 0, 0)",
                [
                    kind,
                    key,
                    &format!(r#"{{"text":"{text}","author":{author}}}"#),
                    attempts,
                ],
            )
            .unwrap();
    }
    drop(database);

    let kernel = open(root.path(), owner, &notes).await;
    eventually(|| async { *notes.published.lock().unwrap() == ["replayed"] }).await;
    let project = kernel.project(project.id).await.unwrap();
    let lost: Vec<Value> = project
        .events_after(0, Default::default(), 10)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.payload["how"].clone())
        .collect();
    assert_eq!(
        lost,
        [
            json!("abandoned"),
            json!("failed: Restarts cut it short too many times.")
        ]
    );
}

async fn open_posts(root: &Path, owner: PersonId, posts: &Posts) -> Arc<Kernel> {
    Kernel::builder(root, root.join(".data"), owner)
        .module(posts.clone())
        .open()
        .await
        .unwrap()
}

/// Queues a `kind` of effect for a worker, as the owner.
async fn post(kernel: &Kernel, owner: PersonId, project: &ProjectSummary, kind: &str, text: &str) {
    let (owner, params) = (
        Participant::Person(owner),
        json!({ "kind": kind, "text": text }),
    );
    (kernel.call(
        owner,
        "posts.post",
        Some(project.id),
        Some(CommandId::new()),
        params,
    ))
    .await
    .unwrap();
}

/// Where a worker of `posts` reaches the Project it opened in last.
fn worker_of(posts: &Posts) -> ModuleProject {
    posts.projects.lock().unwrap().last().unwrap().clone()
}

/// The lease `worker` takes of one of `kinds`, for a minute, once one is
/// ready: within five seconds.
async fn leased(project: &ModuleProject, worker: &str, kinds: &[&str]) -> Lease {
    leased_for(project, worker, kinds, Duration::from_secs(60)).await
}

async fn leased_for(
    project: &ModuleProject,
    worker: &str,
    kinds: &[&str],
    term: Duration,
) -> Lease {
    for _ in 0..500 {
        if let Some(lease) = project.lease(worker, kinds, term).await.unwrap() {
            return lease;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("nothing was ready to lease");
}

/// Done, with a `posted` event that says `by` whom.
fn posted(by: &'static str, author: Participant) -> Outcome {
    Outcome::done_writing(move |tx| {
        tx.emit("posted", 1, Some("feed"), author, &json!({ "by": by }))?;
        Ok(())
    })
}

/// Who posted, as the `posted` events say.
async fn posted_by(kernel: &Kernel, project: &ProjectSummary) -> Vec<Value> {
    let project = kernel.project(project.id).await.unwrap();
    let events = project
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    let posted = events.into_iter().filter(|e| e.kind == "posted");
    posted.map(|e| e.payload["by"].clone()).collect()
}

#[tokio::test]
async fn a_worker_outside_the_engine_runs_an_effect_under_a_lease_and_settles_it_once() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    post(&kernel, owner, &project, "post", "a").await;
    post(&kernel, owner, &project, "post", "b").await;
    let worker = worker_of(&posts);
    let minute = Duration::from_secs(60);

    let lease = worker.lease("w1", &["post"], minute).await.unwrap();
    let lease = lease.expect("the engine left it for a worker");
    assert_eq!(
        (lease.effect.payload["text"].clone(), lease.effect.attempts),
        (json!("a"), 0)
    );
    // One effect of a key runs at a time, in order.
    assert!(
        worker
            .lease("w2", &["post"], minute)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        worker
            .lease("w2", &["ping"], minute)
            .await
            .unwrap()
            .is_none()
    );

    worker.renew(lease.claim, minute).await.unwrap();
    // What its module writes for the worker checks the claim, which holds.
    let claim = lease.claim;
    let noted = worker.write(move |tx| tx.holds(claim)).await;
    assert!(noted.is_ok(), "{noted:?}");
    worker.finish(claim, posted("w1", person)).await.unwrap();
    // It settled once: the same claim again is refused, and writes nothing.
    let again = worker.finish(claim, posted("w1 again", person)).await;
    assert_eq!(again.unwrap_err().code, Code::Conflict);
    assert_eq!(
        worker.renew(claim, minute).await.unwrap_err().code,
        Code::Conflict
    );
    assert_eq!(posted_by(&kernel, &project).await, [json!("w1")]);

    let next = worker.lease("w2", &["post"], minute).await.unwrap();
    assert_eq!(next.expect("b is next").effect.payload["text"], "b");
    assert!(posts.ran.lock().unwrap().is_empty(), "the engine ran none");
}

#[tokio::test]
async fn a_lease_that_runs_out_is_taken_again_and_its_late_worker_writes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let worker = worker_of(&posts);
    let (minute, short) = (Duration::from_secs(60), Duration::from_millis(50));

    post(&kernel, owner, &project, "post", "a").await;
    let late = worker.lease("w1", &["post"], short).await.unwrap().unwrap();
    // w1 stops renewing: its run is cut short, as a restart cuts the
    // engine's, and the effect is taken again under a newer claim.
    let taken = leased(&worker, "w2", &["post"]).await;
    assert_eq!(taken.effect.id, late.effect.id);
    assert!(taken.claim.token > late.claim.token);
    assert_eq!(taken.effect.attempts, 1, "a run cut short counts as a try");

    // However late it comes, w1 is refused at every step.
    let (renewed, wrote, finished) = (
        worker.renew(late.claim, minute).await,
        worker.write(move |tx| tx.holds(late.claim)).await,
        worker.finish(late.claim, posted("w1", person)).await,
    );
    assert_eq!(renewed.unwrap_err().code, Code::Conflict);
    assert!(matches!(wrote, Err(Error::Refused(r)) if r.code == Code::Conflict));
    assert_eq!(finished.unwrap_err().code, Code::Conflict);
    worker
        .finish(taken.claim, posted("w2", person))
        .await
        .unwrap();
    assert_eq!(posted_by(&kernel, &project).await, [json!("w2")]);

    // A kind that dies with its worker is abandoned instead, and its module
    // says so.
    post(&kernel, owner, &project, "notify", "b").await;
    let gone = worker
        .lease("w1", &["notify"], short)
        .await
        .unwrap()
        .unwrap();
    eventually(|| async { kinds(&kernel, &project).await.contains(&"lost".to_owned()) }).await;
    assert_eq!(lost_how(&kernel, &project).await, "abandoned");
    let finished = worker.finish(gone.claim, Outcome::Done).await;
    assert_eq!(finished.unwrap_err().code, Code::Conflict);
}

#[tokio::test]
async fn a_lease_outlives_a_restart_of_the_engine_until_its_term_runs_out() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join(".data");
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let minute = Duration::from_secs(60);
    post(&kernel, owner, &project, "post", "a").await;
    let held = worker_of(&posts).lease("w1", &["post"], minute).await;
    let held = held.unwrap().unwrap();

    // The engine stops and starts again while its worker runs on.
    posts.projects.lock().unwrap().clear();
    let_go(kernel, &data, &[]).await;
    let kernel = open_posts(root.path(), owner, &posts).await;
    let worker = worker_of(&posts);
    // A restart cut nothing short: the worker's claim holds on the new boot.
    assert!(
        worker
            .lease("w2", &["post"], minute)
            .await
            .unwrap()
            .is_none()
    );
    worker.renew(held.claim, minute).await.unwrap();
    worker
        .finish(held.claim, posted("w1", person))
        .await
        .unwrap();
    assert_eq!(posted_by(&kernel, &project).await, [json!("w1")]);

    // A worker that went with the engine lets its fresh term run out.
    post(&kernel, owner, &project, "post", "b").await;
    let short = Duration::from_millis(100);
    let gone = worker.lease("w1", &["post"], short).await.unwrap().unwrap();
    drop(worker);
    posts.projects.lock().unwrap().clear();
    let_go(kernel, &data, &[]).await;
    let kernel = open_posts(root.path(), owner, &posts).await;
    let taken = leased(&worker_of(&posts), "w2", &["post"]).await;
    assert_eq!(
        (taken.effect.id, taken.effect.attempts),
        (gone.effect.id, 1)
    );
    drop(kernel);
}

#[tokio::test]
async fn an_effect_retries_as_its_kind_says() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let worker = worker_of(&posts);

    // Work on this host gives up after its tries.
    post(&kernel, owner, &project, "ping", "p").await;
    for tried in 0..3 {
        let lease = leased(&worker, "w", &["ping"]).await;
        assert_eq!(lease.effect.attempts, tried);
        let offline = Outcome::Retry("offline".into());
        worker.finish(lease.claim, offline).await.unwrap();
    }
    assert_eq!(lost_how(&kernel, &project).await, "failed: offline");

    // Work over the network goes on past five tries, until its deadline.
    post(&kernel, owner, &project, "post", "q").await;
    for tried in 0..8 {
        let lease = leased(&worker, "w", &["post"]).await;
        assert_eq!(lease.effect.attempts, tried);
        let offline = Outcome::Retry("offline".into());
        worker.finish(lease.claim, offline).await.unwrap();
    }
    let lease = leased(&worker, "w", &["post"]).await;
    worker
        .finish(lease.claim, posted("w", person))
        .await
        .unwrap();
    assert_eq!(posted_by(&kernel, &project).await, [json!("w")]);
}

/// Stops the engine and starts it again, while its workers run on.
async fn restart_posts(
    kernel: Arc<Kernel>,
    root: &Path,
    owner: PersonId,
    posts: &Posts,
) -> Arc<Kernel> {
    posts.projects.lock().unwrap().clear();
    let_go(kernel, &root.join(".data"), &[]).await;
    open_posts(root, owner, posts).await
}

#[tokio::test]
async fn a_lease_its_worker_does_not_renew_outlives_one_restart_only() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let minute = Duration::from_secs(60);
    post(&kernel, owner, &project, "post", "a").await;
    let held = leased(&worker_of(&posts), "w1", &["post"]).await;
    let holds = async |posts: &Posts| {
        let claim = held.claim;
        worker_of(posts)
            .write(move |tx| tx.holds(claim))
            .await
            .is_ok()
    };

    // A worker that renews on each run of the engine keeps its lease
    // through every restart.
    let kernel = restart_posts(kernel, root.path(), owner, &posts).await;
    assert!(holds(&posts).await);
    worker_of(&posts).renew(held.claim, minute).await.unwrap();
    let kernel = restart_posts(kernel, root.path(), owner, &posts).await;
    assert!(holds(&posts).await);

    // One that renews no more is cut short as the engine starts again,
    // however short its runs: its effect waits on no gone worker.
    let kernel = restart_posts(kernel, root.path(), owner, &posts).await;
    assert!(!holds(&posts).await);
    let taken = leased(&worker_of(&posts), "w2", &["post"]).await;
    assert_eq!(
        (taken.effect.id, taken.effect.attempts),
        (held.effect.id, 1)
    );
    let renewed = worker_of(&posts).renew(held.claim, minute).await;
    assert_eq!(renewed.unwrap_err().code, Code::Conflict);
    drop(kernel);
}

#[tokio::test]
async fn a_lease_that_cannot_be_cut_short_holds_up_only_its_own_key() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    post(&kernel, owner, &project, "notify", "stuck").await;
    let short = Duration::from_millis(20);
    let stuck = leased_for(&worker_of(&posts), "w1", &["notify"], short).await;
    tokio::time::sleep(Duration::from_millis(60)).await;

    // Its module cannot write that it was abandoned, and the engine still
    // runs the effects of other keys.
    let (person, params) = (
        Participant::Person(owner),
        json!({ "kind": "ping", "text": "p", "engine": true }),
    );
    (kernel.call(
        person,
        "posts.post",
        Some(project.id),
        Some(CommandId::new()),
        params,
    ))
    .await
    .unwrap();
    eventually(|| async { posts.ran.lock().unwrap().contains(&"ping".to_owned()) }).await;
    let claim = stuck.claim;
    let held = worker_of(&posts).write(move |tx| tx.holds(claim)).await;
    assert!(held.is_ok(), "it waits to be cut short: {held:?}");
}

#[tokio::test]
async fn an_effect_whose_worker_keeps_going_fails_before_its_deadline() {
    let root = tempfile::tempdir().unwrap();
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    let worker = worker_of(&posts);
    let short = Duration::from_millis(20);

    // A post tries for an hour, but a run cut short counts up to five
    // times: a post that takes its worker down with it does not replay
    // all that hour.
    post(&kernel, owner, &project, "post", "a").await;
    for cut in 0..5 {
        let lease = leased_for(&worker, "w", &["post"], short).await;
        assert_eq!(lease.effect.attempts, cut);
    }
    eventually(|| async { kinds(&kernel, &project).await.contains(&"lost".to_owned()) }).await;
    assert_eq!(
        lost_how(&kernel, &project).await,
        "failed: Its worker stopped renewing its lease too many times."
    );
}

#[tokio::test]
async fn work_over_the_network_tries_five_times_more_past_its_deadline() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join(".data");
    let (owner, posts) = (PersonId::new(), Posts::default());
    let kernel = open_posts(root.path(), owner, &posts).await;
    let project = create(&kernel, owner, "Work").await;
    post(&kernel, owner, &project, "post", "a").await;
    posts.projects.lock().unwrap().clear();
    let_go(kernel, &data, &[]).await;

    // It tried ten times in its hour, then the host slept all night.
    let night = now_ms() - 10 * 3_600_000;
    (sqlite(&data, &project).execute(
        "UPDATE kernel_outbox SET attempts = 10, created_at = ?1",
        rusqlite::params![night],
    ))
    .unwrap();
    let kernel = open_posts(root.path(), owner, &posts).await;
    let worker = worker_of(&posts);
    for tried in 10..15 {
        let lease = leased(&worker, "w", &["post"]).await;
        assert_eq!(lease.effect.attempts, tried, "it tries as it wakes");
        let offline = Outcome::Retry("offline".into());
        worker.finish(lease.claim, offline).await.unwrap();
    }
    assert_eq!(lost_how(&kernel, &project).await, "failed: offline");
}

/// The Project's SQLite, opened beside the engine's.
fn sqlite(data: &Path, project: &ProjectSummary) -> rusqlite::Connection {
    let path = data.join(format!("projects/{}/project.sqlite3", project.id));
    rusqlite::Connection::open(path).unwrap()
}

#[tokio::test]
async fn receipts_and_settled_effects_go_after_thirty_days_and_not_before() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join(".data");
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let (old, recent) = (CommandId::new(), CommandId::new());
    let add = async |kernel: &Kernel, command: CommandId, text: &str| {
        let params = json!({ "text": text });
        (kernel.call(person, "notes.add", Some(project.id), Some(command), params)).await
    };
    add(&kernel, old, "old").await.unwrap();
    let first = add(&kernel, recent, "recent").await.unwrap();
    eventually(|| async { notes.published.lock().unwrap().len() == 2 }).await;
    let_go(kernel, &data, &[]).await;

    // Days go by.
    let (now, day) = (now_ms(), 86_400_000_i64);
    let author = serde_json::to_string(&person).unwrap();
    let database = sqlite(&data, &project);
    for (age, command, text) in [(31, old, "old"), (29, recent, "recent")] {
        let at = now - age * day;
        let (command, text) = (command.to_string(), format!("%\"{text}\"%"));
        database
            .execute(
                "UPDATE kernel_receipts SET at = ?1 WHERE command = ?2",
                rusqlite::params![at, command],
            )
            .unwrap();
        database
            .execute(
                "UPDATE kernel_outbox SET settled_at = ?1 WHERE payload LIKE ?2",
                rusqlite::params![at, text],
            )
            .unwrap();
    }
    // An effect not yet run stays, however old: this one is due tomorrow.
    database
        .execute(
            "INSERT INTO kernel_outbox (module, kind, key, payload, state, next_at, created_at)
             VALUES ('notes', 'publish', 'later', ?1, 'pending', ?2, ?3)",
            rusqlite::params![
                format!(r#"{{"text":"later","author":{author}}}"#),
                now + day,
                now - 40 * day
            ],
        )
        .unwrap();
    drop(database);

    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let receipts = || {
        let database = sqlite(&data, &project);
        let mut statement = database
            .prepare("SELECT command FROM kernel_receipts ORDER BY at")
            .unwrap();
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    };
    eventually(|| async { !receipts().contains(&old.to_string()) }).await;
    assert!(receipts().contains(&recent.to_string()));
    let effects = || {
        let database = sqlite(&data, &project);
        let mut statement = database
            .prepare("SELECT json_extract(payload, '$.text'), state FROM kernel_outbox ORDER BY id")
            .unwrap();
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    };
    let left = [
        ("recent".to_owned(), "done".to_owned()),
        ("later".to_owned(), "pending".to_owned()),
    ];
    // The settled effects go in batches of their own, after the receipts.
    eventually(|| async { effects() == left }).await;

    // Within thirty days a command sent again gets its first answer and
    // runs nothing; past them, it is a new command.
    assert_eq!(add(&kernel, recent, "recent").await.unwrap(), first);
    add(&kernel, old, "old").await.unwrap();
    let listed = kernel
        .call(person, "notes.list", Some(project.id), None, Value::Null)
        .await
        .unwrap();
    assert_eq!(listed["items"], json!(["old", "recent", "old"]));
}

/// Sets `command`'s receipt as last written `days` ago, with the engine
/// stopped.
fn age(data: &Path, project: &ProjectSummary, command: CommandId, days: i64) {
    let at = now_ms() - days * 86_400_000;
    let aged = sqlite(data, project).execute(
        "UPDATE kernel_receipts SET at = ?1 WHERE command = ?2",
        rusqlite::params![at, command.to_string()],
    );
    assert_eq!(aged.unwrap(), 1, "{command} has a receipt");
}

fn has_receipt(data: &Path, project: &ProjectSummary, command: CommandId) -> bool {
    let kept = sqlite(data, project).query_row(
        "SELECT COUNT(*) FROM kernel_receipts WHERE command = ?1",
        [command.to_string()],
        |row| row.get::<_, i64>(0),
    );
    kept.unwrap() == 1
}

#[tokio::test]
async fn a_command_cut_short_may_have_run_for_every_resend_its_window_lets_come() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join(".data");
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let notes = Notes::default();
    let mut kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let cut = CommandId::new();

    // The engine stops while `stamp` acts, outside the store.
    let held = notes.stamp_held.clone().write_owned().await;
    let stamping = tokio::spawn({
        let (kernel, project) = (kernel.clone(), project.clone());
        async move { stamp(&kernel, owner, &project, cut, Value::Null).await }
    });
    notes.stamp_began.notified().await;
    stamping.abort();
    let _ = stamping.await;
    drop(held);

    // Its first resend comes as its window ends, seven days after it was
    // sent; the next as that one's answer is 29 days old. Each comes once
    // the Project's loop has let go of an older receipt: never this one.
    for days in [7, 29] {
        let older = CommandId::new();
        let params = json!({ "text": "older" });
        let added = kernel.call(person, "notes.add", Some(project.id), Some(older), params);
        added.await.unwrap();
        let_go(kernel, &data, &[]).await;
        age(&data, &project, cut, days);
        age(&data, &project, older, 31);

        kernel = reopen(root.path(), owner, &notes, 1).await;
        eventually(|| async { !has_receipt(&data, &project, older) }).await;
        let unsure = stamp(&kernel, owner, &project, cut, Value::Null).await;
        assert_eq!(unsure.unwrap_err().code, Code::MayHaveRun, "{days} days");
        assert_eq!(notes.stamped.load(Ordering::SeqCst), 0, "never run again");
    }

    // Thirty days past its last answer, long past its window, it goes, and
    // the same ID runs as a new command.
    let_go(kernel, &data, &[]).await;
    age(&data, &project, cut, 31);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    eventually(|| async { !has_receipt(&data, &project, cut) }).await;
    let stamped = stamp(&kernel, owner, &project, cut, Value::Null).await;
    assert_eq!(stamped.unwrap()["stamp"], 1);
}

#[tokio::test]
async fn an_agent_works_in_the_project_but_may_not_manage_it() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let agent = Participant::Agent(AgentId::new());

    add(&kernel, agent, &project, "by an agent").await.unwrap();
    let purge = kernel
        .call(
            agent,
            "notes.purge",
            Some(project.id),
            Some(CommandId::new()),
            Value::Null,
        )
        .await;
    assert_eq!(purge.unwrap_err().code, Code::Forbidden);
    let create = create_project(&kernel, agent, CommandId::new(), "Mine").await;
    assert_eq!(create.unwrap_err().code, Code::Forbidden);
    let stranger = add(
        &kernel,
        Participant::Person(PersonId::new()),
        &project,
        "no",
    )
    .await;
    assert_eq!(stranger.unwrap_err().code, Code::Forbidden);
    let unknown = kernel
        .call(
            Participant::Person(owner),
            "nobody.add",
            Some(project.id),
            None,
            Value::Null,
        )
        .await;
    assert_eq!(unknown.unwrap_err().code, Code::Invalid);
}

/// Tokens for the owner, an Agent and a Person who is not the owner.
struct Tokens {
    owner: PersonId,
}

impl Identity for Tokens {
    fn identify(&self, token: &str) -> Option<Participant> {
        match token {
            "secret" => Some(Participant::Person(self.owner)),
            "stranger" => Some(Participant::Person(PersonId::new())),
            _ => None,
        }
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Serves the kernel's API on a free port of this machine.
async fn serve(kernel: &Arc<Kernel>, owner: PersonId) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = banda_kernel::api::router(kernel.clone(), Tokens { owner }, "test");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    address
}

async fn connect(address: std::net::SocketAddr, hello: Value) -> (Socket, Value) {
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
        .await
        .unwrap();
    socket.send(Message::text(hello.to_string())).await.unwrap();
    let answer = next(&mut socket).await;
    (socket, answer)
}

async fn next(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("a frame in time")
            .expect("an open socket")
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

#[tokio::test]
async fn the_api_refuses_strangers_and_follows_events_without_gaps() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    add(&kernel, Participant::Person(owner), &project, "before")
        .await
        .unwrap();

    let address = serve(&kernel, owner).await;

    let (_, refused) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "guess" }),
    )
    .await;
    assert_eq!(refused["type"], "goodbye");
    assert_eq!(refused["reason"]["code"], "forbidden");
    let (_, old) = connect(
        address,
        json!({ "type": "hello", "protocol": 0, "token": "secret" }),
    )
    .await;
    assert_eq!(old["reason"]["code"], "protocol");

    let (mut socket, welcome) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "secret", "later": "ignored" }),
    )
    .await;
    assert_eq!(welcome["type"], "welcome");
    assert_eq!(welcome["modules"], json!(["notes"]));

    let (mut stranger, _) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "stranger" }),
    )
    .await;
    let peek = json!({ "type": "subscribe", "id": 1, "project": project.id, "after": 0 });
    stranger
        .send(Message::text(peek.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut stranger).await["error"]["code"], "forbidden");

    let list = json!({ "type": "call", "id": 1, "method": "notes.list", "project": project.id });
    socket.send(Message::text(list.to_string())).await.unwrap();
    let view = next(&mut socket).await;
    assert_eq!(view["ok"]["items"], json!(["before"]));
    let at = view["ok"]["at"].as_i64().unwrap();

    let follow = json!({ "type": "subscribe", "id": 2, "project": project.id, "after": at, "filter": { "module": "notes" } });
    socket
        .send(Message::text(follow.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["ok"]["subscription"], 2);

    let command = CommandId::new();
    let send = json!({
        "type": "call", "id": 3, "method": "notes.add", "project": project.id,
        "command": command, "params": { "text": "after" }
    });
    socket.send(Message::text(send.to_string())).await.unwrap();
    let mut frames = [next(&mut socket).await, next(&mut socket).await];
    frames.sort_by_key(|f| f["type"].as_str().unwrap_or_default().to_owned());
    assert_eq!(frames[0]["type"], "event");
    assert_eq!(frames[0]["event"]["payload"]["text"], "after");
    assert_eq!(
        frames[0]["event"]["seq"],
        at + 1,
        "no event before the view's position, no gap after it"
    );
    assert_eq!(frames[1]["type"], "result");
    assert_eq!(
        frames[1]["at"],
        at + 1,
        "a command's answer carries its place in the log"
    );
    assert!(view.get("at").is_none(), "a call's answer has none");

    socket
        .send(Message::text(r#"{"type":"call","id":4}"#))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["error"]["code"], "invalid");
}

#[tokio::test]
async fn a_stream_says_its_pieces_then_that_it_ended() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let address = serve(&kernel, owner).await;

    let count = |id: u64| json!({ "type": "stream", "id": id, "project": project.id, "method": "notes.count", "params": { "to": 3 } });
    let (mut stranger, _) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "stranger" }),
    )
    .await;
    stranger
        .send(Message::text(count(1).to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut stranger).await["error"]["code"], "forbidden");

    let (mut socket, _) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "secret" }),
    )
    .await;
    socket
        .send(Message::text(count(7).to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["ok"]["stream"], 7);
    for n in 1..=3 {
        let piece = next(&mut socket).await;
        assert_eq!(piece["type"], "piece");
        assert_eq!(piece["stream"], 7);
        assert_eq!(piece["data"]["n"], n);
    }
    let ended = next(&mut socket).await;
    assert_eq!(ended, json!({ "type": "ended", "stream": 7 }));

    let unknown =
        json!({ "type": "stream", "id": 8, "project": project.id, "method": "notes.nothing" });
    socket
        .send(Message::text(unknown.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["error"]["code"], "invalid");
}

#[tokio::test]
async fn a_subscription_replays_a_long_log_a_page_at_a_time() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    const MANY: usize = 1200;
    for n in 0..MANY {
        add(&kernel, person, &project, &n.to_string())
            .await
            .unwrap();
    }

    let address = serve(&kernel, owner).await;
    let (mut socket, _) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "secret" }),
    )
    .await;
    let follow = json!({ "type": "subscribe", "id": 1, "project": project.id, "after": 0, "filter": { "module": "notes" } });
    socket
        .send(Message::text(follow.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["type"], "result");
    let mut seq = 0;
    for n in 0..MANY {
        let frame = next(&mut socket).await;
        assert_eq!(frame["type"], "event", "event {n}");
        assert_eq!(frame["event"]["payload"]["text"], n.to_string());
        let now = frame["event"]["seq"].as_i64().unwrap();
        assert!(now > seq, "in order, none twice");
        seq = now;
    }
    add(&kernel, person, &project, "live").await.unwrap();
    assert_eq!(next(&mut socket).await["event"]["payload"]["text"], "live");
}

#[tokio::test]
async fn a_pass_connects_as_its_agent_and_only_in_its_project() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let (work, other) = (
        create(&kernel, owner, "Work").await,
        create(&kernel, owner, "Other").await,
    );
    let agent = AgentId::new();
    let person = Participant::Person(owner);
    let ask = json!({ "agent": agent });
    let pass = kernel
        .call(person, "notes.pass", Some(work.id), None, ask)
        .await
        .unwrap();
    let address = serve(&kernel, owner).await;

    let (mut socket, welcome) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": pass }),
    )
    .await;
    assert_eq!(welcome["type"], "welcome");
    let mut ask = async |frame: Value| {
        socket.send(Message::text(frame.to_string())).await.unwrap();
        next(&mut socket).await
    };
    let add = json!({
        "type": "call", "id": 1, "method": "notes.add", "project": work.id,
        "command": CommandId::new(), "params": { "text": "by its agent" }
    });
    assert!(ask(add).await["ok"]["seq"].is_number());
    let project = kernel.project(work.id).await.unwrap();
    let added = project
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    assert_eq!(added.last().unwrap().author, Participant::Agent(agent));

    let wall = "An Agent works only in its own Project.";
    let elsewhere = [
        json!({ "type": "call", "id": 2, "method": "notes.list", "project": other.id }),
        json!({ "type": "subscribe", "id": 3, "project": other.id, "after": 0 }),
        json!({ "type": "stream", "id": 4, "project": other.id, "method": "notes.count" }),
    ];
    for frame in elsewhere {
        let refused = ask(frame.clone()).await;
        assert_eq!(refused["error"]["code"], "forbidden", "{frame}");
        assert_eq!(refused["error"]["message"], wall, "{frame}");
    }
    // A call that names no Project is in its own.
    let list = ask(json!({ "type": "call", "id": 5, "method": "notes.list" })).await;
    assert_eq!(list["ok"]["items"], json!(["by its agent"]));
    let mine = ask(json!({ "type": "call", "id": 6, "method": "projects.list" })).await;
    assert_eq!(mine["ok"], json!([work]), "it sees only its own Project");
    let purge = json!({ "type": "call", "id": 7, "method": "notes.purge", "project": work.id, "command": CommandId::new() });
    assert_eq!(
        ask(purge).await["error"]["code"],
        "forbidden",
        "nor may it manage it"
    );
}

#[tokio::test]
async fn a_pass_outlives_a_restart_until_its_session_ends_or_it_expires() {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let term = Duration::from_secs(2);
    let open = |notes: &Notes| {
        Kernel::builder(dir.path().join("root"), dir.path().join("data"), owner)
            .module(notes.clone())
            .passes(dir.path().join("state").join("passes.sqlite3"))
            .pass_term(term)
            .open()
    };
    let notes = Notes::default();
    let kernel = open(&notes).await.unwrap();
    let work = create(&kernel, owner, "Work").await;
    let agent = AgentId::new();
    let issue = async |kernel: &Kernel| {
        let ask = json!({ "agent": agent });
        let pass = kernel.call(person, "notes.pass", Some(work.id), None, ask);
        pass.await.unwrap().as_str().unwrap().to_owned()
    };
    let going_on = issue(&kernel).await;
    let ended = issue(&kernel).await;
    // The second session ends: its pass is revoked as it lets go of it.
    drop(notes.passes.lock().unwrap().remove(1));
    assert_eq!(kernel.holder(&going_on), Some((agent, work.id)));
    assert_eq!(kernel.holder(&ended), None);

    // The engine stops, and what held the passes goes with it: the next
    // engine takes the pass of the session that goes on, through its API
    // too, and never the one revoked.
    kernel.stopping();
    let_go(kernel, &dir.path().join("data"), &[]).await;
    notes.passes.lock().unwrap().clear();
    let kernel = open(&Notes::default()).await.unwrap();
    assert_eq!(kernel.holder(&going_on), Some((agent, work.id)));
    assert_eq!(kernel.holder(&ended), None);
    let address = serve(&kernel, owner).await;
    let hello = |token: &str| json!({ "type": "hello", "protocol": 1, "token": token });
    assert_eq!(
        connect(address, hello(&going_on)).await.1["type"],
        "welcome"
    );
    assert_eq!(connect(address, hello(&ended)).await.1["type"], "goodbye");

    // No session of this engine holds it, and a use does not renew it: a
    // term after the engine that held it stopped, it expires.
    tokio::time::sleep(term * 3 / 2).await;
    assert_eq!(kernel.holder(&going_on), None);
    assert_eq!(
        connect(address, hello(&going_on)).await.1["type"],
        "goodbye"
    );

    // A Project removed takes its passes with it, held or not.
    let held = issue(&kernel).await;
    assert!(kernel.holder(&held).is_some());
    let remove = json!({ "project": work.id });
    let removed = kernel.call(
        person,
        "projects.remove",
        None,
        Some(CommandId::new()),
        remove,
    );
    removed.await.unwrap();
    assert_eq!(kernel.holder(&held), None);
}

#[tokio::test]
async fn a_module_asks_the_window_and_only_the_owners_window_answers() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let work = create(&kernel, owner, "Work").await;
    let agent = AgentId::new();
    let person = Participant::Person(owner);
    let pass = kernel
        .call(
            person,
            "notes.pass",
            Some(work.id),
            None,
            json!({ "agent": agent }),
        )
        .await
        .unwrap();
    let address = serve(&kernel, owner).await;
    let hello = |token: &Value| json!({ "type": "hello", "protocol": 1, "token": token });
    let (mut by_agent, _) = connect(address, hello(&pass)).await;
    let (mut window, _) = connect(address, hello(&json!("secret"))).await;
    async fn say(socket: &mut Socket, frame: Value) {
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }

    let show = |id: u64| json!({ "type": "call", "id": id, "method": "notes.show", "params": { "text": "hi" } });
    say(&mut by_agent, show(1)).await;
    let refused = next(&mut by_agent).await;
    assert_eq!(refused["error"]["code"], "conflict");
    assert_eq!(refused["error"]["message"], "Banda's window is not open.");

    let requests = |id: u64| json!({ "type": "stream", "id": id, "method": "window.requests" });
    let answer = |id: u64, request: &Value| {
        json!({
            "type": "call", "id": id, "method": "window.answer",
            "params": { "request": request, "ok": { "shown": true } }
        })
    };
    say(&mut by_agent, requests(2)).await;
    assert_eq!(next(&mut by_agent).await["error"]["code"], "forbidden");
    say(&mut by_agent, answer(3, &json!(0))).await;
    assert_eq!(next(&mut by_agent).await["error"]["code"], "forbidden");

    say(&mut window, requests(1)).await;
    assert_eq!(next(&mut window).await["ok"]["stream"], 1);
    say(&mut by_agent, show(4)).await;
    let piece = next(&mut window).await;
    assert_eq!(piece["type"], "piece");
    let asked = &piece["data"];
    assert_eq!(asked["method"], "notes.show");
    assert_eq!(asked["project"], json!(work.id));
    assert_eq!(asked["by"], json!(Participant::Agent(agent)));
    assert_eq!(asked["params"], json!({ "text": "hi" }));
    say(&mut window, answer(2, &asked["id"])).await;
    assert_eq!(next(&mut window).await["ok"], Value::Null);
    let shown = next(&mut by_agent).await;
    assert_eq!(shown["id"], 4);
    assert_eq!(shown["ok"], json!({ "shown": true }));
}

#[tokio::test]
async fn a_module_of_the_machine_names_no_project_and_keeps_its_own_log() {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let open = || {
        Kernel::builder(dir.path().join("root"), dir.path().join("data"), owner)
            .module(Notes::default())
            .module(Desk)
            .machine(dir.path().join("state").join("machine"))
            .open()
    };
    let kernel = open().await.unwrap();
    let machine = kernel.machine().unwrap();
    let work = create(&kernel, owner, "Work").await;

    // Its methods name no Project, and a command runs once.
    let command = Some(CommandId::new());
    let terminal = json!({ "kind": "terminal" });
    for _ in 0..2 {
        let call = kernel.call(person, "desk.open", None, command, terminal.clone());
        call.await.unwrap();
    }
    let list = kernel.call(person, "desk.list", None, None, Value::Null);
    assert_eq!(list.await.unwrap(), json!(["terminal"]));

    // It is no Project: a Project's ID is refused to it, and its ID to a
    // Project's module, and the Projects' list leaves it out.
    let in_work = kernel.call(person, "desk.list", Some(work.id), None, Value::Null);
    assert_eq!(in_work.await.unwrap_err().code, Code::Invalid);
    let notes = kernel.call(person, "notes.list", Some(machine), None, Value::Null);
    assert_eq!(notes.await.unwrap_err().code, Code::NotFound);
    assert!(
        kernel
            .projects()
            .await
            .iter()
            .all(|project| project.id != machine)
    );

    // Its log is followed as a Project's is.
    let log = kernel.follow(person, machine).await.unwrap();
    let events = log.events_after(0, Default::default(), 100).await.unwrap();
    let kinds: Vec<_> = events.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, ["opened"]);

    // An Agent's pass is for its Project: the machine is past its wall.
    let agent = Caller {
        participant: Participant::Agent(AgentId::new()),
        only: Some(work.id),
    };
    let by_agent = kernel.call(agent, "desk.list", None, None, Value::Null);
    assert_eq!(by_agent.await.unwrap_err().code, Code::Forbidden);

    // After a restart, it is the same machine, with what it kept.
    drop(log);
    let machine_folder = dir.path().join("state").join("machine");
    let_go(kernel, &dir.path().join("data"), &[&machine_folder]).await;
    let kernel = open().await.unwrap();
    assert_eq!(kernel.machine(), Some(machine));
    let list = kernel.call(person, "desk.list", None, None, Value::Null);
    assert_eq!(list.await.unwrap(), json!(["terminal"]));
}

#[tokio::test]
async fn a_module_of_a_project_hears_the_machine_until_its_project_closes() {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let hears = Hears::default();
    let listens = Hears {
        machine: true,
        ..Hears::default()
    };
    let kernel = Kernel::builder(dir.path().join("root"), dir.path().join("data"), owner)
        .module(Desk)
        .module(hears.clone())
        .module(listens.clone())
        .machine(dir.path().join("machine"))
        .open()
        .await
        .unwrap();
    let work = create(&kernel, owner, "Work").await;
    let module = hears.projects.lock().unwrap()[0].clone();
    let machine = listens.projects.lock().unwrap()[0].clone();
    let open_pane = |kind: &str| {
        let params = json!({ "kind": kind });
        kernel.call(person, "desk.open", None, Some(CommandId::new()), params)
    };
    let short = Duration::from_millis(50);

    // A new listener hears from now on, and what it writes goes in its
    // own Project, never in the machine's log.
    open_pane("before").await.unwrap();
    let filter = EventFilter {
        module: Some("desk".into()),
        ..EventFilter::default()
    };
    let heard = module.listen_to_machine("panes", filter).await;
    let mut heard = heard.unwrap().unwrap();
    assert_eq!(heard.project().map(|own| own.id()), Some(work.id));
    open_pane("terminal").await.unwrap();
    assert!(!machine.reacted(short).await, "the machine waits for it");
    let event = heard.next().await.unwrap().unwrap();
    assert_eq!(event.payload["kind"], "terminal");
    let next = tokio::spawn(async move { heard.next().await });
    assert!(machine.reacted(Duration::from_secs(5)).await);
    let places = || -> i64 {
        let machine = rusqlite::Connection::open(dir.path().join("machine/project.sqlite3"));
        let listener = format!("hears.panes@{}", work.id);
        let count = "SELECT count(*) FROM kernel_cursors WHERE listener = ?1";
        let machine = machine.unwrap();
        machine
            .query_row(count, [listener], |row| row.get(0))
            .unwrap()
    };
    assert_eq!(places(), 1, "its place is kept in the machine's store");

    // Its Project removed and closed, it hears no more, and its place goes.
    drop(module);
    hears.projects.lock().unwrap().clear();
    let remove = json!({ "project": work.id });
    let removed = kernel.call(
        person,
        "projects.remove",
        None,
        Some(CommandId::new()),
        remove,
    );
    removed.await.unwrap();
    assert_eq!(places(), 0);
    let ended = tokio::time::timeout(Duration::from_secs(5), next).await;
    assert!(ended.unwrap().unwrap().unwrap().is_none());
    open_pane("after").await.unwrap();
    assert!(machine.reacted(short).await);

    // A module of the machine has no machine to hear but its own log.
    let own = machine
        .listen_to_machine("panes", EventFilter::default())
        .await;
    assert!(own.unwrap().is_none());
}

/// A module of the machine counts what every Project's log took, only as
/// numbers: what the usage summary is made of (ADR 0039, step 5).
#[tokio::test]
async fn a_module_of_the_machine_counts_every_projects_events() {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let (notes, hears) = (Notes::default(), Hears::default());
    let listens = Hears {
        machine: true,
        ..Hears::default()
    };
    let kernel = Kernel::builder(dir.path().join("root"), dir.path().join("data"), owner)
        .module(notes.clone())
        .module(hears.clone())
        .module(listens.clone())
        .machine(dir.path().join("machine"))
        .open()
        .await
        .unwrap();
    let machine = listens.projects.lock().unwrap()[0].clone();
    assert_eq!(machine.projects().await, Some(0));
    let (work, home) = (
        create(&kernel, owner, "Work").await,
        create(&kernel, owner, "Home").await,
    );
    let from = banda_kernel::now_ms();
    for (project, text) in [(&work, "a"), (&work, "b"), (&home, "a")] {
        add(&kernel, person, project, text).await.unwrap();
    }
    let to = banda_kernel::now_ms() + 1;
    let tally = |by: Option<&str>, from, to| banda_kernel::Tally {
        module: "notes".into(),
        kind: "added".into(),
        by: by.map(str::to_owned),
        from,
        to,
    };

    assert_eq!(machine.projects().await, Some(2));
    let all = machine.tally(tally(None, from, to)).await.unwrap().unwrap();
    assert_eq!(all, [("".to_owned(), 3)].into());
    let by = machine
        .tally(tally(Some("text"), from, to))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(by, [("a".to_owned(), 2), ("b".to_owned(), 1)].into());
    // Only what the log took in that time.
    let later = machine
        .tally(tally(None, to, to + 1000))
        .await
        .unwrap()
        .unwrap();
    assert!(later.is_empty());
    // By a plain field only.
    assert!(machine.tally(tally(Some("$.x"), from, to)).await.is_err());

    // A module of a Project counts nothing beyond its wall.
    let module = hears.projects.lock().unwrap()[0].clone();
    assert_eq!(module.projects().await, None);
    assert!(module.tally(tally(None, from, to)).await.unwrap().is_none());
}

#[tokio::test]
async fn a_module_of_the_machine_needs_the_machines_folder() {
    let dir = tempfile::tempdir().unwrap();
    let opened = Kernel::builder(dir.path(), dir.path().join(".data"), PersonId::new())
        .module(Desk)
        .open()
        .await;
    assert!(opened.is_err());
}

// A link on Windows needs Developer Mode.
#[cfg(unix)]
#[tokio::test]
async fn any_folder_is_added_as_a_project_and_one_folder_is_one_project() {
    let root = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let app = elsewhere.path().join("app");
    std::fs::create_dir(&app).unwrap();
    std::fs::write(app.join("README.md"), "work").unwrap();

    let added = add_folder(&kernel, owner, json!({ "folder": app }))
        .await
        .unwrap();
    let app = dunce::canonicalize(&app).unwrap();
    assert_eq!(added.name, "app", "a Project is named after its folder");
    assert_eq!(added.folder, app.display().to_string());
    assert!((!added.pinned) && (!added.archived));
    assert_eq!(
        std::fs::read_dir(&app).unwrap().count(),
        1,
        "the folder holds the work alone"
    );

    let link = elsewhere.path().join("link");
    std::os::unix::fs::symlink(&app, &link).unwrap();
    let again = add_folder(&kernel, owner, json!({ "folder": link, "name": "Other" })).await;
    assert_eq!(
        again,
        Ok(added.clone()),
        "the same folder is the same Project"
    );

    let gone = elsewhere.path().join("new/deeper");
    let missing = add_folder(&kernel, owner, json!({ "folder": gone })).await;
    assert_eq!(missing.unwrap_err().code, Code::NotFound);
    let made = add_folder(
        &kernel,
        owner,
        json!({ "folder": gone, "create": true, "name": "Deep" }),
    )
    .await
    .unwrap();
    assert_eq!(made.name, "Deep");
    assert!(gone.is_dir());
    let file = add_folder(&kernel, owner, json!({ "folder": app.join("README.md") })).await;
    assert_eq!(file.unwrap_err().code, Code::Invalid);
    let relative = add_folder(&kernel, owner, json!({ "folder": "code/app" })).await;
    assert_eq!(relative.unwrap_err().code, Code::Invalid);
    let unnamed = add_folder(&kernel, owner, json!({ "folder": "/", "name": " " })).await;
    assert_eq!(unnamed.unwrap_err().code, Code::Invalid);

    drop(kernel);
    let again = reopen(root.path(), owner, &notes, 2).await;
    let mut listed = again.projects().await;
    listed.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(
        listed,
        vec![made, added],
        "an added Project opens again from the data"
    );
}

#[tokio::test]
async fn a_project_is_renamed_pinned_and_archived_and_added_back() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;

    let changed = projects(
        &kernel,
        owner,
        "update",
        json!({ "project": project.id, "name": "Day job", "pinned": true }),
    )
    .await
    .unwrap();
    let changed: ProjectSummary = serde_json::from_value(changed).unwrap();
    assert_eq!(
        (changed.name.as_str(), changed.pinned, changed.archived),
        ("Day job", true, false)
    );
    assert!(
        root.path().join("Work").is_dir(),
        "a new name moves no folder"
    );
    let archived = projects(
        &kernel,
        owner,
        "update",
        json!({ "project": project.id, "archived": true }),
    )
    .await
    .unwrap();
    assert_eq!(archived["archived"], json!(true));
    assert_eq!(
        archived["name"],
        json!("Day job"),
        "what is not named stays"
    );
    for bad in ["", &"x".repeat(65)] {
        let refused = projects(
            &kernel,
            owner,
            "update",
            json!({ "project": project.id, "name": bad }),
        )
        .await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad:?}");
    }
    let nowhere = projects(
        &kernel,
        owner,
        "update",
        json!({ "project": ProjectId::new(), "pinned": true }),
    )
    .await;
    assert_eq!(nowhere.unwrap_err().code, Code::NotFound);

    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let kept = &kernel.projects().await[0];
    assert_eq!(
        (kept.name.as_str(), kept.pinned, kept.archived),
        ("Day job", true, true)
    );
    let back = add_folder(
        &kernel,
        owner,
        json!({ "folder": root.path().join("Work") }),
    )
    .await
    .unwrap();
    assert_eq!(
        (back.id, back.archived),
        (project.id, false),
        "adding it again brings it back"
    );
}

#[tokio::test]
async fn a_project_is_trusted_unless_its_folder_looks_foreign_and_only_the_person_changes_it() {
    let root = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let folder = |name: &str, holds: &[&str]| {
        let folder = elsewhere.path().join(name);
        std::fs::create_dir(&folder).unwrap();
        for held in holds {
            std::fs::create_dir(folder.join(held)).unwrap();
        }
        folder
    };
    let added = |params: Value| async { add_folder(&kernel, owner, params).await.unwrap() };

    let made = create(&kernel, owner, "Work").await;
    assert!(made.trusted, "a new folder is the Person's");
    let scratch = create_scratch(&kernel, owner, CommandId::new()).await;
    let scratch = scratch.unwrap();
    assert!(scratch.trusted, "No Project's is Banda's");
    let untrusted_scratch = projects(
        &kernel,
        owner,
        "create",
        json!({ "scratch": true, "trusted": false }),
    )
    .await;
    assert_eq!(untrusted_scratch.unwrap_err().code, Code::Invalid);
    let plain = added(json!({ "folder": folder("plain", &[]) })).await;
    assert!(plain.trusted);
    let new = elsewhere.path().join("new");
    let new = added(json!({ "folder": new, "create": true })).await;
    assert!(new.trusted, "a folder the add made holds nothing");

    let cloned = folder("cloned", &[".claude", ".devcontainer"]);
    let looked = projects(&kernel, owner, "foreign", json!({ "folder": cloned })).await;
    assert_eq!(
        looked.unwrap(),
        json!({ "foreign": true, "why": [
            { "kind": "holds", "name": ".claude" },
            { "kind": "holds", "name": ".devcontainer" },
        ] })
    );
    let cloned = added(json!({ "folder": cloned })).await;
    assert!(!cloned.trusted, "Banda decides when nobody said");
    let said = folder("said", &[".codex"]);
    let said = added(json!({ "folder": said, "trusted": true })).await;
    assert!(said.trusted, "the Person's word wins");
    let again = added(json!({ "folder": cloned.folder })).await;
    assert!(!again.trusted, "a Project keeps its own");
    let looked = projects(
        &kernel,
        owner,
        "foreign",
        json!({ "folder": cloned.folder }),
    )
    .await;
    assert_eq!(
        looked.unwrap()["project"],
        json!(cloned.id),
        "Add Project asks nothing of a folder that already is a Project"
    );

    // A folder not made yet is looked at as it will be: in the repository
    // it is made in, by what the folders above it hold.
    let repository = folder("repository", &[".git", ".claude"]);
    let inside = repository.join("packages").join("new");
    let looked = projects(&kernel, owner, "foreign", json!({ "folder": inside })).await;
    assert_eq!(
        looked.unwrap(),
        json!({ "foreign": true, "why": [{ "kind": "holds", "name": ".claude" }] })
    );
    let inside = added(json!({ "folder": inside, "create": true })).await;
    assert!(!inside.trusted, "a folder made in such a repository is not");

    // An Agent reads its Project's trust, and never changes it or looks
    // past its wall.
    let agent = Caller {
        participant: Participant::Agent(AgentId::new()),
        only: Some(cloned.id),
    };
    let listed = (kernel.call(agent, "projects.list", None, None, Value::Null)).await;
    assert_eq!(listed.unwrap()[0]["trusted"], json!(false));
    let trust = json!({ "project": cloned.id, "trusted": true });
    let command = Some(CommandId::new());
    let refused = (kernel.call(agent, "projects.trust", None, command, trust.clone())).await;
    assert_eq!(refused.unwrap_err().code, Code::Forbidden);
    let look = json!({ "folder": elsewhere.path() });
    let refused = kernel
        .call(agent, "projects.foreign", None, None, look)
        .await;
    assert_eq!(refused.unwrap_err().code, Code::Forbidden);
    assert!(notes.trusts.lock().unwrap().is_empty());

    let trusted = projects(&kernel, owner, "trust", trust.clone())
        .await
        .unwrap();
    assert_eq!(trusted["trusted"], json!(true));
    projects(&kernel, owner, "trust", trust).await.unwrap();
    let untrust = json!({ "project": made.id, "trusted": false });
    projects(&kernel, owner, "trust", untrust).await.unwrap();
    let said = json!({ "folder": said.folder, "trusted": false });
    let said = added(said).await;
    assert!(
        !said.trusted,
        "an add that says changes it, as `trust` does"
    );
    assert_eq!(
        *notes.trusts.lock().unwrap(),
        [(cloned.id, true), (made.id, false), (said.id, false)],
        "its modules hear each change, as it is now, once"
    );
    let nowhere = json!({ "project": ProjectId::new(), "trusted": true });
    let nowhere = projects(&kernel, owner, "trust", nowhere).await;
    assert_eq!(nowhere.unwrap_err().code, Code::NotFound);
    let scratch = json!({ "project": scratch.id, "trusted": false });
    let scratch = projects(&kernel, owner, "trust", scratch).await;
    assert_eq!(
        scratch.unwrap_err().code,
        Code::Invalid,
        "No Project's stays"
    );

    // A manifest says it only of a Project that is not trusted, so one
    // from before the flag reads as trusted.
    let data = root.path().join(".data/projects");
    let manifest = |id: ProjectId| -> Value {
        let text = std::fs::read(data.join(id.to_string()).join("project.json")).unwrap();
        serde_json::from_slice(&text).unwrap()
    };
    assert_eq!(manifest(made.id)["untrusted"], json!(true));
    assert_eq!(manifest(plain.id).get("untrusted"), None);
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 7).await;
    let kept: Vec<_> = (kernel.projects().await.into_iter())
        .map(|project| (project.id, project.trusted))
        .collect();
    let kept_as = [
        (made.id, false),
        (cloned.id, true),
        (plain.id, true),
        (said.id, false),
        (inside.id, false),
    ];
    for (id, trusted) in kept_as {
        assert!(kept.contains(&(id, trusted)), "{id}: {kept:?}");
    }
}

#[tokio::test]
async fn a_missing_project_keeps_the_trust_the_person_gave_it_once_located() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let_go(kernel, &root.path().join(".data"), &[]).await;
    std::fs::rename(root.path().join("Work"), root.path().join("Moved")).unwrap();
    let kernel = reopen(root.path(), owner, &notes, 1).await;

    let untrust = json!({ "project": project.id, "trusted": false });
    let untrusted = projects(&kernel, owner, "trust", untrust).await.unwrap();
    assert_eq!(
        (&untrusted["trusted"], &untrusted["missing"]),
        (&json!(false), &json!(true))
    );
    assert!(
        notes.trusts.lock().unwrap().is_empty(),
        "nothing of it runs"
    );
    let folder = root.path().join("Moved");
    let locate = json!({ "project": project.id, "folder": folder });
    let located = projects(&kernel, owner, "locate", locate).await.unwrap();
    assert_eq!(
        (&located["trusted"], &located["missing"]),
        (&json!(false), &json!(false))
    );
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    assert!(!kernel.projects().await[0].trusted);
}

/// Every Project trusted before the fence counts as one the Person said
/// they trust, once: the upgrade says so, and when, apart from a Person's
/// own word; a scratch one, or one not trusted, stays as it was, and one
/// made since follows the rule (ADR 0083, F0-3; Roma, 2026-11-08).
#[tokio::test]
async fn a_project_trusted_before_the_fence_is_said_trusted_once_by_the_upgrade() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let mine = create(&kernel, owner, "Mine").await;
    let gone = create(&kernel, owner, "Gone").await;
    let foreign = root.path().join("Foreign");
    std::fs::create_dir_all(foreign.join(".claude")).unwrap();
    let foreign = add_folder(&kernel, owner, json!({ "folder": foreign }))
        .await
        .unwrap();
    let said = add_folder(
        &kernel,
        owner,
        json!({ "folder": root.path().join("Said"), "create": true, "trusted": true }),
    )
    .await
    .unwrap();
    let scratch = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    assert!(!mine.trust_said && !foreign.trusted && said.trust_said);
    let data = root.path().join(".data/projects");
    let manifest_of = |id: ProjectId| data.join(id.to_string()).join("project.json");
    let read = |id: ProjectId| -> Value {
        serde_json::from_slice(&std::fs::read(manifest_of(id)).unwrap()).unwrap()
    };
    assert_eq!(read(said.id)["said"]["by"], "person");
    assert_eq!(read(mine.id)["version"], 1);
    let_go(kernel, &root.path().join(".data"), &[]).await;

    // As an engine from before the fence left them: no version, no word
    // said. One's folder is gone meanwhile.
    for id in [mine.id, gone.id, foreign.id, said.id, scratch.id] {
        let mut manifest = read(id);
        let fields = manifest.as_object_mut().unwrap();
        for field in ["version", "trust_said", "said"] {
            fields.remove(field);
        }
        std::fs::write(manifest_of(id), serde_json::to_vec(&manifest).unwrap()).unwrap();
    }
    // An engine from before the fence kept no word of the upgrade either.
    std::fs::remove_file(root.path().join(".data/said-before-fence.json")).unwrap();
    std::fs::rename(root.path().join("Gone"), root.path().join("Moved")).unwrap();
    let before = now_ms();
    let kernel = reopen(root.path(), owner, &notes, 5).await;
    let listed = kernel.projects().await;
    let said_of = |id| listed.iter().find(|one| one.id == id).unwrap().trust_said;
    for (id, trusted_then) in [
        (mine.id, true),
        (gone.id, true),
        (said.id, true),
        (foreign.id, false),
        (scratch.id, false),
    ] {
        assert_eq!(said_of(id), trusted_then, "{id}");
        let manifest = read(id);
        assert_eq!(manifest["version"], 1, "{id}");
        match trusted_then {
            true => {
                assert_eq!(manifest["said"]["by"], "upgrade", "{id}");
                assert!(manifest["said"]["at"].as_i64().unwrap() >= before);
            }
            false => assert_eq!(manifest.get("said"), None, "{id}"),
        }
    }
    let upgraded = read(mine.id)["said"].clone();

    // Made since, trusted only as nothing marked it foreign: not said, and
    // the next start leaves it so, and the upgrade's word as it was.
    let later = create(&kernel, owner, "Later").await;
    assert!(later.trusted && !later.trust_said);
    let_go(kernel, &root.path().join(".data"), &[]).await;
    // Even written as an engine from before the fence writes it, as one
    // run on the store again would: the upgrade was once, and is done.
    let mut manifest = read(later.id);
    manifest.as_object_mut().unwrap().remove("version");
    std::fs::write(
        manifest_of(later.id),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let kernel = reopen(root.path(), owner, &notes, 6).await;
    let listed = kernel.projects().await;
    let later = listed.iter().find(|one| one.id == later.id).unwrap();
    assert!(later.trusted && !later.trust_said, "{later:?}");
    assert_eq!(read(mine.id)["said"], upgraded);
    // The Person's own word, said again, is theirs.
    let trust = json!({ "project": mine.id, "trusted": true });
    projects(&kernel, owner, "trust", trust).await.unwrap();
    assert_eq!(read(mine.id)["said"]["by"], "person");
}

/// A Project's data found in a folder under the root, as engines before
/// ADR 0026 kept it, is anyone's to write there: an Agent's, or a clone's.
/// The Project it makes is foreign, whatever it says (ADR 0083, F0-3), and
/// it never takes a folder a Project names.
#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "no Banda on Windows ever kept a Project's data in its folder"
)]
async fn a_project_found_in_a_folder_is_foreign_and_takes_no_folder_a_project_names() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let mine = create(&kernel, owner, "Mine").await;
    let_go(kernel, &root.path().join(".data"), &[]).await;

    // Written to look like one from before the fence, trusted, its id
    // first of all, in the Project's folder and in a new one.
    let planted = |folder: &Path, id: &str| {
        let old = folder.join(".banda");
        std::fs::create_dir_all(&old).unwrap();
        let manifest = json!({
            "id": id,
            "name": "Mine",
            "author": Participant::Person(owner),
            "command": CommandId::new(),
            "created_at": 1,
            "sees_others": true,
            "trust_said": true,
        });
        std::fs::write(old.join("project.json"), manifest.to_string()).unwrap();
    };
    planted(
        &root.path().join("Mine"),
        "00000000-0000-0000-0000-000000000000",
    );
    let cloned = root.path().join("Cloned");
    planted(&cloned, "00000000-0000-0000-0000-000000000001");

    let kernel = reopen(root.path(), owner, &notes, 2).await;
    let listed = kernel.projects().await;
    let folder_of = |name: &Path| dunce::canonicalize(name).unwrap().display().to_string();
    let theirs = listed
        .iter()
        .find(|one| one.folder == folder_of(&root.path().join("Mine")))
        .unwrap();
    assert_eq!(theirs.id, mine.id, "the Person's Project keeps its folder");
    assert!(root.path().join("Mine/.banda/project.json").is_file());
    let found = listed
        .iter()
        .find(|one| one.folder == folder_of(&cloned))
        .unwrap();
    assert!(
        !found.trusted && !found.trust_said && !found.sees_others,
        "{found:?}"
    );
}

/// Makes a scratch Project, for a Thread in No Project, under `command`.
async fn create_scratch(
    kernel: &Kernel,
    owner: PersonId,
    command: CommandId,
) -> Result<ProjectSummary, Refusal> {
    let params = json!({ "scratch": true });
    let person = Participant::Person(owner);
    let made = (kernel.call(person, "projects.create", None, Some(command), params)).await?;
    Ok(serde_json::from_value(made).unwrap())
}

#[tokio::test]
async fn a_scratch_project_is_a_new_folder_with_no_name() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let command = CommandId::new();
    let made = create_scratch(&kernel, owner, command).await.unwrap();
    assert_eq!(
        (made.scratch, made.name.as_str()),
        (true, ""),
        "no name is asked"
    );
    let scratch = dunce::canonicalize(root.path().join("scratch")).unwrap();
    assert_eq!(Path::new(&made.folder).parent(), Some(scratch.as_path()));
    let again = create_scratch(&kernel, owner, command).await.unwrap();
    assert_eq!(again, made, "the same command gets the same Project");
    let other = create_scratch(&kernel, owner, CommandId::new()).await;
    assert_ne!(other.unwrap().folder, made.folder, "a Thread each");
    let person = Participant::Person(owner);
    add(&kernel, person, &made, "works as any Project")
        .await
        .unwrap();

    for bad in [json!({ "scratch": true, "name": "Work" }), json!({})] {
        let refused = projects(&kernel, owner, "create", bad.clone()).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad}");
    }
}

#[tokio::test]
async fn a_scratch_project_becomes_a_project_once_named_and_stays_one() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let made = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let kept = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let update = |params| projects(&kernel, owner, "update", params);
    for (bad, why) in [
        (
            json!({ "project": made.id, "scratch": false }),
            "it needs a name",
        ),
        (
            json!({ "project": made.id, "name": "Expenses" }),
            "no name in No Project",
        ),
    ] {
        assert_eq!(update(bad).await.unwrap_err().code, Code::Invalid, "{why}");
    }
    let project = update(json!({ "project": made.id, "scratch": false, "name": "Expenses" }))
        .await
        .unwrap();
    let project: ProjectSummary = serde_json::from_value(project).unwrap();
    assert_eq!(
        (project.scratch, project.name.as_str(), &project.folder),
        (false, "Expenses", &made.folder),
        "it stays where it is"
    );
    let back = update(json!({ "project": made.id, "scratch": true })).await;
    assert_eq!(back.unwrap_err().code, Code::Invalid, "no way back");

    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    let projects = kernel.projects().await;
    let scratch = |id| projects.iter().find(|s| s.id == id).unwrap().scratch;
    assert_eq!(
        (scratch(made.id), scratch(kept.id)),
        (false, true),
        "project.json keeps it"
    );
}

#[tokio::test]
async fn a_removed_project_loses_its_threads_but_keeps_its_files() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let person = Participant::Person(owner);
    let project = create(&kernel, owner, "Work").await;
    add(&kernel, person, &project, "a Thread's message")
        .await
        .unwrap();
    std::fs::write(root.path().join("Work/notes.md"), "mine").unwrap();

    let remove = || projects(&kernel, owner, "remove", json!({ "project": project.id }));
    remove().await.unwrap();
    assert!(kernel.projects().await.is_empty());
    assert_eq!(
        *notes.closed.lock().unwrap(),
        vec![project.id],
        "its modules stop what they run there"
    );
    assert_eq!(
        remove().await,
        Ok(Value::Null),
        "gone already is what was asked"
    );
    let projects_data = root.path().join(".data/projects");
    eventually(|| async { std::fs::read_dir(&projects_data).unwrap().count() == 0 }).await;
    assert_eq!(
        std::fs::read_to_string(root.path().join("Work/notes.md")).unwrap(),
        "mine"
    );

    let again = add_folder(
        &kernel,
        owner,
        json!({ "folder": root.path().join("Work") }),
    )
    .await
    .unwrap();
    assert_ne!(again.id, project.id, "added again, it is a new Project");
    let listed = kernel
        .call(person, "notes.list", Some(again.id), None, Value::Null)
        .await
        .unwrap();
    assert_eq!(listed["items"], json!([]));
}

#[tokio::test]
async fn a_project_whose_folder_went_waits_to_be_located_where_it_is_now() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let person = Participant::Person(owner);
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    add(&kernel, person, &project, "kept").await.unwrap();
    let other = create(&kernel, owner, "Other").await;
    drop(kernel);
    std::fs::rename(root.path().join("Work"), root.path().join("Moved")).unwrap();

    // Still listed, missing, and nothing of it opens; but the Person still
    // names, pins or archives it.
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    let listed = kernel.projects().await;
    let missing = listed.iter().find(|s| s.id == project.id).unwrap();
    assert!(missing.missing);
    assert!(!listed.iter().find(|s| s.id == other.id).unwrap().missing);
    let refused = add(&kernel, person, &project, "more").await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    assert!(refused.message.contains("locate it first"), "{refused:?}");
    let pinned = projects(
        &kernel,
        owner,
        "update",
        json!({ "project": project.id, "pinned": true }),
    )
    .await
    .unwrap();
    assert_eq!(
        (pinned["pinned"].clone(), pinned["missing"].clone()),
        (json!(true), json!(true))
    );

    // A folder that is not there, or that already is a Project, is refused;
    // a Project that is not missing has nothing to locate.
    let locate = |project: ProjectId, folder: &str| {
        let folder = root.path().join(folder);
        projects(
            &kernel,
            owner,
            "locate",
            json!({ "project": project, "folder": folder }),
        )
    };
    assert_eq!(
        locate(project.id, "Nowhere").await.unwrap_err().code,
        Code::NotFound
    );
    assert_eq!(
        locate(project.id, "Other").await.unwrap_err().code,
        Code::Conflict
    );
    assert_eq!(
        locate(other.id, "Moved").await.unwrap_err().code,
        Code::Conflict
    );

    // Located, it opens there with its Threads, and stays there.
    let located: ProjectSummary =
        serde_json::from_value(locate(project.id, "Moved").await.unwrap()).unwrap();
    assert!(!located.missing && located.pinned);
    let moved = dunce::canonicalize(root.path().join("Moved")).unwrap();
    assert_eq!(located.folder, moved.display().to_string());
    let notes_of = |kernel: Arc<Kernel>| async move {
        let listed = kernel
            .call(person, "notes.list", Some(project.id), None, Value::Null)
            .await
            .unwrap();
        listed["items"].to_string()
    };
    assert!(notes_of(kernel.clone()).await.contains("kept"));
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    assert!(kernel.projects().await.iter().all(|s| !s.missing));
    assert!(notes_of(kernel.clone()).await.contains("kept"));
}

#[tokio::test]
async fn a_missing_folder_added_back_opens_its_project_again() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    let_go(kernel, &root.path().join(".data"), &[]).await;
    let folder = root.path().join("Work");
    std::fs::rename(&folder, root.path().join("Away")).unwrap();
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    assert!(kernel.projects().await[0].missing);
    std::fs::rename(root.path().join("Away"), &folder).unwrap();
    let again = add_folder(&kernel, owner, json!({ "folder": folder }))
        .await
        .unwrap();
    assert_eq!(again.id, project.id, "the Project it was, not a new one");
    assert!(!again.missing);
}

#[tokio::test]
async fn a_missing_project_is_removed_with_its_data() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let project = create(&kernel, owner, "Work").await;
    drop(kernel);
    std::fs::remove_dir(root.path().join("Work")).unwrap();
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    projects(&kernel, owner, "remove", json!({ "project": project.id }))
        .await
        .unwrap();
    assert!(kernel.projects().await.is_empty());
    let projects_data = root.path().join(".data/projects");
    eventually(|| async { std::fs::read_dir(&projects_data).unwrap().count() == 0 }).await;
}

#[tokio::test]
async fn a_removed_project_left_half_deleted_is_cleared_on_start() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let gone = root
        .path()
        .join(".data/projects")
        .join(format!("{}.gone", ProjectId::new()));
    std::fs::create_dir_all(&gone).unwrap();
    std::fs::write(gone.join("project.sqlite3"), "").unwrap();
    let kernel = open(root.path(), owner, &notes).await;
    assert!(kernel.projects().await.is_empty());
    assert!(!gone.exists());
}

// A link on Windows needs Developer Mode.
#[cfg(unix)]
#[tokio::test]
async fn the_owner_browses_the_folders_as_a_path_is_typed() {
    let root = tempfile::tempdir().unwrap();
    let place = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    for folder in ["Alpha", "alps", ".hidden", "beta"] {
        std::fs::create_dir(place.path().join(folder)).unwrap();
    }
    std::fs::write(place.path().join("almanac"), "a file").unwrap();
    std::os::unix::fs::symlink(place.path().join("beta"), place.path().join("also")).unwrap();
    let base = place.path().display().to_string();
    let browse =
        |partial: String| projects(&kernel, owner, "browse", json!({ "partial": partial }));
    let names = |browsed: Value| -> Vec<String> {
        (browsed["entries"].as_array().unwrap().iter())
            .map(|entry| entry["name"].as_str().unwrap().to_owned())
            .collect()
    };

    let typed = browse(format!("{base}/al")).await.unwrap();
    assert_eq!(typed["parent"], json!(base));
    assert_eq!(typed["exists"], json!(false), "\"al\" is no folder");
    let named = browse(format!("{base}/beta")).await.unwrap();
    assert_eq!(named["exists"], json!(true));
    assert_eq!(
        names(typed.clone()),
        ["Alpha", "alps", "also"],
        "folders only, any case, links too"
    );
    assert_eq!(typed["entries"][0]["path"], json!(format!("{base}/Alpha")));
    let all = browse(format!("{base}/")).await.unwrap();
    assert_eq!(
        names(all),
        ["Alpha", "alps", "also", "beta"],
        "hidden ones wait for a dot"
    );
    assert_eq!(
        names(browse(format!("{base}/.")).await.unwrap()),
        [".hidden"]
    );
    assert_eq!(
        names(browse(format!("{base}/nothing/")).await.unwrap()),
        Vec::<String>::new()
    );
    let relative = browse("code/".into()).await;
    assert_eq!(relative.unwrap_err().code, Code::Invalid);

    let agent = Participant::Agent(AgentId::new());
    for (method, params) in [
        ("projects.browse", json!({ "partial": format!("{base}/") })),
        ("projects.add", json!({ "folder": base })),
        (
            "projects.update",
            json!({ "project": ProjectId::new(), "pinned": true }),
        ),
        ("projects.remove", json!({ "project": ProjectId::new() })),
    ] {
        let refused = kernel
            .call(agent, method, None, Some(CommandId::new()), params)
            .await;
        assert_eq!(refused.unwrap_err().code, Code::Forbidden, "{method}");
    }
}

#[tokio::test]
async fn an_effect_waits_until_the_modules_reacting_to_the_log_have_reacted() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let (notes, hears) = (Notes::default(), Hears::default());
    let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
        .module(notes.clone())
        .module(hears.clone())
        .open()
        .await
        .unwrap();
    let project = create(&kernel, owner, "Work").await;
    let module = hears.projects.lock().unwrap()[0].clone();
    let short = Duration::from_millis(50);
    // Nothing reacts: nothing to wait for.
    assert!(module.reacted(short).await);

    let filter = EventFilter {
        module: Some("notes".into()),
        ..EventFilter::default()
    };
    let mut heard = module.listen("notes", filter).await.unwrap();
    let person = Participant::Person(owner);
    add(&kernel, person, &project, "one").await.unwrap();
    assert!(!module.reacted(short).await, "it has not heard the note");
    let event = heard.next().await.unwrap().unwrap();
    assert_eq!(event.kind, "added");
    assert!(!module.reacted(short).await, "it has not handled the note");
    // Asking for the next, it has handled the one before.
    let next = tokio::spawn(async move { heard.next().await });
    assert!(module.reacted(Duration::from_secs(5)).await);
    // Gone, it reacts no more.
    next.abort();
    let _ = next.await;
    add(&kernel, person, &project, "two").await.unwrap();
    assert!(module.reacted(short).await);
}

/// What `event` says was written, copied into `hears_copies` in the
/// transaction that acks it: a reaction in the scope of the log it hears.
async fn copy(module: &ModuleProject, heard: &Listener, event: &Event) -> Result<(), Error> {
    let (ack, copy) = (heard.ack(event), keep_copy(copied_text(event)));
    module
        .write(move |tx| copy(tx).and_then(|()| tx.ack(&ack)))
        .await
}

/// Keeps `text` in `hears_copies`, in the transaction it is given.
fn keep_copy(text: String) -> impl FnOnce(&mut Tx<'_>) -> Result<(), Error> + Send + 'static {
    move |tx| {
        let sql = tx.sql();
        sql.execute("INSERT INTO hears_copies (text) VALUES (?1)", [&text])?;
        Ok(())
    }
}

/// A note's text, or a pane's kind.
fn copied_text(event: &Event) -> String {
    let text = (event.payload.get("text")).or(event.payload.get("kind"));
    text.and_then(Value::as_str).unwrap_or_default().to_owned()
}

async fn copies(module: &ModuleProject) -> Vec<String> {
    module.read(|sql| Ok(copied(sql)?)).await.unwrap()
}

/// The texts in `hears_copies`, as they were kept.
fn copied(sql: &rusqlite::Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement = sql.prepare("SELECT text FROM hears_copies ORDER BY rowid")?;
    let texts = statement.query_map([], |row| row.get(0))?;
    texts.collect()
}

/// The one Project `hears` was opened in, once the kernel has opened it.
async fn opened_in(hears: &Hears) -> ModuleProject {
    eventually(|| async { !hears.projects.lock().unwrap().is_empty() }).await;
    hears.projects.lock().unwrap()[0].clone()
}

/// A listener resumes from its cursor, not the log's head: a fact
/// committed before a crash, or while it was gone, it reacts to once
/// after the restart, and a fact acked already is refused with the
/// change it came with (ADR 0082, A5).
#[tokio::test]
async fn a_listener_resumes_from_its_cursor_and_reacts_once_across_a_crash() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join(".data");
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let notes = Notes::default();
    let start = |hears: &Hears| {
        Kernel::builder(root.path(), data.clone(), owner)
            .module(notes.clone())
            .module(hears.clone())
            .open()
    };
    let filter = EventFilter {
        module: Some("notes".into()),
        ..EventFilter::default()
    };
    let hears = Hears::default();
    let kernel = start(&hears).await.unwrap();
    let project = create(&kernel, owner, "Work").await;
    add(&kernel, person, &project, "history").await.unwrap();

    // New, it hears from the head on.
    let module = opened_in(&hears).await;
    let mut heard = module.listen("copies", filter.clone()).await.unwrap();
    add(&kernel, person, &project, "one").await.unwrap();
    let one = heard.next().await.unwrap().unwrap();
    copy(&module, &heard, &one).await.unwrap();
    let again = copy(&module, &heard, &one).await;
    assert!(matches!(again, Err(Error::Refused(refused)) if refused.code == Code::Conflict));
    assert_eq!(copies(&module).await, ["one"]);

    // Heard, and the engine gone before its reaction was kept.
    add(&kernel, person, &project, "two").await.unwrap();
    let two = heard.next().await.unwrap().unwrap();
    assert_eq!(copied_text(&two), "two");
    drop((heard, module));
    hears.projects.lock().unwrap().clear();
    let_go(kernel, &data, &[]).await;
    // Written while nothing listened.
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    add(&kernel, person, &project, "three").await.unwrap();
    let_go(kernel, &data, &[]).await;

    // Back, it reacts to each once, then hears only what is new.
    for text in ["four", "five"] {
        let hears = Hears::default();
        let kernel = start(&hears).await.unwrap();
        let module = opened_in(&hears).await;
        let mut heard = module.listen("copies", filter.clone()).await.unwrap();
        add(&kernel, person, &project, text).await.unwrap();
        loop {
            let event = heard.next().await.unwrap().unwrap();
            copy(&module, &heard, &event).await.unwrap();
            if copied_text(&event) == text {
                break;
            }
        }
        drop((heard, module));
        hears.projects.lock().unwrap().clear();
        let_go(kernel, &data, &[]).await;
    }
    let texts = copied(&sqlite(&data, &project)).unwrap();
    assert_eq!(texts, ["one", "two", "three", "four", "five"]);
}

/// A listener new to the kernel begins where its module's own cursor
/// stood before the kernel kept one, never past the log's head; once the
/// kernel keeps it, that cursor no longer counts (ADR 0082, A5).
#[tokio::test]
async fn a_listener_begins_once_where_its_modules_own_cursor_stood() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let (notes, hears) = (Notes::default(), Hears::default());
    let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
        .module(notes.clone())
        .module(hears.clone())
        .open()
        .await
        .unwrap();
    let project = create(&kernel, owner, "Work").await;
    let module = opened_in(&hears).await;
    let filter = EventFilter {
        module: Some("notes".into()),
        ..EventFilter::default()
    };
    let one = add(&kernel, person, &project, "one").await.unwrap();
    add(&kernel, person, &project, "two").await.unwrap();
    let carried = one["seq"].as_i64();
    let mut heard = (module.listen_from("carried", filter.clone(), carried).await).unwrap();
    let two = heard.next().await.unwrap().unwrap();
    assert_eq!(copied_text(&two), "two");
    heard.ack_through(two.seq).await.unwrap();
    drop(heard);
    // Its own cursor counts no more; one past the head begins there.
    add(&kernel, person, &project, "three").await.unwrap();
    let mut heard = module.listen_from("carried", filter.clone(), carried).await;
    let three = heard.as_mut().unwrap().next().await.unwrap().unwrap();
    assert_eq!(copied_text(&three), "three");
    let mut heard = module.listen_from("ahead", filter, Some(i64::MAX)).await;
    add(&kernel, person, &project, "four").await.unwrap();
    let four = heard.as_mut().unwrap().next().await.unwrap().unwrap();
    assert_eq!(copied_text(&four), "four");
}

/// Whether `result` was refused with `code`.
fn refused<T>(result: Result<T, Error>, code: Code) -> bool {
    matches!(result, Err(Error::Refused(refused)) if refused.code == code)
}

/// One name is one listener of a log while it listens, and it acks only
/// what it has heard, in its reaction's transaction (ADR 0082, A5).
#[tokio::test]
async fn one_name_is_one_listener_and_it_acks_only_what_it_heard() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let (notes, hears) = (Notes::default(), Hears::default());
    let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
        .module(notes.clone())
        .module(hears.clone())
        .open()
        .await
        .unwrap();
    let project = create(&kernel, owner, "Work").await;
    let module = opened_in(&hears).await;
    let filter = EventFilter {
        module: Some("notes".into()),
        ..EventFilter::default()
    };
    let mut heard = module.listen("copies", filter.clone()).await.unwrap();
    let twice = module.listen("copies", filter.clone()).await;
    assert!(refused(twice, Code::Conflict), "one name, one listener");

    add(&kernel, person, &project, "one").await.unwrap();
    add(&kernel, person, &project, "two").await.unwrap();
    let one = heard.next().await.unwrap().unwrap();
    let two = Event {
        seq: one.seq + 1,
        ..one.clone()
    };
    assert!(refused(heard.ack_through(two.seq).await, Code::Invalid));
    let ack = heard.ack(&two);
    let unheard = module.write(move |tx| tx.ack(&ack)).await;
    assert!(refused(unheard, Code::Invalid), "it has not heard two");
    let own = heard.once(&one, keep_copy("one".into())).await;
    assert!(
        refused(own, Code::Invalid),
        "it acks in its own transaction"
    );
    copy(&module, &heard, &one).await.unwrap();

    // Gone, its name is free again, and it hears on from its cursor.
    drop(heard);
    let mut heard = module.listen("copies", filter).await.unwrap();
    assert_eq!(copied_text(&heard.next().await.unwrap().unwrap()), "two");
    assert_eq!(copies(&module).await, ["one"]);
}

/// A listener begun behind the log's head, where nothing is for it, has
/// handled the log once it reads it: an effect does not wait on it until
/// the next event (ADR 0082, A5).
#[tokio::test]
async fn a_listener_begun_behind_the_head_has_handled_what_it_does_not_hear() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let (notes, hears) = (Notes::default(), Hears::default());
    let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
        .module(notes.clone())
        .module(hears.clone())
        .open()
        .await
        .unwrap();
    let project = create(&kernel, owner, "Work").await;
    let module = opened_in(&hears).await;
    let one = add(&kernel, person, &project, "one").await.unwrap();
    add(&kernel, person, &project, "two").await.unwrap();
    let nothing = EventFilter {
        subject: Some("nothing".into()),
        ..EventFilter::default()
    };
    let carried = one["seq"].as_i64();
    let mut heard = module.listen_from("nothing", nothing, carried).await;
    let short = Duration::from_millis(50);
    assert!(!module.reacted(short).await, "it has not read the log");
    let next = tokio::spawn(async move { heard.as_mut().unwrap().next().await.map(drop) });
    assert!(module.reacted(Duration::from_secs(5)).await);
    next.abort();
}

/// A Project's module hears the machine's log, its cursor in the
/// machine's store and its reaction in its own Project's: written under
/// the receipt of a derived command, then acked. A crash between the two,
/// and the fact is heard again, but its reaction is not written again
/// (ADR 0082, decision 4; A5).
#[tokio::test]
async fn a_reaction_across_scopes_is_written_once_though_its_ack_was_lost() {
    let dir = tempfile::tempdir().unwrap();
    let (data, machine) = (dir.path().join("data"), dir.path().join("machine"));
    let owner = PersonId::new();
    let person = Participant::Person(owner);
    let start = |hears: &Hears| {
        Kernel::builder(dir.path().join("root"), data.clone(), owner)
            .module(Desk)
            .module(hears.clone())
            .machine(machine.clone())
            .open()
    };
    let filter = EventFilter {
        module: Some("desk".into()),
        ..EventFilter::default()
    };
    let hears = Hears::default();
    let kernel = start(&hears).await.unwrap();
    create(&kernel, owner, "Work").await;
    let open_pane = |kernel: &Arc<Kernel>, kind: &str| {
        let params = json!({ "kind": kind });
        let command = Some(CommandId::new());
        let kernel = kernel.clone();
        async move {
            kernel
                .call(person, "desk.open", None, command, params)
                .await
        }
    };

    let module = opened_in(&hears).await;
    let heard = module.listen_to_machine("panes", filter.clone()).await;
    let mut heard = heard.unwrap().unwrap();
    open_pane(&kernel, "terminal").await.unwrap();
    let terminal = heard.next().await.unwrap().unwrap();
    // Its cursor is in another store: an ack in its own transaction is refused.
    let ack = heard.ack(&terminal);
    let own = module.write(move |tx| tx.ack(&ack)).await;
    assert!(matches!(own, Err(Error::Refused(refused)) if refused.code == Code::Invalid));
    let copy = keep_copy(copied_text(&terminal));
    assert_eq!(heard.once(&terminal, copy).await.unwrap(), Some(()));
    drop((heard, module));
    hears.projects.lock().unwrap().clear();
    let_go(kernel, &data, &[&machine]).await;

    // The engine died after the Project's write, before the machine's ack.
    let rewound = rusqlite::Connection::open(machine.join("project.sqlite3"))
        .unwrap()
        .execute(
            "UPDATE kernel_cursors SET seq = seq - 1 WHERE listener LIKE 'hears.panes@%'",
            [],
        )
        .unwrap();
    assert_eq!(rewound, 1);

    let hears = Hears::default();
    let kernel = start(&hears).await.unwrap();
    let module = opened_in(&hears).await;
    let heard = module.listen_to_machine("panes", filter).await;
    let mut heard = heard.unwrap().unwrap();
    open_pane(&kernel, "editor").await.unwrap();
    for (kind, written) in [("terminal", None), ("editor", Some(()))] {
        let event = heard.next().await.unwrap().unwrap();
        assert_eq!(copied_text(&event), kind);
        let copy = keep_copy(kind.to_owned());
        assert_eq!(heard.once(&event, copy).await.unwrap(), written, "{kind}");
    }
    assert_eq!(copies(&module).await, ["terminal", "editor"]);
}

#[tokio::test]
async fn promotion_moves_files_and_keeps_the_open_project_and_log() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let made = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let held = kernel.project(made.id).await.unwrap();
    std::fs::write(held.folder().join("work.txt"), "keep me").unwrap();
    // As the system names it, as the kernel keeps a folder: on Windows
    // the temporary folder's name may be a short one.
    let destination = dunce::canonicalize(root.path()).unwrap().join("Promoted");
    let params =
        json!({"project": made.id, "scratch": false, "name": "Promoted", "folder": destination});
    let promoted: ProjectSummary = serde_json::from_value(
        projects(&kernel, owner, "update", params.clone())
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(promoted.id, made.id);
    assert!(!promoted.scratch);
    assert_eq!(held.folder(), destination);
    assert!(!Path::new(&made.folder).exists());
    assert_eq!(
        std::fs::read_to_string(destination.join("work.txt")).unwrap(),
        "keep me"
    );
    let again: ProjectSummary =
        serde_json::from_value(projects(&kernel, owner, "update", params).await.unwrap()).unwrap();
    assert_eq!(again, promoted);
    drop(held);
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    assert_eq!(kernel.projects().await[0], promoted);
}

#[tokio::test]
async fn promotion_never_overwrites_a_destination_or_promotes_after_a_failed_move() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let made = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let destination = root.path().join("Taken");
    std::fs::create_dir(&destination).unwrap();
    let refused = projects(
        &kernel,
        owner,
        "update",
        json!({"project": made.id, "scratch": false, "name": "Taken", "folder": destination}),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert_eq!(kernel.projects().await[0], made);
    assert!(Path::new(&made.folder).is_dir());
    assert!(destination.is_dir());
}

#[tokio::test]
async fn a_restart_finishes_a_journaled_folder_move() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let made = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let project = kernel.project(made.id).await.unwrap();
    let destination = root.path().join("Recovered");
    let mut next: Value =
        serde_json::from_slice(&std::fs::read(project.data().join("project.json")).unwrap())
            .unwrap();
    next["folder"] = json!(destination);
    next["name"] = json!("Recovered");
    next["scratch"] = json!(false);
    std::fs::write(
        project.data().join("move.json"),
        serde_json::to_vec(&next).unwrap(),
    )
    .unwrap();
    std::fs::rename(&made.folder, &destination).unwrap();
    drop(project);
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let recovered = &kernel.projects().await[0];
    assert_eq!(recovered.name, "Recovered");
    assert!(!recovered.scratch && !recovered.missing);
    assert_eq!(recovered.folder, destination.to_str().unwrap());
}

#[tokio::test]
async fn a_project_s_sign_is_found_picked_and_found_again() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let folder = root.path().join("site");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("logo.svg"),
        "<svg xmlns='http://www.w3.org/2000/svg'/>",
    )
    .unwrap();

    // Found in the folder, as the Project is added.
    let added = add_folder(&kernel, owner, json!({ "folder": folder }))
        .await
        .unwrap();
    assert_eq!(added.sign.kind, SignKind::Picture);
    assert_eq!(added.sign.found.as_deref(), Some("logo.svg"));
    assert!(!added.sign.picked);
    let one = json!({ "project": added.id });
    let url = projects(&kernel, owner, "sign", one.clone()).await.unwrap();
    assert!(
        url.as_str()
            .unwrap()
            .starts_with("data:image/svg+xml;base64,")
    );

    // Picked by hand, then back to what Banda finds.
    let pick = |sign: Value| json!({ "project": added.id, "sign": sign });
    let emoji = projects(&kernel, owner, "update", pick(json!({ "emoji": "⌨️" })))
        .await
        .unwrap();
    assert_eq!(emoji["sign"]["kind"], "emoji");
    assert_eq!(emoji["sign"]["picked"], true);
    let back = projects(&kernel, owner, "update", pick(Value::Null))
        .await
        .unwrap();
    assert_eq!(back["sign"]["kind"], "picture");
    assert_eq!(back["sign"]["found"], "logo.svg");

    // A picture picked by hand stays as the folder changes.
    let png = [
        &b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"[..],
        &32u32.to_be_bytes(),
        &32u32.to_be_bytes(),
        &[8, 6, 0, 0, 0],
    ]
    .concat();
    use base64::Engine as _;
    let picture = base64::engine::general_purpose::STANDARD.encode(&png);
    let picked = projects(
        &kernel,
        owner,
        "update",
        pick(json!({ "picture": picture, "kind": "png" })),
    )
    .await
    .unwrap();
    assert_eq!(picked["sign"]["kind"], "picture");
    assert_eq!(picked["sign"]["picked"], true);
    std::fs::remove_file(folder.join("logo.svg")).unwrap();
    let again = projects(&kernel, owner, "find_sign", one.clone())
        .await
        .unwrap();
    assert_eq!(again["sign"]["picked"], true);
    let url = projects(&kernel, owner, "sign", one).await.unwrap();
    assert!(url.as_str().unwrap().starts_with("data:image/png;base64,"));

    // A picture that is no picture is refused.
    let wrong = projects(
        &kernel,
        owner,
        "update",
        pick(json!({ "picture": "aGVsbG8=", "kind": "png" })),
    )
    .await;
    assert_eq!(wrong.unwrap_err().code, Code::Invalid);
}

#[tokio::test]
async fn letters_that_start_alike_are_told_apart() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    create(&kernel, owner, "banda").await;
    create(&kernel, owner, "bandad").await;
    create(&kernel, owner, "work").await;
    let mut letters: Vec<(String, String)> = (kernel.projects().await.into_iter())
        .map(|p| (p.name, p.sign.text))
        .collect();
    letters.sort();
    assert_eq!(
        letters,
        [
            ("banda".to_owned(), "BD".to_owned()),
            ("bandad".to_owned(), "BN".to_owned()),
            ("work".to_owned(), "W".to_owned()),
        ]
    );
}
