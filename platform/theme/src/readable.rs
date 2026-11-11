//! Whether a scheme's text reads (ADR 0100, decision 8), and what the
//! resolver changes so that it does: the contrast of each text on the
//! surfaces under it, as WCAG 2 measures it.
//!
//! Over Banda's glass the wallpaper is not known, so a glass surface is
//! measured over the worst backdrops, white, black and a mid grey; text
//! on the desk and the sidebar's panel is left out ([`rows`]). The accent, where it is a line
//! or text, is darkened or lightened until it reads on the background,
//! and the text on it is worked out. What still does not read is the
//! theme's own, and [`check`] names it.

use crate::Material;
use crate::color::{Oklab, with_alpha};
use std::collections::BTreeMap;
use std::fmt;

/// Text read at length: WCAG's AA for text.
pub const TEXT: f64 = 4.5;
/// Quiet text, which says what matters less: WCAG's AA for large text.
pub const QUIET: f64 = 3.0;
/// The accent as a line, a link or a button's label, short and seen by
/// its colour: WCAG's AA for a control and for large text.
pub const MARK: f64 = 3.0;

/// The worst backdrops for glass whose wallpaper is not known.
pub const BACKDROPS: [(&str, [f64; 3]); 3] = [
    ("white", [1.0; 3]),
    ("black", [0.0; 3]),
    ("mid grey", [128.0 / 255.0; 3]),
];

/// What is read, on what, and how much contrast it needs: each text, and
/// the surfaces under it from the desk up. The bar is on the desk, a Pane
/// on its tile, the sidebar on its panel.
const READ: &[(&str, &[&str], f64)] = &[
    ("foreground", &["desk"], TEXT),
    ("muted-foreground", &["desk"], QUIET),
    ("foreground", &["desk", "tile"], TEXT),
    ("muted-foreground", &["desk", "tile"], QUIET),
    ("primary", &["desk", "tile"], MARK),
    ("ring", &["desk", "tile"], MARK),
    ("card-foreground", &["desk", "tile", "card"], TEXT),
    ("secondary-foreground", &["desk", "tile", "secondary"], TEXT),
    ("accent-foreground", &["desk", "tile", "accent"], TEXT),
    ("primary-foreground", &["desk", "tile", "primary"], MARK),
    ("popover-foreground", &["desk", "popover"], TEXT),
    ("sidebar-foreground", &["desk", "panel"], TEXT),
    ("muted-foreground", &["desk", "panel"], QUIET),
    ("sidebar-ring", &["desk", "panel"], MARK),
    (
        "sidebar-accent-foreground",
        &["desk", "panel", "sidebar-accent"],
        TEXT,
    ),
    (
        "sidebar-primary-foreground",
        &["desk", "panel", "sidebar-primary"],
        MARK,
    ),
];

/// What [`READ`] measures over `glass`. Over Banda's glass, text on the
/// desk and on the sidebar's panel over it is left out: at the tints
/// `[desk]` and `[tile]` say, the desk reads for no text over both white
/// and black, and the panel not for every theme. ADR 0111 measures them
/// over the wallpaper Banda draws.
fn rows(
    glass: Option<Material>,
) -> impl Iterator<Item = &'static (&'static str, &'static [&'static str], f64)> {
    READ.iter().filter(move |(_, on, _)| {
        glass != Some(Material::Banda) || (*on != ["desk"] && !on.contains(&"panel"))
    })
}

/// Text that does not read: what it is, the surface it is on, the
/// backdrop it reads worst over, when glass shows one, and its contrast
/// against what it needs.
#[derive(Clone, Debug, PartialEq)]
pub struct Unread {
    pub text: &'static str,
    pub on: &'static str,
    pub over: Option<&'static str>,
    pub ratio: f64,
    pub needs: f64,
}

impl fmt::Display for Unread {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} on {}", self.text, self.on)?;
        if let Some(over) = self.over {
            write!(f, " over {over}")?;
        }
        write!(f, ": {:.2}:1, needs {}:1", self.ratio, self.needs)
    }
}

