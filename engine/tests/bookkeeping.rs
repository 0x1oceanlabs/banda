//! What the git, files and pulls modules run by themselves on a Project's
//! repository, whose every hook and every program its config can name
//! for it leaves a mark: a status, each diff, a turn's checkpoints, a
//! watch's tick and its fetch, the commits, an ignore check, a file's last
//! commit and the remote a pull request is read from. None leaves one,
//! while the Person's own git does.
#![cfg(unix)]

use banda_files::Files;
use banda_git::Git;
use banda_kernel::{
    Call, CommandId, Kernel, Module, Participant, PersonId, ProjectId, Refusal, Right,
};
use banda_pulls::Pulls;
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

/// Every hook githooks(5) names.
const HOOKS: [&str; 28] = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-receive",
    "update",
    "proc-receive",
    "post-receive",
    "post-update",
    "reference-transaction",
    "push-to-checkout",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "fsmonitor-watchman",
    "p4-changelist",
    "p4-prepare-changelist",
    "p4-post-changelist",
    "p4-pre-submit",
    "post-index-change",
];

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

/// A Project whose folder is a trapped repository: it follows `main` of
/// `up`, a repository beside it, borrows the objects of another, and its
/// every hook and every program its config names for Banda's reads
/// leaves a mark in `marks`.
struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    folder: PathBuf,
    /// Beside the Project: `up`, `alt`, the programs and their marks.
    beside: tempfile::TempDir,
    _root: tempfile::TempDir,
}

impl World {
    async fn new() -> World {
        let (root, beside) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let owner = PersonId::new();
        let gh = beside.path().join("gh");
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
        let world = World {
            kernel,
            owner,
            project,
            folder,
            beside,
            _root: root,
        };
        world.repository();
        world.arm();
        world
    }

    /// The repository, before it is armed: `main` of `up`, a commit with a
    /// signature on it, and something new on `up` to fetch.
    fn repository(&self) {
        let (beside, folder) = (self.beside.path(), &self.folder);
        std::fs::create_dir_all(self.marks()).unwrap();
        for name in ["up", "alt"] {
            git(
                beside,
                &["-c", "init.defaultBranch=main", "init", "--quiet", name],
            );
            commit_in(&beside.join(name), "first");
        }
        git(
            folder,
            &["-c", "init.defaultBranch=main", "init", "--quiet"],
        );
        for (key, value) in [
            ("user.name", "Ann"),
            ("user.email", "ann@example.com"),
            ("commit.gpgsign", "false"),
        ] {
            git(folder, &["config", key, value]);
        }
        git(
            folder,
            &["remote", "add", "origin", "git@github.com:o/r.git"],
        );
        let up = beside.join("up");
        git(folder, &["remote", "add", "up", up.to_str().unwrap()]);
        git(folder, &["fetch", "--quiet", "up"]);
        git(
            folder,
            &["checkout", "--quiet", "-B", "main", "--track", "up/main"],
        );
        write(
            &folder.join(".gitattributes"),
            "*.txt filter=proc diff=conv\n*.md filter=pipe\n",
        );
        write(&folder.join(".gitignore"), "*.log\n");
        for path in ["a.txt", "c.md", "e.md"] {
            write(&folder.join(path), "one\n");
        }
        git(folder, &["add", "--all"]);
        git(folder, &["commit", "--quiet", "-m", "second"]);
        // A commit with a signature, which a log checks when asked to.
        write(&folder.join("signed.txt"), "signed\n");
        git(folder, &["add", "signed.txt"]);
        let tree = git(folder, &["write-tree"]);
        let parent = git(folder, &["rev-parse", "HEAD"]);
        let signed = format!(
            "tree {tree}\nparent {parent}\nauthor Ann <ann@example.com> 1 +0000\n\
             committer Ann <ann@example.com> 1 +0000\n\
             gpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nsigned\n"
        );
        let object = beside.join("signed");
        write(&object, &signed);
        let at = object.to_str().unwrap();
        let signed = git(folder, &["hash-object", "-t", "commit", "-w", at]);
        git(folder, &["update-ref", "refs/heads/main", &signed]);
        commit_in(&up, "third");
        let alternates = folder.join(".git/objects/info/alternates");
        write(
            &alternates,
            &format!("{}\n", beside.join("alt/.git/objects").display()),
        );
    }

