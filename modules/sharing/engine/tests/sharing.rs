//! The sharing module through the kernel, as the window uses it: in this
//! machine's scope, nothing shared and no ID until the file turns
//! something on, a new ID only for the Person, and none kept once all of
//! it is off again.

use banda_kernel::{CommandId, Kernel, Participant, PersonId};
use banda_sharing::{Never, Sharing};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    let sharing = Sharing::new(root.join("config"), root.join("state"));
    Kernel::builder(root.join("spaces"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(sharing.never(Never::Checkout))
        .open()
        .await
        .unwrap()
}

async fn state(kernel: &Kernel, owner: PersonId) -> Value {
    let person = Participant::Person(owner);
    let call = kernel.call(person, "sharing.state", None, None, json!({}));
    call.await.unwrap()
}

fn share(root: &Path, text: &str) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    std::fs::write(root.join("config/sharing.toml"), text).unwrap();
}

#[tokio::test]
async fn an_id_is_made_as_sharing_turns_on_and_erased_as_it_turns_off() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;

    let nothing = state(&kernel, owner).await;
    assert_eq!(
        nothing,
        json!({
            "problems": false, "usage": false, "id": null,
            "never": "checkout", "sent": [],
        })
    );

    share(root.path(), "problems = true\n");
    let on = state(&kernel, owner).await;
    assert_eq!(on["problems"], true);
    let id = on["id"].as_str().unwrap().to_owned();
    assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 4);
    // Kept while anything is shared.
    share(root.path(), "usage = true\n");
    assert_eq!(state(&kernel, owner).await["id"], id);

    // Only the Person makes a new one.
    let new_id = |who| {
        let command = Some(CommandId::new());
        kernel.call(who, "sharing.new_id", None, command, json!({}))
    };
    let agent = Participant::Agent(banda_kernel::AgentId::new());
    assert!(new_id(agent).await.is_err());
    let anew = new_id(Participant::Person(owner)).await.unwrap();
    let other = anew["id"].as_str().unwrap();
    assert_ne!(other, id);
    assert_eq!(state(&kernel, owner).await["id"], other);

    // All of it off: the ID goes, and turned on again, it is another.
    share(root.path(), "");
    assert_eq!(state(&kernel, owner).await["id"], Value::Null);
    assert!(!root.path().join("state/sharing-id").exists());
    assert!(new_id(Participant::Person(owner)).await.is_err());
    share(root.path(), "problems = true\n");
    let again = state(&kernel, owner).await;
    assert_ne!(again["id"], other);
    assert_ne!(again["id"], id);
}

/// A Banda that sends, with the problems module whose Problems it hears.
async fn sending(root: &Path, owner: PersonId, never: Option<Never>) -> Arc<Kernel> {
    let sharing = Sharing::new(root.join("config"), root.join("state")).channel("dev");
    let sharing = match never {
        Some(why) => sharing.never(why),
        None => sharing,
    };
    Kernel::builder(root.join("spaces"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(banda_problems::Problems::new(
            root.join("state/problems"),
            root.join("state/logs"),
        ))
        .module(sharing)
        .open()
        .await
        .unwrap()
}

async fn record(kernel: &Kernel, owner: PersonId, function: &str) {
    let record = json!({
        "source": "page",
        "kind": "TypeError",
        "message": "cannot open '/home/roma/notes.md'",
        "frames": [{ "file": "app/web/src/browser/Tabs.tsx", "function": function, "line": 41 }],
    });
    let person = Participant::Person(owner);
    let command = Some(CommandId::new());
    let call = kernel.call(person, "problems.record", None, command, record);
    call.await.unwrap();
}

/// The events kept, once there are `count`.
async fn kept(kernel: &Kernel, owner: PersonId, count: usize) -> Vec<Value> {
    for _ in 0..200 {
        let sent = state(kernel, owner).await["sent"]
            .as_array()
            .unwrap()
            .clone();
        if sent.len() >= count {
            return sent;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("{count} events were not kept");
}

#[tokio::test]
async fn a_problem_goes_once_a_day_through_the_window_while_problems_are_shared() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    share(root.path(), "problems = true\n");
    let kernel = sending(root.path(), owner, None).await;
    let person = Participant::Person(owner);
    let mut window = (kernel.stream(person, "window.requests", None, Value::Null))
        .await
        .unwrap();

    record(&kernel, owner, "Tabs").await;
    let asked = window.recv().await.unwrap();
    assert_eq!(asked["method"], "sharing.post");
    let event = &asked["params"]["event"];
    assert_eq!(event["event"], "$exception");
    let id = state(&kernel, owner).await["id"].clone();
    assert_eq!(event["distinct_id"], id);
    let said = &event["properties"];
    assert_eq!(said["$exception_list"][0]["value"], "cannot open '<path>'");
    assert_eq!(said["channel"], "dev");
    // What goes is what was kept first.
    let sent = kept(&kernel, owner, 1).await;
    assert_eq!(sent[0]["event"], "$exception");
    assert_eq!(sent[0]["sent"], Value::Null);
    let json: Value = serde_json::from_str(sent[0]["json"].as_str().unwrap()).unwrap();
    assert_eq!(&json, event);

    let answer = json!({ "request": asked["id"], "ok": null });
    let call = kernel.call(person, "window.answer", None, None, answer);
    call.await.unwrap();
    for _ in 0..200 {
        if !state(&kernel, owner).await["sent"][0]["sent"].is_null() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(state(&kernel, owner).await["sent"][0]["sent"].is_number());

    // The same fault again today makes nothing more; another fault goes.
    record(&kernel, owner, "Tabs").await;
    record(&kernel, owner, "Bar").await;
    let asked = window.recv().await.unwrap();
    let frames = &asked["params"]["event"]["properties"]["$exception_list"][0]["stacktrace"];
    assert_eq!(frames["frames"][0]["function"], "Bar");
    assert_eq!(kept(&kernel, owner, 2).await.len(), 2);

    // Off: no more, and what waits is dropped.
    share(root.path(), "problems = false\nusage = true\n");
    record(&kernel, owner, "Baz").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let sent = state(&kernel, owner).await["sent"].clone();
    assert!(
        sent.as_array()
            .unwrap()
            .iter()
            .all(|one| !one["about"].as_str().unwrap().contains("Baz"))
    );
}

#[tokio::test]
async fn a_banda_that_never_sends_makes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    share(root.path(), "problems = true\nusage = true\n");
    let kernel = sending(root.path(), owner, Some(Never::Run)).await;
    record(&kernel, owner, "Tabs").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state(&kernel, owner).await["sent"], json!([]));
}
