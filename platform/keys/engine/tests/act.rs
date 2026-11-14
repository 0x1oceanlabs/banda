//! An action run by its id (ADR 0127, decision 2): `keys.act` checks the
//! id and the args, then asks the window that holds the kernel's road,
//! and its answer, or its refusal, is the caller's. With no window open,
//! the kernel says so.

use banda_kernel::{AgentId, Code, Kernel, Participant, PersonId, Refusal, Stream, WindowRequest};
use banda_keys::KeysModule;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

#[path = "../../../settings/tests/whole/mod.rs"]
mod whole;

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(KeysModule::new(whole::WHOLE, root.join("config")))
        .open()
        .await
        .unwrap()
}

/// The next thing the window is asked.
async fn heard(requests: &mut Stream) -> WindowRequest {
    let piece = tokio::time::timeout(Duration::from_secs(5), requests.recv())
        .await
        .expect("a request in time")
        .expect("the road is held");
    serde_json::from_value(piece).unwrap()
}

#[tokio::test]
async fn with_no_window_open_an_action_is_refused_in_those_words() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let person = Participant::Person(owner);
    let act = json!({ "action": "overview.toggle" });
    let refused = (kernel.call(person, "keys.act", None, None, act))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert_eq!(refused.message, "Banda's window is not open.");
    // What is wrong with the ask is said first, window or none.
    let nothing = json!({ "action": "no.such" });
    let refused = (kernel.call(person, "keys.act", None, None, nothing))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn the_window_runs_the_action_and_its_answer_is_the_caller_s() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let person = Participant::Person(owner);
    let agent = Participant::Agent(AgentId::new());
    let mut requests = (kernel.stream(person, "window.requests", None, json!({})))
        .await
        .unwrap();
    let answer = async |request: u64, error: Option<Refusal>| {
        let answer = json!({ "request": request, "error": error });
        (kernel.call(person, "window.answer", None, None, answer))
            .await
            .unwrap();
    };

    // An Agent runs the Tiling's, and the window hears who asks.
    let open = json!({ "action": "browser.open", "args": { "address": "https://github.com" } });
    let asking = tokio::spawn({
        let kernel = kernel.clone();
        async move { kernel.call(agent, "keys.act", None, None, open).await }
    });
    let asked = heard(&mut requests).await;
    assert_eq!(asked.method, "keys.act");
    assert_eq!(asked.by, agent);
    assert_eq!(
        asked.params,
        json!({ "action": "browser.open", "args": { "address": "https://github.com" } })
    );
    answer(asked.id, None).await;
    assert_eq!(
        asking.await.unwrap(),
        Ok(json!("Banda's window ran “Open in a browser”"))
    );

    // What the window refuses, as an action out of its scope, is said as
    // the window said it.
    let zoom = json!({ "action": "terminal.zoom-in" });
    let asking = tokio::spawn({
        let kernel = kernel.clone();
        async move { kernel.call(person, "keys.act", None, None, zoom).await }
    });
    let asked = heard(&mut requests).await;
    assert_eq!(asked.by, person);
    let out_of_scope = Refusal::conflict("terminal.zoom-in works in a terminal.");
    answer(asked.id, Some(out_of_scope.clone())).await;
    assert_eq!(asking.await.unwrap(), Err(out_of_scope));

    // What only the Person does never reaches the window from an Agent.
    let ask = json!({ "action": "thread.new", "args": { "ask": "hello" } });
    let refused = (kernel.call(agent, "keys.act", None, None, ask))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let nothing: Option<Value> = requests.try_recv().ok();
    assert_eq!(nothing, None);
}
