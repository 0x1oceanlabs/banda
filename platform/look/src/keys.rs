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
use std::ops::Range;
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
/// The window holds it as `RESET_KEY` (`client/web/src/actions/actions.ts`).
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
    /// window's own keys besides. A line may give the action what it
    /// takes: `{ action = "browser.open", args = { address = "…" } }`.
    #[schemars(with = "Option<BTreeMap<String, Bound>>")]
    pub binds: Option<BTreeMap<Spanned<String>, Spanned<Bound>>>,
}

/// What a key of `[binds]` holds (ADR 0071, decision 3): what a line
/// runs, or a scope's own table, `[binds.composer]`, whose keys work while
/// the focus is in that scope.
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum Bound {
    Line(Line),
    Scope(BTreeMap<String, Line>),
}

/// What a line runs: an action's id, `"none"`, or an action with what it
/// takes.
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum Line {
    Id(String),
    Call(Call),
}

/// An action with what it takes, as the key sheet lists its args.
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Call {
    pub action: String,
    #[serde(default)]
    pub args: Args,
}

/// What a line gives its action, by name.
pub type Args = serde_json::Map<String, serde_json::Value>;

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
    /// What the line gives its action (ADR 0071, decision 3).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Args>,
    /// The scope whose table holds it, `[binds.composer]`; none for
    /// `[binds]`, the window's.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
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

impl Bind {
    /// The keys of a mod it holds: Alt, Ctrl and Super, but Shift.
    pub fn held(&self) -> Mod {
        Mod {
            alt: self.alt,
            ctrl: self.ctrl,
            sup: self.sup,
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
    /// Each action's keys in force (ADR 0071, decision 4): Banda's with
    /// the mod, then the Person's lines over them.
    pub actions: Vec<ActionKeys>,
}

/// An action's keys in force, by its id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct ActionKeys {
    pub id: String,
    pub keys: Vec<KeyInForce>,
}

/// A key as it is pressed, and what it gives its action: the args and
/// the line of a key the Person bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct KeyInForce {
    pub code: String,
    pub alt: bool,
    pub ctrl: bool,
    #[serde(rename = "super")]
    pub sup: bool,
    pub shift: bool,
    /// Ctrl, or ⌘ on a Mac, as an App's own key says.
    pub primary: bool,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Args>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
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

/// Whether a key is held with no mod, so the window's fields would type
/// it; an F key is typed nowhere.
fn alone(bind: &Bind) -> bool {
    !bind.alt && !bind.ctrl && !bind.sup && !bind.code.starts_with('F')
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
    let text = text_of(Mod { alt, ctrl, sup }, shift, &name);
    Ok(Bind {
        code,
        alt,
        shift,
        ctrl,
        sup,
        action: None,
        args: None,
        scope: None,
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

/// A key's name as Banda writes it, by its `KeyboardEvent.code`: `R`,
/// `Left`, `Return`.
fn name_of(code: &str) -> String {
    code_of(code).map_or_else(|| code.to_owned(), |(_, name)| name)
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
    /// What it gives its action, as a line of keys.toml's args: the
    /// launcher's `T` opens a terminal (ADR 0071, decision 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Args>,
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
                args: self.args.clone(),
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
        text_of(held, self.shift, &name_of(&self.code))
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
    /// Where its key works (ADR 0071, decision 1); none for the window's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// What it takes, as a JSON Schema, as the engine's tools give theirs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
    /// Its key acts as the Person (ADR 0083, decision 3), so only the
    /// Person binds it.
    #[serde(
        default,
        rename = "runsAsPerson",
        skip_serializing_if = "Option::is_none"
    )]
    pub runs_as_person: Option<RunsAsPerson>,
}

/// When an action's key acts as the Person (ADR 0083, decision 3): it
/// sends words to an Agent, or runs or opens something outside Banda.
/// Moving Panes or showing a file in Banda does not; the window shows what
/// they do.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum RunsAsPerson {
    /// `true`: whatever it is given, as `file.outside`. `false` is as if
    /// it were not set.
    Always(bool),
    /// Given any of these args, as `thread.new` given `ask`.
    Given(Vec<String>),
}

impl Action {
    /// Whether its key, given `args`, acts as the Person (ADR 0083,
    /// decision 3): none when it does not; else the args given that make
    /// it so, none of them when it does whatever it is given.
    pub fn as_person<'a>(&'a self, args: Option<&'a Args>) -> Option<Vec<&'a str>> {
        match self.runs_as_person.as_ref()? {
            RunsAsPerson::Always(always) => always.then(Vec::new),
            RunsAsPerson::Given(names) => {
                let given: Vec<&str> = (args.into_iter().flat_map(|args| args.keys()))
                    .filter(|name| names.contains(name))
                    .map(String::as_str)
                    .collect();
                (!given.is_empty()).then_some(given)
            }
        }
    }

