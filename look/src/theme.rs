//! Where themes are found, and what one holds: a folder with Omarchy's
//! `colors.toml` and, if its author wants, a `banda.toml` in the schema of
//! `look.toml` (ADR 0007, decisions 2 and 3).

use crate::palette::Palette;
use crate::settings::Settings;
use crate::{Mode, Problem};
use serde::Serialize;
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// Where to look, on this machine.
#[derive(Clone, Debug)]
pub struct Places {
    /// `~/.config/banda`: `look.toml`, `sidebar.toml`, and the Person's
    /// `themes/<name>/` and `sidebars/<name>.toml`.
    pub config: PathBuf,
    /// Omarchy's current theme, when Omarchy is installed.
    pub omarchy_current: Option<PathBuf>,
    /// Omarchy's current background, a link to the picture, beside its
    /// current theme (ADR 0023).
    pub omarchy_background: Option<PathBuf>,
    /// The Person's home, which `~/` in a path names.
    pub home: Option<PathBuf>,
    /// Omarchy's theme folders: the Person's first, then the system's.
    pub omarchy_themes: Vec<PathBuf>,
    /// fontconfig's folder of the Person's, `~/.config/fontconfig`, where
    /// Omarchy sets the system's monospace font. `None`: generic names
    /// stay generic.
    pub fontconfig: Option<PathBuf>,
    /// The desktop's names, lowercased, as `XDG_CURRENT_DESKTOP` lists
    /// them: which reader finds its wallpaper (ADR 0030).
    pub desktops: Vec<String>,
    /// The Person's config folder, `~/.config`, where KDE, XFCE and
    /// hyprpaper keep their wallpaper, and dconf GNOME's.
    pub config_home: Option<PathBuf>,
    /// The `gsettings` program, which reads GNOME's and its family's
    /// settings with their schemas' defaults.
    pub gsettings: Option<PathBuf>,
}

impl Places {
    /// Only `config`: no Omarchy, no system fonts, as a test wants.
    pub fn at(config: &Path) -> Places {
        Places {
            config: config.to_owned(),
            omarchy_current: None,
            omarchy_background: None,
            home: None,
            omarchy_themes: Vec::new(),
            fontconfig: None,
            desktops: Vec::new(),
            config_home: None,
            gsettings: None,
        }
    }

    /// The places on this machine. `BANDA_CONFIG` moves the config folder
    /// and `BANDA_OMARCHY` Omarchy's current theme (empty: no Omarchy);
    /// an empty `BANDA_FONTCONFIG` leaves the system's fonts unasked, and
    /// `BANDA_GSETTINGS` names `gsettings` (empty: none). So a test or a
    /// trial window runs beside the real one.
    pub fn from_env() -> Places {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let home_set = var("HOME");
        let home = home_set.clone().unwrap_or_default();
        let config_home = var("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        let state_home = var("XDG_STATE_HOME").unwrap_or_else(|| home.join(".local/state"));
        let config = var("BANDA_CONFIG").unwrap_or_else(|| config_home.join("banda"));
        let omarchy_current = match var("BANDA_OMARCHY") {
            Some(set) if set.as_os_str().is_empty() => None,
            Some(set) => Some(set),
            None => [
                state_home.join("omarchy/current/theme"),
                config_home.join("omarchy/current/theme"),
            ]
            .into_iter()
            .find(|folder| folder.join("colors.toml").is_file()),
        };
        Places {
            config,
            omarchy_background: omarchy_current
                .as_deref()
                .and_then(Path::parent)
                .map(|current| current.join("background")),
            omarchy_current,
            home: home_set,
            omarchy_themes: vec![
                config_home.join("omarchy/themes"),
                PathBuf::from("/usr/share/omarchy/themes"),
            ],
            fontconfig: match var("BANDA_FONTCONFIG") {
                Some(set) if set.as_os_str().is_empty() => None,
                Some(set) => Some(set),
                None => Some(config_home.join("fontconfig")),
            },
            desktops: std::env::var("XDG_CURRENT_DESKTOP")
                .unwrap_or_default()
                .split(':')
                .filter(|name| !name.is_empty())
                .map(str::to_lowercase)
                .collect(),
            gsettings: match var("BANDA_GSETTINGS") {
                Some(set) if set.as_os_str().is_empty() => None,
                Some(set) => Some(set),
                None => std::env::var_os("PATH").and_then(|path| {
                    std::env::split_paths(&path)
                        .map(|folder| folder.join("gsettings"))
                        .find(|program| program.is_file())
                }),
            },
            config_home: Some(config_home),
        }
    }

    pub fn look_file(&self) -> PathBuf {
        self.config.join("look.toml")
    }

    pub fn own_themes(&self) -> PathBuf {
        self.config.join("themes")
    }

    /// The sidebar's arrangement (ADR 0008).
    pub fn sidebar_file(&self) -> PathBuf {
        self.config.join("sidebar.toml")
    }

    pub fn browser_file(&self) -> PathBuf {
        self.config.join("browser.toml")
    }

    /// How messages to an Agent are sent (ADR 0016).
    pub fn agents_file(&self) -> PathBuf {
        self.config.join("agents.toml")
    }

    /// The keys the Person binds (ADR 0005, decision 11).
    pub fn keys_file(&self) -> PathBuf {
        self.config.join("keys.toml")
    }

    /// The Person's sidebar presets, `<name>.toml`.
    pub fn own_sidebars(&self) -> PathBuf {
        self.config.join("sidebars")
    }
}

/// Where a theme comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Origin {
    /// Shipped inside Banda.
    Banda,
    /// The Person's, in `~/.config/banda/themes/`.
    Yours,
    /// Omarchy's, by name.
    Omarchy,
    /// Whatever theme Omarchy shows now.
    Current,
}

