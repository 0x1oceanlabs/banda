//! The terminal module's words on the wire.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

bandaso_kernel::id!(
    /// A terminal. The window chooses it, so a Pane names its terminal
    /// before the engine answers.
    TerminalId,
    export_to = "terminal/"
);

/// A terminal's size, in cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

impl Default for Size {
    fn default() -> Self {
        Size { cols: 80, rows: 24 }
    }
}

impl Size {
    /// Whether a PTY can have it.
    pub fn fits(&self) -> bool {
        (1..=1000).contains(&self.cols) && (1..=500).contains(&self.rows)
    }

    pub fn pty(self) -> pty_process::Size {
        pty_process::Size::new(self.rows, self.cols)
    }
}

/// What `terminal.open` starts: a program with its arguments, never a
/// shell line, or the Person's shell when it names none. It runs in the
/// Space's folder, with the engine's environment and `env` on top.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Open {
    pub terminal: TerminalId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub program: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub size: Size,
}

/// How a terminal's program ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Ended {
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<i32>,
}

/// What `terminal.watch` says: the screen first, then what the program
/// prints, the size a window gives it, and that it ended.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "terminal/")]
pub enum Piece {
    /// Everything it keeps: show this, from a clear screen.
    Snapshot {
        history: String,
        size: Size,
        #[ts(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ended: Option<Ended>,
    },
    Output {
        text: String,
    },
    /// A window made it this size.
    Resized {
        size: Size,
    },
    Exited {
        ended: Ended,
    },
}
