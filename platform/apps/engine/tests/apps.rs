//! The apps module through the kernel, as `banda app`, a window and an
//! Agent's pass use it: what the engine runs, described; and an App
//! installed from a folder, listed, installed again and removed (ADR 0126,
//! decision 5).

use banda_apps::Apps;
use banda_kernel::{
    AgentId, App, AppMethods, Caller, Code, CommandId, Does, Kernel, Kind, Method, Participant,
    PersonId, ProjectSummary, Refusal, Right,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// What the test's engine runs: a notes App with two methods, one an
/// Agent's tool, and a clock with none.
fn runs() -> Vec<AppMethods> {
    let list = Method {
        name: "list",
        kind: Kind::Call,
        right: Right::Read,
        does: Does::Read,
        tool: Some("jot_down"),
        pass: false,
        about: "Every note.".to_owned(),
    };
    let add = Method {
        name: "add",
        kind: Kind::Command,
        right: Right::Write,
        does: Does::Act,
        tool: None,
        pass: false,
        about: "Adds a note.".to_owned(),
    };
    let app = |id: &str, version: &str, methods| AppMethods {
        app: App {
            id: id.to_owned(),
            version: version.to_owned(),
            api: 1,
        },
        methods,
    };
    vec![
        app("notes", "0.2.0", vec![list, add]),
        app("clock", "0.1.0", vec![]),
    ]
}

struct Host {
    kernel: Arc<Kernel>,
    owner: PersonId,
    /// Banda's data's `apps`.
    installed: PathBuf,
    _dir: tempfile::TempDir,
}

async fn host() -> Host {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let installed = dir.path().join("data/apps");
    let kernel = Kernel::builder(dir.path().join("root"), dir.path().join("data"), owner)
        .module(Apps::new(runs(), &installed))
        .machine(dir.path().join("state/machine"))
        .open()
        .await
        .unwrap();
    Host {
        kernel,
        owner,
        installed,
        _dir: dir,
    }
}

impl Host {
    async fn call(
        &self,
        by: impl Into<Caller>,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        let command = Some(CommandId::new());
        self.kernel.call(by, method, None, command, params).await
    }

    fn person(&self) -> Participant {
        Participant::Person(self.owner)
    }

    async fn project(&self, name: &str) -> ProjectSummary {
        let created = self.call(self.person(), "projects.create", json!({ "name": name }));
        serde_json::from_value(created.await.unwrap()).unwrap()
    }

    async fn installed(&self) -> Value {
        let listed = self.call(self.person(), "apps.installed", json!({}));
        listed.await.unwrap()
    }
}

/// Writes a clients App in `folder`, at `version`.
fn write_app(folder: &Path, version: &str) {
    std::fs::create_dir_all(folder.join("migrations")).unwrap();
    let manifest = format!(
        "id = \"clients\"\nname = \"Clients\"\nabout = \"The people I work with.\"\n\
         version = \"{version}\"\napi = 1\nentry = \"worker.mjs\"\n"
    );
    std::fs::write(folder.join("app.toml"), manifest).unwrap();
    let methods = json!({
        "add": { "kind": "command", "about": "Adds a client.", "params": {
            "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"],
        } },
        "find": { "kind": "call", "about": "The clients in a city." },
    });
    std::fs::write(folder.join("methods.json"), methods.to_string()).unwrap();
    let people = "CREATE TABLE clients_people (id INTEGER PRIMARY KEY, name TEXT NOT NULL)";
    std::fs::write(folder.join("migrations/001.sql"), people).unwrap();
    std::fs::write(folder.join("worker.mjs"), "export const methods = {}\n").unwrap();
}

