//! Banda's settings files, each described once (ADR 0016, decision 4).
//!
//! Each file's keys are Rust structs with a doc comment on every key, and
//! they derive a JSON Schema as well as their parser. The schema is what
//! the settings Pane draws its rows from, what the skill shows, and what
//! an editor completes and checks the file with. A new key appears in all
//! of them, with no list kept by hand.

use banda_look::Places;
use banda_look::keys::Manifests;
use banda_look::{Problem, SettingsFile};
use banda_workspaces::tiling;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub mod accounts;
mod person;
mod write;
pub use person::{chose, chose_renamed, only_the_person, only_the_person_renames};
pub use write::{rename, reset, set};

/// Each module's settings files, by its ID, as its crate describes them
/// (ADR 0016, decision 3): what its `app.toml` says it owns.
pub const MODULES: [(&str, &[SettingsFile]); 8] = [
    ("workspaces", &banda_workspaces::SETTINGS),
    ("agents", &banda_agents::SETTINGS),
    ("harnesses", &banda_harnesses::SETTINGS),
    ("browser", &banda_browser::SETTINGS),
    ("sharing", &banda_sharing::SETTINGS),
    ("terminal", &banda_terminal::SETTINGS),
    ("files", &banda_files::SETTINGS),
    ("machines", &banda_machines::SETTINGS),
];

/// Every settings file: the look's, which it reads itself, then the
/// modules'.
pub fn files() -> impl Iterator<Item = &'static SettingsFile> {
    banda_look::FILES.iter().chain(modules_files())
}

fn modules_files() -> impl Iterator<Item = &'static SettingsFile> {
    MODULES.iter().flat_map(|(_, files)| files.iter())
}

/// The file called `name`.
pub fn file(name: &str) -> Option<&'static SettingsFile> {
    files().find(|file| file.name == name)
}

/// Writes each file's schema into `folder`, as `<name>.schema.json`. A
/// schema already there and the same is left alone.
pub fn export(folder: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    for file in files() {
        let path = folder.join(file.schema_name());
        let text = serde_json::to_string_pretty(&file.schema())? + "\n";
        if std::fs::read_to_string(&path).is_ok_and(|was| was == text) {
            continue;
        }
        std::fs::write(path, text)?;
    }
    Ok(())
}

/// The modules' files, which the look watches too: it resolves the ones
/// the window reads, as `browser.toml`, and names the problems of the
/// rest, as the Harness list, as the engine reads it.
pub fn also() -> Vec<SettingsFile> {
    modules_files().copied().collect()
}

/// Each module's window part, as client/web's tests write it, by the
/// module's id, in the window's order; the window's own last (ADR 0071,
/// decision 2). The look's keys in force read them. The engine's tests
/// hold it to the list of Apps both ways, which it takes its files from in
/// B2.
pub const WINDOWS: &[(&str, &str)] = &[
    ("agents", include_str!("../../../apps/agents/window.json")),
    (
        "terminal",
        include_str!("../../../apps/terminal/window.json"),
    ),
    ("browser", include_str!("../../../apps/browser/window.json")),
    ("git", include_str!("../../../apps/git/window.json")),
    ("files", include_str!("../../../apps/files/window.json")),
    ("pulls", include_str!("../../../apps/pulls/window.json")),
    (
        "harnesses",
        include_str!("../../../platform/harnesses/window.json"),
    ),
    (
        "notifications",
        include_str!("../../../platform/notifications/window.json"),
    ),
    ("clock", include_str!("../../../apps/clock/window.json")),
    ("window", include_str!("../../../client/web/window.json")),
];

/// What the manifests declare (ADR 0071, decision 2): every action there
/// is, the modules' in the window's order, then the window's own; and the
/// scopes their keys work in.
pub fn manifests() -> Manifests {
    let mut manifests = Manifests::default();
    for (id, json) in WINDOWS {
        let window: Manifests = serde_json::from_str(json)
            .unwrap_or_else(|error| panic!("{id}'s window.json: {error}"));
        manifests.actions.extend(window.actions);
        manifests.scopes.extend(window.scopes);
    }
    manifests
}

/// The kinds of Pane the manifests declare: what a rule of `tiling.toml`
/// may name (ADR 0127, decision 4).
pub fn kinds() -> BTreeSet<String> {
    let mut kinds = BTreeSet::new();
    for (id, json) in WINDOWS {
        let window: serde_json::Value = serde_json::from_str(json)
            .unwrap_or_else(|error| panic!("{id}'s window.json: {error}"));
        let panes = window["panes"].as_array().into_iter().flatten();
        kinds.extend(panes.filter_map(|pane| Some(pane["kind"].as_str()?.to_owned())));
    }
    kinds
}

