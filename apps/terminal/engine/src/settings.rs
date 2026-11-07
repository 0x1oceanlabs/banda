//! How the terminal writes (ADR 0047, decision 2): the Person's
//! `~/.config/banda/terminal.toml`, over Banda's defaults. It is this
//! machine's, as the look is: the look resolves it, as
//! `files["terminal.toml"]`, and the window draws what it says. A font or
//! a size left out is the look's.

use banda_look::{OneFile, Problem};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../terminal.toml");

/// The sizes the terminal writes at, in pixels: the window's terminal
/// takes no other (`client/ghostty/src/t3/surface.ts`).
pub const SIZES: std::ops::RangeInclusive<f64> = 6.0..=32.0;

/// The cursor's shape.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "terminal/")]
pub enum CursorStyle {
    /// The whole cell.
    #[default]
    Block,
    /// A line before the cell.
    Bar,
    /// A line under the cell.
    Underline,
}

/// The cursor, until a program asks for another.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct CursorSettings {
    /// Its shape: the whole cell, a line before it, or a line under it.
    pub style: Option<CursorStyle>,
    /// Whether it blinks.
    pub blink: Option<bool>,
}

/// How Banda's terminal writes: its font, size and ligatures, and its
/// cursor. Every key is optional.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct TerminalSettings {
    /// The font: a font's name, or a CSS list of them. Left out, the
    /// look's mono font.
    pub font: Option<String>,
    /// The text's size, in pixels. Left out, three quarters of the look's
    /// text size.
    #[schemars(range(min = 6, max = 32))]
    pub size: Option<f64>,
    /// Whether -> => != and the like are drawn as one sign, as the font
    /// draws them.
    pub ligatures: Option<bool>,
    /// The cursor, until a program asks for another.
    #[serde(default)]
    pub cursor: CursorSettings,
}

impl CursorSettings {
    fn over(self, under: Self) -> Self {
        CursorSettings {
            style: self.style.or(under.style),
            blink: self.blink.or(under.blink),
        }
    }
}

/// How the terminal writes, every key resolved: a font or a size that is
/// `None` is the look's.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Writing {
    pub font: Option<String>,
    pub size: Option<f64>,
    pub ligatures: bool,
    pub cursor: CursorStyle,
    pub blink: bool,
}

impl OneFile for TerminalSettings {
    const NAME: &'static str = "terminal.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    type Resolved = Writing;

    fn defaults() -> Self {
        TerminalSettings {
            font: None,
            size: None,
            ligatures: Some(true),
            cursor: CursorSettings {
                style: Some(CursorStyle::Block),
                blink: Some(true),
            },
        }
    }

    fn over(self, under: Self) -> Self {
        TerminalSettings {
            font: self.font.or(under.font),
            size: self.size.or(under.size),
            ligatures: self.ligatures.or(under.ligatures),
            cursor: self.cursor.over(under.cursor),
        }
    }

    fn resolved(self) -> Writing {
        let cursor = self.cursor;
        Writing {
            font: self.font,
            size: self.size,
            ligatures: self.ligatures.unwrap_or(true),
            cursor: cursor.style.unwrap_or_default(),
            blink: cursor.blink.unwrap_or(true),
        }
    }

    /// A font names one, and the size is from 6 to 32 pixels.
    fn check(&mut self, path: &Path, _text: &str, problems: &mut Vec<Problem>) {
        if self
            .font
            .as_deref()
            .is_some_and(|font| font.trim().is_empty())
        {
            problems.push(Problem::of_key(path, "font", "font names a font"));
            self.font = None;
        }
        if self.size.is_some_and(|size| !SIZES.contains(&size)) {
            problems.push(Problem::of_key(
                path,
                "size",
                format!("size is from {} to {} pixels", SIZES.start(), SIZES.end()),
            ));
            self.size = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_look::theme::Places;

    fn resolved(text: Option<&str>) -> (Writing, Vec<Problem>) {
        let folder = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(folder.path().join("terminal.toml"), text).unwrap();
        }
        let mut problems = Vec::new();
        let (writing, _) = banda_look::file::resolve::<TerminalSettings>(
            &Places::at(folder.path()),
            &mut problems,
            &mut Vec::new(),
        );
        (writing, problems)
    }

    const BANDA: Writing = Writing {
        font: None,
        size: None,
        ligatures: true,
        cursor: CursorStyle::Block,
        blink: true,
    };

    #[test]
    fn no_file_is_the_looks_font_with_ligatures_and_a_blinking_block() {
        assert_eq!(resolved(None), (BANDA, vec![]));
    }

    #[test]
    fn the_template_is_the_defaults() {
        assert_eq!(resolved(Some(TEMPLATE)), (BANDA, vec![]));
    }

    #[test]
    fn the_file_chooses_each_key_and_keeps_the_rest() {
        let (writing, problems) = resolved(Some(
            "font = \"Iosevka\"\nsize = 13.5\nligatures = false\n[cursor]\nstyle = \"bar\"\n",
        ));
        assert!(problems.is_empty());
        assert_eq!(
            writing,
            Writing {
                font: Some("Iosevka".to_owned()),
                size: Some(13.5),
                ligatures: false,
                cursor: CursorStyle::Bar,
                blink: true,
            }
        );
    }

    #[test]
    fn an_empty_font_or_a_size_out_of_range_is_a_problem_and_left_out() {
        let (writing, problems) = resolved(Some("font = \" \"\nsize = 64\n"));
        assert_eq!(writing, BANDA);
        assert_eq!(problems.len(), 2);
        let (_, problems) = resolved(Some("[cursor]\nstyle = \"beam\"\n"));
        assert_eq!(problems.len(), 1);
    }
}
