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
//! comes with the look: [`sidebar`]; so do its keys, [`keys`]. A module's
//! own file the window reads, as the browser's `browser.toml`, comes in
//! [`Look::files`], by its name ([`file`]); the module describes it.

pub mod color;
pub mod columns;
pub mod file;
pub mod fonts;
pub mod hyprland;
pub mod keyed;
pub mod keys;
pub mod motion;
pub mod notify;
pub mod palette;
pub mod settings;
pub mod sidebar;
pub mod sound;
pub mod theme;
pub mod tokens;
mod wallpaper;

use color::{is_css_color, is_hex};
pub use file::{OneFile, SettingsFile};
use hyprland::Windows;
use motion::Motion;
use palette::Palette;
use serde::Serialize;
use settings::{Corner, Material, ModeChoice, Settings, SidebarStyle, ThemeChoice, Workspaces};
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::Duration;
use theme::{Places, Theme};
use toml::Spanned;
use ts_rs::TS;
pub use wallpaper::path_of;

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
    /// Whether the desk is glass, what of, and how the sidebar sits on it
    /// (ADR 0023).
    pub desk: Desk,
    /// How each event moves, already slowed down or turned off.
    pub motion: Motion,
    /// The widths columns take, and where the focused one scrolls to.
    pub columns: columns::Columns,
    /// The bar, besides its height.
    pub bar: Bar,
    /// The drawer, a quick Thread over the workspace (ADR 0025, decision 8).
    pub drawer: Drawer,
    /// The overview of every workspace (ADR 0025, decision 7).
    pub overview: Overview,
    /// How a Group of columns shows (ADR 0065).
    pub groups: Groups,
    /// The layers it came from, bottom first.
    pub sources: Vec<Source>,
    /// What is wrong in the files. The look still applies: a value that
    /// does not read is left out; a file that does not read at all is left
    /// out whole, and `--follow` keeps the last good look.
    pub problems: Vec<Problem>,
    /// Banda's sounds, which the window plays (ADR 0009).
    pub sound: sound::Sound,
    /// How the sidebar arranges its Threads, from `sidebar.toml` (ADR 0008).
    pub sidebar: sidebar::Sidebar,
    /// How the window tells its Person of a call (ADR 0011).
    pub notify: notify::Notify,
    /// The keys the Person bound in `keys.toml` (ADR 0005, decision 11).
    pub keys: keys::Keys,
    /// Each key of each settings file, by file: its value, and where it
    /// comes from (ADR 0016).
    pub settings: BTreeMap<String, keyed::Keyed>,
    /// Each module's settings file that the window reads, resolved, by its
    /// name, as `browser.toml` and `agents.toml`. Its module's types say
    /// what it holds.
    pub files: BTreeMap<String, serde_json::Value>,
    /// The folder the settings files are in: `~/.config/banda`.
    pub config: String,
}

/// The desk as the window makes it (ADR 0023). Its opacities are CSS
/// variables, with the sizes.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Desk {
    /// The desk is glass: there is a wallpaper for Banda's, or the system
    /// makes it.
    pub glass: bool,
    pub material: Material,
    pub sidebar: SidebarStyle,
    /// The picture Banda's glass is made of: when the desktop's wallpaper
    /// changes, so does this.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wallpaper: Option<Wallpaper>,
    /// The picture for when Banda is dark, when it is another.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wallpaper_dark: Option<Wallpaper>,
}

/// The bar as the window draws it; its height is a CSS variable.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Bar {
    pub workspaces: Workspaces,
    /// The widgets of each part, by id, in order (ADR 0024, decision 4):
    /// on the left after the Mark, in the middle, and on the right (ADR 0064).
    pub left: Vec<String>,
    pub center: Vec<String>,
    pub right: Vec<String>,
}

/// The drawer, a quick Thread over the workspace (ADR 0025, decision 8).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Drawer {
    /// How far down it drops: a share of the room under the bar.
    pub height: f64,
    /// The Harness its Thread starts on; this computer's first one when
    /// `None`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
}

/// The overview of every workspace (ADR 0025, decision 7).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Overview {
    /// How far it zooms the workspaces out, at most: 0.5 is half.
    pub zoom: f64,
}

