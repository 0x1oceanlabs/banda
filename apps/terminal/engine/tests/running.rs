//! How many of a Project's terminals run a program in front, as a
//! machine's update hears it while it waits (ADR 0106, decision 4): a
//! shell that waits for what is typed runs none, a program it starts
//! counts until it ends, and so does the program a terminal was opened
//! with.
// Windows has no terminals yet (ADR 0090, step 7): tests/windows.rs.
#![cfg(unix)]

mod common;

use banda_kernel::Stream;
use banda_terminal::model::{Piece, Running, TerminalId};
use common::{World, next};
use serde_json::json;
use std::time::Duration;

/// The next count the stream says.
async fn count(stream: &mut Stream) -> u32 {
    let said = tokio::time::timeout(Duration::from_secs(5), stream.recv())
        .await
        .expect("it said a count in time")
        .expect("it went on");
    serde_json::from_value::<Running>(said).unwrap().terminals
}

/// Hears counts until the stream says `wanted`. A shell's own start may
/// run a program in front for a moment, as a prompt that asks git does.
async fn until(stream: &mut Stream, wanted: u32) {
    while count(stream).await != wanted {}
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[tokio::test]
async fn a_program_a_shell_runs_in_front_counts_until_it_ends() {
    let world = World::new().await;
    let mut running = world.running(world.project).await;
    assert_eq!(count(&mut running).await, 0, "none open");

    // No program: the Person's shell, which runs none while it waits.
    let terminal = TerminalId::new();
    let open = json!({ "terminal": terminal, "size": { "cols": 100, "rows": 30 } });
    world.call("terminal.open", open).await.unwrap();
    let mut watching = world.watch(terminal).await;
    let titled = |piece: &Piece| matches!(piece, Piece::Titled { .. });
    next(&mut watching, titled).await;
    let typed = |data: &str| {
        let typed = json!({ "terminal": terminal, "data": data });
        world.call("terminal.write", typed)
    };

    typed("cat\r").await.unwrap();
    until(&mut running, 1).await;
    // Ctrl+C ends it, and the shell is in front again.
    typed("\x03").await.unwrap();
    until(&mut running, 0).await;
    typed("cat\r").await.unwrap();
    until(&mut running, 1).await;
    // A closed terminal runs nothing, whatever ran in it.
    let close = json!({ "terminal": terminal });
    world.call("terminal.close", close).await.unwrap();
    until(&mut running, 0).await;
}

#[tokio::test]
async fn a_terminals_own_program_counts_until_it_ends_and_only_in_its_project() {
    let world = World::new().await;
    let mut running = world.running(world.project).await;
    assert_eq!(count(&mut running).await, 0, "none open");

    let stays = world.run("echo started; sleep 100").await;
    assert_eq!(count(&mut running).await, 1, "a program of its own");
    world.run("sleep 1").await;
    assert_eq!(count(&mut running).await, 2, "two");
    assert_eq!(count(&mut running).await, 1, "one ended by itself");

    // Another Project's terminals are its own.
    let other = world.another_project().await;
    let mut others = world.running(other).await;
    assert_eq!(count(&mut others).await, 0, "the other Project's");

    let close = json!({ "terminal": stays });
    world.call("terminal.close", close).await.unwrap();
    assert_eq!(count(&mut running).await, 0, "the other closed");
}
