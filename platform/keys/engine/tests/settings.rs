//! A machine's settings read through its engine, as a window of another
//! device reads them (ADR 0106, decision 7): `keys.settings_read` answers
//! the machine's part of a file, and `keys.settings_changed` says each
//! machine file's `rev`, then each again as its part changes, by a set or
//! by hand, and nothing for a change of what is not the machine's.

use banda_kernel::{Code, Kernel, Participant, PersonId, Stream};
use banda_keys::KeysModule;
use banda_keys::read::SettingChanged;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

async fn open(root: &Path, owner: PersonId) -> Arc<Kernel> {
    Kernel::builder(root.join("projects"), root.join("data"), owner)
        .machine(root.join("state/machine"))
        .module(KeysModule::new(root.join("config")))
        .open()
        .await
        .unwrap()
}

/// Writes `text` as the file `name` in `config` by hand, as an editor
/// saves: beside it, then over it, so no half of it is ever read.
fn by_hand(config: &Path, name: &str, text: &str) {
    let beside = config.join(format!(".{name}.new"));
    std::fs::write(&beside, text).unwrap();
    std::fs::rename(&beside, config.join(name)).unwrap();
}

/// The next piece `stream` says.
async fn next(stream: &mut Stream) -> SettingChanged {
    let piece = tokio::time::timeout(Duration::from_secs(5), stream.recv())
        .await
        .expect("a piece in time")
        .expect("the stream goes on");
    serde_json::from_value(piece).unwrap()
}

#[tokio::test]
async fn a_machine_s_settings_are_read_and_followed_through_its_engine() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let agents = "enter = \"send\"\n\n[start]\naccount = \"home\"\n";
    std::fs::write(config.join("agents.toml"), agents).unwrap();
    let owner = PersonId::new();
    let kernel = open(root.path(), owner).await;
    let person = Participant::Person(owner);
    let call =
        async |method: &str, params: Value| kernel.call(person, method, None, None, params).await;

    let mut changed = (kernel.stream(person, "keys.settings_changed", None, json!({})))
        .await
        .unwrap();
    let mut first = Vec::new();
    for _ in 0..6 {
        first.push(next(&mut changed).await);
    }
    let files: BTreeSet<&str> = first.iter().map(|each| each.file.as_str()).collect();
    let machine = [
        "agents.toml",
        "browser.toml",
        "files.toml",
        "harnesses.toml",
        "machine.toml",
        "sharing.toml",
    ];
    assert_eq!(files, BTreeSet::from(machine));
    let read = call("keys.settings_read", json!({ "file": "agents.toml" }))
        .await
        .unwrap();
    let was = first
        .iter()
        .find(|each| each.file == "agents.toml")
        .unwrap();
    assert_eq!(read["rev"], json!(was.rev), "the read and the stream agree");
    assert_eq!(read["keyed"]["start.account"]["value"], "home");
    assert_eq!(read["keyed"]["start.account"]["from"]["line"], 4);
    assert_eq!(read["values"]["account"], "home");
    assert!(read["keyed"].get("enter").is_none(), "the Person's, shared");

    // Set through the engine, as Settings for this machine does from
    // another device.
    let set = json!({ "file": "agents.toml", "key": "start.account", "value": "\"work\"" });
    call("keys.settings_set", set).await.unwrap();
    let now = next(&mut changed).await;
    assert_eq!(now.file, "agents.toml");
    assert_ne!(now.rev, was.rev);
    let read = call("keys.settings_read", json!({ "file": "agents.toml" }))
        .await
        .unwrap();
    assert_eq!(read["rev"], json!(now.rev));
    assert_eq!(read["values"]["account"], "work");

    // What is not the machine's changes, in its file on its line and in a
    // file of its own: nothing is said, and the next piece is the Harness
    // list, written by hand.
    let enter = json!({ "file": "agents.toml", "key": "enter", "value": "\"queue\"" });
    call("keys.settings_set", enter).await.unwrap();
    by_hand(&config, "look.toml", "radius = 4\n");
    by_hand(&config, "harnesses.toml", "[[harness]]\nid = \"x\"\n");
    let now = next(&mut changed).await;
    assert_eq!(now.file, "harnesses.toml");
    let read = call("keys.settings_read", json!({ "file": "harnesses.toml" }))
        .await
        .unwrap();
    assert_eq!(read["rev"], json!(now.rev));
    assert_eq!(read["problems"].as_array().map(Vec::len), Some(1), "{read}");

    let refused = call("keys.settings_read", json!({ "file": "look.toml" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}
