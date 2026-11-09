//! Tokens from a palette: the one pure function between a theme and the
//! components (ADR 0007, decision 1, and its table).
//!
//! Omarchy's `accent` is the theme's colour: it goes to shadcn's
//! `--primary` and `--ring`. shadcn's `--accent` is something else, the
//! background of a row under the pointer.

use crate::color::{is_css_color, is_hex, mix};
use crate::palette::{ANSI, Palette};
use std::collections::BTreeMap;

/// The tokens of one palette, by their names without `--`. A palette
/// colour that is not hex cannot be mixed; tokens that need a mix of it
/// fall back to the nearest unmixed colour.
pub fn derive(palette: &Palette) -> BTreeMap<String, String> {
    let get = |key: &str| palette.get(key).unwrap_or("#000000").to_owned();
    let background = get("background");
    let foreground = get("foreground");
    let accent = palette
        .get("accent")
        .map_or_else(|| get("blue"), str::to_owned);
    let mixed = |a: &str, b: &str, amount: f64| mix(a, b, amount).unwrap_or_else(|| a.to_owned());
    let surface = mixed(&background, &foreground, 0.08);
    let line = mixed(&background, &foreground, 0.12);
    let sidebar = get("dark_background");

    let mut tokens = BTreeMap::new();
    let mut put = |name: &str, value: &str| {
        tokens.insert(name.to_owned(), value.to_owned());
    };
    put("background", &background);
    put("foreground", &foreground);
    put("card", &background);
    put("card-foreground", &foreground);
    put("popover", &get("lighter_background"));
    put("popover-foreground", &foreground);
    put("primary", &accent);
    put("primary-foreground", &background);
    put("secondary", &surface);
    put("secondary-foreground", &foreground);
    put("muted", &surface);
    put("muted-foreground", &get("dark_foreground"));
    put("accent", &surface);
    put("accent-foreground", &foreground);
    put("destructive", &get("red"));
    put("attention", &get("orange"));
    put("warning", &get("yellow"));
    put("added", &get("green"));
    put("removed", &get("red"));
    put("border", &line);
    put("input", &line);
    put("ring", &accent);
    for (n, colour) in ["blue", "green", "yellow", "magenta", "cyan"]
        .iter()
        .enumerate()
    {
        put(&format!("chart-{}", n + 1), &get(colour));
    }
    put("sidebar", &sidebar);
    put("sidebar-foreground", &foreground);
    put("sidebar-primary", &accent);
    put("sidebar-primary-foreground", &background);
    put("sidebar-accent", &mixed(&sidebar, &accent, 0.18));
    put("sidebar-accent-foreground", &foreground);
    put("sidebar-border", &line);
    put("sidebar-ring", &accent);
    put("selection", &get("selection"));
    put("selection-foreground", &get("selection_foreground"));
    // Omarchy's cursor is its brightest foreground.
    put("cursor", &get("bright_foreground"));
    for (n, key) in ANSI.iter().enumerate() {
        put(&format!("ansi-{n}"), &get(key));
    }
    tokens
}

/// One theme's colours as CSS variables, `--` included: its palette
/// under the `colors` the layers replace, each a palette name or hex,
/// derived into tokens, under the `tokens` they replace, each a palette
/// name, a token's name or a CSS colour. Last the focus: the focused
/// tile's `border` and every other's, named so, else `primary` and
/// `border`.
pub fn scheme<'a>(
    palette: &Palette,
    colors: impl IntoIterator<Item = (&'a str, &'a str)>,
    tokens: impl IntoIterator<Item = (&'a str, &'a str)>,
    border: Option<&str>,
    inactive_border: Option<&str>,
) -> BTreeMap<String, String> {
    let base = palette.clone().complete();
    let mut palette = base.clone();
    for (key, value) in colors {
        let resolved = base
            .get(value)
            .map(str::to_owned)
            .or_else(|| is_hex(value).then(|| value.to_owned()));
        if let Some(resolved) = resolved {
            palette.set(key, resolved);
        }
    }
    let palette = palette.complete();
    let mut derived = derive(&palette);
    let refer = |derived: &BTreeMap<String, String>, value: &str| -> Option<String> {
        palette
            .get(value)
            .map(str::to_owned)
            .or_else(|| derived.get(value).cloned())
            .or_else(|| is_css_color(value).then(|| value.to_owned()))
    };
    for (key, value) in tokens {
        if let Some(resolved) = refer(&derived, value) {
            derived.insert(key.to_owned(), resolved);
        }
    }
    let focus = |value: Option<&str>, fallback: &str| {
        value
            .and_then(|v| refer(&derived, v))
            .or_else(|| derived.get(fallback).cloned())
            .unwrap_or_default()
    };
    let active = focus(border, "primary");
    let inactive = focus(inactive_border, "border");
    derived.insert("focus".to_owned(), active);
    derived.insert("focus-inactive".to_owned(), inactive);
    derived
        .into_iter()
        .map(|(k, v)| (format!("--{k}"), v))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omarchy_accent_is_shadcn_primary() {
        let palette = Palette::parse(
            r##"
            accent = "#a3b88c"
            background = "#19251f"
            foreground = "#dac49d"
            "##,
        )
        .unwrap()
        .complete();
        let tokens = derive(&palette);
        assert_eq!(tokens["primary"], "#a3b88c");
        assert_eq!(tokens["ring"], "#a3b88c");
        assert_eq!(tokens["accent"], tokens["muted"]);
        assert_eq!(tokens["ansi-0"], "#19251f");
        assert_eq!(tokens["ansi-7"], "#dac49d");
    }
}