/// How a Group of columns shows (ADR 0065).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Groups {
    pub look: settings::GroupLook,
    /// A handle on its top edge under the pointer, that carries it.
    pub handle: bool,
}

/// A picture Banda's glass is made of (ADR 0030).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Wallpaper {
    /// The file itself, links followed.
    pub path: String,
    /// When it was last written, in milliseconds since 1970: in the page's
    /// address, so a picture rewritten in place is drawn again.
    #[ts(type = "number")]
    pub modified: u64,
    /// Where the look found it: `look.toml`, `Omarchy`, or the desktop
    /// (`GNOME`, `KDE`, …).
    pub from: &'static str,
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
    /// The dotted key it is about, `tile.border`, when it is at one: the
    /// settings Pane shows it at that key's row.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub message: String,
    /// The file it is in is left out whole, as TOML written wrong is, so
    /// `--follow` keeps the last good look.
    #[serde(skip)]
    #[ts(skip)]
    pub left_out: bool,
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
        span: Option<Range<usize>>,
        message: impl Into<String>,
    ) -> Problem {
        let start = span.map(|span| span.start);
        let key = start.and_then(|start| keyed::key_at(text, start));
        Problem::placed(path, text, start, key, message)
    }

    /// A problem at `start` in `text`, about `key`.
    fn placed(
        path: &Path,
        text: &str,
        start: Option<usize>,
        key: Option<String>,
        message: impl Into<String>,
    ) -> Problem {
        let start = start.map(|start| start.min(text.len()));
        let (line, column) = start.map_or((None, None), |start| {
            let column = text[..start]
                .rsplit('\n')
                .next()
                .map_or(0, |l| l.chars().count())
                + 1;
            (Some(line_at(text, start)), Some(column as u32))
        });
        Problem {
            path: path.display().to_string(),
            line,
            column,
            key,
            message: message.into(),
            left_out: false,
        }
    }

    /// This problem, with the file it is in left out whole.
    pub fn left_out(self) -> Problem {
        Problem {
            left_out: true,
            ..self
        }
    }

    pub fn toml(path: &Path, text: &str, error: &toml::de::Error) -> Problem {
        Problem::at(path, text, error.span(), error.message().trim().to_owned())
    }

    /// A problem with the whole file, such as one that cannot be read.
    pub fn whole(path: &Path, message: impl Into<String>) -> Problem {
        Problem::at(path, "", None, message)
    }

    /// A problem with `key`, wherever in the file it is.
    pub fn of_key(path: &Path, key: &str, message: impl Into<String>) -> Problem {
        Problem {
            key: Some(key.to_owned()),
            ..Problem::whole(path, message)
        }
    }
}

/// Reads `text`, the file at `path`, as a `T`. A value that does not
/// read is named at its key and left out, so the rest of the file still
/// applies: its entry's bytes go blank, so every place stays where it
/// was, and the text is read again. `None`, with the problem left out
/// whole, when what is wrong is no key's, as TOML written wrong.
pub fn read<T: serde::de::DeserializeOwned>(
    path: &Path,
    text: &str,
    problems: &mut Vec<Problem>,
) -> Option<T> {
    let mut text = Cow::Borrowed(text);
    loop {
        let error = match toml::from_str(&text) {
            Ok(read) => return Some(read),
            Err(error) => error,
        };
        let start = error.span().map(|span| span.start);
        let message = error.message().trim().to_owned();
        // Each pass blanks a key, so the loop ends.
        let Some((key, entry)) = start.and_then(|start| keyed::entry_at(&text, start)) else {
            problems.push(Problem::placed(path, &text, start, None, message).left_out());
            return None;
        };
        problems.push(Problem::placed(path, &text, start, Some(key), message));
        text = Cow::Owned(keyed::blank(&text, entry));
    }
}

