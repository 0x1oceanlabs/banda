//! The terminal module through the kernel, as a window uses it: a program
//! starts on a PTY, prints, reads what is typed, and ends.

mod common;

use banda_environments::How;
use banda_kernel::{AgentId, Code, Participant};
use banda_terminal::model::{Piece, TerminalId};
use common::{World, next, piece, until};
use serde_json::json;

/// A terminal's program starts in its Project's environment, never by the
/// module itself (ADR 0084, decision 4): on a PTY, in the Project's
/// folder, carrying what tells its servers whose they are.
#[tokio::test]
async fn a_terminal_starts_its_program_in_its_projects_environment() {
    let world = World::new().await;
    let terminal = world.run("echo started").await;
    let mut watching = world.watch(terminal).await;
    let (screen, _) = until(&mut watching, |s| s.contains("started")).await;
    assert!(screen.contains("started"), "{screen:?}");

    let asked = world.asks.all();
    let [asked] = &asked[..] else {
        panic!("one program: {asked:?}");
    };
    assert_eq!(asked.how, How::Pty);
    let program = &asked.program;
    assert_eq!(program.program, "sh");
    assert_eq!(program.args, ["-c", "echo started"]);
    assert_eq!(program.cwd, Some(world.folder().await));
    assert_eq!(program.env["BANDA_PROJECT"], world.project.to_string());
    assert_eq!(program.env["BANDA_TERMINAL"], terminal.to_string());
    assert_eq!(program.env["TERM"], "xterm-256color");
    let unset = program.unset.iter();
    assert!(
        unset.clone().all(|name| name.starts_with("ELECTRON_")),
        "{unset:?}"
    );
}

#[tokio::test]
async fn a_program_prints_reads_what_is_typed_and_ends() {
    let world = World::new().await;
    let terminal = world
        .run("printf 'name? '; read name; echo \"hello $name\"; exit 3")
        .await;
    let mut watching = world.watch(terminal).await;
    let (screen, _) = until(&mut watching, |s| s.contains("name? ")).await;
    assert!(screen.contains("name? "), "{screen:?}");
    world
        .call(
            "terminal.write",
            json!({ "terminal": terminal, "data": "Ann\r" }),
        )
        .await
        .unwrap();
    let (screen, ended) = until(&mut watching, |_| false).await;
    assert!(screen.contains("hello Ann"), "{screen:?}");
    let Some(Piece::Exited { ended }) = ended else {
        panic!("it ended: {ended:?}")
    };
    assert_eq!(ended.code, Some(3));

    // A window that opens it later sees the same screen, and how it ended.
    let mut later = world.watch(terminal).await;
    let Some(Piece::Snapshot { history, ended, .. }) = later
        .recv()
        .await
        .map(|v| serde_json::from_value(v).unwrap())
    else {
        panic!("a snapshot first")
    };
    assert!(history.contains("hello Ann"));
    assert_eq!(ended.and_then(|e| e.code), Some(3));
}

#[tokio::test]
async fn a_closed_terminal_stops_its_program_and_every_watch() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let mut watching = world.watch(terminal).await;
    until(&mut watching, |s| s.contains("started")).await;
    world
        .call("terminal.close", json!({ "terminal": terminal }))
        .await
        .unwrap();
    let (_, ended) = until(&mut watching, |_| false).await;
    assert!(ended.is_none(), "the watch ended");
    let gone = world
        .call(
            "terminal.write",
            json!({ "terminal": terminal, "data": "x" }),
        )
        .await
        .unwrap_err();
    assert_eq!(gone.code, Code::NotFound);
}

