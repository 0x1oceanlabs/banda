//! The engine's door (ADR 0124): a real engine, its `banda devices`, and a
//! device that comes in over a WebSocket by its own key.

mod common;
// A client's socket and its frames, as the kernel's tests of the door
// have them.
#[path = "../../kernel/tests/common/mod.rs"]
mod socket;

use banda_kernel::PROTOCOL;
use banda_kernel::devices::{ask_message, hello_message, paired_message, welcome_message};
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

    /// `banda` with `args`, on this engine, which refuses it: what it
    /// printed, as JSON.
    fn refused(&self, args: &[&str]) -> Value {
        let output = banda(&self.dir, args).output().unwrap();
        let said = String::from_utf8_lossy(&output.stdout);
        assert!(!output.status.success(), "banda {args:?}: {said}");
        serde_json::from_str(said.trim()).unwrap()
    }

    fn door(&self) -> u64 {
        self.running["door"]
            .as_u64()
            .expect("the engine has a door")
    }

    /// The API's port, for programs on this machine.
    fn port(&self) -> u64 {
        self.running["port"]
            .as_u64()
            .expect("the engine says its port")
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
        // The page is the test's own, where it makes one: never what a
        // checkout happens to have built.
        .env("BANDA_PAGE_FILES", at("page"))
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

#[test]
fn the_door_gives_a_browser_the_window_s_page_and_curl_its_line() {
    let dir = tempfile::tempdir().unwrap();
    let page = dir.path().join("page");
    std::fs::create_dir_all(page.join("assets")).unwrap();
    std::fs::write(
        page.join("index.html"),
        "<!doctype html><title>Banda</title>",
    )
    .unwrap();
    std::fs::write(page.join("assets/index-abc123.js"), "export {}").unwrap();
    let engine = Engine::start_in(dir);
    // A browser asks for a page, and gets Banda's.
    let (status, body) = get(engine.door(), "/", "Accept: text/html,*/*;q=0.8\r\n");
    assert!(status.contains("200"), "{status}");
    assert!(body.contains("<title>Banda</title>"), "{body}");
    let (status, body) = get(engine.door(), "/assets/index-abc123.js", "");
    assert!(status.contains("200"), "{status}");
    assert_eq!(body, "export {}");
    // `curl` still reads who the door is, and nothing leaves the folder.
    let (_, line) = get(engine.door(), "/", "");
    assert!(line.starts_with("Banda on "), "{line}");
    let (status, _) = get(engine.door(), "/../state/engine.json", "");
    assert!(status.contains("404"), "{status}");
    // The page stands behind the door's own roads, never over them: the
    // WebSocket and a file's bytes answer for themselves.
    let (status, _) = get(engine.door(), "/ws", "");
    assert!(
        !status.contains("404") && !status.contains("200"),
        "{status}"
    );
    let (status, body) = get(engine.door(), "/b/no-such-token", "Accept: text/html\r\n");
    assert!(!body.contains("<title>Banda</title>"), "{status} {body}");
    // The API's port, for programs on this machine, serves no page.
    let (status, body) = get(engine.port(), "/", "Accept: text/html\r\n");
    assert!(!body.contains("<title>Banda</title>"), "{status} {body}");
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

/// A browser's page at this machine's door, as one served from it.
const BROWSER: &str = "https://arc.example";

/// A device that holds `key` knocks at the door on `port` from a page of
/// `BROWSER` and asks to be paired as `name`: the door's answer, and the
/// socket it waits on.
async fn ask(port: u64, key: &Ed25519KeyPair, name: &str) -> (Socket, Value, Value) {
    let mut request = format!("ws://127.0.0.1:{port}/ws")
        .into_client_request()
        .unwrap();
    (request.headers_mut()).insert("origin", BROWSER.parse().unwrap());
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let challenge = next(&mut socket).await;
    let said = ask_message(
        challenge["nonce"].as_str().unwrap(),
        challenge["host_key"].as_str().unwrap(),
        BROWSER,
        &public(key),
        "browser",
        name,
    );
    let asks = json!({
        "type": "ask",
        "key": public(key),
        "name": name,
        "kind": "browser",
        "sig": URL_SAFE_NO_PAD.encode(key.sign(said.as_bytes())),
    });
    say(&mut socket, asks).await;
    let answer = next(&mut socket).await;
    (socket, challenge, answer)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_browser_asks_at_the_door_and_the_person_allows_it_by_the_code_on_its_screen() {
    let engine = Engine::start();
    let browser = key();
    let (mut socket, challenge, asked) = ask(engine.door(), &browser, "Safari on Roma's Mac").await;
    assert_eq!(asked["type"], "asked", "{asked}");
    let code = asked["code"].as_str().unwrap().to_owned();
    // Nothing is paired by asking.
    assert_eq!(
        engine.banda(&["devices", "list"])["ok"]["devices"],
        json!([])
    );

    // The Person types the code they read on the browser, at this
    // machine's console: the browser is paired from where it asked.
    let allowed = engine.banda(&["devices", "allow", &code]);
    let device = &allowed["ok"];
    assert_eq!(device["name"], "Safari on Roma's Mac");
    assert_eq!(device["kind"], "browser");
    assert_eq!(device["origin"], BROWSER);
    assert_eq!(device["key"], public(&browser).as_str());
    // The browser hears it, in the machine's own word.
    let paired = next(&mut socket).await;
    assert_eq!(paired["type"], "paired", "{paired}");
    assert_eq!(paired["device"], device["id"]);
    let said = paired_message(
        challenge["nonce"].as_str().unwrap(),
        &public(&browser),
        serde_json::from_value(device["id"].clone()).unwrap(),
    );
    let host = URL_SAFE_NO_PAD.decode(engine.host_key()).unwrap();
    let sig = URL_SAFE_NO_PAD
        .decode(paired["sig"].as_str().unwrap())
        .unwrap();
    assert!(
        UnparsedPublicKey::new(&ED25519, host)
            .verify(said.as_bytes(), &sig)
            .is_ok()
    );
    // The code is used: it allows nothing again.
    let again = engine.refused(&["devices", "allow", &code]);
    assert_eq!(again["error"]["code"], "not_found", "{again}");

    // Another asks and is refused: it is told, and stays a stranger.
    let other = key();
    let (mut socket, _, asked) = ask(engine.door(), &other, "Someone's phone").await;
    let code = asked["code"].as_str().unwrap().to_owned();
    engine.banda(&["devices", "refuse", &code]);
    let goodbye = next(&mut socket).await;
    assert_eq!(goodbye["reason"]["code"], "forbidden", "{goodbye}");
    let listed = engine.banda(&["devices", "list"]);
    assert_eq!(listed["ok"]["devices"].as_array().unwrap().len(), 1);
}

/// An `ssh` for the test, in `bin` of `here`: the machine it reaches is
/// `there`'s engine, on this one. With `-W` it carries its stdin and
/// stdout to the port named, as ssh does; else it runs the command it is
/// given on `there`'s places.
#[cfg(unix)]
fn fake_ssh(here: &tempfile::TempDir, there: &tempfile::TempDir) -> String {
    use std::os::unix::fs::PermissionsExt;
    let at = |name: &str| there.path().join(name).display().to_string();
    let script = format!(
        "#!/bin/bash\nfor arg; do last=$arg; done\nwhile [ $# -gt 0 ]; do\n  \
         if [ \"$1\" = -W ]; then\n    exec 3<>\"/dev/tcp/127.0.0.1/${{2#127.0.0.1:}}\" || exit 255\n    \
         cat <&3 &\n    cat >&3\n    kill $!\n    exit 0\n  fi\n  shift\ndone\n\
         export BANDA_CONFIG='{}' BANDA_ROOT='{}' BANDA_DATA='{}' BANDA_STATE='{}' BANDA_CACHE='{}'\n\
         exec sh -c \"$last\"\n",
        at("config"),
        at("root"),
        at("data"),
        at("state"),
        at("cache"),
    );
    let bin = here.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("ssh"), script).unwrap();
    std::fs::set_permissions(bin.join("ssh"), std::fs::Permissions::from_mode(0o755)).unwrap();
    format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    )
}

#[cfg(unix)]
#[test]
fn the_cli_pairs_by_its_ssh_login_and_acts_on_another_machine_as_a_device_of_its_own() {
    let arc = Engine::start();
    let here = tempfile::tempdir().unwrap();
    let path = fake_ssh(&here, &arc.dir);
    std::fs::create_dir_all(here.path().join("config")).unwrap();
    std::fs::write(
        here.path().join("config/hosts.toml"),
        format!(
            "[[hosts]]\nname = \"arc\"\nssh = \"roma@arc\"\nbanda = \"{}\"\n",
            env!("CARGO_BIN_EXE_banda")
        ),
    )
    .unwrap();
    let mine = |args: &[&str]| {
        let output = banda(&here, args).env("PATH", &path).output().unwrap();
        let said = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let erred = String::from_utf8_lossy(&output.stderr).into_owned();
        let value: Value = serde_json::from_str(&said).unwrap_or(Value::Null);
        (output.status.success(), value, erred)
    };

    // Not paired yet: it says how, and nothing went there.
    let (ok, refused, _) = mine(&["--host", "arc", "status"]);
    assert!(!ok);
    assert_eq!(refused["error"]["code"], "invalid", "{refused}");
    assert!(
        refused["error"]["message"]
            .as_str()
            .unwrap()
            .contains("banda pair arc"),
        "{refused}"
    );

    // Paired by the login: arc lists it as a CLI, with no origin.
    let (ok, paired, erred) = mine(&["pair", "arc"]);
    assert!(ok, "{paired} {erred}");
    assert_eq!(paired["ok"]["host_key"], arc.host_key());
    let devices = arc.banda(&["devices", "list"]);
    let device = &devices["ok"]["devices"][0];
    assert_eq!(device["id"], paired["ok"]["device"]);
    assert_eq!(device["kind"], "cli");
    assert!(
        device["name"].as_str().unwrap().ends_with("CLI"),
        "{device}"
    );
    assert!(device.get("origin").is_none_or(Value::is_null), "{device}");
    // Its key is its owner's alone.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(here.path().join("state/cli.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "{mode:o}");
    }

    // Through the door, as that device: status as arc's engine says it,
    // and a call that only the Person makes.
    let (ok, status, erred) = mine(&["--host", "arc", "status"]);
    assert!(ok, "{status} {erred}");
    assert_eq!(status["running"], true);
    assert_eq!(status["protocol"], PROTOCOL);
    let (ok, listed, erred) = mine(&["--host", "arc", "call", "devices.list"]);
    assert!(ok, "{listed} {erred}");
    assert_eq!(listed["ok"]["host_key"], arc.host_key());
    // No engine was started here, and what is this machine's alone is
    // refused there.
    assert!(!here.path().join("state/engine.json").exists());
    let (ok, refused, _) = mine(&["--host", "arc", "stop"]);
    assert!(!ok);
    assert_eq!(refused["error"]["code"], "invalid", "{refused}");

    // A door that proves another key is told nothing.
    let kept = here.path().join("state/cli-hosts.json");
    let was = std::fs::read_to_string(&kept).unwrap();
    std::fs::write(&kept, was.replace(arc.host_key(), &public(&key()))).unwrap();
    let (ok, refused, _) = mine(&["--host", "arc", "call", "devices.list"]);
    assert!(!ok);
    assert_eq!(refused["error"]["code"], "forbidden", "{refused}");
    std::fs::write(&kept, was).unwrap();

    // Removed there, it is let in no more.
    arc.banda(&["devices", "remove", device["id"].as_str().unwrap()]);
    let (ok, refused, _) = mine(&["--host", "arc", "call", "devices.list"]);
    assert!(!ok);
    assert_eq!(refused["error"]["code"], "revoked", "{refused}");
}
