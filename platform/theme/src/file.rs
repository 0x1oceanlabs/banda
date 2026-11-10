//! A theme's `theme.toml` (ADR 0080, decision 3): light and dark inside,
//! every key optional, a value one for both or `{ light, dark }`.
//!
//! This crate reads what it says of the theme: the theme it `extends`, its
//! `[colors]`, the palette by Omarchy's names, its `[tokens]`, and the
//! tokens `[glass.tokens]` corrects over glass (ADR 0080, decision 8). Its
//! `[shape]`, `[font]` and the rest of `[glass]` are `look.toml`'s keys,
//! which the look reads.

use crate::Mode;
use crate::color::{is_css_color, is_hex};
use crate::palette::mixes;
use crate::theme::Wrong;
use crate::tokens;
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
    #[serde(default)]
    glass: GlassSaid,
}

/// A `theme.toml`'s `[glass]`: its `tokens`, and `look.toml`'s `[desk]`
/// keys, the look's to read.
#[derive(Default, Deserialize)]
struct GlassSaid {
    #[serde(default)]
    tokens: BTreeMap<String, Spanned<toml::Value>>,
    #[serde(flatten)]
    _desk: BTreeMap<String, IgnoredAny>,
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
    glass: [BTreeMap<String, String>; 2],
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

    /// The tokens it corrects over glass in `mode`, by name.
    pub fn glass(&self, mode: Mode) -> &BTreeMap<String, String> {
        &self.glass[mode as usize]
    }
}

/// Reads `text`, the `theme.toml` at `path`. A colour or a token that does
/// not read, is not a value or could break the CSS it goes into, and a
/// token the list does not have, are named in `wrong` and left out; a
/// token's old name sets it and is named, and a colour the palette mixes
/// that is not hex is named;
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
            // A token by its name now: one that is not, or that `[tokens]`
            // does not set, is named and left out.
            let key = if table != "colors" {
                // Told of the table it is in: `[tokens]` or `[glass.tokens]`.
                let told = |said: String| {
                    (said.replace("tokens.", &format!("{table}.")))
                        .replace("[tokens]", &format!("[{table}]"))
                };
                match tokens::set_by(&key) {
                    Ok((name, note)) => {
                        if let Some(note) = note {
                            wrong.push(Wrong::at(path, text, span.clone(), told(note)));
                        }
                        name.to_owned()
                    }
                    Err(said) => {
                        wrong.push(Wrong::at(path, text, span, told(said)));
                        continue;
                    }
                }
            } else {
                key
            };
            let both = match value.into_inner() {
                // Light and dark are inside: neither is a colour.
                _ if table == "colors" && key == "mode" => None,
                toml::Value::String(one) => Some([Some(one.clone()), Some(one)]),
                toml::Value::Table(sides) => sides_of(sides),
                _ => None,
            };
            // Only the accent may be the system's (ADR 0075, decision 6).
            let system = |v: &String| table == "colors" && v.trim() == tokens::SYSTEM_ACCENT;
            match both {
                Some(both) if both.iter().flatten().any(system) && key != "accent" => {
                    let said = format!(
                        "colors.{key} cannot be \"{}\": only the accent is the system's",
                        tokens::SYSTEM_ACCENT
                    );
                    wrong.push(Wrong::at(path, text, span, said));
                }
                Some(both) if both.iter().flatten().all(|v| is_css_color(v)) => {
                    let not_hex = (both.iter().flatten()).any(|v| !is_hex(v.trim()) && !system(v));
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
    each("glass.tokens", token, said.glass.tokens, &mut read.glass);
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
    fn glass_tokens_are_tokens_and_the_rest_of_glass_is_the_looks() {
        let (read, wrong) = read_text(
            "[glass]\nopacity = 0.5\nblur = 30\n[glass.tokens]\nmuted = { light = \"#0000001a\" }\nborder = \"foreground\"\nradius = \"#fff\"\n",
        );
        let read = read.unwrap();
        assert_eq!(read.glass(Mode::Light)["muted"], "#0000001a");
        assert!(!read.glass(Mode::Dark).contains_key("muted"));
        assert_eq!(read.glass(Mode::Dark)["border"], "foreground");
        assert!(read.tokens(Mode::Light).is_empty());
        // A token that is no colour is named, as in `[tokens]`.
        assert!(!read.glass(Mode::Light).contains_key("control-radius"));
        assert_eq!(
            wrong,
            ["glass.tokens.radius is a length; [glass.tokens] sets only colours for now"]
        );
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
    fn a_token_is_one_of_the_list_and_a_value() {
        let (read, wrong) = read_text(
            "[colors]\naccent = \"system\"\nblue = \"system\"\n[tokens]\ncrad = \"#fff\"\ngap-inner = \"8px\"\ncard = \"var(--muted)\"\nring = \"blue\"\n",
        );
        let read = read.unwrap();
        assert_eq!(read.colors(Mode::Light)["accent"], "system");
        assert!(!read.colors(Mode::Light).contains_key("blue"));
        assert_eq!(read.tokens(Mode::Dark).keys().collect::<Vec<_>>(), ["ring"]);
        // blue may not be the system's; crad is no token; gap-inner is a
        // length; var() is no value. The accent being "system" is not hex
        // and is not named.
        assert_eq!(wrong.len(), 4, "{wrong:?}");
        assert!(wrong[0].starts_with("colors.blue cannot be"), "{wrong:?}");
        assert_eq!(
            wrong[1],
            "tokens.card is a palette name, a token's name or a CSS colour, or { light = …, dark = … }"
        );
        assert_eq!(wrong[2], "there is no token \"crad\"");
        assert!(wrong[3].contains("is a length"), "{wrong:?}");
    }

    #[test]
    fn a_key_no_theme_has_leaves_the_file_out() {
        let (read, wrong) = read_text("[shape]\nradius = 4\n[colours]\naccent = \"#fff\"\n");
        assert!(read.is_none());
        assert!(wrong[0].contains("colours"), "{wrong:?}");
    }
}