/// Checks `paths`, or with none every file Banda reads, [`files`]. Says
/// nothing when all is well.
pub fn check(places: &Places, paths: &[PathBuf]) -> Vec<Problem> {
    if paths.is_empty() {
        // No font's name is ever wrong, so the system is not asked for one.
        let places = Places {
            fontconfig: None,
            ..places.clone()
        };
        let look = banda_look::resolve(&places, &|| None, &also(), &manifests()).look;
        let mut problems = look.problems;
        // What the look cannot say of the Tiling's file: it knows no kind.
        let path = places.config.join(tiling::NAME);
        if let Ok(text) = std::fs::read_to_string(&path) {
            problems.extend(tiling::unknown_kinds(&path, &text, &kinds()));
        }
        return problems;
    }
    paths.iter().flat_map(|path| check_file(path)).collect()
}

fn check_file(path: &Path) -> Vec<Problem> {
    match std::fs::read_to_string(path) {
        Ok(text) if path.ends_with("keys.toml") => {
            let mut problems = check_text(path, &text);
            problems.extend(keys_in_force(path, &text));
            problems
        }
        Ok(text) => check_text(path, &text),
        Err(error) => vec![Problem::whole(path, error.to_string())],
    }
}

/// Checks `text` as the file at `path` is read: the Harness list as the
/// engine reads it, anything else as the look does; and a rule of the
/// Tiling's file against the kinds of Pane there are, so the writer
/// refuses one of a kind no App has.
fn check_text(path: &Path, text: &str) -> Vec<Problem> {
    let name = path.file_name().and_then(|name| name.to_str());
    let mut problems = match name.and_then(file) {
        Some(file) => file.check(path, text),
        None => banda_look::check_text(path, text),
    };
    if name == Some(tiling::NAME) {
        problems.extend(tiling::unknown_kinds(path, text, &kinds()));
    }
    problems
}

