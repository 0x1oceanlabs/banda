//! The window's look (ADR 0007), resolved from text files into CSS
//! variables.
//!
//! The look comes from four layers, each over the one before: Banda's
//! defaults, the theme's `banda.toml`, Hyprland's own window settings and
//! the Person's `~/.config/banda/look.toml`. A theme's colours are an
//! Omarchy palette, and [`tokens::derive`] turns them into shadcn/ui's
//! tokens.
//!
//! It is the window's machine's, not a Space's, so it is no module of the
//! engine: `banda look` prints it, and `banda look --follow` prints it
//! again on every change. The window runs that and applies what it reads.
//! The sidebar's `sidebar.toml` (ADR 0008) is this machine's too, so it
//! comes with the look: [`sidebar`].

pub mod color;
pub mod columns;
pub mod fonts;
pub mod hyprland;
pub mod motion;
pub mod notify;
pub mod palette;
pub mod settings;
pub mod sidebar;
pub mod sound;
pub mod theme;
pub mod tokens;

use color::{is_css_color, is_hex};
use hyprland::Windows;
use motion::Motion;
use palette::Palette;
use serde::Serialize;
use settings::{Corner, ModeChoice, Settings, ThemeChoice};
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use theme::{Places, Theme};
use toml::Spanned;
use ts_rs::TS;

/// Light or dark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Mode {
    Light,
    Dark,
}

/// Which scheme the window shows: one, or the system's choice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Shown {
    System,
    Light,
    Dark,
}

/// Everything the window applies, already resolved: CSS variables by
/// their names, `--` included.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Look {
    pub mode: Shown,
    /// The colours of each scheme the theme has: one, or both when the
    /// window follows the system.
    pub schemes: Schemes,
    /// Sizes, the same in light and dark.
    pub vars: BTreeMap<String, String>,
    /// How each event moves, already slowed down or turned off.
    pub motion: Motion,
    /// The widths columns take, and where the focused one scrolls to.
    pub columns: columns::Columns,
    /// The layers it came from, bottom first.
    pub sources: Vec<Source>,
    /// What is wrong in the files. The look still applies: a broken layer
    /// is left out, and `--follow` keeps the last good look.
    pub problems: Vec<Problem>,
    /// Banda's sounds, which the window plays (ADR 0009).
    pub sound: sound::Sound,
    /// How the sidebar arranges its Threads, from `sidebar.toml` (ADR 0008).
    pub sidebar: sidebar::Sidebar,
    /// How the window tells its Person of a call (ADR 0011).
    pub notify: notify::Notify,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Schemes {
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light: Option<BTreeMap<String, String>>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dark: Option<BTreeMap<String, String>>,
}

/// One layer of the look.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Source {
    /// `defaults`, `theme`, `hyprland` or `look.toml`.
    pub layer: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<theme::Origin>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Something wrong in a file, where it is: `path:line:column: message`, as
/// compilers say it, so editors can jump there.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Problem {
    pub path: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    pub message: String,
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.line, self.column) {
            (Some(line), Some(column)) => {
                write!(f, "{}:{line}:{column}: {}", self.path, self.message)
            }
            _ => write!(f, "{}: {}", self.path, self.message),
        }
    }
}

impl Problem {
    pub fn at(
        path: &Path,
        text: &str,
        span: Option<std::ops::Range<usize>>,
        message: impl Into<String>,
    ) -> Problem {
        let (line, column) = span.map_or((None, None), |span| {
            let before = &text[..span.start.min(text.len())];
            let line = before.matches('\n').count() + 1;
            let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
            (Some(line as u32), Some(column as u32))
        });
        Problem {
            path: path.display().to_string(),
            line,
            column,
            message: message.into(),
        }
    }

    pub fn toml(path: &Path, text: &str, error: &toml::de::Error) -> Problem {
        Problem::at(path, text, error.span(), error.message().trim().to_owned())
    }

    fn whole(path: &Path, message: impl Into<String>) -> Problem {
        Problem::at(path, "", None, message)
    }
}

