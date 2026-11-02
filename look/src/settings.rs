//! The one schema of `look.toml` and of a theme's `banda.toml` (ADR 0007,
//! decision 2). Every key is optional: a layer says only what it changes,
//! and [`Settings::over`] lays one layer over another.

use crate::columns::ColumnsSettings;
use crate::fonts::FontSettings;
use crate::motion::MotionSettings;
use crate::notify::NotifySettings;
use crate::sound::SoundSettings;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use toml::Spanned;
use ts_rs::TS;

/// How Banda looks and sounds: the theme, tiles, columns, font, motion,
/// sounds and calls. A theme's `banda.toml` takes the same keys.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Settings {
    /// `"omarchy"`, `"banda"`, a theme's name, or `{ light, dark }`.
    #[schemars(with = "Option<ThemeChoice>")]
    pub theme: Option<Spanned<ThemeChoice>>,
    pub mode: Option<ModeChoice>,
    /// shadcn's `--radius`, in pixels: every corner is a step of it.
    #[schemars(range(min = 0))]
    pub radius: Option<f64>,
    /// Whether to take Hyprland's rounding, border and gaps.
    pub hyprland: Option<bool>,
    /// Palette entries over the theme's: a palette name or hex.
    #[serde(default)]
    #[schemars(with = "BTreeMap<String, String>")]
    pub colors: BTreeMap<String, Spanned<String>>,
    /// Tokens over the derived ones, by their names without `--`: a palette
    /// name, a token's name or any CSS colour.
    #[serde(default)]
    #[schemars(with = "BTreeMap<String, String>")]
    pub tokens: BTreeMap<String, Spanned<String>>,
    #[serde(default)]
    pub gaps: Gaps,
    /// The desk the tiles float over (ADR 0023).
    #[serde(default)]
    pub desk: Desk,
    #[serde(default)]
    pub tile: Tile,
    #[serde(default)]
    pub focus: Focus,
    #[serde(default)]
    pub bar: Bar,
    /// The drawer on Alt+` (ADR 0025, decision 8).
    #[serde(default)]
    pub drawer: Drawer,
    #[serde(default)]
    pub motion: MotionSettings,
    #[serde(default)]
    pub columns: ColumnsSettings,
    #[serde(default)]
    pub font: FontSettings,
    /// Banda's sounds (ADR 0009, decision 5).
    #[serde(default)]
    pub sound: SoundSettings,
    /// How Banda tells its Person of a call (ADR 0011, decision 7).
    #[serde(default)]
    pub notify: NotifySettings,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(untagged)]
