//! The engine's door (ADR 0124): a real engine, its `banda devices`, and a
//! device that comes in over a WebSocket by its own key.

mod common;
// A client's socket and its frames, as the kernel's tests of the door
// have them.
#[path = "../../kernel/tests/common/mod.rs"]
mod socket;

use banda_kernel::PROTOCOL;
use banda_kernel::devices::{hello_message, welcome_message};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::SystemRandom;
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use serde_json::{Value, json};
use socket::{Socket, next, say};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// An engine of the test's own, as a window starts one, and its places.
struct Engine {
    dir: tempfile::TempDir,
    child: Child,
    /// Held open: the engine stops as it closes.
    _stdin: ChildStdin,
    /// What it said as it began to serve.
    running: Value,
}

impl Engine {
    fn start() -> Engine {
        Self::start_in(tempfile::tempdir().unwrap())
    }

    fn start_in(dir: tempfile::TempDir) -> Engine {
        let mut child = banda(&dir, &["serve", "--with-parent"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        Engine {
            dir,
            child,
            _stdin: stdin,
            running: serde_json::from_str(&line).expect("the engine says where it serves"),
        }
    }

    /// `banda` with `args`, on this engine: what it printed, as JSON.
    fn banda(&self, args: &[&str]) -> Value {
        let output = banda(&self.dir, args).output().unwrap();
        let said = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "banda {args:?}: {said}{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_str(said.trim()).unwrap()
    }

    fn door(&self) -> u64 {
        self.running["door"]
            .as_u64()
            .expect("the engine has a door")
    }

    fn host_key(&self) -> &str {
        self.running["host_key"].as_str().unwrap()
    }

    /// Stops it, and hands back its places for the next to start in.
    fn stop(mut self) -> tempfile::TempDir {
        drop(self._stdin);
        let _ = self.child.wait();
        self.dir
    }
}

/// `banda` on places of the test's own, as their owner.
fn banda(dir: &tempfile::TempDir, args: &[&str]) -> Command {
    let at = |name: &str| dir.path().join(name);
    let mut command = common::on(&at("config"));
    command
        .args(args)
        .env("BANDA_ROOT", at("root"))
        .env("BANDA_DATA", at("data"))
        .env("BANDA_STATE", at("state"))
        .env("BANDA_CACHE", at("cache"))
        .env("BANDA_THUMBNAILS", "")
        .env("BANDA_LOG", "warn")
        .env_remove("BANDA_TOKEN")
        .env_remove("BANDA_ENGINE")
        .env_remove("BANDA_PROJECT")
        .env_remove("BANDA_SPACE")
        .env_remove("BANDA_ENGINE_AS");
    command
}

fn key() -> Ed25519KeyPair {
    let made = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
    Ed25519KeyPair::from_pkcs8(made.as_ref()).unwrap()
}

fn public(key: &Ed25519KeyPair) -> String {
    URL_SAFE_NO_PAD.encode(key.public_key().as_ref())
}

const WINDOW: &str = "app://banda";
const NONCE: &str = "a-nonce-of-the-device";

/// `device` knocks at the door on `port` from Banda's window and says
/// `hello`, signed by `key`: the door's answer, and the socket.
async fn come_in(port: u64, device: &Value, key: &Ed25519KeyPair) -> (Socket, Value) {
    let mut request = format!("ws://127.0.0.1:{port}/ws")
        .into_client_request()
        .unwrap();
    (request.headers_mut()).insert("origin", WINDOW.parse().unwrap());
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let challenge = next(&mut socket).await;
    assert_eq!(challenge["type"], "challenge", "{challenge}");
    let said = hello_message(
        challenge["nonce"].as_str().unwrap(),
        challenge["host_key"].as_str().unwrap(),
        WINDOW,
        NONCE,
    );
    let hello = json!({
        "type": "hello",
        "protocol": { "min": PROTOCOL, "max": PROTOCOL },
        "device": device,
        "nonce": NONCE,
        "sig": URL_SAFE_NO_PAD.encode(key.sign(said.as_bytes())),
    });
    say(&mut socket, hello).await;
    let answer = next(&mut socket).await;
    (socket, answer)
}

/// A plain `GET` of `path` on this machine's `port`, with `headers`: the
/// answer's first line, and its body.
fn get(port: u64, path: &str, headers: &str) -> (String, String) {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port as u16)).unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{headers}\r\n"
    )
    .unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).unwrap();
    let (head, body) = answer.split_once("\r\n\r\n").unwrap_or((&answer, ""));
    (
        head.lines().next().unwrap_or_default().to_owned(),
        body.to_owned(),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn a_window_pairs_itself_and_comes_in_at_the_door_until_it_is_removed() {
    let engine = Engine::start();
    let host_key = engine.host_key().to_owned();

    // The door says who it is to a plain GET, for a person with curl.
    let (status, line) = get(engine.door(), "/", "");
    assert!(status.contains("200"), "{status}");
    assert!(
        line.starts_with("Banda on ") && line.trim_end().ends_with(&host_key),
        "{line}"
    );

    // No device yet. Its own window pairs itself, as this machine's
    // console: by the machine's name, from Banda's window's origin.
    let listed = engine.banda(&["devices", "list"]);
    assert_eq!(listed["ok"]["host_key"], host_key.as_str());
    // `banda status` says where the door is, and whose.
    let status = engine.banda(&["status"]);
    assert_eq!(status["door"], engine.running["door"]);
    assert_eq!(status["host_key"], host_key.as_str());
    assert_eq!(listed["ok"]["devices"], json!([]));
    let key = key();
    let paired = engine.banda(&["devices", "add", "--self", "--key", &public(&key)]);
    let device = &paired["ok"];
    assert_eq!(device["kind"], "desktop");
    assert_eq!(device["here"], true);
    assert_eq!(device["origin"], WINDOW);
    assert!(!device["name"].as_str().unwrap().is_empty());
    // Again, as after an update: the same record.
    let again = engine.banda(&["devices", "add", "--self", "--key", &public(&key)]);
    assert_eq!(again["ok"]["id"], device["id"]);
    assert_eq!(
        engine.banda(&["devices", "list"])["ok"]["devices"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // It comes in by its key, the host proves its own, and it is the
    // Person there: it lists the devices, as only the Person does.
    let (mut socket, welcome) = come_in(engine.door(), &device["id"], &key).await;
    assert_eq!(welcome["type"], "welcome", "{welcome}");
    let door = &welcome["door"];
    assert_eq!(door["host_key"], host_key.as_str());
    let proved = welcome_message(NONCE, serde_json::from_value(device["id"].clone()).unwrap());
    let sig = URL_SAFE_NO_PAD
        .decode(door["sig"].as_str().unwrap())
        .unwrap();
    let host = URL_SAFE_NO_PAD.decode(&host_key).unwrap();
    assert!(
        UnparsedPublicKey::new(&ED25519, host)
            .verify(proved.as_bytes(), &sig)
            .is_ok()
    );
    let call = json!({ "type": "call", "id": 1, "method": "devices.list" });
    say(&mut socket, call).await;
    assert_eq!(
        next(&mut socket).await["ok"]["devices"][0]["id"],
        device["id"]
    );

    // Another key gets nothing by its ID.
    let (_, refused) = come_in(engine.door(), &device["id"], &self::key()).await;
    assert_eq!(refused["reason"]["code"], "forbidden", "{refused}");

    // Removed by its name from the console: its session ends at once.
    let name = device["name"].as_str().unwrap();
    engine.banda(&["devices", "remove", name]);
    let goodbye = next(&mut socket).await;
    assert_eq!(goodbye["reason"]["code"], "revoked", "{goodbye}");
    let (_, after) = come_in(engine.door(), &device["id"], &key).await;
    assert_eq!(after["reason"]["code"], "revoked", "{after}");
    assert_eq!(
        engine.banda(&["devices", "list"])["ok"]["devices"],
        json!([])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_host_key_and_the_devices_outlive_the_engine() {
    let engine = Engine::start();
    let host_key = engine.host_key().to_owned();
    let key = key();
    let paired = engine.banda(&["devices", "add", "--self", "--key", &public(&key)]);
    let device = paired["ok"]["id"].clone();
    let dir = engine.stop();

    let engine = Engine::start_in(dir);
    assert_eq!(
        engine.host_key(),
        host_key,
        "the same machine, to its devices"
    );
    let (_, welcome) = come_in(engine.door(), &device, &key).await;
    assert_eq!(welcome["type"], "welcome", "{welcome}");
    // Both are the machine's own, kept from other users.
    #[cfg(unix)]
    for name in ["host.key", "devices.json"] {
        use std::os::unix::fs::PermissionsExt;
        let file = engine.dir.path().join("state").join(name);
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{name}");
    }
}

#[test]
fn the_api_is_not_reached_through_a_proxy() {
    let engine = Engine::start();
    let api = engine.running["port"].as_u64().unwrap();
    let upgrade = "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n";
    // As it is, the API takes the upgrade.
    let here = format!("127.0.0.1:{api}");
    assert!(get_upgrade(api, &here, upgrade, "").contains("101"));
    // What a proxy adds, as `tailscale serve` does, or a name that is not
    // this machine's loopback: the owner's secret is for programs here.
    for added in [
        "X-Forwarded-For: 100.64.0.7\r\n",
        "Forwarded: for=100.64.0.7\r\n",
        "Tailscale-User-Login: someone@example.com\r\n",
    ] {
        let answer = get_upgrade(api, &here, upgrade, added);
        assert!(answer.contains("403"), "{added}");
    }
    assert!(get_upgrade(api, "arc.example.ts.net", upgrade, "").contains("403"));
}

/// The first line of the answer to a WebSocket upgrade at `/ws` on this
/// machine's `port`, by a request that names it `host`, with what a proxy
/// `added`.
fn get_upgrade(port: u64, host: &str, upgrade: &str, added: &str) -> String {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port as u16)).unwrap();
    write!(
        stream,
        "GET /ws HTTP/1.1\r\nHost: {host}\r\n{upgrade}{added}\r\n"
    )
    .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    line
}
