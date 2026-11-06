//! What the git, files and pulls modules run by themselves on a Project's
//! repository, the trap (`platform/git-cli/tests/trap`), whose every hook
//! and every program its config or its submodule's can name leaves a
//! mark: a status, each diff, the reads before an act, a turn's
//! checkpoints, a watch's tick and its fetch, the commits, an ignore
//! check, a file's last commit and the remote a pull request is read
//! from. None leaves one, while the Person's own git does.
#![cfg(unix)]

#[path = "../../platform/git-cli/tests/trap/mod.rs"]
mod trap;

use banda_files::Files;
use banda_git::Git;
use banda_kernel::{
    Call, Code, CommandId, Kernel, Module, Participant, PersonId, ProjectId, Refusal, Right,
};
use banda_pulls::Pulls;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use trap::{Trap, executable, git, git_in, tried, write};

/// The agents module as git hears it: `say { kind, thread, turn }` writes
/// the fact `kind` about `thread`.
struct Agents;

#[async_trait::async_trait]
impl Module for Agents {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, _: &str) -> Option<Right> {
        Some(Right::Write)
    }

    async fn call(&self, call: Call, _: &str, fact: Value) -> Result<Value, Refusal> {
        let by = call.participant();
        call.command(move |tx| {
            let (kind, thread) = (fact["kind"].as_str().unwrap(), fact["thread"].as_str());
            tx.emit(kind, 1, thread, by, &fact)?;
            Ok(())
        })
        .await?;
        Ok(Value::Null)
    }
}

/// A Project whose folder is the trap's repository.
struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    trap: Trap,
    _root: tempfile::TempDir,
}

impl World {
    async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let gh = root.path().join("gh");
        executable(&gh, "#!/bin/sh\nexit 1\n");
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(Git::new())
            .module(Files::new())
            .module(Pulls::new().gh(gh))
            .module(Agents)
            .open()
            .await
            .unwrap();
        let made = kernel
            .call(
                Participant::Person(owner),
                "projects.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let project: ProjectId = serde_json::from_value(made["id"].clone()).unwrap();
        let folder = kernel
            .project(project)
            .await
            .unwrap()
            .folder()
            .to_path_buf();
        World {
            kernel,
            owner,
            project,
            trap: Trap::new(&folder),
            _root: root,
        }
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let commands = ["agents.say", "pulls.link"];
        let command = commands.contains(&method).then(CommandId::new);
        let person = Participant::Person(self.owner);
        (self.kernel)
            .call(person, method, Some(self.project), command, params)
            .await
    }

    async fn ask(&self, method: &str, params: Value) -> Value {
        match self.call(method, params).await {
            Ok(answer) => answer,
            Err(refusal) => panic!("{method}: {refusal:?}"),
        }
    }

    /// `method` refuses, as the files are not as the Diff drew them.
    async fn moved(&self, method: &str, params: Value) {
        let refused = self.call(method, params).await.unwrap_err();
        assert_eq!(refused.code, Code::Conflict, "{method}: {refused:?}");
    }

    /// The agents module says `kind` about turn `turn` of Thread `t`.
    async fn say(&self, kind: &str, turn: &str) {
        let fact = json!({ "kind": kind, "thread": "t", "turn": turn });
        self.ask("agents.say", fact).await;
    }

    /// The checkpoints kept, once git has kept `count`.
    async fn checkpoints(&self, count: usize) -> Vec<String> {
        for _ in 0..500 {
            let listed = ["for-each-ref", "--format=%(refname)", "refs/banda/"];
            let refs = git(&self.trap.repo, &listed);
            let refs: Vec<String> = refs.lines().map(str::to_owned).collect();
            if refs.len() == count {
                return refs;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("git kept no {count} checkpoints");
    }
}

#[tokio::test]
async fn what_the_modules_run_by_themselves_runs_no_program_the_repository_names() {
    let world = World::new().await;
    let repo = &world.trap.repo;

    // The status, and a watch's tick, whose fetch finds `up`'s commit.
    let status = world.ask("git.status", json!({})).await;
    let mut changed: Vec<&str> = (status["files"].as_array().unwrap().iter())
        .map(|file| file["path"].as_str().unwrap())
        .collect();
    changed.sort();
    assert_eq!(changed, ["a.txt", "b.txt", "e.md", "sub"], "{status}");
    let person = Participant::Person(world.owner);
    let mut watched = (world.kernel)
        .stream(person, "git.watch", Some(world.project), json!({}))
        .await
        .unwrap();
    let fetched = tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(status) = watched.recv().await {
            if status["behind"] == 1 {
                return;
            }
        }
    });
    assert!(fetched.await.is_ok(), "the watch fetched `up`");
    drop(watched);