/// Reads a `look.toml` or a `banda.toml`, and checks what TOML alone does
/// not: sizes are not negative, colours are colours. Problems go to
/// `problems`; `None` when the file cannot be read as the schema at all.
pub fn read_settings(path: &Path, text: &str, problems: &mut Vec<Problem>) -> Option<Settings> {
    let settings: Settings = match toml::from_str(text) {
        Ok(settings) => settings,
        Err(error) => {
            problems.push(Problem::toml(path, text, &error));
            return None;
        }
    };
    for key in settings.negative_sizes() {
        problems.push(Problem::whole(path, format!("{key} cannot be negative")));
    }
    if settings
        .tile
        .dim_inactive
        .is_some_and(|d| !(d.is_finite() && (0.0..=1.0).contains(&d)))
    {
        problems.push(Problem::whole(path, "tile.dim-inactive is from 0 to 1"));
    }
    for (span, message) in settings.columns.problems() {
        problems.push(Problem::at(path, text, span, message));
    }
    for message in settings.font.problems() {
        problems.push(Problem::whole(path, message));
    }
    for (span, message) in settings.motion.problems() {
        problems.push(Problem::at(path, text, span, message));
    }
    if settings.sound.volume_wrong() {
        problems.push(Problem::whole(path, "sound.volume is from 0 to 1"));
    }
    let named = |value: &Spanned<String>| {
        let v = value.get_ref();
        v.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    };
    for (key, value) in &settings.colors {
        if !(is_hex(value.get_ref()) || named(value)) {
            problems.push(Problem::at(
                path,
                text,
                Some(value.span()),
                format!("colors.{key} is a palette name or hex, such as \"orange\" or \"#e07a3f\""),
            ));
        }
    }
    let references = settings
        .tokens
        .iter()
        .map(|(key, value)| (format!("tokens.{key}"), value))
        .chain(
            settings
                .focus
                .border
                .iter()
                .map(|v| ("focus.border".to_owned(), v)),
        )
        .chain(
            settings
                .focus
                .inactive_border
                .iter()
                .map(|v| ("focus.inactive-border".to_owned(), v)),
        );
    for (key, value) in references {
        if !is_css_color(value.get_ref()) {
            problems.push(Problem::at(
                path,
                text,
                Some(value.span()),
                format!("{key} is a palette name, a token's name or a CSS colour"),
            ));
        }
    }
    Some(settings)
}

/// What `look.toml` can say, every key with its default and commented
/// out: the Banda skill's reference shows it, and it is an example too.
pub const TEMPLATE: &str = include_str!("../look.toml");

/// One resolution: the look, and every file it read or looked for, so a
/// follower knows what to watch.
pub struct Resolved {
    pub look: Look,
    pub watched: Vec<PathBuf>,
}

