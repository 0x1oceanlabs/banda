//! `banda modules`: what each module offers, for a Person, an Agent and
//! the skill's reference (ADR 0022, decision 1). A module says it in three
//! places, and this puts them together:
//!
//! - its `module.toml`: its id, name, version, the settings files it owns,
//!   and its unstable marks;
//! - its engine part's `methods!` table, when it has one;
//! - its window part's `defineModule`, when it has one, which the window's
//!   tests copy into `window.json` beside the `module.toml`, as the engine
//!   has no window.

use banda_agents::Agents;
use banda_browser::Browser;
use banda_files::Files as FilesModule;
use banda_git::Git;
use banda_harnesses::HarnessesModule;
use banda_kernel::Method;
use banda_look::keys::{Action, Scope};
use banda_problems::Problems;
use banda_pulls::Pulls;
use banda_sharing::Sharing;
use banda_terminal::Terminals;
use banda_workspaces::Workspaces;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// How many unstable marks the modules hold (ADR 0022, decision 6). A
/// mark more fails the tests until a PR raises this and says why; a mark
/// fewer fails them until it is lowered, so the count only falls.
pub const CEILING: usize = 2;

/// One module's folder: its `module.toml`, and its engine part's methods
/// when it has them; its `window.json` is `banda_settings::window`'s.
struct Files {
    folder: &'static str,
    toml: &'static str,
    methods: Option<fn() -> Vec<Method>>,
}

/// Every module, in the window's order.
const FILES: &[Files] = &[
    Files {
        folder: "agents",
        toml: include_str!("../../modules/agents/module.toml"),
        methods: Some(Agents::method_list),
    },
    Files {
        folder: "harnesses",
        toml: include_str!("../../modules/harnesses/module.toml"),
        methods: Some(HarnessesModule::method_list),
    },
    Files {
        folder: "terminal",
        toml: include_str!("../../modules/terminal/module.toml"),
        methods: Some(Terminals::method_list),
    },
    Files {
        folder: "browser",
        toml: include_str!("../../modules/browser/module.toml"),
        methods: Some(Browser::method_list),
    },
    Files {
        folder: "git",
        toml: include_str!("../../modules/git/module.toml"),
        methods: Some(Git::method_list),
    },
    Files {
        folder: "files",
        toml: include_str!("../../modules/files/module.toml"),
        methods: Some(FilesModule::method_list),
    },
    Files {
        folder: "pulls",
        toml: include_str!("../../modules/pulls/module.toml"),
        methods: Some(Pulls::method_list),
    },
    Files {
        folder: "notifications",
        toml: include_str!("../../modules/notifications/module.toml"),
        methods: None,
    },
    Files {
        folder: "workspaces",
        toml: include_str!("../../modules/workspaces/module.toml"),
        methods: Some(Workspaces::method_list),
    },
    Files {
        folder: "problems",
        toml: include_str!("../../modules/problems/module.toml"),
        methods: Some(Problems::method_list),
    },
    Files {
        folder: "sharing",
        toml: include_str!("../../modules/sharing/module.toml"),
        methods: Some(Sharing::method_list),
    },
    // The window's own actions, the tiling's first (ADR 0071, decision 2),
    // after the modules', as the window lists them.
    Files {
        folder: "window",
        toml: include_str!("../../app/web/module.toml"),
        methods: None,
    },
];

/// What `module.toml` holds: only what no code says.
#[derive(Serialize, Deserialize)]
#[serde(
    rename_all(serialize = "camelCase", deserialize = "kebab-case"),
    deny_unknown_fields
)]
struct Manifest {
    id: String,
    name: String,
    about: String,
    version: String,
    from_banda: bool,
    /// The settings files it owns, in `~/.config/banda`.
    #[serde(default)]
    settings: Vec<String>,
    /// The paths it takes that the contract lacks yet, each with why.
    #[serde(default)]
    unstable: BTreeMap<String, String>,
}

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
    panes: Vec<String>,
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

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Widget {
    id: String,
    about: String,
}

/// Every module, in the window's order. The files are Banda's own, so a
/// wrong one is a bug the tests catch.
pub fn offers() -> Vec<Offer> {
    FILES
        .iter()
        .map(|files| {
            let folder = files.folder;
            Offer {
                manifest: toml::from_str(files.toml)
                    .unwrap_or_else(|error| panic!("modules/{folder}/module.toml: {error}")),
                engine: files.methods.map(|methods| methods()),
                window: banda_settings::window(folder).map(|window| {
                    serde_json::from_str(window)
                        .unwrap_or_else(|error| panic!("modules/{folder}/window.json: {error}"))
                }),
            }
        })
        .collect()
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

    let mut text = String::from(
        "---\n\
         name: modules\n\
         description: Banda's modules - what each is, the settings files it owns, its actions and their keys, and what an Agent may call.\n\
         ---\n\n\
         # Modules\n\n\
         <!-- Written by banda's tests from each module's module.toml and code: do not edit. -->\n\n\
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
                format!("`{}` (the {}{field})", scope.id, scope.title)
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
            .map(|key| key.real(banda_look::keys::Mod::default()).text())
            .collect();
        line.push_str(&format!(", {}", keys.join(" or ")));
    }
    if let Some(scope) = &action.scope {
        line.push_str(&format!(", `{}`", banda_look::keys::table_of(Some(scope))));
    }
    let properties = action
        .args
        .as_ref()
        .and_then(|args| args["properties"].as_object());
    if let Some(properties) = properties {
        let args: Vec<String> = properties
            .iter()
            .map(|(name, arg)| format!("`{name}` ({})", arg["description"].as_str().unwrap_or("")))
            .collect();
        line.push_str(&format!("; takes {}", args.join(", ")));
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Module;
    use std::path::Path;

    #[test]
    fn each_module_is_named_once_and_its_engine_part_by_the_same_id() {
        let offers = offers();
        for (files, offer) in FILES.iter().zip(&offers) {
            let Manifest {
                id,
                name,
                about,
                version,
                ..
            } = &offer.manifest;
            assert_eq!(files.folder, id, "modules/{}/module.toml", files.folder);
            assert!(!name.is_empty() && !about.is_empty() && !version.is_empty());
        }
        let with_engine: Vec<&str> = offers
            .iter()
            .filter(|offer| offer.engine.is_some())
            .map(|offer| offer.manifest.id.as_str())
            .collect();
        let engine = [
            Agents::new(Default::default()).name(),
            HarnessesModule::new(Default::default()).name(),
            Terminals::new().name(),
            Browser::new().name(),
            Git::new().name(),
            FilesModule::new().name(),
            Pulls::new().name(),
            Workspaces::new().name(),
            Problems::new("", "").name(),
            Sharing::new("", "").name(),
        ];
        assert_eq!(with_engine, engine);
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
        assert_eq!(said, described, "each module.toml's settings, its crate's");
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
