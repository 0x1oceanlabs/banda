//! The limits through the kernel, as a client reads them (ADR 0043), with
//! no window open: Claude Code's read on the host with its sign-in in its
//! folder, from a stand-in of Anthropic's; Codex's from its app-server,
//! here a stand-in that answers as Codex 0.166.0 did. A read is kept in
//! the machine's store, and a failed one keeps the read before it.
// Its `codex` is a script its `#!` line runs, which Windows does not.
#![cfg(unix)]

use banda_environments::{Asks, Local, Recorded};
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::{Holes, Kernel, Participant, PersonId, Whose};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// A `codex` that answers `initialize`, `account/rateLimits/read` and
/// `account/read`.
const CODEX: &str = r#"#!/usr/bin/env node
const lines = require("readline").createInterface({ input: process.stdin })
const say = (message) => process.stdout.write(JSON.stringify(message) + "\n")
lines.on("line", (line) => {
  const { id, method } = JSON.parse(line)
  if (method === "initialize") say({ id, result: { userAgent: "codex" } })
  if (method === "account/rateLimits/read") {
    say({ method: "account/updated", params: {} })
    const week = { usedPercent: 5, windowDurationMins: 10080, resetsAt: 4102444800 }
    say({ id, result: { rateLimitsByLimitId: { codex: { primary: week, planType: "pro" } } } })
  }
  if (method === "account/read") {
    say({ id, result: { account: { type: "chatgpt", email: "p@example.com", planType: "pro" } } })
  }
})
"#;

/// Claude Code's sign-in, as it keeps it in its folder, and the address
/// it is signed in with.
fn signed_in(folder: &Path) {
    std::fs::create_dir_all(folder).unwrap();
    let login = json!({ "claudeAiOauth": {
        "accessToken": "sk-ant-oat01-secret", "expiresAt": 4_102_444_800_000_i64,
        "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x",
    }});
    std::fs::write(folder.join(".credentials.json"), login.to_string()).unwrap();
    let account = json!({ "oauthAccount": { "emailAddress": "p@example.com" } });
    std::fs::write(folder.join(".claude.json"), account.to_string()).unwrap();
}

fn list(root: &Path) -> Harnesses {
    let codex = root.join("codex");
    std::fs::write(&codex, CODEX).unwrap();
    std::fs::set_permissions(&codex, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let claude = root.join("claude");
    signed_in(&claude);
    let path = root.join("harnesses.toml");
    let text = format!(
        "[usage]\nread = false\n\n[[harness]]\nid = \"claude\"\ncommand = \"acp\"\nenv = {{ CLAUDE_CONFIG_DIR = {:?} }}\n\n\
         [[harness]]\nid = \"codex\"\ncommand = \"acp\"\n\
         cli = {{ program = {:?}, variable = \"CODEX_PATH\" }}\n\n\
         [[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = \"acp\"\n",
        claude.display().to_string(),
        codex.display().to_string()
    );
    std::fs::write(&path, text).unwrap();
    Harnesses::load(&path).unwrap()
}

/// A stand-in for Anthropic: it answers each request with what `next`
/// holds then, and keeps each request's head, in lower case.
struct Anthropic {
    url: String,
    next: Arc<Mutex<(u16, String)>>,
    heads: Arc<Mutex<Vec<String>>>,
}

impl Anthropic {
    async fn start() -> Anthropic {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api/oauth/usage", listener.local_addr().unwrap());
        let next = Arc::new(Mutex::new((500, String::new())));
        let heads: Arc<Mutex<Vec<String>>> = Arc::default();
        let (answering, hearing) = (next.clone(), Arc::clone(&heads));
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut head = Vec::new();
                let mut byte = [0; 1];
                while !head.ends_with(b"\r\n\r\n") && socket.read(&mut byte).await.unwrap() == 1 {
                    head.push(byte[0]);
                }
                let head = String::from_utf8_lossy(&head).to_lowercase();
                hearing.lock().unwrap().push(head);
                let (status, body) = answering.lock().unwrap().clone();
                let answer = format!(
                    "HTTP/1.1 {status} Said\r\ncontent-type: application/json\r\n\
                     content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(answer.as_bytes()).await.unwrap();
            }
        });
        Anthropic { url, next, heads }
    }

    fn answers(&self, status: u16, body: Value) {
        *self.next.lock().unwrap() = (status, body.to_string());
    }

    fn asked(&self) -> Vec<String> {
        self.heads.lock().unwrap().clone()
    }
}

/// The kernel, and what its environment, the host's, is asked to start.
async fn open(root: &Path, owner: PersonId, anthropic: &Anthropic) -> (Arc<Kernel>, Asks) {
    let environment = Recorded::new(Local);
    let asks = environment.asks();
    let kernel = Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("machine"))
        .environment(environment)
        .module(HarnessesModule::new(list(root)).anthropic_at(&anthropic.url))
        .open()
        .await
        .unwrap();
    (kernel, asks)
}