    /// What it takes, from its JSON Schema: each arg by its name, and what
    /// it is, in the order it declares them.
    pub fn takes(&self) -> Vec<(String, String)> {
        let schema = self.args.as_ref();
        let properties = schema.and_then(|schema| schema["properties"].as_object());
        properties
            .into_iter()
            .flatten()
            .map(|(name, arg)| {
                let about = arg["description"].as_str().unwrap_or_default();
                (name.clone(), about.to_owned())
            })
            .collect()
    }
}

/// Where a key works besides the whole window (ADR 0071, decision 1): a
/// kind of Pane, or a field in one, where a key that types is the field's.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub field: bool,
    /// Its keys work with the mod still held too, when no key of the
    /// window's takes the press: the launcher's letters after Alt+N (ADR
    /// 0025, decision 4).
    #[serde(default, rename = "modHeld", skip_serializing_if = "is_false")]
    pub mod_held: bool,
}

/// What the manifests declare: every action there is, and the scopes
/// their keys work in.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Manifests {
    pub actions: Vec<Action>,
    #[serde(default)]
    pub scopes: Vec<Scope>,
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
    let mut tables: Vec<_> = settings.binds.iter().flatten().collect();
    tables.sort_by_key(|(key, _)| key.span().start);
    let mut binds: Vec<Bind> = Vec::new();
    for (key, value) in tables {
        match value.get_ref() {
            Bound::Line(line) => {
                let place = (key.get_ref().as_str(), Some(key.span()));
                bind_line(&mut binds, problems, (path, text), place, line, None);
            }
            // A scope's table: its keys, each on its own line, read again
            // for where each is, as serde keeps no place in an untagged one.
            Bound::Scope(table) => {
                let scope = key.get_ref();
                for (name, span) in keyed::spans_in(text, &["binds", scope]) {
                    if let Some(line) = table.get(&name) {
                        let place = (name.as_str(), Some(span));
                        bind_line(&mut binds, problems, (path, text), place, line, Some(scope));
                    }
                }
            }
        }
    }
    keys.binds = binds;
    Some((settings, keys))
}

/// Takes one line of keys.toml, `key` = `line`, into `binds`, or names
/// what is wrong with it where the key is.
fn bind_line(
    binds: &mut Vec<Bind>,
    problems: &mut Vec<Problem>,
    (path, text): (&Path, &str),
    (key, span): (&str, Option<Range<usize>>),
    line: &Line,
    scope: Option<&str>,
) {
    let line_no = span
        .as_ref()
        .map_or(0, |span| crate::line_at(text, span.start));
    let wrong = |message: String| Problem::at(path, text, span.clone(), message);
    let bind = match parse(key) {
        Ok(parsed) => parsed,
        Err(message) => return problems.push(wrong(message)),
    };
    // A scope's table may bind one, as Return in the composer's.
    if scope.is_none() && alone(&bind) {
        return problems.push(wrong(format!(
            "{:?} alone would be typed: hold Alt, Ctrl or Super with it",
            key.trim()
        )));
    }
    let twice = binds
        .iter()
        .find(|other| other.text == bind.text && other.scope.as_deref() == scope);
    if let Some(twice) = twice {
        return problems.push(wrong(format!(
            "{} is bound on line {} already",
            bind.text, twice.line
        )));
    }
    let (id, args) = match line {
        Line::Id(id) => (id.trim(), None),
        Line::Call(call) => (call.action.trim(), Some(call.args.clone())),
    };
    if id.is_empty() {
        return problems.push(wrong("an action's id, or \"none\"".to_owned()));
    }
    if id == NONE && args.is_some() {
        return problems.push(wrong("\"none\" takes no args".to_owned()));
    }
    binds.push(Bind {
        action: (id != NONE).then(|| id.to_owned()),
        args,
        scope: scope.map(str::to_owned),
        line: line_no,
        ..bind
    });
}

