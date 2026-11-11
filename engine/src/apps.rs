//! One list of Apps (ADR 0062, decision 11; ADR 0082, decision 2): every
//! App and platform part with a manifest, as `build.rs` scans them from
//! `apps/` and `platform/`, the Apps first, each bucket by its folders'
//! names. The scan writes the list; this file says what an entry holds,
//! and how this engine builds each engine part. `banda modules` and the
//! serving engine read the list, and its tests hold the lists still kept
//! by hand to it: the crates the `Cargo.toml` files name, the settings'
//! window parts (until the settings take them from here, B2), and the
//! window's modules. They write the contract's list of methods.

use crate::places::{Places, channel, from_checkout};
use banda_agents::sending::{self, AgentsSettings};
use banda_agents::{Agents, Pipe};
use banda_browser::Browser;
use banda_bytes::Bytes;
use banda_files::Files;
use banda_git::Git;
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::methods::MethodTable;
use banda_kernel::{KernelBuilder, Method, Working};
use banda_keys::KeysModule;
use banda_look::OneFile;
use banda_machines::{Machine, Machines};
use banda_problems::Problems;
use banda_pulls::Pulls;
use banda_sharing::{Never, Sharing};
use banda_terminal::Terminals;
use banda_updates::Updates;
use banda_workspaces::Workspaces;
use banda_workspaces::placing::Flow;

/// One App or platform part, as the scan found it, or the window's own.
pub struct Part {
    /// Its id, which is its folder's name.
    pub id: &'static str,
    /// Its manifest, as written.
    pub manifest: &'static str,
    /// Its window part, as the window's tests copy it into `window.json`
    /// for the engine, which has no window; none when it has none.
    pub window: Option<&'static str>,
    /// Its engine part's `methods!` table; none when it has no engine part.
    pub methods: Option<fn() -> Vec<Method>>,
}

/// What this engine builds the engine parts from: this host's places and
/// what its parts share (refactor.md's `HostContext`).
pub struct HostContext<'a> {
    pub places: &'a Places,
    /// The one list of Harnesses, which agents and harnesses both read
    /// again as its file changes.
    pub harnesses: &'a Harnesses,
    /// How each Thread's session reaches the engine: this program's
    /// `banda mcp` (ADR 0019).
    pub pipe: &'a Pipe,
    /// What the fence keeps read-only from Agents, where it holds: every
    /// Banda's config and gh's, and where the links in them lead
    /// (`banda_environments::Fenced::kept`).
    pub kept: &'a [std::path::PathBuf],
    /// What this machine is called and drawn by, which the machines
    /// module keeps current and the engine's `welcome` says.
    pub machine: &'a Machine,
    /// The count of the Turns that run, which each holds one of while it
    /// runs and the engine keeps its machine awake by (ADR 0097).
    pub working: &'a Working,
    /// The tokens the bytes module gives, which the routes beside the API
    /// serve (ADR 0106, step 4a).
    pub bytes: &'a Bytes,
}

include!(concat!(env!("OUT_DIR"), "/apps.rs"));

