//! The one schema of `look.toml` and of a theme's `banda.toml` (ADR 0007,
//! decision 2). Every key is optional: a layer says only what it changes,
//! and [`Settings::over`] lays one layer over another.

use crate::columns::ColumnsSettings;
use crate::motion::MotionSettings;
use crate::notify::NotifySettings;
use crate::sound::SoundSettings;
pub use banda_theme::Material;
use banda_theme::fonts::FontSettings;
use banda_theme::hyprland::Windows;
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
    /// `"platform"`, this device's own, the default; `"omarchy"`, `"macos"`,
    /// `"banda"`, a theme's name, or `{ light, dark }`.
    #[schemars(with = "Option<ThemeChoice>")]
    pub theme: Option<Spanned<ThemeChoice>>,
    pub mode: Option<ModeChoice>,
    /// The old radius, which every corner was a step of: it reads as
    /// `[shape] roundness` of it over 7, its old default, so 7 is the
    /// theme's own corners and 0 squares them all.
    #[schemars(range(min = 0))]
    pub radius: Option<f64>,
    /// Whether to take Hyprland's rounding, border and gaps, glass or not.
    /// The `omarchy` theme does, whose shape they are.
    pub hyprland: Option<bool>,
    /// Palette entries over the theme's: a palette name or hex.
    #[serde(default)]
    #[schemars(with = "BTreeMap<String, String>")]
    pub colors: BTreeMap<String, Spanned<String>>,
    /// Colour tokens over the derived ones, by their names without `--`
    /// (`banda_theme::tokens::TOKENS`): a palette name, a token's name or
    /// a colour as it is, never `var()` or `color-mix()`.
    #[serde(default)]
    #[schemars(with = "BTreeMap<String, String>")]
    pub tokens: BTreeMap<String, Spanned<String>>,
    /// The corners (ADR 0080, decision 6).
    #[serde(default)]
    pub shape: Shape,
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
    /// The drawer, a quick Thread over the workspace (ADR 0025, decision 8).
    #[serde(default)]
    pub drawer: Drawer,
    /// The overview of every workspace (ADR 0025, decision 7).
    #[serde(default)]
    pub overview: Overview,
    /// How a Group of columns shows (ADR 0065).
    #[serde(default)]
    pub groups: Groups,
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

/// The corners, five levels, each inside the one before (ADR 0080,
/// decision 6): a theme says two, the window's and a control's, and the
/// rest follow. A tile's is the window's less the outer gap, a card's the
/// tile's less its padding but never below a control's, a chip's 0.6 of a
/// control's.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Shape {
    /// The window's corner, and the desk's, in pixels.
    #[schemars(range(min = 0))]
    pub window: Option<f64>,
    /// A button's, an input's and a select's corner, in pixels.
    #[schemars(range(min = 0))]
    pub control: Option<f64>,
    /// Controls and chips as pills, as Tahoe's are.
    pub pill: Option<bool>,
    /// Times every corner: 1 as the theme has them, 0 square, 1.2 a
    /// little rounder.
    #[schemars(range(min = 0))]
    pub roundness: Option<f64>,
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
    /// The tile's corner, when it is not the window's less the outer gap:
    /// pixels, or a step of a control's ("sm" … "4xl").
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
    /// (solid), with glass on: unset, 0.1 on macOS and Windows, whose
    /// material is tinted already, and 0.4 on Linux, where it is denser
    /// as its text needs over the wallpaper.
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
    /// The soft shadow the focused tile casts, glass or not, from 0 (none)
    /// to 1 (the darkest).
    #[schemars(range(min = 0, max = 1))]
    pub shadow: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Bar {
    #[schemars(range(min = 0))]
    pub height: Option<f64>,
    /// How the bar shows the workspaces: `"numbers"`, or `"dots"` with the
    /// one shown drawn long, as GNOME's.
    pub workspaces: Option<Workspaces>,
    /// The widgets on the bar's left, after the Mark, by id, in order: the
    /// workspaces, `"workspaces.list"` (ADR 0024, ADR 0064), and the Flow,
    /// `"window.flow"` (ADR 0098).
    pub left: Option<Vec<String>>,
    /// The widgets in the bar's middle, by id, in order: the sidebar's
    /// counts, `"sidebar.counts"`.
    pub center: Option<Vec<String>>,
    /// The widgets on the bar's right, by id, in order, before the
    /// engine's connection: the workspaces set aside, `"workspaces.aside"`.
    pub right: Option<Vec<String>>,
}

