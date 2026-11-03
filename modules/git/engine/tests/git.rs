//! The git module through the kernel, as a Pane uses it, on repositories
//! the `git` program makes: each test's own, configured in the repository
//! alone, never in the Person's global config.

use banda_git::Git;
use banda_git::model::{
    Change, Changed, Commit, Contents, Diff, Done, Progress, Ref, Status, Step,
};
use banda_kernel::{
    Call, Code, CommandId, Kernel, Module, Participant, PersonId, Refusal, Right, SpaceId,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

/// The agents module as git hears it: a turn begins and ends, a Thread
/// goes back, as the test says.
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

    /// `say { kind, thread, turn }` writes the fact `kind` about `thread`.
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

struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    space: SpaceId,
    folder: PathBuf,
    _root: tempfile::TempDir,
}

impl World {
    /// A Space whose folder is no repository yet.
    async fn bare() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(Git::new())
            .module(Agents)
            .open()
            .await
            .unwrap();
        let space = kernel
            .call(
                Participant::Person(owner),
                "spaces.create",
                None,
                Some(CommandId::new()),
                json!({ "name": "Work" }),
            )
            .await
            .unwrap();
        let space: SpaceId = serde_json::from_value(space["id"].clone()).unwrap();
        let folder = kernel.space(space).await.unwrap().folder().to_path_buf();
        World {
            kernel,
            owner,
            space,
            folder,
            _root: root,
        }
    }

    /// A Space whose folder is a repository with no commits, on `main`.
    async fn new() -> World {
        let world = World::bare().await;
        world.git(&["-c", "init.defaultBranch=main", "init", "--quiet"]);
        world.git(&["config", "user.name", "Ann"]);
        world.git(&["config", "user.email", "ann@example.com"]);
        world.git(&["config", "commit.gpgsign", "false"]);
        world
    }

    /// A repository with one commit on `main`: `a.txt`, `b.txt`, `d.txt`.
    async fn committed() -> World {
        let world = World::new().await;
        world.write("a.txt", "one\ntwo\nthree\n");
        world.write("b.txt", "bee\nbee\nbee\nbee\nbee\n");
        world.write("d.txt", "doomed\n");
        world.commit("first");
        world
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        let person = Participant::Person(self.owner);
        self.kernel
            .call(person, method, Some(self.space), None, params)
            .await
    }

    /// The agents module says `kind` about turn `turn` of Thread `thread`.
    async fn say(&self, kind: &str, thread: &str, turn: &str) {
        let person = Participant::Person(self.owner);
        let fact = json!({ "kind": kind, "thread": thread, "turn": turn });
        (self.kernel)
            .call(
                person,
                "agents.say",
                Some(self.space),
                Some(CommandId::new()),
                fact,
            )
            .await
            .unwrap();
    }

    /// The checkpoints kept, once git has kept `count`.
    async fn checkpoints(&self, count: usize) -> Vec<String> {
        for _ in 0..500 {
            let refs = self.git(&["for-each-ref", "--format=%(refname)", "refs/banda/"]);
            let refs: Vec<String> = refs.lines().map(str::to_owned).collect();
            if refs.len() == count {
                return refs;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("git kept no {count} checkpoints");
    }

    async fn ask<T: DeserializeOwned>(&self, method: &str, params: Value) -> T {
        let answer = self.call(method, params).await.unwrap();
        serde_json::from_value(answer).unwrap()
    }

    async fn status(&self) -> Status {
        self.ask("git.status", json!({})).await
    }

    async fn diff(&self, ask: Value) -> Diff {
        self.ask("git.diff", ask).await
    }

    /// Runs git in the Space's folder, as the Person would, and says what
    /// it printed.
    fn git(&self, args: &[&str]) -> String {
        run_git(&self.folder, args)
    }

    /// A stream's pieces until it says how it ended, or for `within`.
    async fn stream(&self, method: &str, params: Value, within: u64) -> Vec<Value> {
        let person = Participant::Person(self.owner);
        let mut heard = self
            .kernel
            .stream(person, method, Some(self.space), params)
            .await
            .unwrap();
        let mut pieces = Vec::new();
        let end = tokio::time::Instant::now() + std::time::Duration::from_secs(within);
        while let Ok(Some(piece)) = tokio::time::timeout_at(end, heard.recv()).await {
            let ended = matches!(piece["kind"].as_str(), Some("done" | "failed"));
            pieces.push(piece);
            if ended {
                break;
            }
        }
        pieces
    }

    /// What `git.act` said as it went.
    async fn act(&self, ask: Value) -> Vec<Progress> {
        let pieces = self.stream("git.act", ask, 60).await;
        pieces
            .into_iter()
            .map(|p| serde_json::from_value(p).unwrap())
            .collect()
    }

    /// A bare repository beside the Space's folder, as its `origin`, with
    /// `main` pushed and followed.
    fn remote(&self) -> PathBuf {
        let remote = self._root.path().join("remote.git");
        run_git(
            self._root.path(),
            &[
                "init",
                "--quiet",
                "--bare",
                "--initial-branch=main",
                "remote.git",
            ],
        );
        self.git(&["remote", "add", "origin", remote.to_str().unwrap()]);
        self.git(&["push", "--quiet", "-u", "origin", "main"]);
        remote
    }

    /// Another clone of the remote, as another Person's, which commits
    /// `path` on `branch` and pushes it.
    fn theirs(&self, branch: &str, path: &str) {
        let root = self._root.path();
        if !root.join("theirs").exists() {
            run_git(root, &["clone", "--quiet", "remote.git", "theirs"]);
            let theirs = root.join("theirs");
            run_git(&theirs, &["config", "user.name", "Bo"]);
            run_git(&theirs, &["config", "user.email", "bo@example.com"]);
            run_git(&theirs, &["config", "commit.gpgsign", "false"]);
        }
        let theirs = root.join("theirs");
        run_git(&theirs, &["checkout", "--quiet", "-B", branch]);
        std::fs::write(theirs.join(path), "theirs\n").unwrap();
        run_git(&theirs, &["add", "--all"]);
        run_git(&theirs, &["commit", "--quiet", "-m", "theirs"]);
        run_git(&theirs, &["push", "--quiet", "origin", branch]);
    }

    fn write(&self, path: &str, text: &str) {
        let file = self.folder.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    }

    /// Commits all there is, and says the commit's sha.
    fn commit(&self, message: &str) -> String {
        self.git(&["add", "--all"]);
        self.git(&["commit", "--quiet", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    fn index(&self) -> (Vec<u8>, std::time::SystemTime) {
        let index = self.folder.join(".git/index");
        let about = std::fs::metadata(&index).unwrap();
        (std::fs::read(&index).unwrap(), about.modified().unwrap())
    }
}

/// Runs git in `folder`, and says what it printed.
fn run_git(folder: &std::path::Path, args: &[&str]) -> String {
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
    String::from_utf8(out.stdout).unwrap().trim_end().to_owned()
}

/// How `git.act` ended.
fn ended(said: &[Progress]) -> &Progress {
    said.last().expect("git.act said something")
}

fn failed(said: &[Progress]) -> &str {
    match ended(said) {
        Progress::Failed { message } => message,
        other => panic!("it did not fail: {other:?}"),
    }
}

fn done(said: &[Progress]) -> &Done {
    match ended(said) {
        Progress::Done { done } => done,
        other => panic!("it did not end well: {other:?}"),
    }
}

fn file<'a>(files: &'a [Changed], path: &str) -> &'a Changed {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} in {files:?}"))
}

fn paths(diff: &Diff) -> Vec<&str> {
    let mut paths: Vec<&str> = diff.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    paths
}

#[tokio::test]
async fn a_clean_repository_has_its_branch_and_head_and_no_changes() {
    let world = World::committed().await;
    let status = world.status().await;
    assert!(status.repo);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.head, Some(world.git(&["rev-parse", "HEAD"])));
    assert_eq!(status.default_branch.as_deref(), Some("main"));
    assert_eq!(
        (status.upstream, status.ahead, status.behind),
        (None, None, None)
    );
    assert!(status.files.is_empty());
    assert_eq!((status.added, status.removed), (0, 0));
}

#[tokio::test]
async fn a_dirty_repository_says_each_change_with_its_lines() {
    let world = World::committed().await;
    world.write("a.txt", "one\n2\nthree\nfour\n");
    world.git(&["mv", "b.txt", "c.txt"]);
    std::fs::remove_file(world.folder.join("d.txt")).unwrap();
    world.write("new.txt", "fresh\n");
    world.write("staged.txt", "in\nthe\nindex\n");
    world.git(&["add", "staged.txt"]);

    let status = world.status().await;
    let a = file(&status.files, "a.txt");
    assert_eq!(
        (a.status, a.staged, a.added, a.removed),
        (Change::Modified, Some(false), 2, 1)
    );
    let c = file(&status.files, "c.txt");
    assert_eq!(
        (c.status, c.old_path.as_deref()),
        (Change::Renamed, Some("b.txt"))
    );
    assert_eq!((c.staged, c.added, c.removed), (Some(true), 0, 0));
    let d = file(&status.files, "d.txt");
    assert_eq!(
        (d.status, d.staged, d.removed),
        (Change::Deleted, Some(false), 1)
    );
    let new = file(&status.files, "new.txt");
    assert_eq!((new.status, new.added), (Change::Untracked, 0));
    let staged = file(&status.files, "staged.txt");
    assert_eq!(
        (staged.status, staged.staged, staged.added),
        (Change::Added, Some(true), 3)
    );
    assert_eq!(status.files.len(), 5);
    assert_eq!((status.added, status.removed), (5, 2));
}

#[tokio::test]
async fn a_branch_with_an_upstream_is_ahead_and_behind_it() {
    let world = World::committed().await;
    let first = world.git(&["rev-parse", "HEAD"]);
    world.write("a.txt", "theirs\n");
    world.commit("theirs");
    world.git(&["remote", "add", "origin", "../nowhere"]);
    world.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    world.git(&["reset", "--quiet", "--hard", &first]);
    world.git(&["config", "branch.main.remote", "origin"]);
    world.git(&["config", "branch.main.merge", "refs/heads/main"]);
    world.write("e.txt", "ours\n");
    world.commit("ours");
    world.write("f.txt", "ours too\n");
    world.commit("ours too");

    let status = world.status().await;
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (Some(2), Some(1)));
}

