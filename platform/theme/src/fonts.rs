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
/// The usual text, in pixels, where the root is 16: the UI level's, and
/// shadcn's `text-sm`. The type scale is drawn at it.
const USUAL: f64 = 14.0;
/// The type scale (ADR 0113, decision 3): each level's size token and
/// line height token, and their pixels where the usual text is 14. Each
/// grows with the theme's size, as the root does: `macos`'s 13 and a
/// Person's size scale every level together.
pub const SCALE: &[(&str, &str, f64, f64)] = &[
    // A reply's first heading, a page's title.
    ("heading-size", "heading-leading", 18.0, 26.0),
    // A reply's second heading, a dialog's title.
    ("title-size", "title-leading", 16.0, 24.0),
    // A reply, the Person's message; in a Pane 40rem wide or more, the
    // wide one (ADR 0058).
    ("prose-size", "prose-leading", 14.0, 22.0),
    ("prose-wide-size", "prose-wide-leading", 15.0, 24.0),
    // Rows, work lines, menus, controls.
    ("ui-size", "ui-leading", 14.0, 20.0),
    // Code, diffs, commands, paths.
    ("code-size", "code-leading", 12.5, 20.0),
    // Times, counts, captions, small buttons.
    ("meta-size", "meta-leading", 12.0, 16.0),
    // Only inside small things: a key, a tag, a count on an icon, a
    // menu's label (Roma's answer, Q1).
    ("small-size", "small-leading", 11.0, 14.0),
    // The one number a Pane is about (Roma's answer, Q3).
    ("figure-size", "figure-leading", 28.0, 32.0),
];
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
            size: Some(USUAL),
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

    /// The CSS variables: each family as a CSS list, the root's size that
    /// makes the usual text `size`, and each level of the type scale at
    /// `size`. `system` names the system's font for a generic name, when it
    /// can tell.
    pub fn vars(&self, system: &dyn Fn(&str) -> Option<String>) -> Vec<(&'static str, String)> {
        let size = self
            .size
            .filter(|s| s.is_finite() && SIZES.contains(s))
            .unwrap_or(USUAL);
        let px = |at: f64| format!("{}px", crate::thousandths(at));
        let mut vars = Vec::with_capacity(3 + 2 * SCALE.len());
        vars.extend([
            (
                "font-family-sans",
                family(self.sans.as_deref(), "sans-serif", system),
            ),
            (
                "font-family-mono",
                family(self.mono.as_deref(), "monospace", system),
            ),
            ("text-root", px(size * 16.0 / USUAL)),
        ]);
        for (size_token, leading_token, at, leading) in SCALE {
            vars.push((size_token, px(size * at / USUAL)));
            vars.push((leading_token, px(size * leading / USUAL)));
        }
        vars
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

/// The system's font for a generic name, as the system's `fc-match` says
/// ([`crate::theme::system_program`]): the first of its names. `None`
/// without fontconfig.
pub fn fc_match(generic: &str, fontconfig: &Path) -> Option<String> {
    let out = Command::new(crate::theme::system_program("fc-match")?)
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

    #[test]
    fn every_level_of_the_type_scale_grows_with_the_size() {
        let level = |size: f64, name: &str| {
            let settings = FontSettings {
                size: Some(size),
                ..FontSettings::defaults()
            };
            let vars = settings.vars(&|_| None);
            vars.into_iter()
                .find(|(n, _)| *n == name)
                .map(|(_, value)| value)
                .unwrap_or_else(|| panic!("no {name}"))
        };
        assert_eq!(level(14.0, "ui-size"), "14px");
        assert_eq!(level(14.0, "meta-size"), "12px");
        assert_eq!(level(14.0, "meta-leading"), "16px");
        assert_eq!(level(14.0, "small-size"), "11px");
        assert_eq!(level(14.0, "code-size"), "12.5px");
        assert_eq!(level(14.0, "figure-size"), "28px");
        assert_eq!(level(14.0, "prose-wide-leading"), "24px");
        // `macos`'s 13: what was 12 in rem is 11.143 there, as it is now.
        assert_eq!(level(13.0, "ui-size"), "13px");
        assert_eq!(level(13.0, "meta-size"), "11.143px");
        assert_eq!(level(13.0, "heading-leading"), "24.143px");
    }
}