    /// Every hook, and every program the config names for a read, leaves
    /// its mark; then the work tree changes.
    fn arm(&self) {
        let folder = &self.folder;
        for hook in HOOKS {
            let program = self.program(&format!("hook-{hook}"), "exit 0");
            std::fs::copy(program, folder.join(".git/hooks").join(hook)).unwrap();
        }
        let config = [
            ("hook.trap.command", self.program("config-hook", "exit 0")),
            ("core.fsmonitor", self.program("fsmonitor", "exit 1")),
            (
                "filter.proc.process",
                self.program("filter-process", "exit 1"),
            ),
            ("filter.pipe.clean", self.program("filter-clean", "cat")),
            ("filter.pipe.smudge", self.program("filter-smudge", "cat")),
            ("diff.conv.textconv", self.program("textconv", "cat \"$1\"")),
            ("diff.conv.command", self.program("diff-command", "exit 0")),
            ("diff.external", self.program("external-diff", "exit 0")),
            ("gpg.program", self.program("gpg", "exit 1")),
            (
                "core.alternateRefsCommand",
                self.program("alternate-refs", "exit 0"),
            ),
            (
                "remote.up.uploadpack",
                self.program("upload-pack", "exec git-upload-pack \"$@\""),
            ),
        ];
        for (key, program) in config {
            git(folder, &["config", key, program.to_str().unwrap()]);
        }
        for event in ["reference-transaction", "post-index-change", "pre-auto-gc"] {
            git(folder, &["config", "--add", "hook.trap.event", event]);
        }
        git(folder, &["config", "log.showSignature", "true"]);
        // Files changed, one whose time alone changed, one untracked and
        // one ignored.
        write(&folder.join("a.txt"), "one\ntwo\n");
        write(&folder.join("e.md"), "one\ntwo\n");
        let file = std::fs::File::options()
            .write(true)
            .open(folder.join("c.md"))
            .unwrap();
        file.set_modified(std::time::UNIX_EPOCH + Duration::from_secs(1_000_000))
            .unwrap();
        write(&folder.join("b.txt"), "new\n");
        write(&folder.join("x.log"), "log\n");
    }

    fn marks(&self) -> PathBuf {
        self.beside.path().join("marks")
    }

    /// A program that leaves the mark `name`, then runs `then`.
    fn program(&self, name: &str, then: &str) -> PathBuf {
        let path = self.beside.path().join("programs").join(name);
        let mark = self.marks().join(name);
        executable(
            &path,
            &format!("#!/bin/sh\ntouch '{}'\n{then}\n", mark.display()),
        );
        path
    }

    /// The marks left, by name.
    fn left(&self) -> Vec<String> {
        let mut left: Vec<String> = std::fs::read_dir(self.marks())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        left
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

    /// The agents module says `kind` about turn `turn` of Thread `t`.
    async fn say(&self, kind: &str, turn: &str) {
        let fact = json!({ "kind": kind, "thread": "t", "turn": turn });
        self.ask("agents.say", fact).await;
    }

    /// The checkpoints kept, once git has kept `count`.
    async fn checkpoints(&self, count: usize) -> Vec<String> {
        for _ in 0..500 {
            let refs = git(
                &self.folder,
                &["for-each-ref", "--format=%(refname)", "refs/banda/"],
            );
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

    // The status, and a watch's tick, whose fetch finds `up`'s commit.
    let status = world.ask("git.status", json!({})).await;
    let mut changed: Vec<&str> = (status["files"].as_array().unwrap().iter())
        .map(|file| file["path"].as_str().unwrap())
        .collect();
    changed.sort();
    assert_eq!(changed, ["a.txt", "b.txt", "e.md"], "{status}");
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
        assert_eq!(
            diff["patch"].as_str().unwrap().contains("+two"),
            scope != "staged"
        );
    }
    let only = json!({ "scope": { "kind": "uncommitted" }, "files": ["a.txt"] });
    world.ask("git.diff", only).await;
    let contents = json!({ "scope": { "kind": "uncommitted" }, "path": "a.txt" });
    world.ask("git.contents", contents).await;
    world.ask("git.refs", json!({})).await;
    let commits = world.ask("git.commits", json!({})).await;
    assert_eq!(commits[0]["subject"], "signed", "{commits}");
    world.ask("git.prompt", json!({})).await;

    // A turn's checkpoints, its diff, and letting them go.
    world.say("turn.started", "u").await;
    world.checkpoints(1).await;
    write(&world.folder.join("d.txt"), "turn\n");
    world.say("turn.ended", "u").await;
    world.checkpoints(2).await;
    let turn = json!({ "scope": { "kind": "turn", "thread": "t", "turn": "u" } });
    let diff = world.ask("git.diff", turn).await;
    assert_eq!(diff["files"][0]["path"], "d.txt", "{diff}");
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

    assert_eq!(world.left(), Vec::<String>::new());

    // The Person's own git runs them.
    git(&world.folder, &["status", "--porcelain"]);
    let head = git(&world.folder, &["rev-parse", "HEAD"]);
    git(&world.folder, &["update-ref", "refs/banda/x", &head]);
    git(&world.folder, &["log", "-1", "--format=%H"]);
    let left = world.left();
    for mark in [
        "filter-clean",
        "fsmonitor",
        "gpg",
        "hook-reference-transaction",
    ] {
        assert!(left.iter().any(|left| left == mark), "{mark}: {left:?}");
    }
}

/// Runs the Person's own git in `folder`, and says what it printed.
fn git(folder: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(folder)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

/// A commit of a new file in the repository at `folder`.
fn commit_in(folder: &Path, message: &str) {
    write(&folder.join(format!("{message}.txt")), message);
    git(folder, &["add", "--all"]);
    let commit = [
        "-c",
        "user.name=Ann",
        "-c",
        "user.email=ann@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        message,
    ];
    git(folder, &commit);
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// Writes `text` to `file`, a program anyone may run.
fn executable(file: &Path, text: &str) {
    write(file, text);
    std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
}
