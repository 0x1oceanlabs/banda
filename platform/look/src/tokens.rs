//! Tokens from a palette: the one pure function between a theme and the
//! components (ADR 0007, decision 1, and its table).
//!
//! Omarchy's `accent` is the theme's colour: it goes to shadcn's
//! `--primary` and `--ring`. shadcn's `--accent` is something else, the
//! background of a row under the pointer.

use crate::color::mix;
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
