//! The browser's tools through the kernel, as an Agent's session calls
//! them, with a window that answers on the road, or none.

use banda_browser::{Browser, SeenTab};
use banda_kernel::{
    AgentId, Caller, Code, Kernel, Participant, PersonId, Refusal, SpaceId, Stream,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::task::JoinHandle;

async fn open(root: &std::path::Path, owner: PersonId) -> (Arc<Kernel>, SpaceId) {
    let kernel = Kernel::builder(root.join("spaces"), root.join("data"), owner)
        .module(Browser::new())
        .open()
        .await
        .unwrap();
    let person = Participant::Person(owner);
    let made = kernel.call(
        person,
        "spaces.create",
        None,
        Some(banda_kernel::CommandId::new()),
        json!({ "name": "Work" }),
    );
    let space = serde_json::from_value(made.await.unwrap()["id"].clone()).unwrap();
    (kernel, space)
}

/// An Agent whose pass is for `space`.
fn agent(space: SpaceId) -> Caller {
    Caller {
        participant: Participant::Agent(AgentId::new()),
        only: Some(space),
    }
}

/// The owner's window, holding the road.
/// An Agent asks for the tabs, and waits for the window's answer.
fn ask_tabs(kernel: &Arc<Kernel>, space: SpaceId) -> JoinHandle<Result<Value, Refusal>> {
    let kernel = kernel.clone();
    tokio::spawn(async move {
        (kernel.call(agent(space), "browser.tabs", None, None, Value::Null)).await
    })
}

async fn window(kernel: &Kernel, owner: PersonId) -> Stream {
    let person = Participant::Person(owner);
    kernel
        .stream(person, "window.requests", None, Value::Null)
        .await
        .unwrap()
}

#[tokio::test]
async fn with_no_window_the_tools_are_listed_and_refuse() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let (kernel, space) = open(root.path(), owner).await;
    let tools = kernel.call(
        Participant::Person(owner),
        "spaces.tools",
        None,
        None,
        Value::Null,
    );
    let names: Vec<String> = (tools.await.unwrap().as_array().unwrap().iter())
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["browser_tabs"]);
    let refused = kernel.call(agent(space), "browser.tabs", None, None, Value::Null);
    let refused = refused.await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert_eq!(refused.message, "Banda's window is not open.");
}

#[tokio::test]
async fn an_agent_sees_the_tabs_the_window_lists() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let (kernel, space) = open(root.path(), owner).await;
    let mut hear = window(&kernel, owner).await;
    let asking = ask_tabs(&kernel, space);
    let asked = hear.recv().await.unwrap();
    assert_eq!(asked["method"], "browser.tabs");
    assert_eq!(asked["space"], json!(space));
    assert_eq!(asked["by"]["kind"], "agent");
    let tab = SeenTab {
        id: 7,
        url: "https://example.com/".into(),
        title: "Example".into(),
        driven: false,
    };
    let answer = json!({ "request": asked["id"], "ok": [tab] });
    let person = Participant::Person(owner);
    kernel
        .call(person, "window.answer", None, None, answer)
        .await
        .unwrap();
    assert_eq!(asking.await.unwrap().unwrap(), json!([tab]));
}

#[tokio::test]
async fn a_window_that_answers_amiss_is_refused_not_passed_on() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let (kernel, space) = open(root.path(), owner).await;
    let mut hear = window(&kernel, owner).await;
    let asking = ask_tabs(&kernel, space);
    let asked = hear.recv().await.unwrap();
    let answer = json!({ "request": asked["id"], "ok": [{ "id": "seven" }] });
    let person = Participant::Person(owner);
    kernel
        .call(person, "window.answer", None, None, answer)
        .await
        .unwrap();
    assert_eq!(asking.await.unwrap().unwrap_err().code, Code::Invalid);
}
