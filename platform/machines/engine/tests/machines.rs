//! The machines module through the kernel and its API, as a window uses
//! it (ADR 0095): the welcome names the machine, `machine.named` streams
//! it and each change, the settings' `set` writes machine.toml, a change
//! by hand is heard too, and an Agent names nothing, nor says when the
//! machine stays awake: its set, reset and rename are refused.

use banda_kernel::api::OwnerSecret;
use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, MachineIcon, Named, Participant, PersonId, ProjectId,
};
use banda_keys::KeysModule;
use banda_machines::{Machine, Machines};
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn found() -> Named {
    Named {
        name: "arc".to_owned(),
        icon: MachineIcon::Server,
    }
}

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    let config = root.join("config");
    let machine = Machine::new(&config, found());
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .named(machine.named())
        .module(Machines::new(machine))
        .module(KeysModule::new(config))
        .open()
        .await
        .unwrap()
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Serves the kernel's API on a free port of this machine.
async fn serve(kernel: &Arc<Kernel>, owner: PersonId) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let identity = OwnerSecret {
        secret: "secret".to_owned(),
        owner,
    };
    let app = banda_kernel::api::router(kernel.clone(), identity, "test");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    address
}

/// Says hello as the owner: the socket, and its welcome.
async fn connect(address: std::net::SocketAddr) -> (Socket, Value) {
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
        .await
        .unwrap();
    let hello = json!({ "type": "hello", "protocol": 1, "token": "secret" });
    send(&mut socket, hello).await;
    let welcome = next(&mut socket).await;
    (socket, welcome)
}

async fn send(socket: &mut Socket, frame: Value) {
    socket.send(Message::text(frame.to_string())).await.unwrap();
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

/// Hears `machine.named`, which names no Project, and its first piece:
/// the name and icon now.
async fn hear(socket: &mut Socket) -> Value {
    let stream = json!({ "type": "stream", "id": 1, "method": "machine.named" });
    send(socket, stream).await;
    assert_eq!(next(socket).await["ok"]["stream"], 1);
    piece(socket).await
}

/// The next piece `machine.named` says.
async fn piece(socket: &mut Socket) -> Value {
    let frame = next(socket).await;
    assert_eq!(
        (&frame["type"], &frame["stream"]),
        (&json!("piece"), &json!(1)),
        "{frame}"
    );
    frame["data"].clone()
}

/// Calls `method` with `params` as the Person: its result.
async fn call(socket: &mut Socket, id: u64, method: &str, params: Value) -> Value {
    let call = json!({
        "type": "call", "id": id, "method": method,
        "command": CommandId::new(), "params": params,
    });
    send(socket, call).await;
    let frame = next(socket).await;
    assert_eq!(
        (&frame["type"], &frame["id"]),
        (&json!("result"), &json!(id)),
        "{frame}"
    );
    frame
}

/// Sets `key` of machine.toml to `value`, as Settings does.
async fn set(socket: &mut Socket, id: u64, key: &str, value: &str) -> Value {
    let params = json!({ "file": "machine.toml", "key": key, "value": value });
    call(socket, id, "keys.settings_set", params).await
}

fn machine_toml(root: &Path) -> String {
    std::fs::read_to_string(root.join("config/machine.toml")).unwrap_or_default()
}

#[tokio::test]
async fn the_welcome_names_the_machine_and_machine_named_says_each_change() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let address = serve(&kernel, owner).await;

    let (mut socket, welcome) = connect(address).await;
    assert_eq!(welcome["type"], "welcome");
    let arc = json!({ "name": "arc", "icon": "server" });
    assert_eq!(welcome["named"], arc);
    assert_eq!(hear(&mut socket).await, arc, "the stream starts with it");

    let result = set(&mut socket, 2, "name", "\"studio\"").await;
    assert!(result["ok"].is_string(), "{result}");
    let studio = json!({ "name": "studio", "icon": "server" });
    assert_eq!(piece(&mut socket).await, studio);
    set(&mut socket, 3, "icon", "\"tower\"").await;
    let tower = json!({ "name": "studio", "icon": "tower" });
    assert_eq!(piece(&mut socket).await, tower);
    let text = machine_toml(root.path());
    assert!(
        text.starts_with("#:schema ./schemas/machine.schema.json\n"),
        "{text}"
    );
    assert!(
        text.contains("name = \"studio\"\nicon = \"tower\""),
        "{text}"
    );

    let (mut later, welcome) = connect(address).await;
    assert_eq!(welcome["named"], tower, "every window after it is told");
    let got = call(&mut later, 4, "machines.get", json!({})).await;
    let mut naming = json!({ "name": "studio", "icon": "tower", "found": arc });
    // And what it is, in words, where the system says.
    let about = banda_machines::about();
    assert!(about.system.is_some(), "every system this runs on says");
    for (key, said) in [("system", about.system), ("model", about.model)] {
        if let Some(said) = said {
            naming[key] = json!(said);
        }
    }
    assert_eq!(got["ok"], naming);

    // Taken out: what Banda found.
    let params = json!({ "file": "machine.toml", "key": "name" });
    call(&mut socket, 5, "keys.settings_reset", params).await;
    assert_eq!(
        piece(&mut socket).await,
        json!({ "name": "arc", "icon": "tower" })
    );

    // Refused, and nothing written.
    let text = machine_toml(root.path());
    let long = set(&mut socket, 6, "name", "\"a-name-of-17-char\"").await;
    assert_eq!(long["error"]["code"], "invalid", "{long}");
    let message = long["error"]["message"].as_str().unwrap();
    assert!(message.contains("16 characters"), "{message}");
    let toaster = set(&mut socket, 7, "icon", "\"toaster\"").await;
    assert_eq!(toaster["error"]["code"], "invalid", "{toaster}");
    assert_eq!(machine_toml(root.path()), text);
}