/// One theme, read.
#[derive(Clone, Debug)]
pub struct Theme {
    pub name: String,
    pub origin: Origin,
    /// Its folder; none for Banda's own.
    pub folder: Option<PathBuf>,
    pub palette: Palette,
    pub settings: Settings,
    /// Its `banda.toml` and the text its settings were read from, so each
    /// key is known by its line; none for Banda's own, or with no file.
    pub banda_toml: Option<(PathBuf, String)>,
}

/// Banda's own themes: files in this crate, so they are examples too.
const BUILT_IN: [(&str, &str, &str); 2] = [
    (
        "banda-light",
        include_str!("../themes/banda-light/colors.toml"),
        include_str!("../themes/banda-light/banda.toml"),
    ),
    (
        "banda-dark",
        include_str!("../themes/banda-dark/colors.toml"),
        include_str!("../themes/banda-dark/banda.toml"),
    ),
];

/// A theme as `themes` lists it.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Listed {
    pub name: String,
    pub mode: Mode,
    pub origin: Origin,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

impl Places {
    /// The folders a theme of this name may be in, in the order they win.
    pub fn candidates(&self, name: &str) -> Vec<(Origin, PathBuf)> {
        if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
            return Vec::new();
        }
        let mut folders = vec![(Origin::Yours, self.own_themes().join(name))];
        folders.extend(
            self.omarchy_themes
                .iter()
                .map(|f| (Origin::Omarchy, f.join(name))),
        );
        folders
    }

    /// Reads the theme `name`: `omarchy` is Omarchy's current one, then
    /// Banda's own, the Person's and Omarchy's by name. Problems in its
    /// files go to `problems`; `None` when there is no such theme.
    pub fn theme(&self, name: &str, problems: &mut Vec<Problem>) -> Option<Theme> {
        if name == "omarchy" {
            let folder = self.omarchy_current.clone()?;
            return read_folder("omarchy", Origin::Current, &folder, problems);
        }
        if let Some((_, colors, banda)) = BUILT_IN.iter().find(|(n, _, _)| *n == name) {
            let palette = Palette::parse(colors).expect("Banda's own palettes parse");
            let settings = toml::from_str(banda).expect("Banda's own banda.toml parses");
            return Some(Theme {
                name: name.to_owned(),
                origin: Origin::Banda,
                folder: None,
                palette,
                settings,
                banda_toml: None,
            });
        }
        self.candidates(name)
            .into_iter()
            .find(|(_, folder)| folder.join("colors.toml").is_file())
            .and_then(|(origin, folder)| read_folder(name, origin, &folder, problems))
    }

    /// Every theme there is, Banda's first.
    pub fn themes(&self) -> Vec<Listed> {
        let mut listed: Vec<Listed> = BUILT_IN
            .iter()
            .map(|(name, colors, _)| Listed {
                name: (*name).to_owned(),
                mode: Palette::parse(colors)
                    .expect("Banda's own palettes parse")
                    .mode(),
                origin: Origin::Banda,
                folder: None,
            })
            .collect();
        let mut add = |name: String, origin: Origin, folder: &Path| {
            let Ok(text) = std::fs::read_to_string(folder.join("colors.toml")) else {
                return;
            };
            let Ok(palette) = Palette::parse(&text) else {
                return;
            };
            listed.push(Listed {
                name,
                mode: palette.mode(),
                origin,
                folder: Some(folder.display().to_string()),
            });
        };
        if let Some(current) = &self.omarchy_current {
            add("omarchy".to_owned(), Origin::Current, current);
        }
        let roots = std::iter::once((Origin::Yours, self.own_themes())).chain(
            self.omarchy_themes
                .iter()
                .map(|f| (Origin::Omarchy, f.clone())),
        );
        for (origin, root) in roots {
            let Ok(entries) = std::fs::read_dir(&root) else {
                continue;
            };
            let mut names: Vec<String> = entries
                .filter_map(|e| e.ok()?.file_name().into_string().ok())
                .filter(|n| !n.starts_with('.'))
                .collect();
            names.sort();
            for name in names {
                add(name.clone(), origin, &root.join(name));
            }
        }
        listed
    }
}

fn read_folder(
    name: &str,
    origin: Origin,
    folder: &Path,
    problems: &mut Vec<Problem>,
) -> Option<Theme> {
    let colors_path = folder.join("colors.toml");
    let text = std::fs::read_to_string(&colors_path).ok()?;
    let palette = match Palette::parse(&text) {
        Ok(palette) => palette,
        Err(error) => {
            problems.push(Problem::toml(&colors_path, &text, &error).left_out());
            return None;
        }
    };
    let banda_path = folder.join("banda.toml");
    let banda_toml = std::fs::read_to_string(&banda_path)
        .ok()
        .map(|text| (banda_path, text));
    let settings = banda_toml
        .as_ref()
        .and_then(|(path, text)| crate::read_settings(path, text, problems))
        .unwrap_or_default();
    Some(Theme {
        name: name.to_owned(),
        origin,
        folder: Some(folder.to_owned()),
        palette,
        settings,
        banda_toml,
    })
}
