//! A theme's palette: Omarchy's `colors.toml`, key for key (ADR 0007,
//! decision 1).
//!
//! Older themes name fewer colours, by short names (`bg`) or only as the
//! terminal's `color0`…`color15`. [`Palette::complete`] fills in the rest
//! with the same cascade as Omarchy's own resolver, `omarchy-theme-color`,
//! so a theme reads here as it reads in Omarchy.

use crate::Mode;
use crate::color::{is_hex, mix};
use std::collections::BTreeMap;

/// The colours a theme names, by Omarchy's names, plus its `mode`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Palette {
    colors: BTreeMap<String, String>,
}

/// The sixteen terminal colours, by the names Omarchy maps them to.
pub const ANSI: [&str; 16] = [
    "background",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "foreground",
    "muted",
    "bright_red",
    "bright_green",
    "bright_yellow",
    "bright_blue",
    "bright_magenta",
    "bright_cyan",
    "bright_foreground",
];

impl Palette {
    /// Reads a `colors.toml`. Keys that are not strings are skipped, as
    /// Omarchy skips them; what is not TOML at all is an error.
    pub fn parse(text: &str) -> Result<Palette, toml::de::Error> {
        let table: toml::Table = toml::from_str(text)?;
        let colors = table
            .into_iter()
            .filter_map(|(key, value)| match value {
                toml::Value::String(text) => Some((key, text.trim().to_owned())),
                _ => None,
            })
            .collect();
        Ok(Palette { colors })
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.colors
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }

    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        self.colors.insert(key.to_owned(), value.into());
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.colors.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }

    /// The theme's mode: its `mode` (or older `theme_type`), else light
    /// when its background is light, as Omarchy decides.
    pub fn mode(&self) -> Mode {
        match self.get("mode").or_else(|| self.get("theme_type")) {
            Some("light") => Mode::Light,
            Some("dark") => Mode::Dark,
            _ => match self.get("background").and_then(rgb) {
                Some((r, g, b)) if u32::from(r) + u32::from(g) + u32::from(b) > 382 => Mode::Light,
                _ => Mode::Dark,
            },
        }
    }

    /// Every colour Omarchy's resolver would give, so a theme that names
    /// only some of them still has them all.
    pub fn complete(mut self) -> Palette {
        let alias = |p: &mut Palette, key: &str, from: &str| {
            if p.get(key).is_none()
                && let Some(value) = p.get(from).map(str::to_owned)
            {
                p.set(key, value);
            }
        };
        let or = |p: &Palette, keys: &[&str]| keys.iter().find_map(|k| p.get(k).map(str::to_owned));

        for (key, short) in [
            ("background", "bg"),
            ("dark_background", "dark_bg"),
            ("darker_background", "darker_bg"),
            ("lighter_background", "lighter_bg"),
            ("foreground", "fg"),
            ("dark_foreground", "dark_fg"),
            ("light_foreground", "light_fg"),
            ("bright_foreground", "bright_fg"),
        ] {
            alias(&mut self, key, short);
        }
        alias(&mut self, "background", "color0");
        alias(&mut self, "foreground", "color7");
        for (key, ansi) in [
            ("red", "color1"),
            ("green", "color2"),
            ("yellow", "color3"),
            ("blue", "color4"),
            ("magenta", "color5"),
            ("cyan", "color6"),
            ("bright_red", "color9"),
            ("bright_green", "color10"),
            ("bright_yellow", "color11"),
            ("bright_blue", "color12"),
            ("bright_magenta", "color13"),
            ("bright_cyan", "color14"),
        ] {
            alias(&mut self, key, ansi);
        }
        alias(&mut self, "magenta", "purple");
        alias(&mut self, "bright_magenta", "bright_purple");

        let fill = |p: &mut Palette, key: &str, value: Option<String>| {
            if p.get(key).is_none()
                && let Some(value) = value
            {
                p.set(key, value);
            }
        };
        let v = or(&self, &["color7", "foreground"]);
        fill(&mut self, "light_foreground", v);
        let v = or(&self, &["color15", "foreground"]);
        fill(&mut self, "bright_foreground", v);
        let v = or(&self, &["color0", "background"]);
        fill(&mut self, "lighter_background", v);
        let v = or(&self, &["color8", "foreground"]);
        fill(&mut self, "dark_foreground", v);
        let v = or(&self, &["color8", "dark_foreground"]);
        fill(&mut self, "muted", v);
        let v = or(
            &self,
            &["selection_background", "color8", "color0", "background"],
        );
        fill(&mut self, "selection", v);
        let v = or(&self, &["bright_foreground"]);
        fill(&mut self, "selection_foreground", v);
        let v = or(&self, &["yellow"]);
        fill(&mut self, "orange", v);

        let mixed = |p: &Palette, from: &str, with: &str, amount: f64| {
            p.get(from).and_then(|c| mix(c, with, amount))
        };
        let v = mixed(&self, "orange", "#000000", 0.5);
        fill(&mut self, "brown", v);
        let v = mixed(&self, "background", "#000000", 0.25);
        fill(&mut self, "dark_background", v);
        let v = mixed(&self, "background", "#000000", 0.5);
        fill(&mut self, "darker_background", v);
        for colour in ["red", "yellow", "green", "cyan", "blue", "magenta"] {
            let v = mixed(&self, colour, "#ffffff", 0.2);
            fill(&mut self, &format!("bright_{colour}"), v);
        }
        self
    }

    /// What to say of the colours that are not hex, which the derivation
    /// cannot mix; none when every one is.
    pub fn not_hex_said(&self) -> Option<String> {
        let not_hex = self.not_hex();
        (!not_hex.is_empty()).then(|| {
            format!(
                "{} are not hex, so colours mixed from them fall back",
                not_hex.join(", ")
            )
        })
    }

    /// Colours that are not hex, which the derivation cannot mix.
    pub fn not_hex(&self) -> Vec<&str> {
        mixed()
            .filter(|key| self.get(key).is_some_and(|v| !is_hex(v)))
            .collect()
    }
}

