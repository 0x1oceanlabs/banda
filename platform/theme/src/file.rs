//! A theme's `theme.toml` (ADR 0080, decision 3): light and dark inside,
//! every key optional, a value one for both or `{ light, dark }`.
//!
//! This crate reads what it says of the theme: the theme it `extends`, its
//! `[colors]`, the palette by Omarchy's names, and its `[tokens]`. Its
//! `[shape]`, `[font]` and `[glass]` are `look.toml`'s keys, which the look
//! reads.

use crate::Mode;
use crate::color::{is_css_color, is_hex};
use crate::palette::mixes;
use crate::theme::Wrong;
use serde::Deserialize;
use serde::de::IgnoredAny;
use std::collections::BTreeMap;
use std::path::Path;
use toml::Spanned;

/// What a `theme.toml` says, as TOML reads it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Said {
    /// What the menu will call it.
    #[serde(rename = "name")]
    _name: Option<String>,
    extends: Option<Spanned<String>>,
    #[serde(default)]
    colors: BTreeMap<String, Spanned<toml::Value>>,
    #[serde(default)]
    tokens: BTreeMap<String, Spanned<toml::Value>>,
    #[serde(rename = "shape")]
    _shape: Option<IgnoredAny>,
    #[serde(rename = "font")]
    _font: Option<IgnoredAny>,
    #[serde(rename = "glass")]
    _glass: Option<IgnoredAny>,
}

/// A `theme.toml`, read: the theme it extends, and its colours and tokens
/// in each scheme.
#[derive(Clone, Debug, Default)]
pub struct ThemeToml {
    /// A theme's name, or `"platform"`, and where the file says it.
    pub extends: Option<Spanned<String>>,
    /// Light's, then dark's.
    colors: [BTreeMap<String, String>; 2],
    tokens: [BTreeMap<String, String>; 2],
}

impl ThemeToml {
    /// The palette entries it says in `mode`.
    pub fn colors(&self, mode: Mode) -> &BTreeMap<String, String> {
        &self.colors[mode as usize]
    }

    /// The tokens it sets in `mode`, by name.
    pub fn tokens(&self, mode: Mode) -> &BTreeMap<String, String> {
        &self.tokens[mode as usize]
    }
}

/// Reads `text`, the `theme.toml` at `path`. A colour or a token that does
/// not read, or could break the CSS it goes into, is named in `wrong` and
/// left out, and a colour the palette mixes that is not hex is named;
/// TOML written wrong, or a key a `theme.toml` does not have, leaves the
/// file out whole.
pub fn read(path: &Path, text: &str, wrong: &mut Vec<Wrong>) -> Option<ThemeToml> {
    let said: Said = match toml::from_str(text) {
        Ok(said) => said,
        Err(error) => {
            wrong.push(Wrong::toml(path, text, &error));
            return None;
        }
    };
    let mut read = ThemeToml {
        extends: said.extends,
        ..ThemeToml::default()
    };
    let mut each = |table: &str,
                    what: &str,
                    values: BTreeMap<String, Spanned<toml::Value>>,
                    into: &mut [BTreeMap<String, String>; 2]| {
        for (key, value) in values {
            let span = value.span();
            let both = match value.into_inner() {
                // Light and dark are inside: neither is a colour.
                _ if table == "colors" && key == "mode" => None,
                toml::Value::String(one) => Some([Some(one.clone()), Some(one)]),
                toml::Value::Table(sides) => sides_of(sides),
                _ => None,
            };
            match both {
                Some(both) if both.iter().flatten().all(|v| is_css_color(v)) => {
                    let not_hex = both.iter().flatten().any(|v| !is_hex(v.trim()));
                    if table == "colors" && not_hex && mixes(&key) {
                        let said =
                            format!("colors.{key} is not hex, so colours mixed from it fall back");
                        wrong.push(Wrong::at(path, text, span.clone(), said));
                    }
                    for (mode, value) in both.into_iter().enumerate() {
                        if let Some(value) = value {
                            into[mode].insert(key.clone(), value.trim().to_owned());
                        }
                    }
                }
                _ => wrong.push(Wrong::at(
                    path,
                    text,
                    span,
                    format!("{table}.{key} is {what}, or {{ light = …, dark = … }}"),
                )),
            }
        }
    };
    each("colors", "a colour", said.colors, &mut read.colors);
    let token = "a palette name, a token's name or a CSS colour";
    each("tokens", token, said.tokens, &mut read.tokens);
    Some(read)
}

