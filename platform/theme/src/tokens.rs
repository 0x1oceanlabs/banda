//! The tokens (ADR 0080, decisions 5 and 7): the one list of them, and
//! the pure function from a palette to their values (ADR 0007, decision
//! 1, and its table).
//!
//! The list is what every client draws: each token's name, what its
//! value is, and its group. From it `banda-look`'s tests write the CSS
//! the page reads before the first look comes and a TypeScript object for
//! other clients, into `sdk/contract/src/generated/look/` (`tokens.css`,
//! `tokens.ts`). Every token resolves to a value: a colour, a length, a
//! number or a font's names, never a `var()` or a `color-mix()`, so a
//! phone can draw it.
//!
//! Omarchy's `accent` is the theme's colour: it goes to shadcn's
//! `--primary` and `--ring`. shadcn's `--accent` is something else, the
//! background of a row under the pointer.

use crate::color::{Oklab, is_css_color, is_hex, mix, thinned};
use crate::palette::{ANSI, Palette};
use crate::readable::{self, MARK, Under};
use crate::{Device, Mode};
use std::collections::{BTreeMap, BTreeSet};

/// What a token's value is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Hex, a colour function such as `oklch()`, or a word such as
    /// `transparent`.
    Colour,
    /// In pixels: `8px`.
    Length,
    /// No unit: `0.25`.
    Number,
    /// `40%`.
    Percentage,
    /// A list of font families, as CSS's `font-family` says it.
    Font,
}

/// What a token is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    /// shadcn/ui's own, which every component reads.
    Shadcn,
    /// shadcn/ui's sidebar's.
    Sidebar,
    /// What waits, works, changed or failed.
    State,
    /// How the focused tile stands out.
    Focus,
    /// The desk under the tiles, and its glass (ADR 0023).
    Desk,
    /// The tiles.
    Tile,
    /// A Thread's surfaces (ADR 0058).
    Chat,
    /// A Project's sign (ADR 0070).
    Sign,
    /// An account's emblem (ADR 0093).
    Account,
    /// The terminal's colours.
    Terminal,
    /// The gaps and the bar.
    Layout,
    /// The corners: five levels, each inside the one before (ADR 0080,
    /// decision 6).
    Radius,
    /// The type.
    Font,
}

impl Kind {
    pub fn word(self) -> &'static str {
        match self {
            Kind::Colour => "colour",
            Kind::Length => "length",
            Kind::Number => "number",
            Kind::Percentage => "percentage",
            Kind::Font => "font",
        }
    }
}

impl Group {
    pub fn word(self) -> &'static str {
        match self {
            Group::Shadcn => "shadcn",
            Group::Sidebar => "sidebar",
            Group::State => "state",
            Group::Focus => "focus",
            Group::Desk => "desk",
            Group::Tile => "tile",
            Group::Chat => "chat",
            Group::Sign => "sign",
            Group::Account => "account",
            Group::Terminal => "terminal",
            Group::Layout => "layout",
            Group::Radius => "radius",
            Group::Font => "font",
        }
    }
}

/// One token: its name without `--`, as `[tokens]` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token {
    pub name: &'static str,
    pub kind: Kind,
    pub group: Group,
}

/// `group kind [names];`, each line a group's tokens of one kind.
macro_rules! list {
    ($($group:ident $kind:ident [$($name:literal),* $(,)?];)*) => {
        &[$($(Token { name: $name, kind: Kind::$kind, group: Group::$group },)*)*]
    };
}