#[tokio::test]
async fn a_change_by_hand_is_heard_as_the_settings_set_is() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let address = serve(&kernel, owner).await;
    let (mut socket, _) = connect(address).await;
    hear(&mut socket).await;

    // Another file of the folder changes no name, and says nothing.
    let config = root.path().join("config");
    std::fs::write(config.join("look.toml"), "radius = 4\n").unwrap();
    std::fs::write(config.join("machine.toml"), "name = \"by-hand\"\n").unwrap();
    let by_hand = json!({ "name": "by-hand", "icon": "server" });
    assert_eq!(piece(&mut socket).await, by_hand);
    let (_, welcome) = connect(address).await;
    assert_eq!(welcome["named"], by_hand);

    // An icon Banda has not is what it found.
    std::fs::write(config.join("machine.toml"), "icon = \"toaster\"\n").unwrap();
    assert_eq!(
        piece(&mut socket).await,
        json!({ "name": "arc", "icon": "server" })
    );
}

#[tokio::test]
async fn an_agent_hears_the_name_and_names_no_machine() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let person = Participant::Person(owner);
    let work = json!({ "name": "Work" });
    let work = kernel.call(
        person,
        "projects.create",
        None,
        Some(CommandId::new()),
        work,
    );
    let work: ProjectId = serde_json::from_value(work.await.unwrap()["id"].clone()).unwrap();
    let agent = Participant::Agent(AgentId::new());
    let callers = [
        Caller::from(agent),
        // Under a pass, walled in its Project.
        Caller {
            participant: agent,
            only: Some(work),
        },
    ];
    for caller in callers {
        let changes = [
            (
                "keys.settings_set",
                json!({ "key": "name", "value": "\"m1pro\"" }),
            ),
            ("keys.settings_reset", json!({ "key": "icon" })),
            // Nor keeps it awake on power (ADR 0097, decision 2).
            (
                "keys.settings_set",
                json!({ "key": "awake-plugged-in", "value": "true" }),
            ),
            (
                "keys.settings_rename",
                json!({ "key": "name", "to": "icon" }),
            ),
        ];
        for (method, mut params) in changes {
            params["file"] = json!("machine.toml");
            let command = Some(CommandId::new());
            let refused = kernel
                .call(caller, method, None, command, params)
                .await
                .unwrap_err();
            assert_eq!(
                refused.code,
                Code::Forbidden,
                "{caller:?} {method}: {refused:?}"
            );
        }

        let mut named = kernel
            .stream(caller, "machine.named", None, Value::Null)
            .await
            .unwrap();
        let heard = named.recv().await.unwrap();
        assert_eq!(heard, json!({ "name": "arc", "icon": "server" }));
    }
    assert_eq!(machine_toml(root.path()), "");
}
