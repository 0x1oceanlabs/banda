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
    /// The keys held for every Banda key and the mouse's moves: Alt, or one
    /// or two of Alt, Ctrl and Super, as "Ctrl+Alt" where the desktop holds
    /// Alt. Super is ⌘ on a Mac. Banda's other keys hold Shift or one key
    /// more with it (ADR 0068).
    #[serde(rename = "mod")]
    #[schemars(with = "Option<String>")]
    pub held: Option<Spanned<String>>,
    /// Keys, such as "Alt+Shift+R", each with the id of the action it runs,
    /// as the key sheet lists them, or "none" to free the key for the
    /// Pane. A key is Alt, Ctrl, Super (⌘ on a Mac) and Shift, any of them,
    /// then a letter, a digit, F1 to F24, Left, Right, Up, Down, Return,
    /// Space, Tab, Escape, Backspace, Delete, Insert, Home, End, PageUp,
    /// PageDown or one of [ ] , . / ; ' - = ` \. An action keeps the
    /// window's own keys besides.
    #[schemars(with = "Option<BTreeMap<String, String>>")]
    pub binds: Option<BTreeMap<Spanned<String>, Spanned<String>>>,
}

impl KeysSettings {
    /// Banda's own: Alt is the mod, and no key is bound.
    fn defaults() -> KeysSettings {
        KeysSettings {
            held: Some(Spanned::new(0..0, Mod::default().text())),
            binds: None,
        }
    }

    /// These settings, and `under`'s where these say nothing.
    fn over(self, under: KeysSettings) -> KeysSettings {
        KeysSettings {
            held: self.held.or(under.held),
            binds: self.binds.or(under.binds),
        }
    }
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
    // `super` is a word of Rust's own.
    #[serde(rename = "super")]
    pub sup: bool,
    /// The action's id; none frees the key.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// The key as Banda writes it: `Ctrl+Alt+Shift+R`.
    pub text: String,
    /// Its line in the file, for a problem the window finds.
    pub line: u32,
}

/// The mod (ADR 0068, decision 1): the keys held for every Banda key, one
/// or two of Alt, Ctrl and Super. Super is ⌘ on a Mac.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Mod {
    pub alt: bool,
    pub ctrl: bool,
    // `super` is a word of Rust's own.
    #[serde(rename = "super")]
    pub sup: bool,
}

/// Banda's own mod: Alt, on every system.
impl Default for Mod {
    fn default() -> Self {
        Mod {
            alt: true,
            ctrl: false,
            sup: false,
        }
    }
}

impl Mod {
    /// The mod with one key more (ADR 0068, decision 2): the first of
    /// Ctrl, Super and Alt it does not hold; none for all three.
    pub fn with_more(self) -> Option<Mod> {
        match (self.ctrl, self.sup, self.alt) {
            (false, _, _) => Some(Mod { ctrl: true, ..self }),
            (true, false, _) => Some(Mod { sup: true, ..self }),
            (true, true, false) => Some(Mod { alt: true, ..self }),
            (true, true, true) => None,
        }
    }

    /// The mod as `keys.toml` writes it: `Ctrl+Alt+Super`, in that order.
    pub fn text(self) -> String {
        [
            self.ctrl.then_some("Ctrl"),
            self.alt.then_some("Alt"),
            self.sup.then_some("Super"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("+")
    }
}

/// A key held with another, as `keys.toml` names it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Held {
    Alt,
    Ctrl,
    Shift,
    Super,
}

/// The held key a word names, in any case: `ctrl`, `Control`, `cmd`.
fn held(word: &str) -> Option<Held> {
    match word.trim().to_lowercase().as_str() {
        "alt" | "option" => Some(Held::Alt),
        "ctrl" | "control" => Some(Held::Ctrl),
        "shift" => Some(Held::Shift),
        "super" | "cmd" | "command" | "meta" | "win" | "mod4" => Some(Held::Super),
        _ => None,
    }
}

/// The keys the Person bound, every one written right.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Keys {
    /// The file they come from, for the window to name.
    pub file: String,
    /// The mod in force: the file's, or Alt.
    #[serde(rename = "mod")]
    pub held: Mod,
    /// Its line in the file, for a problem the window finds there, as two
    /// actions on one key; none when the file does not set it.
    #[ts(optional)]
    #[serde(rename = "modLine", skip_serializing_if = "Option::is_none")]
    pub mod_line: Option<u32>,
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
    let (mut alt, mut shift, mut ctrl, mut sup) = (false, false, false, false);
    for one in mods.split('+').filter(|m| !m.trim().is_empty()) {
        match held(one) {
            Some(Held::Alt) => alt = true,
            Some(Held::Shift) => shift = true,
            Some(Held::Ctrl) => ctrl = true,
            Some(Held::Super) => sup = true,
            None => return Err(format!("{:?} is not Alt, Ctrl, Super or Shift", one.trim())),
        }
    }
    let (code, name) =
        code_of(name.trim()).ok_or_else(|| format!("{name:?} is not a key Banda knows"))?;
    if !alt && !ctrl && !sup && !code.starts_with('F') {
        return Err(format!(
            "{text:?} alone would be typed: hold Alt, Ctrl or Super with it"
        ));
    }
    let text = text_of(Mod { alt, ctrl, sup }, shift, &name);
    Ok(Bind {
        code,
        alt,
        shift,
        ctrl,
        sup,
        action: None,
        text,
        line: 0,
    })
}

