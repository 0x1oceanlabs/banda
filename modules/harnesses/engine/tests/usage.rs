//! Usage through the real kernel and store, on isolated local journals.
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::{Kernel, Participant, PersonId};
use serde_json::{Value, json};
use std::{io::Write, path::Path, sync::Arc};
const DAY: i64 = 86_400_000;

fn stamp(at: i64) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ',?1/1000.0,'unixepoch')",
            [at],
            |row| row.get(0),
        )
        .unwrap()
}
fn claude(id: &str, at: i64, input: u64) -> Value {
    json!({"type":"assistant","sessionId":"claude-session","requestId":format!("req-{id}"),"timestamp":stamp(at),"message":{"id":id,"model":"gpt-5","content":[{"type":"text","text":"PRIVATE CONVERSATION"}],"usage":{"input_tokens":input,"cache_read_input_tokens":10,"cache_creation_input_tokens":0,"output_tokens":5}}})
}
fn codex(at: i64, input: u64, cached: u64, output: u64) -> Value {
    json!({"type":"event_msg","timestamp":stamp(at),"payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"cached_input_tokens":cached,"output_tokens":output,"reasoning_output_tokens":3}}}})
}
fn append(path: &Path, value: &Value) {
    writeln!(
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap(),
        "{value}"
    )
    .unwrap();
}
fn setup(root: &Path, read: bool) {
    for folder in ["claude/projects/p", "codex/sessions/2026"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
    }
    let text = format!(
        "[limits]\nread=false\n[usage]\nread={read}\n\n[[harness]]\nid=\"claude\"\nenv={{CLAUDE_CONFIG_DIR={:?}}}\n\n[[harness]]\nid=\"codex\"\nenv={{CODEX_HOME={:?}}}\n\n[[harness]]\nid=\"alias\"\nname=\"Same account\"\ncommand=\"acp\"\ncli={{program=\"claude\",variable=\"CLAUDE_CODE_EXECUTABLE\"}}\nenv={{CLAUDE_CONFIG_DIR={:?}}}\n",
        root.join("claude").to_str().unwrap(),
        root.join("codex").to_str().unwrap(),
        root.join("claude").to_str().unwrap()
    );
    std::fs::write(root.join("harnesses.toml"), text).unwrap();
}
async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    Kernel::builder(root.join("spaces"), root.join("data"), owner)
        .machine(root.join("machine"))
        .module(HarnessesModule::new(
            Harnesses::load(&root.join("harnesses.toml")).unwrap(),
        ))
        .open()
        .await
        .unwrap()
}
async fn usage(kernel: &Kernel, owner: PersonId, read: bool) -> Value {
    kernel
        .call(
            Participant::Person(owner),
            "harnesses.usage",
            None,
            None,
            json!({"read":read}),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn journals_are_counted_once_across_copies_aliases_reads_and_restarts() {
    let root = tempfile::tempdir().unwrap();
    let root = root.path();
    setup(root, true);
    let owner = PersonId::new();
    let kernel = open(root, owner).await;
    let now = banda_kernel::now_ms() - 10_000;
    let cl = root.join("claude/projects/p/one.jsonl");
    let cx = root.join("codex/sessions/2026/one.jsonl");
    append(&cl, &claude("one", now, 100));
    append(&cl, &claude("one", now + 1, 100));
    append(&cl, &claude("old", now - 93 * DAY, 999));
    append(
        &cl,
        &json!({"type":"user","uuid":"prompt-one","sessionId":"claude-session","timestamp":stamp(now),"message":{"content":"PRIVATE PROMPT"}}),
    );
    append(
        &cl,
        &json!({"type":"user","uuid":"tool-result","sessionId":"claude-session","timestamp":stamp(now),"message":{"content":[{"type":"tool_result","content":"PRIVATE TOOL RESULT"}]}}),
    );
    std::fs::copy(&cl, root.join("claude/projects/p/copy.jsonl")).unwrap();
    append(
        &cx,
        &json!({"type":"session_meta","payload":{"id":"codex-session"}}),
    );
    append(
        &cx,
        &json!({"type":"turn_context","payload":{"model":"gpt-5"}}),
    );
    append(&cx, &codex(now, 100, 60, 10));
    append(&cx, &codex(now, 100, 60, 10));
    append(&cx, &codex(now + 1, 150, 80, 20));
    let first = usage(&kernel, owner, true).await;
    assert_eq!(
        first["total"]["tokens"],
        json!({"input":170,"cache_read":90,"cache_write":0,"output":25})
    );
    assert_eq!(first["total"]["requests"], 3);
    assert_eq!(first["total"]["prompts"], 1);
    assert_eq!(first["total"]["sessions"], 2);
    assert_eq!(
        first["reads"].as_array().unwrap().len(),
        2,
        "same root has one owner"
    );
    assert_eq!(first["total"]["unpriced"], 0);
    assert_eq!(usage(&kernel, owner, true).await["total"], first["total"]);
    assert!(!first.to_string().contains("PRIVATE"));
    drop(kernel);
    let kernel = open(root, owner).await;
    append(&cx, &codex(now + 2, 200, 90, 30));
    let next = usage(&kernel, owner, true).await;
    assert_eq!(next["total"]["tokens"]["input"], 210);
    assert_eq!(next["total"]["tokens"]["cache_read"], 100);
    assert_eq!(next["total"]["requests"], 4);
    assert_eq!(next["total"]["sessions"], 2);
}

#[tokio::test]
async fn partial_lines_replacements_disabled_reading_and_unpriced_usage_are_explicit() {
    let root = tempfile::tempdir().unwrap();
    let root = root.path();
    setup(root, true);
    let owner = PersonId::new();
    let kernel = open(root, owner).await;
    let path = root.join("claude/projects/p/session.jsonl");
    let now = banda_kernel::now_ms() - 1000;
    let value = claude("one", now, 100).to_string();
    let half = value.len() / 2;
    std::fs::write(&path, &value[..half]).unwrap();
    assert_eq!(usage(&kernel, owner, true).await["total"]["requests"], 0);
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap(),
        "{}",
        &value[half..]
    )
    .unwrap();
    assert_eq!(usage(&kernel, owner, true).await["total"]["requests"], 1);
    let mut unknown = claude("new", now, 5);
    unknown["message"]["model"] = json!("future-model");
    std::fs::write(&path, format!("{unknown}\n")).unwrap();
    let replaced = usage(&kernel, owner, true).await;
    assert_eq!(replaced["total"]["requests"], 1);
    assert_eq!(replaced["total"]["tokens"]["input"], 5);
    assert_eq!(replaced["total"]["unpriced"], 1);
    assert_eq!(replaced["total"]["cost_usd"], 0.0);
    setup(root, false);
    append(&path, &claude("unread", now, 50));
    let off = usage(&kernel, owner, true).await;
    assert_eq!(off["reading"], false);
    assert_eq!(off["total"], replaced["total"]);
    setup(root, true);
    assert_eq!(usage(&kernel, owner, true).await["total"]["requests"], 2);
    let refused = kernel
        .call(
            Participant::Person(owner),
            "harnesses.usage",
            None,
            None,
            json!({"since":0,"read":true}),
        )
        .await;
    assert!(refused.is_err());
}

#[tokio::test]
async fn exact_intervals_and_persistent_malformed_line_warnings() {
    let root = tempfile::tempdir().unwrap();
    let root = root.path();
    setup(root, true);
    let owner = PersonId::new();
    let kernel = open(root, owner).await;
    let path = root.join("claude/projects/p/session.jsonl");
    let since = banda_kernel::now_ms() - 5000;
    append(&path, &claude("before", since - 1, 99));
    let mut paid = claude("inside", since, 10);
    paid["costUSD"] = json!(0.25);
    append(&path, &paid);
    append(&path, &claude("after", since + 1000, 99));
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap(),
        "broken json"
    )
    .unwrap();
    let value = kernel
        .call(
            Participant::Person(owner),
            "harnesses.usage",
            None,
            None,
            json!({"since":since,"until":since+1000,"read":true}),
        )
        .await
        .unwrap();
    assert_eq!(value["total"]["requests"], 1);
    assert_eq!(value["total"]["cost_usd"], 0.25);
    assert_eq!(value["rows"][0]["total"]["tokens"]["input"], 10);
    assert!(!value["reads"][0]["problems"].as_array().unwrap().is_empty());
    let again = usage(&kernel, owner, true).await;
    assert_eq!(value["reads"][0]["problems"], again["reads"][0]["problems"]);
}
