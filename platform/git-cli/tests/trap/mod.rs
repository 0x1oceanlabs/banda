//! A repository whose every hook, and every program its config or its
//! submodule's can name for git, leaves a mark as it runs: what Banda's
//! own git is tried on, by this crate's tests and the engine's
//! (`engine/tests/bookkeeping.rs`).
#![allow(dead_code)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Every hook githooks(5) names.
pub const HOOKS: [&str; 28] = [
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

/// The repository, armed, with beside it: `up`, whose `main` its own
/// follows, with a commit it has not fetched; `alt`, whose objects it
/// borrows; `sub`, where its submodule `sub` came from; the programs and
/// the marks they leave; and `bin`, which holds the Person's own `ssh`.
///
/// Its `main` has a commit with a signature at its tip, and its work tree
/// changed files: `a.txt` and `e.md`, whose filters the config names,
/// `c.md`, whose time alone changed, `b.txt`, untracked, and `x.log`,
/// ignored. Its submodule moved to a commit of its own, and has a file
/// whose time alone changed, which a filter of the submodule's own config
/// cleans.
pub struct Trap {
    pub repo: PathBuf,
    /// The commit at `main`'s tip.
    pub head: String,
    beside: tempfile::TempDir,
}

impl Trap {
    /// The trap, its repository at `repo`: a folder that is empty or not
    /// there yet.
    pub fn new(repo: &Path) -> Trap {
        let mut trap = Trap {
            repo: repo.to_path_buf(),
            head: String::new(),
            beside: tempfile::tempdir().unwrap(),
        };
        trap.head = trap.repository();
        trap.arm();
        trap
    }

    /// The repository, before it is armed, and its tip.
    fn repository(&self) -> String {
        let (beside, repo) = (self.beside.path(), self.repo.as_path());
        std::fs::create_dir_all(self.marks()).unwrap();
        std::fs::create_dir_all(repo).unwrap();
        for name in ["up", "alt", "sub"] {
            git(
                beside,
                &["-c", "init.defaultBranch=main", "init", "--quiet", name],
            );
            commit_in(&beside.join(name), "first");
        }
        git(repo, &["-c", "init.defaultBranch=main", "init", "--quiet"]);
        for (key, value) in [
            ("user.name", "Ann"),
            ("user.email", "ann@example.com"),
            ("commit.gpgsign", "false"),
        ] {
            git(repo, &["config", key, value]);
        }
        git(repo, &["remote", "add", "origin", "git@github.com:o/r.git"]);
        let up = self.up();
        git(repo, &["remote", "add", "up", up.to_str().unwrap()]);
        git(repo, &["fetch", "--quiet", "up"]);
        git(
            repo,
            &["checkout", "--quiet", "-B", "main", "--track", "up/main"],
        );
        write(
            &repo.join(".gitattributes"),
            "*.txt filter=proc diff=conv\n*.md filter=pipe\n",
        );
        write(&repo.join(".gitignore"), "*.log\n");
        for path in ["a.txt", "c.md", "e.md"] {
            write(&repo.join(path), "one\n");
        }
        git(repo, &["add", "--all"]);
        git(repo, &["commit", "--quiet", "-m", "second"]);
        let sub = beside.join("sub");
        let add = ["-c", "protocol.file.allow=always", "submodule", "add"];
        git(
            repo,
            &[&add[..], &["--quiet", sub.to_str().unwrap(), "sub"]].concat(),
        );
        git(repo, &["commit", "--quiet", "-m", "sub"]);
        commit_in(&repo.join("sub"), "moved");
        // A commit with a signature, which a log checks when asked to.
        write(&repo.join("signed.txt"), "signed\n");
        git(repo, &["add", "signed.txt"]);
        let tree = git(repo, &["write-tree"]);
        let parent = git(repo, &["rev-parse", "HEAD"]);
        let signed = format!(
            "tree {tree}\nparent {parent}\nauthor Ann <ann@example.com> 1 +0000\n\
             committer Ann <ann@example.com> 1 +0000\n\
             gpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nsigned\n"
        );
        let signed = git_in(
            repo,
            &["hash-object", "-t", "commit", "-w", "--stdin"],
            &signed,
        );
        git(repo, &["update-ref", "refs/heads/main", &signed]);
        commit_in(&up, "third");
        let alternates = repo.join(".git/objects/info/alternates");
        let alt = beside.join("alt/.git/objects");
        write(&alternates, &format!("{}\n", alt.display()));
        signed
    }

    /// Every hook, and every program the config names, leaves its mark;
    /// the submodule's too; then the work trees change.
    fn arm(&self) {
        let repo = &self.repo;
        for hook in HOOKS {
            let program = self.program(&format!("hook-{hook}"), "exit 0");
            std::fs::copy(program, repo.join(".git/hooks").join(hook)).unwrap();
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
            ("core.sshCommand", self.program("ssh-command", "exit 1")),
            ("credential.helper", self.program("credential", "exit 0")),
            ("core.pager", self.program("pager", "cat")),
        ];
        for (key, program) in config {
            git(repo, &["config", key, program.to_str().unwrap()]);
        }
        for event in ["reference-transaction", "post-index-change", "pre-auto-gc"] {
            git(repo, &["config", "--add", "hook.trap.event", event]);
        }
        for (key, value) in [
            ("log.showSignature", "true"),
            ("commit.gpgSign", "true"),
            ("protocol.ext.allow", "always"),
            ("diff.submodule", "diff"),
            ("submodule.sub.ignore", "none"),
            ("fetch.recurseSubmodules", "true"),
        ] {
            git(repo, &["config", key, value]);
        }
        git(repo, &["remote", "add", "far", "ssh://example.invalid/far"]);
        let ext = format!("ext::{}", self.program("ext", "exit 1").display());
        git(repo, &["remote", "add", "ext", &ext]);
        let ssh = format!(
            "#!/bin/sh\ntouch '{}'\nexit 1\n",
            self.beside.path().join("person-ssh").display()
        );
        executable(&self.bin().join("ssh"), &ssh);

        // The submodule's own config, which its parent's names nothing of.
        let sub = repo.join("sub");
        let modules = repo.join(".git/modules/sub");
        for hook in HOOKS {
            let program = self.program(&format!("sub-hook-{hook}"), "exit 0");
            std::fs::copy(program, modules.join("hooks").join(hook)).unwrap();
        }
        let config = [
            ("core.fsmonitor", self.program("sub-fsmonitor", "exit 1")),
            ("filter.subf.clean", self.program("sub-filter", "cat")),
            (
                "diff.subc.textconv",
                self.program("sub-textconv", "cat \"$1\""),
            ),
            ("diff.external", self.program("sub-external", "exit 0")),
            (
                "remote.origin.uploadpack",
                self.program("sub-upload-pack", "exec git-upload-pack \"$@\""),
            ),
        ];
        for (key, program) in config {
            git(&sub, &["config", key, program.to_str().unwrap()]);
        }
        write(&sub.join(".gitattributes"), "* filter=subf diff=subc\n");
        long_ago(&sub.join("first.txt"));

        // Files changed, one whose time alone changed, one untracked and
        // one ignored.
        write(&repo.join("a.txt"), "one\ntwo\n");
        write(&repo.join("e.md"), "one\ntwo\n");
        long_ago(&repo.join("c.md"));
        write(&repo.join("b.txt"), "new\n");
        write(&repo.join("x.log"), "log\n");
    }

    /// Where `main` comes from.
    pub fn up(&self) -> PathBuf {
        self.beside.path().join("up")
    }

    /// The folder that holds the Person's own `ssh`, which leaves
    /// [`Trap::persons_ssh_ran`].
    pub fn bin(&self) -> PathBuf {
        self.beside.path().join("bin")
    }

    /// Whether the Person's own `ssh` ran.
    pub fn persons_ssh_ran(&self) -> bool {
        self.beside.path().join("person-ssh").exists()
    }

    pub fn marks(&self) -> PathBuf {
        self.beside.path().join("marks")
    }

    /// A program that leaves the mark `name`, then runs `then`.
    pub fn program(&self, name: &str, then: &str) -> PathBuf {
        let path = self.beside.path().join("programs").join(name);
        let mark = self.marks().join(name);
        executable(
            &path,
            &format!("#!/bin/sh\ntouch '{}'\n{then}\n", mark.display()),
        );
        path
    }

    /// The marks left, by name.
    pub fn left(&self) -> Vec<String> {
        let mut left: Vec<String> = std::fs::read_dir(self.marks())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        left
    }

    /// Asserts each of `marks` was left.
    pub fn left_each(&self, marks: &[&str]) {
        let left = self.left();
        for mark in marks {
            assert!(left.iter().any(|left| left == mark), "{mark}: {left:?}");
        }
    }
}

/// Runs the Person's own git in `folder`, and says what it printed.
pub fn git(folder: &Path, args: &[&str]) -> String {
    git_in(folder, args, "")
}

/// Runs the Person's own git in `folder`, `stdin` fed, and says what it
/// printed.
pub fn git_in(folder: &Path, args: &[&str], stdin: &str) -> String {
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
    let mut input = child.stdin.take().unwrap();
    input.write_all(stdin.as_bytes()).unwrap();
    drop(input);
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

/// A commit of a new file in the repository at `folder`.
pub fn commit_in(folder: &Path, message: &str) {
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

pub fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// Writes `text` to `file`, a program anyone may run.
pub fn executable(file: &Path, text: &str) {
    write(file, text);
    std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// Moves `file`'s time back, its bytes as they are.
fn long_ago(file: &Path) {
    let file = std::fs::File::options().write(true).open(file).unwrap();
    let then = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
    file.set_modified(then).unwrap();
}
