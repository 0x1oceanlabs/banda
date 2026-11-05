//! `[columns]`, as niri's: the widths a column steps through, the width a
//! new one opens at, whether the focused one stays centred (ADR 0007,
//! decision 2), and the heights a Pane steps through in its column (ADR
//! 0025, decision 4).
//!
//! A width is a share of the screen as a fraction, `"1/3"`, or `"1"` for
//! all of it. `min` keeps a share of a narrow window readable: no column
//! is drawn narrower than that many rem, unless the screen is.
//!
//! `snap` is how near, in pixels, a size dragged with the mouse holds at
//! one of `presets` or `heights` (ADR 0025, decision 5); 0 never holds.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::ops::RangeInclusive;
use toml::Spanned;
use ts_rs::TS;

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct ColumnsSettings {
    /// What the keys that widen and narrow a column step through.
    #[schemars(with = "Option<Vec<String>>")]
    pub presets: Option<Vec<Spanned<String>>>,
    /// What the keys of a Pane's height step it through, as shares of its
    /// column.
    #[schemars(with = "Option<Vec<String>>")]
    pub heights: Option<Vec<Spanned<String>>>,
    /// A new column's width, where its Pane does not ask for its own.
    #[schemars(with = "Option<String>")]
    pub default: Option<Spanned<String>>,
    /// The width of a column alone on its workspace, until the Person
    /// gives it one: once a second opens beside it, both take `default`.
    #[schemars(with = "Option<String>")]
    pub alone: Option<Spanned<String>>,
    pub center: Option<Center>,
    /// How a new column shows its Panes, as niri's `default-column-display`.
    pub display: Option<Display>,
    /// The narrowest a column is drawn, in rem; a list's is half of it.
    #[schemars(with = "Option<f64>", range(min = 0, max = 200))]
    pub min: Option<Spanned<f64>>,
    /// How near, in pixels, a size dragged with the mouse holds at a
    /// preset or a height; 0 never.
    #[schemars(with = "Option<f64>", range(min = 0, max = 64))]
    pub snap: Option<Spanned<f64>>,
}

/// Where the Strip scrolls a focused column to.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "look/")]
pub enum Center {
    /// The least scroll that shows it whole.
    Never,
    /// The middle of the screen.
    Always,
    /// The middle, when it does not fit beside the column focused before.
    OnOverflow,
}

/// How a column shows its Panes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "look/")]
pub enum Display {
    /// One above another, sharing the column's height.
    Stack,
    /// A Deck: one at a time, the others' names in a row over it, as niri's
    /// tabbed column (ADR 0065).
    Deck,
}

/// Reads `"tabs"` as a Deck too, its old name, as a `look.toml` or a kept
/// arrangement may still say (ADR 0065).
impl<'de> Deserialize<'de> for Display {
    fn deserialize<D: serde::Deserializer<'de>>(read: D) -> Result<Self, D::Error> {
        match String::deserialize(read)?.as_str() {
            "stack" => Ok(Self::Stack),
            "deck" | "tabs" => Ok(Self::Deck),
            other => Err(serde::de::Error::unknown_variant(other, &["stack", "deck"])),
        }
    }
}

/// `[columns]` resolved: valid widths only, narrowest first.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Columns {
    pub presets: Vec<String>,
    pub heights: Vec<String>,
    pub default: String,
    pub alone: String,
    pub center: Center,
    pub display: Display,
    pub min: f64,
    pub snap: f64,
}

const PRESETS: [&str; 4] = ["1/3", "1/2", "2/3", "1"];
const HEIGHTS: [&str; 3] = ["1/3", "1/2", "2/3"];
const DEFAULT: &str = "1/2";
const ALONE: &str = "1";
/// A Thread's lines stay readable at 30 rem, about 60 letters.
const MIN: f64 = 30.0;
/// Past this a column is the whole screen in any window.
const MINS: RangeInclusive<f64> = 0.0..=200.0;
/// Near enough to hit a step without trying, far enough to leave the
/// sizes between free.
const SNAP: f64 = 8.0;
const SNAPS: RangeInclusive<f64> = 0.0..=64.0;

