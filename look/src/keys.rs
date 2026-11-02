//! Banda's keys (ADR 0005, decision 11): the Person's
//! `~/.config/banda/keys.toml`, over the window's own, as Hyprland's and
//! niri's binds. Each line is a key and the action it runs, by the action's
//! id, which the key sheet (Alt+K) shows; `"none"` frees a key, so it goes
//! to the Pane, as Alt+F to a shell.
//!
//! It is this machine's, as the look is, so `banda look` resolves it with
//! the look and watches it. This checks how a key is written; the window,
//! which holds the actions, checks their ids and names what it does not run.

use crate::Problem;
use crate::keyed::{self, Keyed, Layer};
use crate::theme::Places;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use toml::Spanned;
use ts_rs::TS;

/// The file as Banda writes it first.
pub const TEMPLATE: &str = include_str!("../keys.toml");

/// What a key bound to it runs: nothing, so the key is the Pane's.
pub const NONE: &str = "none";

/// The one chord no file binds (ADR 0005, decision 11): the window's
/// `keys.reset` brings its own keys back until `keys.toml` changes, and
/// opens the settings at Keys, so keys bound away can always be mended.
/// The window holds it as `RESET_KEY` (`app/web/src/actions/actions.ts`).
pub const RESET: &str = "Ctrl+Alt+Shift+K";

/// Banda's keys over the window's own. Every key is optional.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct KeysSettings {
    /// Keys, such as "Alt+Shift+R", each with the id of the action it runs,
    /// as Alt+K lists them, or "none" to free the key for the Pane. A key
    /// is Alt, Ctrl and Shift, any of them, then a letter, a digit, F1 to
    /// F24, Left, Right, Up, Down, Return, Space, Tab, Escape, Backspace,
    /// Delete, Insert, Home, End, PageUp, PageDown or one of [ ] , . / ; '
    /// - = ` \. An action keeps the window's own keys besides.
    #[schemars(with = "Option<BTreeMap<String, String>>")]
    pub binds: Option<BTreeMap<Spanned<String>, Spanned<String>>>,
}

/// One key the Person bound: where, as a `KeyboardEvent.code` and its
/// mods, and to what.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Bind {
    pub code: String,
    pub alt: bool,
    pub shift: bool,
    pub ctrl: bool,
    /// The action's id; none frees the key.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// The key as Banda writes it: `Ctrl+Alt+Shift+R`.
    pub text: String,
    /// Its line in the file, for a problem the window finds.
    pub line: u32,
}

/// The keys the Person bound, every one written right.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Keys {
    /// The file they come from, for the window to name.
    pub file: String,
    pub binds: Vec<Bind>,
}

/// Keys by their `KeyboardEvent.code`, and the names they are written
/// by, the one Banda writes first. Letters, digits and F1 to F24 go by
/// their own names.
const NAMED: &[(&str, &[&str])] = &[
    ("ArrowLeft", &["Left"]),
    ("ArrowRight", &["Right"]),
    ("ArrowUp", &["Up"]),
    ("ArrowDown", &["Down"]),
    ("Enter", &["Return", "Enter"]),
    ("Space", &["Space"]),
    ("Tab", &["Tab"]),
    ("Escape", &["Escape", "Esc"]),
    ("Backspace", &["Backspace"]),
    ("Delete", &["Delete"]),
    ("Insert", &["Insert"]),
    ("Home", &["Home"]),
    ("End", &["End"]),
    ("PageUp", &["PageUp"]),
    ("PageDown", &["PageDown"]),
    ("BracketLeft", &["["]),
    ("BracketRight", &["]"]),
    ("Comma", &[","]),
    ("Period", &["."]),
    ("Slash", &["/"]),
    ("Semicolon", &[";"]),
    ("Quote", &["'"]),
    ("Backquote", &["`"]),
    ("Minus", &["-"]),
    ("Equal", &["="]),
    ("Backslash", &["\\"]),
    ("IntlBackslash", &["<"]),
];

