//! A machine's settings read through its engine, as a window of another
//! device reads them (ADR 0106, decision 7): `keys.settings_read` answers
//! the machine's part of a file, and `keys.settings_changed` says each
//! machine file's `rev`, then each again as its part changes, by a set or
//! by hand, and nothing for a change of what is not the machine's.

use banda_kernel::{AgentId, Code, Kernel, Participant, PersonId, Stream};
use banda_keys::KeysModule;
use banda_keys::read::SettingChanged;
use serde_json::{Value, json};
use std::collections::BTreeSet;
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
    let path = config.join("agents.toml").display().to_string();
    assert_eq!(read["path"], json!(path), "where it is on this machine");
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
    // list, written by hand. It reads with no problem, so its text alone
    // tells it changed.
    let enter = json!({ "file": "agents.toml", "key": "enter", "value": "\"queue\"" });
    call("keys.settings_set", enter).await.unwrap();
    by_hand(&config, "look.toml", "radius = 4\n");
    let harnesses = "[[harness]]\nid = \"claude\"\nenabled = false\n";
    by_hand(&config, "harnesses.toml", harnesses);
    let now = next(&mut changed).await;
    assert_eq!(now.file, "harnesses.toml");
    let read = call("keys.settings_read", json!({ "file": "harnesses.toml" }))
        .await
        .unwrap();
    assert_eq!(read["rev"], json!(now.rev));
    assert_eq!(read["problems"], json!([]), "{read}");

    let refused = call("keys.settings_read", json!({ "file": "look.toml" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

/// What the Person changes through the engine is told to what hears them,
/// a key renamed as taken out under either name; an Agent is refused what
/// only the Person changes, as the file says, and what it may change is
/// told to none (ADR 0083).
#[tokio::test]
async fn the_person_s_changes_are_told_and_an_agent_s_are_refused_or_not_told() {
    let root = tempfile::tempdir().unwrap();
    let told = Arc::new(std::sync::Mutex::new(Vec::new()));
    let hears = told.clone();
    let keys = KeysModule::new(whole::WHOLE, root.path().join("config")).tells(Arc::new(
        move |file, key, value| {
            let said = (file.to_owned(), key.to_owned(), value.map(str::to_owned));
            hears.lock().unwrap().push(said);
            Ok(())
        },
    ));
    let owner = PersonId::new();
    let kernel = Kernel::builder(
        root.path().join("projects"),
        root.path().join("data"),
        owner,
    )
    .machine(root.path().join("state/machine"))
    .module(keys)
    .open()
    .await
    .unwrap();
    let call = async |by: Participant, method: &str, params: Value| {
        kernel.call(by, method, None, None, params).await
    };
    let person = Participant::Person(owner);
    let agent = Participant::Agent(AgentId::new());
    let mode =
        json!({ "file": "agents.toml", "key": "start.claude.mode", "value": "\"full_access\"" });

    for refused in [
        mode.clone(),
        json!({ "file": "browser.toml", "key": "agents.screenshots", "value": "true" }),
    ] {
        let refused = call(agent, "keys.settings_set", refused).await.unwrap_err();
        assert!(refused.message.contains("Only your Person"), "{refused:?}");
    }
    let enter = json!({ "file": "agents.toml", "key": "enter", "value": "\"queue\"" });
    call(agent, "keys.settings_set", enter).await.unwrap();
    assert_eq!(*told.lock().unwrap(), [], "an Agent's change is no choice");

    call(person, "keys.settings_set", mode).await.unwrap();
    let rename = json!({ "file": "agents.toml", "key": "start.claude.mode", "to": "plan" });
    call(person, "keys.settings_rename", rename)
        .await
        .unwrap_err();
    let reset = json!({ "file": "agents.toml", "key": "start.claude.mode" });
    call(person, "keys.settings_reset", reset).await.unwrap();
    let said = |key: &str, value: Option<&str>| {
        let value = value.map(str::to_owned);
        ("agents.toml".to_owned(), key.to_owned(), value)
    };
    assert_eq!(
        *told.lock().unwrap(),
        [
            said("start.claude.mode", Some("\"full_access\"")),
            said("start.claude.mode", None),
        ]
    );
}