#[tokio::test]
async fn a_repository_with_no_commits_has_a_branch_but_no_head() {
    let world = World::new().await;
    world.write("first.txt", "hello\nworld\n");
    world.write("later.txt", "later\n");
    world.git(&["add", "first.txt"]);

    let status = world.status().await;
    assert!(status.repo);
    assert_eq!(
        (status.branch.as_deref(), status.head),
        (Some("main"), None)
    );
    assert_eq!(status.default_branch, None);
    let first = file(&status.files, "first.txt");
    assert_eq!((first.status, first.added), (Change::Added, 2));
    assert_eq!(file(&status.files, "later.txt").status, Change::Untracked);

    let uncommitted = world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    assert_eq!(paths(&uncommitted), ["first.txt", "later.txt"]);
    let staged = world.diff(json!({ "scope": { "kind": "staged" } })).await;
    assert_eq!(paths(&staged), ["first.txt"]);
    assert!(staged.patch.contains("+hello"), "{}", staged.patch);
    let changes = world.diff(json!({ "scope": { "kind": "changes" } })).await;
    assert_eq!(paths(&changes), ["first.txt", "later.txt"]);
    assert_eq!(changes.base, None);
    let commits: Vec<Commit> = world.ask("git.commits", json!({})).await;
    assert!(commits.is_empty());
    let refs: Vec<Ref> = world.ask("git.refs", json!({})).await;
    assert!(refs.is_empty());
}

