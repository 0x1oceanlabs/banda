//! The kernel through its interface: a small test module, real SQLite in a
//! temporary folder, and the real API over a WebSocket.

use bandaso_kernel::api::Identity;
use bandaso_kernel::{
    AgentId, Call, Code, CommandId, Effect, Error, Kernel, Module, ModuleSpace, OnRestart, Outcome,
    Participant, PersonId, Refusal, Right, Settled, SpaceSummary, Tx, decode,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Notes: `add` writes a note and queues `publish`, keyed by one feed.
#[derive(Clone, Default)]
struct Notes {
    published: Arc<Mutex<Vec<String>>>,
    /// How the next runs of `publish` end; `Done` once the script is empty.
    script: Arc<Mutex<VecDeque<Outcome>>>,
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

    fn right(&self, method: &str) -> Option<Right> {
        match method {
            "add" => Some(Right::Write),
            "list" => Some(Right::Read),
            "purge" => Some(Right::Manage),
            _ => None,
        }
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
        let outcome = self
            .script
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Outcome::Done);
        if outcome == Outcome::Done {
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

async fn open(root: &Path, owner: PersonId, notes: &Notes) -> Arc<Kernel> {
    Kernel::builder(root, owner)
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
    assert!(root.path().join("Research/.bandaso/space.json").is_file());
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
    let mut again = open(root.path(), owner, &notes).await;
    for _ in 0..500 {
        if !again.spaces().await.is_empty() {
            break;
        }
        drop(again);
        tokio::time::sleep(Duration::from_millis(10)).await;
        again = open(root.path(), owner, &notes).await;
    }
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
    let space = kernel.space(space.id).await.unwrap();
    let lost = space
        .events_after(1, Default::default(), 10)
        .await
        .unwrap()
        .remove(0);
    assert_eq!(lost.payload["how"], "failed: the feed is gone");
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
    let database =
        rusqlite::Connection::open(root.path().join("Work/.bandaso/space.sqlite3")).unwrap();
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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = bandaso_kernel::api::router(kernel.clone(), Tokens { owner }, "test");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = bandaso_kernel::api::router(kernel.clone(), Tokens { owner }, "test");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
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