/// The text in `scheme` that does not read: a scheme as [`crate::tokens::scheme`]
/// gives it, with `glass` the material it is over, none when solid. Over
/// Banda's glass each surface is measured over the worst backdrops; the
/// system's material is made to read in its mode, so it is measured as
/// the theme's own ground, as solid is. Over Banda's glass, text on the
/// desk and the panel is not measured ([`rows`]).
pub fn check(scheme: &BTreeMap<String, String>, glass: Option<Material>) -> Vec<Unread> {
    let paints = paints(
        scheme
            .iter()
            .map(|(k, v)| (k.strip_prefix("--").unwrap_or(k), v)),
    );
    let backdrops = backdrops(&paints, glass);
    let colour = |name: &str| paints.get(name).copied();
    rows(glass)
        .filter_map(|&(text, on, needs)| {
            let (over, ratio) = (backdrops.iter())
                .filter_map(|&(over, backdrop)| Some((over, measure(&colour, text, on, backdrop)?)))
                .min_by(|a, b| a.1.total_cmp(&b.1))?;
            (ratio < needs).then(|| Unread {
                text,
                on: on.last().copied().unwrap_or_default(),
                over,
                ratio,
                needs,
            })
        })
        .collect()
}

/// `colour`, a line or text on `ground`, darkened or lightened until it
/// has `needs` against it ([`lightened`]); none when it reads as it is.
pub(crate) fn readable_on(colour: &str, ground: &str, needs: f64) -> Option<String> {
    let ground = Paint::of(ground)?.over([1.0; 3]);
    lightened(Oklab::parse(colour)?, &[(ground, needs)])
}

/// Text the resolver works out, so keeps readable: quiet text, and the
/// text on a fill worked out from the theme, a row under the pointer.
/// The theme's own text, on its own grounds, is the theme's ([`check`]).
pub(crate) const MENDED: [&str; 4] = [
    "muted-foreground",
    "accent-foreground",
    "secondary-foreground",
    "sidebar-accent-foreground",
];

/// `text` made to read on every ground [`rows`] puts it on, over `glass`'s
/// backdrops as [`check`] measures them: thinned, it is made less thin;
/// solid, it is darkened or lightened ([`lightened`]).
pub(crate) fn mend(colours: &mut BTreeMap<String, String>, text: &str, glass: Option<Material>) {
    let paints = paints(colours.iter().map(|(k, v)| (k.as_str(), v)));
    let Some(&paint) = paints.get(text) else {
        return;
    };
    let colour = |name: &str| paints.get(name).copied();
    let backdrops = backdrops(&paints, glass);
    let grounds: Vec<([f64; 3], f64)> = rows(glass)
        .filter(|(read, _, _)| *read == text)
        .flat_map(|&(_, on, needs)| {
            (backdrops.iter()).filter_map(move |&(_, b)| Some((ground(&colour, on, b)?, needs)))
        })
        .collect();
    if grounds.is_empty() || reads(paint, &grounds) {
        return;
    }
    let value = &colours[text];
    let mended = if paint.alpha < 1.0 {
        let from = (paint.alpha * 1000.0).floor() as u32;
        (from..=1000)
            .map(|n| f64::from(n) / 1000.0)
            .find(|&alpha| reads(Paint { alpha, ..paint }, &grounds))
            .and_then(|alpha| with_alpha(value, alpha))
    } else {
        Oklab::parse(value).and_then(|colour| lightened(colour, &grounds))
    };
    if let Some(mended) = mended {
        colours.insert(text.to_owned(), mended);
    }
}

/// Whether `paint` has, on each ground, the contrast it needs there.
fn reads(paint: Paint, grounds: &[([f64; 3], f64)]) -> bool {
    (grounds.iter()).all(|&(g, needs)| contrast(paint.over(g), g) >= needs)
}

/// `colour` darkened or lightened in Oklab, its hue and chroma kept, to
/// the first lightness that has on each of `grounds` what it needs there:
/// away from the first ground first, so a pale accent on white goes
/// darker. As hex, its alpha kept; none when it reads as it is, or no
/// lightness makes it.
fn lightened(colour: Oklab, grounds: &[([f64; 3], f64)]) -> Option<String> {
    let alpha = colour.alpha;
    let (first, _) = *grounds.first()?;
    if reads(Paint::of_oklab(colour), grounds) {
        return None;
    }
    let darker = luminance(Paint::of_oklab(colour).over(first)) <= luminance(first);
    [darker, !darker].into_iter().find_map(|darker| {
        let step = if darker { -0.001 } else { 0.001 };
        (1..=1000)
            .map(|n| Oklab {
                l: colour.l + step * f64::from(n),
                ..colour
            })
            .take_while(|moved| (0.0..=1.0).contains(&moved.l))
            .map(Oklab::hex)
            .find(|hex| Paint::of(hex).is_some_and(|p| reads(Paint { alpha, ..p }, grounds)))
            .map(|hex| {
                if alpha < 1.0 {
                    with_alpha(&hex, alpha).unwrap_or(hex)
                } else {
                    hex
                }
            })
    })
}