/// Resolves the look on this machine. `windows` asks Hyprland for its
/// window settings, and is asked only when `look.toml` lets it.
pub fn resolve(places: &Places, windows: &dyn Fn() -> Option<Windows>) -> Resolved {
    let mut problems = Vec::new();
    let mut watched = Vec::new();

    let look_file = places.look_file();
    watched.push(look_file.clone());
    let mine = match std::fs::read_to_string(&look_file) {
        Ok(text) => read_settings(&look_file, &text, &mut problems),
        Err(_) => None,
    };
    let mine_read = mine.is_some();
    let mine = mine.unwrap_or_default();

    let default_theme = if places.omarchy_current.is_some() {
        "omarchy"
    } else {
        "banda"
    };
    let choice = mine
        .theme
        .as_ref()
        .map(|t| t.get_ref().clone())
        .unwrap_or_else(|| ThemeChoice::One(default_theme.to_owned()));

    let load =
        |name: &str, problems: &mut Vec<Problem>, watched: &mut Vec<PathBuf>| -> Option<Theme> {
            if name == "omarchy" {
                if let Some(current) = &places.omarchy_current {
                    watched.push(current.join("colors.toml"));
                    watched.push(current.join("banda.toml"));
                }
            } else {
                for (_, folder) in places.candidates(name) {
                    watched.push(folder.join("colors.toml"));
                    watched.push(folder.join("banda.toml"));
                }
            }
            places.theme(name, problems)
        };
    let missing = |name: &str, problems: &mut Vec<Problem>| {
        let words = if name == "omarchy" {
            "theme = \"omarchy\", but Omarchy's current theme is not here; Banda's own shows"
                .to_owned()
        } else {
            format!(
                "there is no theme \"{name}\"; Banda's own shows (banda look themes lists them)"
            )
        };
        problems.push(Problem::whole(&look_file, words));
    };
    let banda = |problems: &mut Vec<Problem>| {
        (
            places.theme("banda-light", problems),
            places.theme("banda-dark", problems),
        )
    };

    // The themes of each scheme, and which scheme shows.
    let wanted = mine.mode.unwrap_or(ModeChoice::System);
    let (light, dark, shown) = match choice {
        ThemeChoice::One(name) if name == "banda" => {
            let (light, dark) = banda(&mut problems);
            (light, dark, shown_of(wanted))
        }
        ThemeChoice::One(name) => match load(&name, &mut problems, &mut watched) {
            Some(theme) => match theme.palette.mode() {
                Mode::Light => (Some(theme), None, Shown::Light),
                Mode::Dark => (None, Some(theme), Shown::Dark),
            },
            None => {
                missing(&name, &mut problems);
                let (light, dark) = banda(&mut problems);
                (light, dark, shown_of(wanted))
            }
        },
        ThemeChoice::Pair { light, dark } => {
            let found_light = load(&light, &mut problems, &mut watched);
            if found_light.is_none() {
                missing(&light, &mut problems);
            }
            let found_dark = load(&dark, &mut problems, &mut watched);
            if found_dark.is_none() {
                missing(&dark, &mut problems);
            }
            let (banda_light, banda_dark) = banda(&mut problems);
            (
                found_light.or(banda_light),
                found_dark.or(banda_dark),
                shown_of(wanted),
            )
        }
    };

    // Sizes come from one theme: the one that shows, or the light one when
    // the system chooses.
    let sizing = match shown {
        Shown::Dark => dark.as_ref().or(light.as_ref()),
        _ => light.as_ref().or(dark.as_ref()),
    };
    let mut sources = vec![Source {
        layer: "defaults".to_owned(),
        name: None,
        origin: None,
        path: None,
    }];
    for theme in [&light, &dark].into_iter().flatten() {
        sources.push(Source {
            layer: "theme".to_owned(),
            name: Some(theme.name.clone()),
            origin: Some(theme.origin),
            path: theme.folder.as_ref().map(|f| f.display().to_string()),
        });
    }
    let mut layers = Settings::defaults();
    if let Some(theme) = sizing {
        layers = theme.settings.clone().over(layers);
    }
    if mine.hyprland.unwrap_or(true)
        && let Some(found) = windows()
    {
        layers = found.layer().over(layers);
        sources.push(Source {
            layer: "hyprland".to_owned(),
            name: None,
            origin: None,
            path: None,
        });
    }
    if mine_read {
        sources.push(Source {
            layer: "look.toml".to_owned(),
            name: None,
            origin: None,
            path: Some(look_file.display().to_string()),
        });
    }
    let all = mine.clone().over(layers);

    let schemes = Schemes {
        light: light.as_ref().map(|t| scheme(t, &mine, &all)),
        dark: dark.as_ref().map(|t| scheme(t, &mine, &all)),
    };
    for theme in [&light, &dark].into_iter().flatten() {
        let not_hex = theme.palette.not_hex();
        if !not_hex.is_empty()
            && let Some(folder) = &theme.folder
        {
            problems.push(Problem::whole(
                &folder.join("colors.toml"),
                format!(
                    "{} are not hex, so colours mixed from them fall back",
                    not_hex.join(", ")
                ),
            ));
        }
    }

    let sidebar = sidebar::resolve(places, &mut problems, &mut watched);
    let mut vars = vars(&all);
    let system = |generic: &str| {
        places
            .fontconfig
            .as_deref()
            .and_then(|folder| fonts::fc_match(generic, folder))
    };
    for (name, value) in all.font.vars(&system) {
        vars.insert(format!("--{name}"), value);
    }
    if let Some(folder) = &places.fontconfig
        && all.font.asks_the_system()
    {
        watched.push(folder.join("fonts.conf"));
    }

    Resolved {
        look: Look {
            mode: shown,
            schemes,
            vars,
            motion: all.motion.resolve(),
            columns: all.columns.resolve(),
            sources,
            problems,
            sound: all.sound.resolved(),
            sidebar,
            notify: all.notify.resolved(),
        },
        watched,
    }
}