/// What is wrong with keys.toml's lines against every manifest's actions
/// (ADR 0071, decision 4): an id no App runs, args it does not take, a key
/// a field types, a `none` that frees nothing, two actions on one key.
pub(crate) fn keys_in_force(path: &Path, text: &str) -> Vec<Problem> {
    let mut problems = Vec::new();
    if let Some((_, keys)) = banda_look::keys::read_keys(path, text, &mut Vec::new()) {
        banda_look::keys::in_force(&manifests(), &keys, &mut problems);
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As ts-rs writes the types, the tests write the schemas into the
    /// contract; `scripts/check.sh` fails when that changed them.
    #[test]
    fn the_schemas_are_in_the_contract() {
        let folder =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sdk/contract/src/generated/schema");
        export(&folder).unwrap();
        for file in files() {
            assert!(folder.join(file.schema_name()).exists());
        }
    }

    #[test]
    fn a_schema_has_every_key_with_its_doc_comment() {
        let look = serde_json::to_value(file("look.toml").unwrap().schema()).unwrap();
        assert_eq!(look["title"], "look.toml");
        assert!(look["properties"]["theme"].is_object());
        assert!(
            look["additionalProperties"] == false,
            "a wrong key is named"
        );
        let defs = &look["$defs"];
        let tile = &defs["Tile"]["properties"];
        assert!(tile["border"].is_object(), "{tile}");
        let sound = &defs["SoundSettings"]["properties"];
        assert_eq!(sound["volume"]["description"], "0 to 1, for every sound.");
        assert_eq!(sound["volume"]["maximum"], 1, "a range is in the schema");
        assert!(
            file("look.toml")
                .unwrap()
                .about()
                .starts_with("How Banda looks")
        );
        let families = &defs["Families"]["enum"];
        assert!(families.as_array().unwrap().contains(&"off".into()));

        let harnesses = serde_json::to_value(file("harnesses.toml").unwrap().schema()).unwrap();
        let harness = &harnesses["$defs"]["HarnessEntry"];
        assert_eq!(
            harness["required"],
            serde_json::json!(["id"]),
            "a known ID takes the rest from Banda"
        );
        assert!(
            harness["properties"].get("record").is_none(),
            "a test's key stays out"
        );
    }

    #[test]
    fn a_wrong_harness_list_is_named_at_its_line() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("harnesses.toml");
        std::fs::write(
            &path,
            "[[harness]]\nid = \"x\"\nname = 3\ncommand = \"x\"\n",
        )
        .unwrap();
        let problems = check(&Places::at(folder.path()), std::slice::from_ref(&path));
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].line, Some(3));
    }

    #[test]
    fn the_look_carries_a_module_s_file_by_its_name() {
        let folder = tempfile::tempdir().unwrap();
        let places = Places::at(folder.path());
        std::fs::write(folder.path().join("agents.toml"), "enter = \"queue\"\n").unwrap();
        let resolved = banda_look::resolve(&places, &|| None, &also(), &manifests());
        let look = resolved.look;
        assert_eq!(
            look.files["agents.toml"],
            serde_json::json!({"enter": "queue", "seen_after": 2.5})
        );
        assert_eq!(look.settings["agents.toml"]["enter"].from.layer, "file");
        assert!(
            resolved
                .watched
                .contains(&folder.path().join("agents.toml"))
        );
        assert!(
            !look.files.contains_key("harnesses.toml"),
            "a file the look only checks"
        );
    }

    /// The Tiling's file comes to the window as any module's (ADR 0127,
    /// decision 4), and the Flow `agents.toml` still says is read into it
    /// (ADR 0069 grace).
    #[test]
    fn the_look_carries_the_tiling_s_file_and_the_flow_agents_toml_still_says() {
        let folder = tempfile::tempdir().unwrap();
        let places = Places::at(folder.path());
        let resolve = || banda_look::resolve(&places, &|| None, &also(), &manifests());
        let look = resolve().look;
        assert_eq!(
            look.files["tiling.toml"],
            serde_json::json!({"flow": "row", "rules": {}})
        );
        assert!(look.problems.is_empty(), "{:?}", look.problems);

        std::fs::write(folder.path().join("agents.toml"), "flow = \"solo\"\n").unwrap();
        let resolved = resolve();
        let look = resolved.look;
        assert_eq!(look.files["tiling.toml"]["flow"], "solo");
        let from = &look.settings["tiling.toml"]["flow"].from;
        assert_eq!((from.layer.as_str(), from.line), ("file", Some(1)));
        assert!(from.path.as_deref().unwrap().ends_with("agents.toml"));
        assert!(!look.settings["agents.toml"].contains_key("flow"));
        // The old file is told where its key went, and nothing else is.
        let said: Vec<_> = look.problems.iter().map(|p| p.message.as_str()).collect();
        assert_eq!(said.len(), 1, "{said:?}");
        assert!(said[0].contains("tiling.toml"));
        assert!(
            resolved
                .watched
                .contains(&folder.path().join("tiling.toml"))
        );

        let rule = "flow = \"free\"\n\n[rule.terminal.terminal]\nwidth = \"1/3\"\n";
        std::fs::write(folder.path().join("tiling.toml"), rule).unwrap();
        let look = resolve().look;
        assert_eq!(
            look.files["tiling.toml"],
            serde_json::json!({
                "flow": "free",
                "rules": { "terminal.terminal": { "width": "1/3" } },
            })
        );
    }

    /// A key that moved is retired where it was: its old file reads, and
    /// says where the key went.
    #[test]
    fn each_key_that_moved_is_told_where_it_went_in_its_old_file() {
        let folder = tempfile::tempdir().unwrap();
        let mut moved = 0;
        for now in files() {
            for key in now.moved() {
                moved += 1;
                let old = file(key.file).unwrap_or_else(|| panic!("no {}", key.file));
                let path = folder.path().join(old.name);
                let problems = old.check(&path, &format!("{} = \"x\"\n", key.was));
                assert_eq!(problems.len(), 1, "{}: {problems:?}", key.was);
                assert_eq!(problems[0].key.as_deref(), Some(key.was));
                assert!(problems[0].message.contains(now.name), "{problems:?}");
            }
        }
        assert!(moved > 0);
    }

    #[test]
    fn a_rule_names_a_kind_of_pane_the_manifests_declare() {
        let kinds = kinds();
        // The template names kinds there are, each in backticks.
        let template = file("tiling.toml").unwrap().template();
        let named: Vec<&str> = (template.split('`').skip(1).step_by(2))
            .filter(|word| word.contains('.') && !word.contains(' '))
            .collect();
        assert!(named.len() >= 6, "{named:?}");
        for kind in named {
            assert!(kinds.contains(kind), "{kind} in {kinds:?}");
        }
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("tiling.toml");
        let text =
            "[rule.terminal.terminal]\nwidth = \"1/3\"\n\n[rule.terminal.shell]\nwidth = \"1/3\"\n";
        std::fs::write(&path, text).unwrap();
        for problems in [
            check(&Places::at(folder.path()), std::slice::from_ref(&path)),
            check(&Places::at(folder.path()), &[]),
        ] {
            assert_eq!(problems.len(), 1, "{problems:?}");
            assert_eq!(problems[0].line, Some(4));
            assert_eq!(problems[0].key.as_deref(), Some("rule.terminal.shell"));
        }
    }

    #[test]
    fn the_look_names_what_is_wrong_in_the_harness_list() {
        let folder = tempfile::tempdir().unwrap();
        let places = Places::at(folder.path());
        let path = folder.path().join("harnesses.toml");
        let resolved = banda_look::resolve(&places, &|| None, &also(), &manifests());
        assert!(resolved.look.problems.is_empty());
        assert!(
            resolved.watched.contains(&path),
            "followed before it is there"
        );

        std::fs::write(
            &path,
            "[[harness]]\nid = \"claude\"\n\n[[harness]]\nid = \"x\"\n",
        )
        .unwrap();
        let problems = banda_look::resolve(&places, &|| None, &also(), &manifests())
            .look
            .problems;
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].line, Some(4));
        assert!(problems[0].message.contains("needs a name and a command"));
    }

    #[test]
    fn with_no_files_it_checks_every_file_there_is() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("look.toml"), "radius = \"round\"\n").unwrap();
        std::fs::write(folder.path().join("harnesses.toml"), "[[harness]]\n").unwrap();
        let problems = check(&Places::at(folder.path()), &[]);
        let files: Vec<_> = problems.iter().map(|p| p.path.clone()).collect();
        assert!(files.iter().any(|f| f.ends_with("look.toml")), "{files:?}");
        assert!(
            files.iter().any(|f| f.ends_with("harnesses.toml")),
            "{files:?}"
        );
    }
}