/// The Person's keys on this machine; `keys.toml` is watched.
pub fn resolve(
    places: &Places,
    manifests: &Manifests,
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
    let mut keys = Keys {
        file: file.display().to_string(),
        ..keys
    };
    keys.actions = in_force(manifests, &keys, problems);
    (keys, keyed)
}

/// The id an action has now, for one it had before, which a line may
/// still name for one stable release (ADR 0069: Settled is the archive,
/// and a Space is a Project; ADR 0098, decision 28: Snooze is Later).
fn renamed(id: &str) -> &str {
    match id {
        "sidebar.settle" => "sidebar.archive",
        "space.add" => "project.add",
        "thread.snooze" => "thread.later",
        "sidebar.snooze-picker" => "sidebar.later-picker",
        _ => id,
    }
}

/// The action a line of keys.toml runs by `id`, and where it is among the
/// manifests' actions: by its id now or one it had before, spaces around
/// it aside. The look finds a line's action by it alone, so what checks a
/// line finds the action the line runs.
pub fn action_named<'a>(manifests: &'a Manifests, id: &str) -> Option<(usize, &'a Action)> {
    let id = renamed(id.trim());
    (manifests.actions.iter().enumerate()).find(|(_, action)| action.id == id)
}

/// Each action's keys in force (ADR 0071, decision 4): Banda's with the
/// mod, the first to take a key keeping it, and two actions on one named
/// at the mod's line; then the Person's lines, a key bound leaving the
/// action that had it. A line is named at its line when it names no
/// action, gives args its action does not take, or frees no key.
pub fn in_force(
    manifests: &Manifests,
    keys: &Keys,
    problems: &mut Vec<Problem>,
) -> Vec<ActionKeys> {
    let actions = &manifests.actions;
    let at = |line, message: String| Problem {
        line,
        ..Problem::whole(Path::new(&keys.file), message)
    };
    // Each key's scope and text, and the action that has it: a key may be
    // one action's in the window and another's in a scope.
    let mut taken: BTreeMap<(Option<&str>, String), usize> = BTreeMap::new();
    let mut out: Vec<ActionKeys> = Vec::with_capacity(actions.len());
    for (index, action) in actions.iter().enumerate() {
        let mut own = Vec::new();
        for declared in &action.keys {
            let real = declared.real(keys.held);
            let text = real.text();
            let place = (action.scope.as_deref(), text.clone());
            if let Some(&first) = taken.get(&place) {
                let first = &actions[first].title;
                problems.push(at(
                    keys.mod_line,
                    format!(
                        "{text} is “{first}” and “{}” with this mod; “{first}” keeps it",
                        action.title
                    ),
                ));
                continue;
            }
            taken.insert(place, index);
            own.push(KeyInForce::from(&real));
        }
        out.push(ActionKeys {
            id: action.id.clone(),
            keys: own,
        });
    }
    for bind in &keys.binds {
        let say = |message: String| at(Some(bind.line), format!("{}: {message}", bind.text));
        let scope = bind.scope.as_deref();
        if let Some(old) = bind.action.as_deref()
            && renamed(old) != old
        {
            problems.push(say(format!("{old} is called {} now", renamed(old))));
        }
        let index = match bound(manifests, bind) {
            Ok(index) => index,
            Err(message) => {
                problems.push(say(message));
                continue;
            }
        };
        // A key bound, or freed, leaves the action that had it there.
        match taken.remove(&(scope, bind.text.clone())) {
            Some(had) => out[had].keys.retain(|key| key.text() != bind.text),
            None if index.is_none() => {
                problems.push(say(
                    "no Banda key is here with this mod, so it frees nothing".to_owned(),
                ));
            }
            None => {}
        }
        let Some(index) = index else {
            continue;
        };
        taken.insert((scope, bind.text.clone()), index);
        out[index].keys.push(KeyInForce {
            code: bind.code.clone(),
            alt: bind.alt,
            ctrl: bind.ctrl,
            sup: bind.sup,
            shift: bind.shift,
            primary: false,
            args: bind.args.clone(),
            line: Some(bind.line),
        });
    }
    out
}

