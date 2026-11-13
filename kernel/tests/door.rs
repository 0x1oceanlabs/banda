//! The door through its interface (ADR 0124): a machine with a host key
//! and the devices it paired, and devices that come in over a WebSocket by
//! their own keys.

use banda_kernel::devices::{
    self, Device, Devices, PROTOCOLS, challenge_message, hello_message, welcome_message,
};
use banda_kernel::{
    Call, DeviceId, Kernel, Kind, Module, PROTOCOL, PersonId, Refusal, Right, Scope,
};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures::StreamExt;
use ring::rand::SystemRandom;
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

mod common;
use common::{Socket, next, say};

fn key() -> Ed25519KeyPair {
    let made = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
    Ed25519KeyPair::from_pkcs8(made.as_ref()).unwrap()
}

fn public(key: &Ed25519KeyPair) -> [u8; 32] {
    key.public_key().as_ref().try_into().unwrap()
}

/// A machine's host key and the devices it paired, as an engine keeps
/// them.
#[derive(Clone)]
struct Paired {
    host: Arc<Ed25519KeyPair>,
    known: Arc<Mutex<HashMap<DeviceId, Device>>>,
    removals: Arc<tokio::sync::watch::Sender<u64>>,
}

impl Paired {
    fn pair(&self, key: &Ed25519KeyPair, person: PersonId, origin: Option<&str>) -> DeviceId {
        let id = DeviceId::new();
        let device = Device {
            key: public(key),
            person,
            origin: origin.map(str::to_owned),
            removed: false,
        };
        self.known.lock().unwrap().insert(id, device);
        id
    }

    /// Removes a device as an engine does: its record says so, then its
    /// sessions hear.
    fn remove(&self, id: DeviceId) {
        (self.known.lock().unwrap().get_mut(&id).unwrap()).removed = true;
        self.removals.send_modify(|removed| *removed += 1);
    }
}

impl Devices for Paired {
    fn host_key(&self) -> [u8; 32] {
        public(&self.host)
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        self.host.sign(message).as_ref().try_into().unwrap()
    }

    fn device(&self, id: DeviceId) -> Option<Device> {
        self.known.lock().unwrap().get(&id).cloned()
    }

    fn removals(&self) -> tokio::sync::watch::Receiver<u64> {
        self.removals.subscribe()
    }
}

/// `seen.device` answers the device its caller's session came by.
struct Seen;

#[async_trait::async_trait]
impl Module for Seen {
    fn name(&self) -> &'static str {
        "seen"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        (method == "device").then_some(Right::Read)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        (method == "device").then_some(Kind::Call)
    }

    async fn call(&self, call: Call, _method: &str, _params: Value) -> Result<Value, Refusal> {
        Ok(json!({ "device": call.device(), "participant": call.participant() }))
    }
}

/// A machine with a door, and one device paired from Banda's window.
struct World {
    _root: tempfile::TempDir,
    owner: PersonId,
    paired: Paired,
    address: std::net::SocketAddr,
    device: DeviceId,
    key: Ed25519KeyPair,
}

const WINDOW: &str = "app://banda";

async fn world() -> World {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let paired = Paired {
        host: Arc::new(key()),
        known: Default::default(),
        removals: Arc::new(tokio::sync::watch::channel(0).0),
    };
    let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
        .machine(root.path().join(".machine"))
        .module(Seen)
        .open()
        .await
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let door = devices::router(kernel, paired.clone(), "test");
    tokio::spawn(async move { axum::serve(listener, door).await.unwrap() });
    let key = key();
    let device = paired.pair(&key, owner, Some(WINDOW));
    World {
        _root: root,
        owner,
        paired,
        address,
        device,
        key,
    }
}

/// A connection to the door from a page of `origin`, and its challenge.
async fn knock(address: std::net::SocketAddr, origin: Option<&str>) -> (Socket, Value) {
    let mut request = format!("ws://{address}/ws").into_client_request().unwrap();
    if let Some(origin) = origin {
        (request.headers_mut()).insert("origin", origin.parse().unwrap());
    }
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let challenge = next(&mut socket).await;
    assert_eq!(challenge["type"], "challenge");
    (socket, challenge)
}

const NONCE: &str = "a-nonce-of-the-device";

/// The `hello` of `device`, signed by `key` over what `challenge` said,
/// for a page of `origin`.
fn hello(device: DeviceId, key: &Ed25519KeyPair, challenge: &Value, origin: &str) -> Value {
    let message = hello_message(
        challenge["nonce"].as_str().unwrap(),
        challenge["host_key"].as_str().unwrap(),
        origin,
        NONCE,
    );
    json!({
        "type": "hello",
        "protocol": { "min": PROTOCOL, "max": PROTOCOL },
        "device": device,
        "nonce": NONCE,
        "sig": URL_SAFE_NO_PAD.encode(key.sign(message.as_bytes())),
    })
}