/// A width's share of the screen: more than 0, at most 1.
pub fn share(width: &str) -> Option<f64> {
    let width = width.trim();
    let value = match width.split_once('/') {
        Some((top, bottom)) => {
            let top: f64 = top.trim().parse().ok()?;
            let bottom: f64 = bottom.trim().parse().ok()?;
            (bottom != 0.0).then(|| top / bottom)?
        }
        None => width.parse().ok()?,
    };
    (value.is_finite() && value > 0.0 && value <= 1.0).then_some(value)
}

/// The valid shares of `list`, smallest first and each once; `or` when
/// none is.
fn steps(list: &Option<Vec<Spanned<String>>>, or: &[&str]) -> Vec<String> {
    let mut steps: Vec<(f64, String)> = (list.iter().flatten())
        .filter_map(|p| {
            let text = valid(p)?;
            Some((share(&text)?, text))
        })
        .collect();
    steps.sort_by(|a, b| a.0.total_cmp(&b.0));
    steps.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
    if steps.is_empty() {
        return or.iter().map(|p| (*p).to_owned()).collect();
    }
    steps.into_iter().map(|(_, text)| text).collect()
}

/// The number written, when it lies in `range`; `or` when it does not.
fn within(value: &Option<Spanned<f64>>, range: &RangeInclusive<f64>, or: f64) -> f64 {
    value
        .as_ref()
        .map(|v| *v.get_ref())
        .filter(|v| range.contains(v))
        .unwrap_or(or)
}

/// A width as written, trimmed, when it is one.
fn valid(width: &Spanned<String>) -> Option<String> {
    let text = width.get_ref().trim();
    share(text).map(|_| text.to_owned())
}

const WIDTH: &str = "is a share of the screen, such as \"1/3\", \"2/5\" or \"1\"";

impl ColumnsSettings {
    pub fn over(self, under: ColumnsSettings) -> ColumnsSettings {
        ColumnsSettings {
            presets: self.presets.or(under.presets),
            heights: self.heights.or(under.heights),
            default: self.default.or(under.default),
            alone: self.alone.or(under.alone),
            center: self.center.or(under.center),
            display: self.display.or(under.display),
            min: self.min.or(under.min),
            snap: self.snap.or(under.snap),
        }
    }

    pub fn defaults() -> ColumnsSettings {
        let spanned = |s: &str| Spanned::new(0..0, s.to_owned());
        ColumnsSettings {
            presets: Some(PRESETS.iter().map(|p| spanned(p)).collect()),
            heights: Some(HEIGHTS.iter().map(|p| spanned(p)).collect()),
            default: Some(spanned(DEFAULT)),
            alone: Some(spanned(ALONE)),
            center: Some(Center::Never),
            display: Some(Display::Stack),
            min: Some(Spanned::new(0..0, MIN)),
            snap: Some(Spanned::new(0..0, SNAP)),
        }
    }

    pub fn problems(&self) -> Vec<(Option<std::ops::Range<usize>>, String)> {
        let mut problems = Vec::new();
        for (key, list) in [("presets", &self.presets), ("heights", &self.heights)] {
            for preset in list.iter().flatten() {
                if share(preset.get_ref()).is_none() {
                    problems.push((Some(preset.span()), format!("columns.{key}: {WIDTH}")));
                }
            }
            if list.as_ref().is_some_and(Vec::is_empty) {
                problems.push((None, format!("columns.{key} needs one share at least")));
            }
        }
        for (key, width) in [("default", &self.default), ("alone", &self.alone)] {
            if let Some(width) = width
                && share(width.get_ref()).is_none()
            {
                problems.push((Some(width.span()), format!("columns.{key} {WIDTH}")));
            }
        }
        for (key, value, range, unit) in [
            ("min", &self.min, &MINS, "rem"),
            ("snap", &self.snap, &SNAPS, "pixels"),
        ] {
            if let Some(value) = value
                && !range.contains(value.get_ref())
            {
                problems.push((
                    Some(value.span()),
                    format!(
                        "columns.{key} is from {} to {} {unit}",
                        range.start(),
                        range.end()
                    ),
                ));
            }
        }
        problems
    }