pub enum ThemeChoice {
    One(String),
    Pair { light: String, dark: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ModeChoice {
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Gaps {
    #[schemars(range(min = 0))]
    pub inner: Option<f64>,
    #[schemars(range(min = 0))]
    pub outer: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Tile {
    pub radius: Option<Corner>,
    #[schemars(range(min = 0))]
    pub border: Option<f64>,
    /// How much the tiles without the focus darken, from 0 to 1, as
    /// Hyprland's `dim_inactive` and `dim_strength`.
    #[schemars(range(min = 0, max = 1))]
    pub dim_inactive: Option<f64>,
    /// How solid a tile is over a glass desk, from 0 to 1: 1 is solid.
    /// Without glass the tiles are solid.
    #[schemars(range(min = 0, max = 1))]
    pub opacity: Option<f64>,
    /// The shadow a tile casts on a glass desk, from 0 (none) to 1 (the
    /// darkest).
    #[schemars(range(min = 0, max = 1))]
    pub shadow: Option<f64>,
}

/// The desk: the bar, and the space around and between the tiles.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Desk {
    /// Glass: the desk shows the wallpaper behind it, blurred. Off, the
    /// desk is solid.
    pub glass: Option<bool>,
    /// `"banda"`: Banda draws the glass itself, from the wallpaper, the
    /// same everywhere. `"system"`: the system's own material, vibrancy on
    /// macOS and acrylic on Windows 11, or on Linux the compositor's blur
    /// of the desktop; it shows from Banda's next start. Unset, the
    /// platform's: the system's on macOS and Windows, Banda's on Linux
    /// (ADR 0030).
    pub material: Option<Material>,
    /// The picture Banda's glass is made of: a path, `~/` for home. With
    /// neither this nor `wallpaper-dark` set, the desktop's own wallpaper:
    /// Omarchy's, GNOME's and its family's, KDE's, XFCE's or hyprpaper's
    /// (ADR 0030).
    pub wallpaper: Option<String>,
    /// The picture for when Banda is dark, the same way; when one of the
    /// two is set, it is the picture for both. With neither set, the
    /// desktop's own dark wallpaper when it keeps one (GNOME and KDE do).
    pub wallpaper_dark: Option<String>,
    /// How frosted Banda's glass is: the blur's radius, in pixels.
    #[schemars(range(min = 0))]
    pub blur: Option<f64>,
    /// How vivid the wallpaper's colours stay under the glass: 1 as they
    /// are, more is richer, 0 is grey.
    #[schemars(range(min = 0))]
    pub saturation: Option<f64>,
    /// A fine grain over the glass, from 0 (none) to 1, so it reads as a
    /// material rather than a blurred photo.
    #[schemars(range(min = 0, max = 1))]
    pub grain: Option<f64>,
    /// The desk's tint over the blurred desktop, from 0 (clear) to 1
    /// (solid), with glass on.
    #[schemars(range(min = 0, max = 1))]
    pub opacity: Option<f64>,
    /// `"panel"`: the sidebar floats as a glass panel. `"desk"`: its rows
    /// sit right on the desk.
    pub sidebar: Option<SidebarStyle>,
    /// The shadow the sidebar's panel casts on a glass desk, from 0 (none)
    /// to 1 (the darkest).
    #[schemars(range(min = 0, max = 1))]
    pub sidebar_shadow: Option<f64>,
}

impl Desk {
    /// This layer's keys over `under`'s, key by key.
    pub fn over(self, under: Desk) -> Desk {
        Desk {
            glass: self.glass.or(under.glass),
            material: self.material.or(under.material),
            wallpaper: self.wallpaper.or(under.wallpaper),
            wallpaper_dark: self.wallpaper_dark.or(under.wallpaper_dark),
            blur: self.blur.or(under.blur),
            saturation: self.saturation.or(under.saturation),
            grain: self.grain.or(under.grain),
            opacity: self.opacity.or(under.opacity),
            sidebar: self.sidebar.or(under.sidebar),
            sidebar_shadow: self.sidebar_shadow.or(under.sidebar_shadow),
        }
    }
}

/// Who makes the desk's glass (ADR 0023).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Material {
    Banda,
    System,
}

impl Material {
    /// The platform's own glass (ADR 0030): the system's on macOS and
    /// Windows, which have a material for it, Banda's on Linux.
    pub const PLATFORM: Material = if cfg!(any(target_os = "macos", target_os = "windows")) {
        Material::System
    } else {
        Material::Banda
    };
}

/// How the sidebar sits on the desk.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum SidebarStyle {
    Panel,
    Desk,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Focus {
    /// The focused tile's border.
    #[schemars(with = "Option<String>")]
    pub border: Option<Spanned<String>>,
    /// Every other tile's.
    #[schemars(with = "Option<String>")]
    pub inactive_border: Option<Spanned<String>>,
    /// niri's focus ring: how far the focused tile's frame grows out
    /// into the gap, so nothing moves. It is the border's own colour, one
    /// frame and not two. 0 draws none.
    #[schemars(range(min = 0))]
    pub ring: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Bar {
    #[schemars(range(min = 0))]
    pub height: Option<f64>,
    /// How the bar shows the workspaces: `"numbers"`, or `"dots"` with the
    /// one shown drawn long, as GNOME's.
    pub workspaces: Option<Workspaces>,
}

/// The drawer: a Thread that drops from the top over the workspace.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Drawer {
    /// How far down it drops: a share of the room under the bar, from 0
    /// to 1.
    #[schemars(range(min = 0, max = 1))]
    pub height: Option<f64>,
    /// The Harness its Thread starts on, as `"claude"`; this computer's
    /// first one when left out.
    pub harness: Option<String>,
}

/// How the bar shows the workspaces.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Workspaces {
    Numbers,
    Dots,
}

/// Whether `v` is a share: from 0 to 1.
pub fn is_share(v: f64) -> bool {
    v.is_finite() && (0.0..=1.0).contains(&v)
}

/// A corner: a step of shadcn's ladder, or pixels.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(try_from = "toml::Value")]
pub enum Corner {
    Step(Step),
    Pixels(f64),
}

/// shadcn/ui's ladder: each step is `--radius` times its factor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Sm,
    Md,
    Lg,
    Xl,
    Xl2,
    Xl3,
    Xl4,
}