/// Banda's widgets in each part of the bar, by id (ADR 0024, decision 4).
/// The Flow stands beside the workspaces, as it arranges the desk (ADR
/// 0098, decision 20); a `left` of the Person's own replaces this list,
/// so one written before the Flow came has no Flow.
pub const BAR_LEFT: &[&str] = &["workspaces.list", "window.flow"];
pub const BAR_CENTER: &[&str] = &["sidebar.counts"];
pub const BAR_RIGHT: &[&str] = &[
    "workspaces.aside",
    "terminal.ports",
    "harnesses.limits",
    "notifications.recent",
    "clock.now",
];

pub(crate) fn owned(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|&id| id.to_owned()).collect()
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

/// The overview: every workspace zoomed out, one under another.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Overview {
    /// How far it zooms the workspaces out, at most, as niri's: 0.5 is
    /// half their size. Less, where the window is too narrow for it, or
    /// too short for them all, down to 0.15.
    #[schemars(range(min = 0, max = 1))]
    pub zoom: Option<f64>,
}

/// How a Group of columns shows (ADR 0065).
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Groups {
    /// Its look, before the plate was the only one: still read, so a
    /// `look.toml` that says it loads, and let go (ADR 0065).
    #[serde(rename = "look", skip_serializing)]
    #[schemars(skip)]
    _look: Option<serde::de::IgnoredAny>,
    /// A handle on its top edge under the pointer, with its name, that
    /// carries the whole Group: the mouse's one way to move a Group
    /// whole. Off unless set (ADR 0065).
    pub handle: Option<bool>,
    /// How its plate moves while its Agent works.
    pub working: Option<GroupWorking>,
    /// How its plate calls the Person when its Agent asks.
    pub asking: Option<GroupAsking>,
    /// How strong every state's colour is on its plate.
    pub saturation: Option<GroupSaturation>,
}

/// How a Group's plate moves while its Agent works (ADR 0065, decision 6).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum GroupWorking {
    /// Its fill breathes, slowly; its line stays still.
    Breath,
    /// Its line breathes; its fill stays still.
    Line,
    /// A soft band of light crosses the whole Group now and then.
    Sheen,
    /// It does not move.
    Still,
}

/// How a Group's plate calls when its Agent asks (ADR 0065, decision 6).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum GroupAsking {
    /// Two swells as the call comes, then still.
    Twice,
    /// Two swells, then a slow pulse until the Person answers.
    Pulse,
}

/// How strong the colours on a Group's plate are: every state's fill and
/// line, quieter or louder (ADR 0065, decision 6).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum GroupSaturation {
    Soft,
    Normal,
    Vivid,
}

/// How the bar shows the workspaces.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Workspaces {
    Numbers,
    Dots,
}

/// What a theme's `theme.toml` says of its shape, font and glass, in
/// `look.toml`'s keys (ADR 0080, decision 3). Its name, `extends`,
/// colours and tokens are the theme's, which `banda_theme` reads first,
/// and which refuses a key no `theme.toml` has.
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct ThemeFile {
    #[serde(default)]
    shape: ThemeShape,
    #[serde(default)]
    font: FontSettings,
    #[serde(default)]
    glass: ThemeGlass,
}

/// A theme's `[glass]`: `look.toml`'s `[desk]`, and the tokens it
/// corrects over glass, which `banda_theme` reads (ADR 0080, decision 8).
#[derive(Clone, Debug, Default)]
struct ThemeGlass {
    desk: Desk,
}

impl<'de> Deserialize<'de> for ThemeGlass {
    /// The table less its `tokens`, as `[desk]`: a key `[desk]` does not
    /// have is refused, as it is in `look.toml` (serde's `flatten` would
    /// let it by).
    fn deserialize<D: serde::Deserializer<'de>>(from: D) -> Result<Self, D::Error> {
        let mut table = toml::Table::deserialize(from)?;
        table.remove("tokens");
        let desk =
            Desk::deserialize(toml::Value::Table(table)).map_err(serde::de::Error::custom)?;
        Ok(ThemeGlass { desk })
    }
}

/// A theme's `[shape]`: `look.toml`'s sizes, its `[shape]`'s corners
/// among them, and where else its shape comes from.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct ThemeShape {
    /// `"hyprland"`: Hyprland's rounding, border and gaps, under it (ADR
    /// 0080, decision 9), as `hyprland = true` in `look.toml`.
    from: Option<ShapeFrom>,
    window: Option<f64>,
    control: Option<f64>,
    pill: Option<bool>,
    roundness: Option<f64>,
    /// The old radius, as `look.toml`'s.
    radius: Option<f64>,
    #[serde(default)]
    gaps: Gaps,
    #[serde(default)]
    tile: Tile,
    #[serde(default)]
    focus: Focus,
    #[serde(default)]
    bar: BarShape,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ShapeFrom {
    Hyprland,
}