/// `apps.describe` answers what the engine runs, word for word as here: a
/// client of another build reads this shape (ADR 0082, decision 2).
#[tokio::test]
async fn describe_says_each_app_the_engine_runs_with_its_methods() {
    let host = host().await;
    let described = host.call(host.person(), "apps.describe", json!({})).await;
    let described = described.unwrap();
    assert_eq!(
        described,
        json!([
            { "id": "notes", "version": "0.2.0", "api": 1, "methods": [
                { "name": "list", "kind": "call", "right": "read", "does": "read",
                  "tool": "jot_down", "pass": false, "about": "Every note." },
                { "name": "add", "kind": "command", "right": "write", "does": "act",
                  "tool": null, "pass": false, "about": "Adds a note." },
            ] },
            { "id": "clock", "version": "0.1.0", "api": 1, "methods": [] },
        ])
    );
    // An Agent reads it too, under its pass.
    let work = host.project("Work").await;
    let agent = Caller::agent(AgentId::new(), work.id);
    let read = host.call(agent, "apps.describe", json!({})).await;
    assert_eq!(read.unwrap(), described);
}

#[tokio::test]
async fn an_app_is_installed_from_a_folder_listed_installed_again_and_removed() {
    let host = host().await;
    let work = host.project("Work").await;
    let folder = Path::new(&work.folder).join("clients");
    write_app(&folder, "0.1.0");
    assert_eq!(host.installed().await, json!([]));

    let install = json!({ "folder": folder });
    let installed = host.call(host.person(), "apps.install", install.clone());
    let installed = installed.await.unwrap();
    assert_eq!(installed["id"], "clients");
    assert_eq!(installed["version"], "0.1.0");
    // This engine serves none: it is installed, and no more.
    assert_eq!(
        (&installed["runs"], &installed["off"]),
        (&json!(false), &json!([]))
    );
    let mut listed = installed.clone();
    listed.as_object_mut().unwrap().remove("off");
    assert_eq!(host.installed().await, json!([listed]));
    // What runs is the copy: the folder it came from may change or go.
    let copy = || {
        let place = host.installed.join("clients");
        let kept = std::fs::read(place.join("installed.json")).unwrap();
        let kept: Value = serde_json::from_slice(&kept).unwrap();
        place.join(kept["copy"].as_str().unwrap())
    };
    assert!(copy().join("migrations/001.sql").is_file());
    assert!(copy().join("worker.mjs").is_file());
    // The machine's log says it.
    let machine = host.kernel.machine().unwrap();
    let log = host.kernel.follow(host.person(), machine).await.unwrap();
    let said = log.events_after(0, Default::default(), 10).await.unwrap();
    let kinds: Vec<_> = said.iter().map(|e| (&*e.module, &*e.kind)).collect();
    assert_eq!(kinds, [("apps", "installed")]);
    assert_eq!(said[0].subject.as_deref(), Some("clients"));

    // Installed again after a change, the copy is the new one, whole.
    write_app(&folder, "0.2.0");
    std::fs::remove_file(folder.join("migrations/001.sql")).unwrap();
    std::fs::remove_dir(folder.join("migrations")).unwrap();
    let again = host.call(host.person(), "apps.install", install).await;
    assert_eq!(again.unwrap()["version"], "0.2.0");
    assert!(!copy().join("migrations").exists());
    assert_eq!(host.installed().await[0]["version"], "0.2.0");

    // Removed, it is listed no more; removing it twice is refused.
    let remove = json!({ "id": "clients" });
    let removed = host.call(host.person(), "apps.remove", remove.clone());
    removed.await.unwrap();
    assert_eq!(host.installed().await, json!([]));
    let twice = host.call(host.person(), "apps.remove", remove).await;
    assert_eq!(twice.unwrap_err().code, Code::NotFound);
}

#[tokio::test]
async fn an_agent_installs_from_its_own_projects_folder_and_from_nowhere_else() {
    let host = host().await;
    let (work, other) = (host.project("Work").await, host.project("Other").await);
    write_app(&Path::new(&work.folder).join("clients"), "0.1.0");
    write_app(&Path::new(&other.folder).join("clients"), "0.1.0");
    let agent = || Caller::agent(AgentId::new(), work.id);

    // From its Project's folder, named from there or whole, with no click.
    let installed = host.call(agent(), "apps.install", json!({ "folder": "clients" }));
    let installed = installed.await.unwrap();
    assert_eq!(installed["project"], json!(work.id));
    let whole = json!({ "folder": Path::new(&work.folder).join("clients") });
    host.call(agent(), "apps.install", whole).await.unwrap();

    // Another Project's folder is outside its wall.
    let outside = json!({ "folder": Path::new(&other.folder).join("clients") });
    let refused = host.call(agent(), "apps.install", outside).await;
    assert_eq!(refused.unwrap_err().code, Code::Forbidden);
    let climbed = host.call(
        agent(),
        "apps.install",
        json!({ "folder": "../Other/clients" }),
    );
    assert_eq!(climbed.await.unwrap_err().code, Code::Forbidden);

    // It lists what is installed, and takes its own back.
    let listed = host.call(agent(), "apps.installed", json!({})).await;
    assert_eq!(listed.unwrap()[0]["id"], "clients");
    let removed = host.call(agent(), "apps.remove", json!({ "id": "clients" }));
    removed.await.unwrap();
}

