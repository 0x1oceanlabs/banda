//! The limits through the kernel, as a window reads them (ADR 0043):
//! Claude Code's through the window's main, which answers what Anthropic
//! said; Codex's from its app-server, here a stand-in that answers as
//! Codex 0.166.0 did. A read is kept in the machine's store, and a failed
//! one keeps the read before it.

use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::{Kernel, Participant, PersonId, Stream};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

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

fn list(root: &Path) -> Harnesses {
    let codex = root.join("codex");
    std::fs::write(&codex, CODEX).unwrap();
    std::fs::set_permissions(&codex, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let path = root.join("harnesses.toml");
    let text = format!(
        "[usage]\nread = false\n\n[[harness]]\nid = \"claude\"\ncommand = \"acp\"\nenv = {{ CLAUDE_CONFIG_DIR = \"/work/claude\" }}\n\n\
         [[harness]]\nid = \"codex\"\ncommand = \"acp\"\n\
         cli = {{ program = {:?}, variable = \"CODEX_PATH\" }}\n\n\
         [[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = \"acp\"\n",
        codex.display().to_string()
    );
    std::fs::write(&path, text).unwrap();
    Harnesses::load(&path).unwrap()
}

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("machine"))
        .module(HarnessesModule::new(list(root)))
        .open()
        .await
        .unwrap()
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

/// Answers the window's next request, which must ask for Claude Code's
/// usage, with `ok`.
async fn answer(kernel: &Kernel, owner: PersonId, window: &mut Stream, ok: Value) {
    let asked = window.recv().await.unwrap();
    assert_eq!(asked["method"], "harnesses.claude_usage");
    assert_eq!(asked["params"], json!({ "config": "/work/claude" }));
    let answer = json!({ "request": asked["id"], "ok": ok });
    let person = Participant::Person(owner);
    (kernel
        .call(person, "window.answer", None, None, answer)
        .await)
        .unwrap();
}

#[tokio::test]
async fn a_window_reads_each_harnesss_limits_and_a_failed_read_keeps_the_last() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let person = Participant::Person(owner);

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

    let mut window = (kernel.stream(person, "window.requests", None, Value::Null))
        .await
        .unwrap();
    let started = banda_kernel::now_ms() - 1;
    limits(&kernel, owner, true).await;
    let usage = json!({
        "signed_in": true, "subscription": "max", "tier": "default_claude_max_20x",
        "email": "p@example.com", "status": 200,
        "body": {
            "five_hour": { "utilization": 12.5, "resets_at": "2099-01-01T00:00:00Z" },
            "seven_day": { "utilization": 74, "resets_at": "2000-01-01T00:00:00Z" },
        },
    });
    answer(&kernel, owner, &mut window, usage).await;
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

    // Asked again within a minute, nothing is read again.
    limits(&kernel, owner, true).await;
    let again = tokio::time::timeout(Duration::from_millis(300), window.recv()).await;
    assert!(again.is_err(), "read again: {again:?}");

    // The next run reads anew; Anthropic asks it to wait, and the last
    // read stays, with why.
    drop(window);
    drop(kernel);
    let kernel = open(root.path(), owner).await;
    let kept = limits(&kernel, owner, false).await;
    assert_eq!(
        kept["limits"][0]["windows"][0]["used"], 12.5,
        "kept on the machine"
    );
    let mut window = (kernel.stream(person, "window.requests", None, Value::Null))
        .await
        .unwrap();
    let started = banda_kernel::now_ms() - 1;
    limits(&kernel, owner, true).await;
    let wait = json!({ "signed_in": true, "status": 429 });
    answer(&kernel, owner, &mut window, wait).await;
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