/// A key's `KeyboardEvent.code`, and its name as Banda writes it, from how
/// the Person writes it: `R`, `5`, `F2`, `Left`, `[`, or the code itself,
/// `KeyR`, `BracketLeft`.
fn code_of(name: &str) -> Option<(String, String)> {
    let lower = name.to_lowercase();
    let bare = lower
        .strip_prefix("key")
        .or(lower.strip_prefix("digit"))
        .filter(|rest| rest.len() == 1)
        .unwrap_or(&lower);
    let mut chars = bare.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        let c = c.to_ascii_uppercase();
        if c.is_ascii_alphabetic() {
            return Some((format!("Key{c}"), c.to_string()));
        }
        if c.is_ascii_digit() {
            return Some((format!("Digit{c}"), c.to_string()));
        }
    }
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok())
        && (1..=24).contains(&n)
    {
        return Some((format!("F{n}"), format!("F{n}")));
    }
    NAMED
        .iter()
        .find(|(code, names)| {
            code.to_lowercase() == lower || names.iter().any(|n| n.to_lowercase() == lower)
        })
        .map(|(code, names)| ((*code).to_owned(), names[0].to_owned()))
}

/// A key as written: its code, its mods and its name as Banda writes it,
/// bound to nothing yet; or what is wrong with it.
/// The key `text` names, as Banda writes it: `Alt+K` for `alt+k`; none
/// when it names no key.
pub fn canonical(text: &str) -> Option<String> {
    parse(text).ok().map(|bind| bind.text)
}

/// A key as a file binds it: any but [`RESET`].
fn parse(text: &str) -> Result<Bind, String> {
    let bind = chord(text)?;
    if bind.text == RESET {
        return Err(format!(
            "{RESET} brings the window's own keys back, so no file binds it"
        ));
    }
    Ok(bind)
}