/// The action a line binds its key to, by its index in the manifests,
/// none for a key freed; or what is wrong with the line: a scope or an
/// action Banda has not, a key the scope's field would type, an action
/// of another table, or args it does not take.
fn bound(manifests: &Manifests, bind: &Bind) -> Result<Option<usize>, String> {
    let scope = bind.scope.as_deref();
    if let Some(id) = scope {
        let declared = manifests.scopes.iter().find(|each| each.id == id);
        let Some(declared) = declared else {
            let ids: Vec<&str> = manifests
                .scopes
                .iter()
                .map(|each| each.id.as_str())
                .collect();
            return Err(format!(
                "Banda has no scope {id}; its scopes are {}",
                ids.join(", ")
            ));
        };
        if declared.field && types(bind) {
            let title = declared.title.to_lowercase();
            return Err(format!("it would be typed in the {title}"));
        }
    }
    let Some(id) = bind.action.as_deref() else {
        return Ok(None);
    };
    let Some((index, action)) = action_named(manifests, id) else {
        let id = renamed(id.trim());
        return Err(format!(
            "Banda has no action {id}; the key sheet lists them"
        ));
    };
    if action.scope.as_deref() != scope {
        let table = table_of(action.scope.as_deref());
        return Err(format!("{} works in {table}: bind it there", action.id));
    }
    match bind.args.as_ref().and_then(|args| wrong_args(action, args)) {
        Some(wrong) => Err(wrong),
        None => Ok(Some(index)),
    }
}

/// The table of keys.toml that binds a scope's keys, `[binds.composer]`,
/// or the window's, `[binds]` (ADR 0071, decision 1).
pub fn table_of(scope: Option<&str>) -> String {
    scope.map_or("[binds]".to_owned(), |scope| format!("[binds.{scope}]"))
}

/// The line of keys.toml that binds `key`, as `banda settings` takes it:
/// `binds."Alt+M"`, or `binds.composer."Return"` in a scope's table.
pub fn path_of(key: &str, scope: Option<&str>) -> String {
    let key = toml_edit::Value::from(key).to_string();
    match scope {
        Some(scope) => format!("binds.{scope}.{key}"),
        None => format!("binds.{key}"),
    }
}

/// A line of the Person's moved with a new mod (ADR 0068, decision 5): to
/// its new key, or out, for a `none`, whose key is no longer Banda's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Move<'a> {
    pub bind: &'a Bind,
    pub to: Option<String>,
}

/// The Person's lines that hold the mod `from`, alone or with one key
/// more, and where each goes with the mod `to`, at the same level: as the
/// window's `movesOf` has it.
pub fn moves(binds: &[Bind], from: Mod, to: Mod) -> Vec<Move<'_>> {
    if from == to {
        return Vec::new();
    }
    binds
        .iter()
        .filter_map(|bind| {
            let more = if bind.held() == from {
                false
            } else if from.with_more() == Some(bind.held()) {
                true
            } else {
                return None;
            };
            let to = bind.action.as_ref().map(|_| {
                Declared {
                    code: bind.code.clone(),
                    shift: bind.shift,
                    held: !more,
                    more,
                    ..Declared::default()
                }
                .real(to)
                .text()
            });
            Some(Move { bind, to })
        })
        .collect()
}

/// Whether a key types a character into a field: a letter, a digit, a
/// sign or Space, held with nothing but Shift.
fn types(bind: &Bind) -> bool {
    let typed = name_of(&bind.code).chars().count() == 1 || bind.code == "Space";
    !bind.ctrl && !bind.alt && !bind.sup && typed
}