/// Whether `sig` is `key`'s signature of `message`.
fn signed(key: [u8; 32], message: &str, sig: &Value) -> bool {
    let sig = URL_SAFE_NO_PAD.decode(sig.as_str().unwrap()).unwrap();
    UnparsedPublicKey::new(&ED25519, key)
        .verify(message.as_bytes(), &sig)
        .is_ok()
}

/// The device's session, welcomed.
async fn come_in(world: &World) -> (Socket, Value) {
    let (mut socket, challenge) = knock(world.address, Some(WINDOW)).await;
    say(
        &mut socket,
        hello(world.device, &world.key, &challenge, WINDOW),
    )
    .await;
    let welcome = next(&mut socket).await;
    assert_eq!(welcome["type"], "welcome", "{welcome}");
    (socket, welcome)
}

#[tokio::test]
async fn a_paired_device_comes_in_by_its_key_and_the_host_proves_its_own() {
    let world = world().await;
    let host = world.paired.host_key();
    let (mut socket, challenge) = knock(world.address, Some(WINDOW)).await;

    // The door speaks first, and signs what it says with the host key.
    let host_key = challenge["host_key"].as_str().unwrap();
    assert_eq!(host_key, URL_SAFE_NO_PAD.encode(host));
    let nonce = challenge["nonce"].as_str().unwrap();
    assert_eq!(URL_SAFE_NO_PAD.decode(nonce).unwrap().len(), 32);
    assert_eq!(challenge["protocol"], json!(PROTOCOLS));
    let time = challenge["time"].as_i64().unwrap();
    let said = challenge_message(nonce, host_key, time, PROTOCOLS);
    assert!(signed(host, &said, &challenge["sig"]));

    say(
        &mut socket,
        hello(world.device, &world.key, &challenge, WINDOW),
    )
    .await;
    let welcome = next(&mut socket).await;
    assert_eq!(welcome["type"], "welcome", "{welcome}");
    assert_eq!(welcome["protocol"], PROTOCOL);
    let door = &welcome["door"];
    assert_eq!(door["host_key"], host_key);
    assert_eq!(door["device"], json!(world.device));
    // Signed over the device's own nonce: no pipe that repeats an old
    // challenge makes it.
    let proved = welcome_message(NONCE, world.device);
    assert!(signed(host, &proved, &door["sig"]));
    assert!(!signed(public(&key()), &proved, &door["sig"]));

    // From here the frames are the API's, and the device is the Person
    // who paired it: every call names it.
    say(
        &mut socket,
        json!({ "type": "call", "id": 1, "method": "seen.device" }),
    )
    .await;
    let seen = next(&mut socket).await;
    assert_eq!(seen["ok"]["device"], json!(world.device), "{seen}");
    assert_eq!(seen["ok"]["participant"]["id"], json!(world.owner));
    let creating = json!({
        "type": "call", "id": 2, "method": "projects.create",
        "command": banda_kernel::CommandId::new(), "params": { "name": "Work" }
    });
    say(&mut socket, creating).await;
    assert_eq!(next(&mut socket).await["ok"]["name"], "Work");
}

#[tokio::test]
async fn the_door_takes_no_owner_s_secret_and_no_pass() {
    let world = world().await;
    // The API's `hello`: a token, as the owner's secret and a pass are.
    for token in ["secret", "bp_an-agents-pass"] {
        let (mut socket, _) = knock(world.address, Some(WINDOW)).await;
        let api = json!({ "type": "hello", "protocol": PROTOCOL, "token": token });
        say(&mut socket, api).await;
        let goodbye = next(&mut socket).await;
        assert_eq!(goodbye["type"], "goodbye", "{goodbye}");
        assert_eq!(goodbye["reason"]["code"], "forbidden");
    }
}

