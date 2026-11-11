//! `banda modules`: what each module offers, for a Person, an Agent and
//! the skill's reference (ADR 0022, decision 1). A module says it in three
//! places, and this puts them together, for each part in the list of Apps
//! (`apps.rs`), then the window's own:
//!
//! - its manifest: its id, kind, name, version, the App API it is written
//!   to, the settings files it owns, what it needs, and its unstable marks;
//! - its engine part's `methods!` table, when it has one;
//! - its window part's `defineModule`, when it has one, which the window's
//!   tests copy into `window.json` beside the manifest, as the engine
//!   has no window.
//!
//! The serving engine reads from here which Pane kinds open as a Group
//! of their own, for the workspaces (ADR 0065, decision 7); the keys read
//! the actions and their scopes through `banda_settings` (ADR 0071,
//! decision 2).

use crate::apps::{APPS, MANIFEST, Part, WINDOW};
use banda_kernel::Method;
use banda_look::keys::{Action, Scope};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// How many unstable marks the modules hold (ADR 0022, decision 6). A
/// mark more fails the tests until a PR raises this and says why; a mark
/// fewer fails them until it is lowered, so the count only falls.
pub const CEILING: usize = 2;

/// What a manifest holds: only what no code says.
#[derive(Serialize, Deserialize)]
#[serde(
    rename_all(serialize = "camelCase", deserialize = "kebab-case"),
    deny_unknown_fields
)]
struct Manifest {
    id: String,
    /// An App's or the platform's; none for the window's own, a client's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    kind: Option<Whose>,
    name: String,
    about: String,
    version: String,
    /// The major of the App API it is written to (ADR 0062, decision 11;
    /// ADR 0082, decision 14); none for the window's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api: Option<u32>,
    from_banda: bool,
    /// The settings files it owns, in `~/.config/banda`.
    #[serde(default)]
    settings: Vec<String>,
    /// The prefixes its tables kept from an id it had before (ADR 0085,
    /// decision 12), which its SQL reaches beside its own: its engine part
    /// tells the kernel them (`Module::legacy_prefixes`), and the tests
    /// hold the two alike.
    #[serde(default)]
    legacy_prefixes: Vec<String>,
    /// What it needs of Banda (ADR 0082, decision 2); none for the
    /// window's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    needs: Option<Needs>,
    /// The paths it takes that the contract lacks yet, each with why.
    #[serde(default)]
    unstable: BTreeMap<String, String>,
}

/// Whose a part is, its manifest's `kind` (ADR 0062, decision 11): an
/// App's, in `apps/`, or the platform's, in `platform/`, which may hold
/// rights no App gets.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Whose {
    App,
    Platform,
}

/// What a part needs of Banda, as it will declare it (ADR 0082, decision
/// 2): the facts it hears, the methods and intents it calls, its
/// capabilities and what it asks of a device. None is built yet, so the
/// table is empty, and a need in it is refused.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Needs {}

/// One module, as `banda modules` prints it.
#[derive(Serialize)]
pub struct Offer {
    #[serde(flatten)]
    manifest: Manifest,
    /// Its engine part's methods; none when it has no engine part.
    engine: Option<Vec<Method>>,
    /// Its window part: its Panes, actions, sources, Watches and widgets;
    /// none when the window draws it itself, as the workspaces.
    window: Option<Window>,
}

/// What a module's `defineModule` offers, as `window.json` copies it.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    #[serde(default)]
    panes: Vec<PaneKind>,
    actions: Vec<Action>,
    /// The scopes its actions' keys work in (ADR 0071, decision 1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    scopes: Vec<Scope>,
    #[serde(default)]
    sources: Vec<Value>,
    #[serde(default)]
    watches: usize,
    /// Its widgets on the bar, which the look's `[bar]` places by id.
    #[serde(default)]
    bar: Vec<Widget>,
}

