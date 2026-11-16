//! A column's words the model reads: how it shows its Panes, and a width
//! as a share of the screen. The widths themselves are `tiling.toml`'s
//! `[columns]`, which `banda-look` reads (ADR 0127, decision 4).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_width_is_a_oneof_the_screen() {
        assert_eq!(share("1/3"), Some(1.0 / 3.0));
        assert_eq!(share("1"), Some(1.0));
        assert_eq!(share(" 3 / 5 "), Some(0.6));
        assert_eq!(share("3/2"), None);
        assert_eq!(share("0"), None);
        assert_eq!(share("1/0"), None);
        assert_eq!(share("half"), None);
    }
}