#[tokio::test]
async fn changes_compare_a_feature_branch_and_its_work_with_where_it_left_main() {
    let world = World::committed().await;
    world.git(&["switch", "--quiet", "-c", "feature"]);
    world.write("feature.txt", "a feature\n");
    world.commit("a feature");
    world.git(&["switch", "--quiet", "main"]);
    world.write("main.txt", "main moves on\n");
    let left = world.git(&["merge-base", "main", "feature"]);
    world.commit("main moves on");
    world.git(&["switch", "--quiet", "feature"]);
    world.write("a.txt", "one\ntwo\nthree\nand more\n");
    world.write("untracked.txt", "not yet added\n");
    let before = world.git(&["status", "--porcelain"]);

    let changes = world.diff(json!({ "scope": { "kind": "changes" } })).await;
    let base = changes.base.as_ref().unwrap();
    assert_eq!(
        (base.name.as_str(), base.sha.as_str()),
        ("main", left.as_str())
    );
    assert_eq!(paths(&changes), ["a.txt", "feature.txt", "untracked.txt"]);
    assert!(!changes.truncated);
    assert!(
        changes
            .patch
            .contains("diff --git a/untracked.txt b/untracked.txt")
    );
    assert!(changes.patch.contains("+and more"));
    assert!(
        !changes.patch.contains("main.txt"),
        "main's own commit is not the branch's"
    );

    let uncommitted = world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    assert_eq!(paths(&uncommitted), ["a.txt", "untracked.txt"]);
    assert_eq!(uncommitted.base, None);

    let named = world
        .diff(json!({ "scope": { "kind": "changes", "base": "main" } }))
        .await;
    assert_eq!(paths(&named), paths(&changes));
    assert_eq!(
        world.git(&["status", "--porcelain"]),
        before,
        "the index is as it was"
    );

    let commits: Vec<Commit> = world.ask("git.commits", json!({})).await;
    let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["a feature"]);
    let commit = &commits[0];
    assert_eq!(commit.sha, world.git(&["rev-parse", "HEAD"]));
    assert!(commit.sha.starts_with(&commit.short));
    assert_eq!(commit.author, "Ann");
    assert!(commit.time > 1_700_000_000);

    let unknown = world
        .call(
            "git.diff",
            json!({ "scope": { "kind": "changes", "base": "nowhere" } }),
        )
        .await
        .unwrap_err();
    assert_eq!(unknown.code, Code::NotFound);
}

#[tokio::test]
async fn staged_is_the_index_against_head() {
    let world = World::committed().await;
    world.write("a.txt", "one\nTWO\nthree\n");
    world.git(&["add", "a.txt"]);
    world.write("b.txt", "unstaged\n");
    world.write("untracked.txt", "no\n");

    let staged = world.diff(json!({ "scope": { "kind": "staged" } })).await;
    assert_eq!(paths(&staged), ["a.txt"]);
    assert_eq!((staged.files[0].added, staged.files[0].removed), (1, 1));
    assert!(staged.patch.contains("+TWO"));
}

#[tokio::test]
async fn a_commit_is_compared_with_its_parent_and_the_first_with_nothing() {
    let world = World::committed().await;
    let root = world.git(&["rev-parse", "HEAD"]);
    world.write("a.txt", "one\ntwo\nthree\nfour\n");
    let second = world.commit("second");
    world.write("a.txt", "later work\n");

    let commit = world
        .diff(json!({ "scope": { "kind": "commit", "sha": second } }))
        .await;
    assert_eq!(paths(&commit), ["a.txt"]);
    assert_eq!((commit.files[0].added, commit.files[0].removed), (1, 0));
    assert!(commit.patch.contains("+four") && !commit.patch.contains("later work"));

    let first = world
        .diff(json!({ "scope": { "kind": "commit", "sha": root[..12] } }))
        .await;
    assert_eq!(paths(&first), ["a.txt", "b.txt", "d.txt"]);
    assert!(first.patch.contains("new file mode"));

    let missing = world
        .call(
            "git.diff",
            json!({ "scope": { "kind": "commit", "sha": "deadbeef" } }),
        )
        .await
        .unwrap_err();
    assert_eq!(missing.code, Code::NotFound);
    let option = world
        .call(
            "git.diff",
            json!({ "scope": { "kind": "commit", "sha": "--output=x" } }),
        )
        .await
        .unwrap_err();
    assert_eq!(option.code, Code::Invalid);
}