impl Step {
    pub const ALL: [(&'static str, Step, f64); 7] = [
        ("sm", Step::Sm, 0.6),
        ("md", Step::Md, 0.8),
        ("lg", Step::Lg, 1.0),
        ("xl", Step::Xl, 1.4),
        ("2xl", Step::Xl2, 1.8),
        ("3xl", Step::Xl3, 2.2),
        ("4xl", Step::Xl4, 2.6),
    ];

    pub fn factor(self) -> f64 {
        Step::ALL
            .iter()
            .find(|(_, step, _)| *step == self)
            .map_or(1.0, |(_, _, factor)| *factor)
    }
}

/// Written as it is read: the step's name, or pixels.
impl Serialize for Corner {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Corner::Pixels(px) => serializer.serialize_f64(*px),
            Corner::Step(step) => {
                let name = Step::ALL.iter().find(|(_, s, _)| s == step);
                serializer.serialize_str(name.map_or("lg", |(name, _, _)| name))
            }
        }
    }
}

impl JsonSchema for Corner {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "Corner".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        let steps: Vec<&str> = Step::ALL.iter().map(|(name, _, _)| *name).collect();
        schemars::json_schema!({
            "description": "A corner: a step of shadcn's ladder, or pixels.",
            "anyOf": [
                { "type": "number", "minimum": 0 },
                { "enum": steps },
            ],
        })
    }
}

impl TryFrom<toml::Value> for Corner {
    type Error = String;

    fn try_from(value: toml::Value) -> Result<Corner, String> {
        let steps = || {
            Step::ALL
                .iter()
                .map(|(name, _, _)| format!("\"{name}\""))
                .collect::<Vec<_>>()
                .join(", ")
        };
        match value {
            toml::Value::Integer(px) if px >= 0 => Ok(Corner::Pixels(px as f64)),
            toml::Value::Float(px) if px >= 0.0 => Ok(Corner::Pixels(px)),
            toml::Value::String(name) => Step::ALL
                .iter()
                .find(|(n, _, _)| *n == name)
                .map(|(_, step, _)| Corner::Step(*step))
                .ok_or_else(|| format!("\"{name}\" is no step; use pixels or one of {}", steps())),
            _ => Err(format!(
                "a corner is pixels (0 or more) or one of {}",
                steps()
            )),
        }
    }
}

