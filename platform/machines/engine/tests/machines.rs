//! The machines module through the kernel and its API, as a window uses
//! it (ADR 0095): the welcome names the machine, `machine.named` streams
//! it and each change, the settings' `set` writes machine.toml, a change
//! by hand is heard too, and an Agent names nothing, nor says when the
//! machine stays awake: its set, reset and rename are refused.
//! `machine.power` says the battery and why the machine is awake, and
//! each change of them (ADR 0097).

use banda_kernel::api::OwnerSecret;
use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, MachineIcon, Named, Participant, PersonId, ProjectId,
    Working,
};
use banda_keys::KeysModule;
use banda_machines::awake::{self, Why};
use banda_machines::power::{Battery, Meter, Source};
use banda_machines::{Machine, Machines};
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

fn found() -> Named {
    Named {
        name: "arc".to_owned(),
        icon: MachineIcon::Server,
    }
}

const DISCHARGING: Battery = Battery {
    percent: 42,
    charging: false,
    on_power: false,
    left: Some(122),
};

/// A battery the test says, as a machine's system says it.
struct Said(watch::Receiver<Option<Battery>>);

#[async_trait::async_trait]
impl Source for Said {
    async fn read(&mut self) -> Option<Battery> {
        *self.0.borrow_and_update()
    }

    async fn changed(&mut self) {
        if self.0.changed().await.is_err() {
            std::future::pending().await
        }
    }
}

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    let (_, battery) = watch::channel(Some(DISCHARGING));
    let (_, awake) = watch::channel(None);
    let meter = Meter::with(Said(battery), awake, Duration::from_secs(60));
    open_with(root, owner, meter).await
}

/// The kernel, its `machine.power` read by `meter`.
async fn open_with(root: &Path, owner: PersonId, meter: Meter) -> Arc<Kernel> {
    let config = root.join("config");
    let machine = Machine::new(&config, found());
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .named(machine.named())
        .power(move || meter.stream())
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
    piece_of(socket, 1).await
}

/// The next piece the stream `id` says.
async fn piece_of(socket: &mut Socket, id: u64) -> Value {
    let frame = next(socket).await;
    assert_eq!(
        (&frame["type"], &frame["stream"]),
        (&json!("piece"), &json!(id)),
        "{frame}"
    );
    frame["data"].clone()
}

/// No frame within a while.
async fn no_frame(socket: &mut Socket) {
    let heard = tokio::time::timeout(Duration::from_millis(300), socket.next()).await;
    assert!(heard.is_err(), "{heard:?}");
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
    let mut naming = json!({
        "name": "studio", "icon": "tower", "found": arc,
        "awake": { "while_working": true, "plugged_in": false },
    });
    // And what it is, in words, where the system says.
    let about = banda_machines::about();
    assert!(about.system.is_some(), "every system this runs on says");
    for (key, said) in [("system", about.system), ("model", about.model)] {
        if let Some(said) = said {
            naming[key] = json!(said);
        }
    }
    // Whether it has a battery is this machine's own: one or the other.
    let mut got = got["ok"].clone();
    let battery = got.as_object_mut().unwrap().remove("battery");
    assert!(battery.is_some_and(|battery| battery.is_boolean()));
    assert_eq!(got, naming);

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

    // Kept awake on power: `get` says it at once, as another machine's
    // window reads it back (ADR 0097).
    let result = set(&mut socket, 8, "awake-plugged-in", "true").await;
    assert!(result["ok"].is_string(), "{result}");
    let got = call(&mut later, 9, "machines.get", json!({})).await;
    let awake = json!({ "while_working": true, "plugged_in": true });
    assert_eq!(got["ok"]["awake"], awake);
}

#[tokio::test]
async fn machine_power_says_the_battery_and_why_the_machine_is_awake_as_they_change() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    // The engine's own wiring, with a battery of the test's: a Turn
    // counted by the kernel's Working holds the machine awake, as the
    // agents module counts each.
    let machine = Machine::new(root.path().join("config"), found());
    let working = Working::new();
    let keeping = awake::keep(working.count(), machine.awake());
    let (battery, said) = watch::channel(Some(DISCHARGING));
    let meter = Meter::with(Said(said), keeping.why(), Duration::from_secs(60));
    let kernel = open_with(root.path(), owner, meter).await;
    let address = serve(&kernel, owner).await;
    let (mut socket, _) = connect(address).await;

    let stream = json!({ "type": "stream", "id": 2, "method": "machine.power" });
    send(&mut socket, stream).await;
    assert_eq!(next(&mut socket).await["ok"]["stream"], 2);
    let first = json!({
        "battery": { "percent": 42, "charging": false, "on_power": false, "left": 122 },
        "awake": null,
    });
    assert_eq!(piece_of(&mut socket, 2).await, first, "as it opens");

    battery.send_replace(Some(Battery {
        percent: 41,
        ..DISCHARGING
    }));
    let lower = piece_of(&mut socket, 2).await;
    assert_eq!(lower["battery"]["percent"], 41, "{lower}");

    // Read again, the same words: nothing said.
    battery.send_modify(|_| {});
    no_frame(&mut socket).await;

    // A Turn runs: the machine is held awake, and says why, where its
    // system holds it; Windows holds nothing yet, and says no why.
    let holds = cfg!(any(target_os = "linux", target_os = "macos"));
    let why = if holds { json!("working") } else { Value::Null };
    let turn = working.hold();
    if holds {
        let working_now = piece_of(&mut socket, 2).await;
        assert_eq!(working_now["awake"], why, "{working_now}");
        assert_eq!(working_now["battery"], lower["battery"]);
    } else {
        no_frame(&mut socket).await;
    }
    // It ends: held still, for the tail after it.
    drop(turn);
    no_frame(&mut socket).await;
    assert_eq!(*keeping.why().borrow(), holds.then_some(Why::Working));

    // Plugged in, and charging, with no time known yet.
    let charging = Battery {
        charging: true,
        on_power: true,
        left: None,
        ..DISCHARGING
    };
    battery.send_replace(Some(charging));
    assert_eq!(
        piece_of(&mut socket, 2).await,
        json!({
            "battery": { "percent": 42, "charging": true, "on_power": true },
            "awake": why,
        })
    );

    // Another window hears it as it is.
    let (mut later, _) = connect(address).await;
    let stream = json!({ "type": "stream", "id": 1, "method": "machine.power" });
    send(&mut later, stream).await;
    assert_eq!(next(&mut later).await["ok"]["stream"], 1);
    assert_eq!(piece(&mut later).await["battery"]["charging"], true);
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
    let agent = AgentId::new();
    let callers = [
        Caller::from(Participant::Agent(agent)),
        // Under a pass, walled in its Project.
        Caller::agent(agent, work),
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
                .call(caller.clone(), method, None, command, params)
                .await
                .unwrap_err();
            assert_eq!(
                refused.code,
                Code::Forbidden,
                "{caller:?} {method}: {refused:?}"
            );
        }

        let mut named = kernel
            .stream(caller.clone(), "machine.named", None, Value::Null)
            .await
            .unwrap();
        let heard = named.recv().await.unwrap();
        assert_eq!(heard, json!({ "name": "arc", "icon": "server" }));

        // And the battery, as the name (ADR 0097).
        let mut power = kernel
            .stream(caller, "machine.power", None, Value::Null)
            .await
            .unwrap();
        let heard = power.recv().await.unwrap();
        assert_eq!(heard["battery"]["percent"], 42, "{heard}");
    }
    assert_eq!(machine_toml(root.path()), "");
}