#[tokio::test]
async fn a_long_patch_is_cut_after_whole_files_and_its_list_stays_whole() {
    let world = World::committed().await;
    let line = "a line of some length, to fill the patch quickly\n";
    for n in 0..40 {
        world.write(&format!("big/{n:02}.txt"), &line.repeat(100));
    }
    let diff = world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    assert!(diff.truncated);
    assert_eq!(diff.files.len(), 40, "every file is listed");
    assert!(diff.files.iter().all(|f| f.added == 100));
    assert!(diff.patch.len() <= 120_000, "{}", diff.patch.len());
    let shown = diff.patch.matches("diff --git ").count();
    assert!((1..40).contains(&shown), "{shown}");
    assert!(
        diff.patch.ends_with(&format!("+{line}")),
        "it ends with a whole file"
    );

    let one = world
        .diff(json!({ "scope": { "kind": "uncommitted" }, "files": ["big/39.txt"] }))
        .await;
    assert_eq!(paths(&one), ["big/39.txt"]);
    assert!(!one.truncated);
    assert_eq!(one.patch.matches("diff --git ").count(), 1);
    assert_eq!(one.patch.matches(&format!("+{line}")).count(), 100);
}

#[tokio::test]
async fn files_asked_by_name_bring_their_rename_along() {
    let world = World::committed().await;
    world.git(&["mv", "b.txt", "moved.txt"]);
    world.write("a.txt", "changed\n");
    let ask = json!({ "scope": { "kind": "uncommitted" }, "files": ["b.txt"] });
    let moved = world.diff(ask).await;
    assert_eq!(paths(&moved), ["moved.txt"]);
    assert_eq!(moved.files[0].old_path.as_deref(), Some("b.txt"));
    assert!(moved.patch.contains("rename from b.txt"), "{}", moved.patch);
    assert!(!moved.patch.contains("a.txt"));
}

#[tokio::test]
async fn whitespace_alone_can_be_no_change() {
    let world = World::committed().await;
    world.write("a.txt", "one\n  two\nthree\n");
    let seen = world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    assert_eq!(seen.files[0].added, 1);
    let ignored = world
        .diff(json!({ "scope": { "kind": "uncommitted" }, "ignore_whitespace": true }))
        .await;
    assert!(ignored.files.iter().all(|f| (f.added, f.removed) == (0, 0)));
    assert!(!ignored.patch.contains("+  two"));
}

#[tokio::test]
async fn refs_list_the_branch_checked_out_then_the_default_then_the_newest() {
    let world = World::committed().await;
    let first = world.git(&["rev-parse", "HEAD"]);
    world.git(&["branch", "older"]);
    world.git(&["switch", "--quiet", "-c", "feature"]);
    world.git(&["remote", "add", "origin", "../nowhere"]);
    world.git(&["update-ref", "refs/remotes/origin/main", &first]);
    world.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    world.git(&["update-ref", "refs/remotes/origin/elsewhere", &first]);

    let refs: Vec<Ref> = world.ask("git.refs", json!({})).await;
    let named: Vec<(&str, bool, bool, bool)> = refs
        .iter()
        .map(|r| (r.name.as_str(), r.remote, r.current, r.default))
        .collect();
    assert_eq!(named[0], ("feature", false, true, false));
    assert!(named.contains(&("main", false, false, true)));
    assert!(named.contains(&("origin/main", true, false, true)));
    assert!(named.contains(&("origin/elsewhere", true, false, false)));
    assert!(named.contains(&("older", false, false, false)));
    assert!(!named.iter().any(|r| r.0 == "origin/HEAD"));
    assert_eq!(refs.len(), 5);
    assert!(named[1].3 && named[2].3, "the default's next: {named:?}");

    let found: Vec<Ref> = world.ask("git.refs", json!({ "query": "ELSE" })).await;
    let found: Vec<&str> = found.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(found, ["origin/elsewhere"]);

    let status = world.status().await;
    assert_eq!(status.default_branch.as_deref(), Some("main"));
}

