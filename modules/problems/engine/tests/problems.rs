//! The problems module through the kernel, as the window and the CLI use
//! it: in this machine's scope, one Problem a fingerprint, a new one said
//! in an event, and the engine's panics taken in from their file.

use banda_kernel::{CommandId, Kernel, Participant, PersonId};
use banda_problems::Problems;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    Kernel::builder(root.join("spaces"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(Problems::new(
            root.join("state/problems"),
            root.join("state/logs"),
        ))
        .open()
        .await
        .unwrap()
}

async fn record(kernel: &Kernel, owner: PersonId, message: &str, line: u32) -> Value {
    let record = json!({
        "source": "page",
        "kind": "TypeError",
        "message": message,
        "frames": [{ "file": "browser/BrowserPane.tsx", "function": "title", "line": line }],
    });
    let person = Participant::Person(owner);
    let command = Some(CommandId::new());
    let call = kernel.call(person, "problems.record", None, command, record);
    call.await.unwrap()
}

async fn list(kernel: &Kernel, owner: PersonId) -> Value {
    let person = Participant::Person(owner);
    let call = kernel.call(person, "problems.list", None, None, json!({}));
    call.await.unwrap()
}

async fn recorded_events(kernel: &Kernel, owner: PersonId) -> usize {
    let machine = kernel.machine().unwrap();
    let log = kernel
        .follow(Participant::Person(owner), machine)
        .await
        .unwrap();
    let events = log.events_after(0, Default::default(), 100).await.unwrap();
    events.iter().filter(|e| e.kind == "recorded").count()
}

#[tokio::test]
async fn one_fault_is_one_problem_however_often_it_breaks() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;

    let first = record(&kernel, owner, "reading 'undefined'", 83).await;
    assert_eq!(first["new"], true);
    // The same fault, a line further on in a later build.
    let again = record(&kernel, owner, "reading 'tabs'", 84).await;
    assert_eq!(again["new"], false);
    assert_eq!(again["fingerprint"], first["fingerprint"]);

    let listed = list(&kernel, owner).await;
    let problems = listed["problems"].as_array().unwrap();
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0]["times"], 2);
    // How it broke the last time.
    assert_eq!(problems[0]["message"], "reading 'tabs'");
    assert_eq!(problems[0]["frames"][0]["line"], 84);
    // Only the new one was said.
    assert_eq!(recorded_events(&kernel, owner).await, 1);
}

#[tokio::test]
async fn the_engine_s_panics_come_in_when_it_opens_again() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let folder = root.path().join("state/problems");
    std::fs::create_dir_all(&folder).unwrap();
    // As the panic hook leaves one, from the run before.
    let panic = json!({ "source": "engine", "kind": "panic", "message": "boom", "frames": [] });
    std::fs::write(folder.join("panics.jsonl"), format!("{panic}\n")).unwrap();

    let kernel = open(root.path(), owner).await;
    let problems = list(&kernel, owner).await["problems"].clone();
    assert_eq!(problems.as_array().unwrap().len(), 1);
    assert_eq!(problems[0]["source"], "engine");
    assert_eq!(problems[0]["message"], "boom");
    assert!(!folder.join("panics.jsonl").exists());
}

#[tokio::test]
async fn a_problem_is_named_by_its_fingerprint_s_start_with_the_logs_last_lines() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let logs = root.path().join("state/logs");
    std::fs::create_dir_all(&logs).unwrap();
    let lines: Vec<String> = (1..=150).map(|n| format!("line {n}")).collect();
    std::fs::write(logs.join("engine.log"), lines.join("\n")).unwrap();
    let kernel = open(root.path(), owner).await;
    let fingerprint = record(&kernel, owner, "reading 'undefined'", 83).await["fingerprint"]
        .as_str()
        .unwrap()
        .to_owned();

    let ask = |start: &str| {
        let person = Participant::Person(owner);
        let params = json!({ "fingerprint": start });
        kernel.call(person, "problems.problem", None, None, params)
    };
    let report = ask(&fingerprint[..4]).await.unwrap();
    assert_eq!(report["problem"]["fingerprint"], fingerprint.as_str());
    assert!(
        report["system"]
            .as_str()
            .unwrap()
            .contains(std::env::consts::OS)
    );
    // Only the logs there are, and only their last lines.
    let logs = report["logs"].as_array().unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["name"], "engine.log");
    let tail = logs[0]["lines"].as_array().unwrap();
    assert_eq!(tail.len(), 100);
    assert_eq!(tail[0], "line 51");
    assert_eq!(tail[99], "line 150");

    assert!(ask("no-such").await.is_err());
}

#[tokio::test]
async fn only_the_person_sends_an_issue_about_a_problem_that_is_kept() {
    use banda_kernel::{AgentId, Code};
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    // A `gh` that keeps what it was given, and says where it filed it.
    let gh = root.path().join("gh");
    std::fs::write(
        &gh,
        "#!/bin/sh\nhere=$(dirname \"$0\")\necho \"$@\" > \"$here/args\"\ncat > \"$here/body\"\n\
         echo https://github.com/0x1oceanlabs/banda/issues/412\n",
    )
    .unwrap();
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
    let owner = PersonId::new();
    let kernel = Kernel::builder(root.path().join("spaces"), root.path().join("data"), owner)
        .machine(root.path().join("state/machine"))
        .module(
            Problems::new(
                root.path().join("state/problems"),
                root.path().join("state/logs"),
            )
            .gh(gh),
        )
        .open()
        .await
        .unwrap();
    let fingerprint = record(&kernel, owner, "broke", 1).await["fingerprint"].clone();
    let send = |who, fingerprint: &Value| {
        let issue =
            json!({ "fingerprint": fingerprint, "title": "Tabs break", "body": "## What broke" });
        kernel.call(
            who,
            "problems.send_issue",
            None,
            Some(CommandId::new()),
            issue,
        )
    };

    let agent = Participant::Agent(AgentId::new());
    assert_eq!(
        send(agent, &fingerprint).await.unwrap_err().code,
        Code::Forbidden
    );
    let person = Participant::Person(owner);
    let none = send(person, &json!("0000")).await.unwrap_err();
    assert_eq!(none.code, Code::NotFound);

    let sent = send(person, &fingerprint).await.unwrap();
    assert_eq!(
        sent,
        json!({ "url": "https://github.com/0x1oceanlabs/banda/issues/412", "filed": true })
    );
    let given = std::fs::read_to_string(root.path().join("args")).unwrap();
    assert_eq!(
        given.trim(),
        "issue create --title Tabs break --repo 0x1oceanlabs/banda --body-file -"
    );
    let body = std::fs::read_to_string(root.path().join("body")).unwrap();
    assert_eq!(body, "## What broke");
}
