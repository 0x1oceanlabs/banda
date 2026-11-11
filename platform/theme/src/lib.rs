//! The theme (ADR 0100, decision 1): where a theme is found, its palette
//! worked out into tokens, its fonts, and what the device says that the
//! theme takes: the desktop's wallpaper and Hyprland's windows.
//!
//! It is the look's lower half. `banda-look` lays it under the Person's
//! settings: `look.toml`, whose schema is still one with the rest of the
//! look's (ADR 0101 cuts it), and a theme's `banda.toml` in that schema,
//! which the look reads too. So this crate has only the theme's parts of
//! that schema, `[font]` and the glass's [`Material`]: it finds the
//! theme and works out its colours, and the look its sizes.

pub mod color;
pub mod file;
pub mod fonts;
pub mod hyprland;
pub mod palette;
pub mod theme;
pub mod tokens;
pub mod wallpaper;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use theme::{Layer, Listed, Origin, Picked, Places, Theme, Wrong};
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

impl Mode {
    /// `light` or `dark`, as the files say it.
    pub fn word(self) -> &'static str {
        match self {
            Mode::Light => "light",
            Mode::Dark => "dark",
        }
    }
}

/// What the device says of itself that the theme takes (ADR 0100,
/// decision 1), as the window reads it from the system and writes it to
/// `device.json` in Banda's state folder, where `banda look` reads it:
/// so the look a terminal prints is the window's.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "look/")]
pub struct Device {
    /// The accent set in the system's settings, `#rrggbb` (ADR 0075,
    /// decision 6): macOS's and Windows'.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    /// The system reduces transparency, as its accessibility settings
    /// say: glass is off while it does (ADR 0100, decision 4).
    #[serde(default)]
    pub reduce_transparency: bool,
    /// The system raises contrast, or forces its own colours: glass is
    /// off while it does (ADR 0100, decision 4).
    #[serde(default)]
    pub high_contrast: bool,
}

impl Device {
    /// Whether the system asks for no glass: it reduces transparency or
    /// raises contrast.
    pub fn plain(&self) -> bool {
        self.reduce_transparency || self.high_contrast
    }

    /// The device's file at `path`; a file that is not there, or does not
    /// read, says nothing. The window writes it, not the Person.
    pub fn read(path: &std::path::Path) -> Device {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
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

    /// The desk's tint over the platform's glass by default: light over the
    /// system's material, which is tinted already, denser over Banda's,
    /// where the wallpaper shows in its own colours (ADR 0030).
    pub const fn tint(self) -> f64 {
        match self {
            Material::System => 0.1,
            Material::Banda => 0.4,
        }
    }
}
