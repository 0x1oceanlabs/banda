//! A Harness's setup through the kernel, as a window runs it (ADR 0140),
//! with a stand-in of its vendor's installer: the engine runs the steps
//! to their end with no call waiting, a step is done when the engine
//! finds it so, and one that fails says why and stops the rest.
// Its installer is a line of `sh`, which Windows has not.
#![cfg(unix)]

use banda_environments::Local;
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::{Kernel, Participant, PersonId};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// The kernel with one Codex whose CLI is `root/codex`, not there yet, and
/// whose adapter is no program; `line` is its installer.
async fn open(root: &Path, owner: PersonId, line: &str) -> Arc<Kernel> {
    let path = root.join("harnesses.toml");
    let text = format!(
        "[usage]\nread = false\n\n[limits]\nread = false\n\n\
         [[harness]]\nid = \"codex\"\ncommand = {:?}\n\
         cli = {{ program = {:?}, variable = \"CODEX_PATH\" }}\n\n\
         [[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = \"acp\"\n",
        root.join("no-adapter").display().to_string(),
        root.join("codex").display().to_string()
    );
    std::fs::write(&path, text).unwrap();
    let harnesses = Harnesses::load(&path).unwrap();
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("machine"))
        .environment(Local)
        .module(
            HarnessesModule::new(harnesses)
                .installing_with("codex", line)
                // Git is there, whatever this computer has.
                .installing_with("git-at", &path.display().to_string()),
        )
        .open()
        .await
        .unwrap()
}

async fn ask(
    kernel: &Kernel,
    owner: PersonId,
    method: &str,
    harness: &str,
) -> Result<Value, String> {
    let person = Participant::Person(owner);
    let call = kernel.call(person, method, None, None, json!({ "harness": harness }));
    call.await.map_err(|refused| refused.message)
}

/// The setup once the engine no longer runs it.
async fn ended(kernel: &Kernel, owner: PersonId) -> Value {
    for _ in 0..1000 {
        let now = ask(kernel, owner, "harnesses.setup", "codex")
            .await
            .unwrap();
        if now["running"] == false {
            return now;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the setup did not end");
}

fn states(setup: &Value) -> Vec<&str> {
    let steps = setup["steps"].as_array().unwrap();
    steps
        .iter()
        .map(|step| step["state"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn a_setup_installs_with_no_call_waiting_then_stops_at_the_step_that_fails() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let cli = root.path().join("codex");
    let line = format!(
        "echo fetching codex; printf '#!/bin/sh\\necho codex-cli 0.166.0\\n' > {0:?}; chmod +x {0:?}",
        cli.display().to_string()
    );
    let kernel = open(root.path(), owner, &line).await;

    let before = ask(&kernel, owner, "harnesses.setup", "codex")
        .await
        .unwrap();
    assert_eq!(before["name"], "Codex");
    assert_eq!(states(&before), ["done", "waiting", "waiting"]);
    assert_eq!(before["steps"][1]["says"], "The Agent itself, from OpenAI");
    assert_eq!(before["running"], false);

    let started = ask(&kernel, owner, "harnesses.setup_start", "codex")
        .await
        .unwrap();
    assert_eq!(started["running"], true);

    // Its CLI is found, so the first step is done; its adapter does not
    // start, so the sign-in fails and says why.
    let after = ended(&kernel, owner).await;
    assert_eq!(states(&after), ["done", "done", "failed"]);
    assert!(after["output"].as_str().unwrap().contains("fetching codex"));
    assert!(after["steps"][2]["note"].is_string());
    assert!(cli.exists());

    // Asked again, what stopped it is still said, and the install is done.
    let again = ask(&kernel, owner, "harnesses.setup", "codex")
        .await
        .unwrap();
    assert_eq!(states(&again), ["done", "done", "failed"]);
}

#[tokio::test]
async fn an_installer_that_installs_nothing_fails_its_step_and_one_stopped_fails_none() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner, "echo nothing to do").await;
    ask(&kernel, owner, "harnesses.setup_start", "codex")
        .await
        .unwrap();
    let after = ended(&kernel, owner).await;
    assert_eq!(states(&after), ["done", "failed", "waiting"]);
    let note = after["steps"][1]["note"].as_str().unwrap();
    assert!(note.contains("still not on this computer"), "{note}");

    // Stopped by the Person, the step waits again and says nothing.
    let root = tempfile::tempdir().unwrap();
    let kernel = open(root.path(), owner, "echo slow; sleep 30").await;
    ask(&kernel, owner, "harnesses.setup_start", "codex")
        .await
        .unwrap();
    let twice = ask(&kernel, owner, "harnesses.setup_start", "codex").await;
    assert!(twice.unwrap_err().contains("is being set up already"));
    ask(&kernel, owner, "harnesses.setup_cancel", "codex")
        .await
        .unwrap();
    let after = ended(&kernel, owner).await;
    assert_eq!(states(&after), ["done", "waiting", "waiting"]);
    assert!(after["steps"][1]["note"].is_null());
}

#[tokio::test]
async fn a_harness_banda_does_not_know_has_no_steps_and_is_not_set_up() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner, "true").await;
    let fake = ask(&kernel, owner, "harnesses.setup", "fake")
        .await
        .unwrap();
    assert_eq!(fake["steps"], json!([]));
    let refused = ask(&kernel, owner, "harnesses.setup_start", "fake").await;
    assert!(
        refused
            .unwrap_err()
            .contains("does not know how Fake is set up")
    );
}

#[tokio::test]
async fn a_git_that_does_not_install_fails_its_step_and_holds_back_no_other() {
    let root = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let cli = root.path().join("codex").display().to_string();
    let line =
        format!("printf '#!/bin/sh\\necho codex-cli 0.166.0\\n' > {cli:?}; chmod +x {cli:?}");
    let path = root.path().join("harnesses.toml");
    let text = format!(
        "[usage]\nread = false\n\n[limits]\nread = false\n\n[[harness]]\nid = \"codex\"\n\
         command = \"no-adapter\"\ncli = {{ program = {cli:?}, variable = \"CODEX_PATH\" }}\n"
    );
    std::fs::write(&path, text).unwrap();
    let module = HarnessesModule::new(Harnesses::load(&path).unwrap())
        .installing_with("codex", &line)
        .installing_with("git", "echo no git for you; exit 1")
        .installing_with("git-at", &root.path().join("git").display().to_string());
    let kernel = Kernel::builder(
        root.path().join("projects"),
        root.path().join("data"),
        owner,
    )
    .machine(root.path().join("machine"))
    .environment(Local)
    .module(module)
    .open()
    .await
    .unwrap();
    ask(&kernel, owner, "harnesses.setup_start", "codex")
        .await
        .unwrap();
    let after = ended(&kernel, owner).await;
    assert_eq!(states(&after), ["failed", "done", "failed"]);
    assert!(after["steps"][0]["note"].is_string());
}
