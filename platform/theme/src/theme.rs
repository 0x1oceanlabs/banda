//! Where themes are found, and what one holds: a folder with a
//! `theme.toml`, light and dark inside, which may extend another theme
//! (ADR 0080, decisions 3 and 4); or an old one, Omarchy's `colors.toml`
//! and, if its author wants, a `banda.toml` in the schema of `look.toml`
//! (ADR 0007, decisions 2 and 3), which the look reads.

use crate::file::ThemeToml;
use crate::palette::Palette;
use crate::{Material, Mode};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
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
    /// The file the window writes what the system says of itself to, for
    /// the theme ([`crate::Device`]): `device.json` in Banda's state folder.
    pub device: Option<PathBuf>,
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
            device: None,
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
            device: None,
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

/// One scheme's theme, read: its palette and tokens, and the files that
/// say its shape, font and glass, for the look to read.
#[derive(Clone, Debug)]
pub struct Theme {
    /// As the look's layers name it: `<name>-light` and `<name>-dark` for
    /// each scheme of a theme of both.
    pub name: String,
    pub origin: Origin,
    /// Its folder; none for Banda's own.
    pub folder: Option<PathBuf>,
    /// By Omarchy's names: each theme's colours over those of the one it
    /// extends.
    pub palette: Palette,
    /// The tokens its `theme.toml` sets, each theme's over those of the
    /// one it extends: a palette name, a token's name or a CSS colour. An
    /// old `banda.toml` sets its own in `look.toml`'s schema.
    pub tokens: BTreeMap<String, String>,
    /// The tokens its `theme.toml` corrects over glass, `[glass.tokens]`,
    /// each theme's over those of the one it extends (ADR 0080, decision
    /// 8).
    pub glass: BTreeMap<String, String>,
    /// Its files that say its shape, font and glass, the one it extends
    /// first.
    pub layers: Vec<Layer>,
}

/// A theme's file that says its shape, font and glass in `look.toml`'s
/// keys, for the look to read.
#[derive(Clone, Debug)]
pub struct Layer {
    /// Where it is, so each key is known by its line; none for Banda's own.
    pub path: Option<PathBuf>,
    pub text: Cow<'static, str>,
    /// A `theme.toml`, which says them in its `[shape]`, `[font]` and
    /// `[glass]`; else an old `banda.toml`, which says them as `look.toml`
    /// does (ADR 0007, decision 3).
    pub theme_toml: bool,
}

impl Layer {
    fn inside(text: &'static str) -> Layer {
        Layer {
            path: None,
            text: Cow::Borrowed(text),
            theme_toml: true,
        }
    }
}

/// A theme as `look.toml`'s `theme` names it: both schemes, or the one it
/// has.
#[derive(Clone, Debug)]
pub enum Picked<T = Theme> {
    Both(T, T),
    One(T),
}

impl<T> Picked<T> {
    /// Each scheme, made into another thing.
    pub fn map<U>(self, mut f: impl FnMut(T) -> U) -> Picked<U> {
        match self {
            Picked::Both(light, dark) => Picked::Both(f(light), f(dark)),
            Picked::One(one) => Picked::One(f(one)),
        }
    }

    /// The scheme of `mode`, or the one there is.
    pub fn of(self, mode: Mode) -> T {
        match (self, mode) {
            (Picked::Both(light, _), Mode::Light) => light,
            (Picked::Both(_, dark), Mode::Dark) => dark,
            (Picked::One(one), _) => one,
        }
    }
}

/// Something wrong in a theme's file, where it is, for the look to name.
#[derive(Debug)]
pub struct Wrong {
    pub path: PathBuf,
    /// The file's text, which `span` is in.
    pub text: String,
    pub span: Option<Range<usize>>,
    pub message: String,
    /// The file is left out whole, as TOML written wrong is.
    pub left_out: bool,
}

impl Wrong {
    pub fn at(path: &Path, text: &str, span: Range<usize>, message: String) -> Wrong {
        Wrong {
            path: path.to_owned(),
            text: text.to_owned(),
            span: Some(span),
            message,
            left_out: false,
        }
    }

    /// Something wrong in the file as a whole, at no place in it.
    pub fn of_file(path: &Path, message: String) -> Wrong {
        Wrong {
            path: path.to_owned(),
            text: String::new(),
            span: None,
            message,
            left_out: false,
        }
    }

    pub fn toml(path: &Path, text: &str, error: &toml::de::Error) -> Wrong {
        Wrong {
            path: path.to_owned(),
            text: text.to_owned(),
            span: error.span(),
            message: error.message().trim().to_owned(),
            left_out: true,
        }
    }
}

/// A theme's `extends` that comes back round to it.
struct Cycle;

/// Banda's own themes, light and dark in each: files in this crate, so
/// they are examples too; each read once.
static BUILT_IN: LazyLock<[(&str, &str, ThemeToml); 2]> = LazyLock::new(|| {
    [
        ("banda", include_str!("../themes/banda/theme.toml")),
        ("macos", include_str!("../themes/macos/theme.toml")),
    ]
    .map(|(name, text)| {
        let file = crate::file::read(Path::new(name), text, &mut Vec::new());
        (name, text, file.expect("Banda's own theme.toml reads"))
    })
});