#[tokio::test]
async fn contents_are_a_file_before_and_after() {
    let world = World::committed().await;
    world.write("a.txt", "one\nTWO\nthree\n");
    std::fs::remove_file(world.folder.join("d.txt")).unwrap();
    world.write("new.txt", "new\n");
    std::fs::write(world.folder.join("logo.bin"), [0u8, 1, 2, 3]).unwrap();
    let contents = |path: &str| {
        let ask = json!({ "scope": { "kind": "uncommitted" }, "path": path });
        world.ask::<Contents>("git.contents", ask)
    };

    let a = contents("a.txt").await;
    assert_eq!(a.old.as_deref(), Some("one\ntwo\nthree\n"));
    assert_eq!(a.new.as_deref(), Some("one\nTWO\nthree\n"));
    assert!(!a.too_large);
    let d = contents("d.txt").await;
    assert_eq!((d.old.as_deref(), d.new), (Some("doomed\n"), None));
    let new = contents("new.txt").await;
    assert_eq!((new.old, new.new.as_deref()), (None, Some("new\n")));
    let binary = contents("logo.bin").await;
    assert!(binary.too_large && binary.old.is_none() && binary.new.is_none());

    world.git(&["add", "a.txt"]);
    world.write("a.txt", "on disk only\n");
    let ask = json!({ "scope": { "kind": "staged" }, "path": "a.txt" });
    let staged: Contents = world.ask("git.contents", ask).await;
    assert_eq!(staged.new.as_deref(), Some("one\nTWO\nthree\n"));

    world.commit("more");
    world.git(&["mv", "b.txt", "bees.txt"]);
    let second = world.commit("bees");
    let ask = json!({
        "scope": { "kind": "commit", "sha": second },
        "path": "bees.txt",
        "old_path": "b.txt",
    });
    let moved: Contents = world.ask("git.contents", ask).await;
    assert_eq!(moved.old, moved.new);
    assert!(moved.old.is_some());

    let outside = json!({ "scope": { "kind": "uncommitted" }, "path": "../secret" });
    let refused = world.call("git.contents", outside).await.unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn a_folder_that_is_no_repository_says_so() {
    let world = World::bare().await;
    let status = world.status().await;
    assert!(!status.repo);
    assert!(status.files.is_empty() && status.branch.is_none());
    for (method, params) in [
        ("git.diff", json!({ "scope": { "kind": "uncommitted" } })),
        ("git.refs", json!({})),
        ("git.commits", json!({})),
        (
            "git.contents",
            json!({ "scope": { "kind": "staged" }, "path": "a" }),
        ),
    ] {
        let refused = world.call(method, params).await.unwrap_err();
        assert_eq!(refused.code, Code::Conflict, "{method}");
        assert_eq!(
            refused.message,
            "This Space's folder is not a git repository."
        );
    }
}

#[tokio::test]
async fn reading_never_takes_or_writes_the_index() {
    let world = World::committed().await;
    world.write("untracked.txt", "untracked\n");
    // A file touched but not changed: a git that may write the index
    // refreshes it and writes it.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let a = world.folder.join("a.txt");
    std::fs::write(&a, std::fs::read(&a).unwrap()).unwrap();
    let before = world.index();

    world.status().await;
    world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    world.diff(json!({ "scope": { "kind": "changes" } })).await;
    assert!(before == world.index(), "the index was written");
    assert!(!world.folder.join(".git/index.lock").exists());

    // Another git holds the lock: reading goes on.
    let lock = world.folder.join(".git/index.lock");
    std::fs::write(&lock, "").unwrap();
    let status = world.status().await;
    assert_eq!(
        file(&status.files, "untracked.txt").status,
        Change::Untracked
    );
    let diff = world
        .diff(json!({ "scope": { "kind": "uncommitted" } }))
        .await;
    assert_eq!(paths(&diff), ["untracked.txt"]);
    std::fs::remove_file(lock).unwrap();
}

#[tokio::test]
async fn a_turn_is_the_work_tree_from_its_checkpoint_as_it_began_to_as_it_ended() {
    let world = World::committed().await;
    let (thread, first, second) = (SpaceId::new(), SpaceId::new(), SpaceId::new());
    let (thread, first, second) = (thread.to_string(), first.to_string(), second.to_string());
    let turn = |turn: &str| json!({ "scope": { "kind": "turn", "thread": thread, "turn": turn } });
    // Before it began: no checkpoint, so no Turn from git.
    let refused = world.call("git.diff", turn(&first)).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);

    world.write("staged.txt", "staged\n");
    world.git(&["add", "staged.txt"]);
    let index = world.index();
    world.say("turn.started", &thread, &first).await;
    world.checkpoints(1).await;
    // The turn edits, makes and removes files, by its tools or its shell.
    world.write("a.txt", "one\n2\nthree\n");
    world.write("c.txt", "sea\n");
    std::fs::remove_file(world.folder.join("d.txt")).unwrap();
    // While it runs, it is the work tree now.
    assert_eq!(
        paths(&world.diff(turn(&first)).await),
        ["a.txt", "c.txt", "d.txt"]
    );
    world.say("turn.ended", &thread, &first).await;
    world.checkpoints(2).await;
    // What the Person changes after it is no part of it.
    world.write("b.txt", "bee\n");
    let diff = world.diff(turn(&first)).await;
    assert_eq!(paths(&diff), ["a.txt", "c.txt", "d.txt"]);
    let a = diff.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!((a.added, a.removed), (1, 1));
    let contents: Contents = world
        .ask(
            "git.contents",
            json!({ "scope": turn(&first)["scope"], "path": "a.txt" }),
        )
        .await;
    assert_eq!(contents.old.as_deref(), Some("one\ntwo\nthree\n"));
    assert_eq!(contents.new.as_deref(), Some("one\n2\nthree\n"));

    // The Person's index, branch and status stay as they were.
    assert!(index == world.index(), "the index was written");
    let status = world.status().await;
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(world.git(&["log", "--format=%s"]), "first");

    // Going back to the first turn lets go of its checkpoints and of every
    // later turn's.
    world.say("turn.started", &thread, &second).await;
    world.say("turn.ended", &thread, &second).await;
    world.checkpoints(4).await;
    world.say("thread.rewound", &thread, &first).await;
    world.checkpoints(0).await;
    let refused = world.call("git.diff", turn(&first)).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
}