async fn limits(kernel: &Kernel, owner: PersonId, read: bool) -> Value {
    let person = Participant::Person(owner);
    let call = kernel.call(
        person,
        "harnesses.limits",
        None,
        None,
        json!({ "read": read }),
    );
    call.await.unwrap()
}

/// The limits once every Harness's read was kept since `since`.
async fn read_since(kernel: &Kernel, owner: PersonId, since: i64) -> Value {
    for _ in 0..500 {
        let now = limits(kernel, owner, false).await;
        let all = now["limits"].as_array().unwrap();
        let kept = |limits: &Value| {
            let read = limits["read_at"].as_i64();
            read.max(limits["failed"]["at"].as_i64()) > Some(since)
        };
        if all.iter().all(kept) {
            return now;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the limits were not read");
}

#[tokio::test]
async fn each_harnesss_limits_read_on_the_host_with_no_window_and_a_failed_read_keeps_the_last() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let anthropic = Anthropic::start().await;
    let (kernel, asks) = open(root.path(), owner, &anthropic).await;

    // Before any read: each Harness Banda can read, none other.
    let before = limits(&kernel, owner, false).await;
    let ids: Vec<&str> = (before["limits"].as_array().unwrap().iter())
        .map(|limits| limits["harness"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["claude", "codex"]);
    assert_eq!(before["warn"], 80);
    assert_eq!(before["look"], "icon");
    assert_eq!(before["limits"][0]["name"], "Claude Code");
    assert!(before["limits"][0]["read_at"].is_null());

    // No window holds the road: the engine reads Claude Code's sign-in in
    // the entry's folder and asks Anthropic itself.
    anthropic.answers(
        200,
        json!({
            "five_hour": { "utilization": 12.5, "resets_at": "2099-01-01T00:00:00Z" },
            "seven_day": { "utilization": 74, "resets_at": "2000-01-01T00:00:00Z" },
        }),
    );
    let started = banda_kernel::now_ms() - 1;
    limits(&kernel, owner, true).await;
    let read = read_since(&kernel, owner, started).await;
    let (claude, codex) = (&read["limits"][0], &read["limits"][1]);
    assert_eq!(claude["plan"], "Max 20x");
    assert_eq!(claude["email"], "p@example.com");
    assert_eq!(
        codex["email"], "p@example.com",
        "another Harness's, not shared"
    );
    assert_eq!(claude["windows"][0]["label"], "Session");
    assert_eq!(claude["windows"][0]["used"], 12.5);
    assert_eq!(
        claude["windows"][1]["used"], 0.0,
        "a window whose reset passed is spent none, till the next read"
    );
    assert_eq!(codex["plan"], "Pro");
    assert_eq!(codex["windows"][0]["label"], "Weekly");
    assert_eq!(codex["windows"][0]["used"], 5.0);
    assert_eq!(codex["windows"][0]["resets_at"], 4_102_444_800_000_i64);
    // Codex's app-server is a Harness's CLI: it starts in the machine's
    // environment, never by the module itself (ADR 0084, decision 4), and
    // behind the fence, with no Project's grants (ADR 0083, decision 1).
    let servers = asks.of("codex");
    let [server] = &servers[..] else {
        panic!("one app-server: {servers:?}");
    };
    assert_eq!(server.program.args.last().unwrap(), "app-server");
    let whose = (server.program.whose(), server.program.holes());
    assert_eq!(whose, (Whose::HarnessProbe, Some(&Holes::default())));
    let asked = anthropic.asked();
    assert_eq!(asked.len(), 1);
    assert!(
        asked[0].contains("authorization: bearer sk-ant-oat01-secret\r\n"),
        "{}",
        asked[0]
    );
    assert!(
        !read.to_string().contains("secret"),
        "the token is in nothing kept"
    );

    // Asked again within a minute, nothing is read again.
    limits(&kernel, owner, true).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(anthropic.asked().len(), 1, "read again");

    // The next run reads anew; Anthropic asks it to wait, and the last
    // read stays, with why.
    drop(kernel);
    let (kernel, _) = open(root.path(), owner, &anthropic).await;
    let kept = limits(&kernel, owner, false).await;
    assert_eq!(
        kept["limits"][0]["windows"][0]["used"], 12.5,
        "kept on the machine"
    );
    anthropic.answers(429, json!({}));
    let started = banda_kernel::now_ms() - 1;
    limits(&kernel, owner, true).await;
    let failed = read_since(&kernel, owner, started).await;
    let claude = &failed["limits"][0];
    assert_eq!(claude["windows"][0]["used"], 12.5);
    assert!(claude["failed"]["why"].as_str().unwrap().contains("wait"));

    // Off in harnesses.toml: no Harness's limits are read.
    let path = root.path().join("harnesses.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, format!("{text}\n[limits]\nread = false\n")).unwrap();
    assert_eq!(limits(&kernel, owner, true).await["limits"], json!([]));
}
