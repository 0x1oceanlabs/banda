//! Installed Apps as the kernel runs them, on a real Node: the clients
//! App, Banda's example of an App from a folder, and an App whose methods
//! go wrong (ADR 0126, decisions 3, 4 and 7).

use banda_apps::Apps;
use banda_apps::folder::Folder;
use banda_apps::installed::{Installed, InstalledFrom};
use banda_kernel::host::Node;
use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, Participant, PersonId, ProjectSummary, Refusal,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// A Node on this machine's PATH, which the tests run workers on.
fn node() -> Option<Node> {
    let program = banda_kernel::host::find("node", &banda_kernel::host::path())?;
    Some(Node {
        program,
        electron: false,
    })
}

fn folder(app: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/folders")
        .join(app)
}

struct Host {
    kernel: Arc<Kernel>,
    owner: PersonId,
    /// Its machine's folders, which go with it.
    #[allow(dead_code)]
    dir: tempfile::TempDir,
}

/// Installs `apps`, each from its folder, in a machine's data, as an
/// install does while no engine runs there.
fn install(dir: &Path, owner: PersonId, apps: &[&Path]) {
    let installed = Installed::in_folder(dir.join("data/apps"));
    for from in apps {
        let from = InstalledFrom {
            from: from.to_path_buf(),
            by: Participant::Person(owner),
            project: None,
            at: banda_kernel::now_ms(),
        };
        let app = Folder::read(&from.from).unwrap();
        let copy = installed.stage(&app, &from).unwrap();
        installed.commit(&app, &from, &copy).unwrap();
    }
}

/// Starts an engine's kernel over `dir`, serving what is installed there,
/// as the engine does as it starts.
async fn serve(dir: &Path, owner: PersonId, node: Option<Node>) -> Arc<Kernel> {
    let registry = banda_kernel::Registry::new();
    let apps = Apps::new(Vec::new(), dir.join("data/apps"))
        .serving(registry.clone(), node)
        .answering_within(Duration::from_secs(2));
    let kernel = Kernel::builder(dir.join("root"), dir.join("data"), owner)
        .machine(dir.join("state/machine"))
        .environment(banda_environments::Local)
        .registry(registry)
        .module(apps.clone());
    let kernel = (apps.at_start().into_iter())
        .fold(kernel, |kernel, (served, app)| kernel.added(served, app));
    kernel.open().await.unwrap()
}

async fn host(apps: &[&str]) -> Host {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    let folders: Vec<PathBuf> = apps.iter().map(|app| folder(app)).collect();
    let folders: Vec<&Path> = folders.iter().map(|folder| &**folder).collect();
    install(dir.path(), owner, &folders);
    let kernel = serve(dir.path(), owner, node()).await;
    Host { kernel, owner, dir }
}

impl Host {
    fn person(&self) -> Participant {
        Participant::Person(self.owner)
    }

    async fn project(&self, name: &str) -> ProjectSummary {
        let command = Some(CommandId::new());
        let create = json!({ "name": name });
        let created = (self.kernel).call(self.person(), "projects.create", None, command, create);
        serde_json::from_value(created.await.unwrap()).unwrap()
    }

    /// The tools an Agent may call, as `banda mcp` lists them.
    async fn tools(&self) -> Vec<banda_kernel::Tool> {
        let listed = (self.kernel).call(self.person(), "projects.tools", None, None, json!({}));
        serde_json::from_value(listed.await.unwrap()).unwrap()
    }

    /// Calls a method of an App in `project` as the Person, a new command.
    async fn call(
        &self,
        project: &ProjectSummary,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        let command = Some(CommandId::new());
        (self.kernel)
            .call(self.person(), method, Some(project.id), command, params)
            .await
    }
}

/// Without a Node there is nothing to run: said once, the tests pass.
macro_rules! needs_node {
    () => {
        if node().is_none() {
            eprintln!("no node on PATH: the workers' tests need one");
            return;
        }
    };
}