    pub fn resolve(&self) -> Columns {
        let width = |width: &Option<Spanned<String>>, or: &str| {
            width
                .as_ref()
                .and_then(valid)
                .unwrap_or_else(|| or.to_owned())
        };
        Columns {
            presets: steps(&self.presets, &PRESETS),
            heights: steps(&self.heights, &HEIGHTS),
            default: width(&self.default, DEFAULT),
            alone: width(&self.alone, ALONE),
            center: self.center.unwrap_or(Center::Never),
            display: self.display.unwrap_or(Display::Stack),
            min: within(&self.min, &MINS, MIN),
            snap: within(&self.snap, &SNAPS, SNAP),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_width_is_a_share_of_the_screen() {
        assert_eq!(share("1/3"), Some(1.0 / 3.0));
        assert_eq!(share("1"), Some(1.0));
        assert_eq!(share(" 3 / 5 "), Some(0.6));
        assert_eq!(share("3/2"), None);
        assert_eq!(share("0"), None);
        assert_eq!(share("1/0"), None);
        assert_eq!(share("half"), None);
    }

    #[test]
    fn presets_come_narrowest_first_and_wrong_ones_are_named() {
        #[derive(Deserialize)]
        struct File {
            columns: ColumnsSettings,
        }
        let read = |text: &str| toml::from_str::<File>(text).unwrap().columns;
        let mine = read("[columns]\npresets = [\"1\", \"2/5\", \"wide\", \"2/5\"]\n");
        assert_eq!(mine.problems().len(), 1);
        let columns = mine.over(ColumnsSettings::defaults()).resolve();
        assert_eq!(columns.presets, ["2/5", "1"]);
        assert_eq!(columns.heights, ["1/3", "1/2", "2/3"]);
        let tall = read("[columns]\nheights = [\"3/4\", \"1/4\", \"tall\"]\n");
        assert_eq!(tall.problems().len(), 1);
        assert_eq!(tall.resolve().heights, ["1/4", "3/4"]);
        assert_eq!(columns.default, "1/2");
        assert_eq!(columns.alone, "1");
        assert_eq!(columns.display, Display::Stack);
        let deck = read("[columns]\ndisplay = \"deck\"\n");
        assert_eq!(deck.resolve().display, Display::Deck);
        let old = read("[columns]\ndisplay = \"tabs\"\n");
        assert_eq!(old.resolve().display, Display::Deck);
        let half = read("[columns]\nalone = \"1/2\"\n");
        assert_eq!(half.resolve().alone, "1/2");
        assert_eq!(read("[columns]\nalone = \"all\"\n").problems().len(), 1);
        assert_eq!(columns.center, Center::Never);
        let centred = read("[columns]\ncenter = \"on-overflow\"\n");
        assert_eq!(centred.resolve().center, Center::OnOverflow);
        assert_eq!(columns.min, 30.0);
        let wide = read("[columns]\nmin = 40\n");
        assert_eq!(wide.problems().len(), 0);
        assert_eq!(wide.resolve().min, 40.0);
        let wrong = read("[columns]\nmin = -1\n");
        assert_eq!(wrong.problems().len(), 1);
        assert_eq!(wrong.resolve().min, 30.0);
        assert_eq!(columns.snap, 8.0);
        assert_eq!(read("[columns]\nsnap = 0\n").resolve().snap, 0.0);
        let far = read("[columns]\nsnap = 100\n");
        assert_eq!(far.problems().len(), 1);
        assert_eq!(far.resolve().snap, 8.0);
    }
}