#[cfg(test)]
mod classes {
    use super::*;
    use banda_look::Class::{self, Device, Machine, Shared};
    use serde_json::Value;
    use std::collections::BTreeSet;

    /// Some top-level keys of a file, and whose copy they are.
    type Keys = (Class, &'static [&'static str]);

    /// Whose copy each top-level key of each file is, as ADR 0101's
    /// decision 3 has it: the machine's are read and written through its
    /// engine, and nothing else of the file leaves its device (ADR 0106,
    /// decision 7). A new key takes its file's class unless the file says
    /// otherwise, so it comes here with its class, chosen.
    const TABLE: &[(&str, &[Keys])] = &[
        (
            "look.toml",
            &[
                (Shared, &["notify"]),
                (
                    Device,
                    &[
                        "theme", "mode", "radius", "shape", "hyprland", "colors", "tokens", "gaps",
                        "desk", "tile", "focus", "shadow", "bar", "drawer", "overview", "groups",
                        "motion", "columns", "font", "sound",
                    ],
                ),
            ],
        ),
        (
            "sidebar.toml",
            &[(
                Shared,
                &[
                    "preset", "group", "card", "inbox", "hold", "sort", "projects", "bar", "later",
                    "machines",
                ],
            )],
        ),
        ("keys.toml", &[(Shared, &["binds"]), (Device, &["mod"])]),
        // How the Tiling behaves is the Person's, as their keys (ADR 0127,
        // decision 4).
        ("tiling.toml", &[(Shared, &["flow", "rule"])]),
        (
            "agents.toml",
            &[
                (Machine, &["start", "models"]),
                (Shared, &["enter"]),
                // Not in the ADR's table: the device's, as in doubt.
                (Device, &["seen-after"]),
            ],
        ),
        (
            "browser.toml",
            &[
                (Machine, &["agents"]),
                (Device, &["tabs", "search", "pinned", "blocker"]),
            ],
        ),
        (
            "files.toml",
            &[
                (Machine, &["pinned"]),
                (
                    Device,
                    &["hidden", "ignored", "editor", "previewers", "thumbnails"],
                ),
            ],
        ),
        (
            "terminal.toml",
            &[(Device, &["font", "size", "ligatures", "cursor"])],
        ),
        (
            "harnesses.toml",
            &[(Machine, &["harness", "limits", "usage", "omarchy"])],
        ),
        (
            "machine.toml",
            &[(
                Machine,
                &[
                    "name",
                    "icon",
                    "start-at-login",
                    "awake-while-working",
                    "awake-plugged-in",
                    "updates",
                ],
            )],
        ),
        ("sharing.toml", &[(Machine, &["problems", "usage"])]),
    ];

    /// The top-level keys of `file`'s schema.
    fn keys_of(file: &SettingsFile) -> BTreeSet<String> {
        let schema = serde_json::to_value(file.schema()).unwrap();
        let properties = schema["properties"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        properties.keys().cloned().collect()
    }

    #[test]
    fn each_file_says_whose_copy_each_of_its_keys_is() {
        let named: BTreeSet<&str> = TABLE.iter().map(|(name, _)| *name).collect();
        let every: BTreeSet<&str> = files().map(|file| file.name).collect();
        assert_eq!(named, every, "each file Banda reads");
        for (name, classes) in TABLE {
            let file = file(name).unwrap();
            let mut listed = BTreeSet::new();
            for (class, keys) in *classes {
                for key in *keys {
                    assert_eq!(file.class_of(key), *class, "{name}: {key}");
                    listed.insert((*key).to_owned());
                }
            }
            assert_eq!(listed, keys_of(file), "{name}: each key, once");
            for (section, _) in file.sections() {
                assert!(listed.contains(*section), "{name} names no {section}");
            }
        }
    }

    #[test]
    fn the_schema_tells_the_window_each_key_s_class() {
        let agents = serde_json::to_value(file("agents.toml").unwrap().schema()).unwrap();
        let class = |key: &str| agents["properties"][key]["x-class"].clone();
        assert_eq!(class("start"), Value::from("machine"));
        assert_eq!(class("enter"), Value::from("shared"));
        assert_eq!(class("seen-after"), Value::from("device"));
    }
}