#[tokio::test]
async fn an_installed_app_keeps_what_its_commands_write_in_each_project_and_agents_call_it() {
    needs_node!();
    let host = host(&["clients"]).await;
    let (work, home) = (host.project("Work").await, host.project("Home").await);

    let anna = json!({ "name": "Anna", "city": "Berlin", "email": "anna@example.com" });
    let added = host.call(&work, "clients.add", anna).await.unwrap();
    assert_eq!(
        added,
        json!({ "id": 1, "name": "Anna", "city": "Berlin", "email": "anna@example.com" })
    );
    let boris = host.call(
        &work,
        "clients.add",
        json!({ "name": "Boris", "city": "Lisbon" }),
    );
    assert_eq!(boris.await.unwrap()["id"], 2);

    // Another caller reads what was kept: an Agent, under its pass, in its
    // Project, by the method its tool names.
    let agent = Caller::agent(AgentId::new(), work.id);
    let find = json!({ "city": "berlin" });
    let found = host
        .kernel
        .call(agent, "clients.find", None, None, find.clone());
    assert_eq!(
        found.await.unwrap(),
        json!([{ "id": 1, "name": "Anna", "city": "Berlin", "email": "anna@example.com" }])
    );
    let tools = host.tools().await;
    let tool = tools
        .iter()
        .find(|tool| tool.name == "clients_find")
        .unwrap();
    assert_eq!(tool.method, "clients.find");
    assert!(tool.description.starts_with("Finds clients"));
    assert_eq!(tool.schema["properties"]["city"]["type"], "string");

    // Its data is each Project's: the other has its own empty tables.
    assert_eq!(
        host.call(&home, "clients.find", find).await.unwrap(),
        json!([])
    );

    // A refusal its method makes reaches the caller as it is, and the
    // command wrote nothing.
    let nobody = host.call(&work, "clients.note", json!({ "client": 9, "text": "?" }));
    let refused = nobody.await.unwrap_err();
    assert_eq!(
        (refused.code, &*refused.message),
        (Code::NotFound, "No client has the id 9.")
    );
    let noted = host.call(
        &work,
        "clients.note",
        json!({ "client": 1, "text": "Likes tea." }),
    );
    assert_eq!(noted.await.unwrap(), json!({ "client": "Anna" }));
    let notes = host
        .call(&work, "clients.notes", json!({ "client": 1 }))
        .await;
    assert_eq!(notes.unwrap()[0]["text"], "Likes tea.");

    // Its events are in the Project's log, under its name, by who called.
    let log = host.kernel.project(work.id).await.unwrap();
    let said = log.events_after(0, Default::default(), 10).await.unwrap();
    let kinds: Vec<_> = (said.iter())
        .map(|event| (&*event.module, &*event.kind, event.subject.as_deref()))
        .collect();
    assert_eq!(
        kinds,
        [
            ("clients", "added", Some("1")),
            ("clients", "added", Some("2")),
            ("clients", "noted", Some("1")),
        ]
    );
    assert_eq!(said[0].author, host.person());
    assert_eq!(said[0].payload["name"], "Anna");
}

#[tokio::test]
async fn a_command_sent_again_writes_once_and_commands_of_one_project_run_one_at_a_time() {
    needs_node!();
    let host = host(&["clients"]).await;
    let work = host.project("Work").await;
    let command = Some(CommandId::new());
    let add = |name: &str, command| {
        let params = json!({ "name": name });
        (host.kernel).call(host.person(), "clients.add", Some(work.id), command, params)
    };
    let first = add("Anna", command).await.unwrap();
    assert_eq!(
        add("Anna", command).await.unwrap(),
        first,
        "the receipt's answer"
    );

    // Ten at once each read the next id and write it: one at a time, no
    // two take the same.
    let all = (0..10).map(|n| add(&format!("Client {n}"), Some(CommandId::new())));
    let added = futures::future::join_all(all).await;
    let mut ids: Vec<i64> = (added.into_iter())
        .map(|client| client.unwrap()["id"].as_i64().unwrap())
        .collect();
    ids.sort();
    assert_eq!(ids, (2..=11).collect::<Vec<_>>());
    let found = host.call(&work, "clients.find", json!({})).await.unwrap();
    assert_eq!(found.as_array().unwrap().len(), 11);
}