/// The colours the derivation mixes others from, which only hex can be.
fn mixed() -> impl Iterator<Item = &'static str> {
    ANSI.iter().copied().chain([
        "accent",
        "selection",
        "dark_background",
        "lighter_background",
    ])
}

/// Whether the derivation mixes other colours from `key`'s.
pub fn mixes(key: &str) -> bool {
    mixed().any(|one| one == key)
}

fn rgb(hex: &str) -> Option<(u8, u8, u8)> {
    crate::color::parse_hex(hex).map(|(r, g, b, _)| (r, g, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_theme_of_ansi_colours_gets_every_name() {
        let old = Palette::parse(
            r##"
            color0 = "#101010"
            color1 = "#cc0000"
            color7 = "#e0e0e0"
            color8 = "#808080"
            accent = "#3399ff"
            "##,
        )
        .unwrap()
        .complete();
        assert_eq!(old.get("background"), Some("#101010"));
        assert_eq!(old.get("foreground"), Some("#e0e0e0"));
        assert_eq!(old.get("red"), Some("#cc0000"));
        assert_eq!(old.get("muted"), Some("#808080"));
        assert_eq!(old.get("dark_background"), Some("#0c0c0c"));
        assert_eq!(old.get("bright_red"), Some("#d63333"));
        assert_eq!(old.mode(), Mode::Dark);
    }

    #[test]
    fn the_mode_comes_from_the_background_when_unsaid() {
        let light = Palette::parse(r##"background = "#f0f0f0""##).unwrap();
        assert_eq!(light.mode(), Mode::Light);
        let said = Palette::parse(
            r##"mode = "dark"
background = "#f0f0f0""##,
        )
        .unwrap();
        assert_eq!(said.mode(), Mode::Dark);
    }
}