/// What the Diff sends to change the `n`th hunk of `path` in `diff`: the
/// hunk's lines and the file's objects, read from the patch as the Pane
/// reads them.
fn hunk_of(diff: &Diff, path: &str, n: usize) -> Value {
    let start = diff
        .patch
        .find(&format!("diff --git a/{path} b/{path}\n"))
        .unwrap_or_else(|| panic!("{path} in {}", diff.patch));
    let file = &diff.patch[start..];
    let file = match file[1..].find("\ndiff --git ") {
        Some(end) => &file[..end + 1],
        None => file,
    };
    let ids = file
        .lines()
        .find_map(|line| line.strip_prefix("index "))
        .unwrap()
        .split(' ')
        .next()
        .unwrap();
    let (old_id, new_id) = ids.split_once("..").unwrap();
    let header = file
        .lines()
        .filter(|l| l.starts_with("@@ "))
        .nth(n)
        .unwrap();
    let ranges: Vec<u32> = header
        .trim_start_matches("@@ -")
        .split(" @@")
        .next()
        .unwrap()
        .split([' ', ',', '+'])
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap())
        .collect();
    let [old_start, old_lines, new_start, new_lines] = ranges[..] else {
        panic!("{header}")
    };
    json!({
        "files": [path],
        "hunk": {
            "old_start": old_start, "old_lines": old_lines,
            "new_start": new_start, "new_lines": new_lines,
            "old_id": old_id, "new_id": new_id,
        },
    })
}

/// A file of ten lines, to change at either end.
const TEN: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";

#[tokio::test]
async fn unstaged_is_the_work_tree_against_the_index() {
    let world = World::committed().await;
    world.write("a.txt", "one\nTWO\nthree\n");
    world.git(&["add", "a.txt"]);
    world.write("a.txt", "one\nTWO\nTHREE\n");
    world.write("b.txt", "unstaged\n");
    world.write("untracked.txt", "no\n");

    let unstaged = world.diff(json!({ "scope": { "kind": "unstaged" } })).await;
    assert_eq!(paths(&unstaged), ["a.txt", "b.txt", "untracked.txt"]);
    assert!(unstaged.patch.contains("+THREE") && !unstaged.patch.contains("+TWO"));
    let contents: Contents = world
        .ask(
            "git.contents",
            json!({ "scope": { "kind": "unstaged" }, "path": "a.txt" }),
        )
        .await;
    assert_eq!(contents.old.as_deref(), Some("one\nTWO\nthree\n"));
    assert_eq!(contents.new.as_deref(), Some("one\nTWO\nTHREE\n"));
}

#[tokio::test]
async fn files_stage_and_unstage_whole_untracked_and_removed_too() {
    let world = World::committed().await;
    world.write("a.txt", "one\nTWO\nthree\n");
    std::fs::remove_file(world.folder.join("d.txt")).unwrap();
    world.write("new.txt", "new\n");

    let files = json!({ "files": ["a.txt", "d.txt", "new.txt"] });
    world.call("git.stage", files.clone()).await.unwrap();
    assert_eq!(
        world.git(&["diff", "--cached", "--name-status"]),
        "M\ta.txt\nD\td.txt\nA\tnew.txt"
    );
    let unstaged = world.diff(json!({ "scope": { "kind": "unstaged" } })).await;
    assert!(unstaged.files.is_empty());

    world.call("git.unstage", files).await.unwrap();
    assert_eq!(world.git(&["diff", "--cached", "--name-status"]), "");
    assert_eq!(
        world.git(&["status", "--porcelain"]),
        " M a.txt\n D d.txt\n?? new.txt"
    );
}

#[tokio::test]
async fn files_unstage_before_the_first_commit() {
    let world = World::new().await;
    world.write("a.txt", "one\n");
    world.git(&["add", "a.txt"]);
    world
        .call("git.unstage", json!({ "files": ["a.txt"] }))
        .await
        .unwrap();
    assert_eq!(world.git(&["status", "--porcelain"]), "?? a.txt");
}

#[tokio::test]
async fn a_hunk_stages_alone_and_unstages_alone() {
    let world = World::new().await;
    world.write("ten.txt", TEN);
    world.commit("ten");
    world.write(
        "ten.txt",
        &TEN.replace("1\n", "one\n").replace("10\n", "ten\n"),
    );

    let unstaged = world.diff(json!({ "scope": { "kind": "unstaged" } })).await;
    world
        .call("git.stage", hunk_of(&unstaged, "ten.txt", 1))
        .await
        .unwrap();
    let staged = world.git(&["diff", "--cached"]);
    assert!(
        staged.contains("+ten") && !staged.contains("+one"),
        "{staged}"
    );
    let unstaged = world.git(&["diff"]);
    assert!(
        unstaged.contains("+one") && !unstaged.contains("+ten"),
        "{unstaged}"
    );

    world.write("ten.txt", TEN.replace("10\n", "ten\n").as_str());
    let staged = world.diff(json!({ "scope": { "kind": "staged" } })).await;
    world
        .call("git.unstage", hunk_of(&staged, "ten.txt", 0))
        .await
        .unwrap();
    assert_eq!(world.git(&["diff", "--cached"]), "");
}

