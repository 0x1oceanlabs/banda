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
