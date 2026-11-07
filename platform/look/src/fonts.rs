//! `[font]`: the window's two families and its text size (ADR 0007,
//! decision 2).
//!
//! A family is a font's name, a CSS list of them, or a generic name such
//! as `monospace`. A generic name is the system's choice, which on Linux
//! fontconfig holds: Omarchy sets the monospace one, and
//! `omarchy-font-current` asks `fc-match` for it as this does. So the
//! terminal writes in Omarchy's font, and follows it when it changes
//! (ADR 0047: elsewhere, the font the window ships).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct FontSettings {
    /// The interface's text.
    pub sans: Option<String>,
    /// The terminal's and code's. `monospace`, the default, is the
    /// system's on Linux and JetBrains Mono elsewhere.
    pub mono: Option<String>,
    /// The interface's usual text, in pixels; everything measured in text
    /// grows with it, as with a zoom.
    #[schemars(range(min = 8, max = 32))]
    pub size: Option<f64>,
}

pub const SIZES: std::ops::RangeInclusive<f64> = 8.0..=32.0;
/// shadcn's usual text is `text-sm`, 0.875 of the root's.
const TEXT_SM: f64 = 0.875;
const GENERIC: [&str; 5] = ["monospace", "sans-serif", "serif", "system-ui", "cursive"];
/// The monospace the window ships, as `@fontsource-variable` names it.
const SHIPPED_MONO: &str = "JetBrains Mono Variable";

impl FontSettings {
    pub fn over(self, under: FontSettings) -> FontSettings {
        FontSettings {
            sans: self.sans.or(under.sans),
            mono: self.mono.or(under.mono),
            size: self.size.or(under.size),
        }
    }

    pub fn defaults() -> FontSettings {
        FontSettings {
            sans: Some("Inter Variable".to_owned()),
            mono: Some("monospace".to_owned()),
            size: Some(14.0),
        }
    }

    pub fn problems(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if let Some(size) = self.size
            && !(size.is_finite() && SIZES.contains(&size))
        {
            problems.push(format!(
                "font.size is from {} to {} pixels",
                SIZES.start(),
                SIZES.end()
            ));
        }
        for (key, family) in [("sans", &self.sans), ("mono", &self.mono)] {
            if family.as_deref().is_some_and(|f| f.trim().is_empty()) {
                problems.push(format!("font.{key} names a font"));
            }
        }
        problems
    }

    /// The CSS variables: each family as a CSS list, and the root's size
    /// that makes the usual text `size`. `system` names the system's font
    /// for a generic name, when it can tell.
    pub fn vars(&self, system: &dyn Fn(&str) -> Option<String>) -> Vec<(&'static str, String)> {
        let size = self
            .size
            .filter(|s| s.is_finite() && SIZES.contains(s))
            .unwrap_or(14.0);
        let root = (size / TEXT_SM * 1000.0).round() / 1000.0;
        vec![
            (
                "font-family-sans",
                family(self.sans.as_deref(), "sans-serif", system),
            ),
            (
                "font-family-mono",
                family(self.mono.as_deref(), "monospace", system),
            ),
            ("text-root", format!("{root}px")),
        ]
    }

    /// Whether a family here is the system's choice, so fontconfig's file
    /// is worth watching.
    pub fn asks_the_system(&self) -> bool {
        [&self.sans, &self.mono]
            .into_iter()
            .flatten()
            .any(|f| GENERIC.contains(&f.trim()))
    }
}

/// One family as a CSS list that always ends in its generic name.
fn family(value: Option<&str>, generic: &str, system: &dyn Fn(&str) -> Option<String>) -> String {
    let value = value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(generic);
    if value.contains(',') {
        return value.to_owned();
    }
    if GENERIC.contains(&value) {
        let shipped = (value == "monospace").then(|| SHIPPED_MONO.to_owned());
        return match system(value).or(shipped) {
            Some(name) => format!("{}, {value}", quoted(&name)),
            None => value.to_owned(),
        };
    }
    format!("{}, {generic}", quoted(value))
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", name.trim_matches(['"', '\'']).replace('"', ""))
}

/// The system's font for a generic name, as `fc-match` says: the first of
/// its names. `None` without fontconfig.
pub fn fc_match(generic: &str, fontconfig: &Path) -> Option<String> {
    let out = Command::new("fc-match")
        .arg(generic)
        .args(["-f", "%{family}"])
        .env("XDG_CONFIG_HOME", fontconfig.parent()?)
        .output()
        .ok()?;
    let names = String::from_utf8(out.stdout).ok()?;
    let first = names.split(',').next()?.trim();
    (out.status.success() && !first.is_empty()).then(|| first.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_family_ends_in_its_generic_name() {
        let none = |_: &str| None;
        let geist = |_: &str| Some("GeistMono Nerd Font".to_owned());
        assert_eq!(
            family(Some("Inter Variable"), "sans-serif", &none),
            "\"Inter Variable\", sans-serif"
        );
        assert_eq!(
            family(Some("monospace"), "monospace", &geist),
            "\"GeistMono Nerd Font\", monospace"
        );
        assert_eq!(
            family(Some("monospace"), "monospace", &none),
            "\"JetBrains Mono Variable\", monospace"
        );
        assert_eq!(family(Some("serif"), "sans-serif", &none), "serif");
        assert_eq!(
            family(Some("\"Iosevka\", monospace"), "monospace", &none),
            "\"Iosevka\", monospace"
        );
    }

    #[test]
    fn the_size_is_the_usual_text() {
        let vars = FontSettings::defaults().vars(&|_| None);
        assert!(vars.contains(&("text-root", "16px".to_owned())));
        let big = FontSettings {
            size: Some(16.0),
            ..FontSettings::defaults()
        };
        assert!(
            big.vars(&|_| None)
                .contains(&("text-root", "18.286px".to_owned()))
        );
        let wrong = FontSettings {
            size: Some(2.0),
            ..FontSettings::defaults()
        };
        assert_eq!(wrong.problems().len(), 1);
    }
}