#[tokio::test]
async fn a_hunk_drawn_with_whitespace_hidden_takes_its_whitespace_along() {
    let world = World::new().await;
    world.write("ten.txt", TEN);
    world.commit("ten");
    world.write(
        "ten.txt",
        &TEN.replace("2\n", "  2\n").replace("3\n", "three\n"),
    );

    let hidden = world
        .diff(json!({ "scope": { "kind": "unstaged" }, "ignore_whitespace": true }))
        .await;
    world
        .call("git.stage", hunk_of(&hidden, "ten.txt", 0))
        .await
        .unwrap();
    assert_eq!(world.git(&["diff"]), "");
}

#[tokio::test]
async fn revert_puts_a_hunk_or_a_file_back_and_an_untracked_file_goes() {
    let world = World::new().await;
    world.write("ten.txt", TEN);
    world.write("b.txt", "bee\n");
    world.commit("ten");
    world.write(
        "ten.txt",
        &TEN.replace("1\n", "one\n").replace("10\n", "ten\n"),
    );
    world.write("b.txt", "BEE\n");
    world.write("new.txt", "new\n");

    let unstaged = world.diff(json!({ "scope": { "kind": "unstaged" } })).await;
    world
        .call("git.revert", hunk_of(&unstaged, "ten.txt", 0))
        .await
        .unwrap();
    let left = std::fs::read_to_string(world.folder.join("ten.txt")).unwrap();
    assert_eq!(left, TEN.replace("10\n", "ten\n"));

    world
        .call("git.revert", json!({ "files": ["b.txt", "new.txt"] }))
        .await
        .unwrap();
    assert_eq!(world.git(&["status", "--porcelain"]), " M ten.txt");
}

#[tokio::test]
async fn a_hunk_of_a_file_changed_since_the_diff_changes_nothing() {
    let world = World::new().await;
    world.write("ten.txt", TEN);
    world.commit("ten");
    world.write("ten.txt", &TEN.replace("1\n", "one\n"));
    let unstaged = world.diff(json!({ "scope": { "kind": "unstaged" } })).await;
    world.write("ten.txt", &TEN.replace("1\n", "ONE\n"));

    let refused = world
        .call("git.stage", hunk_of(&unstaged, "ten.txt", 0))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
    assert_eq!(world.git(&["diff", "--cached"]), "");
}

#[tokio::test]
async fn the_button_commits_every_change_and_pushes_it() {
    let world = World::committed().await;
    let remote = world.remote();
    world.write("a.txt", "one\nTWO\nthree\n");
    world.write("new.txt", "new\n");
    let said = world
        .act(json!({ "action": "commit_push", "message": "Add new\n\nWith a body." }))
        .await;

    let steps: Vec<&Progress> = said
        .iter()
        .filter(|p| matches!(p, Progress::Step { .. }))
        .collect();
    assert_eq!(
        steps,
        [
            &Progress::Step {
                step: Step::Committing
            },
            &Progress::Step {
                step: Step::Pushing
            }
        ]
    );
    let short = world.git(&["rev-parse", "--short", "HEAD"]);
    assert_eq!(
        done(&said),
        &Done {
            title: format!("Pushed {short} to origin/main"),
            detail: Some("Add new".to_owned()),
        }
    );
    assert_eq!(
        world.git(&["log", "-1", "--format=%B"]),
        "Add new\n\nWith a body."
    );
    let pushed = run_git(&remote, &["rev-parse", "main"]);
    assert_eq!(pushed, world.git(&["rev-parse", "HEAD"]));
    let status = world.status().await;
    assert!(status.files.is_empty());
    assert_eq!(status.remote.as_deref(), Some("origin"));
    assert_eq!((status.ahead, status.behind), (Some(0), Some(0)));
}

#[tokio::test]
async fn a_new_branch_is_pushed_under_its_own_name_and_followed() {
    let world = World::committed().await;
    world.remote();
    world.write("a.txt", "changed\n");
    let said = world
        .act(json!({ "action": "commit_push", "message": "Change a", "branch": "feature/a" }))
        .await;

    assert_eq!(
        said[0],
        Progress::Step {
            step: Step::Branching
        }
    );
    assert!(done(&said).title.ends_with(" to origin/feature/a"));
    let status = world.status().await;
    assert_eq!(status.branch.as_deref(), Some("feature/a"));
    assert_eq!(status.upstream.as_deref(), Some("origin/feature/a"));
    assert_eq!(
        world.git(&["rev-parse", "main"]),
        world.git(&["rev-parse", "HEAD~1"])
    );
}

#[tokio::test]
async fn a_commit_of_chosen_files_takes_them_alone() {
    let world = World::committed().await;
    world.write("a.txt", "changed\n");
    world.write("b.txt", "changed\n");
    world.git(&["add", "b.txt"]);
    let said = world
        .act(json!({ "action": "commit", "message": "Change a", "files": ["a.txt"] }))
        .await;

    let short = world.git(&["rev-parse", "--short", "HEAD"]);
    assert_eq!(done(&said).title, format!("Committed {short}"));
    assert_eq!(
        world.git(&["show", "--name-only", "--format=", "HEAD"]),
        "a.txt"
    );
    assert_eq!(world.git(&["status", "--porcelain"]), " M b.txt");
}

