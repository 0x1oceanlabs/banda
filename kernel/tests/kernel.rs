//! The kernel through its interface: a small test module, real SQLite in a
//! temporary folder, and the real API over a WebSocket.

use banda_kernel::api::Identity;
use banda_kernel::{
    AgentId, Call, Caller, Code, CommandId, Effect, Error, EventFilter, Kernel, Module,
    ModuleSpace, OnRestart, Outcome, Participant, PersonId, Refusal, Right, Scope, Settled,
    SpaceId, SpaceSummary, Stream, Tx, decode,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Notes: `add` writes a note and queues `publish`, keyed by one feed.
#[derive(Clone, Default)]
struct Notes {
    published: Arc<Mutex<Vec<String>>>,
    /// How the next runs of `publish` end; `Done` once the script is empty.
    script: Arc<Mutex<VecDeque<Outcome>>>,
    /// Whether the next run of `publish` panics.
    panics: Arc<AtomicBool>,
    /// The Spaces it was told were removed.
    closed: Arc<Mutex<Vec<SpaceId>>>,
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

    async fn closing(&self, space: ModuleSpace) {
        self.closed.lock().unwrap().push(space.id());
    }

    fn right(&self, method: &str) -> Option<Right> {
        match method {
            "add" => Some(Right::Write),
            "list" => Some(Right::Read),
            "purge" => Some(Right::Manage),
            "count" => Some(Right::Read),
            "pass" => Some(Right::Read),
            "show" => Some(Right::Read),
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
            // The pass of the Agent `agent` in this Space, as the agents
            // module asks for one when it opens a session.
            "pass" => {
                let agent: AgentId = decode(params["agent"].clone())?;
                Ok(json!(call.space().pass(agent)?))
            }
            // Asks the window to show what it is given, as the browser asks
            // it for a page.
            "show" => (call.ask_window("show", &params, Duration::from_secs(5))).await,
            "list" => {
                let (at, items) = call
                    .space()
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

    async fn run(&self, _space: ModuleSpace, effect: Effect) -> Outcome {
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
            .space()
            .view(|sql| {
                let mut statement = sql.prepare("SELECT kind FROM desk_panes ORDER BY id")?;
                let kinds = statement.query_map([], |row| row.get::<_, String>(0))?;
                Ok(kinds.collect::<rusqlite::Result<Vec<_>>>()?)
            })
            .await?;
        Ok(json!(kinds))
    }
}

/// A module that keeps each Space it opens in, to react to the log as a
/// test says: a Space's, or, as `listens`, the machine's.
#[derive(Clone, Default)]
struct Hears {
    spaces: Arc<Mutex<Vec<ModuleSpace>>>,
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
            Scope::Space
        }
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, _: &str) -> Option<Right> {
        None
    }

    async fn opened(&self, space: ModuleSpace) -> Result<(), Error> {
        self.spaces.lock().unwrap().push(space);
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

async fn create_space(
    kernel: &Kernel,
    participant: Participant,
    command: CommandId,
    name: &str,
) -> Result<SpaceSummary, Refusal> {
    let created = kernel
        .call(
            participant,
            "spaces.create",
            None,
            Some(command),
            json!({ "name": name }),
        )
        .await?;
    Ok(serde_json::from_value(created).unwrap())
}

async fn create(kernel: &Kernel, owner: PersonId, name: &str) -> SpaceSummary {
    create_space(kernel, Participant::Person(owner), CommandId::new(), name)
        .await
        .unwrap()
}

async fn add(
    kernel: &Kernel,
    participant: Participant,
    space: &SpaceSummary,
    text: &str,
) -> Result<Value, Refusal> {
    kernel
        .call(
            participant,
            "notes.add",
            Some(space.id),
            Some(CommandId::new()),
            json!({ "text": text }),
        )
        .await
}

/// Calls one of the kernel's own Space methods as the owner, a new command.
async fn spaces(
    kernel: &Kernel,
    owner: PersonId,
    method: &str,
    params: Value,
) -> Result<Value, Refusal> {
    let method = format!("spaces.{method}");
    let command = Some(CommandId::new());
    kernel
        .call(Participant::Person(owner), &method, None, command, params)
        .await
}

async fn add_folder(
    kernel: &Kernel,
    owner: PersonId,
    params: Value,
) -> Result<SpaceSummary, Refusal> {
    let added = spaces(kernel, owner, "add", params).await?;
    Ok(serde_json::from_value(added).unwrap())
}

/// Opens the kernel again once the one before let go of its Spaces: an
/// effect still running holds a Space a moment longer.
async fn reopen(root: &Path, owner: PersonId, notes: &Notes, count: usize) -> Arc<Kernel> {
    for _ in 0..500 {
        let again = open(root, owner, notes).await;
        if again.spaces().await.len() == count {
            return again;
        }
        drop(again);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the Spaces never opened again");
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

async fn kinds(kernel: &Kernel, space: &SpaceSummary) -> Vec<String> {
    let space = kernel.space(space.id).await.unwrap();
    let events = space
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    events.into_iter().map(|e| e.kind).collect()
}

/// How the effect its module settled was lost, as the `lost` event says.
async fn lost_how(kernel: &Kernel, space: &SpaceSummary) -> Value {
    let space = kernel.space(space.id).await.unwrap();
    let events = space
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    let lost = events.into_iter().find(|e| e.kind == "lost");
    lost.expect("an effect was settled").payload["how"].clone()
}

#[tokio::test]
async fn a_space_is_a_folder_and_opens_again_after_a_restart() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let person = Participant::Person(owner);
    let command = CommandId::new();
    let space = create_space(&kernel, person, command, "Research")
        .await
        .unwrap();
    let data = root.path().join(".data/spaces").join(space.id.to_string());
    assert!(data.join("space.json").is_file());
    assert!(!root.path().join("Research/.banda").exists());
    add(&kernel, person, &space, "first").await.unwrap();

    let again = create_space(&kernel, person, command, "Research").await;
    assert_eq!(
        again,
        Ok(space.clone()),
        "the same command gets the same Space"
    );
    let twin = create_space(&kernel, person, CommandId::new(), "Research").await;
    assert_eq!(twin.unwrap_err().code, Code::Conflict);
    for bad in ["", ".hidden", "a/b", "..", &"x".repeat(65)] {
        let refused = create_space(&kernel, person, CommandId::new(), bad).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad:?}");
    }

    let second = open(root.path(), owner, &notes).await;
    assert!(
        second.spaces().await.is_empty(),
        "a Space opens in one engine at a time"
    );
    drop(second);
    drop(kernel);

    // An effect still running holds the Space a moment longer; a real
    // restart ends the process, and the lock with it.
    let again = reopen(root.path(), owner, &notes, 1).await;
    assert_eq!(again.spaces().await, vec![space.clone()]);
    let listed = again
        .call(
            Participant::Person(owner),
            "notes.list",
            Some(space.id),
            None,
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(listed["items"], json!(["first"]));
}

#[tokio::test]
async fn a_command_runs_once_and_its_effect_runs_after_commit() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);

    let command = CommandId::new();
    let call = || {
        kernel.call(
            person,
            "notes.add",
            Some(space.id),
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
            Some(space.id),
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
        .call(person, "notes.list", Some(space.id), None, Value::Null)
        .await
        .unwrap();
    assert_eq!(listed["items"], json!(["once"]));
    assert_eq!(
        listed["at"], first["seq"],
        "the view is current at the log's head"
    );
}

#[tokio::test]
async fn a_read_keeps_no_receipt_so_its_id_stays_free() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    let id = CommandId::new();
    kernel
        .call(person, "notes.list", Some(space.id), Some(id), Value::Null)
        .await
        .unwrap();
    kernel
        .call(
            person,
            "notes.add",
            Some(space.id),
            Some(id),
            json!({ "text": "later" }),
        )
        .await
        .expect("the ID was never a command's");
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
    let space = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);

    add(&kernel, person, &space, "a").await.unwrap();
    add(&kernel, person, &space, "b").await.unwrap();
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
    let space = create(&kernel, owner, "Work").await;

    add(&kernel, Participant::Person(owner), &space, "a")
        .await
        .unwrap();
    eventually(|| async { kinds(&kernel, &space).await == ["added", "lost"] }).await;
    assert_eq!(lost_how(&kernel, &space).await, "failed: the feed is gone");
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
    let space = create(&kernel, owner, "Work").await;

    add(&kernel, person, &space, "a").await.unwrap();
    add(&kernel, person, &space, "b").await.unwrap();
    // The next effect of the feed waited for the first one's end.
    eventually(|| async { *notes.published.lock().unwrap() == ["b"] }).await;
    let mut kinds = kinds(&kernel, &space).await;
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
    let space = create(&kernel, owner, "Work").await;

    add(&kernel, person, &space, "a").await.unwrap();
    eventually(|| async { kinds(&kernel, &space).await == ["added", "lost"] }).await;
    assert_eq!(
        lost_how(&kernel, &space).await,
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
    let space = create(&kernel, owner, "Work").await;

    add(&kernel, person, &space, "a").await.unwrap();
    add(&kernel, person, &space, "b").await.unwrap();
    eventually(|| async { *notes.published.lock().unwrap() == ["b"] }).await;
    assert_eq!(
        lost_how(&kernel, &space).await,
        "failed: The engine broke off while it ran this."
    );
}

#[tokio::test]
async fn a_restart_replays_or_abandons_what_it_cut_short() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    drop(kernel);
    tokio::time::sleep(Duration::from_millis(50)).await;

    // An earlier run claimed two effects and then the engine stopped.
    let author = serde_json::to_string(&Participant::Person(owner)).unwrap();
    let database = rusqlite::Connection::open(
        root.path()
            .join(format!(".data/spaces/{}/space.sqlite3", space.id)),
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
    let space = kernel.space(space.id).await.unwrap();
    let lost: Vec<Value> = space
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

#[tokio::test]
async fn an_agent_works_in_the_space_but_may_not_manage_it() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let notes = Notes::default();
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    let agent = Participant::Agent(AgentId::new());

    add(&kernel, agent, &space, "by an agent").await.unwrap();
    let purge = kernel
        .call(
            agent,
            "notes.purge",
            Some(space.id),
            Some(CommandId::new()),
            Value::Null,
        )
        .await;
    assert_eq!(purge.unwrap_err().code, Code::Forbidden);
    let create = create_space(&kernel, agent, CommandId::new(), "Mine").await;
    assert_eq!(create.unwrap_err().code, Code::Forbidden);
    let stranger = add(&kernel, Participant::Person(PersonId::new()), &space, "no").await;
    assert_eq!(stranger.unwrap_err().code, Code::Forbidden);
    let unknown = kernel
        .call(
            Participant::Person(owner),
            "nobody.add",
            Some(space.id),
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
    let space = create(&kernel, owner, "Work").await;
    add(&kernel, Participant::Person(owner), &space, "before")
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
    let peek = json!({ "type": "subscribe", "id": 1, "space": space.id, "after": 0 });
    stranger
        .send(Message::text(peek.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut stranger).await["error"]["code"], "forbidden");

    let list = json!({ "type": "call", "id": 1, "method": "notes.list", "space": space.id });
    socket.send(Message::text(list.to_string())).await.unwrap();
    let view = next(&mut socket).await;
    assert_eq!(view["ok"]["items"], json!(["before"]));
    let at = view["ok"]["at"].as_i64().unwrap();

    let follow = json!({ "type": "subscribe", "id": 2, "space": space.id, "after": at, "filter": { "module": "notes" } });
    socket
        .send(Message::text(follow.to_string()))
        .await
        .unwrap();
    assert_eq!(next(&mut socket).await["ok"]["subscription"], 2);

    let command = CommandId::new();
    let send = json!({
        "type": "call", "id": 3, "method": "notes.add", "space": space.id,
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
    let space = create(&kernel, owner, "Work").await;
    let address = serve(&kernel, owner).await;

    let count = |id: u64| json!({ "type": "stream", "id": id, "space": space.id, "method": "notes.count", "params": { "to": 3 } });
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
        json!({ "type": "stream", "id": 8, "space": space.id, "method": "notes.nothing" });
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
    let space = create(&kernel, owner, "Work").await;
    let person = Participant::Person(owner);
    const MANY: usize = 1200;
    for n in 0..MANY {
        add(&kernel, person, &space, &n.to_string()).await.unwrap();
    }

    let address = serve(&kernel, owner).await;
    let (mut socket, _) = connect(
        address,
        json!({ "type": "hello", "protocol": 1, "token": "secret" }),
    )
    .await;
    let follow = json!({ "type": "subscribe", "id": 1, "space": space.id, "after": 0, "filter": { "module": "notes" } });
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
    add(&kernel, person, &space, "live").await.unwrap();
    assert_eq!(next(&mut socket).await["event"]["payload"]["text"], "live");
}

#[tokio::test]
async fn a_pass_connects_as_its_agent_and_only_in_its_space() {
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
        "type": "call", "id": 1, "method": "notes.add", "space": work.id,
        "command": CommandId::new(), "params": { "text": "by its agent" }
    });
    assert!(ask(add).await["ok"]["seq"].is_number());
    let space = kernel.space(work.id).await.unwrap();
    let added = space
        .events_after(0, Default::default(), 100)
        .await
        .unwrap();
    assert_eq!(added.last().unwrap().author, Participant::Agent(agent));

    let wall = "An Agent works only in its own Space.";
    let elsewhere = [
        json!({ "type": "call", "id": 2, "method": "notes.list", "space": other.id }),
        json!({ "type": "subscribe", "id": 3, "space": other.id, "after": 0 }),
        json!({ "type": "stream", "id": 4, "space": other.id, "method": "notes.count" }),
    ];
    for frame in elsewhere {
        let refused = ask(frame.clone()).await;
        assert_eq!(refused["error"]["code"], "forbidden", "{frame}");
        assert_eq!(refused["error"]["message"], wall, "{frame}");
    }
    // A call that names no Space is in its own.
    let list = ask(json!({ "type": "call", "id": 5, "method": "notes.list" })).await;
    assert_eq!(list["ok"]["items"], json!(["by its agent"]));
    let mine = ask(json!({ "type": "call", "id": 6, "method": "spaces.list" })).await;
    assert_eq!(mine["ok"], json!([work]), "it sees only its own Space");
    let purge = json!({ "type": "call", "id": 7, "method": "notes.purge", "space": work.id, "command": CommandId::new() });
    assert_eq!(
        ask(purge).await["error"]["code"],
        "forbidden",
        "nor may it manage it"
    );
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
    assert_eq!(asked["space"], json!(work.id));
    assert_eq!(asked["by"], json!(Participant::Agent(agent)));
    assert_eq!(asked["params"], json!({ "text": "hi" }));
    say(&mut window, answer(2, &asked["id"])).await;
    assert_eq!(next(&mut window).await["ok"], Value::Null);
    let shown = next(&mut by_agent).await;
    assert_eq!(shown["id"], 4);
    assert_eq!(shown["ok"], json!({ "shown": true }));
}

#[tokio::test]
async fn a_module_of_the_machine_names_no_space_and_keeps_its_own_log() {
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

    // Its methods name no Space, and a command runs once.
    let command = Some(CommandId::new());
    let terminal = json!({ "kind": "terminal" });
    for _ in 0..2 {
        let call = kernel.call(person, "desk.open", None, command, terminal.clone());
        call.await.unwrap();
    }
    let list = kernel.call(person, "desk.list", None, None, Value::Null);
    assert_eq!(list.await.unwrap(), json!(["terminal"]));

    // It is no Space: a Space's ID is refused to it, and its ID to a
    // Space's module, and the Spaces' list leaves it out.
    let in_work = kernel.call(person, "desk.list", Some(work.id), None, Value::Null);
    assert_eq!(in_work.await.unwrap_err().code, Code::Invalid);
    let notes = kernel.call(person, "notes.list", Some(machine), None, Value::Null);
    assert_eq!(notes.await.unwrap_err().code, Code::NotFound);
    assert!(
        kernel
            .spaces()
            .await
            .iter()
            .all(|space| space.id != machine)
    );

    // Its log is followed as a Space's is.
    let log = kernel.follow(person, machine).await.unwrap();
    let events = log.events_after(0, Default::default(), 100).await.unwrap();
    let kinds: Vec<_> = events.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, ["opened"]);

    // An Agent's pass is for its Space: the machine is past its wall.
    let agent = Caller {
        participant: Participant::Agent(AgentId::new()),
        only: Some(work.id),
    };
    let by_agent = kernel.call(agent, "desk.list", None, None, Value::Null);
    assert_eq!(by_agent.await.unwrap_err().code, Code::Forbidden);

    // After a restart, it is the same machine, with what it kept.
    drop(log);
    drop(kernel);
    let kernel = open().await.unwrap();
    assert_eq!(kernel.machine(), Some(machine));
    let list = kernel.call(person, "desk.list", None, None, Value::Null);
    assert_eq!(list.await.unwrap(), json!(["terminal"]));
}

#[tokio::test]
async fn a_module_of_a_space_hears_the_machine_until_its_space_closes() {
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
    let module = hears.spaces.lock().unwrap()[0].clone();
    let machine = listens.spaces.lock().unwrap()[0].clone();
    let open_pane = |kind: &str| {
        let params = json!({ "kind": kind });
        kernel.call(person, "desk.open", None, Some(CommandId::new()), params)
    };
    let short = Duration::from_millis(50);

    // It hears from now on, and only hears.
    open_pane("before").await.unwrap();
    let filter = EventFilter {
        module: Some("desk".into()),
        ..EventFilter::default()
    };
    let mut heard = module.react_to_machine(filter).await.unwrap().unwrap();
    assert!(heard.space().is_none(), "it never writes the machine's log");
    open_pane("terminal").await.unwrap();
    assert!(!machine.reacted(short).await, "the machine waits for it");
    let event = heard.next().await.unwrap().unwrap();
    assert_eq!(event.payload["kind"], "terminal");
    let next = tokio::spawn(async move { heard.next().await });
    assert!(machine.reacted(Duration::from_secs(5)).await);

    // Its Space removed and closed, it hears no more.
    drop(module);
    hears.spaces.lock().unwrap().clear();
    let remove = json!({ "space": work.id });
    let removed = kernel.call(
        person,
        "spaces.remove",
        None,
        Some(CommandId::new()),
        remove,
    );
    removed.await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(5), next).await;
    assert!(ended.unwrap().unwrap().unwrap().is_none());
    open_pane("after").await.unwrap();
    assert!(machine.reacted(short).await);

    // A module of the machine has no machine to hear but its own log.
    let own = machine.react_to_machine(EventFilter::default()).await;
    assert!(own.unwrap().is_none());
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

#[tokio::test]
async fn any_folder_is_added_as_a_space_and_one_folder_is_one_space() {
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
    let app = std::fs::canonicalize(&app).unwrap();
    assert_eq!(added.name, "app", "a Space is named after its folder");
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
        "the same folder is the same Space"
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
    let mut listed = again.spaces().await;
    listed.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(
        listed,
        vec![made, added],
        "an added Space opens again from the data"
    );
}

#[tokio::test]
async fn a_space_is_renamed_pinned_and_archived_and_added_back() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;

    let changed = spaces(
        &kernel,
        owner,
        "update",
        json!({ "space": space.id, "name": "Day job", "pinned": true }),
    )
    .await
    .unwrap();
    let changed: SpaceSummary = serde_json::from_value(changed).unwrap();
    assert_eq!(
        (changed.name.as_str(), changed.pinned, changed.archived),
        ("Day job", true, false)
    );
    assert!(
        root.path().join("Work").is_dir(),
        "a new name moves no folder"
    );
    let archived = spaces(
        &kernel,
        owner,
        "update",
        json!({ "space": space.id, "archived": true }),
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
        let refused = spaces(
            &kernel,
            owner,
            "update",
            json!({ "space": space.id, "name": bad }),
        )
        .await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad:?}");
    }
    let nowhere = spaces(
        &kernel,
        owner,
        "update",
        json!({ "space": SpaceId::new(), "pinned": true }),
    )
    .await;
    assert_eq!(nowhere.unwrap_err().code, Code::NotFound);

    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    let kept = &kernel.spaces().await[0];
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
        (space.id, false),
        "adding it again brings it back"
    );
}

/// Makes a scratch Space, for a Thread in No Space, under `command`.
async fn create_scratch(
    kernel: &Kernel,
    owner: PersonId,
    command: CommandId,
) -> Result<SpaceSummary, Refusal> {
    let params = json!({ "scratch": true });
    let person = Participant::Person(owner);
    let made = (kernel.call(person, "spaces.create", None, Some(command), params)).await?;
    Ok(serde_json::from_value(made).unwrap())
}

#[tokio::test]
async fn a_scratch_space_is_a_new_folder_with_no_name() {
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
    let scratch = root.path().join("scratch").canonicalize().unwrap();
    assert_eq!(Path::new(&made.folder).parent(), Some(scratch.as_path()));
    let again = create_scratch(&kernel, owner, command).await.unwrap();
    assert_eq!(again, made, "the same command gets the same Space");
    let other = create_scratch(&kernel, owner, CommandId::new()).await;
    assert_ne!(other.unwrap().folder, made.folder, "a Thread each");
    let person = Participant::Person(owner);
    add(&kernel, person, &made, "works as any Space")
        .await
        .unwrap();

    for bad in [json!({ "scratch": true, "name": "Work" }), json!({})] {
        let refused = spaces(&kernel, owner, "create", bad.clone()).await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{bad}");
    }
}

#[tokio::test]
async fn a_scratch_space_becomes_a_space_once_named_and_stays_one() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let made = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let kept = create_scratch(&kernel, owner, CommandId::new())
        .await
        .unwrap();
    let update = |params| spaces(&kernel, owner, "update", params);
    for (bad, why) in [
        (
            json!({ "space": made.id, "scratch": false }),
            "it needs a name",
        ),
        (
            json!({ "space": made.id, "name": "Expenses" }),
            "no name in No Space",
        ),
    ] {
        assert_eq!(update(bad).await.unwrap_err().code, Code::Invalid, "{why}");
    }
    let space = update(json!({ "space": made.id, "scratch": false, "name": "Expenses" }))
        .await
        .unwrap();
    let space: SpaceSummary = serde_json::from_value(space).unwrap();
    assert_eq!(
        (space.scratch, space.name.as_str(), &space.folder),
        (false, "Expenses", &made.folder),
        "it stays where it is"
    );
    let back = update(json!({ "space": made.id, "scratch": true })).await;
    assert_eq!(back.unwrap_err().code, Code::Invalid, "no way back");

    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    let spaces = kernel.spaces().await;
    let scratch = |id| spaces.iter().find(|s| s.id == id).unwrap().scratch;
    assert_eq!(
        (scratch(made.id), scratch(kept.id)),
        (false, true),
        "space.json keeps it"
    );
}