impl Settings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: Settings) -> Settings {
        let mut colors = under.colors;
        colors.extend(self.colors);
        let mut tokens = under.tokens;
        tokens.extend(self.tokens);
        Settings {
            theme: self.theme.or(under.theme),
            mode: self.mode.or(under.mode),
            radius: self.radius.or(under.radius),
            hyprland: self.hyprland.or(under.hyprland),
            colors,
            tokens,
            gaps: Gaps {
                inner: self.gaps.inner.or(under.gaps.inner),
                outer: self.gaps.outer.or(under.gaps.outer),
            },
            desk: self.desk.over(under.desk),
            tile: Tile {
                radius: self.tile.radius.or(under.tile.radius),
                border: self.tile.border.or(under.tile.border),
                dim_inactive: self.tile.dim_inactive.or(under.tile.dim_inactive),
                opacity: self.tile.opacity.or(under.tile.opacity),
                shadow: self.tile.shadow.or(under.tile.shadow),
            },
            focus: Focus {
                border: self.focus.border.or(under.focus.border),
                inactive_border: self.focus.inactive_border.or(under.focus.inactive_border),
                ring: self.focus.ring.or(under.focus.ring),
            },
            bar: Bar {
                height: self.bar.height.or(under.bar.height),
                workspaces: self.bar.workspaces.or(under.bar.workspaces),
            },
            drawer: Drawer {
                height: self.drawer.height.or(under.drawer.height),
                harness: self.drawer.harness.or(under.drawer.harness),
            },
            motion: self.motion.over(under.motion),
            columns: self.columns.over(under.columns),
            font: self.font.over(under.font),
            sound: self.sound.over(under.sound),
            notify: self.notify.over(under.notify),
        }
    }

    /// Banda's own defaults: the bottom layer, with every key set.
    pub fn defaults() -> Settings {
        Settings {
            theme: None,
            mode: Some(ModeChoice::System),
            radius: Some(10.0),
            hyprland: Some(true),
            colors: BTreeMap::new(),
            tokens: BTreeMap::new(),
            gaps: Gaps {
                inner: Some(12.0),
                outer: Some(12.0),
            },
            desk: Desk {
                glass: Some(true),
                material: Some(Material::PLATFORM),
                wallpaper: None,
                wallpaper_dark: None,
                blur: Some(40.0),
                saturation: Some(1.4),
                grain: Some(0.04),
                opacity: Some(0.4),
                sidebar: Some(SidebarStyle::Panel),
                sidebar_shadow: Some(0.45),
            },
            tile: Tile {
                radius: Some(Corner::Step(Step::Xl)),
                border: Some(2.0),
                dim_inactive: Some(0.0),
                opacity: Some(0.95),
                shadow: Some(0.0),
            },
            focus: Focus {
                border: Some(Spanned::new(0..0, "accent".to_owned())),
                inactive_border: Some(Spanned::new(0..0, "border".to_owned())),
                ring: Some(0.0),
            },
            bar: Bar {
                height: Some(36.0),
                workspaces: Some(Workspaces::Numbers),
            },
            drawer: Drawer {
                height: Some(0.6),
                harness: None,
            },
            motion: MotionSettings::defaults(),
            columns: ColumnsSettings::defaults(),
            font: FontSettings::defaults(),
            sound: SoundSettings::defaults(),
            notify: NotifySettings::defaults(),
        }
    }

    /// Sizes that cannot be negative, which TOML alone does not refuse.
    pub fn negative_sizes(&self) -> Vec<&'static str> {
        [
            ("radius", self.radius),
            ("gaps.inner", self.gaps.inner),
            ("gaps.outer", self.gaps.outer),
            ("tile.border", self.tile.border),
            ("bar.height", self.bar.height),
            ("focus.ring", self.focus.ring),
            ("desk.blur", self.desk.blur),
            ("desk.saturation", self.desk.saturation),
        ]
        .into_iter()
        .filter(|(_, v)| v.is_some_and(|v| !(v.is_finite() && v >= 0.0)))
        .map(|(key, _)| key)
        .collect()
    }

    /// Shares outside 0 to 1, which the schema alone does not refuse.
    pub fn shares_out_of_range(&self) -> Vec<&'static str> {
        [
            ("tile.dim-inactive", self.tile.dim_inactive),
            ("tile.opacity", self.tile.opacity),
            ("tile.shadow", self.tile.shadow),
            ("desk.opacity", self.desk.opacity),
            ("desk.grain", self.desk.grain),
            ("desk.sidebar-shadow", self.desk.sidebar_shadow),
            ("drawer.height", self.drawer.height),
        ]
        .into_iter()
        .filter(|(_, v)| v.is_some_and(|v| !is_share(v)))
        .map(|(key, _)| key)
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_layer_says_only_what_it_changes() {
        let mine: Settings = toml::from_str("radius = 6\n[gaps]\ninner = 8\n").unwrap();
        let theirs: Settings = toml::from_str("[gaps]\ninner = 2\nouter = 3\n").unwrap();
        let look = mine.over(theirs.over(Settings::defaults()));
        assert_eq!(look.radius, Some(6.0));
        assert_eq!(look.gaps.inner, Some(8.0));
        assert_eq!(look.gaps.outer, Some(3.0));
        assert_eq!(look.tile.border, Some(2.0));
    }

    #[test]
    fn a_corner_is_a_step_or_pixels() {
        let step: Settings = toml::from_str("[tile]\nradius = \"lg\"\n").unwrap();
        assert_eq!(step.tile.radius, Some(Corner::Step(Step::Lg)));
        let px: Settings = toml::from_str("[tile]\nradius = 12\n").unwrap();
        assert_eq!(px.tile.radius, Some(Corner::Pixels(12.0)));
        let wrong = toml::from_str::<Settings>("[tile]\nradius = \"round\"\n").unwrap_err();
        assert!(wrong.message().contains("\"round\" is no step"), "{wrong}");
    }

    #[test]
    fn a_typo_is_named() {
        let typo = toml::from_str::<Settings>("[gaps]\ninnr = 3\n").unwrap_err();
        assert!(typo.message().contains("innr"), "{typo}");
    }
}