/// `{ light, dark }`: each side a string, either left out; `None` when
/// it says anything else.
fn sides_of(sides: toml::Table) -> Option<[Option<String>; 2]> {
    let mut both = [None, None];
    for (side, value) in sides {
        let mode = match side.as_str() {
            "light" => Mode::Light,
            "dark" => Mode::Dark,
            _ => return None,
        };
        both[mode as usize] = Some(value.as_str()?.to_owned());
    }
    Some(both)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_text(text: &str) -> (Option<ThemeToml>, Vec<String>) {
        let mut wrong = Vec::new();
        let read = read(Path::new("theme.toml"), text, &mut wrong);
        (read, wrong.into_iter().map(|w| w.message).collect())
    }

    #[test]
    fn a_value_is_one_or_light_and_dark() {
        let (read, wrong) = read_text(
            "extends = \"banda\"\n[colors]\naccent = \"#2a9d8f\"\nbackground = { light = \"#f7fbfb\", dark = \"#0e1a1c\" }\n[tokens]\ncard = { dark = \"#101010\" }\n",
        );
        assert!(wrong.is_empty(), "{wrong:?}");
        let read = read.unwrap();
        assert_eq!(read.extends.as_ref().unwrap().get_ref(), "banda");
        assert_eq!(read.colors(Mode::Light)["accent"], "#2a9d8f");
        assert_eq!(read.colors(Mode::Dark)["accent"], "#2a9d8f");
        assert_eq!(read.colors(Mode::Light)["background"], "#f7fbfb");
        assert_eq!(read.colors(Mode::Dark)["background"], "#0e1a1c");
        assert!(read.tokens(Mode::Light).is_empty());
        assert_eq!(read.tokens(Mode::Dark)["card"], "#101010");
    }

    #[test]
    fn a_value_that_does_not_read_is_named_and_left_out() {
        let (read, wrong) = read_text(
            "[colors]\naccent = 3\nbackground = { light = \"#fff\", dim = \"#000\" }\nforeground = \"#111\"\n[tokens]\ncard = \"url(x);\"\n",
        );
        let read = read.unwrap();
        assert_eq!(read.colors(Mode::Light).len(), 1);
        assert!(read.tokens(Mode::Light).is_empty());
        assert_eq!(wrong.len(), 3, "{wrong:?}");
        assert!(wrong[0].starts_with("colors.accent"), "{wrong:?}");
    }

    #[test]
    fn a_colour_mixed_from_that_is_not_hex_is_named_and_kept() {
        let (read, wrong) = read_text(
            "[colors]\nblue = \"oklch(0.6 0.2 250)\"\nbrown = \"oklch(0.2 0 0)\"\nmode = \"dark\"\n",
        );
        let read = read.unwrap();
        assert_eq!(read.colors(Mode::Dark)["blue"], "oklch(0.6 0.2 250)");
        assert_eq!(read.colors(Mode::Light)["brown"], "oklch(0.2 0 0)");
        assert!(!read.colors(Mode::Light).contains_key("mode"));
        // blue is mixed, brown is not; light and dark are inside.
        assert_eq!(wrong.len(), 2, "{wrong:?}");
        assert!(wrong[0].starts_with("colors.blue is not hex"), "{wrong:?}");
        assert!(wrong[1].starts_with("colors.mode"), "{wrong:?}");
    }

    #[test]
    fn a_key_no_theme_has_leaves_the_file_out() {
        let (read, wrong) = read_text("[shape]\nradius = 4\n[colours]\naccent = \"#fff\"\n");
        assert!(read.is_none());
        assert!(wrong[0].contains("colours"), "{wrong:?}");
    }
}
