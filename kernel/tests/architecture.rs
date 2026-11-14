//! The kernel and the modules stay apart (ADR 0001, decision 3), and the
//! platform's Rust and each App's name an App no more than they do today
//! (ADR 0062). Which crate depends on which is the engine's to hold
//! (`engine/src/apps.rs`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let path = entry.unwrap().path();
        // pnpm's packages hold no Rust of Banda's, and are most of the tree.
        if path.ends_with("node_modules") {
            continue;
        }
        if path.is_dir() {
            sources(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Each module's folder, with its `app.toml`: an App's under `apps/`,
/// the platform's under `platform/` (ADR 0062, decision 11). Finding none
/// fails, so a manifest renamed cannot leave these tests checking nothing.
fn modules() -> Vec<PathBuf> {
    let found: Vec<PathBuf> = ["apps", "platform"]
        .iter()
        .filter_map(|bucket| std::fs::read_dir(repository().join(bucket)).ok())
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|path| path.join("app.toml").exists())
        .collect();
    assert!(
        !found.is_empty(),
        "no folder of apps/ or platform/ has an app.toml"
    );
    found
}

/// Where the kernel's source holds a module's name and means something
/// else, by file and what it holds, each with its reason.
const NOT_THE_MODULE: [(&str, &str); 2] = [
    // A monorepo's own `apps/` folder, where a Project's sign is looked
    // for (ADR 0070): no App of Banda's.
    ("sign.rs", "\"apps\""),
    // Windows' devices, as CON and NUL, which no file is named after: in
    // a test's name.
    ("host.rs", "devices_"),
];

/// Every module's folder is a name the kernel's source must not contain:
/// the kernel reaches modules only through the Module trait.
#[test]
fn the_kernel_names_no_module() {
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    for file in files {
        let code = std::fs::read_to_string(&file).unwrap();
        for folder in modules() {
            let module = folder.file_name().unwrap().to_string_lossy();
            for needle in [
                format!("\"{module}\""),
                format!("\"{module}."),
                format!("{module}_"),
            ] {
                let name = file.file_name().unwrap().to_string_lossy();
                if NOT_THE_MODULE.contains(&(&*name, &*needle)) {
                    continue;
                }
                assert!(
                    !code.contains(&needle),
                    "{} names the module {module}",
                    file.display()
                );
            }
        }
    }
}

/// A module writes its own tables only: the event log, the receipts and the
/// outbox are the kernel's, reached through `Tx::emit` and `Tx::enqueue`.
/// The kernel's authorizer holds a module's SQL to that as it runs
/// (`kernel/src/tables.rs`); this keeps a module's Rust from naming them
/// too, as in SQL it would run on a connection of its own.
#[test]
fn no_module_touches_the_kernels_tables() {
    for folder in modules() {
        let mut files = Vec::new();
        sources(&folder, &mut files);
        for file in files {
            let code = std::fs::read_to_string(&file).unwrap();
            assert!(
                !code.contains("kernel_"),
                "{} reaches into the kernel's tables",
                file.display()
            );
        }
    }
}

/// Each App's folder in `apps/`, whose name is the App's id.
fn apps() -> Vec<PathBuf> {
    modules()
        .into_iter()
        .filter(|folder| folder.parent().is_some_and(|p| p.ends_with("apps")))
        .collect()
}

/// Every folder of `platform/`: a part with no `app.toml`, as `settings`
/// and `look`, is the platform's too.
fn platform() -> Vec<PathBuf> {
    let found: Vec<PathBuf> = std::fs::read_dir(repository().join("platform"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.is_dir())
        .collect();
    assert!(!found.is_empty(), "platform/ has no folder");
    found
}

fn id(folder: &Path) -> String {
    folder.file_name().unwrap().to_string_lossy().into_owned()
}

/// A path from the repository's root, with `/` on every system.
fn named(path: &Path) -> String {
    let path = path.strip_prefix(repository()).unwrap();
    path.to_string_lossy().replace('\\', "/")
}

/// How often `code` names `app`: its id as a string of its own (`"git"`),
/// the start of a method's, a fact's, a Pane kind's or a settings file's
/// name (`"git.diff"`), its crate (`banda_git::`) and its folder
/// (`apps/git/`). Comment lines are left out, and all from the file's
/// first `#[cfg(test)]`, as the tests of a file end it.
///
/// It reads names as written, so it would count a word that only looks
/// like an App's: `but` holds those of this file, which are not counted.
fn names(code: &str, app: &str, but: &[&str]) -> usize {
    let needles = [
        format!("\"{app}\""),
        format!("\"{app}."),
        format!("banda_{app}::"),
        format!("apps/{app}/"),
    ]
    .into_iter()
    .filter(|needle| !but.contains(&needle.as_str()))
    .collect::<Vec<_>>();
    code.lines()
        .take_while(|line| !(line.contains("#[cfg(") && line.contains("test")))
        .filter(|line| !line.trim_start().starts_with("//"))
        .map(|line| {
            needles
                .iter()
                .map(|needle| line.matches(needle.as_str()).count())
                .sum::<usize>()
        })
        .sum()
}

/// Each file of `folders`, but those of a `tests/`, that names an App
/// other than its folder's own, with how often.
fn naming(folders: &[PathBuf]) -> BTreeMap<String, usize> {
    let apps: Vec<String> = apps().iter().map(|app| id(app)).collect();
    let mut found = BTreeMap::new();
    for folder in folders {
        let mut files = Vec::new();
        sources(folder, &mut files);
        for file in files {
            let name = named(&file);
            if name.contains("/tests/") {
                continue;
            }
            let code = std::fs::read_to_string(&file).unwrap();
            let but: Vec<&str> = NOT_AN_APP
                .iter()
                .filter(|(at, _)| *at == name)
                .map(|(_, needle)| *needle)
                .collect();
            let count: usize = apps
                .iter()
                .filter(|app| **app != id(folder))
                .map(|app| names(&code, app, &but))
                .sum();
            if count > 0 {
                found.insert(name, count);
            }
        }
    }
    found
}

/// A list that only falls: a file that names one more takes it through
/// the registry, a fact or an intent instead; one that names fewer lowers
/// its count, and one that names none leaves.
fn falls(found: BTreeMap<String, usize>, list: &[(&str, usize)]) {
    let list: BTreeMap<String, usize> = list
        .iter()
        .map(|(file, count)| ((*file).to_owned(), *count))
        .collect();
    assert_eq!(found, list, "what names an App, and what the list holds");
}

/// Where the platform's or an App's Rust holds an App's name and means
/// something else, by file and what it holds, each with its reason.
const NOT_AN_APP: [(&str, &str); 5] = [
    // The program git.
    ("platform/git-cli/src/lib.rs", "\"git\""),
    // The theme's group of tokens for a terminal's colours.
    ("platform/theme/src/tokens.rs", "\"terminal\""),
    // A folder named files, in the agents module's own data.
    ("apps/agents/engine/src/kept.rs", "\"files\""),
    // browser.toml's own table for Agents, and its sites.
    ("apps/browser/engine/src/lib.rs", "\"agents\""),
    ("apps/browser/engine/src/settings.rs", "\"agents."),
];

/// Where the platform's Rust still names an App, and how often.
const PLATFORM_NAMES: &[(&str, usize)] = &[
    // Two widgets of the Bar by their ids.
    ("platform/look/src/settings.rs", 2),
    // agents.toml and its type, for the account a new Thread starts with.
    ("platform/settings/src/accounts.rs", 8),
    // agents.toml's start modes, and browser.toml's agents table.
    ("platform/settings/src/person.rs", 13),
    // The Pane kinds whose count is shared.
    ("platform/sharing/engine/src/events.rs", 2),
    // The agents module's events, heard for the usage shared.
    ("platform/sharing/engine/src/usage.rs", 1),
    // The four Pane kinds an Agent may open, and a browser tab's wall.
    ("platform/workspaces/engine/src/lib.rs", 7),
    // A Thread's Pane kind, and the old agents.diff made git.diff.
    ("platform/workspaces/engine/src/model.rs", 3),
    // A Thread's Pane kind.
    ("platform/workspaces/engine/src/placing.rs", 1),
    // agents.toml, where two of the Tiling's settings are kept.
    ("platform/workspaces/engine/src/tiling.rs", 2),
];

/// Where an App's Rust still names another App, and how often.
const APPS_NAME_APPS: &[(&str, usize)] = &[
    // git.acted and browser.lent, heard by name for a Thread's notices.
    ("apps/agents/engine/src/notices.rs", 4),
    // The agents module's turns, heard for checkpoints.
    ("apps/git/engine/src/checkpoint.rs", 1),
    // The agents module's tools and git.acted, heard for a Thread's pull
    // requests.
    ("apps/pulls/engine/src/heard.rs", 3),
];

#[test]
fn the_platform_names_an_app_no_more_than_the_list_holds() {
    falls(naming(&platform()), PLATFORM_NAMES);
}

#[test]
fn an_app_names_another_no_more_than_the_list_holds() {
    falls(naming(&apps()), APPS_NAME_APPS);
}

#[test]
fn the_count_sees_each_way_code_names_an_app_and_no_comment_nor_test() {
    assert_eq!(names(r#"hear("git", "git.acted")"#, "git", &[]), 2);
    assert_eq!(names("use banda_git::status;", "git", &[]), 1);
    assert_eq!(
        names(r#"include_str!("../apps/git/window.json")"#, "git", &[]),
        1
    );
    assert_eq!(names(r#"let digit = "gitlab";"#, "git", &[]), 0);
    let but = ["\"git\""];
    assert_eq!(names(r#"hear("git", "git.acted")"#, "git", &but), 1);
    assert_eq!(
        names("// \"git\"\n#[cfg(test)]\nlet a = \"git\";", "git", &[]),
        0
    );
}