/// Reads a `look.toml` or a `banda.toml`, and checks what TOML alone does
/// not: sizes are not negative, colours are colours, as [`read`] reads a
/// file.
pub fn read_settings(path: &Path, text: &str, problems: &mut Vec<Problem>) -> Option<Settings> {
    let settings: Settings = read(path, text, problems)?;
    for key in settings.negative_sizes() {
        problems.push(Problem::of_key(
            path,
            key,
            format!("{key} cannot be negative"),
        ));
    }
    for key in settings.shares_out_of_range() {
        problems.push(Problem::of_key(path, key, format!("{key} is from 0 to 1")));
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
        problems.push(Problem::of_key(
            path,
            "sound.volume",
            "sound.volume is from 0 to 1",
        ));
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
    /// Files followed by where their links go, their size and their
    /// time, not their bytes: the wallpaper, which may be large and is
    /// named by where it goes.
    pub followed: Vec<PathBuf>,
}

/// The files the look reads: its own, the sidebar's and the keys' (ADR
/// 0016).
pub const FILES: [SettingsFile; 3] = [
    SettingsFile::new::<Settings>(
        "look.toml",
        || TEMPLATE.to_owned(),
        |path, text| checked(|problems| read_settings(path, text, problems)),
    ),
    SettingsFile::new::<sidebar::SidebarSettings>(
        "sidebar.toml",
        || sidebar::TEMPLATE.to_owned(),
        |path, text| checked(|problems| sidebar::read_sidebar(path, text, false, problems)),
    ),
    SettingsFile::new::<keys::KeysSettings>(
        "keys.toml",
        || keys::TEMPLATE.to_owned(),
        |path, text| checked(|problems| keys::read_keys(path, text, problems)),
    ),
];

/// The problems `read` finds.
fn checked<T>(read: impl FnOnce(&mut Vec<Problem>) -> T) -> Vec<Problem> {
    let mut problems = Vec::new();
    read(&mut problems);
    problems
}

/// Resolves the look on this machine. `windows` asks Hyprland for its
/// window settings, and is asked only when `look.toml` lets it. The
/// files in `also`, the modules', are watched and resolved too, into
/// [`Look::files`], or their problems named when the look only checks
/// them.
pub fn resolve(
    places: &Places,
    windows: &dyn Fn() -> Option<Windows>,
    also: &[SettingsFile],
) -> Resolved {
    let mut problems = Vec::new();
    let mut watched = Vec::new();
    let mut followed = Vec::new();

    let look_file = places.look_file();
    watched.push(look_file.clone());
    let mine_file = std::fs::read_to_string(&look_file)
        .ok()
        .map(|text| (look_file.clone(), text));
    let mine = mine_file
        .as_ref()
        .and_then(|(path, text)| read_settings(path, text, &mut problems));
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
    // Who makes the glass is known before the defaults are: it decides the
    // desk's own tint, denser over Banda's wallpaper than over the system's
    // material, which is tinted already (ADR 0030, decision 1).
    let material = mine
        .desk
        .material
        .or_else(|| sizing.and_then(|theme| theme.settings.desk.material))
        .unwrap_or(places.material);
    let mut layers = Settings::defaults(material);
    let mut keyed_layers = vec![keyed::Layer::new("defaults", &layers, None)];
    if let Some(theme) = sizing {
        let file = theme.banda_toml.as_ref();
        keyed_layers.push(keyed::Layer::new("theme", &theme.settings, file));
        layers = theme.settings.clone().over(layers);
    }
    // The desk, which Hyprland leaves alone: glass when there is a picture
    // to make Banda's of, or when the system makes it.
    let desk = mine.desk.clone().over(layers.desk.clone());
    let wanted = desk.glass.unwrap_or(true);
    let (wallpaper, wallpaper_dark) = if wanted && material == Material::Banda {
        wallpapers(places, &desk, &look_file, &mut problems, &mut followed)
    } else {
        (None, None)
    };
    let glass =
        wanted && (material == Material::System || wallpaper.is_some() || wallpaper_dark.is_some());
    // Hyprland's settings are the omarchy theme's shape (ADR 0075, decision
    // 3), and the glass changes the background, never the shape: Hyprland's
    // gaps hold, glass or not.
    if mine.hyprland.or(layers.hyprland) == Some(true)
        && let Some(found) = windows()
    {
        let found = found.layer();
        keyed_layers.push(keyed::Layer::new("hyprland", &found, None));
        layers = found.over(layers);
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
    keyed_layers.push(keyed::Layer::new("file", &mine, mine_file.as_ref()));
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

    let (sidebar, sidebar_keys) = sidebar::resolve(places, &mut problems, &mut watched);
    let (keys, keys_keys) = keys::resolve(places, &mut problems, &mut watched);
    let mut settings = BTreeMap::from([
        ("look.toml".to_owned(), keyed::keyed(&all, &keyed_layers)),
        ("sidebar.toml".to_owned(), sidebar_keys),
        ("keys.toml".to_owned(), keys_keys),
    ]);
    let mut files = BTreeMap::new();
    for file in also {
        if let Some((value, keyed)) = file.resolve(places, &mut problems, &mut watched) {
            files.insert(file.name.to_owned(), value);
            settings.insert(file.name.to_owned(), keyed);
        }
    }
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
            desk: Desk {
                glass,
                material,
                sidebar: desk.sidebar.unwrap_or(SidebarStyle::Panel),
                wallpaper,
                wallpaper_dark,
            },
            motion: all.motion.resolve(),
            columns: all.columns.resolve(),
            bar: Bar {
                workspaces: all.bar.workspaces.unwrap_or(Workspaces::Numbers),
                left: all
                    .bar
                    .left
                    .clone()
                    .unwrap_or_else(|| settings::owned(settings::BAR_LEFT)),
                center: all
                    .bar
                    .center
                    .clone()
                    .unwrap_or_else(|| settings::owned(settings::BAR_CENTER)),
                right: all
                    .bar
                    .right
                    .clone()
                    .unwrap_or_else(|| settings::owned(settings::BAR_RIGHT)),
            },
            drawer: Drawer {
                height: all.drawer.height.unwrap_or(0.6),
                harness: all.drawer.harness.clone(),
            },
            overview: Overview {
                zoom: all.overview.zoom.unwrap_or(0.35),
            },
            groups: Groups {
                look: all.groups.look.unwrap_or(settings::GroupLook::Plate),
                handle: all.groups.handle.unwrap_or(true),
            },
            sources,
            problems,
            sound: all.sound.resolved(),
            sidebar,
            notify: all.notify.resolved(),
            keys,
            settings,
            files,
            config: places.config.display().to_string(),
        },
        watched,
        followed,
    }
}