/// Every token, in the order the generated files list them. A name here is
/// an API: a Person's theme names it in `[tokens]` (ADR 0100, decision
/// 10), so a renamed token keeps its old name in [`RENAMED`].
pub const TOKENS: &[Token] = list! {
    Shadcn Colour [
        "background", "foreground", "card", "card-foreground", "popover",
        "popover-foreground", "primary", "primary-foreground", "secondary",
        "secondary-foreground", "muted", "muted-foreground", "accent",
        "accent-foreground", "destructive", "border", "input", "ring",
        "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
    ];
    Sidebar Colour [
        "sidebar", "sidebar-foreground", "sidebar-primary",
        "sidebar-primary-foreground", "sidebar-accent",
        "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
    ];
    // What waits for the Person, such as a Question: Banda's one signal
    // colour; a Thread back from Later by itself; an Agent at work; a
    // warning; a change's lines.
    State Colour ["attention", "woke", "working", "warning", "added", "removed"];
    // The focused tile's border, and every other tile's: `[focus]`'s,
    // else the accent and the border.
    Focus Colour ["focus", "focus-inactive"];
    // niri's focus ring: the focused tile's frame grows this far out into
    // the gap, so nothing moves. 0: the border shows the focus.
    Focus Length ["focus-ring"];
    // How dark the focused tile's shadow is, glass or not (ADR 0075,
    // decision 5), from 0 to 1.
    Focus Number ["focus-shadow-strength"];
    // The desk under the tiles, and the sidebar's panel over it (ADR
    // 0023). Solid, the desk is a theme's own (ADR 0075), else its
    // background a little greyed, and the panel the sidebar's colour; over
    // glass, each is its colour thinned (ADR 0100, decision 4).
    Desk Colour ["desk", "panel"];
    // Banda's own glass (ADR 0023): how frosted, how vivid the wallpaper
    // stays, the grain over it; how dark the sidebar's shadow on glass is.
    Desk Length ["desk-blur"];
    Desk Number ["desk-saturation", "desk-grain", "sidebar-shadow-strength"];
    // How solid the desk is over glass.
    Desk Percentage ["desk-opacity"];
    // The tiles' border; `[tile] dim-inactive`, a black veil over the
    // tiles without the focus, as Hyprland dims its windows; how dark a
    // tile's shadow is on glass; how solid a tile is over glass. A tile
    // is the background, over glass thinned as the desk is.
    Tile Colour ["tile"];
    Tile Length ["tile-border"];
    Tile Number ["tile-dim", "tile-shadow-strength"];
    Tile Percentage ["tile-opacity"];
    // A block: code, a table, a diagram, a card, a console; and what is
    // raised over the ground: the Person's bubble, chips, insets.
    Chat Colour ["block", "raised"];
    Sign Colour ["sign-violet", "sign-magenta", "sign-yellow", "sign-teal", "sign-sand"];
    Account Colour [
        "account-own", "account-claude", "account-1", "account-2", "account-3",
        "account-4", "account-5",
    ];
    Terminal Colour [
        "selection", "selection-foreground", "cursor", "ansi-0", "ansi-1",
        "ansi-2", "ansi-3", "ansi-4", "ansi-5", "ansi-6", "ansi-7", "ansi-8",
        "ansi-9", "ansi-10", "ansi-11", "ansi-12", "ansi-13", "ansi-14",
        "ansi-15",
    ];
    // Between tiles, and between the tiles and the window's edge; the bar.
    Layout Length ["gap-inner", "gap-outer", "bar-height"];
    // The five corners (ADR 0080, decision 6): the window and the desk; a
    // Pane and the sidebar's panel, the window's less the outer gap; a
    // card, a Thread's block, a menu, the tile's less its padding but
    // never below a control's; a button, an input, a select; a chip, a
    // checkbox, a badge.
    Radius Length [
        "window-radius", "tile-radius", "card-radius", "control-radius",
        "small-radius",
    ];
    // `[font]`: the two families, and the root's size that makes the
    // usual text (`text-ui`) the size said. Everything in rem grows with it.
    Font Font ["font-family-sans", "font-family-mono"];
    Font Length ["text-root"];
    // The type scale (ADR 0113, decision 3): each level's size and line
    // height, worked out from the theme's size as the root is
    // (`fonts::SCALE`).
    Font Length [
        "heading-size", "heading-leading", "title-size", "title-leading",
        "prose-size", "prose-leading", "prose-wide-size", "prose-wide-leading",
        "ui-size", "ui-leading", "code-size", "code-leading", "meta-size",
        "meta-leading", "small-size", "small-leading", "figure-size",
        "figure-leading",
    ];
};

