//! The terminal module on Windows, which has no terminals and finds no
//! servers yet (ADR 0090, steps 7 and 8): each call that needs them is
//! refused, and says why, and nothing starts.
#![cfg(windows)]

mod common;

use banda_kernel::{Code, Participant};
use banda_terminal::model::TerminalId;
use banda_terminal::{NO_SERVERS, NO_TERMINALS};
use common::World;
use serde_json::json;

#[tokio::test]
async fn a_terminal_does_not_open_and_says_it_comes_later() {
    let world = World::new().await;
    let open = json!({
        "terminal": TerminalId::new(), "program": "cmd.exe", "args": ["/c", "echo started"],
        "size": { "cols": 100, "rows": 30 },
    });
    let refused = world.call("terminal.open", open).await.unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
    assert_eq!(refused.message, NO_TERMINALS);
    assert!(NO_TERMINALS.contains("not on Windows yet"));
    assert!(world.asks.all().is_empty(), "nothing started");
}

#[tokio::test]
async fn the_servers_are_not_listed_nor_stopped_and_it_says_so() {
    let world = World::new().await;
    let person = Participant::Person(world.owner);
    let listed = (world.kernel)
        .stream(person, "terminal.ports", Some(world.project), json!({}))
        .await
        .unwrap_err();
    assert_eq!(listed.code, Code::Invalid);
    assert_eq!(listed.message, NO_SERVERS);
    let stop = json!({ "port": 5173, "process": 4242 });
    let stopped = world.call("terminal.stop_server", stop).await.unwrap_err();
    assert_eq!(stopped.code, Code::Invalid);
    assert_eq!(stopped.message, NO_SERVERS);
    assert!(NO_SERVERS.contains("not on Windows yet"));
}

/// With no terminal, none runs a program, and a machine's update does not
/// wait for one (ADR 0106, decision 4).
#[tokio::test]
async fn no_terminal_runs_a_program() {
    let world = World::new().await;
    let mut running = world.running(world.project).await;
    let said = running.recv().await.unwrap();
    assert_eq!(said, json!({ "terminals": 0 }));
}