#[tokio::test]
async fn a_commit_needs_a_message_changes_and_a_branch_to_push() {
    let world = World::committed().await;
    let refused = world
        .stream(
            "git.act",
            json!({ "action": "commit", "message": "Nothing" }),
            10,
        )
        .await;
    assert_eq!(
        refused[0]["message"],
        "Nothing to commit: the work tree is clean."
    );
    world.write("a.txt", "changed\n");
    let said = world
        .act(json!({ "action": "commit", "message": "  " }))
        .await;
    assert_eq!(failed(&said), "A commit needs a message.");
    let said = world
        .act(json!({ "action": "push", "message": "No" }))
        .await;
    assert_eq!(
        failed(&said),
        "Only a commit takes a message, files or a new branch."
    );

    world.git(&["checkout", "--quiet", "--detach"]);
    let said = world.act(json!({ "action": "push" })).await;
    assert_eq!(said.len(), 1);
    assert_eq!(failed(&said), "HEAD is detached: check out a branch first.");
}

#[cfg(unix)]
#[tokio::test]
async fn a_hook_says_its_name_and_lines_and_one_that_fails_stops_the_commit() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::committed().await;
    let hook = world.folder.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho checking things >&2\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let head = world.git(&["rev-parse", "HEAD"]);
    world.write("a.txt", "changed\n");
    let said = world
        .act(json!({ "action": "commit", "message": "Change a" }))
        .await;

    assert!(
        said.contains(&Progress::Hook {
            name: "pre-commit".to_owned()
        }),
        "{said:?}"
    );
    assert!(
        said.contains(&Progress::Line {
            line: "checking things".to_owned()
        }),
        "{said:?}"
    );
    assert_eq!(
        failed(&said),
        "The pre-commit hook stopped it: checking things"
    );
    assert_eq!(world.git(&["rev-parse", "HEAD"]), head);
}

#[tokio::test]
async fn a_branch_behind_pulls_and_one_that_diverged_cannot_push() {
    let world = World::committed().await;
    world.remote();
    world.theirs("main", "theirs.txt");
    world.git(&["fetch", "--quiet"]);
    assert_eq!(world.status().await.behind, Some(1));

    let said = world.act(json!({ "action": "pull" })).await;
    assert_eq!(done(&said).title, "Pulled");
    assert_eq!(
        world.git(&["rev-parse", "HEAD"]),
        world.git(&["rev-parse", "origin/main"])
    );
    let said = world.act(json!({ "action": "pull" })).await;
    assert_eq!(done(&said).title, "Already up to date");

    world.theirs("main", "more.txt");
    world.write("a.txt", "ours\n");
    let said = world
        .act(json!({ "action": "commit_push", "message": "Ours" }))
        .await;
    assert_eq!(
        failed(&said),
        "The remote has commits this branch lacks: pull them first."
    );
    world.git(&["fetch", "--quiet"]);
    let said = world.act(json!({ "action": "pull" })).await;
    assert_eq!(
        failed(&said),
        "This branch and its upstream both have commits the other lacks: rebase or merge first."
    );
}

#[tokio::test]
async fn branches_are_made_and_switched_to_a_remote_one_through_its_own() {
    let world = World::committed().await;
    world.remote();
    world.theirs("topic", "topic.txt");
    world.git(&["fetch", "--quiet"]);

    world
        .call("git.branch", json!({ "name": "feature" }))
        .await
        .unwrap();
    assert_eq!(world.status().await.branch.as_deref(), Some("feature"));
    let refused = world
        .call("git.branch", json!({ "name": "main" }))
        .await
        .unwrap_err();
    assert_eq!(refused.message, "A branch of that name is there already.");
    let refused = world
        .call("git.branch", json!({ "name": "a..b" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);

    world
        .call("git.switch", json!({ "name": "origin/topic" }))
        .await
        .unwrap();
    let status = world.status().await;
    assert_eq!(status.branch.as_deref(), Some("topic"));
    assert_eq!(status.upstream.as_deref(), Some("origin/topic"));
    world
        .call("git.switch", json!({ "name": "main" }))
        .await
        .unwrap();
    world
        .call("git.switch", json!({ "name": "origin/topic" }))
        .await
        .unwrap();
    assert_eq!(world.status().await.branch.as_deref(), Some("topic"));

    world.write("topic.txt", "mine\n");
    let refused = world
        .call("git.switch", json!({ "name": "main" }))
        .await
        .unwrap_err();
    assert_eq!(
        refused.message,
        "This would lose changes in some files: commit or stash them first."
    );
    let refused = world
        .call("git.switch", json!({ "name": "nope" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
}

#[tokio::test]
async fn a_folder_becomes_a_repository_once() {
    let world = World::bare().await;
    world.call("git.init", json!({})).await.unwrap();
    assert!(world.status().await.repo);
    let refused = world.call("git.init", json!({})).await.unwrap_err();
    assert_eq!(refused.code, Code::Conflict);
}

#[tokio::test]
async fn the_watch_says_the_status_and_then_what_changed() {
    let world = World::committed().await;
    let person = Participant::Person(world.owner);
    let mut heard = world
        .kernel
        .stream(person, "git.watch", Some(world.space), json!({}))
        .await
        .unwrap();
    let first: Status = serde_json::from_value(heard.recv().await.unwrap()).unwrap();
    assert!(first.files.is_empty());

    world.write("new.txt", "new\n");
    let within = std::time::Duration::from_secs(10);
    let next = tokio::time::timeout(within, heard.recv())
        .await
        .unwrap()
        .unwrap();
    let next: Status = serde_json::from_value(next).unwrap();
    assert_eq!(next.files.len(), 1);
}