/// A key as Banda writes it: its mod's keys in the order Ctrl, Alt,
/// Super, then Shift, then its name.
fn text_of(held: Mod, shift: bool, name: &str) -> String {
    let mut parts = vec![held.text()];
    if shift {
        parts.push("Shift".to_owned());
    }
    parts.push(name.to_owned());
    parts.retain(|part| !part.is_empty());
    parts.join("+")
}

fn is_false(on: &bool) -> bool {
    !on
}

/// A key as an action declares it (ADR 0068, decision 2; ADR 0071,
/// decision 2): held with the mod, with Shift or one key more; or with
/// plain mods, as an App's own, `primary` for Ctrl or ⌘ on a Mac.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct Declared {
    pub code: String,
    // `mod` and `super` are words of Rust's own.
    #[serde(rename = "mod", skip_serializing_if = "is_false")]
    pub held: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub more: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub shift: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub alt: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub ctrl: bool,
    #[serde(rename = "super", skip_serializing_if = "is_false")]
    pub sup: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub primary: bool,
}

impl Declared {
    /// The key as it is pressed with the mod `held`, as the window's
    /// `realKey` makes it: held with the mod, it holds the mod's keys, and
    /// one key more when it says so; else it is as it is written.
    pub fn real(&self, held: Mod) -> Declared {
        let mods = if self.more {
            held.with_more()
        } else if self.held {
            Some(held)
        } else {
            None
        };
        match mods {
            Some(mods) => Declared {
                code: self.code.clone(),
                shift: self.shift,
                alt: mods.alt,
                ctrl: mods.ctrl,
                sup: mods.sup,
                ..Declared::default()
            },
            None => self.clone(),
        }
    }

    /// The key as Banda writes it, `Ctrl+Alt+Shift+R`: a key held with the
    /// mod, once it is made real.
    pub fn text(&self) -> String {
        let held = Mod {
            alt: self.alt,
            ctrl: self.ctrl || self.primary,
            sup: self.sup,
        };
        let name = code_of(&self.code).map_or_else(|| self.code.clone(), |(_, name)| name);
        text_of(held, self.shift, &name)
    }
}

/// An action as a manifest declares it (ADR 0071, decision 2), the
/// window's or an App's.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub id: String,
    pub title: String,
    pub section: String,
    pub keys: Vec<Declared>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    /// Run by its id alone: no key sheet or menu lists it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub unlisted: bool,
    /// What it takes, as a JSON Schema, as the engine's tools give theirs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
}

/// The mod as written, one or two of Alt, Ctrl and Super; or why it
/// cannot be one (ADR 0068, decision 1). On a Mac, Super is ⌘.
pub fn mod_of(text: &str, mac: bool) -> Result<Mod, String> {
    let (mut alt, mut ctrl, mut sup) = (false, false, false);
    for one in text.split('+') {
        match held(one) {
            Some(Held::Alt) => alt = true,
            Some(Held::Ctrl) => ctrl = true,
            Some(Held::Super) => sup = true,
            Some(Held::Shift) => {
                return Err(
                    "Shift is Banda's second level: the mod is Alt, Ctrl or Super".to_owned(),
                );
            }
            None if one.trim().is_empty() => {
                return Err("one or two of Alt, Ctrl and Super, as \"Ctrl+Alt\"".to_owned());
            }
            None => return Err(format!("{:?} is not Alt, Ctrl or Super", one.trim())),
        }
    }
    match (alt, ctrl, sup) {
        (true, true, true) => Err("all three leave no key for Banda's third level: one or two".to_owned()),
        (false, true, false) => Err(
            "Ctrl alone holds the terminal's and the fields' keys, as Ctrl+C and Ctrl+W: add Alt or Super".to_owned(),
        ),
        (false, false, true) if mac => Err("⌘ alone holds copy, paste, close and quit: add ⌃ or ⌥".to_owned()),
        _ => Ok(Mod { alt, ctrl, sup }),
    }
}

