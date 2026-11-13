//! Every program Banda runs for a Project starts in its environment (ADR
//! 0084, decision 4): no code of the engine but this crate makes a
//! process. What keeps Banda's books, or asks the host about itself, runs
//! on the host and executes nothing of a Project's; each such place is
//! named here, with how many processes it makes and why. A new one is
//! either that, and named here, or it goes through the Project's
//! environment.
//!
//! And every program says whose it is where it is made (ADR 0083, decision
//! 1): a Harness's and its CLI's are ones to start behind the fence, the
//! Person's terminal and git act outside it. Each place that makes one is
//! named here with whose it makes ([`WHOSE`]).

use std::path::{Path, PathBuf};

/// What makes a process, as Rust's source says it: std's, tokio's,
/// `pty-process`'s and `async-process`'s commands, ACP's agent that
/// starts its own, and the kernel's commands for a program on the host,
/// `host::command`, `host::command_on` and `host::own`.
const MAKES: [&str; 5] = [
    "Command::new(",
    "Command::from(",
    "AcpAgent",
    "host::command",
    "host::own(",
];

/// Where the engine makes a process on the host for no Project's
/// program: the file, how many places in it make one, and why.
const ON_THE_HOST: [(&str, usize, &str); 17] = [
    (
        "engine/src/moving.rs",
        1,
        "runs the engine's new copy in the engine's own place, with exec, once it stopped to move \
         onto it (ADR 0119, decision 3)",
    ),
    (
        "platform/updates/engine/src/take.rs",
        1,
        "runs a new copy of the engine it took, by its own path, with --version, to check it says \
         the version its feed named before it goes into place (ADR 0119, decision 5)",
    ),
    (
        "kernel/src/host.rs",
        1,
        "the command each place named here starts a program it finds on the host's PATH with \
         (ADR 0090, decision 3)",
    ),
    (
        "engine/src/service.rs",
        3,
        "starts and stops the engine itself as the session's systemd user unit, and asks the \
         login shell its PATH for it, as a client does before any engine runs and as macOS's \
         launchd job does as it starts (ADR 0086, decision 1)",
    ),
    (
        "engine/src/service/launchd.rs",
        2,
        "loads, asks after and stops the engine itself as macOS's launchd job with the system's \
         launchctl, and starts the job again in its own place with the login shell's PATH (ADR \
         0086, decision 1)",
    ),
    (
        "platform/harnesses/engine/src/accounts/secrets.rs",
        1,
        "reads a gateway's key the Person kept as a reference through their password manager, \
         1Password's `op` or `pass`, as the Harness asks for it (ADR 0078, decision 1)",
    ),
    (
        "engine/src/service/app.rs",
        1,
        "opens Banda's own app, hidden, with the system's open, when the engine's launchd job \
         has none (ADR 0086, decision 4)",
    ),
    (
        "platform/git-cli/src/lib.rs",
        1,
        "Banda's own git bookkeeping, which runs no program a repository names (ADR 0083, \
         decision 5), behind the fence where it holds; an act the Person asks for is a Program \
         for the Project's environment",
    ),
    (
        "kernel/src/gh.rs",
        1,
        "reads the Person's GitHub token with their `gh` on macOS and Windows, where Banda has no \
         fence yet; on Linux the engine reads it where gh keeps it, and runs no `gh` (ADR 0083)",
    ),
    (
        "apps/pulls/engine/src/github.rs",
        1,
        "reads pull requests from GitHub with the Person's `gh`, whose sign-in stays on the host, \
         where the fence does not hold; where it holds, it asks GitHub's API itself (ADR 0084, \
         decision 8; ADR 0083)",
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
         host (ADR 0084, decision 5); where the fence holds, only a Node only root changes is \
         asked, and the adapters run behind the fence (ADR 0083)",
    ),
    (
        "platform/harnesses/engine/src/limits/claude.rs",
        1,
        "reads Claude Code's sign-in from the macOS Keychain, for an account's limits (ADR 0043)",
    ),
    (
        "platform/machines/engine/src/found.rs",
        1,
        "asks the host what it is, once as the engine starts, for the machine's own name and \
         icon: `systemd-detect-virt` on Linux, `scutil`, `pmset` and `sysctl` on macOS",
    ),
    (
        "platform/problems/engine/src/issue.rs",
        1,
        "files a Problem in Banda's own repository with the Person's `gh`",
    ),
    (
        "platform/theme/src/fonts.rs",
        1,
        "asks fontconfig which font a family is",
    ),
    (
        "platform/theme/src/wallpaper.rs",
        1,
        "asks the desktop which wallpaper it shows",
    ),
];