#[tokio::test]
async fn what_goes_wrong_in_an_app_stays_in_that_app() {
    needs_node!();
    let host = host(&["clients", "trouble"]).await;
    let work = host.project("Work").await;
    let call = |method: &'static str, params: Value| host.call(&work, method, params);
    let kept = || async { call("trouble.kept", json!({})).await.unwrap() };
    call("trouble.keep", json!({ "word": "one" }))
        .await
        .unwrap();

    // A write past its own tables is refused, and nothing of the command
    // is kept, the write before it too: the App's to put right.
    let strayed = call("trouble.stray", json!({ "word": "two" }))
        .await
        .unwrap_err();
    assert_eq!(strayed.code, Code::Internal);
    assert!(
        strayed
            .message
            .starts_with("trouble.stray failed: its write 2:"),
        "{}",
        strayed.message
    );
    assert_eq!(kept().await, json!(["one"]));
    // What its table's own rules refuse is how things stand.
    let twice = call("trouble.keep", json!({ "word": "one" })).await;
    assert_eq!(twice.unwrap_err().code, Code::Conflict);
    // A read past them is refused to the worker, which goes on.
    let peeked = call("trouble.peek", json!({})).await.unwrap();
    let refused = peeked["refused"].as_str().unwrap();
    assert!(refused.contains("prohibited"), "{peeked}");
    // A call writes nothing.
    let scribbled = call("trouble.scribble", json!({ "word": "three" }))
        .await
        .unwrap_err();
    assert_eq!(scribbled.code, Code::Internal);
    assert!(
        scribbled.message.contains("a call writes nothing"),
        "{}",
        scribbled.message
    );
    // What its code throws says so, by its name.
    let failed = call("trouble.fail", json!({})).await.unwrap_err();
    assert_eq!(failed.code, Code::Internal);
    assert_eq!(failed.message, "trouble.fail failed: TypeError: it broke");
    // A method not in methods.json is none of the App's.
    let unknown = call("trouble.hidden", json!({})).await.unwrap_err();
    assert_eq!(unknown.code, Code::Invalid);

    // A method that does not answer in time may have run, and Banda wrote
    // nothing; its worker is let go of, and the next call starts another.
    let slow = call("trouble.slow", json!({})).await.unwrap_err();
    assert_eq!(slow.code, Code::MayHaveRun);
    assert!(
        slow.message.contains("did not answer in 2 s"),
        "{}",
        slow.message
    );
    assert_eq!(kept().await, json!(["one"]));
    // So may one whose worker ended before it answered.
    let died = call("trouble.die", json!({})).await.unwrap_err();
    assert_eq!(died.code, Code::MayHaveRun);
    assert!(
        died.message
            .starts_with("trouble.die got no answer: its worker ended"),
        "{}",
        died.message
    );
    assert_eq!(kept().await, json!(["one"]));

    // The other App never noticed, and each call says who calls and where.
    call("clients.add", json!({ "name": "Anna" }))
        .await
        .unwrap();
    let who = call("trouble.who", json!({})).await.unwrap();
    assert_eq!(who["by"], json!(host.person()));
    assert_eq!(
        who["project"],
        json!({ "id": work.id, "folder": work.folder })
    );
    assert!(
        host.tools()
            .await
            .iter()
            .all(|tool| tool.name != "trouble_who")
    );
}