#[tokio::test]
async fn a_hello_that_does_not_fit_this_connection_this_machine_and_its_origin_is_refused() {
    let world = world().await;
    let refused = async |origin: Option<&str>, hello: &dyn Fn(&Value) -> Value| {
        let (mut socket, challenge) = knock(world.address, origin).await;
        say(&mut socket, hello(&challenge)).await;
        let goodbye = next(&mut socket).await;
        assert_eq!(goodbye["type"], "goodbye", "{goodbye}");
        assert_eq!(goodbye["reason"]["code"], "forbidden", "{goodbye}");
    };
    let (device, key) = (world.device, &world.key);

    // Heard on another connection: its nonce is not this one's.
    let (_other, heard) = knock(world.address, Some(WINDOW)).await;
    let replayed = hello(device, key, &heard, WINDOW);
    refused(Some(WINDOW), &|_| replayed.clone()).await;

    // Signed for another machine's host key.
    let elsewhere = URL_SAFE_NO_PAD.encode(public(&self::key()));
    refused(Some(WINDOW), &|challenge| {
        let carried = json!({ "nonce": challenge["nonce"], "host_key": elsewhere });
        hello(device, key, &carried, WINDOW)
    })
    .await;

    // From a page elsewhere, whatever origin it signs: the device paired
    // from Banda's window.
    let page = "https://elsewhere.example";
    refused(Some(page), &|challenge| hello(device, key, challenge, page)).await;
    refused(Some(page), &|challenge| {
        hello(device, key, challenge, WINDOW)
    })
    .await;
    refused(None, &|challenge| hello(device, key, challenge, "")).await;

    // Another key, and a device this machine never paired.
    let stranger = self::key();
    refused(Some(WINDOW), &|challenge| {
        hello(device, &stranger, challenge, WINDOW)
    })
    .await;
    refused(Some(WINDOW), &|challenge| {
        hello(DeviceId::new(), key, challenge, WINDOW)
    })
    .await;
}

#[tokio::test]
async fn a_device_whose_protocols_this_engine_does_not_speak_is_told_which_it_does() {
    let world = world().await;
    let (mut socket, challenge) = knock(world.address, Some(WINDOW)).await;
    let mut newer = hello(world.device, &world.key, &challenge, WINDOW);
    newer["protocol"] = json!({ "min": PROTOCOL + 1, "max": PROTOCOL + 3 });
    say(&mut socket, newer).await;
    let goodbye = next(&mut socket).await;
    assert_eq!(goodbye["reason"]["code"], "protocol", "{goodbye}");

    // A range that holds this engine's is welcomed at the newest both speak.
    let (mut socket, challenge) = knock(world.address, Some(WINDOW)).await;
    let mut wider = hello(world.device, &world.key, &challenge, WINDOW);
    wider["protocol"] = json!({ "min": 0, "max": PROTOCOL + 3 });
    say(&mut socket, wider).await;
    assert_eq!(next(&mut socket).await["protocol"], PROTOCOL);
}

#[tokio::test]
async fn a_removed_device_loses_its_sessions_at_once_and_opens_no_other() {
    let world = world().await;
    let (mut socket, _) = come_in(&world).await;
    // Another device's session goes on.
    let other_key = key();
    let other = world.paired.pair(&other_key, world.owner, None);
    let (mut theirs, challenge) = knock(world.address, None).await;
    say(&mut theirs, hello(other, &other_key, &challenge, "")).await;
    assert_eq!(next(&mut theirs).await["type"], "welcome");

    world.paired.remove(world.device);
    let goodbye = next(&mut socket).await;
    assert_eq!(goodbye["type"], "goodbye", "{goodbye}");
    assert_eq!(goodbye["reason"]["code"], "revoked");
    let ended = tokio::time::timeout(Duration::from_secs(5), socket.next()).await;
    assert!(
        !matches!(ended, Ok(Some(Ok(Message::Text(_))))),
        "its session ended"
    );

    say(
        &mut theirs,
        json!({ "type": "call", "id": 1, "method": "seen.device" }),
    )
    .await;
    assert_eq!(next(&mut theirs).await["ok"]["device"], json!(other));

    // It opens no other, and is told why, to pair again; whoever only
    // knows its ID is told no more than a stranger.
    let (mut again, challenge) = knock(world.address, Some(WINDOW)).await;
    say(
        &mut again,
        hello(world.device, &world.key, &challenge, WINDOW),
    )
    .await;
    assert_eq!(next(&mut again).await["reason"]["code"], "revoked");
    let (mut posing, challenge) = knock(world.address, Some(WINDOW)).await;
    say(&mut posing, hello(world.device, &key(), &challenge, WINDOW)).await;
    assert_eq!(next(&mut posing).await["reason"]["code"], "forbidden");
}

#[tokio::test]
async fn a_device_removed_as_it_comes_in_gets_no_session_that_outlives_it() {
    // Removed between its `hello` and its `welcome`, or just after: the
    // session hears of removals from before its record was read.
    let world = world().await;
    let (mut socket, challenge) = knock(world.address, Some(WINDOW)).await;
    world.paired.remove(world.device);
    say(
        &mut socket,
        hello(world.device, &world.key, &challenge, WINDOW),
    )
    .await;
    assert_eq!(next(&mut socket).await["reason"]["code"], "revoked");
}