/// Tokens renamed: each old name, and the token it is now. A theme that
/// says an old name still sets the token, and `check` names the new one
/// (ADR 0100, decision 10).
pub const RENAMED: &[(&str, &str)] = &[
    // shadcn's `--radius`, which every corner was a step of: the
    // control's now (ADR 0080, decision 6).
    ("radius", "control-radius"),
    // A theme's solid desk (ADR 0075), now the desk, solid or glass (ADR
    // 0100, decision 4).
    ("desk-solid", "desk"),
];

/// The value `[colors] accent` takes for the system's accent (ADR 0075,
/// decision 6): the device's, else the theme's `blue`.
pub const SYSTEM_ACCENT: &str = "system";

/// The token of that name, by its name now.
pub fn token(name: &str) -> Option<&'static Token> {
    TOKENS.iter().find(|token| token.name == name)
}

/// The token a `[tokens]` key sets, and what to tell of the key: its new
/// name when it says an old one. `Err` says why it sets none: no token
/// has the name, or it is one that `[tokens]` does not set.
pub fn set_by(key: &str) -> Result<(&'static str, Option<String>), String> {
    set_by_in(key, RENAMED)
}

/// A token's name now: `name`, or the one an old `name` was renamed to.
fn now_in<'a>(name: &'a str, renamed: &[(&str, &'static str)]) -> &'a str {
    (renamed.iter().find(|(old, _)| *old == name)).map_or(name, |(_, now)| now)
}

fn set_by_in(
    key: &str,
    renamed: &[(&str, &'static str)],
) -> Result<(&'static str, Option<String>), String> {
    let name = now_in(key, renamed);
    let Some(found) = token(name) else {
        return Err(format!("there is no token \"{key}\""));
    };
    let note = (name != key).then(|| format!("tokens.{key} is now tokens.{name}"));
    if found.kind != Kind::Colour {
        return Err(format!(
            "tokens.{key} is a {}; [tokens] sets only colours for now",
            found.kind.word()
        ));
    }
    Ok((found.name, note))
}

/// Tokens no palette says, the same in every theme unless its `[tokens]`
/// set them: each with light's value, then dark's.
const FIXED: &[(&str, &str, &str)] = &[
    // A Thread back from Later by itself: its Mark's yellow, the same in
    // both themes and plain, with no outline (ADR 0099, decision 1).
    ("woke", "#f5c542", "#f5c542"),
    // An Agent at work, as its Group's plate shows it (ADR 0065).
    ("working", "oklch(0.6 0.15 255)", "oklch(0.72 0.13 255)"),
    // A Project's sign, when the Person picks a colour: a quiet palette
    // with none of the colours an Agent's state says (ADR 0070).
    (
        "sign-violet",
        "oklch(0.52 0.14 300)",
        "oklch(0.72 0.14 300)",
    ),
    (
        "sign-magenta",
        "oklch(0.52 0.14 340)",
        "oklch(0.72 0.14 340)",
    ),
    ("sign-yellow", "oklch(0.55 0.12 95)", "oklch(0.78 0.12 95)"),
    ("sign-teal", "oklch(0.52 0.1 195)", "oklch(0.74 0.1 195)"),
    ("sign-sand", "oklch(0.55 0.07 65)", "oklch(0.74 0.07 65)"),
    // An account's emblem's colour (ADR 0093, decision 3): its Harness's
    // own, Claude's orange behind Claude's icons, then violet, rose,
    // green and graphite. Every two of one Harness stay apart in normal
    // sight and the three colour-blindnesses, and each is at least 3.4:1
    // on the sidebar (docs/research/2026-11-08-account-icon-colours.md).
    // The fifth is the Usage Pane's, which still colours the accounts by
    // place (ADR 0055). The text's own, `account-own`, follows the text.
    ("account-claude", "#c96442", "#d97757"),
    ("account-1", "#8557c8", "#a072e6"),
    ("account-2", "#ad3272", "#c54987"),
    ("account-3", "#189a69", "#15b77c"),
    ("account-4", "#424242", "#b7b7b7"),
    ("account-5", "#eda100", "#c98500"),
];

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
    let dark = palette.mode() == Mode::Dark;
    for &(name, light, dark_one) in FIXED {
        put(name, if dark { dark_one } else { light });
    }
    tokens
}

/// `colour` as solid as `share` ([`thinned`]); one it cannot read stays as
/// it is.
fn thin(colour: &str, share: f64) -> String {
    thinned(colour, share).unwrap_or_else(|| colour.to_owned())
}

/// `a` moved `amount` of the way to `b`, or `a` where either is not hex.
fn mixed(a: &str, b: &str, amount: f64) -> String {
    mix(a, b, amount).unwrap_or_else(|| a.to_owned())
}

/// What a scheme's glass is made of (ADR 0100, decision 4): how solid the
/// desk and the tiles are over it, from 0 to 1, as the look says them;
/// what is under it, the system's material or Banda's wallpaper; and the
/// tokens a theme's `[glass.tokens]` corrects, each a palette name, a
/// token's name or a CSS colour.
#[derive(Clone, Copy, Debug)]
pub struct Glass<'a> {
    pub desk: f64,
    pub tile: f64,
    pub under: Under<'a>,
    pub tokens: &'a BTreeMap<String, String>,
}

/// ADR 0036's glass, the derive's defaults: shadcn's fills and lines are
/// the text's own colour thinned to these shares, and quiet text the text
/// at 62%, so each takes the colour of the glass under it.
const THINNED: &[(&str, f64)] = &[
    ("muted", 0.1),
    ("accent", 0.1),
    ("secondary", 0.1),
    ("border", 0.1),
    ("input", 0.12),
    ("muted-foreground", 0.62),
];

/// One theme's colours as CSS variables, `--` included: its palette
/// under the `colors` the layers replace, each a palette name or hex,
/// derived into tokens, under the `tokens` they replace, each a palette
/// name, a token's name or a CSS colour. Last the focus: the focused
/// tile's `border` and every other's, named so, else `primary` and
/// `border`; and the tokens that follow others' final values. A palette
/// whose `accent` is [`SYSTEM_ACCENT`] takes `device`'s. With `glass`,
/// the scheme over glass: the surfaces and ADR 0036's fills, lines and
/// quiet text thinned from the solid scheme's final colours, under the
/// theme's corrections (ADR 0080, decision 8). Each is kept readable
/// ([`readable`], ADR 0100, decision 8): the accent where it is a line or
/// text, the text on it, quiet text and the text on the fills worked out.
pub fn scheme<'a>(
    palette: &Palette,
    colors: impl IntoIterator<Item = (&'a str, &'a str)>,
    tokens: impl IntoIterator<Item = (&'a str, &'a str)>,
    border: Option<&str>,
    inactive_border: Option<&str>,
    device: &Device,
    glass: Option<Glass>,
) -> BTreeMap<String, String> {
    let mut base = palette.clone();
    if base.get("accent") == Some(SYSTEM_ACCENT) {
        // The system's accent where it says one (ADR 0075, decision 6),
        // else the theme's blue, which a theme of no accent takes too.
        let system = device.accent.as_deref().filter(|accent| is_hex(accent));
        let accent = system.or(base.get("blue")).unwrap_or_default().to_owned();
        base.set("accent", accent);
    }
    let base = base.complete();
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
            .or_else(|| derived.get(now_in(value, RENAMED)).cloned())
            .or_else(|| is_css_color(value).then(|| value.to_owned()))
    };
    let mut said = BTreeSet::new();
    for (key, value) in tokens {
        // A key that sets no token is named where the file is read.
        let Ok((name, _)) = set_by(key) else {
            continue;
        };
        if let Some(resolved) = refer(&derived, value) {
            derived.insert(name.to_owned(), resolved);
            said.insert(name);
        }
    }
    // The accent where it is a line or text reads on its ground, and so
    // does the text on it (ADR 0100, decision 8).
    for (accent, ground) in [
        ("primary", "background"),
        ("ring", "background"),
        ("sidebar-primary", "sidebar"),
        ("sidebar-ring", "sidebar"),
    ] {
        if let Some(readable) = readable::readable_on(&derived[accent], &derived[ground], MARK) {
            derived.insert(accent.to_owned(), readable);
        }
    }
    for (text, fill, ground) in [
        ("primary-foreground", "primary", "background"),
        ("sidebar-primary-foreground", "sidebar-primary", "sidebar"),
    ] {
        if let Some(text_on) =
            readable::text_on(&derived[text], &derived[fill], &derived[ground], MARK)
        {
            derived.insert(text.to_owned(), text_on);
        }
    }
    let focus = |value: Option<&str>, fallback: &str| {
        value
            .and_then(|v| refer(&derived, v))
            .or_else(|| derived.get(fallback).cloned())
            .unwrap_or_default()
    };
    // The focus is a mark that has to be seen, whoever picked its colour.
    let active = focus(border, "primary");
    let active = readable::readable_on(&active, &derived["background"], MARK).unwrap_or(active);
    let inactive = focus(inactive_border, "border");
    derived.insert("focus".to_owned(), active);
    derived.insert("focus-inactive".to_owned(), inactive);
    // Worked out from the ground and the ink as they end, as the page did
    // (ADR 0058, ADR 0093), unless the theme says them.
    let (background, foreground) = (derived["background"].clone(), derived["foreground"].clone());
    // The solid desk greys the background with 40% of the fills' colour,
    // as the page did in oklab (ADR 0023).
    let desk = (Oklab::parse(&derived["muted"]).zip(Oklab::parse(&background))).map_or_else(
        || background.clone(),
        |(muted, ground)| muted.mix(ground, 0.4).css(),
    );
    for (name, value) in [
        ("block", mixed(&background, &foreground, 0.035)),
        ("raised", mixed(&background, &foreground, 0.07)),
        ("account-own", foreground),
        ("desk", desk),
        ("panel", derived["sidebar"].clone()),
        ("tile", background),
    ] {
        if !said.contains(name) {
            derived.insert(name.to_owned(), value);
        }
    }
    // Quiet text, and the text on the fills worked out from the theme,
    // read on each surface they are on (ADR 0100, decision 8).
    for text in readable::MENDED {
        readable::mend(&mut derived, text, Under::Ground);
    }
    if let Some(glass) = glass {
        // The glass's own: each surface its colour thinned, the panel
        // halfway between the desk, the clearest, and the tiles.
        let surfaces = [
            ("desk", "background", glass.desk),
            ("panel", "sidebar", (glass.desk + glass.tile) / 2.0),
            ("tile", "background", glass.tile),
        ];
        let text = THINNED
            .iter()
            .map(|&(name, share)| (name, "foreground", share));
        let thinned: Vec<_> = (surfaces.into_iter().chain(text))
            .map(|(name, from, share)| (name.to_owned(), thin(&derived[from], share)))
            .collect();
        derived.extend(thinned);
        for (key, value) in glass.tokens {
            if let Some(resolved) = refer(&derived, value) {
                derived.insert(key.clone(), resolved);
            }
        }
        // Over Banda's glass, the desk and the panel as dense as their
        // text needs over the wallpaper (ADR 0111), but where
        // `[glass.tokens]` says one; the system's material is tinted to
        // read already. Then the rest, as what is under it is measured
        // (ADR 0100, decision 8).
        if let Under::Wallpaper(wallpaper) = glass.under {
            let surfaces: Vec<_> = (readable::DENSER.into_iter())
                .filter(|surface| !glass.tokens.contains_key(*surface))
                .collect();
            readable::densify(&mut derived, &surfaces, wallpaper);
        }
        for text in readable::MENDED {
            readable::mend(&mut derived, text, glass.under);
        }
    }
    derived
        .into_iter()
        .map(|(k, v)| (format!("--{k}"), v))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette(text: &str) -> Palette {
        Palette::parse(text).unwrap().complete()
    }

    #[test]
    fn omarchy_accent_is_shadcn_primary() {
        let palette = palette(
            r##"
            accent = "#a3b88c"
            background = "#19251f"
            foreground = "#dac49d"
            "##,
        );
        let tokens = derive(&palette);
        assert_eq!(tokens["primary"], "#a3b88c");
        assert_eq!(tokens["ring"], "#a3b88c");
        assert_eq!(tokens["accent"], tokens["muted"]);
        assert_eq!(tokens["ansi-0"], "#19251f");
        assert_eq!(tokens["ansi-7"], "#dac49d");
        // Dark, by its background: the fixed tokens' dark values.
        assert_eq!(tokens["working"], "oklch(0.72 0.13 255)");
    }

    #[test]
    fn the_list_names_each_token_once() {
        let mut seen = BTreeSet::new();
        for token in TOKENS {
            assert!(seen.insert(token.name), "{} twice", token.name);
        }
        for (old, now) in RENAMED {
            assert!(token(old).is_none(), "{old} is renamed and still a token");
            assert!(token(now).is_some(), "{old} is renamed to no token");
        }
    }

    #[test]
    fn every_colour_token_is_a_value_in_every_scheme() {
        let none = std::iter::empty();
        for mode in ["light", "dark"] {
            let palette = palette(&format!("mode = \"{mode}\"\nbackground = \"#ffffff\""));
            let corrections = BTreeMap::new();
            let glass = Glass {
                desk: 0.4,
                tile: 1.0,
                under: Under::Wallpaper(None),
                tokens: &corrections,
            };
            for glass in [None, Some(glass)] {
                let scheme = scheme(
                    &palette,
                    none.clone(),
                    none.clone(),
                    None,
                    None,
                    &Device::default(),
                    glass,
                );
                for token in TOKENS.iter().filter(|t| t.kind == Kind::Colour) {
                    let value = &scheme[&format!("--{}", token.name)];
                    assert!(is_css_color(value), "--{}: {value}", token.name);
                }
                // And nothing the list does not have.
                for name in scheme.keys() {
                    assert!(token(&name[2..]).is_some(), "{name} is in no list");
                }
            }
        }
    }

    #[test]
    fn the_system_accent_is_the_devices_else_the_themes_blue() {
        let palette = palette(
            "accent = \"system\"\nblue = \"#007aff\"\nbackground = \"#ffffff\"\ndark_background = \"#f5f5f7\"",
        );
        let none = std::iter::empty();
        let with = |device: Device| {
            scheme(
                &palette,
                none.clone(),
                none.clone(),
                Some("accent"),
                None,
                &device,
                None,
            )
        };
        let apple = with(Device::default());
        assert_eq!(apple["--primary"], "#007aff");
        assert_eq!(apple["--focus"], "#007aff");
        let pink = with(Device {
            accent: Some("#e0478c".to_owned()),
            ..Device::default()
        });
        assert_eq!(pink["--primary"], "#e0478c");
        assert_eq!(pink["--sidebar-ring"], "#e0478c");
        // What is not a colour does not get in.
        let wrong = with(Device {
            accent: Some("var(--x)".to_owned()),
            ..Device::default()
        });
        assert_eq!(wrong["--primary"], "#007aff");
    }

    #[test]
    fn a_pale_system_accent_reads_where_it_is_a_line_or_text() {
        let yellow = Device {
            accent: Some("#ffd60a".to_owned()),
            ..Device::default()
        };
        let ratio = |a: &str, b: &str| {
            let rgb = |c: &str| Oklab::parse(c).unwrap().rgb();
            readable::contrast(rgb(a), rgb(b))
        };
        let light =
            palette("accent = \"system\"\nbackground = \"#ffffff\"\ndark_background = \"#f5f5f7\"");
        let said = [("primary-foreground", "#ffffff")];
        let light = scheme(&light, [], said, Some("accent"), None, &yellow, None);
        for name in ["--primary", "--ring", "--focus", "--sidebar-ring"] {
            assert!(
                ratio(&light[name], "#ffffff") >= MARK,
                "{name}: {}",
                light[name]
            );
        }
        // Darker by as much as it takes, so the theme's white text on it
        // reads too.
        assert_eq!(light["--primary-foreground"], "#ffffff");
        // On dark the yellow reads as it is. The theme's white on it does
        // not, so it is black; the derive's dark text on it does.
        let dark = palette(
            "mode = \"dark\"\naccent = \"system\"\nbackground = \"#1e1e1e\"\ndark_background = \"#2b2b2d\"",
        );
        let dark = scheme(&dark, [], said, Some("accent"), None, &yellow, None);
        assert_eq!(dark["--primary"], "#ffd60a");
        assert_eq!(dark["--primary-foreground"], "#000000");
        assert_eq!(dark["--sidebar-primary-foreground"], "#1e1e1e");
    }

    #[test]
    fn the_desk_over_banda_s_wallpaper_is_as_dense_as_its_text_needs() {
        let palette = palette("background = \"#ffffff\"\nforeground = \"#18181b\"");
        let over = |under, tokens: &BTreeMap<String, String>| {
            let glass = Glass {
                desk: 0.4,
                tile: 1.0,
                under,
                tokens,
            };
            let scheme = scheme(
                &palette,
                [],
                [],
                None,
                None,
                &Device::default(),
                Some(glass),
            );
            assert_eq!(readable::check(&scheme, under), []);
            scheme
        };
        let none = BTreeMap::new();
        // The system's material keeps its tint, and so does Banda's over a
        // wallpaper that agrees with the theme (ADR 0111).
        let system = over(Under::Ground, &none);
        assert_eq!(system["--desk"], "rgb(255 255 255 / 0.4)");
        let light = over(Under::Wallpaper(Some(&[[0.9; 3], [1.0; 3]])), &none);
        assert_eq!(light, system);
        // Over a wallpaper not read, the worst backdrops', and over a dark
        // one no denser than that.
        let unread = over(Under::Wallpaper(None), &none);
        let dark = over(Under::Wallpaper(Some(&[[0.0; 3], [0.2; 3]])), &none);
        assert_eq!(unread["--desk"], "rgb(255 255 255 / 0.571)");
        assert_eq!(dark["--desk"], unread["--desk"]);
        // A desk `[glass.tokens]` says is as it says.
        let said = BTreeMap::from([("desk".to_owned(), "rgb(255 255 255 / 0.3)".to_owned())]);
        let said = over(Under::Wallpaper(Some(&[[0.9; 3], [1.0; 3]])), &said);
        assert_eq!(said["--desk"], "rgb(255 255 255 / 0.3)");
    }

    #[test]
    fn tokens_that_follow_others_take_their_final_values() {
        let palette = palette("background = \"#ffffff\"\nforeground = \"#000000\"");
        let tokens = [("foreground", "#18181b"), ("raised", "#eeeeee")];
        let scheme = scheme(&palette, [], tokens, None, None, &Device::default(), None);
        assert_eq!(scheme["--account-own"], "#18181b");
        // 3.5% of the ink in the ground, as color-mix() in sRGB.
        assert_eq!(scheme["--block"], "#f7f7f7");
        assert_eq!(scheme["--raised"], "#eeeeee");
        assert_eq!(scheme["--tile"], "#ffffff");
        assert_eq!(scheme["--panel"], scheme["--sidebar"]);
    }

    #[test]
    fn glass_thins_the_solid_schemes_final_colours_under_the_themes_corrections() {
        let palette = palette("background = \"#ffffff\"\nforeground = \"#000000\"");
        let none = BTreeMap::new();
        let with = |tokens: &[(&'static str, &'static str)], corrections| {
            let glass = Glass {
                desk: 0.4,
                tile: 0.9,
                under: Under::Ground,
                tokens: corrections,
            };
            let tokens = tokens.iter().copied();
            let solid = scheme(
                &palette,
                [],
                tokens.clone(),
                None,
                None,
                &Device::default(),
                None,
            );
            let glass = scheme(
                &palette,
                [],
                tokens,
                None,
                None,
                &Device::default(),
                Some(glass),
            );
            (solid, glass)
        };
        let (solid, glass) = with(&[("foreground", "#18181b"), ("desk", "#eeeeee")], &none);
        assert_eq!(glass["--muted"], "rgb(24 24 27 / 0.1)");
        assert_eq!(glass["--input"], "rgb(24 24 27 / 0.12)");
        assert_eq!(glass["--muted-foreground"], "rgb(24 24 27 / 0.62)");
        // The said solid desk is the solid one's; glass thins the ground.
        assert_eq!(solid["--desk"], "#eeeeee");
        assert_eq!(glass["--desk"], "rgb(255 255 255 / 0.4)");
        assert_eq!(glass["--tile"], "rgb(255 255 255 / 0.9)");
        assert_eq!(
            glass["--panel"],
            thin(&solid["--sidebar"], 0.65),
            "halfway between the desk and the tiles"
        );
        // What glass does not thin stays the solid one's.
        assert_eq!(glass["--primary"], solid["--primary"]);
        assert_eq!(glass["--focus-inactive"], solid["--focus-inactive"]);
        let corrections = BTreeMap::from([
            ("muted".to_owned(), "#00000014".to_owned()),
            ("border".to_owned(), "foreground".to_owned()),
        ]);
        let (_, corrected) = with(&[], &corrections);
        assert_eq!(corrected["--muted"], "#00000014");
        assert_eq!(corrected["--border"], "#000000");
        // The rest is still the derive's: black ink, thinned.
        assert_eq!(corrected["--accent"], "rgb(0 0 0 / 0.1)");
    }

    #[test]
    fn the_solid_desk_greys_the_ground_as_the_page_did() {
        let palette = palette("background = \"#ffffff\"\nforeground = \"#000000\"");
        let scheme = scheme(&palette, [], [], None, None, &Device::default(), None);
        let muted = Oklab::parse(&scheme["--muted"]).unwrap();
        let white = Oklab::parse("#ffffff").unwrap();
        assert_eq!(scheme["--desk"], muted.mix(white, 0.4).css());
    }

    #[test]
    fn a_key_sets_a_colour_token_by_its_name_or_an_old_one() {
        assert_eq!(set_by("card"), Ok(("card", None)));
        let renamed = [("panel-ink", "sidebar-foreground")];
        assert_eq!(
            set_by_in("panel-ink", &renamed),
            Ok((
                "sidebar-foreground",
                Some("tokens.panel-ink is now tokens.sidebar-foreground".to_owned())
            ))
        );
        assert_eq!(set_by("crad"), Err("there is no token \"crad\"".to_owned()));
        assert!(set_by("gap-inner").unwrap_err().contains("is a length"));
    }
}