/// The lines of the `methods!` table of the part `build` makes.
const fn table_of<M: MethodTable>(_build: fn(&HostContext<'_>) -> M) -> fn() -> Vec<Method> {
    M::method_list
}

/// The TypeScript type the `methods!` table of the part `build` makes
/// writes, and its folder.
#[cfg(test)]
const fn typed<M: MethodTable>(_build: fn(&HostContext<'_>) -> M) -> (&'static str, &'static str) {
    (M::TS, M::DIR)
}

/// How this engine builds each engine part, by its App's id. The list
/// serves one for each App with an engine part: an App with no builder
/// here fails the build, and a builder with no App is code nothing calls,
/// which clippy refuses.
mod build {
    use super::*;

    pub fn agents(host: &HostContext<'_>) -> Agents {
        Agents::new(host.harnesses.clone())
            .config_in(host.places.config.clone())
            .modes_chosen_in(host.places.modes_chosen())
            .piped(host.pipe.clone())
            .counted_in(host.working.clone())
    }

    pub fn browser(_: &HostContext<'_>) -> Browser {
        Browser::new()
    }

    /// Banda's settings are the settings Pane's to write (ADR 0073,
    /// decision 8), and what the fence keeps read-only no Agent writes
    /// through Files either; files' small pictures are kept in Banda's
    /// cache, and freedesktop's (step F6).
    pub fn files(host: &HostContext<'_>) -> Files {
        Files::new()
            .config_in(host.places.config.clone())
            .kept_from_agents(host.kept.to_vec())
            .thumbs_in(
                host.places.thumbnails(),
                banda_files::thumb::shared_from_env(),
            )
    }

    pub fn git(_: &HostContext<'_>) -> Git {
        Git::new()
    }

    pub fn pulls(_: &HostContext<'_>) -> Pulls {
        Pulls::new()
    }

    pub fn terminal(_: &HostContext<'_>) -> Terminals {
        Terminals::new()
    }

    /// The bytes module shares its tokens with the routes beside the API,
    /// which the engine serves with it.
    pub fn bytes(host: &HostContext<'_>) -> Bytes {
        host.bytes.clone()
    }

    pub fn harnesses(host: &HostContext<'_>) -> HarnessesModule {
        let secrets =
            banda_harnesses::Secrets::new(crate::places::FOLDER, host.places.state.join("secrets"));
        HarnessesModule::new(host.harnesses.clone()).with_accounts(
            host.places.data.join("accounts"),
            std::sync::Arc::new(banda_settings::accounts::Store::new(
                host.places.config.clone(),
            )),
            secrets,
        )
    }

    /// Banda's keys, which an Agent binds for its Person (ADR 0071), and
    /// the settings an Agent changes through the engine, where the mode a
    /// Person sets for new Threads is kept as theirs (ADR 0083).
    pub fn keys(host: &HostContext<'_>) -> KeysModule {
        KeysModule::new(host.places.config.clone()).modes_chosen_in(host.places.modes_chosen())
    }

    /// This machine's name and icon, which the settings' `set` writes in
    /// machine.toml (ADR 0095).
    pub fn machines(host: &HostContext<'_>) -> Machines {
        Machines::new(host.machine.clone())
    }

    /// What broke in Banda (ADR 0039), and, from a checkout's build, the
    /// checkout an Agent fixes it in.
    pub fn problems(host: &HostContext<'_>) -> Problems {
        let problems = Problems::new(host.places.problems(), host.places.logs());
        if from_checkout() {
            problems.from_checkout()
        } else {
            problems
        }
    }

    /// The one part of Banda that sends anything (ADR 0039, decision 4):
    /// never from a checkout's build, as in CI and the tests, nor with
    /// `BANDA_SHARING=0`.
    pub fn sharing(host: &HostContext<'_>) -> Sharing {
        let places = host.places;
        let sharing = Sharing::new(&places.config, &places.state).channel(channel());
        if from_checkout() {
            sharing.never(Never::Checkout)
        } else if std::env::var_os("BANDA_SHARING").is_some_and(|off| off == "0") {
            sharing.never(Never::Run)
        } else {
            sharing
        }
    }

    /// This machine's own updates (ADR 0115): its engine's copies are in
    /// the data folder's `engine/`, as the window keeps its own, and
    /// machine.toml says whether it takes them.
    pub fn updates(host: &HostContext<'_>) -> Updates {
        let banda = banda_updates::Banda {
            channel: channel(),
            folder: crate::places::FOLDER,
            version: banda_kernel::version().to_owned(),
            program: std::env::current_exe().ok(),
            engine: host.places.data.join("engine"),
        };
        Updates::new(banda, host.machine.updates())
    }

    /// The Pane kinds that open as a Group of their own, as the window
    /// parts say (ADR 0065, decision 7), and this machine's copy of the
    /// Flow (ADR 0110, decision 5).
    pub fn workspaces(host: &HostContext<'_>) -> Workspaces {
        let file = host.places.config.join(AgentsSettings::NAME);
        Workspaces::new()
            .grouped_kinds(crate::modules::grouped_kinds())
            .home_kinds(crate::modules::home_kinds())
            .flow(move || match sending::flow(&file) {
                sending::Flow::Free => Flow::Free,
                sending::Flow::Row | sending::Flow::Solo => Flow::Row,
            })
    }
}

/// Runs `with` on a host of its own, in a folder that goes after it: for
/// the tests that build the engine parts (`scanned::parts`).
#[cfg(test)]
pub(crate) fn on_a_test_host<R>(with: impl FnOnce(&HostContext<'_>) -> R) -> R {
    let folder = tempfile::tempdir().unwrap();
    let places = Places::under(folder.path());
    let harnesses = Harnesses::default();
    let pipe = Pipe {
        program: folder.path().join("banda"),
        engine: "ws://127.0.0.1:1/ws".to_owned(),
    };
    let named = banda_kernel::Named {
        name: "test".to_owned(),
        icon: banda_kernel::MachineIcon::Desktop,
    };
    let machine = Machine::new(&places.config, named);
    with(&HostContext {
        places: &places,
        harnesses: &harnesses,
        pipe: &pipe,
        kept: &[],
        machine: &machine,
        working: &Working::new(),
        bytes: &Bytes::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::{Does, Kind, Right};
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::{Path, PathBuf};

    fn repository() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    fn read(path: &str) -> String {
        std::fs::read_to_string(repository().join(path))
            .unwrap_or_else(|error| panic!("{path}: {error}"))
    }

    fn cargo(path: &str) -> toml::Table {
        toml::from_str(&read(path)).unwrap_or_else(|error| panic!("{path}: {error}"))
    }

    /// The folder `path` names, from the repository's top, without `..`.
    fn tidy(from: &str, path: &str) -> String {
        let mut parts: Vec<&str> = from.split('/').filter(|p| !p.is_empty()).collect();
        for part in path.split('/') {
            match part {
                ".." => {
                    parts.pop();
                }
                "." | "" => {}
                part => parts.push(part),
            }
        }
        parts.join("/")
    }

    /// The crates a `Cargo.toml`'s `[dependencies]` reach by path, by name,
    /// each with its folder from the repository's top.
    fn path_deps(file: &str) -> Vec<(String, String)> {
        let table = cargo(file);
        let from = file.trim_end_matches("Cargo.toml");
        let mut deps: Vec<(String, String)> = table["dependencies"]
            .as_table()
            .unwrap()
            .iter()
            .filter_map(|(name, dep)| {
                let path = dep.get("path")?.as_str()?;
                Some((name.clone(), tidy(from, path)))
            })
            .collect();
        deps.sort();
        deps
    }

    /// Whether `folder` is in an App's folder, which is every folder of
    /// `apps/`, or in a platform part's, one of `platform/` with a
    /// manifest; the platform's crates with none, as the look, are no part.
    fn in_a_part(folder: &str) -> bool {
        let mut parts = folder.split('/');
        match (parts.next(), parts.next()) {
            (Some("apps"), Some(_)) => true,
            (Some("platform"), Some(name)) => repository()
                .join("platform")
                .join(name)
                .join(MANIFEST)
                .is_file(),
            _ => false,
        }
    }

    fn scanned_crates() -> Vec<(String, String)> {
        let mut crates: Vec<(String, String)> = scanned::CRATES
            .iter()
            .map(|(_, name, folder)| (name.to_string(), folder.to_string()))
            .collect();
        crates.sort();
        crates
    }

    /// Each builder makes the engine part of its App: the part says its
    /// App's id as its name, which the kernel serves it under.
    #[test]
    fn each_builder_makes_the_engine_part_its_app_names() {
        for (id, part) in on_a_test_host(scanned::parts) {
            let name = part.name();
            assert_eq!(id, name, "the engine part of {id} says it is {name}");
        }
    }

    /// Cargo's dependencies stay written out (ADR 0062, B1):
    /// engine/Cargo.toml names each engine part's crate, and no other crate
    /// in an App's or a platform part's folder, and the workspace has each
    /// as a member.
    #[test]
    fn cargo_names_each_engine_part_the_list_has() {
        let named: Vec<(String, String)> = path_deps("engine/Cargo.toml")
            .into_iter()
            .filter(|(_, folder)| in_a_part(folder))
            .collect();
        assert_eq!(
            named,
            scanned_crates(),
            "engine/Cargo.toml's crates in the Apps' and the platform's folders, and the list's engine parts"
        );
        let workspace = cargo("Cargo.toml");
        let mut members: Vec<String> = workspace["workspace"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|member| member.as_str().unwrap().to_owned())
            .filter(|member| in_a_part(member))
            .collect();
        members.sort();
        let mut folders: Vec<String> = scanned_crates().into_iter().map(|(_, f)| f).collect();
        folders.sort();
        assert_eq!(
            members, folders,
            "the workspace's members in the Apps' folders"
        );
    }

    /// Until the settings take the window parts from the list (B2), their
    /// crate names each part's, the window's own too, and no other. Its
    /// order is the look's, where the first action holding a key keeps it.
    #[test]
    fn the_settings_read_each_window_part_the_list_has() {
        let mut listed: Vec<(&str, &str)> = APPS
            .iter()
            .chain([&WINDOW])
            .filter_map(|part| Some((part.id, part.window?)))
            .collect();
        let mut kept = banda_settings::WINDOWS.to_vec();
        kept.sort();
        listed.sort();
        assert!(
            kept == listed,
            "banda_settings::WINDOWS names {:?}, and the list {:?}",
            kept.iter().map(|(id, _)| id).collect::<Vec<_>>(),
            listed.iter().map(|(id, _)| id).collect::<Vec<_>>(),
        );
    }

    /// The packages of Banda's a client's file imports whose names end in
    /// `suffix`, each with the names it imports them by.
    fn imported(text: &str, suffix: &str) -> BTreeMap<String, Vec<String>> {
        let mut found = BTreeMap::new();
        let mut before = 0;
        for (at, _) in text.match_indices(" from \"") {
            let start = at + " from \"".len();
            let package = text[start..].split('"').next().unwrap_or_default();
            let statement = &text[before..at];
            before = start;
            if !package.starts_with("@banda/") || !package.ends_with(suffix) {
                continue;
            }
            let names = statement
                .rsplit_once("import")
                .and_then(|(_, names)| names.split_once('{'))
                .and_then(|(_, names)| names.split_once('}'))
                .map(|(names, _)| names)
                .unwrap_or_default();
            let names = names
                .split(',')
                .map(|name| name.trim())
                .filter(|name| !name.is_empty() && !name.starts_with("type "))
                .map(|name| name.rsplit(" as ").next().unwrap().to_owned())
                .collect();
            found.insert(package.to_owned(), names);
        }
        found
    }

    /// The words of `text`: each name it says.
    fn words(text: &str) -> BTreeSet<&str> {
        text.split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .filter(|word| !word.is_empty())
            .collect()
    }

    /// A client's list of modules (`file`): it imports the package of each
    /// part the list has in its place (`packages`), and no other, and its
    /// exported `modules` names each import. Not which of its fields does:
    /// main's parts each give it different ones.
    fn holds_to_the_list(file: &str, suffix: &str, packages: BTreeSet<String>) {
        let text = read(file);
        let imports = imported(&text, suffix);
        let named: BTreeSet<String> = imports.keys().cloned().collect();
        assert_eq!(named, packages, "{file}'s packages, and the list's");
        let (_, exported) = text
            .split_once("export const modules")
            .unwrap_or_else(|| panic!("{file} exports its modules"));
        let exported = words(exported);
        for (package, names) in &imports {
            assert!(!names.is_empty(), "{file} imports {package} by a name");
            for name in names {
                assert!(
                    exported.contains(name.as_str()),
                    "{file} imports {name} from {package}, and its modules leave it out"
                );
            }
        }
    }

    /// The window lists its modules by hand (`client/web/src/modules.ts`,
    /// and main's `client/desktop/src/modules.ts`): each names every part
    /// the list has in its place, and no other.
    #[test]
    fn the_windows_lists_name_the_parts_the_list_has() {
        let panes = scanned::PANES.iter().map(|(_, p)| p.to_string()).collect();
        holds_to_the_list("client/web/src/modules.ts", "-pane", panes);
        let desktops = (scanned::DESKTOPS.iter())
            .map(|(_, p)| p.to_string())
            .collect();
        holds_to_the_list("client/desktop/src/modules.ts", "-desktop", desktops);
    }

    /// The contract's methods (`sdk/contract/src/generated/Methods.ts`):
    /// the kernel's own, then each engine part's, as the list has them,
    /// each by the type its `methods!` table writes.
    fn contract() -> String {
        let mut parts: Vec<(&str, &str, &str)> = banda_kernel::methods::own()
            .into_iter()
            .map(|(id, (ts, dir), _)| (id, ts, dir))
            .collect();
        parts.extend(
            scanned::TYPES
                .iter()
                .map(|(id, (ts, dir))| (*id, *ts, *dir)),
        );
        let mut text = String::from(
            "// Written by banda's tests from the list of Apps (engine/src/apps.rs): do not edit.\n",
        );
        for (_, ts, dir) in &parts {
            let dir = dir.trim_start_matches("./");
            text.push_str(&format!("import type {{ {ts} }} from \"./{dir}{ts}\"\n"));
        }
        text.push_str(
            "\n/** A part's methods under its prefix: `send` becomes `agents.send`. */\n\
             type Prefixed<P extends string, M> = {\n  \
             [K in keyof M & string as `${P}.${K}`]: M[K]\n\
             }\n\n\
             /** Every method of the engine: the kernel's own, then each engine\n \
             * part's, in the list of Apps (ADR 0062, decision 11). */\n\
             export type Methods = ",
        );
        let prefixed: Vec<String> = parts
            .iter()
            .map(|(id, ts, _)| format!("Prefixed<\"{id}\", {ts}>"))
            .collect();
        text.push_str(&prefixed.join(" &\n  "));
        text.push('\n');
        text
    }

    /// Writes `text` at `file` of the contract's `generated/`, and fails
    /// the test when what was there was not it.
    fn written(file: &str, text: &str) {
        let path = repository().join("sdk/contract/src/generated").join(file);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text) {
            std::fs::write(&path, text).unwrap();
            panic!(
                "{} was stale: written; review it and run again",
                path.display()
            );
        }
    }

    #[test]
    fn the_contract_has_each_engine_parts_methods() {
        written("Methods.ts", &contract());
    }

    /// Every method, `<prefix>.<name>`, with its line: the kernel's own,
    /// then each engine part's, as the contract's list of methods has
    /// them.
    fn every_method() -> Vec<(String, Method)> {
        let parts = APPS
            .iter()
            .filter_map(|part| Some((part.id, (part.methods?)())));
        banda_kernel::methods::own()
            .into_iter()
            .map(|(prefix, _, methods)| (prefix, methods))
            .chain(parts)
            .flat_map(|(prefix, methods)| {
                methods
                    .into_iter()
                    .map(move |method| (format!("{prefix}.{}", method.name), method))
            })
            .collect()
    }

    /// What each method does, for the window's client to know an act by
    /// (`sdk/contract/src/generated/does.ts`, ADR 0106, law 4).
    fn does() -> String {
        let mut text = String::from(
            "// Written by banda's tests from the list of Apps (engine/src/apps.rs): do not edit.\n\
             import type { Methods } from \"./Methods\"\n\n\
             /** What a method does: it reads, or it acts (ADR 0106, law 4). */\n\
             export type Does = \"read\" | \"act\"\n\n\
             /** What each method does, as its line in `methods!` says: a command\n \
             * acts; a call or a stream reads by its right `Read`, or by `read`,\n \
             * and acts otherwise. */\n\
             export const DOES = {\n",
        );
        for (name, method) in every_method() {
            let does = match method.does {
                Does::Read => "read",
                Does::Act => "act",
            };
            text.push_str(&format!("  \"{name}\": \"{does}\",\n"));
        }
        text.push_str("} as const satisfies { readonly [M in keyof Methods]: Does }\n");
        text
    }

    #[test]
    fn the_contract_says_what_each_method_does() {
        written("does.ts", &does());
    }

    /// A method reads or acts by its kind and its right, and the mark
    /// `read` alone turns that (ADR 0106, law 4): a command acts, a call or
    /// a stream whose right is `Read` reads, and one with another right
    /// acts unless it says `read`. Those that do are these alone, each
    /// with why it only reads: a mark taken in error would let an act wait
    /// for its machine and run later by itself, so a new one is added here
    /// with its reason.
    #[test]
    fn every_method_whose_right_is_not_read_acts_or_says_read() {
        let marked = [
            ("projects.browse", "it lists the folders a path names"),
            ("projects.foreign", "it looks at a folder for Add Project"),
            ("window.requests", "it listens for what to ask the window"),
            ("terminal.watch", "it says what a terminal shows"),
            ("harnesses.account", "it asks a Harness who is signed in"),
        ];
        let mut read_by_mark = Vec::new();
        for (name, method) in every_method() {
            let expected = match (method.kind, method.right) {
                (Kind::Command, _) => Does::Act,
                (_, Right::Read) => Does::Read,
                _ if method.does == Does::Read => {
                    read_by_mark.push(name.clone());
                    Does::Read
                }
                _ => Does::Act,
            };
            assert_eq!(method.does, expected, "{name}");
        }
        let listed: Vec<&str> = marked.iter().map(|(name, _)| *name).collect();
        assert_eq!(read_by_mark, listed, "the methods that say `read`");
    }

    /// A pass reaches a machine's method only as a tool, or by its line's
    /// `pass` (ADR 0078, decision 1): those that say it are these alone,
    /// each with why. A mark taken in error would hand every Agent's pass a
    /// way past the machine's wall, so a new one is added here with its
    /// reason, and its handler says whose pass it answers.
    #[test]
    fn only_these_methods_a_pass_reaches_that_are_no_tools() {
        let marked = [
            (
                "harnesses.update_account",
                "an Agent may rename an Account and turn it on or off (ADR 0104, decision 4)",
            ),
            (
                "harnesses.set_start",
                "an Agent may choose the default and the fallback (ADR 0104, decision 4)",
            ),
            (
                "harnesses.secret",
                "a gateway account's own Harness asks for its key",
            ),
        ];
        let passed: Vec<String> = (every_method().into_iter())
            .filter(|(_, method)| method.pass)
            .map(|(name, _)| name)
            .collect();
        let listed: Vec<&str> = marked.iter().map(|(name, _)| *name).collect();
        assert_eq!(passed, listed, "the methods that say `pass`");
        for (name, method) in every_method() {
            assert!(
                !(method.pass && method.tool.is_some()),
                "{name} is a tool already"
            );
        }
    }
}
