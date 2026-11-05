//! The files module through the kernel, as a Pane and an Agent use it.

use banda_files::Files;
use banda_files::model::{Found, Kind, Listing, Stat, Text, Watched};
use banda_kernel::{
    AgentId, Caller, Code, CommandId, Kernel, Participant, PersonId, ProjectId, Refusal,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    folder: PathBuf,
    root: tempfile::TempDir,
}

impl World {
    async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(Files::new())
            .open()
            .await
            .unwrap();
        let made = (kernel.call(
            Participant::Person(owner),
            "projects.create",
            None,
            Some(CommandId::new()),
            json!({ "name": "Work" }),
        ))
        .await
        .unwrap();
        let project: ProjectId = serde_json::from_value(made["id"].clone()).unwrap();
        let folder = kernel.project(project).await.unwrap().folder();
        let folder = folder.canonicalize().unwrap();
        World {
            kernel,
            owner,
            project,
            folder,
            root,
        }
    }

    fn write(&self, path: &str, text: &str) {
        let path = self.folder.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A folder beside the Project's, outside it.
    fn outside(&self) -> PathBuf {
        let outside = self.root.path().canonicalize().unwrap().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        outside
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        (self.kernel)
            .call(person, method, Some(self.project), None, params)
            .await
    }

    /// The call as an Agent's, whose pass walls it in the Project.
    async fn call_as_agent(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let agent = Caller {
            participant: Participant::Agent(AgentId::new()),
            only: Some(self.project),
        };
        self.kernel.call(agent, method, None, None, params).await
    }

    async fn ask<T: DeserializeOwned>(&self, method: &str, params: Value) -> T {
        serde_json::from_value(self.call(method, params).await.unwrap()).unwrap()
    }
}

fn git(folder: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .output()
        .is_ok_and(|out| out.status.success())
}

fn names(listing: &Listing) -> Vec<&str> {
    listing.entries.iter().map(|e| e.name.as_str()).collect()
}

