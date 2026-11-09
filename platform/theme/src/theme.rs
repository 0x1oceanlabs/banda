//! Where themes are found, and what one holds: a folder with Omarchy's
//! `colors.toml` and, if its author wants, a `banda.toml` in the schema of
//! `look.toml` (ADR 0007, decisions 2 and 3), which the look reads.

use crate::palette::Palette;
use crate::{Material, Mode};
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
    /// Omarchy sets the system's monospace font. Linux's only: elsewhere a
    /// fontconfig is one some program brought, not the system's (ADR
    /// 0047). `None`: the system names no font.
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
    /// Who makes the desk's glass where `[desk] material` says nothing:
    /// the platform's own, [`Material::PLATFORM`] on this machine. Taking
    /// it from here rather than from the build lets a test, and a Linux
    /// runner, ask for either (ADR 0030, decision 1).
    pub material: Material,
    /// This is a Mac, where Banda starts on the `macos` theme (ADR 0075,
    /// decision 2). From here rather than from the build, so a test asks
    /// for either.
    pub mac: bool,
}

impl Places {
    /// Only `config`: no Omarchy, no system fonts, and Banda the maker
    /// of the glass, as a test wants.
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
            material: Material::Banda,
            mac: false,
        }
    }

    /// The places on this machine, with Banda's config folder as the
    /// engine finds it (`engine/src/places.rs`, ADR 0033). `BANDA_OMARCHY`
    /// moves Omarchy's current theme (empty: no Omarchy);
    /// an empty `BANDA_FONTCONFIG` leaves the system's fonts unasked, and
    /// `BANDA_GSETTINGS` names `gsettings` (empty: none). So a test or a
    /// trial window runs beside the real one.
    pub fn from_env(config: PathBuf) -> Places {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let home_set = var("HOME");
        let home = home_set.clone().unwrap_or_default();
        let config_home = var("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        let state_home = var("XDG_STATE_HOME").unwrap_or_else(|| home.join(".local/state"));
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
                None => cfg!(target_os = "linux").then(|| config_home.join("fontconfig")),
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
                None => system_program("gsettings"),
            },
            config_home: Some(config_home),
            material: Material::PLATFORM,
            mac: cfg!(target_os = "macos"),
        }
    }

    pub fn look_file(&self) -> PathBuf {
        self.config.join("look.toml")
    }

    pub fn own_themes(&self) -> PathBuf {
        self.config.join("themes")
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
    /// What Banda says of it before its `banda.toml`, in the same schema:
    /// all a theme of Banda's own says, and Omarchy's current one's shape.
    pub inside: Option<&'static str>,
    /// Its `banda.toml` and its text, for the look to read in the schema
    /// of `look.toml`, so each key is known by its line (ADR 0007,
    /// decision 3); none for Banda's own, or with no file.
    pub banda_toml: Option<(PathBuf, String)>,
}

/// Under Omarchy's current theme's own `banda.toml`: Hyprland's
/// rounding, border and gaps are its shape, and its border is the focus,
/// as its windows show it, with no shadow beside it (ADR 0075, decisions
/// 3 and 5).
const OMARCHY: &str = "hyprland = true\n\n[focus]\nshadow = 0\n";

/// A theme's `colors.toml` that is no TOML: the theme is not read, and
/// the look names it, where it is.
#[derive(Debug)]
pub struct Unread {
    pub path: PathBuf,
    pub text: String,
    pub error: toml::de::Error,
}

/// Banda's own themes: files in this crate, so they are examples too.
const BUILT_IN: [(&str, &str, &str); 4] = [
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
    (
        "macos-light",
        include_str!("../themes/macos-light/colors.toml"),
        include_str!("../themes/macos-light/banda.toml"),
    ),
    (
        "macos-dark",
        include_str!("../themes/macos-dark/colors.toml"),
        include_str!("../themes/macos-dark/banda.toml"),
    ),
];

/// Whether `name` is a pair of Banda's own, shipped as `<name>-light` and
/// `<name>-dark`, which `theme = "<name>"` takes both of (ADR 0075).
pub fn is_pair(name: &str) -> bool {
    let light = format!("{name}-light");
    BUILT_IN.iter().any(|(n, _, _)| *n == light)
}

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
    /// Banda's own, the Person's and Omarchy's by name. `None` when
    /// there is no such theme; [`Unread`] when its palette is no TOML.
    pub fn theme(&self, name: &str) -> Option<Result<Theme, Box<Unread>>> {
        if name == "omarchy" {
            let folder = self.omarchy_current.as_ref()?;
            return read_folder("omarchy", Origin::Current, folder).map(|read| {
                read.map(|theme| Theme {
                    inside: Some(OMARCHY),
                    ..theme
                })
            });
        }
        if let Some((_, colors, banda)) = BUILT_IN.iter().find(|(n, _, _)| *n == name) {
            let palette = Palette::parse(colors).expect("Banda's own palettes parse");
            return Some(Ok(Theme {
                name: name.to_owned(),
                origin: Origin::Banda,
                folder: None,
                palette,
                inside: Some(banda),
                banda_toml: None,
            }));
        }
        self.candidates(name)
            .into_iter()
            .find(|(_, folder)| folder.join("colors.toml").is_file())
            .and_then(|(origin, folder)| read_folder(name, origin, &folder))
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

fn read_folder(name: &str, origin: Origin, folder: &Path) -> Option<Result<Theme, Box<Unread>>> {
    let colors_path = folder.join("colors.toml");
    let text = std::fs::read_to_string(&colors_path).ok()?;
    let palette = match Palette::parse(&text) {
        Ok(palette) => palette,
        Err(error) => {
            return Some(Err(Box::new(Unread {
                path: colors_path,
                text,
                error,
            })));
        }
    };
    let banda_path = folder.join("banda.toml");
    let banda_toml = std::fs::read_to_string(&banda_path)
        .ok()
        .map(|text| (banda_path, text));
    Some(Ok(Theme {
        name: name.to_owned(),
        origin,
        folder: Some(folder.to_owned()),
        palette,
        inside: None,
        banda_toml,
    }))
}

/// The system's program `name`, as the PATH finds it: on Linux one only
/// root changes ([`banda_kernel::host::only_root_changes`]), as the look
/// runs it outside the fence.
pub fn system_program(name: &str) -> Option<PathBuf> {
    system_program_on(name, &std::env::var_os("PATH")?)
}

/// [`system_program`], on `path`.
fn system_program_on(name: &str, path: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|folder| folder.join(name))
        .filter(|program| program.is_file())
        .find(|program| {
            !cfg!(target_os = "linux") || banda_kernel::host::only_root_changes(program)
        })
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn the_looks_programs_are_the_systems_never_one_in_the_home() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let mine = folder.path().join("sh");
        std::fs::write(&mine, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&mine, std::fs::Permissions::from_mode(0o755)).unwrap();
        let system = ["/usr/bin", "/bin"].map(PathBuf::from).into_iter();
        let system = system
            .clone()
            .find(|bin| banda_kernel::host::only_root_changes(&bin.join("sh")))
            .unwrap();
        let path = std::env::join_paths([folder.path(), &system]).unwrap();
        assert_eq!(system_program_on("sh", &path), Some(system.join("sh")));
        let path = std::env::join_paths([folder.path()]).unwrap();
        assert_eq!(system_program_on("sh", &path), None);
    }
}
