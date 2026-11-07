//! Every program Banda runs for a Project starts in its environment (ADR
//! 0084, decision 4): no code of the engine but this crate makes a
//! process. What keeps Banda's books, or asks the host about itself, runs
//! on the host and executes nothing of a Project's; each such place is
//! named here, with why. A new one is either that, and named here, or it
//! goes through the Project's environment.

use std::path::{Path, PathBuf};

/// What makes a process, as Rust's source says it: std's, tokio's,
/// `pty-process`'s and `async-process`'s commands, and ACP's agent that
/// starts its own.
const MAKES: [&str; 4] = [
    "Command::new(",
    "Command::from(",
    "AcpAgent",
    "spawn_process(",
];

/// Where the engine makes a process on the host for no Project's program,
/// with why.
const ON_THE_HOST: [(&str, &str); 10] = [
    (
        "platform/git-cli/src/lib.rs",
        "Banda's own git bookkeeping, which runs no program a repository names (ADR 0083, \
         decision 5); an act the Person asks for is a Program for the Project's environment",
    ),
    (
        "kernel/src/foreign.rs",
        "asks `gh` which account it is signed in to, offline, to tell whether a folder looks \
         foreign (ADR 0084, decision 13)",
    ),
    (
        "apps/pulls/engine/src/github.rs",
        "reads pull requests from GitHub with the Person's `gh`, whose sign-in stays on the host \
         (ADR 0084, decision 8)",
    ),
    (
        "apps/terminal/engine/src/servers.rs",
        "lists the host's processes and what listens, on macOS, to find the servers started in \
         Banda (ADR 0044)",
    ),
    (
        "platform/harnesses/engine/src/carried.rs",
        "asks a Node on the host its version, for the adapters Banda carries, which run on the \
         host (ADR 0084, decision 5)",
    ),
    (
        "platform/harnesses/engine/src/limits/claude.rs",
        "reads Claude Code's sign-in from the macOS Keychain, for an account's limits (ADR 0043)",
    ),
    (
        "platform/harnesses/engine/src/limits/codex.rs",
        "asks Codex's app server an account's limits, for no Project (ADR 0043)",
    ),
    (
        "platform/problems/engine/src/issue.rs",
        "files a Problem in Banda's own repository with the Person's `gh`",
    ),
    (
        "platform/look/src/fonts.rs",
        "asks fontconfig which font a family is",
    ),
    (
        "platform/look/src/wallpaper.rs",
        "asks the desktop which wallpaper it shows",
    ),
];

/// This crate, the one place a Project's program starts.
const ENVIRONMENTS: &str = "platform/environments/src";

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The engine's Rust, by its path in the repository: every crate's
/// sources, but its tests and build scripts.
fn sources() -> Vec<String> {
    let root = repository();
    let mut folders: Vec<PathBuf> = ["kernel", "engine", "apps", "platform"]
        .iter()
        .map(|folder| root.join(folder))
        .collect();
    let mut found = Vec::new();
    while let Some(folder) = folders.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.is_dir() {
                if !["tests", "node_modules", "target"].contains(&name.as_str()) {
                    folders.push(path);
                }
            } else if name.ends_with(".rs") && name != "build.rs" {
                let shown = path.strip_prefix(&root).unwrap();
                found.push(shown.to_string_lossy().into_owned());
            }
        }
    }
    found.sort();
    found
}

/// `code` up to its tests, `#[cfg(test)] mod …`, which make what they
/// test with.
fn without_tests(code: &str) -> &str {
    let mut at = 0;
    for line in code.split_inclusive('\n') {
        let rest = &code[at + line.len()..];
        if line.trim() == "#[cfg(test)]" && rest.trim_start().starts_with("mod ") {
            return &code[..at];
        }
        at += line.len();
    }
    code
}

/// Whether `code` makes a process: one of [`MAKES`], not as the end of a
/// longer name (`AvailableCommand::new(` is no command).
fn makes(code: &str) -> Option<&'static str> {
    MAKES.into_iter().find(|making| {
        code.match_indices(making).any(|(at, _)| {
            let before = code[..at].chars().next_back();
            !before.is_some_and(|c| c.is_alphanumeric() || c == '_')
        })
    })
}

#[test]
fn only_an_environment_starts_a_projects_program() {
    let root = repository();
    let files = sources();
    assert!(files.iter().any(|file| file.starts_with(ENVIRONMENTS)));
    for file in &files {
        let code = std::fs::read_to_string(root.join(file)).unwrap();
        let Some(making) = makes(without_tests(&code)) else {
            continue;
        };
        let known = file.starts_with(ENVIRONMENTS)
            || ON_THE_HOST
                .iter()
                .any(|(on_the_host, _)| on_the_host == file);
        assert!(
            known,
            "{file} makes a process ({making}): a program for a Project starts through its \
             environment (ModuleProject::environment, ADR 0084); one on the host for Banda's own \
             books is named in ON_THE_HOST, with why"
        );
    }
}

/// A place named that no longer makes one is no longer named.
#[test]
fn each_place_on_the_host_still_makes_one() {
    let root = repository();
    for (file, why) in ON_THE_HOST {
        let code = std::fs::read_to_string(root.join(file))
            .unwrap_or_else(|_| panic!("{file} is gone: take it from ON_THE_HOST"));
        assert!(
            makes(without_tests(&code)).is_some(),
            "{file} makes no process now ({why}): take it from ON_THE_HOST"
        );
    }
}

/// No crate takes ACP's agent that starts its own process: a Harness's
/// program starts in its Project's environment, and ACP speaks on its
/// pipes.
#[test]
fn no_crate_starts_a_harness_as_acp_would() {
    let root = repository();
    let mut manifests = vec![root.join("Cargo.toml")];
    for file in sources() {
        let mut folder = root.join(&file);
        while folder.pop() && folder != root {
            let manifest = folder.join("Cargo.toml");
            if manifest.exists() {
                if !manifests.contains(&manifest) {
                    manifests.push(manifest);
                }
                break;
            }
        }
    }
    for manifest in manifests {
        let text = std::fs::read_to_string(&manifest).unwrap();
        for line in text.lines() {
            let acp = line.trim_start().starts_with("agent-client-protocol");
            assert!(
                !(acp && line.contains("\"process\"")),
                "{} takes ACP's `process` feature",
                manifest.display()
            );
        }
    }
}

#[test]
fn the_check_reads_rust_as_it_is_written() {
    assert_eq!(
        makes("let c = tokio::process::Command::new(\"git\");"),
        Some("Command::new(")
    );
    assert_eq!(makes("AvailableCommand::new(\"review\")"), None);
    assert_eq!(
        makes("let agent = AcpAgent::new(config);"),
        Some("AcpAgent")
    );
    let tested = "fn a() {}\n#[cfg(test)]\nmod tests {\n    Command::new(\"x\");\n}\n";
    assert_eq!(makes(without_tests(tested)), None);
    let gated = "#[cfg(test)]\nfn helper() {}\nfn b() { Command::new(\"y\"); }\n";
    assert_eq!(makes(without_tests(gated)), Some("Command::new("));
}