/// Any key, as it is written.
fn chord(text: &str) -> Result<Bind, String> {
    let text = text.trim();
    let (mods, name) = text.rsplit_once('+').unwrap_or(("", text));
    let (mut alt, mut shift, mut ctrl) = (false, false, false);
    for one in mods.split('+').filter(|m| !m.trim().is_empty()) {
        match one.trim().to_lowercase().as_str() {
            "alt" => alt = true,
            "shift" => shift = true,
            "ctrl" | "control" => ctrl = true,
            "super" | "mod4" | "meta" | "win" | "cmd" => {
                return Err(
                    "Super is the desktop's: Banda's keys hold Alt, Ctrl and Shift".to_owned(),
                );
            }
            other => return Err(format!("{other:?} is not Alt, Ctrl or Shift")),
        }
    }
    let (code, name) =
        code_of(name.trim()).ok_or_else(|| format!("{name:?} is not a key Banda knows"))?;
    if !alt && !ctrl && !code.starts_with('F') {
        return Err(format!(
            "{text:?} alone would be typed: hold Alt or Ctrl with it"
        ));
    }
    let text = [
        ctrl.then_some("Ctrl"),
        alt.then_some("Alt"),
        shift.then_some("Shift"),
        Some(name.as_str()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("+");
    Ok(Bind {
        code,
        alt,
        shift,
        ctrl,
        action: None,
        text,
        line: 0,
    })
}

/// Reads a `keys.toml`, as [`crate::read`] reads a file.
pub fn read_keys(
    path: &Path,
    text: &str,
    problems: &mut Vec<Problem>,
) -> Option<(KeysSettings, Vec<Bind>)> {
    let settings: KeysSettings = crate::read(path, text, problems)?;
    let mut lines: Vec<_> = settings.binds.iter().flatten().collect();
    lines.sort_by_key(|(key, _)| key.span().start);
    let mut binds: Vec<Bind> = Vec::new();
    for (key, action) in lines {
        let wrong = |span, message| Problem::at(path, text, Some(span), message);
        let bind = match parse(key.get_ref()) {
            Ok(parsed) => parsed,
            Err(message) => {
                problems.push(wrong(key.span(), message));
                continue;
            }
        };
        if let Some(twice) = binds.iter().find(|other| other.text == bind.text) {
            problems.push(wrong(
                key.span(),
                format!("{} is bound on line {} already", bind.text, twice.line),
            ));
            continue;
        }
        let id = action.get_ref().trim();
        if id.is_empty() {
            problems.push(wrong(
                action.span(),
                "an action's id, or \"none\"".to_owned(),
            ));
            continue;
        }
        binds.push(Bind {
            action: (id != NONE).then(|| id.to_owned()),
            line: crate::line_at(text, key.span().start),
            ..bind
        });
    }
    Some((settings, binds))
}

/// The Person's keys on this machine; `keys.toml` is watched.
pub fn resolve(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> (Keys, Keyed) {
    let file = places.keys_file();
    watched.push(file.clone());
    let mine_file = std::fs::read_to_string(&file)
        .ok()
        .map(|text| (file.clone(), text));
    let (mine, binds) = mine_file
        .as_ref()
        .and_then(|(path, text)| read_keys(path, text, problems))
        .unwrap_or_default();
    let defaults = KeysSettings::default();
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("file", &mine, mine_file.as_ref()),
    ];
    let keyed = keyed::keyed(&mine, &layers);
    let keys = Keys {
        file: file.display().to_string(),
        binds,
    };
    (keys, keyed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> (Vec<Bind>, Vec<Problem>) {
        let mut problems = Vec::new();
        let (_, binds) = read_keys(Path::new("keys.toml"), text, &mut problems).unwrap_or_default();
        (binds, problems)
    }

    #[test]
    fn keys_are_written_as_people_write_them() {
        let ok = |text: &str| {
            let bind = parse(text).unwrap();
            (bind.code, bind.text)
        };
        let is = |code: &str, text: &str| (code.to_owned(), text.to_owned());
        assert_eq!(ok("Alt+R"), is("KeyR", "Alt+R"));
        assert_eq!(ok("alt+shift+r"), is("KeyR", "Alt+Shift+R"));
        assert_eq!(ok("Shift+Alt+Ctrl+5"), is("Digit5", "Ctrl+Alt+Shift+5"));
        assert_eq!(ok("Alt+["), is("BracketLeft", "Alt+["));
        assert_eq!(ok("Alt+BracketRight"), is("BracketRight", "Alt+]"));
        assert_eq!(ok("Alt+left"), is("ArrowLeft", "Alt+Left"));
        assert_eq!(ok("Alt+Enter"), is("Enter", "Alt+Return"));
        assert_eq!(ok("Alt+-"), is("Minus", "Alt+-"));
        assert_eq!(ok("Ctrl+KeyK"), is("KeyK", "Ctrl+K"));
        assert_eq!(ok("F5"), is("F5", "F5"));
        assert!(parse("Super+R").unwrap_err().contains("desktop"));
        assert!(parse("Hyper+R").is_err());
        assert!(parse("Alt+Banana").unwrap_err().contains("Banana"));
        assert!(parse("Shift+R").unwrap_err().contains("typed"));
        assert!(
            parse("shift+ctrl+alt+k")
                .unwrap_err()
                .contains("no file binds")
        );
        let reset = chord(RESET).unwrap();
        assert_eq!(
            (reset.code.as_str(), reset.ctrl, reset.alt, reset.shift),
            ("KeyK", true, true, true)
        );
    }

    #[test]
    fn a_file_binds_and_frees_keys_and_names_what_is_wrong() {
        let (binds, problems) = read(
            "[binds]\n\"Alt+M\" = \"column.maximize\"\n\"Alt+F\" = \"none\"\n\"Super+X\" = \"pane.close\"\n\"alt+m\" = \"pane.close\"\n",
        );
        assert_eq!(binds.len(), 2);
        assert_eq!(binds[0].action.as_deref(), Some("column.maximize"));
        assert_eq!(
            (binds[0].code.as_str(), binds[0].alt, binds[0].line),
            ("KeyM", true, 2)
        );
        assert_eq!(
            (binds[1].text.as_str(), binds[1].action.as_deref()),
            ("Alt+F", None)
        );
        let lines: Vec<_> = problems.iter().map(|p| p.line).collect();
        assert_eq!(lines, [Some(4), Some(5)]);
        assert!(problems[1].message.contains("line 2"));
    }

    #[test]
    fn the_template_binds_nothing() {
        let (binds, problems) = read(TEMPLATE);
        assert!(binds.is_empty());
        assert!(problems.is_empty(), "{problems:?}");
    }
}