#[tokio::test]
async fn a_removed_space_loses_its_threads_but_keeps_its_files() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let person = Participant::Person(owner);
    let space = create(&kernel, owner, "Work").await;
    add(&kernel, person, &space, "a Thread's message")
        .await
        .unwrap();
    std::fs::write(root.path().join("Work/notes.md"), "mine").unwrap();

    let remove = || spaces(&kernel, owner, "remove", json!({ "space": space.id }));
    remove().await.unwrap();
    assert!(kernel.spaces().await.is_empty());
    assert_eq!(
        *notes.closed.lock().unwrap(),
        vec![space.id],
        "its modules stop what they run there"
    );
    assert_eq!(
        remove().await,
        Ok(Value::Null),
        "gone already is what was asked"
    );
    let spaces_data = root.path().join(".data/spaces");
    eventually(|| async { std::fs::read_dir(&spaces_data).unwrap().count() == 0 }).await;
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
    assert_ne!(again.id, space.id, "added again, it is a new Space");
    let listed = kernel
        .call(person, "notes.list", Some(again.id), None, Value::Null)
        .await
        .unwrap();
    assert_eq!(listed["items"], json!([]));
}

#[tokio::test]
async fn a_space_whose_folder_went_waits_to_be_located_where_it_is_now() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let person = Participant::Person(owner);
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    add(&kernel, person, &space, "kept").await.unwrap();
    let other = create(&kernel, owner, "Other").await;
    drop(kernel);
    std::fs::rename(root.path().join("Work"), root.path().join("Moved")).unwrap();

    // Still listed, missing, and nothing of it opens; but the Person still
    // names, pins or archives it.
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    let listed = kernel.spaces().await;
    let missing = listed.iter().find(|s| s.id == space.id).unwrap();
    assert!(missing.missing);
    assert!(!listed.iter().find(|s| s.id == other.id).unwrap().missing);
    let refused = add(&kernel, person, &space, "more").await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    assert!(refused.message.contains("locate it first"), "{refused:?}");
    let pinned = spaces(
        &kernel,
        owner,
        "update",
        json!({ "space": space.id, "pinned": true }),
    )
    .await
    .unwrap();
    assert_eq!(
        (pinned["pinned"].clone(), pinned["missing"].clone()),
        (json!(true), json!(true))
    );

    // A folder that is not there, or that already is a Space, is refused;
    // a Space that is not missing has nothing to locate.
    let locate = |space: SpaceId, folder: &str| {
        let folder = root.path().join(folder);
        spaces(
            &kernel,
            owner,
            "locate",
            json!({ "space": space, "folder": folder }),
        )
    };
    assert_eq!(
        locate(space.id, "Nowhere").await.unwrap_err().code,
        Code::NotFound
    );
    assert_eq!(
        locate(space.id, "Other").await.unwrap_err().code,
        Code::Conflict
    );
    assert_eq!(
        locate(other.id, "Moved").await.unwrap_err().code,
        Code::Conflict
    );

    // Located, it opens there with its Threads, and stays there.
    let located: SpaceSummary =
        serde_json::from_value(locate(space.id, "Moved").await.unwrap()).unwrap();
    assert!(!located.missing && located.pinned);
    let moved = std::fs::canonicalize(root.path().join("Moved")).unwrap();
    assert_eq!(located.folder, moved.display().to_string());
    let notes_of = |kernel: Arc<Kernel>| async move {
        let listed = kernel
            .call(person, "notes.list", Some(space.id), None, Value::Null)
            .await
            .unwrap();
        listed["items"].to_string()
    };
    assert!(notes_of(kernel.clone()).await.contains("kept"));
    drop(kernel);
    let kernel = reopen(root.path(), owner, &notes, 2).await;
    assert!(kernel.spaces().await.iter().all(|s| !s.missing));
    assert!(notes_of(kernel.clone()).await.contains("kept"));
}

