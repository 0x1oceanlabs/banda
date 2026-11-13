//! The terminal module's words on the wire.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

banda_kernel::id!(
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

    pub fn pty(self) -> banda_kernel::PtySize {
        banda_kernel::PtySize {
            rows: self.rows,
            cols: self.cols,
        }
    }
}

/// What `terminal.open` starts: a program with its arguments, never a
/// shell line, or the Person's shell when it names none. It runs in the
/// Project's folder, with the engine's environment and `env` on top.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Open {
    pub terminal: TerminalId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub program: Option<String>,
    #[serde(default)]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub args: Vec<String>,
    #[serde(default)]
    #[ts(as = "Option<BTreeMap<String, String>>", optional)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    #[ts(as = "Option<Size>", optional)]
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
        /// The engine runs a session's writes and sizes to this terminal
        /// in the order it sent them, so its client sends each key as it
        /// is typed, before the last one's answer. An engine older than
        /// that order says nothing here, and runs them side by side: its
        /// client sends one at a time.
        #[ts(optional, as = "Option<bool>")]
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        in_order: bool,
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
    /// Another program runs in front, or in another folder.
    Titled {
        title: Title,
    },
}

/// What runs in front in a terminal, and in which folder: what its Pane's
/// header says, as `pnpm dev` in `~/code/banda`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Title {
    /// The program and its arguments; a script's name stands for the
    /// program that runs it, as `pnpm dev` for `node /usr/bin/pnpm dev`.
    pub program: String,
    /// Its folder, with `~` for the home folder.
    pub folder: String,
    /// Its folder in full: where the paths it prints start.
    pub path: String,
    /// The home folder, which `~` names; none where the system has none.
    pub home: Option<String>,
}

/// How many of a Project's terminals run a program in front: one their
/// shell started, or the program a terminal was opened with, until it
/// ends. A shell that waits for what is typed runs none. It is there so
/// a machine's update can wait while one does, as it waits for a Turn
/// (ADR 0106, decision 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Running {
    pub terminals: u32,
}

/// A Project's servers, in the order they came (ADR 0044, decision 4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Servers {
    pub servers: Vec<Server>,
}

/// A program started in Banda that listens on a loopback or wildcard
/// address (ADR 0044, decision 1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Server {
    pub port: u16,
    /// Its process, which `stop_server` names.
    pub process: u32,
    /// Its command line in a few words, as a terminal's header names a
    /// program: `pnpm dev`.
    pub program: String,
    pub by: StartedBy,
}

/// What started a server: a terminal, or an Agent through its Harness.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "terminal/")]
pub enum StartedBy {
    Terminal,
    Agent,
}
