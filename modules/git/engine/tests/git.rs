//! The git module through the kernel, as a Pane uses it, on repositories
//! the `git` program makes: each test's own, configured in the repository
//! alone, never in the Person's global config.

use banda_git::Git;
use banda_git::model::{Change, Changed, Commit, Contents, Diff, Ref, Status};
use banda_kernel::{Code, CommandId, Kernel, Participant, PersonId, Refusal, SpaceId};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

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
        let out = Command::new("git")
            .args(args)
            .current_dir(&self.folder)
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