/// A kind of Pane a window part offers (`PaneKind`), with what the host
/// needs of it (ADR 0087, decision 13).
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PaneKind {
    kind: String,
    /// It opens as a Group of its own, as a Thread does (`PaneKind.grouped`;
    /// ADR 0065, decision 7).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    grouped: bool,
    /// It stands on its Project's workspace, as a Thread does
    /// (`PaneKind.home`; ADR 0065, decision 9).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    home: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Widget {
    id: String,
    about: String,
}

/// Every part in the list of Apps, then the window's own. The files are
/// Banda's own, so a wrong one is a bug the tests catch.
pub fn offers() -> Vec<Offer> {
    APPS.iter().chain([&WINDOW]).map(offer).collect()
}

fn offer(part: &Part) -> Offer {
    let id = part.id;
    Offer {
        manifest: toml::from_str(part.manifest)
            .unwrap_or_else(|error| panic!("{id}'s {MANIFEST}: {error}")),
        engine: part.methods.map(|methods| methods()),
        window: part.window.map(|window| {
            serde_json::from_str(window)
                .unwrap_or_else(|error| panic!("{id}'s window.json: {error}"))
        }),
    }
}

/// The Pane kinds that open as a Group of their own, as the window parts
/// in the list of Apps say: the workspaces take them as the engine
/// starts. A window part that does not read is logged and left out, and
/// its kinds open in no Group: where a Pane opens never stops the engine,
/// and its tests catch the wrong file.
pub fn grouped_kinds() -> BTreeSet<String> {
    grouped_in(APPS)
}

/// The kinds of Pane that stand on their Project's workspace, as the
/// window parts in the list of Apps say; read as `grouped_kinds` is.
pub fn home_kinds() -> BTreeSet<String> {
    kinds_in(APPS, |pane| pane.home)
}

fn grouped_in(parts: &[Part]) -> BTreeSet<String> {
    kinds_in(parts, |pane| pane.grouped)
}

fn kinds_in(parts: &[Part], wanted: impl Fn(&PaneKind) -> bool) -> BTreeSet<String> {
    let mut kinds = BTreeSet::new();
    for part in parts {
        let Some(window) = part.window else {
            continue;
        };
        match serde_json::from_str::<Window>(window) {
            Ok(window) => kinds.extend(
                (window.panes.into_iter())
                    .filter(|pane| wanted(pane))
                    .map(|pane| pane.kind),
            ),
            Err(error) => tracing::error!(
                %error,
                app = part.id,
                "a window.json does not read: its Panes open in no Group of their own"
            ),
        }
    }
    kinds
}

/// The unstable marks: `module.mark`, and why.
pub fn marks(offers: &[Offer]) -> Vec<(String, &str)> {
    offers
        .iter()
        .flat_map(|offer| {
            let id = &offer.manifest.id;
            offer
                .manifest
                .unstable
                .iter()
                .map(move |(mark, why)| (format!("{id}.{mark}"), why.as_str()))
        })
        .collect()
}