/// This crate, the one place a Project's program starts.
const ENVIRONMENTS: &str = "platform/environments/src";

/// The kernel's constructors of a program, one for each `Whose`: only
/// these make one, and each gives it holes in the fence exactly when it is
/// one to start behind it.
const MADE_BY: [&str; 5] = ["harness", "harness_probe", "terminal", "act", "worker"];

/// What else code reaches through a program's type, which makes none.
const READ_BY: [&str; 2] = ["whose", "holes"];

/// The kernel's port, where each constructor is.
const PORT: &str = "kernel/src/environment.rs";

/// Where the engine makes a program, and whose: the file, the constructor
/// it calls there, how many places, and why. A Harness's process is one to
/// start behind the fence with its Project's holes, and its CLI asked
/// about itself with none; a terminal the Person opened and a git act they
/// asked for, outside it (ADR 0083, decision 1).
const WHOSE: [(&str, &str, usize, &str); 10] = [
    (
        "platform/apps/engine/src/worker.rs",
        "worker",
        1,
        "the worker of an App a Person's Agent wrote: its code is an Agent's, so it starts behind the fence, with holes to read its own copy and Banda's loop (ADR 0126, decision 3)",
    ),
    (
        "platform/harnesses/engine/src/accounts/mod.rs",
        "terminal",
        1,
        "Codex's fixed device-code sign-in, initiated through the bounded Account contract and completed by the Person (ADR 0104)",
    ),
    (
        "platform/harnesses/engine/src/accounts/mod.rs",
        "act",
        1,
        "Codex's sign-in with the API key the Person typed, which it reads on its input (ADR 0078, decision 1)",
    ),
    (
        "apps/agents/engine/src/lib.rs",
        "harness",
        1,
        "`banda mcp`, which a Harness's process starts behind its own fence",
    ),
    (
        "apps/terminal/engine/src/terminal.rs",
        "terminal",
        1,
        "a terminal the Person opened",
    ),
    (
        "platform/git-cli/src/lib.rs",
        "act",
        1,
        "a git act the Person asked for, which runs the repository's hooks",
    ),
    (
        "platform/harnesses/engine/src/cli.rs",
        "harness_probe",
        1,
        "asks a Harness's CLI its version",
    ),
    (
        "platform/harnesses/engine/src/limits/codex.rs",
        "harness_probe",
        1,
        "asks Codex's app-server an account's limits",
    ),
    (
        "platform/harnesses/engine/src/list.rs",
        "harness",
        1,
        "a Harness's process: a trusted Project's in its folder, each Project's with its holes, \
         the machine's with none",
    ),
    (
        "platform/harnesses/engine/src/list.rs",
        "terminal",
        1,
        "a Harness's sign-in, which the Person runs in a terminal",
    ),
];

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
    renames(code, "Command")
}

/// Whether `code` calls `name` another: `use … name as …`, or
/// `type … = name`.
fn renames(code: &str, name: &str) -> bool {
    let imported = format!("{name} as ");
    let imports = (code.match_indices(&imported)).any(|(at, _)| whole(code, at));
    let aliases = code.lines().any(|line| {
        let typed = line.match_indices("type ").find(|(at, _)| whole(line, *at));
        typed.is_some_and(|(at, _)| {
            let aliased = line[at..].split_once('=').map(|(_, aliased)| aliased);
            aliased.is_some_and(|aliased| names(aliased, name))
        })
    });
    imports || aliases
}

/// Whether `code` says `name` as a whole name of its own.
fn names(code: &str, name: &str) -> bool {
    (code.match_indices(name)).any(|(at, _)| whole(code, at) && ends(code, at + name.len()))
}

/// Whether a name in `code` ends at `at`, as no name goes on there.
fn ends(code: &str, at: usize) -> bool {
    let next = code[at..].chars().next();
    !next.is_some_and(|c| c.is_alphanumeric() || c == '_')
}