/// The text on `fill` over `ground`, a button's label: none while `text`
/// has `needs` against it, else white or black, whichever has more.
pub(crate) fn text_on(text: &str, fill: &str, ground: &str, needs: f64) -> Option<String> {
    let fill = Paint::of(fill)?.over(Paint::of(ground)?.over([1.0; 3]));
    let ratio = |text: &str| Paint::of(text).map(|t| contrast(t.over(fill), fill));
    if ratio(text).is_none_or(|r| r >= needs) {
        return None;
    }
    let (white, black) = ("#ffffff", "#000000");
    Some(
        if ratio(white) >= ratio(black) {
            white
        } else {
            black
        }
        .to_owned(),
    )
}

/// A colour as a screen paints it: sRGB's channels, 0 to 1, and how
/// solid it is.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Paint {
    rgb: [f64; 3],
    alpha: f64,
}

impl Paint {
    fn of(text: &str) -> Option<Paint> {
        Oklab::parse(text).map(Paint::of_oklab)
    }

    fn of_oklab(colour: Oklab) -> Paint {
        Paint {
            rgb: colour.rgb(),
            alpha: colour.alpha,
        }
    }

    /// This over `under`, blended as a browser does, in sRGB.
    fn over(self, under: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|i| self.rgb[i] * self.alpha + under[i] * (1.0 - self.alpha))
    }
}

/// Each colour that reads, by its name.
fn paints<'a>(colours: impl Iterator<Item = (&'a str, &'a String)>) -> BTreeMap<&'a str, Paint> {
    colours
        .filter_map(|(name, value)| Some((name, Paint::of(value)?)))
        .collect()
}

/// What text is read against on the surfaces `on`, from the desk up,
/// over `backdrop`; none when one of them is not a colour that reads.
fn ground(
    colour: &impl Fn(&str) -> Option<Paint>,
    on: &[&str],
    backdrop: [f64; 3],
) -> Option<[f64; 3]> {
    (on.iter()).try_fold(backdrop, |under, surface| {
        Some(colour(surface)?.over(under))
    })
}

/// The contrast of `text` on the surfaces `on` over `backdrop` ([`ground`]).
fn measure(
    colour: &impl Fn(&str) -> Option<Paint>,
    text: &str,
    on: &[&str],
    backdrop: [f64; 3],
) -> Option<f64> {
    let ground = ground(colour, on, backdrop)?;
    Some(contrast(colour(text)?.over(ground), ground))
}

/// What a scheme over `glass` is measured over, and its name where it is
/// one of [`BACKDROPS`]: those over Banda's glass, whose wallpaper is not
/// known; else the theme's own ground. Solid, the desk hides what is
/// under it; the system's material is made to read in its mode.
fn backdrops(
    paints: &BTreeMap<&str, Paint>,
    glass: Option<Material>,
) -> Vec<(Option<&'static str>, [f64; 3])> {
    match glass {
        Some(Material::Banda) => BACKDROPS.iter().map(|&(n, c)| (Some(n), c)).collect(),
        _ => (paints.get("background"))
            .map(|ground| vec![(None, ground.over([1.0; 3]))])
            .unwrap_or_default(),
    }
}