/// Omarchy's current theme's shape, under its own `banda.toml`: its
/// shape only, as its colours are its `colors.toml`'s until Omarchy's
/// theme is read as any other (ADR 0080, step 5).
const OMARCHY: &str = include_str!("../themes/omarchy/theme.toml");

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
    fn candidates(&self, name: &str) -> Vec<(Origin, PathBuf)> {
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

    /// The theme `"platform"` names on this device, its own (ADR 0100,
    /// decision 2): for now `omarchy` where Omarchy is, `macos` on a Mac,
    /// else `banda`. The whole order comes with the platforms' adapters.
    fn platform(&self) -> &'static str {
        if self.omarchy_current.is_some() {
            "omarchy"
        } else if self.mac {
            "macos"
        } else {
            "banda"
        }
    }

    /// The theme `name`, as `look.toml`'s `theme` names it: `"platform"`;
    /// `omarchy`, Omarchy's current one; Banda's own; the Person's and
    /// Omarchy's by name. `<theme>-light` and `<theme>-dark` are one scheme
    /// of a theme of both. Each file it reads or looks for goes to
    /// `watched`, and what is wrong in them to `wrong`. `None` when there
    /// is no such theme.
    pub fn theme(
        &self,
        name: &str,
        watched: &mut Vec<PathBuf>,
        wrong: &mut Vec<Wrong>,
    ) -> Option<Picked> {
        self.find(name, &mut Vec::new(), watched, wrong)
            .ok()
            .flatten()
    }

    /// [`Places::theme`], with the themes whose `extends` is being followed
    /// in `seen`.
    fn find(
        &self,
        name: &str,
        seen: &mut Vec<String>,
        watched: &mut Vec<PathBuf>,
        wrong: &mut Vec<Wrong>,
    ) -> Result<Option<Picked>, Cycle> {
        if name == "platform" {
            return self.find(self.platform(), seen, watched, wrong);
        }
        if name == "omarchy" {
            let Some(folder) = &self.omarchy_current else {
                return Ok(None);
            };
            watched.push(folder.join("colors.toml"));
            watched.push(folder.join("banda.toml"));
            return Ok(
                old_folder("omarchy", Origin::Current, folder, wrong).map(|mut theme| {
                    theme.layers.insert(0, Layer::inside(OMARCHY));
                    Picked::One(theme)
                }),
            );
        }
        let built_in = |name: &str| BUILT_IN.iter().find(|(n, ..)| *n == name);
        if let Some((name, text, file)) = built_in(name) {
            let layer = Layer::inside(text);
            return Ok(Some(over(name, Origin::Banda, None, layer, file, None)));
        }
        let scheme = name
            .strip_suffix("-light")
            .map(|stem| (stem, Mode::Light))
            .or_else(|| name.strip_suffix("-dark").map(|stem| (stem, Mode::Dark)));
        // One scheme of a theme of both.
        let half = |picked: Option<Picked>, mode: Mode| {
            let both = picked.filter(|picked| matches!(picked, Picked::Both(..)));
            both.map(|both| Picked::One(both.of(mode)))
        };
        // Banda's own scheme wins over a folder of its name, as it did.
        if let Some((stem, mode)) = scheme
            && built_in(stem).is_some()
        {
            return Ok(half(self.find(stem, seen, watched, wrong)?, mode));
        }
        let candidates = self.candidates(name);
        for (_, folder) in &candidates {
            for file in ["theme.toml", "colors.toml", "banda.toml"] {
                watched.push(folder.join(file));
            }
        }
        let found = candidates.into_iter().find(|(_, folder)| {
            folder.join("theme.toml").is_file() || folder.join("colors.toml").is_file()
        });
        match (found, scheme) {
            (Some((origin, folder)), _) => self.folder(name, origin, &folder, seen, watched, wrong),
            (None, Some((stem, mode))) => Ok(half(self.find(stem, seen, watched, wrong)?, mode)),
            (None, None) => Ok(None),
        }
    }

    /// The theme `name` in `folder`: its `theme.toml` over the theme it
    /// extends, or an old one's files.
    fn folder(
        &self,
        name: &str,
        origin: Origin,
        folder: &Path,
        seen: &mut Vec<String>,
        watched: &mut Vec<PathBuf>,
        wrong: &mut Vec<Wrong>,
    ) -> Result<Option<Picked>, Cycle> {
        let path = folder.join("theme.toml");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if path.is_file() => {
                let said = format!("it does not read: {error}");
                wrong.push(Wrong {
                    left_out: true,
                    ..Wrong::of_file(&path, said)
                });
                return Ok(None);
            }
            Err(_) => return Ok(old_folder(name, origin, folder, wrong).map(Picked::One)),
        };
        if seen.iter().any(|one| one == name) {
            return Err(Cycle);
        }
        let Some(file) = crate::file::read(&path, &text, wrong) else {
            return Ok(None);
        };
        seen.push(name.to_owned());
        // A theme of the Person's extends this device's own unless it says
        // another (ADR 0100, decision 2), and so does one whose base is
        // not there.
        let said = file.extends.as_ref();
        let mut base = said.and_then(|base| {
            let said = base.get_ref();
            let why = match self.find(said, seen, watched, wrong) {
                Ok(Some(found)) => return Some(found),
                Ok(None) => format!(
                    "there is no theme \"{said}\" to extend, so {name} extends \"platform\""
                ),
                Err(Cycle) => format!(
                    "extends = \"{said}\" comes back round to {name}, so {name} extends \"platform\""
                ),
            };
            wrong.push(Wrong::at(&path, &text, base.span(), why));
            None
        });
        if base.is_none() && said.is_none_or(|said| said.get_ref() != "platform") {
            base = self.find("platform", seen, watched, wrong).ok().flatten();
        }
        seen.pop();
        let layer = Layer {
            path: Some(path),
            text: Cow::Owned(text),
            theme_toml: true,
        };
        Ok(Some(over(name, origin, Some(folder), layer, &file, base)))
    }

    /// Every theme there is, Banda's first; each scheme of a theme of
    /// both by itself, as `<theme>-light` and `<theme>-dark`.
    pub fn themes(&self) -> Vec<Listed> {
        let mut listed = Vec::new();
        let mut add = |picked: Option<Picked>| {
            let schemes = match picked {
                Some(Picked::Both(light, dark)) => vec![light, dark],
                Some(Picked::One(theme)) => vec![theme],
                None => Vec::new(),
            };
            listed.extend(schemes.into_iter().map(|theme| Listed {
                mode: theme.palette.mode(),
                origin: theme.origin,
                folder: (theme.folder).map(|folder| folder.display().to_string()),
                name: theme.name,
            }));
        };
        let (mut watched, mut wrong) = (Vec::new(), Vec::new());
        for (name, ..) in BUILT_IN.iter() {
            add(self.theme(name, &mut watched, &mut wrong));
        }
        add(self.theme("omarchy", &mut watched, &mut wrong));
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
                let folder = root.join(&name);
                let read = self.folder(
                    &name,
                    origin,
                    &folder,
                    &mut Vec::new(),
                    &mut watched,
                    &mut wrong,
                );
                add(read.ok().flatten());
            }
        }
        listed
    }
}