/// The bar's height, the one key of `[bar]` a theme says.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct BarShape {
    height: Option<f64>,
}

impl ThemeFile {
    /// The layer it makes.
    pub(crate) fn settings(self) -> Settings {
        let shape = self.shape;
        Settings {
            radius: shape.radius,
            shape: Shape {
                window: shape.window,
                control: shape.control,
                pill: shape.pill,
                roundness: shape.roundness,
            },
            hyprland: shape.from.map(|ShapeFrom::Hyprland| true),
            gaps: shape.gaps,
            tile: shape.tile,
            focus: shape.focus,
            bar: Bar {
                height: shape.bar.height,
                ..Bar::default()
            },
            desk: self.glass.desk,
            font: self.font,
            ..Settings::default()
        }
    }
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

/// shadcn/ui's old ladder: each step is a control's corner times its
/// factor, as `[tile] radius` may still say it.
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
        // A layer's old radius is its roundness, over the layers under it
        // whichever name they say.
        let roundness = self
            .shape
            .roundness
            .or(self.old_roundness())
            .or(under.shape.roundness)
            .or(under.old_roundness());
        let mut colors = under.colors;
        colors.extend(self.colors);
        let mut tokens = under.tokens;
        tokens.extend(self.tokens);
        Settings {
            theme: self.theme.or(under.theme),
            mode: self.mode.or(under.mode),
            radius: self.radius.or(under.radius),
            shape: Shape {
                window: self.shape.window.or(under.shape.window),
                control: self.shape.control.or(under.shape.control),
                pill: self.shape.pill.or(under.shape.pill),
                roundness,
            },
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
                shadow: self.focus.shadow.or(under.focus.shadow),
            },
            bar: Bar {
                height: self.bar.height.or(under.bar.height),
                workspaces: self.bar.workspaces.or(under.bar.workspaces),
                left: self.bar.left.or(under.bar.left),
                center: self.bar.center.or(under.bar.center),
                right: self.bar.right.or(under.bar.right),
            },
            drawer: Drawer {
                height: self.drawer.height.or(under.drawer.height),
                harness: self.drawer.harness.or(under.drawer.harness),
            },
            overview: Overview {
                zoom: self.overview.zoom.or(under.overview.zoom),
            },
            groups: Groups {
                handle: self.groups.handle.or(under.groups.handle),
                working: self.groups.working.or(under.groups.working),
                asking: self.groups.asking.or(under.groups.asking),
                saturation: self.groups.saturation.or(under.groups.saturation),
                ..Groups::default()
            },
            motion: self.motion.over(under.motion),
            columns: self.columns.over(under.columns),
            font: self.font.over(under.font),
            sound: self.sound.over(under.sound),
            notify: self.notify.over(under.notify),
        }
    }

    /// The roundness the old `radius` says: of it over its default, 7.
    fn old_roundness(&self) -> Option<f64> {
        self.radius.map(|radius| radius / 7.0)
    }

    /// The layer Hyprland's windows make (ADR 0007, decision 8): its
    /// rounding is the window's corner (ADR 0100, decision 11), and a
    /// control's is a third of it, as Banda's own are of its window's, so
    /// a square Hyprland squares the controls too.
    pub fn of_hyprland(windows: Windows) -> Settings {
        Settings {
            shape: Shape {
                window: Some(windows.rounding),
                control: Some(windows.rounding / 3.0),
                ..Shape::default()
            },
            gaps: Gaps {
                inner: Some(windows.gaps),
                outer: Some(windows.gaps),
            },
            tile: Tile {
                radius: None,
                border: Some(windows.border),
                dim_inactive: windows.dim,
                opacity: None,
                shadow: None,
            },
            motion: MotionSettings {
                off: (!windows.animations).then_some(true),
                ..MotionSettings::default()
            },
            ..Settings::default()
        }
    }

    /// Banda's own defaults: the bottom layer, with every key set.
    /// `material` is the platform's, which the machine knows (ADR 0030).
    pub fn defaults(material: Material) -> Settings {
        Settings {
            theme: None,
            mode: Some(ModeChoice::System),
            radius: None,
            // Banda's own, as its theme says them (ADR 0100, decision 11).
            shape: Shape {
                window: Some(30.0),
                control: Some(10.0),
                pill: Some(false),
                roundness: Some(1.0),
            },
            hyprland: Some(false),
            colors: BTreeMap::new(),
            tokens: BTreeMap::new(),
            gaps: Gaps {
                inner: Some(8.0),
                outer: Some(8.0),
            },
            desk: Desk {
                glass: Some(true),
                material: Some(material),
                wallpaper: None,
                wallpaper_dark: None,
                blur: Some(40.0),
                saturation: Some(1.4),
                grain: Some(0.04),
                opacity: Some(material.tint()),
                sidebar: Some(SidebarStyle::Panel),
                sidebar_shadow: Some(0.45),
            },
            tile: Tile {
                radius: None,
                border: Some(1.0),
                dim_inactive: Some(0.0),
                opacity: Some(1.0),
                shadow: Some(0.0),
            },
            focus: Focus {
                border: Some(Spanned::new(0..0, "accent".to_owned())),
                inactive_border: Some(Spanned::new(0..0, "border".to_owned())),
                ring: Some(0.0),
                shadow: Some(0.25),
            },
            bar: Bar {
                height: Some(36.0),
                workspaces: Some(Workspaces::Numbers),
                left: Some(owned(BAR_LEFT)),
                center: Some(owned(BAR_CENTER)),
                right: Some(owned(BAR_RIGHT)),
            },
            drawer: Drawer {
                height: Some(0.6),
                harness: None,
            },
            overview: Overview { zoom: Some(0.35) },
            groups: Groups {
                handle: Some(false),
                working: Some(GroupWorking::Breath),
                asking: Some(GroupAsking::Twice),
                saturation: Some(GroupSaturation::Normal),
                ..Groups::default()
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
            ("shape.window", self.shape.window),
            ("shape.control", self.shape.control),
            ("shape.roundness", self.shape.roundness),
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
            ("overview.zoom", self.overview.zoom),
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
        let mine: Settings = toml::from_str("radius = 6\n[gaps]\ninner = 9\n").unwrap();
        let theirs: Settings = toml::from_str("[gaps]\ninner = 2\nouter = 3\n").unwrap();
        let look = mine.over(theirs.over(Settings::defaults(Material::Banda)));
        // The old radius scales Banda's own corners, as it scaled its own.
        assert_eq!(look.shape.roundness, Some(6.0 / 7.0));
        assert_eq!(look.shape.window, Some(30.0));
        assert_eq!(look.gaps.inner, Some(9.0));
        assert_eq!(look.gaps.outer, Some(3.0));
        assert_eq!(look.tile.border, Some(1.0));
    }

    #[test]
    fn an_old_radius_is_the_roundness_of_the_layer_that_says_it() {
        let theme: Settings = toml::from_str("[shape]\nroundness = 2\n").unwrap();
        let mine: Settings = toml::from_str("radius = 0\n").unwrap();
        assert_eq!(mine.clone().over(theme.clone()).shape.roundness, Some(0.0));
        assert_eq!(theme.over(mine).shape.roundness, Some(2.0));
    }

    #[test]
    fn rounding_twelve_is_the_windows_corner_and_a_third_of_it_a_controls() {
        let layer = Settings::of_hyprland(Windows {
            rounding: 12.0,
            border: 2.0,
            gaps: 5.0,
            dim: Some(0.3),
            animations: false,
        });
        assert_eq!(layer.shape.window, Some(12.0));
        assert_eq!(layer.shape.control, Some(4.0));
        assert_eq!(layer.tile.radius, None);
        assert_eq!(layer.gaps.inner, Some(5.0));
        assert_eq!(layer.tile.border, Some(2.0));
        assert_eq!(layer.tile.dim_inactive, Some(0.3));
        assert_eq!(layer.motion.off, Some(true));
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

    #[test]
    fn a_groups_old_look_still_loads() {
        let old: Settings = toml::from_str("[groups]\nlook = \"halo\"\nhandle = false\n").unwrap();
        assert_eq!(old.groups.handle, Some(false));
    }

    #[test]
    fn a_groups_plate_moves_as_its_keys_say() {
        let mine: Settings = toml::from_str(
            "[groups]\nworking = \"sheen\"\nasking = \"pulse\"\nsaturation = \"soft\"\n",
        )
        .unwrap();
        let groups = mine.over(Settings::defaults(Material::Banda)).groups;
        assert_eq!(groups.working, Some(GroupWorking::Sheen));
        assert_eq!(groups.asking, Some(GroupAsking::Pulse));
        assert_eq!(groups.saturation, Some(GroupSaturation::Soft));
        let none = Settings::default()
            .over(Settings::defaults(Material::Banda))
            .groups;
        assert_eq!(none.working, Some(GroupWorking::Breath));
        assert_eq!(none.asking, Some(GroupAsking::Twice));
        assert_eq!(none.saturation, Some(GroupSaturation::Normal));
        let wrong = toml::from_str::<Settings>("[groups]\nworking = \"blink\"\n").unwrap_err();
        assert!(wrong.message().contains("blink"), "{wrong}");
    }
}