    // Each diff, and what a Pane reads beside it.
    for scope in ["uncommitted", "unstaged", "staged", "changes"] {
        let diff = world
            .ask("git.diff", json!({ "scope": { "kind": scope } }))
            .await;
        let patch = diff["patch"].as_str().unwrap();
        assert_eq!(patch.contains("+two"), scope != "staged", "{scope}");
        // The submodule by its commits.
        let commits = patch.contains("+Subproject commit");
        assert_eq!(commits, scope != "staged", "{scope}: {patch}");
    }
    let only = json!({ "scope": { "kind": "uncommitted" }, "files": ["a.txt"] });
    world.ask("git.diff", only).await;
    let contents = json!({ "scope": { "kind": "uncommitted" }, "path": "a.txt" });
    world.ask("git.contents", contents).await;
    world.ask("git.refs", json!({})).await;
    let commits = world.ask("git.commits", json!({})).await;
    assert_eq!(commits[0]["subject"], "signed", "{commits}");
    world.ask("git.prompt", json!({})).await;

    // What an act reads before it changes anything, here refused as the
    // files changed since the Diff drew them, or as a merge goes on.
    let index = git_in(&world.trap.up(), &["hash-object", "--stdin"], "one\n");
    let revert = json!({
        "files": ["a.txt"],
        "ids": { "a.txt": { "old_id": &index[..7], "new_id": "1234567" } },
    });
    world.moved("git.revert", revert).await;
    let hunk = json!({
        "files": ["a.txt"],
        "hunk": {
            "old_start": 1, "old_lines": 0, "new_start": 2, "new_lines": 1,
            "old_id": "1234567", "new_id": "7654321",
        },
    });
    world.moved("git.stage", hunk).await;
    write(
        &repo.join(".git/MERGE_HEAD"),
        &format!("{}\n", world.trap.head),
    );
    let commit = json!({ "action": "commit", "message": "x", "files": ["a.txt"] });
    let mut acting = (world.kernel)
        .stream(person, "git.act", Some(world.project), commit)
        .await
        .unwrap();
    let mut said = Vec::new();
    while let Some(piece) = acting.recv().await {
        said.push(piece);
    }
    let ended = said.last().unwrap();
    assert_eq!(ended["kind"], "failed", "{said:?}");
    std::fs::remove_file(repo.join(".git/MERGE_HEAD")).unwrap();

    // A turn's checkpoints, its diff, and letting them go. A file a filter
    // cleans is kept as the index has it, so the turn shows none of it.
    world.say("turn.started", "u").await;
    world.checkpoints(1).await;
    write(&repo.join("d.toml"), "turn\n");
    write(&repo.join("e.md"), "one\ntwo\nthree\n");
    world.say("turn.ended", "u").await;
    world.checkpoints(2).await;
    let turn = json!({ "scope": { "kind": "turn", "thread": "t", "turn": "u" } });
    let diff = world.ask("git.diff", turn).await;
    let files: Vec<&str> = (diff["files"].as_array().unwrap().iter())
        .map(|file| file["path"].as_str().unwrap())
        .collect();
    assert_eq!(files, ["d.toml"], "{diff}");
    world.say("thread.rewound", "u").await;
    world.checkpoints(0).await;

    // What Files reads of git: what it ignores, and a file's last commit.
    let listing = world.ask("files.list", json!({ "dir": "" })).await;
    let ignored: Vec<&str> = (listing["entries"].as_array().unwrap().iter())
        .filter(|entry| entry["ignored"] == true)
        .map(|entry| entry["name"].as_str().unwrap())
        .collect();
    assert_eq!(ignored, ["x.log"]);
    let info = world
        .ask("files.info", json!({ "path": "signed.txt" }))
        .await;
    assert_eq!(info["commit"]["subject"], "signed", "{info}");

    // The remote a pull request is read from.
    let linked = world
        .call("pulls.link", json!({ "pull": "#5", "thread": "t" }))
        .await;
    if let Err(refusal) = linked {
        assert!(!refusal.message.contains("not on GitHub"), "{refusal:?}");
    }

    assert_eq!(world.trap.left(), Vec::<String>::new());

    // The Person's own git runs them.
    tried(repo, &["status", "--porcelain"]);
    git(repo, &["update-ref", "refs/banda/x", &world.trap.head]);
    tried(repo, &["log", "-1", "--format=%H"]);
    tried(repo, &["diff", "--no-ext-diff", "HEAD", "--", "sub"]);
    world.trap.left_each(&[
        "filter-clean",
        "fsmonitor",
        "gpg",
        "hook-reference-transaction",
        "sub-filter",
        "sub-external",
    ]);
}
