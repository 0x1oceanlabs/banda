//! `[columns]`, as niri's: the widths a column steps through, the width a
//! new one opens at, and whether the focused one stays centred (ADR 0007,
//! decision 2).
//!
//! A width is a share of the screen as a fraction, `"1/3"`, or `"1"` for
//! all of it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use ts_rs::TS;

#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct ColumnsSettings {
    /// What Alt+Ctrl+Left and Right step through.
    #[schemars(with = "Option<Vec<String>>")]
    pub presets: Option<Vec<Spanned<String>>>,
    /// A new column's width, where its Pane does not ask for its own.
    #[schemars(with = "Option<String>")]
    pub default: Option<Spanned<String>>,
    pub center: Option<Center>,
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

/// `[columns]` resolved: valid widths only, narrowest first.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Columns {
    pub presets: Vec<String>,
    pub default: String,
    pub center: Center,
}

const PRESETS: [&str; 4] = ["1/3", "1/2", "2/3", "1"];
const DEFAULT: &str = "1/2";

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

const WIDTH: &str = "is a share of the screen, such as \"1/3\", \"2/5\" or \"1\"";

impl ColumnsSettings {
    pub fn over(self, under: ColumnsSettings) -> ColumnsSettings {
        ColumnsSettings {
            presets: self.presets.or(under.presets),
            default: self.default.or(under.default),
            center: self.center.or(under.center),
        }
    }

    pub fn defaults() -> ColumnsSettings {
        let spanned = |s: &str| Spanned::new(0..0, s.to_owned());
        ColumnsSettings {
            presets: Some(PRESETS.iter().map(|p| spanned(p)).collect()),
            default: Some(spanned(DEFAULT)),
            center: Some(Center::Never),
        }
    }

    pub fn problems(&self) -> Vec<(Option<std::ops::Range<usize>>, String)> {
        let mut problems = Vec::new();
        for preset in self.presets.iter().flatten() {
            if share(preset.get_ref()).is_none() {
                problems.push((Some(preset.span()), format!("columns.presets: {WIDTH}")));
            }
        }
        if self.presets.as_ref().is_some_and(Vec::is_empty) {
            problems.push((None, "columns.presets needs one width at least".to_owned()));
        }
        if let Some(default) = &self.default
            && share(default.get_ref()).is_none()
        {
            problems.push((Some(default.span()), format!("columns.default {WIDTH}")));
        }
        problems
    }

    pub fn resolve(&self) -> Columns {
        let mut presets: Vec<(f64, String)> = self
            .presets
            .iter()
            .flatten()
            .filter_map(|p| {
                let text = p.get_ref().trim().to_owned();
                share(&text).map(|s| (s, text))
            })
            .collect();
        presets.sort_by(|a, b| a.0.total_cmp(&b.0));
        presets.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        let presets = if presets.is_empty() {
            PRESETS.iter().map(|p| (*p).to_owned()).collect()
        } else {
            presets.into_iter().map(|(_, text)| text).collect()
        };
        let default = self
            .default
            .as_ref()
            .map(|d| d.get_ref().trim().to_owned())
            .filter(|d| share(d).is_some())
            .unwrap_or_else(|| DEFAULT.to_owned());
        Columns {
            presets,
            default,
            center: self.center.unwrap_or(Center::Never),
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
        assert_eq!(columns.default, "1/2");
        assert_eq!(columns.center, Center::Never);
        let centred = read("[columns]\ncenter = \"on-overflow\"\n");
        assert_eq!(centred.resolve().center, Center::OnOverflow);
    }
}
