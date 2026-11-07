//! Every program Banda runs for a Project starts in its environment (ADR
//! 0084, decision 4): no code of the engine but this crate makes a
//! process. What keeps Banda's books, or asks the host about itself, runs
//! on the host and executes nothing of a Project's; each such place is
//! named here, with how many processes it makes and why. A new one is
//! either that, and named here, or it goes through the Project's
//! environment.

use std::path::{Path, PathBuf};

/// What makes a process, as Rust's source says it: std's, tokio's,
/// `pty-process`'s and `async-process`'s commands, and ACP's agent that
/// starts its own.
const MAKES: [&str; 3] = ["Command::new(", "Command::from(", "AcpAgent"];

/// Where the engine makes a process on the host for no Project's
/// program: the file, how many places in it make one, and why.
const ON_THE_HOST: [(&str, usize, &str); 9] = [
    (
        "platform/git-cli/src/lib.rs",
        1,
        "Banda's own git bookkeeping, which runs no program a repository names (ADR 0083, \
         decision 5); an act the Person asks for is a Program for the Project's environment",
    ),
    (
        "kernel/src/foreign.rs",
        1,
        "asks `gh` which account it is signed in to, offline, to tell whether a folder looks \
         foreign (ADR 0084, decision 13)",
    ),
    (
        "apps/pulls/engine/src/github.rs",
        1,
        "reads pull requests from GitHub with the Person's `gh`, whose sign-in stays on the host \
         (ADR 0084, decision 8)",
    ),
    (
        "apps/terminal/engine/src/servers.rs",
        1,
        "lists the host's processes and what listens, on macOS, with `ps` and `lsof`, to find \
         the servers started in Banda (ADR 0044)",
    ),
    (
        "platform/harnesses/engine/src/carried.rs",
        1,
        "asks a Node on the host its version, for the adapters Banda carries, which run on the \
         host (ADR 0084, decision 5)",
    ),
    (
        "platform/harnesses/engine/src/limits/claude.rs",
        1,
        "reads Claude Code's sign-in from the macOS Keychain, for an account's limits (ADR 0043)",
    ),
    (
        "platform/problems/engine/src/issue.rs",
        1,
        "files a Problem in Banda's own repository with the Person's `gh`",
    ),
    (
        "platform/look/src/fonts.rs",
        1,
        "asks fontconfig which font a family is",
    ),
    (
        "platform/look/src/wallpaper.rs",
        1,
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

/// `code` as it runs: without its comments' lines, nor the test modules
/// it holds (`#[cfg(test)] mod … { … }`, to the brace that closes it),
/// which make what they test with.
fn running(code: &str) -> String {
    let mut kept = String::new();
    let mut lines = code.lines().map(str::trim);
    while let Some(line) = lines.next() {
        if line.starts_with("//") {
            continue;
        }
        if line != "#[cfg(test)]" {
            kept.push_str(line);
            kept.push('\n');
            continue;
        }
        let Some(next) = lines.next() else { break };
        if !(next.starts_with("mod ") || next.starts_with("pub mod ")) {
            kept.push_str(next);
            kept.push('\n');
            continue;
        }
        // `mod tests;` ends on its line, `mod tests {` at its last brace.
        let mut depth = opened(next);
        while depth > 0 {
            let Some(inside) = lines.next() else { break };
            depth += opened(inside);
        }
    }
    kept
}

/// How many more braces `line` opens than it closes.
fn opened(line: &str) -> isize {
    let count = |brace| isize::try_from(line.matches(brace).count()).unwrap();
    count('{') - count('}')
}

/// Whether `code` holds `name` at `at` as a name of its own, not as the
/// end of a longer one (`AvailableCommand::new(` is no command).
fn whole(code: &str, at: usize) -> bool {
    let before = code[..at].chars().next_back();
    !before.is_some_and(|c| c.is_alphanumeric() || c == '_')
}

/// Each place `code` makes a process: one of [`MAKES`].
fn makings(code: &str) -> Vec<&'static str> {
    let mut found = Vec::new();
    for making in MAKES {
        let places = code
            .match_indices(making)
            .filter(|(at, _)| whole(code, *at));
        found.extend(places.map(|_| making));
    }
    found
}

/// Whether `code` imports a command under another name, which this check
/// would not see make a process.
fn renames_a_command(code: &str) -> bool {
    (code.match_indices("Command as ")).any(|(at, _)| whole(code, at))
}

#[test]
fn only_an_environment_starts_a_projects_program() {
    let root = repository();
    let files = sources();
    assert!(files.iter().any(|file| file.starts_with(ENVIRONMENTS)));
    for file in &files {
        if file.starts_with(ENVIRONMENTS) {
            continue;
        }
        let code = running(&std::fs::read_to_string(root.join(file)).unwrap());
        assert!(
            !renames_a_command(&code),
            "{file} imports a command under another name: name it as it is, so this check sees \
             where a process is made"
        );
        let made = makings(&code);
        let named = ON_THE_HOST
            .iter()
            .find(|(on_the_host, ..)| on_the_host == file);
        let allowed = named.map_or(0, |(_, places, _)| *places);
        assert!(
            made.len() <= allowed,
            "{file} makes a process ({made:?}) in {} places, {allowed} named: a program for a \
             Project starts through its environment (ModuleProject::environment, ADR 0084); one \
             on the host for Banda's own books is named in ON_THE_HOST, with why",
            made.len()
        );
    }
}

/// A place named that no longer makes as many is named anew.
#[test]
fn each_place_on_the_host_still_makes_what_it_names() {
    let root = repository();
    for (file, places, why) in ON_THE_HOST {
        let code = std::fs::read_to_string(root.join(file))
            .unwrap_or_else(|_| panic!("{file} is gone: take it from ON_THE_HOST"));
        let made = makings(&running(&code)).len();
        assert_eq!(
            made, places,
            "{file} makes a process in {made} places now, not {places} ({why}): say so in \
             ON_THE_HOST, or take it from there"
        );
    }
}

#[test]
fn the_check_reads_rust_as_it_is_written() {
    let made = makings("let c = tokio::process::Command::new(\"git\");");
    assert_eq!(made, ["Command::new("]);
    assert!(makings("AvailableCommand::new(\"review\")").is_empty());
    assert_eq!(makings("let agent = AcpAgent::new(config);"), ["AcpAgent"]);
    assert_eq!(
        makings("Command::new(\"ps\");\nCommand::new(\"sh\");").len(),
        2
    );

    let said = "/// Not `Command::new(` but its doc.\nfn a() {}\n";
    assert!(makings(&running(said)).is_empty());
    let tested = "fn a() {}\n#[cfg(test)]\nmod tests {\n    fn t() { Command::new(\"x\"); }\n}\n";
    assert!(makings(&running(tested)).is_empty());
    let after = format!("{tested}fn b() {{ Command::new(\"y\"); }}\n");
    assert_eq!(makings(&running(&after)).len(), 1, "what follows counts");
    let declared = "#[cfg(test)]\nmod helpers;\nfn b() { Command::new(\"y\"); }\n";
    assert_eq!(makings(&running(declared)).len(), 1);
    let gated = "#[cfg(test)]\nfn helper() {}\nfn b() { Command::new(\"y\"); }\n";
    assert_eq!(makings(&running(gated)).len(), 1);

    assert!(renames_a_command("use tokio::process::Command as Cmd;"));
    assert!(renames_a_command(
        "use std::process::{Command as Run, Stdio};"
    ));
    assert!(!renames_a_command("use tokio::process::Command;"));
    assert!(!renames_a_command(
        "use crate::AvailableCommand as Offered;"
    ));
}