/// The skill's `modules` topic: each module, the files it owns, its
/// actions and keys, and what an Agent may call (ADR 0022, step 5). The
/// tests write it to `engine/skill/`, where the skill gathers its topics.
#[cfg(test)]
fn topic(offers: &[Offer]) -> String {
    use std::fmt::Write as _;

    let mut text = format!(
        "---\n\
         name: modules\n\
         description: Banda's modules - what each is, the settings files it owns, its actions and their keys, and what an Agent may call.\n\
         ---\n\n\
         # Modules\n\n\
         <!-- Written by banda's tests from each module's {MANIFEST} and code: do not edit. -->\n\n\
         Banda's work is done by modules. `banda modules` prints all of this \
         as JSON, one line per module; `banda modules --unstable` lists the \
         paths a module takes that are not in the contract yet.\n",
    );
    for offer in offers {
        let Manifest {
            id,
            name,
            about,
            settings,
            ..
        } = &offer.manifest;
        write!(text, "\n## {name} (`{id}`)\n\n{about}\n").unwrap();
        if !settings.is_empty() {
            let files: Vec<String> = settings.iter().map(|f| format!("`{f}`")).collect();
            write!(text, "\nIts settings: {}.\n", files.join(", ")).unwrap();
        }
        let actions: Vec<&Action> = offer
            .window
            .iter()
            .flat_map(|window| &window.actions)
            .filter(|a| !a.unlisted)
            .collect();
        if !actions.is_empty() {
            text.push_str(
                "\nIts actions, which `keys.toml` binds by id, with their keys \
                 under Banda's own mod, Alt; `keys.toml`'s `mod` moves them:\n\n",
            );
            for action in actions {
                writeln!(text, "{}", line_of(action)).unwrap();
            }
        }
        let scopes: Vec<String> = (offer.window.iter().flat_map(|w| &w.scopes))
            .map(|scope| {
                let field = if scope.field { ", a field" } else { "" };
                let held = if scope.mod_held {
                    ", whose keys work with the mod still held too"
                } else {
                    ""
                };
                format!("`{}` (the {}{field}{held})", scope.id, scope.title)
            })
            .collect();
        if !scopes.is_empty() {
            write!(
                text,
                "\nIts scopes, whose actions' keys work while the focus is in \
                 them and are bound in their own table of `keys.toml`: {}.\n",
                scopes.join(", ")
            )
            .unwrap();
        }
        let widgets: Vec<&Widget> = offer.window.iter().flat_map(|w| &w.bar).collect();
        if !widgets.is_empty() {
            text.push_str("\nIts widgets on the bar, which `[bar]` in look.toml places by id:\n\n");
            for widget in widgets {
                writeln!(text, "- `{}`: {}", widget.id, widget.about).unwrap();
            }
        }
        let Some(methods) = &offer.engine else {
            continue;
        };
        let names: Vec<String> = methods.iter().map(|m| format!("`{}`", m.name)).collect();
        write!(
            text,
            "\nIts methods, `banda call {id}.<method>`: {}.\n",
            names.join(", ")
        )
        .unwrap();
        let tools: Vec<&Method> = methods.iter().filter(|m| m.tool.is_some()).collect();
        if !tools.is_empty() {
            text.push_str("\nWhat an Agent in a Thread may call as a tool of `banda mcp`:\n\n");
            for method in tools {
                let tool = method.tool.unwrap_or_default();
                writeln!(text, "- `{tool}`: {}", method.about).unwrap();
            }
        }
    }
    text
}