#[tokio::test]
async fn a_missing_folder_added_back_opens_its_space_again() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    drop(kernel);
    let folder = root.path().join("Work");
    std::fs::rename(&folder, root.path().join("Away")).unwrap();
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    assert!(kernel.spaces().await[0].missing);
    std::fs::rename(root.path().join("Away"), &folder).unwrap();
    let again = add_folder(&kernel, owner, json!({ "folder": folder }))
        .await
        .unwrap();
    assert_eq!(again.id, space.id, "the Space it was, not a new one");
    assert!(!again.missing);
}

#[tokio::test]
async fn a_missing_space_is_removed_with_its_data() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let kernel = open(root.path(), owner, &notes).await;
    let space = create(&kernel, owner, "Work").await;
    drop(kernel);
    std::fs::remove_dir(root.path().join("Work")).unwrap();
    let kernel = reopen(root.path(), owner, &notes, 1).await;
    spaces(&kernel, owner, "remove", json!({ "space": space.id }))
        .await
        .unwrap();
    assert!(kernel.spaces().await.is_empty());
    let spaces_data = root.path().join(".data/spaces");
    eventually(|| async { std::fs::read_dir(&spaces_data).unwrap().count() == 0 }).await;
}

#[tokio::test]
async fn a_removed_space_left_half_deleted_is_cleared_on_start() {
    let root = tempfile::tempdir().unwrap();
    let (owner, notes) = (PersonId::new(), Notes::default());
    let gone = root
        .path()
        .join(".data/spaces")
        .join(format!("{}.gone", SpaceId::new()));
    std::fs::create_dir_all(&gone).unwrap();
    std::fs::write(gone.join("space.sqlite3"), "").unwrap();
    let kernel = open(root.path(), owner, &notes).await;
    assert!(kernel.spaces().await.is_empty());
    assert!(!gone.exists());
}

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
    let browse = |partial: String| spaces(&kernel, owner, "browse", json!({ "partial": partial }));
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
        ("spaces.browse", json!({ "partial": format!("{base}/") })),
        ("spaces.add", json!({ "folder": base })),
        (
            "spaces.update",
            json!({ "space": SpaceId::new(), "pinned": true }),
        ),
        ("spaces.remove", json!({ "space": SpaceId::new() })),
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
    let space = create(&kernel, owner, "Work").await;
    let module = hears.spaces.lock().unwrap()[0].clone();
    let short = Duration::from_millis(50);
    // Nothing reacts: nothing to wait for.
    assert!(module.reacted(short).await);

    let filter = EventFilter {
        module: Some("notes".into()),
        ..EventFilter::default()
    };
    let mut heard = module.react(module.at().await.unwrap(), filter);
    let person = Participant::Person(owner);
    add(&kernel, person, &space, "one").await.unwrap();
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
    add(&kernel, person, &space, "two").await.unwrap();
    assert!(module.reacted(short).await);
}