#[cfg(test)]
mod keys_in_force {
    use super::*;
    use banda_look::keys::{Keys, Mod, in_force};

    /// Banda's keys with `held` the mod, by action id, as Banda writes
    /// them; and what was named.
    fn keys_with(held: Mod) -> (Vec<(String, Vec<String>)>, Vec<Problem>) {
        let mut problems = Vec::new();
        let keys = Keys {
            held,
            ..Keys::default()
        };
        let force = in_force(&manifests(), &keys, &mut problems)
            .into_iter()
            .map(|action| {
                (
                    action.id,
                    action.keys.iter().map(|key| key.text()).collect(),
                )
            })
            .collect();
        (force, problems)
    }

    fn mods(alt: bool, ctrl: bool, sup: bool) -> Mod {
        Mod { alt, ctrl, sup }
    }

    #[test]
    fn banda_s_keys_move_with_every_mod_and_none_clash() {
        for held in [
            mods(true, false, false),
            mods(true, true, false),
            mods(true, false, true),
            mods(false, false, true),
            mods(false, true, true),
        ] {
            let (_, problems) = keys_with(held);
            assert!(problems.is_empty(), "{held:?}: {problems:?}");
        }
        let (force, _) = keys_with(mods(true, true, false));
        let keys_of = |id: &str| {
            force
                .iter()
                .find(|(each, _)| each == id)
                .map(|(_, keys)| keys.clone())
                .unwrap_or_default()
        };
        assert_eq!(keys_of("column.next-width"), ["Ctrl+Alt+R"]);
        assert_eq!(keys_of("pane.send-2"), ["Ctrl+Alt+Shift+2"]);
        assert_eq!(keys_of("column.wider"), ["Ctrl+Alt+Super+Right"]);
        assert_eq!(keys_of("terminal.new"), ["Ctrl+Alt+Super+Return"]);
        // The reset is no mod's.
        assert_eq!(keys_of("keys.reset"), ["Ctrl+Alt+Shift+K"]);
    }

    /// Quiet (ADR 0098, decision 21) takes Alt+Q, which was free: it
    /// moves with the mod, and Quit keeps Ctrl+Q.
    #[test]
    fn quiet_is_alt_q() {
        let keys_of = |held: Mod, id: &str| {
            let (force, problems) = keys_with(held);
            assert!(problems.is_empty(), "{held:?}: {problems:?}");
            force
                .into_iter()
                .find(|(each, _)| each == id)
                .map(|(_, keys)| keys)
                .unwrap_or_default()
        };
        assert_eq!(keys_of(mods(true, false, false), "quiet.toggle"), ["Alt+Q"]);
        assert_eq!(
            keys_of(mods(true, true, false), "quiet.toggle"),
            ["Ctrl+Alt+Q"]
        );
        assert_eq!(keys_of(mods(true, false, false), "banda.quit"), ["Ctrl+Q"]);
        let (force, _) = keys_with(mods(true, false, false));
        let taking: Vec<_> = force
            .iter()
            .filter(|(_, keys)| keys.iter().any(|key| key == "Alt+Q"))
            .map(|(id, _)| id.as_str())
            .collect();
        assert_eq!(taking, ["quiet.toggle"]);
    }
}

