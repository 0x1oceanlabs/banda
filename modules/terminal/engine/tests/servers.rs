//! The servers started in Banda, through the kernel, as the bar's widget
//! hears them (ADR 0044): a terminal's and an Agent's show in their Space
//! only, a Harness's own do not, and a server stops.

mod common;

use banda_kernel::{Code, SPACE_VARIABLE, Stream};
use banda_terminal::model::{Server, Servers, StartedBy, TerminalId};
use common::{World, until};
use serde_json::json;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Listens on a free port of 127.0.0.1, and says which.
const LISTENS: &str = "import socket, time
s = socket.socket()
s.bind(('127.0.0.1', 0))
s.listen()
print(s.getsockname()[1], flush=True)
time.sleep(60)";

/// The lists the stream says until one that `done` holds for.
async fn servers(stream: &mut Stream, done: impl Fn(&[Server]) -> bool) -> Vec<Server> {
    loop {
        let said = tokio::time::timeout(Duration::from_secs(10), stream.recv())
            .await
            .expect("the servers changed in time")
            .expect("the stream goes on");
        let Servers { servers } = serde_json::from_value(said).unwrap();
        if done(&servers) {
            return servers;
        }
    }
}

fn on(port: u16) -> impl Fn(&[Server]) -> bool {
    move |servers| servers.iter().any(|server| server.port == port)
}

/// Starts `script` in Python as a Harness's process for `world`'s Space,
/// which the test's process stands for: through a shell when `shell`, as
/// an Agent's tool runs it, in a group of its own. Answers it and the port
/// it listens on.
async fn as_a_harness(world: &World, script: &str, shell: bool) -> (tokio::process::Child, u16) {
    let mut command = match shell {
        // `exit` keeps the shell from becoming Python.
        true => {
            let mut command = tokio::process::Command::new("sh");
            command.args(["-c", "python3 -c \"$0\"; exit $?", script]);
            command
        }
        false => {
            let mut command = tokio::process::Command::new("python3");
            command.args(["-c", script]);
            command
        }
    };
    let mut started = command
        .env(SPACE_VARIABLE, world.space.to_string())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut said = BufReader::new(started.stdout.take().unwrap()).lines();
    let port = said.next_line().await.unwrap().unwrap().parse().unwrap();
    (started, port)
}

#[tokio::test]
async fn a_terminal_s_server_shows_in_its_space_only_and_stops() {
    let world = World::new().await;
    let other = world.another_space().await;
    let mut ports = world.ports(world.space).await;
    let terminal = TerminalId::new();
    let open = json!({ "terminal": terminal, "program": "python3", "args": ["-c", LISTENS] });
    world.call("terminal.open", open).await.unwrap();
    let mut watching = world.watch(terminal).await;
    let said = |screen: &str| {
        screen
            .lines()
            .find_map(|line| line.trim().parse::<u16>().ok())
    };
    let (screen, _) = until(&mut watching, |screen| said(screen).is_some()).await;
    let port = said(&screen).unwrap();

    let found = servers(&mut ports, on(port)).await;
    let server = found.iter().find(|server| server.port == port).unwrap();
    assert_eq!(server.by, StartedBy::Terminal);
    assert!(server.program.starts_with("python3"), "{server:?}");
    let elsewhere = servers(&mut world.ports(other).await, |_| true).await;
    assert!(!on(port)(&elsewhere), "{elsewhere:?}");
    let named = json!({ "port": port, "process": server.process });
    let refused = world.call_in(other, "terminal.stop_server", named.clone());
    assert_eq!(refused.await.unwrap_err().code, Code::NotFound);

    world
        .call("terminal.stop_server", named.clone())
        .await
        .unwrap();
    servers(&mut ports, |found| !on(port)(found)).await;
    let refused = world.call("terminal.stop_server", named);
    assert_eq!(refused.await.unwrap_err().code, Code::NotFound);
}

#[tokio::test]
async fn an_agent_s_server_is_known_by_its_space_and_a_harness_s_own_is_not() {
    let world = World::new().await;
    let mut ports = world.ports(world.space).await;
    // As a Harness's CLI listens for an editor: in its process's group.
    let (_cli, own) = as_a_harness(&world, LISTENS, false).await;
    // As an Agent's tool runs a server: a job of its own.
    let job = format!("import os\nos.setpgrp()\n{LISTENS}");
    let (mut tool, port) = as_a_harness(&world, &job, true).await;

    let found = servers(&mut ports, on(port)).await;
    assert!(!on(own)(&found), "{found:?}");
    let server = found.iter().find(|server| server.port == port).unwrap();
    assert_eq!(server.by, StartedBy::Agent);
    assert_ne!(Some(server.process), tool.id(), "the server, not its shell");

    let named = json!({ "port": port, "process": server.process });
    world.call("terminal.stop_server", named).await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(5), tool.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(!ended.success(), "the server was asked to stop: {ended:?}");
    servers(&mut ports, |found| !on(port)(found)).await;
}