fn shown_of(wanted: ModeChoice) -> Shown {
    match wanted {
        ModeChoice::System => Shown::System,
        ModeChoice::Light => Shown::Light,
        ModeChoice::Dark => Shown::Dark,
    }
}

/// One theme's colours as CSS variables: its palette under the colours
/// the layers replace, derived into tokens, under the tokens they replace.
fn scheme(theme: &Theme, mine: &Settings, all: &Settings) -> BTreeMap<String, String> {
    let base = theme.palette.clone().complete();
    let mut palette = base.clone();
    for (key, value) in theme.settings.colors.iter().chain(&mine.colors) {
        let value = value.get_ref();
        let resolved = base
            .get(value)
            .map(str::to_owned)
            .or_else(|| is_hex(value).then(|| value.clone()));
        if let Some(resolved) = resolved {
            palette.set(key, resolved);
        }
    }
    let palette = palette.complete();
    let mut tokens = tokens::derive(&palette);
    let refer = |tokens: &BTreeMap<String, String>, value: &str| -> Option<String> {
        palette
            .get(value)
            .map(str::to_owned)
            .or_else(|| tokens.get(value).cloned())
            .or_else(|| is_css_color(value).then(|| value.to_owned()))
    };
    for (key, value) in theme.settings.tokens.iter().chain(&mine.tokens) {
        if let Some(resolved) = refer(&tokens, value.get_ref()) {
            tokens.insert(key.clone(), resolved);
        }
    }
    let focus = |value: &Option<Spanned<String>>, fallback: &str| {
        value
            .as_ref()
            .and_then(|v| refer(&tokens, v.get_ref()))
            .or_else(|| tokens.get(fallback).cloned())
            .unwrap_or_default()
    };
    let active = focus(&all.focus.border, "primary");
    let inactive = focus(&all.focus.inactive_border, "border");
    tokens.insert("focus".to_owned(), active);
    tokens.insert("focus-inactive".to_owned(), inactive);
    tokens
        .into_iter()
        .map(|(k, v)| (format!("--{k}"), v))
        .collect()
}

/// The sizes as CSS variables, in pixels.
fn vars(all: &Settings) -> BTreeMap<String, String> {
    let radius = all.radius.unwrap_or(10.0);
    let tile = match all.tile.radius.unwrap_or(Corner::Step(settings::Step::Xl)) {
        Corner::Step(step) => radius * step.factor(),
        Corner::Pixels(px) => px,
    };
    let px = |v: f64| {
        let rounded = (v * 1000.0).round() / 1000.0;
        format!("{rounded}px")
    };
    let mut vars = BTreeMap::new();
    let mut put = |name: &str, value: Option<f64>| {
        if let Some(value) = value.filter(|v| v.is_finite() && *v >= 0.0) {
            vars.insert(format!("--{name}"), px(value));
        }
    };
    put("radius", Some(radius));
    put("tile-radius", Some(tile));
    put("tile-border", all.tile.border);
    put("gap-inner", all.gaps.inner);
    put("gap-outer", all.gaps.outer);
    put("bar-height", all.bar.height);
    put("focus-ring", all.focus.ring);
    if let Some(dim) = all
        .tile
        .dim_inactive
        .filter(|d| d.is_finite() && (0.0..=1.0).contains(d))
    {
        vars.insert(
            "--tile-dim".to_owned(),
            format!("{}", (dim * 1000.0).round() / 1000.0),
        );
    }
    vars
}

