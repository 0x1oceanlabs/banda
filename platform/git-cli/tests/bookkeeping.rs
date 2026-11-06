//! Banda's own git on a repository whose hooks and config each name a
//! program that leaves a mark: none of them runs as Banda reads, diffs,
//! keeps a checkpoint, logs, checks what is ignored and fetches, while
//! git asked for by the Person runs them.
#![cfg(unix)]

use banda_git_cli::{FETCH, asked, bookkeeping};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use tokio::io::AsyncWriteExt;

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

/// A repository, `repo`, cloned from `up` and borrowing the objects of
/// `alt`, whose every hook and every program its config can name leaves
/// a mark in `marks`; and an `ssh` of the Person's own in `bin`, which
/// leaves `person-ssh` beside them.
struct Trap {
    root: tempfile::TempDir,
}

impl Trap {
    fn new() -> Trap {
        let trap = Trap {
            root: tempfile::tempdir().unwrap(),
        };
        let root = trap.root.path();
        std::fs::create_dir_all(trap.marks()).unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        for name in ["up", "alt"] {
            plain(
                root,
                &["-c", "init.defaultBranch=main", "init", "--quiet", name],
            );
            commit_in(&root.join(name), "first");
        }
        plain(root, &["clone", "--quiet", "up", "repo"]);
        let repo = trap.repo();
        for (key, value) in [
            ("user.name", "Ann"),
            ("user.email", "ann@example.com"),
            ("commit.gpgsign", "false"),
        ] {
            plain(&repo, &["config", key, value]);
        }
        write(
            &repo.join(".gitattributes"),
            "*.txt filter=proc diff=conv\n*.md filter=pipe\n",
        );
        write(&repo.join("a.txt"), "one\n");
        write(&repo.join("c.md"), "one\n");
        write(&repo.join("e.md"), "one\n");
        plain(&repo, &["add", "--all"]);
        plain(&repo, &["commit", "--quiet", "-m", "second"]);
        // A commit with a signature, which a log checks when asked to.
        let (tree, parent) = (
            plain(&repo, &["rev-parse", "HEAD^{tree}"]),
            plain(&repo, &["rev-parse", "HEAD"]),
        );
        let signed = format!(
            "tree {tree}\nparent {parent}\nauthor Ann <ann@example.com> 1 +0000\n\
             committer Ann <ann@example.com> 1 +0000\n\
             gpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nsigned\n"
        );
        let signed = plain_in(
            &repo,
            &["hash-object", "-t", "commit", "-w", "--stdin"],
            &signed,
        );
        plain(&repo, &["update-ref", "refs/heads/main", &signed]);
        // Something new to fetch, with an alternate's refs to negotiate.
        commit_in(&root.join("up"), "third");
        let alternates = repo.join(".git/objects/info/alternates");
        write(
            &alternates,
            &format!("{}\n", root.join("alt/.git/objects").display()),
        );

        for hook in HOOKS {
            let program = trap.program(&format!("hook-{hook}"), "exit 0");
            std::fs::copy(program, repo.join(".git/hooks").join(hook)).unwrap();
        }
        let config = [
            ("hook.trap.command", trap.program("config-hook", "exit 0")),
            ("core.fsmonitor", trap.program("fsmonitor", "exit 1")),
            (
                "filter.proc.process",
                trap.program("filter-process", "exit 1"),
            ),
            ("filter.pipe.clean", trap.program("filter-clean", "cat")),
            ("filter.pipe.smudge", trap.program("filter-smudge", "cat")),
            ("diff.conv.textconv", trap.program("textconv", "cat \"$1\"")),
            ("diff.conv.command", trap.program("diff-command", "exit 0")),
            ("diff.external", trap.program("external-diff", "exit 0")),
            ("gpg.program", trap.program("gpg", "exit 1")),
            (
                "core.alternateRefsCommand",
                trap.program("alternate-refs", "exit 0"),
            ),
            (
                "remote.origin.uploadpack",
                trap.program("upload-pack", "exec git-upload-pack \"$@\""),
            ),
            ("core.sshCommand", trap.program("ssh-command", "exit 1")),
            ("credential.helper", trap.program("credential", "exit 0")),
            ("core.pager", trap.program("pager", "cat")),
        ];
        for (key, program) in config {
            plain(&repo, &["config", key, program.to_str().unwrap()]);
        }
        for event in ["reference-transaction", "post-index-change", "pre-auto-gc"] {
            plain(&repo, &["config", "--add", "hook.trap.event", event]);
        }
        plain(&repo, &["config", "log.showSignature", "true"]);
        plain(&repo, &["config", "protocol.ext.allow", "always"]);
        plain(
            &repo,
            &["remote", "add", "far", "ssh://example.invalid/far"],
        );
        let ext = format!("ext::{}", trap.program("ext", "exit 1").display());
        plain(&repo, &["remote", "add", "ext", &ext]);
        // The Person's own ssh.
        let ssh = root.join("bin/ssh");
        write(
            &ssh,
            &format!(
                "#!/bin/sh\ntouch '{}'\nexit 1\n",
                root.join("person-ssh").display()
            ),
        );
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();

        // Files changed, one whose time alone changed, and one untracked.
        write(&repo.join("a.txt"), "one\ntwo\n");
        write(&repo.join("e.md"), "one\ntwo\n");
        let file = std::fs::File::options()
            .write(true)
            .open(repo.join("c.md"))
            .unwrap();
        file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000))
            .unwrap();
        write(&repo.join("b.txt"), "new\n");
        trap
    }

    fn repo(&self) -> PathBuf {
        self.root.path().join("repo")
    }

    fn marks(&self) -> PathBuf {
        self.root.path().join("marks")
    }

    /// A program that leaves the mark `name`, then runs `then`.
    fn program(&self, name: &str, then: &str) -> PathBuf {
        let path = self.root.path().join("programs").join(name);
        let mark = self.marks().join(name);
        write(
            &path,
            &format!("#!/bin/sh\ntouch '{}'\n{then}\n", mark.display()),
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
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

    /// Runs `args` as Banda's own git, `stdin` fed, with `index` as its
    /// index and the Person's own ssh.
    async fn own(&self, args: &[&str], stdin: &str, index: Option<&Path>) -> Output {
        let mut git = bookkeeping(&self.repo()).await.unwrap();
        self.run(&mut git, args, stdin, index).await
    }

    /// Runs `args` as git asked for by the Person.
    async fn asked(&self, args: &[&str], stdin: &str, index: Option<&Path>) -> Output {
        self.run(&mut asked(&self.repo()), args, stdin, index).await
    }

    async fn run(
        &self,
        git: &mut tokio::process::Command,
        args: &[&str],
        stdin: &str,
        index: Option<&Path>,
    ) -> Output {
        let path = format!(
            "{}:{}",
            self.root.path().join("bin").display(),
            std::env::var("PATH").unwrap_or_default()
        );
        git.args(args)
            .env("PATH", path)
            .env_remove("GIT_SSH_COMMAND")
            .env_remove("GIT_SSH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(index) = index {
            git.env("GIT_INDEX_FILE", index);
        }
        let mut child = git.spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        input.write_all(stdin.as_bytes()).await.unwrap();
        drop(input);
        let out = child.wait_with_output().await.unwrap();
        // A git that fails says why, for a test that does not expect it.
        if !out.status.success() {
            eprintln!("git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        }
        out
    }

    /// A copy of the repository's index, which a git given it writes in
    /// place of the Person's, as a checkpoint's.
    fn own_index(&self) -> PathBuf {
        let index = self.root.path().join("index");
        std::fs::copy(self.repo().join(".git/index"), &index).unwrap();
        index
    }
}

#[tokio::test]
async fn bandas_own_git_runs_no_program_the_repository_names() {
    let trap = Trap::new();
    let read = |args: &'static [&'static str]| {
        let trap = &trap;
        async move {
            let out = trap.own(args, "", None).await;
            assert!(out.status.success(), "git {args:?}");
            out
        }
    };
    read(&["rev-parse", "--show-object-format", "--show-toplevel"]).await;
    let status = read(&[
        "status",
        "--porcelain=2",
        "--branch",
        "--untracked-files=all",
        "-z",
    ]);
    let status = String::from_utf8(status.await.stdout).unwrap();
    assert!(
        status.contains("a.txt") && status.contains("b.txt"),
        "{status}"
    );
    read(&["diff-index", "-M", "--numstat", "-z", "HEAD", "--"]).await;
    let diff = [
        "diff",
        "--find-renames",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
    ];
    for form in ["--numstat", "--patch"] {
        let out = trap
            .own(&[&diff[..], &[form, "HEAD", "--"]].concat(), "", None)
            .await;
        assert!(out.status.success(), "{form}");
    }
    let patch = trap
        .own(&[&diff[..], &["--patch", "HEAD", "--"]].concat(), "", None)
        .await;
    assert!(String::from_utf8_lossy(&patch.stdout).contains("+two"));
    // Without git's own patch asked for, a driver blanked fails it.
    let driven = trap.own(&["diff", "--patch", "HEAD", "--"], "", None).await;
    assert!(!driven.status.success());
    read(&["ls-files", "--others", "--exclude-standard", "-z", "--"]).await;
    read(&["hash-object", "--", "c.md"]).await;
    trap.own(&["hash-object", "--stdin-paths"], "a.txt\n", None)
        .await;
    read(&["cat-file", "blob", "HEAD:a.txt"]).await;
    read(&["log", "-1", "-z", "--format=%H%x00%s"]).await;
    read(&["log", "-n", "20", "--no-merges", "--format=%s"]).await;
    let ignored = trap
        .own(&["check-ignore", "-z", "--stdin"], "a.txt\0b.txt\0", None)
        .await;
    assert_eq!(ignored.status.code(), Some(1), "none is ignored");
    read(&["remote", "get-url", "origin"]).await;

    // A checkpoint, through an index of its own, under Banda's refs.
    let index = trap.own_index();
    let index = Some(index.as_path());
    let split = ["-c", "core.splitIndex=false"];
    let indexed = [&split[..], &["update-index", "--no-split-index"]].concat();
    assert!(trap.own(&indexed, "", index).await.status.success());
    let added = trap
        .own(&["add", "--intent-to-add", "--", "b.txt"], "", index)
        .await;
    assert!(added.status.success());
    let added = trap
        .own(
            &[&split[..], &["add", "--all", "--", "."]].concat(),
            "",
            index,
        )
        .await;
    assert!(added.status.success());
    let tree = trap.own(&["write-tree"], "", index).await;
    let tree = String::from_utf8(tree.stdout).unwrap();
    let commit = [
        "commit-tree",
        tree.trim(),
        "-p",
        "HEAD",
        "-m",
        "Banda checkpoint",
    ];
    let commit = String::from_utf8(trap.own(&commit, "", None).await.stdout).unwrap();
    let kept = "refs/banda/checkpoints/t/u/before";
    let updated = trap
        .own(&["update-ref", kept, commit.trim()], "", None)
        .await;
    assert!(updated.status.success());
    let delete = format!("delete {kept}\n");
    let deleted = trap.own(&["update-ref", "--stdin"], &delete, None).await;
    assert!(deleted.status.success());

    // The fetch a watch runs, and over ssh and `ext::`.
    let fetch = |remote: &'static str| {
        let mut args = vec!["fetch"];
        args.extend(FETCH);
        args.extend([
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--",
            remote,
        ]);
        args
    };
    let fetched = trap.own(&fetch("origin"), "", None).await;
    assert!(fetched.status.success());
    trap.own(&fetch("far"), "", None).await;
    // The Person's own: `ssh` on the PATH, unless their config names
    // another.
    let theirs = Command::new("git")
        .args(["config", "--global", "--get", "core.sshCommand"])
        .output()
        .unwrap();
    if !theirs.status.success() {
        let ran = trap.root.path().join("person-ssh").exists();
        assert!(ran, "the Person's ssh ran");
    }
    let ext = trap.own(&fetch("ext"), "", None).await;
    assert!(!ext.status.success());

    assert_eq!(trap.left(), Vec::<String>::new());
}

#[tokio::test]
async fn git_asked_for_runs_them_as_the_persons_own_does() {
    let trap = Trap::new();
    trap.asked(&["status", "--porcelain=2"], "", None).await;
    trap.asked(
        &["diff", "--no-ext-diff", "--patch", "HEAD", "--"],
        "",
        None,
    )
    .await;
    trap.asked(&["diff", "--patch", "HEAD", "--"], "", None)
        .await;
    trap.asked(&["log", "-1", "--format=%H"], "", None).await;
    let index = trap.own_index();
    trap.asked(&["add", "--all", "--", "."], "", Some(&index))
        .await;
    let head = plain(&trap.repo(), &["rev-parse", "HEAD"]);
    trap.asked(&["update-ref", "refs/banda/x", &head], "", None)
        .await;
    for remote in ["origin", "far", "ext"] {
        trap.asked(&["fetch", "--quiet", remote], "", None).await;
    }
    let mut armed = vec![
        "alternate-refs",
        "diff-command",
        "ext",
        "external-diff",
        "filter-clean",
        "filter-process",
        "fsmonitor",
        "gpg",
        "hook-post-index-change",
        "hook-reference-transaction",
        "ssh-command",
        "textconv",
        "upload-pack",
    ];
    // A git that knows hooks set in its config lists the trap's.
    let listed = Command::new("git")
        .args(["hook", "list", "reference-transaction"])
        .current_dir(trap.repo())
        .output()
        .unwrap();
    if String::from_utf8_lossy(&listed.stdout).contains("trap") {
        armed.push("config-hook");
    }
    let left = trap.left();
    for mark in armed {
        assert!(left.iter().any(|left| left == mark), "{mark}: {left:?}");
    }
}

/// Runs plain git in `folder`, as the Person's own, and says what it
/// printed.
fn plain(folder: &Path, args: &[&str]) -> String {
    plain_in(folder, args, "")
}

fn plain_in(folder: &Path, args: &[&str], stdin: &str) -> String {
    use std::io::Write;
    let mut child = Command::new("git")
        .args(args)
        .current_dir(folder)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
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
    plain(folder, &["add", "--all"]);
    let ann = ["-c", "user.name=Ann", "-c", "user.email=ann@example.com"];
    let commit = [
        &ann[..],
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            message,
        ],
    ];
    plain(folder, &commit.concat());
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}