/// An action's line in the skill's topic: its title, its id, the keys
/// it takes with Alt the mod, and what it takes.
#[cfg(test)]
fn line_of(action: &Action) -> String {
    let mut line = format!("- {} (`{}`)", action.title, action.id);
    if !action.keys.is_empty() {
        let keys: Vec<String> = action
            .keys
            .iter()
            .map(|key| {
                let text = key.real(banda_look::keys::Mod::default()).text();
                // What the key gives its action, as the launcher's T its kind.
                match &key.args {
                    Some(args) => {
                        let given: Vec<String> = args
                            .values()
                            .map(|value| {
                                value
                                    .as_str()
                                    .map_or_else(|| value.to_string(), str::to_owned)
                            })
                            .collect();
                        format!("{text} for {}", given.join(", "))
                    }
                    None => text,
                }
            })
            .collect();
        line.push_str(&format!(", {}", keys.join(" or ")));
    }
    if let Some(scope) = &action.scope {
        line.push_str(&format!(", `{}`", banda_look::keys::table_of(Some(scope))));
    }
    let takes = action.takes();
    if !takes.is_empty() {
        let args: Vec<String> = takes
            .iter()
            .map(|(name, about)| format!("`{name}` ({about})"))
            .collect();
        line.push_str(&format!("; takes {}", args.join(", ")));
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn each_module_is_named_once() {
        let offers = offers();
        let ids: Vec<&str> = offers.iter().map(|o| o.manifest.id.as_str()).collect();
        let named: std::collections::BTreeSet<&str> = ids.iter().copied().collect();
        assert_eq!(named.len(), ids.len(), "{ids:?}");
        for offer in &offers {
            let Manifest {
                id,
                name,
                about,
                version,
                ..
            } = &offer.manifest;
            assert!(
                !name.is_empty() && !about.is_empty() && !version.is_empty(),
                "{id}'s {MANIFEST}"
            );
        }
    }

    /// The kernel lets a module's SQL reach the legacy prefixes its engine
    /// part tells it, so its manifest says the same (ADR 0085, decision
    /// 12); a module with no engine part has no tables. Each engine part
    /// as the list of Apps builds it.
    #[test]
    fn a_module_s_legacy_prefixes_are_the_ones_its_engine_part_reaches() {
        let parts = crate::apps::on_a_test_host(crate::apps::scanned::parts);
        for offer in offers() {
            let Manifest {
                id,
                legacy_prefixes,
                ..
            } = &offer.manifest;
            let reached: Vec<&str> = (parts.iter())
                .find(|(_, part)| part.name() == id)
                .map(|(_, part)| part.legacy_prefixes().to_vec())
                .unwrap_or_default();
            assert_eq!(legacy_prefixes, &reached, "{id}'s {MANIFEST}");
        }
    }

    /// What the workspaces open as a Group of its own is what the window's
    /// code says, through the files its tests write: a Thread's Pane alone
    /// (ADR 0065, decision 7).
    #[test]
    fn a_threads_pane_alone_opens_as_a_group_of_its_own() {
        assert_eq!(
            grouped_kinds(),
            BTreeSet::from(["agents.thread".to_owned()])
        );
    }

    /// What stands on its Project's workspace is what the window's code
    /// says: a Thread's Pane alone (ADR 0065, decision 9).
    #[test]
    fn a_threads_pane_alone_stands_on_its_projects_workspace() {
        assert_eq!(home_kinds(), BTreeSet::from(["agents.thread".to_owned()]));
    }

    /// A window part that does not read groups nothing, and the engine
    /// still starts; the others' kinds still count.
    #[test]
    fn a_window_part_that_does_not_read_is_left_out_of_the_grouped_kinds() {
        let part = |id, window| Part {
            id,
            manifest: "",
            window: Some(window),
            methods: None,
        };
        let parts = [
            part("broken", "{"),
            part(
                "other",
                r#"{ "panes": [{ "kind": "broken.pane", "grouped": 1 }], "actions": [] }"#,
            ),
            part(
                "a",
                r#"{ "panes": [{ "kind": "a.one", "grouped": true }, { "kind": "a.two" }], "actions": [] }"#,
            ),
        ];
        assert_eq!(grouped_in(&parts), BTreeSet::from(["a.one".to_owned()]));
    }

    #[test]
    fn a_module_owns_the_settings_files_its_crate_describes() {
        let mut said: Vec<(String, Vec<String>)> = offers()
            .into_iter()
            .filter(|offer| !offer.manifest.settings.is_empty())
            .map(|offer| (offer.manifest.id, offer.manifest.settings))
            .collect();
        let mut described: Vec<(String, Vec<String>)> = banda_settings::MODULES
            .iter()
            .map(|(id, files)| {
                let names = files.iter().map(|file| file.name.to_owned()).collect();
                (id.to_string(), names)
            })
            .collect();
        said.sort();
        described.sort();
        assert_eq!(said, described, "each {MANIFEST}'s settings, its crate's");
    }

    #[test]
    fn each_unstable_mark_says_why_and_the_count_holds_its_ceiling() {
        let offers = offers();
        let marks = marks(&offers);
        for (mark, why) in &marks {
            assert!(!why.trim().is_empty(), "{mark}: an unstable mark says why");
        }
        assert_eq!(
            marks.len(),
            CEILING,
            "{} unstable marks, ceiling {CEILING}: lower it as they fall; a PR that raises it says why",
            marks.len()
        );
    }

    #[test]
    fn the_skill_lists_the_modules() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("skill/modules.md");
        let text = topic(&offers());
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &text).unwrap();
            panic!(
                "{} was stale: written; review it and run again",
                path.display()
            );
        }
    }
}