/// The pictures the page draws, by their names' endings.
/// JPEG XL too: GNOME's own wallpapers are, and Electron draws it.
const DRAWN: [&str; 9] = [
    "jpg", "jpeg", "png", "webp", "avif", "jxl", "gif", "bmp", "svg",
];

/// The pictures Banda's glass is made of, light and dark: the keys, from
/// home or the config folder, else the desktop's own (ADR 0030). `None`
/// when there is none, the page could not draw it, or the dark one is the
/// light one.
fn wallpapers(
    places: &Places,
    desk: &settings::Desk,
    look_file: &Path,
    problems: &mut Vec<Problem>,
    followed: &mut Vec<PathBuf>,
) -> (Option<Wallpaper>, Option<Wallpaper>) {
    let keyed = desk.wallpaper.is_some() || desk.wallpaper_dark.is_some();
    let (light, dark, from) = if keyed {
        let named = |key: &Option<String>| {
            let named = key.as_deref()?;
            Some(match named.strip_prefix("~/") {
                Some(rest) => places.home.as_ref()?.join(rest),
                None => places.config.join(named),
            })
        };
        (
            named(&desk.wallpaper),
            named(&desk.wallpaper_dark),
            "look.toml",
        )
    } else {
        match wallpaper::of_desktop(places, followed) {
            Some(found) => (Some(found.light), found.dark, found.from),
            None => return (None, None),
        }
    };
    let mut picture = |path: PathBuf, dark: bool| {
        let (key, what) = if dark {
            ("desk.wallpaper-dark", "dark wallpaper")
        } else {
            ("desk.wallpaper", "wallpaper")
        };
        followed.push(path.clone());
        let unseen =
            |why: String| Problem::whole(look_file, format!("{key}: {why}, so the desk is solid"));
        let found = std::fs::canonicalize(&path).ok();
        let meta = found
            .as_ref()
            .and_then(|found| std::fs::metadata(found).ok())
            .filter(|meta| meta.is_file());
        let (Some(found), Some(meta)) = (found, meta) else {
            if keyed {
                problems.push(unseen(format!("there is no picture at {}", path.display())));
            }
            return None;
        };
        let drawn = found
            .extension()
            .and_then(|ending| ending.to_str())
            .is_some_and(|ending| DRAWN.iter().any(|one| ending.eq_ignore_ascii_case(one)));
        if !drawn {
            problems.push(unseen(format!(
                "{from}'s {what} {} is not a picture Banda draws (JPEG, PNG, WebP, AVIF, JPEG XL, GIF, BMP or SVG)",
                found.display()
            )));
            return None;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_millis() as u64);
        Some(Wallpaper {
            path: found.display().to_string(),
            modified,
            from,
        })
    };
    let light = light.and_then(|path| picture(path, false));
    let dark = dark
        .and_then(|path| picture(path, true))
        .filter(|dark| light.as_ref().is_none_or(|light| light.path != dark.path));
    (light, dark)
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
    let mut vars = BTreeMap::new();
    let mut put = |name: &str, value: Option<f64>, unit: &str| {
        if let Some(value) = value.filter(|v| v.is_finite() && *v >= 0.0) {
            vars.insert(format!("--{name}"), format!("{}{unit}", thousandths(value)));
        }
    };
    put("radius", Some(radius), "px");
    put("tile-radius", Some(tile), "px");
    put("tile-border", all.tile.border, "px");
    put("gap-inner", all.gaps.inner, "px");
    put("gap-outer", all.gaps.outer, "px");
    put("bar-height", all.bar.height, "px");
    put("focus-ring", all.focus.ring, "px");
    // Banda's glass: how frosted, and how vivid the wallpaper under it.
    put("desk-blur", all.desk.blur, "px");
    put("desk-saturation", all.desk.saturation, "");
    let mut put_share = |name: &str, value: Option<f64>, percent: bool| {
        if let Some(value) = value.filter(|v| settings::is_share(*v)) {
            let value = if percent {
                format!("{}%", thousandths(value * 100.0))
            } else {
                thousandths(value).to_string()
            };
            vars.insert(format!("--{name}"), value);
        }
    };
    put_share("tile-dim", all.tile.dim_inactive, false);
    // How solid the desk and the tiles are over glass, as percents for
    // color-mix(); the page uses them only where its window is glass
    // (ADR 0023).
    put_share("desk-opacity", all.desk.opacity, true);
    put_share("tile-opacity", all.tile.opacity, true);
    // How dark the shadows over glass are: a tile's, and the sidebar's.
    put_share("tile-shadow-strength", all.tile.shadow, false);
    put_share("sidebar-shadow-strength", all.desk.sidebar_shadow, false);
    put_share("desk-grain", all.desk.grain, false);
    vars
}