/// What is wrong with `args` for `action`, by its JSON Schema: a name it
/// does not take, one it must have, or a value of another kind.
fn wrong_args(action: &Action, given: &Args) -> Option<String> {
    let schema = action.args.as_ref();
    let properties = schema.and_then(|schema| schema["properties"].as_object());
    let Some(properties) = properties else {
        return (!given.is_empty()).then(|| format!("{} takes no args", action.id));
    };
    for (name, value) in given {
        let Some(property) = properties.get(name) else {
            let names: Vec<&str> = properties.keys().map(String::as_str).collect();
            return Some(format!(
                "{} takes {}, not {name}",
                action.id,
                names.join(", ")
            ));
        };
        let kind = property["type"].as_str().unwrap_or("string");
        let fits = match kind {
            "number" => value.is_number(),
            _ => value.is_string(),
        };
        if !fits {
            return Some(format!("{name} is a {kind}"));
        }
    }
    let required = schema
        .and_then(|schema| schema["required"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|name| name.as_str());
    for name in required {
        if !given.contains_key(name) {
            return Some(format!("{} needs {name}", action.id));
        }
    }
    None
}

impl KeyInForce {
    /// The key as Banda writes it.
    pub fn text(&self) -> String {
        let held = Mod {
            alt: self.alt,
            ctrl: self.ctrl || self.primary,
            sup: self.sup,
        };
        text_of(held, self.shift, &name_of(&self.code))
    }
}

impl From<&Declared> for KeyInForce {
    fn from(key: &Declared) -> Self {
        KeyInForce {
            code: key.code.clone(),
            alt: key.alt,
            ctrl: key.ctrl,
            sup: key.sup,
            shift: key.shift,
            primary: key.primary,
            args: key.args.clone(),
            line: None,
        }
    }
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
        assert!(alone(&parse("Shift+R").unwrap()));
        assert!(!alone(&parse("F5").unwrap()));
        assert_eq!(ok("Return"), is("Enter", "Return"));
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

    /// Two actions with keys, as manifests declare them.
    fn actions() -> Vec<Action> {
        let key = |code: &str| Declared {
            code: code.to_owned(),
            held: true,
            ..Declared::default()
        };
        let action = |id: &str, title: &str, keys| Action {
            id: id.to_owned(),
            title: title.to_owned(),
            section: "Columns".to_owned(),
            keys,
            family: None,
            unlisted: false,
            scope: None,
            args: None,
            runs_as_person: None,
        };
        let mut open = action("browser.open", "Open in a browser", vec![]);
        open.args = Some(serde_json::json!({
            "type": "object",
            "properties": { "address": { "type": "string", "description": "a page" } },
            "additionalProperties": false,
        }));
        let mut send = action(
            "agents.composer.send",
            "Send",
            vec![Declared {
                code: "Enter".to_owned(),
                ..Declared::default()
            }],
        );
        send.scope = Some("composer".to_owned());
        vec![
            action("column.maximize", "Full width", vec![key("KeyF")]),
            action("sidebar.archive", "Archive", vec![key("KeyS")]),
            action("pane.close", "Close", vec![key("KeyW")]),
            open,
            send,
        ]
    }

    fn manifests_of(actions: Vec<Action>) -> Manifests {
        Manifests {
            actions,
            scopes: vec![Scope {
                id: "composer".to_owned(),
                title: "Composer".to_owned(),
                field: true,
                mod_held: false,
            }],
        }
    }

    fn in_force_of(text: &str) -> (Vec<ActionKeys>, Vec<Problem>) {
        let mut problems = Vec::new();
        let (_, keys) = read_keys(Path::new("keys.toml"), text, &mut problems).unwrap();
        let keys = Keys {
            file: "keys.toml".to_owned(),
            ..keys
        };
        let actions = in_force(&manifests_of(actions()), &keys, &mut problems);
        (actions, problems)
    }

    fn texts(actions: &[ActionKeys], id: &str) -> Vec<String> {
        let action = actions.iter().find(|action| action.id == id).unwrap();
        action.keys.iter().map(KeyInForce::text).collect()
    }

    #[test]
    fn the_keys_in_force_are_banda_s_with_the_mod_then_the_person_s() {
        let (actions, problems) = in_force_of(
            "mod = \"Ctrl+Alt\"\n[binds]\n\"Ctrl+Alt+W\" = \"column.maximize\"\n\"Alt+H\" = { action = \"browser.open\", args = { address = \"https://github.com\" } }\n",
        );
        assert!(problems.is_empty(), "{problems:?}");
        // A key bound leaves the action that had it.
        assert_eq!(
            texts(&actions, "column.maximize"),
            ["Ctrl+Alt+F", "Ctrl+Alt+W"]
        );
        assert!(texts(&actions, "pane.close").is_empty());
        let open = actions.iter().find(|a| a.id == "browser.open").unwrap();
        let address = serde_json::json!({ "address": "https://github.com" });
        assert_eq!(open.keys[0].args.as_ref(), address.as_object());
        assert_eq!(open.keys[0].line, Some(4));
    }

    #[test]
    fn a_line_is_named_when_it_names_no_action_gives_wrong_args_or_frees_nothing() {
        let (actions, problems) = in_force_of(
            "[binds]\n\"Alt+J\" = \"column.nothing\"\n\"Alt+Y\" = \"sidebar.settle\"\n\"Alt+K\" = { action = \"browser.open\", args = { url = \"x\" } }\n\"Ctrl+Alt+F\" = \"none\"\n",
        );
        let said: Vec<(Option<u32>, &str)> = problems
            .iter()
            .map(|problem| (problem.line, problem.message.as_str()))
            .collect();
        assert_eq!(
            said,
            [
                (
                    Some(2),
                    "Alt+J: Banda has no action column.nothing; the key sheet lists them"
                ),
                (
                    Some(3),
                    "Alt+Y: sidebar.settle is called sidebar.archive now"
                ),
                (Some(4), "Alt+K: browser.open takes address, not url"),
                (
                    Some(5),
                    "Ctrl+Alt+F: no Banda key is here with this mod, so it frees nothing"
                ),
            ]
        );
        // An old id still runs its action.
        assert_eq!(texts(&actions, "sidebar.archive"), ["Alt+S", "Alt+Y"]);
        // A line named wrong leaves Banda's key where it was.
        let (actions, _) = in_force_of("[binds]\n\"Alt+F\" = \"column.nothing\"\n");
        assert_eq!(texts(&actions, "column.maximize"), ["Alt+F"]);
    }

    #[test]
    fn two_actions_on_one_key_with_the_mod_are_named_at_its_line() {
        let mut problems = Vec::new();
        let mut two = actions();
        two[2].keys = vec![Declared {
            code: "KeyF".to_owned(),
            ctrl: true,
            alt: true,
            ..Declared::default()
        }];
        let keys = Keys {
            file: "keys.toml".to_owned(),
            held: Mod {
                alt: true,
                ctrl: true,
                sup: false,
            },
            mod_line: Some(1),
            ..Keys::default()
        };
        let actions = in_force(&manifests_of(two), &keys, &mut problems);
        assert!(texts(&actions, "pane.close").is_empty());
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].line, Some(1));
        assert_eq!(
            problems[0].message,
            "Ctrl+Alt+F is “Full width” and “Close” with this mod; “Full width” keeps it"
        );
    }

    #[test]
    fn a_scope_s_table_binds_its_own_actions_with_keys_of_its_own() {
        let (actions, problems) = in_force_of(
            "[binds]\n\"Alt+X\" = \"agents.composer.send\"\n[binds.composer]\n\"Ctrl+Return\" = \"agents.composer.send\"\n\"Return\" = \"none\"\n\"Alt+F\" = \"agents.composer.send\"\n\"M\" = \"agents.composer.send\"\n[binds.nope]\n\"Return\" = \"none\"\n",
        );
        // In the composer Return is freed; Ctrl+Return and Alt+F send.
        assert_eq!(
            texts(&actions, "agents.composer.send"),
            ["Ctrl+Return", "Alt+F"]
        );
        // Alt+F stays the window's everywhere else.
        assert_eq!(texts(&actions, "column.maximize"), ["Alt+F"]);
        let said: Vec<(Option<u32>, &str)> = problems
            .iter()
            .map(|problem| (problem.line, problem.message.as_str()))
            .collect();
        assert_eq!(
            said,
            [
                (
                    Some(2),
                    "Alt+X: agents.composer.send works in [binds.composer]: bind it there"
                ),
                (Some(7), "M: it would be typed in the composer"),
                (
                    Some(9),
                    "Return: Banda has no scope nope; its scopes are composer"
                ),
            ]
        );
    }

    #[test]
    fn a_declared_key_gives_its_action_what_it_says() {
        let open = Action {
            id: "launcher.open".to_owned(),
            title: "Open a Pane".to_owned(),
            section: "Launcher".to_owned(),
            keys: vec![Declared {
                code: "KeyT".to_owned(),
                args: serde_json::json!({ "kind": "terminal.terminal" })
                    .as_object()
                    .cloned(),
                ..Declared::default()
            }],
            family: None,
            unlisted: false,
            scope: Some("launcher".to_owned()),
            args: None,
            runs_as_person: None,
        };
        let actions = in_force(&manifests_of(vec![open]), &Keys::default(), &mut Vec::new());
        let key = &actions[0].keys[0];
        assert_eq!(key.text(), "T");
        assert_eq!(
            key.args.as_ref().and_then(|args| args["kind"].as_str()),
            Some("terminal.terminal")
        );
    }

    #[test]
    fn the_template_binds_nothing() {
        let (binds, problems) = read(TEMPLATE);
        assert!(binds.is_empty());
        assert!(problems.is_empty(), "{problems:?}");
    }
}
