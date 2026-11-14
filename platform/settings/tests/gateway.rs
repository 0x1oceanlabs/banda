//! A gateway account through the kernel, kept in the settings files
//! (ADR 0078, decision 1): the Person adds it with its key, which goes in
//! the keyring, never in a file the Harness reads; its Harness gets the
//! key with a pass that runs it, of its process or of a session in it,
//! and no other pass does.

use banda_harnesses::{Harnesses, HarnessesModule, Secrets};
use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, Participant, PersonId, ProjectId, Refusal,
};
use banda_settings::accounts::Store;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

mod whole;

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    list: Harnesses,
    secrets: Secrets,
    project: ProjectId,
    root: tempfile::TempDir,
}

impl World {
    async fn open() -> World {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("harnesses.toml");
        std::fs::write(
            &config,
            "[omarchy]\nenabled = false\n\n[[harness]]\nid = \"claude\"\n\n[[harness]]\nid = \"codex\"\n",
        )
        .unwrap();
        let list = Harnesses::load(&config).unwrap();
        let keyring = keyring_core::mock::Store::new().unwrap();
        let secrets =
            Secrets::with_keyring("banda-test", root.path().join("secrets"), Some(keyring));
        let module = HarnessesModule::new(list.clone()).with_accounts(
            root.path().join("accounts"),
            Arc::new(Store::new(whole::WHOLE, root.path().to_owned())),
            secrets.clone(),
        );
        let owner = PersonId::new();
        let kernel = Kernel::builder(
            root.path().join("projects"),
            root.path().join("data"),
            owner,
        )
        .machine(root.path().join("machine"))
        .module(module)
        .open()
        .await
        .unwrap();
        let made = kernel.call(
            Participant::Person(owner),
            "projects.create",
            None,
            Some(CommandId::new()),
            json!({ "name": "Work" }),
        );
        let project = serde_json::from_value(made.await.unwrap()["id"].clone()).unwrap();
        World {
            kernel,
            owner,
            list,
            secrets,
            project,
            root,
        }
    }

    async fn person(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        self.call(Participant::Person(self.owner).into(), method, params)
            .await
    }

    async fn call(&self, caller: Caller, method: &str, params: Value) -> Result<Value, Refusal> {
        let command = self
            .kernel
            .call(caller, method, None, Some(CommandId::new()), params);
        command.await
    }

    /// Every file under the world's folder that holds `text`.
    fn holding(&self, text: &str) -> Vec<PathBuf> {
        fn walk(folder: &Path, text: &str, found: &mut Vec<PathBuf>) {
            for entry in std::fs::read_dir(folder).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, text, found);
                } else if std::fs::read(&path)
                    .is_ok_and(|bytes| bytes.windows(text.len()).any(|w| w == text.as_bytes()))
                {
                    found.push(path);
                }
            }
        }
        let mut found = Vec::new();
        walk(self.root.path(), text, &mut found);
        found
    }
}