/// Starts the engine's kernel over `dir` again, once the one before let go
/// of its Project: its lock is let go of a moment after the kernel.
async fn serve_again(dir: &Path, owner: PersonId) -> Arc<Kernel> {
    for _ in 0..200 {
        let kernel = serve(dir, owner, node()).await;
        if kernel.projects().await.len() == 1 {
            return kernel;
        }
        drop(kernel);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the Project never opened again");
}

#[tokio::test]
async fn an_app_whose_code_or_tables_are_broken_is_off_alone() {
    needs_node!();
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    // The clients App with a typo in its code, and the trouble App with one
    // in its tables.
    let copy = |app: &str| {
        let to = dir.path().join("written").join(app);
        let files = [
            "app.toml",
            "methods.json",
            "worker.mjs",
            "migrations/001.sql",
        ];
        for file in files {
            std::fs::create_dir_all(to.join(file).parent().unwrap()).unwrap();
            std::fs::copy(folder(app).join(file), to.join(file)).unwrap();
        }
        to
    };
    let (clients, trouble) = (copy("clients"), copy("trouble"));
    std::fs::write(clients.join("worker.mjs"), "export const methods = {\n").unwrap();
    let typo = "CREATE TABEL trouble_words (word TEXT)";
    std::fs::write(trouble.join("migrations/001.sql"), typo).unwrap();
    install(dir.path(), owner, &[&clients, &trouble]);
    let kernel = serve(dir.path(), owner, node()).await;
    let host = Host { kernel, owner, dir };
    // The Project opens, and each App says why it is off.
    let work = host.project("Work").await;
    let off = |method: &'static str| {
        let called = host.call(&work, method, json!({}));
        async move { called.await.unwrap_err() }
    };
    let code = off("clients.find").await;
    assert_eq!(code.code, Code::AppUnavailable);
    let words = "clients does not run. Its worker did not start:";
    assert!(code.message.starts_with(words), "{}", code.message);
    assert!(code.message.contains("SyntaxError"), "{}", code.message);
    let tables = off("trouble.kept").await;
    assert_eq!(tables.code, Code::AppUnavailable);
    let words = "Step 1 of its tables failed";
    assert!(tables.message.contains(words), "{}", tables.message);

    // Code that lacks a method methods.json declares says so as it starts.
    let Host { kernel, owner, dir } = host;
    drop(kernel);
    std::fs::write(
        clients.join("worker.mjs"),
        "export const methods = { add() {} }\n",
    )
    .unwrap();
    install(dir.path(), owner, &[&clients]);
    let kernel = serve_again(dir.path(), owner).await;
    let host = Host { kernel, owner, dir };
    let lacks = host.call(&work, "clients.add", json!({ "name": "Anna" }));
    let lacks = lacks.await.unwrap_err();
    assert_eq!(lacks.code, Code::AppUnavailable);
    let words = "methods.json declares find, and worker.mjs exports no method of that name.";
    assert!(lacks.message.ends_with(words), "{}", lacks.message);

    // Put right and installed again, they run from the engine's next start.
    let Host { kernel, owner, dir } = host;
    drop(kernel);
    install(dir.path(), owner, &[&folder("clients"), &folder("trouble")]);
    let kernel = serve_again(dir.path(), owner).await;
    let host = Host { kernel, owner, dir };
    let called = host.call(&work, "clients.add", json!({ "name": "Anna" }));
    called.await.unwrap();
    let called = host.call(&work, "trouble.keep", json!({ "word": "one" }));
    called.await.unwrap();
}

#[tokio::test]
async fn an_installed_app_on_a_machine_with_no_node_is_listed_and_says_why_it_does_not_run() {
    let dir = tempfile::tempdir().unwrap();
    let owner = PersonId::new();
    install(dir.path(), owner, &[&folder("clients")]);
    let kernel = serve(dir.path(), owner, None).await;
    let host = Host { kernel, owner, dir };
    let work = host.project("Work").await;
    let refused = host
        .call(&work, "clients.find", json!({}))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::AppUnavailable);
    assert!(refused.message.contains("no Node"), "{}", refused.message);
    // It is among what the engine runs, and the list says it runs this
    // version.
    let person = host.person();
    let described = (host.kernel).call(person, "apps.describe", None, None, json!({}));
    let described = described.await.unwrap();
    assert_eq!(described[0]["id"], "clients");
    assert_eq!(described[0]["methods"][1]["tool"], "clients_find");
    let installed = (host.kernel).call(person, "apps.installed", None, None, json!({}));
    assert_eq!(installed.await.unwrap()[0]["runs"], true);
}

