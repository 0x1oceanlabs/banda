//! Banda's own git on the trap's repository, for what no module's call
//! reaches: a fetch from each kind of remote the repository can name, and
//! an object a partial clone lacks. None runs a program the repository
//! names, while the Person's own git does. The engine's tests run every
//! module's own calls on the trap (`engine/tests/bookkeeping.rs`).
#![cfg(unix)]

mod trap;

use banda_git_cli::{asked, bookkeeping};
use std::process::{Output, Stdio};
use tokio::process::Command;
use trap::{Trap, commit_in, executable, git};

/// Runs `git` with the Person's own `ssh` first on the PATH.
async fn run(trap: &Trap, mut git: Command) -> Output {
    let path = std::env::var("PATH").unwrap_or_default();
    let path = format!("{}:{path}", trap.bin().display());
    git.env("PATH", path)
        .env_remove("GIT_SSH_COMMAND")
        .stdin(Stdio::null())
        .output()
        .await
        .unwrap()
}

/// Runs `args` as Banda's own git does.
async fn own(trap: &Trap, args: &[&str]) -> Output {
    run(trap, bookkeeping(&trap.repo, args).await.unwrap()).await
}

/// Runs `args` as the Person's own git does.
async fn theirs(trap: &Trap, args: &[&str]) -> Output {
    run(trap, asked(&trap.repo, args)).await
}

#[tokio::test]
async fn a_fetch_reaches_its_remote_with_no_program_the_repository_names() {
    let folder = tempfile::tempdir().unwrap();
    let trap = Trap::new(folder.path());
    // A remote that a helper of the repository's own speaks for.
    let helper = trap.repo.join("git-remote-../helper");
    executable(
        &helper,
        &format!(
            "#!/bin/sh\nexec '{}'\n",
            trap.program("helper", "exit 1").display()
        ),
    );
    git(&trap.repo, &["remote", "add", "helper", "x"]);
    git(&trap.repo, &["config", "remote.helper.vcs", "../helper"]);
    let fetch = |remote| ["fetch", "--quiet", "--no-tags", "--", remote];

    let fetched = own(&trap, &fetch("up")).await;
    assert!(fetched.status.success(), "{fetched:?}");
    for remote in ["far", "ext", "helper"] {
        assert!(
            !own(&trap, &fetch(remote)).await.status.success(),
            "{remote}"
        );
    }
    assert_eq!(trap.left(), Vec::<String>::new());
    // Over ssh, the Person's own: `ssh` on the PATH, unless their config
    // or their environment names another.
    let theirs_named = std::process::Command::new("git")
        .args(["config", "--global", "--get", "core.sshCommand"])
        .output()
        .unwrap();
    if !theirs_named.status.success() && std::env::var_os("GIT_SSH").is_none() {
        assert!(trap.persons_ssh_ran(), "the Person's ssh ran");
    }

    // `up` moves on, so the Person's fetch moves a ref, and its hook runs.
    commit_in(&trap.up(), "fourth");
    for remote in ["up", "far", "ext", "helper"] {
        theirs(&trap, &fetch(remote)).await;
    }
    trap.left_each(&[
        "upload-pack",
        "hook-reference-transaction",
        "ssh-command",
        "ext",
        "helper",
    ]);
}

#[tokio::test]
async fn a_read_fetches_no_object_it_lacks() {
    let folder = tempfile::tempdir().unwrap();
    let trap = Trap::new(folder.path());
    // A partial clone of `up`, as far as git can tell.
    git(&trap.repo, &["config", "core.repositoryFormatVersion", "1"]);
    git(&trap.repo, &["config", "extensions.partialClone", "up"]);
    let lacked = ["cat-file", "-e", "0123456789abcdef0123456789abcdef01234567"];

    assert!(!own(&trap, &lacked).await.status.success());
    assert_eq!(trap.left(), Vec::<String>::new());

    theirs(&trap, &lacked).await;
    trap.left_each(&["upload-pack"]);
}