#[tokio::test]
async fn a_gateway_s_key_is_in_the_keyring_and_only_its_own_harness_reads_it() {
    let world = World::open().await;

    let added = world
        .person(
            "harnesses.add_gateway",
            json!({ "harness": "claude", "id": "or", "name": "OpenRouter",
                    "url": "https://openrouter.ai/api/", "key": " sk-or-secret-1\n" }),
        )
        .await
        .unwrap();
    assert_eq!(added["kept"], "keyring");
    assert_eq!(added["account"]["kind"], "gateway");
    assert_eq!(added["account"]["harness"], "claude");

    // Its Harness sends its requests to the gateway, and asks for the key
    // with `banda secret get`: no file holds the key.
    let settings = std::fs::read_to_string(world.root.path().join("harnesses.toml")).unwrap();
    assert!(settings.contains(r#"kind = "gateway""#), "{settings}");
    assert!(
        settings.contains(r#"url = "https://openrouter.ai/api""#),
        "{settings}"
    );
    let harness = world.list.find("or").unwrap();
    assert_eq!(
        harness.env["ANTHROPIC_BASE_URL"],
        "https://openrouter.ai/api"
    );
    let folder = Path::new(&harness.env["CLAUDE_CONFIG_DIR"]);
    let settings: Value =
        serde_json::from_str(&std::fs::read_to_string(folder.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(settings["apiKeyHelper"], "banda secret get or");
    assert_eq!(world.holding("sk-or-secret-1"), Vec::<PathBuf>::new());

    // Who it is signed in as, with no Harness started.
    let status = world
        .person("harnesses.account_status", json!({ "harness": "or" }))
        .await
        .unwrap();
    assert_eq!(status["signed_in_as"]["signed_in"], true);
    assert_eq!(status["signed_in_as"]["label"], "Gateway · openrouter.ai");
    assert_eq!(status["ways"], json!([]));

    // The Person reads it; so does a pass that runs it, of its process or
    // of a Thread's session in that process, as Claude Code's is.
    let secret =
        |caller: Caller| world.call(caller, "harnesses.secret", json!({ "harness": "or" }));
    assert_eq!(
        secret(Participant::Person(world.owner).into())
            .await
            .unwrap(),
        "sk-or-secret-1"
    );
    let agent = || Caller::agent(AgentId::new(), world.project);
    assert_eq!(secret(agent()).await.unwrap_err().code, Code::Forbidden);
    let own = agent().running("or");
    assert_eq!(secret(own).await.unwrap(), "sk-or-secret-1");
    let thread = agent().in_thread(uuid::Uuid::new_v4()).running("or");
    assert_eq!(secret(thread).await.unwrap(), "sk-or-secret-1");

    // Not another account's.
    let other = agent().in_thread(uuid::Uuid::new_v4()).running("claude");
    assert_eq!(secret(other).await.unwrap_err().code, Code::Forbidden);

    // A new key replaces it; an account with no gateway has none.
    let kept = world
        .person(
            "harnesses.set_key",
            json!({ "harness": "or", "key": "sk-or-secret-2" }),
        )
        .await
        .unwrap();
    assert_eq!(kept, "keyring");
    let person = Participant::Person(world.owner).into();
    assert_eq!(secret(person).await.unwrap(), "sk-or-secret-2");
    let none = world
        .person("harnesses.secret", json!({ "harness": "claude" }))
        .await;
    assert_eq!(none.unwrap_err().code, Code::NotFound);

    // It signs in with its key alone.
    let login = world
        .person("harnesses.login_account", json!({ "harness": "or" }))
        .await;
    assert_eq!(login.unwrap_err().code, Code::Invalid);

    // Removed, it takes its key with it.
    world
        .person("harnesses.remove_account", json!({ "harness": "or" }))
        .await
        .unwrap();
    assert!(world.list.views().iter().all(|h| h.id != "or"));
    assert!(!world.secrets.has("or").await);
}

#[tokio::test]
async fn a_codex_gateway_is_a_provider_of_its_own_and_an_address_is_checked() {
    let world = World::open().await;

    world
        .person(
            "harnesses.add_gateway",
            json!({ "harness": "codex", "id": "cx-or", "url": "https://openrouter.ai/api/v1",
                    "key": "sk-or-secret-3" }),
        )
        .await
        .unwrap();
    let harness = world.list.find("cx-or").unwrap();
    assert_eq!(harness.env["MODEL_PROVIDER"], "banda-gateway");
    let config: Value = serde_json::from_str(&harness.env["CODEX_CONFIG"]).unwrap();
    assert_eq!(config["model_provider"], "banda-gateway");
    let provider = "model_providers.banda-gateway";
    assert_eq!(
        config[format!("{provider}.base_url")],
        "https://openrouter.ai/api/v1"
    );
    assert_eq!(config[format!("{provider}.wire_api")], "responses");
    assert_eq!(config[format!("{provider}.auth.timeout_ms")], 60_000);
    assert_eq!(config[format!("{provider}.auth.command")], "banda");
    assert_eq!(
        config[format!("{provider}.auth.args")],
        json!(["secret", "get", "cx-or"])
    );
    assert_eq!(world.holding("sk-or-secret-3"), Vec::<PathBuf>::new());
    let status = world
        .person("harnesses.account_status", json!({ "harness": "cx-or" }))
        .await
        .unwrap();
    assert_eq!(
        status["signed_in_as"]["detail"],
        "https://openrouter.ai/api/v1"
    );

    for url in [
        "ftp://openrouter.ai",
        "openrouter.ai",
        "https://me:sk@openrouter.ai",
    ] {
        let refused = world
            .person(
                "harnesses.add_gateway",
                json!({ "harness": "claude", "id": "bad", "url": url, "key": "k" }),
            )
            .await;
        assert_eq!(refused.unwrap_err().code, Code::Invalid, "{url}");
    }
    assert!(world.list.find("bad").is_none());
    let empty = world
        .person(
            "harnesses.add_gateway",
            json!({ "harness": "claude", "id": "bad", "url": "https://x.ai", "key": " " }),
        )
        .await;
    assert_eq!(empty.unwrap_err().code, Code::Invalid);
    assert!(world.list.find("bad").is_none());
}