#[tokio::test]
async fn a_folder_lists_folders_first_then_by_name_as_a_person_reads_it() {
    let world = World::new().await;
    for path in ["b10.txt", "B2.txt", "a.txt", ".env", "zeta/x", "Alpha/y"] {
        world.write(path, "x");
    }
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    assert_eq!(listing.dir, world.folder.to_string_lossy());
    assert!(listing.inside);
    assert_eq!(
        names(&listing),
        ["Alpha", "zeta", ".env", "a.txt", "B2.txt", "b10.txt"]
    );
    let env = &listing.entries[2];
    assert!(env.hidden && env.kind == Kind::File && env.size == Some(1));
    assert!(env.modified.is_some());
    assert!(!listing.entries[3].hidden);
    let alpha = &listing.entries[0];
    assert_eq!((alpha.kind, alpha.size), (Kind::Folder, None));
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_says_whether_it_leads_to_a_folder() {
    let world = World::new().await;
    world.write("src/main.rs", "");
    std::os::unix::fs::symlink(world.folder.join("src"), world.folder.join("code")).unwrap();
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    assert_eq!(names(&listing), ["code", "src"]);
    let code = &listing.entries[0];
    assert!(code.kind == Kind::Link && code.to_folder);
}

#[tokio::test]
async fn what_git_ignores_is_marked_not_left_out() {
    let world = World::new().await;
    if !git(&world.folder, &["init", "-q"]) {
        return;
    }
    world.write(".gitignore", "built/\n*.log\n");
    world.write("built/out.js", "");
    world.write("debug.log", "");
    world.write("src/kept.rs", "");
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    let ignored: Vec<&str> = (listing.entries.iter())
        .filter(|e| e.ignored)
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(ignored, ["built", "debug.log"]);
    assert_eq!(
        names(&listing),
        [".git", "built", "src", ".gitignore", "debug.log"]
    );
    // Inside .git, nothing is marked.
    let inside: Listing = world.ask("files.list", json!({ "dir": ".git" })).await;
    assert!(inside.entries.iter().all(|e| !e.ignored));
}

#[tokio::test]
async fn the_person_lists_any_folder_and_an_agent_only_the_projects() {
    let world = World::new().await;
    let outside = world.outside();
    let dir = outside.to_string_lossy();
    let listing: Listing = world.ask("files.list", json!({ "dir": dir })).await;
    assert_eq!(names(&listing), ["secret.txt"]);
    assert!(!listing.inside);

    for (method, params) in [
        ("files.list", json!({ "dir": dir })),
        ("files.list", json!({ "dir": "../outside" })),
        ("files.read", json!({ "path": outside.join("secret.txt") })),
        (
            "files.stat",
            json!({ "paths": [outside.join("secret.txt")] }),
        ),
        ("files.find", json!({ "dir": dir, "query": "" })),
        ("files.watch", json!({ "dirs": [dir] })),
    ] {
        let refused = match method {
            "files.watch" => {
                let agent = Caller {
                    participant: Participant::Agent(AgentId::new()),
                    only: Some(world.project),
                };
                world.kernel.stream(agent, method, None, params).await.err()
            }
            _ => world.call_as_agent(method, params).await.err(),
        };
        let refused = refused.unwrap_or_else(|| panic!("{method} reached outside"));
        assert_eq!(refused.code, Code::Forbidden, "{method}");
    }
    world.write("notes.md", "# hi");
    let listing = world.call_as_agent("files.list", json!({})).await.unwrap();
    assert_eq!(listing["entries"][0]["name"], "notes.md");
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_follows_no_link_out_of_the_folder() {
    let world = World::new().await;
    let outside = world.outside();
    std::os::unix::fs::symlink(&outside, world.folder.join("out")).unwrap();
    let refused = (world.call_as_agent("files.read", json!({ "path": "out/secret.txt" })))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let text: Text = (world.ask("files.read", json!({ "path": "out/secret.txt" }))).await;
    assert_eq!(text.text.as_deref(), Some("secret"));
}

#[tokio::test]
async fn a_text_is_read_and_cut_on_a_character() {
    let world = World::new().await;
    world.write("a.txt", "héllo");
    let text: Text = world
        .ask("files.read", json!({ "path": "a.txt", "upto": 2 }))
        .await;
    assert_eq!(text.text.as_deref(), Some("h"));
    assert!(text.truncated && !text.binary && text.hash.is_none());
    assert_eq!(text.bytes, 6);
    let whole: Text = world.ask("files.read", json!({ "path": "a.txt" })).await;
    assert_eq!(whole.text.as_deref(), Some("héllo"));
    assert_eq!(whole.hash.unwrap().len(), 64);

    let refused = world
        .call("files.read", json!({ "path": "gone.txt" }))
        .await;
    assert_eq!(refused.unwrap_err().code, Code::NotFound);
    let refused = world.call("files.read", json!({ "path": "" })).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
}

#[tokio::test]
async fn a_stat_says_what_each_path_is_or_that_it_is_gone() {
    let world = World::new().await;
    world.write("docs/notes.md", "# hi");
    let stats: Vec<Option<Stat>> = (world.ask(
        "files.stat",
        json!({ "paths": ["docs", "docs/notes.md", "gone"] }),
    ))
    .await;
    let docs = stats[0].as_ref().unwrap();
    assert_eq!(docs.kind, Kind::Folder);
    let notes = stats[1].as_ref().unwrap();
    assert_eq!(notes.mime.as_deref(), Some("text/markdown"));
    assert_eq!(notes.size, Some(4));
    assert_eq!(stats[2], None);
}

#[tokio::test]
async fn find_ranks_a_name_above_a_folder_and_leaves_out_what_is_ignored() {
    let world = World::new().await;
    for path in [
        "main/notes.txt",
        "src/main.rs",
        "src/domain.rs",
        "built/main.js",
        ".gitignore",
    ] {
        world.write(path, "");
    }
    world.write(".gitignore", "built/\n");
    let found: Found = world.ask("files.find", json!({ "query": "main" })).await;
    assert_eq!(
        found.paths,
        ["src/main.rs", "src/domain.rs", "main/notes.txt"]
    );
    assert!(!found.cut);
    let found: Found = (world.ask(
        "files.find",
        json!({ "dir": "src", "query": "rs", "limit": 1 }),
    ))
    .await;
    assert_eq!(found.paths.len(), 1);
    assert_eq!(found.dir, world.folder.join("src").to_string_lossy());
}

#[tokio::test]
async fn watch_says_which_folder_changed() {
    let world = World::new().await;
    world.write("src/main.rs", "");
    let person = Participant::Person(world.owner);
    let mut stream = (world.kernel)
        .stream(
            person,
            "files.watch",
            Some(world.project),
            json!({ "dirs": ["", "src"] }),
        )
        .await
        .unwrap();
    let mut next = async || -> Watched {
        let piece = tokio::time::timeout(Duration::from_secs(2), stream.recv())
            .await
            .expect("nothing heard within 2 s")
            .expect("the stream ended");
        serde_json::from_value(piece).unwrap()
    };
    assert_eq!(
        next().await,
        Watched::Watching {
            dirs: vec![String::new(), "src".to_owned()]
        }
    );
    world.write("src/new.rs", "");
    assert_eq!(
        next().await,
        Watched::Changed {
            dirs: vec!["src".to_owned()]
        }
    );
}