#[tokio::test]
async fn only_a_person_runs_a_terminal() {
    let world = World::new().await;
    let open = json!({ "terminal": TerminalId::new(), "program": "true" });
    let agent = Participant::Agent(AgentId::new());
    let refused = world
        .kernel
        .call(agent, "terminal.open", Some(world.project), None, open)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let tiny = json!({ "terminal": TerminalId::new(), "size": { "cols": 0, "rows": 0 } });
    let refused = world.call("terminal.open", tiny).await.unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[tokio::test]
async fn a_shell_says_what_runs_in_front_and_where() {
    let world = World::new().await;
    // No program: the Person's shell.
    let terminal = TerminalId::new();
    let open = json!({ "terminal": terminal, "size": { "cols": 100, "rows": 30 } });
    world.call("terminal.open", open).await.unwrap();
    let mut watching = world.watch(terminal).await;
    let titled = |piece: &Piece| matches!(piece, Piece::Titled { .. });
    let heard = next(&mut watching, titled).await;
    let Some(Piece::Titled { title: shell }) = heard else {
        panic!("it heard a title: {heard:?}")
    };
    assert!(!shell.folder.is_empty());
    world
        .call(
            "terminal.write",
            json!({ "terminal": terminal, "data": "cat\r" }),
        )
        .await
        .unwrap();
    let heard = next(&mut watching, titled).await;
    let Some(Piece::Titled { title }) = heard else {
        panic!("it heard what runs: {heard:?}")
    };
    assert_eq!(title.program, "cat");
    assert_eq!(title.folder, shell.folder);
    // A window that watches later hears it right after the screen.
    let mut later = world.watch(terminal).await;
    let first = piece(&mut later).await;
    assert!(matches!(first, Some(Piece::Snapshot { .. })), "{first:?}");
    assert_eq!(piece(&mut later).await, Some(Piece::Titled { title }));
    world
        .call("terminal.close", json!({ "terminal": terminal }))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_program_has_no_title() {
    let world = World::new().await;
    let terminal = world
        .run("echo started; sleep 1; echo more; sleep 1; exit 3")
        .await;
    let mut watching = world.watch(terminal).await;
    let ended = next(&mut watching, |piece| {
        matches!(piece, Piece::Titled { .. } | Piece::Exited { .. })
    })
    .await;
    assert!(matches!(ended, Some(Piece::Exited { .. })), "{ended:?}");
}

#[tokio::test]
async fn a_window_resizes_a_terminal_and_every_watcher_hears_it() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let mut watching = world.watch(terminal).await;
    until(&mut watching, |s| s.contains("started")).await;
    let size = json!({ "cols": 120, "rows": 40 });
    world
        .call(
            "terminal.resize",
            json!({ "terminal": terminal, "size": size }),
        )
        .await
        .unwrap();
    let heard = next(&mut watching, |piece| {
        !matches!(piece, Piece::Titled { .. })
    })
    .await;
    let Some(Piece::Resized { size }) = heard else {
        panic!("it heard the size: {heard:?}")
    };
    assert_eq!((size.cols, size.rows), (120, 40));
    world
        .call("terminal.close", json!({ "terminal": terminal }))
        .await
        .unwrap();
}

#[tokio::test]
async fn opening_a_terminal_whose_program_ended_runs_it_again() {
    let world = World::new().await;
    let script = "n=$(cat runs 2>/dev/null || echo 0); n=$((n+1)); echo $n > runs; echo run $n";
    let terminal = world.run(script).await;
    let mut watching = world.watch(terminal).await;
    let (screen, ended) = until(&mut watching, |_| false).await;
    assert!(screen.contains("run 1"), "{screen:?}");
    assert!(matches!(ended, Some(Piece::Exited { .. })), "{ended:?}");

    world.open(terminal, script).await.unwrap();
    let mut again = world.watch(terminal).await;
    let (screen, _) = until(&mut again, |s| s.contains("run 2")).await;
    assert!(screen.contains("run 2"), "{screen:?}");
    // What watched the first run ends with it.
    let (_, ended) = until(&mut watching, |_| false).await;
    assert!(ended.is_none(), "the old watch ended: {ended:?}");
}

#[tokio::test]
async fn a_terminal_belongs_to_its_project() {
    let world = World::new().await;
    let terminal = world.run("echo started; sleep 100").await;
    let other = world.another_project().await;
    let closing = json!({ "terminal": terminal });
    world
        .call_in(other, "terminal.close", closing.clone())
        .await
        .unwrap();
    let open = json!({ "terminal": terminal, "program": "true" });
    let taken = world
        .call_in(other, "terminal.open", open)
        .await
        .unwrap_err();
    assert_eq!(taken.code, Code::Conflict);
    // It still runs in its own Project.
    let typed = json!({ "terminal": terminal, "data": "x" });
    world.call("terminal.write", typed).await.unwrap();
    world.call("terminal.close", closing).await.unwrap();
}