/// Each name `code` reaches through a program's type, `Program::name` or
/// `<Program>::name`, called or not.
fn through_program(code: &str) -> Vec<&str> {
    let mut reached = Vec::new();
    for path in ["Program::", "<Program>::"] {
        for (at, _) in code.match_indices(path).filter(|(at, _)| whole(code, *at)) {
            let rest = &code[at + path.len()..];
            let end = (rest.char_indices())
                .find(|&(at, _)| ends(rest, at))
                .map_or(rest.len(), |(at, _)| at);
            reached.push(&rest[..end]);
        }
    }
    reached
}

#[test]
#[cfg_attr(
    windows,
    ignore = "it reads the sources by their Unix paths, the same on every platform: Linux checks them"
)]
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

/// Each place a program is made says whose it is, as named in [`WHOSE`]:
/// a new one is named there, with whose it makes and why.
#[test]
#[cfg_attr(
    windows,
    ignore = "it reads the sources by their Unix paths, the same on every platform: Linux checks them"
)]
fn each_program_says_whose_it_is_where_it_is_made() {
    let root = repository();
    let files = sources();
    assert!(files.iter().any(|file| file == PORT));
    for file in files.iter().filter(|file| *file != PORT) {
        let code = running(&std::fs::read_to_string(root.join(file)).unwrap());
        assert!(
            !renames(&code, "Program"),
            "{file} calls Program another name: name it as it is, so this check sees whose \
             program it makes"
        );
        let reached = through_program(&code);
        for name in &reached {
            assert!(
                MADE_BY.contains(name) || READ_BY.contains(name),
                "{file} reaches Program::{name}, which neither makes a program as MADE_BY names \
                 nor reads one as READ_BY does: a program is made for whose it is, and only by \
                 its constructor (ADR 0083, decision 1)"
            );
        }
        for made_by in MADE_BY {
            let made = reached.iter().filter(|name| **name == made_by).count();
            let named = WHOSE
                .iter()
                .find(|(whose, by, ..)| whose == file && *by == made_by);
            let allowed = named.map_or(0, |(_, _, places, _)| *places);
            assert!(
                made <= allowed,
                "{file} makes a program by Program::{made_by} in {made} places, {allowed} named: \
                 say whose it is in WHOSE, with why. A Harness's is one to start behind the \
                 fence, the Person's own outside it (ADR 0083, decision 1)"
            );
        }
    }
}

/// A place named that no longer makes as many is named anew.
#[test]
fn each_place_that_makes_a_program_still_makes_what_it_names() {
    let root = repository();
    for (file, made_by, places, why) in WHOSE {
        assert!(MADE_BY.contains(&made_by), "Program::{made_by} makes none");
        let code = std::fs::read_to_string(root.join(file))
            .unwrap_or_else(|_| panic!("{file} is gone: take it from WHOSE"));
        let code = running(&code);
        let made = (through_program(&code).iter())
            .filter(|name| **name == made_by)
            .count();
        assert_eq!(
            made, places,
            "{file} makes a program by Program::{made_by} in {made} places now, not {places} \
             ({why}): say so in WHOSE, or take it from there"
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

    let made = "let p = banda_kernel::Program::harness(\"a\", vec![], holes);";
    assert_eq!(through_program(made), ["harness"]);
    let probed = "Program::harness_probe(p, a);\nlet w = program.whose();";
    assert_eq!(through_program(probed), ["harness_probe"]);
    assert_eq!(through_program("args.map(Program::terminal)"), ["terminal"]);
    assert_eq!(through_program("let make = <Program>::act;"), ["act"]);
    assert_eq!(through_program("let w = Program::whose(&p);"), ["whose"]);
    assert!(through_program("let p = MyProgram::act(x);").is_empty());
    assert!(through_program("fn of(p: Option<Program>) -> Program {").is_empty());
    assert!(renames("use banda_kernel::{Program as Run};", "Program"));
    assert!(renames("type Run = banda_kernel::Program;", "Program"));
    assert!(renames("pub(crate) type Run<'a> = &'a Program;", "Program"));
    assert!(!renames(
        "use banda_kernel::ProgramAsked as Asked;",
        "Program"
    ));
    assert!(!renames("type Asked = ProgramAsked;", "Program"));
    assert!(!renames("let p: Program = told;", "Program"));
}