/// WCAG 2's relative luminance of an sRGB colour.
pub fn luminance(rgb: [f64; 3]) -> f64 {
    let linear = |c: f64| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/// WCAG 2's contrast ratio of two sRGB colours, from 1 to 21.
pub fn contrast(a: [f64; 3], b: [f64; 3]) -> f64 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(hex: &str) -> [f64; 3] {
        Paint::of(hex).unwrap().rgb
    }

    fn ratio(a: &str, b: &str) -> f64 {
        contrast(rgb(a), rgb(b))
    }

    #[test]
    fn contrast_is_wcags() {
        assert!((ratio("#ffffff", "#000000") - 21.0).abs() < 1e-6);
        assert_eq!(ratio("#777777", "#777777"), 1.0);
        // The usual pairs: #767676 is the greyest that reads on white.
        assert!(ratio("#767676", "#ffffff") >= 4.5);
        assert!(ratio("#777777", "#ffffff") < 4.5);
        assert!((ratio("#007aff", "#ffffff") - 4.02).abs() < 0.01);
    }

    fn colours(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        (pairs.iter())
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn over_banda_glass_the_desk_and_the_panel_are_left_to_the_wallpaper() {
        // 40% of white over black: dark text reads on no part of it, nor
        // on a panel as clear. A solid tile reads over any backdrop.
        let glass = colours(&[
            ("desk", "rgb(255 255 255 / 0.4)"),
            ("tile", "rgb(255 255 255)"),
            ("panel", "rgb(250 250 250 / 0.1)"),
            ("foreground", "#18181b"),
            ("sidebar-foreground", "#18181b"),
            ("muted-foreground", "rgb(24 24 27 / 0.62)"),
        ]);
        assert_eq!(check(&prefixed(&glass), Some(Material::Banda)), []);
        // A tile too clear for its text is named, over the backdrop it
        // reads worst on.
        let mut clear = glass.clone();
        clear.insert("tile".to_owned(), "rgb(255 255 255 / 0.1)".to_owned());
        let unread = check(&prefixed(&clear), Some(Material::Banda));
        assert!(!unread.is_empty());
        assert!(
            (unread.iter()).all(|u| u.on == "tile" && u.over == Some("black")),
            "{unread:?}"
        );
    }

    #[test]
    fn the_themes_own_text_that_does_not_read_is_named() {
        // Grey on white, the theme's own: no correction makes it read.
        let solid = colours(&[
            ("background", "#ffffff"),
            ("desk", "#ffffff"),
            ("foreground", "#aaaaaa"),
        ]);
        let unread = check(&prefixed(&solid), None);
        assert_eq!(unread.len(), 1);
        assert_eq!(
            unread[0].to_string(),
            format!("foreground on desk: {:.2}:1, needs 4.5:1", unread[0].ratio)
        );
        // On a solid tile over Banda's glass, each backdrop alike.
        let glass = colours(&[
            ("desk", "rgb(255 255 255 / 0.4)"),
            ("tile", "#ffffff"),
            ("foreground", "#aaaaaa"),
        ]);
        let unread = check(&prefixed(&glass), Some(Material::Banda));
        assert_eq!(unread.len(), 1);
        assert_eq!(
            unread[0].to_string(),
            format!(
                "foreground on tile over white: {:.2}:1, needs 4.5:1",
                unread[0].ratio
            )
        );
    }

    #[test]
    fn a_pale_accent_goes_darker_on_light_and_lighter_on_dark() {
        let yellow = "#ffd60a";
        let on_white = readable_on(yellow, "#ffffff", MARK).unwrap();
        assert!(ratio(&on_white, "#ffffff") >= MARK);
        assert!(
            ratio(&on_white, "#ffffff") < MARK + 0.1,
            "no darker than it needs"
        );
        assert_eq!(readable_on(yellow, "#1e1e1e", MARK), None, "reads on dark");
        let navy = "#1d3b8a";
        let on_black = readable_on(navy, "#000000", MARK).unwrap();
        assert!(ratio(&on_black, "#000000") >= MARK);
        // Its hue stays.
        let (before, after) = (
            Oklab::parse(navy).unwrap(),
            Oklab::parse(&on_black).unwrap(),
        );
        assert!((before.b.atan2(before.a) - after.b.atan2(after.a)).abs() < 0.1);
    }

    #[test]
    fn the_text_on_the_accent_is_the_themes_while_it_reads() {
        // Apple's blue takes white, as the Mac's buttons do.
        assert_eq!(text_on("#ffffff", "#007aff", "#ffffff", MARK), None);
        assert_eq!(
            text_on("#ffffff", "#ffd60a", "#ffffff", MARK).as_deref(),
            Some("#000000")
        );
        assert_eq!(
            text_on("#000000", "#1d3b8a", "#ffffff", MARK).as_deref(),
            Some("#ffffff")
        );
    }

    fn prefixed(colours: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        (colours.iter())
            .map(|(k, v)| (format!("--{k}"), v.clone()))
            .collect()
    }
}
