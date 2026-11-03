//! What the window reads of a Harness, written once in Rust for
//! TypeScript too (ADR 0014).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// A Harness this machine can run, as `harnesses.toml` has it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct HarnessView {
    pub id: String,
    pub name: String,
    /// Whether it is on.
    pub enabled: bool,
    /// How it starts: its program, then its arguments.
    pub command: Vec<String>,
    /// The names of the variables it starts with. Their values may be
    /// secrets, so they stay in the file.
    pub env: Vec<String>,
}

impl HarnessView {
    pub(crate) fn of(harness: &crate::Harness) -> Self {
        Self {
            id: harness.id.clone(),
            name: harness.name.clone(),
            enabled: harness.enabled,
            command: [&harness.command]
                .into_iter()
                .chain(&harness.args)
                .cloned()
                .collect(),
            env: harness.env.keys().cloned().collect(),
        }
    }
}

/// The Person's own CLI that a Harness runs, where it was found and the
/// version it says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct CliView {
    pub path: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// In plain words, that the version is older than the Harness
    /// supports.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outdated: Option<String>,
}

/// A program with its arguments, never a shell line, and what it adds to
/// the engine's environment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct Program {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}