/// `v` to three decimals, as CSS gets every number.
fn thousandths(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Prints the look, then again each time a file it reads, or one in
/// `also`, changes or Hyprland reloads, until `emit` says to stop. A
/// broken file keeps the last good look in force, with the new problems.
pub fn follow(
    places: &Places,
    hyprland: Option<hyprland::Hyprland>,
    also: &[SettingsFile],
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
    let mut followed: Vec<PathBuf> = Vec::new();
    let state =
        |watched: &[PathBuf], followed: &[PathBuf]| (fingerprint(watched), targets(followed));
    loop {
        // The files as they were before they are read, so a save while they
        // are read, or before the look is out, is still a change to come.
        let before = state(&watched, &followed);
        let resolved = resolve(places, &windows, also);
        let seen = if resolved.watched == watched && resolved.followed == followed {
            before
        } else {
            state(&resolved.watched, &resolved.followed)
        };
        let look = resolved.look;
        watched = resolved.watched;
        followed = resolved.followed;
        // A value that does not read is left out and the rest applies; a
        // file left out whole keeps the last good look.
        let whole = look.problems.iter().any(|problem| problem.left_out);
        let shown = match (&good, whole) {
            (Some(good), true) => Look {
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
            if state(&watched, &followed) != seen {
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

/// Where each link goes, links followed, and that file's size and time;
/// none if it goes nowhere. A picture rewritten in place is a change too.
fn targets(links: &[PathBuf]) -> Vec<Option<(PathBuf, u64, Option<std::time::SystemTime>)>> {
    links
        .iter()
        .map(|link| {
            let target = std::fs::canonicalize(link).ok()?;
            let meta = std::fs::metadata(&target).ok()?;
            Some((target, meta.len(), meta.modified().ok()))
        })
        .collect()
}

pub use theme::Listed;

/// The line, from 1, that byte `offset` of `text` is on.
pub(crate) fn line_at(text: &str, offset: usize) -> u32 {
    text[..offset.min(text.len())].matches('\n').count() as u32 + 1
}

/// Checks `text` as the file at `path` would be read: a file in
/// `sidebars/` as a sidebar preset, a `colors.toml` as a palette, one of
/// the look's [`FILES`] as that file, anything else as `look.toml`.
pub fn check_text(path: &Path, text: &str) -> Vec<Problem> {
    let name = path.file_name();
    if sidebar::is_sidebar_file(path) == Some(true) {
        return checked(|problems| sidebar::read_sidebar(path, text, true, problems));
    }
    if name.is_some_and(|name| name == "colors.toml") {
        return check_palette(path, text);
    }
    match FILES
        .iter()
        .find(|file| name.is_some_and(|name| name == file.name))
    {
        Some(file) => file.check(path, text),
        None => checked(|problems| read_settings(path, text, problems)),
    }
}

fn check_palette(path: &Path, text: &str) -> Vec<Problem> {
    match Palette::parse(text) {
        Ok(palette) => {
            let complete = palette.complete();
            let not_hex = complete.not_hex();
            if not_hex.is_empty() {
                return Vec::new();
            }
            vec![Problem::whole(
                path,
                format!(
                    "{} are not hex, so colours mixed from them fall back",
                    not_hex.join(", ")
                ),
            )]
        }
        Err(error) => vec![Problem::toml(path, text, &error)],
    }
}

#[cfg(test)]
mod reading {
    use super::*;
    use serde::Deserialize;
    use std::collections::BTreeMap;

    #[derive(Debug, Default, Deserialize, PartialEq)]
    #[serde(deny_unknown_fields)]
    struct File {
        a: Option<u32>,
        b: Option<String>,
        t: Option<BTreeMap<String, u32>>,
    }

    fn read_text(text: &str) -> (Option<File>, Vec<Option<String>>) {
        let mut problems = Vec::new();
        let read = read::<File>(Path::new("f.toml"), text, &mut problems);
        (read, problems.into_iter().map(|p| p.key).collect())
    }

    #[test]
    fn each_value_that_does_not_read_is_left_out_and_the_rest_applies() {
        let text = "a = \"x\"\nb = \"é\"\nc = 1\nt.one = \"no\"\nt.two = 2\n";
        let (read, keys) = read_text(text);
        let read = read.unwrap();
        assert_eq!((read.a, read.b.as_deref()), (None, Some("é")));
        assert_eq!(read.t, Some(BTreeMap::from([("two".to_owned(), 2)])));
        assert_eq!(
            keys,
            [
                Some("a".to_owned()),
                Some("c".to_owned()),
                Some("t.one".to_owned())
            ]
        );
    }

    #[test]
    fn an_inline_table_keeps_its_other_keys() {
        let (read, keys) = read_text("t = { one = \"no\", two = 2 }\nb = \"é\"\n");
        assert_eq!(keys, [Some("t.one".to_owned())]);
        let read = read.unwrap();
        assert_eq!(read.t, Some(BTreeMap::from([("two".to_owned(), 2)])));
        assert_eq!(read.b.as_deref(), Some("é"), "places after stay");
    }

    #[test]
    fn toml_written_wrong_is_no_key_s_and_reads_nothing() {
        let (read, keys) = read_text("a = \n");
        assert_eq!((read, keys), (None, vec![None]));
    }
}