/// The theme of `file`, `name`'s `theme.toml`, over `base`: both schemes
/// unless it extends a theme of one.
fn over(
    name: &str,
    origin: Origin,
    folder: Option<&Path>,
    layer: Layer,
    file: &ThemeToml,
    base: Option<Picked>,
) -> Picked {
    let scheme = |base: Option<Theme>, mode: Mode, name: String| {
        let mut theme = base.unwrap_or_else(|| {
            let mut palette = Palette::default();
            palette.set("mode", mode.word());
            Theme {
                name: String::new(),
                origin,
                folder: None,
                palette,
                tokens: BTreeMap::new(),
                glass: BTreeMap::new(),
                layers: Vec::new(),
            }
        });
        theme.name = name;
        theme.origin = origin;
        theme.folder = folder.map(Path::to_owned);
        for (key, value) in file.colors(mode) {
            theme.palette.set(key, value.clone());
        }
        (theme.tokens).extend(file.tokens(mode).clone());
        (theme.glass).extend(file.glass(mode).clone());
        theme.layers.push(layer.clone());
        theme
    };
    let (light, dark) = match base {
        Some(Picked::One(base)) => {
            let mode = base.palette.mode();
            return Picked::One(scheme(Some(base), mode, name.to_owned()));
        }
        Some(Picked::Both(light, dark)) => (Some(light), Some(dark)),
        None => (None, None),
    };
    let named = |mode: Mode| format!("{name}-{}", mode.word());
    Picked::Both(
        scheme(light, Mode::Light, named(Mode::Light)),
        scheme(dark, Mode::Dark, named(Mode::Dark)),
    )
}

/// An old theme's folder: Omarchy's `colors.toml`, and a `banda.toml` in
/// `look.toml`'s schema if its author wants one (ADR 0007, decision 3).
fn old_folder(name: &str, origin: Origin, folder: &Path, wrong: &mut Vec<Wrong>) -> Option<Theme> {
    let colors_path = folder.join("colors.toml");
    let text = std::fs::read_to_string(&colors_path).ok()?;
    let palette = match Palette::parse(&text) {
        Ok(palette) => palette,
        Err(error) => {
            wrong.push(Wrong::toml(&colors_path, &text, &error));
            return None;
        }
    };
    if let Some(said) = palette.not_hex_said() {
        wrong.push(Wrong::of_file(&colors_path, said));
    }
    let banda_path = folder.join("banda.toml");
    let banda_toml = std::fs::read_to_string(&banda_path).ok();
    Some(Theme {
        name: name.to_owned(),
        origin,
        folder: Some(folder.to_owned()),
        palette,
        tokens: BTreeMap::new(),
        glass: BTreeMap::new(),
        layers: (banda_toml.into_iter())
            .map(|text| Layer {
                path: Some(banda_path.clone()),
                text: Cow::Owned(text),
                theme_toml: false,
            })
            .collect(),
    })
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