#[tokio::test]
async fn an_app_that_takes_what_the_engine_runs_or_reads_amiss_is_refused_in_words() {
    let host = host().await;
    let work = host.project("Work").await;
    let folder = Path::new(&work.folder).join("clients");
    let install = || host.call(host.person(), "apps.install", json!({ "folder": folder }));
    let manifest = |id: &str| {
        format!(
            "id = \"{id}\"\nname = \"N\"\nabout = \"A\"\nversion = \"1\"\napi = 1\nentry = \"worker.mjs\"\n"
        )
    };

    // The Person names the folder whole.
    let relative = host.call(
        host.person(),
        "apps.install",
        json!({ "folder": "clients" }),
    );
    assert_eq!(relative.await.unwrap_err().code, Code::Invalid);
    let missing = install().await.unwrap_err();
    assert_eq!(missing.code, Code::NotFound);

    // An id the engine runs, or the kernel keeps, is taken.
    write_app(&folder, "0.1.0");
    for (id, code) in [
        ("notes", Code::Conflict),
        ("projects", Code::Invalid),
        ("kernel", Code::Invalid),
    ] {
        std::fs::write(folder.join("app.toml"), manifest(id)).unwrap();
        let taken = install().await.unwrap_err();
        assert_eq!(taken.code, code, "{id}");
        assert!(taken.message.contains(id), "{}", taken.message);
    }
    // So is a tool's name: `jot_down` is the notes App's.
    std::fs::remove_dir_all(folder.join("migrations")).unwrap();
    std::fs::write(folder.join("app.toml"), manifest("jot")).unwrap();
    let down = json!({ "down": { "kind": "call", "about": "Clashes." } });
    std::fs::write(folder.join("methods.json"), down.to_string()).unwrap();
    let clash = install().await.unwrap_err();
    assert_eq!(clash.code, Code::Conflict);
    assert!(clash.message.contains("jot_down"), "{}", clash.message);
    // Left out of the tools, it clashes with none.
    let quiet = json!({ "down": { "kind": "call", "about": "Clashes.", "tool": false } });
    std::fs::write(folder.join("methods.json"), quiet.to_string()).unwrap();
    install().await.unwrap();

    // What is wrong in the folder is said by its file. Nothing refused
    // changes what is installed.
    std::fs::write(
        folder.join("methods.json"),
        r#"{ "down": { "kind": "call" } }"#,
    )
    .unwrap();
    let wrong = install().await.unwrap_err();
    assert_eq!(wrong.code, Code::Invalid);
    assert_eq!(host.installed().await[0]["id"], "jot");
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_in_an_apps_folder_is_refused_and_leaves_what_was_installed() {
    let host = host().await;
    let work = host.project("Work").await;
    let folder = Path::new(&work.folder).join("clients");
    write_app(&folder, "0.1.0");
    let install = || host.call(host.person(), "apps.install", json!({ "folder": folder }));
    install().await.unwrap();

    write_app(&folder, "0.2.0");
    std::os::unix::fs::symlink("/etc/hostname", folder.join("secret")).unwrap();
    let linked = install().await.unwrap_err();
    assert_eq!(linked.code, Code::Invalid);
    assert!(linked.message.contains("is a link"), "{}", linked.message);
    assert_eq!(host.installed().await[0]["version"], "0.1.0");
    let left: Vec<_> = std::fs::read_dir(&host.installed)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name())
        .collect();
    assert_eq!(left, ["clients"], "no copy cut short is left");
}