/// Prints the look, then again each time a file it reads changes or
/// Hyprland reloads, until `emit` says to stop. A broken file keeps the
/// last good look in force, with the new problems.
pub fn follow(
    places: &Places,
    hyprland: Option<hyprland::Hyprland>,
    mut emit: impl FnMut(&Look) -> bool,
) {
    let (tell, changes) = std::sync::mpsc::channel::<()>();
    if let Some(hyprland) = &hyprland {
        hyprland.on_reload(move || {
            let _ = tell.send(());
        });
    }
    let windows = || hyprland.as_ref().and_then(|h| h.windows().ok());
    let mut good: Option<Look> = None;
    let mut last: Option<Look> = None;
    let mut watched: Vec<PathBuf> = Vec::new();
    loop {
        // The files as they were before they are read, so a save while they
        // are read, or before the look is out, is still a change to come.
        let before = fingerprint(&watched);
        let resolved = resolve(places, &windows);
        let seen = if resolved.watched == watched {
            before
        } else {
            fingerprint(&resolved.watched)
        };
        let Resolved { look, watched: now } = resolved;
        watched = now;
        let shown = match (&good, look.problems.is_empty()) {
            (Some(good), false) => Look {
                problems: look.problems.clone(),
                ..good.clone()
            },
            _ => {
                good = Some(look.clone());
                look
            }
        };
        if last.as_ref() != Some(&shown) {
            if !emit(&shown) {
                return;
            }
            last = Some(shown);
        }
        loop {
            match changes.recv_timeout(Duration::from_millis(250)) {
                Ok(()) => break,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                // No Hyprland: only the files can change.
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_millis(250))
                }
            }
            if fingerprint(&watched) != seen {
                break;
            }
        }
    }
}

/// What tells a file changed: its bytes, or for a folder the names in it,
/// hashed; none if it is not there. Not its time and size: two quick saves
/// of the same length can share both. Reading a few small files costs
/// nothing, and survives editors that save by renaming and Omarchy
/// replacing its whole theme folder.
fn fingerprint(paths: &[PathBuf]) -> Vec<Option<u64>> {
    use std::hash::{Hash, Hasher};
    paths
        .iter()
        .map(|path| {
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            if path.is_dir() {
                let mut names: Vec<_> = std::fs::read_dir(path)
                    .ok()?
                    .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
                    .collect();
                names.sort();
                names.hash(&mut hash);
            } else {
                std::fs::read(path).ok()?.hash(&mut hash);
            }
            Some(hash.finish())
        })
        .collect()
}

pub use theme::Listed;

/// Checks files as `banda look check` does: a `colors.toml` as a
/// palette, a `sidebar.toml` or a file in `sidebars/` as the sidebar's
/// schema, anything else as `look.toml`'s.
pub fn check(paths: &[PathBuf]) -> Vec<Problem> {
    let mut problems = Vec::new();
    for path in paths {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) => {
                problems.push(Problem::whole(path, error.to_string()));
                continue;
            }
        };
        if let Some(preset) = sidebar::is_sidebar_file(path) {
            sidebar::read_sidebar(path, &text, preset, &mut problems);
        } else if path.file_name().is_some_and(|n| n == "colors.toml") {
            match Palette::parse(&text) {
                Ok(palette) => {
                    let complete = palette.complete();
                    let not_hex = complete.not_hex();
                    if !not_hex.is_empty() {
                        problems.push(Problem::whole(
                            path,
                            format!(
                                "{} are not hex, so colours mixed from them fall back",
                                not_hex.join(", ")
                            ),
                        ));
                    }
                }
                Err(error) => problems.push(Problem::toml(path, &text, &error)),
            }
        } else {
            read_settings(path, &text, &mut problems);
        }
    }
    problems
}