#[cfg(test)]
mod every_key {
    use super::*;
    use serde_json::Value;

    /// The keys that may have no value when the file does not say one,
    /// each for its reason. Any other key of a schema shows in the
    /// settings Pane with its value and where it comes from.
    const UNSET: &[&str] = &[
        // The theme is Omarchy's when there is one, else Banda's: the
        // machine says it, not a default.
        "look.toml:theme",
        // None: the desktop's own background, light and dark.
        "look.toml:desk.wallpaper",
        "look.toml:desk.wallpaper-dark",
        // None: the drawer's Thread starts on this computer's first Harness.
        "look.toml:drawer.harness",
        // None: the old corner keys, read when a file still says them; the
        // tile is the window's less the outer gap (ADR 0080, decision 6).
        "look.toml:radius",
        "look.toml:tile.radius",
        // None: a new Thread starts on the first account on, with no
        // fallback (ADR 0093, decision 7).
        "agents.toml:start.account",
        "agents.toml:start.fallback",
        // None: what Banda finds the machine is called and drawn by.
        "machine.toml:name",
        "machine.toml:icon",
        // None: the file's own keys, with no preset under them.
        "sidebar.toml:preset",
        // None: the look's `[font]` mono, and three quarters of its size.
        "terminal.toml:font",
        "terminal.toml:size",
    ];

    /// An event moves with an easing or a spring: the keys of the one
    /// out of force are not keyed, when the other one's are.
    fn out_of_force(key: &str, keyed: &banda_look::keyed::Keyed) -> bool {
        let other = |this: &str, that: &str| {
            let (event, _) = key.split_once(this)?;
            let that = format!("{event}{that}");
            Some(keyed.keys().any(|k| k.starts_with(&that)))
        };
        key.starts_with("motion.")
            && (other(".easing.", ".spring.") == Some(true)
                || other(".spring.", ".easing.") == Some(true))
    }

    /// Each leaf key of a schema, dotted, through `$ref`s. A table of any
    /// keys, as `binds` or `colors`, is none of them: its keys are the
    /// Person's.
    fn leaves(schema: &Value, defs: &Value, prefix: &str, out: &mut Vec<String>) {
        let schema = match schema.get("$ref").and_then(Value::as_str) {
            Some(path) => &defs[path.trim_start_matches("#/$defs/")],
            None => schema,
        };
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            for (name, value) in properties {
                let key = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}.{name}")
                };
                leaves(value, defs, &key, out);
            }
        } else if !schema
            .get("additionalProperties")
            .is_some_and(Value::is_object)
        {
            out.push(prefix.to_owned());
        }
    }

    #[test]
    fn every_key_of_a_schema_has_a_value_and_where_it_comes_from() {
        let folder = tempfile::tempdir().unwrap();
        let also = also();
        let look =
            banda_look::resolve(&Places::at(folder.path()), &|| None, &also, &manifests()).look;
        let mut named = Vec::new();
        // The look's files and the modules' it resolves; one it only
        // checks, as the Harness list, has no keys in it.
        let resolved = also.iter().filter(|file| file.resolves());
        for file in banda_look::FILES.iter().chain(resolved) {
            let name = file.name;
            let keyed = &look.settings[name];
            let schema = serde_json::to_value(file.schema()).unwrap();
            let mut keys = Vec::new();
            leaves(&schema, &schema["$defs"], "", &mut keys);
            named.extend(keys.iter().map(|key| format!("{name}:{key}")));
            let missing: Vec<_> = keys
                .iter()
                .filter(|key| !keyed.contains_key(*key))
                .filter(|key| !UNSET.contains(&format!("{name}:{key}").as_str()))
                .filter(|key| !out_of_force(key, keyed))
                .collect();
            assert!(missing.is_empty(), "{name}: no default for {missing:?}");
        }
        for unset in UNSET {
            assert!(named.iter().any(|key| key == unset), "{unset} is no key");
        }
    }
}