/// An App installed while the engine runs is there at once, in every
/// Project, and so is one installed again or removed (ADR 0126, decision
/// 5): nothing restarts, and each change is said.
#[tokio::test]
async fn an_app_installed_while_the_engine_runs_is_there_at_once_and_is_replaced_and_removed() {
    needs_node!();
    let host = host(&[]).await;
    let work = host.project("Work").await;
    let machine = |method: &'static str, params: Value| {
        let command = Some(CommandId::new());
        (host.kernel).call(host.person(), method, None, command, params)
    };
    // The engine says its Apps now, and again as they change.
    let changes = (host.kernel).stream(host.person(), "machine.apps", None, json!({}));
    let mut changes = changes.await.unwrap();
    assert_eq!(changes.recv().await.unwrap(), json!([]));

    // The clients App, written in the Project's folder with its first step
    // alone, and installed.
    let written = Path::new(&work.folder).join("clients");
    let copy = |file: &str| {
        std::fs::create_dir_all(written.join(file).parent().unwrap()).unwrap();
        std::fs::copy(folder("clients").join(file), written.join(file)).unwrap();
    };
    for file in [
        "app.toml",
        "methods.json",
        "worker.mjs",
        "migrations/001.sql",
    ] {
        copy(file);
    }
    let install = || machine("apps.install", json!({ "folder": written }));
    let installed = install().await.unwrap();
    assert_eq!(
        (&installed["runs"], &installed["off"]),
        (&json!(true), &json!([]))
    );
    let listed = json!([{ "id": "clients", "version": "0.1.0", "api": 1 }]);
    assert_eq!(changes.recv().await.unwrap(), listed);
    // It runs, its methods are tools, and the welcome's list has it.
    let anna = json!({ "name": "Anna", "city": "Berlin" });
    host.call(&work, "clients.add", anna).await.unwrap();
    assert!(
        host.tools()
            .await
            .iter()
            .any(|tool| tool.name == "clients_add")
    );
    assert_eq!(host.kernel.apps()[0].id, "clients");
    // Its notes wait for their table: the second step is not installed.
    let early = host
        .call(&work, "clients.notes", json!({ "client": 1 }))
        .await;
    assert_eq!(early.unwrap_err().code, Code::Internal);

    // Installed again with a step that fails, it is off where it failed,
    // and says so as it is installed; a Project made then has it off too.
    std::fs::write(
        written.join("migrations/002.sql"),
        "CREATE TABEL clients_notes (id)",
    )
    .unwrap();
    let broken = install().await.unwrap();
    assert_eq!(broken["off"][0]["project"], json!(work.id));
    let why = broken["off"][0]["why"].as_str().unwrap();
    assert!(why.starts_with("Step 2 of its tables failed"), "{why}");
    let off = host
        .call(&work, "clients.find", json!({}))
        .await
        .unwrap_err();
    assert_eq!(off.code, Code::AppUnavailable);

    // Put right and installed again, it has what it kept, and its new
    // table, with no restart.
    copy("migrations/002.sql");
    let mended = install().await.unwrap();
    assert_eq!(mended["off"], json!([]));
    let found = host.call(&work, "clients.find", json!({ "city": "Berlin" }));
    assert_eq!(found.await.unwrap()[0]["name"], "Anna");
    let noted = host.call(
        &work,
        "clients.note",
        json!({ "client": 1, "text": "Tea." }),
    );
    noted.await.unwrap();
    let home = host.project("Home").await;
    assert_eq!(
        host.call(&home, "clients.find", json!({})).await.unwrap(),
        json!([])
    );

    // Removed, it has no method and no tool; installed again, its data is
    // there.
    machine("apps.remove", json!({ "id": "clients" }))
        .await
        .unwrap();
    let gone = host
        .call(&work, "clients.find", json!({}))
        .await
        .unwrap_err();
    assert_eq!(gone.code, Code::Invalid);
    assert!(
        host.tools()
            .await
            .iter()
            .all(|tool| tool.name != "clients_add")
    );
    assert!(host.kernel.apps().is_empty());
    install().await.unwrap();
    let notes = host
        .call(&work, "clients.notes", json!({ "client": 1 }))
        .await;
    assert_eq!(notes.unwrap()[0]["text"], "Tea.");
}