/// Reads a `keys.toml`, as [`crate::read`] reads a file.
pub fn read_keys(
    path: &Path,
    text: &str,
    problems: &mut Vec<Problem>,
) -> Option<(KeysSettings, Keys)> {
    let mut settings: KeysSettings = crate::read(path, text, problems)?;
    let mut keys = Keys {
        file: path.display().to_string(),
        ..Keys::default()
    };
    // A mod written wrong is named and taken out, so Alt holds.
    if let Some(written) = settings.held.take() {
        match mod_of(written.get_ref(), cfg!(target_os = "macos")) {
            Ok(held) => {
                keys.held = held;
                keys.mod_line = Some(crate::line_at(text, written.span().start));
                settings.held = Some(written);
            }
            Err(message) => problems.push(Problem::at(path, text, Some(written.span()), message)),
        }
    }
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
    keys.binds = binds;
    Some((settings, keys))
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
    let (mine, keys) = mine_file
        .as_ref()
        .and_then(|(path, text)| read_keys(path, text, problems))
        .unwrap_or_default();
    let defaults = KeysSettings::defaults();
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("file", &mine, mine_file.as_ref()),
    ];
    let keyed = keyed::keyed(&mine.over(defaults), &layers);
    let keys = Keys {
        file: file.display().to_string(),
        ..keys
    };
    (keys, keyed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> (Vec<Bind>, Vec<Problem>) {
        let mut problems = Vec::new();
        let (_, keys) = read_keys(Path::new("keys.toml"), text, &mut problems).unwrap_or_default();
        (keys.binds, problems)
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
        assert_eq!(ok("Super+Shift+R"), is("KeyR", "Super+Shift+R"));
        assert_eq!(ok("cmd+alt+ctrl+r"), is("KeyR", "Ctrl+Alt+Super+R"));
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
            "[binds]\n\"Alt+M\" = \"column.maximize\"\n\"Alt+F\" = \"none\"\n\"Hyper+X\" = \"pane.close\"\n\"alt+m\" = \"pane.close\"\n",
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
    fn the_mod_is_one_or_two_of_alt_ctrl_and_super() {
        let held = |alt, ctrl, sup| Mod { alt, ctrl, sup };
        let ok = |text: &str| mod_of(text, false).unwrap();
        assert_eq!(ok("Alt"), Mod::default());
        assert_eq!(ok("ctrl+alt"), held(true, true, false));
        assert_eq!(ok("Alt+Super"), held(true, false, true));
        assert_eq!(ok("Cmd+Option"), held(true, false, true));
        assert_eq!(ok("Super"), held(false, false, true));
        let no = |text: &str, mac: bool| mod_of(text, mac).unwrap_err();
        assert!(no("Shift+Alt", false).contains("second level"));
        assert!(no("Ctrl+Alt+Super", false).contains("all three"));
        assert!(no("Ctrl", false).contains("Ctrl alone"));
        assert!(no("Super", true).contains("⌘ alone"));
        assert!(no("Hyper", false).contains("Hyper"));
        assert!(no("", false).contains("one or two"));
    }

    #[test]
    fn a_file_sets_the_mod_at_its_line_or_names_what_is_wrong() {
        let read = |text: &str| {
            let mut problems = Vec::new();
            let (_, keys) = read_keys(Path::new("keys.toml"), text, &mut problems).unwrap();
            (keys.held, keys.mod_line, problems)
        };
        let (held, line, problems) = read("# Alt is the desktop's\nmod = \"Ctrl+Alt\"\n");
        assert_eq!(
            (held.alt, held.ctrl, held.sup, line),
            (true, true, false, Some(2))
        );
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(read("[binds]\n").0, Mod::default());
        let (held, line, problems) = read("mod = \"Shift\"\n");
        assert_eq!((held, line), (Mod::default(), None));
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].line, Some(1));
    }

    #[test]
    fn a_declared_key_is_pressed_with_the_mod_at_its_level() {
        let alt = Mod::default();
        let ctrl_alt = Mod {
            alt: true,
            ctrl: true,
            sup: false,
        };
        let key = |code: &str, held, more, shift| Declared {
            code: code.to_owned(),
            held,
            more,
            shift,
            ..Declared::default()
        };
        let text = |key: Declared, held| key.real(held).text();
        assert_eq!(text(key("KeyR", true, false, false), alt), "Alt+R");
        assert_eq!(
            text(key("KeyR", true, false, true), ctrl_alt),
            "Ctrl+Alt+Shift+R"
        );
        assert_eq!(
            text(key("ArrowRight", true, true, false), alt),
            "Ctrl+Alt+Right"
        );
        assert_eq!(
            text(key("ArrowRight", true, true, false), ctrl_alt),
            "Ctrl+Alt+Super+Right"
        );
        assert_eq!(text(key("Enter", true, false, false), alt), "Alt+Return");
        let tab = Declared {
            code: "KeyT".to_owned(),
            primary: true,
            ..Declared::default()
        };
        assert_eq!(text(tab, ctrl_alt), "Ctrl+T");
        let all = Mod {
            alt: true,
            ctrl: true,
            sup: true,
        };
        assert_eq!(all.with_more(), None);
    }

    #[test]
    fn the_template_binds_nothing() {
        let (binds, problems) = read(TEMPLATE);
        assert!(binds.is_empty());
        assert!(problems.is_empty(), "{problems:?}");
    }
}
