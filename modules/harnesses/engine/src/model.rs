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

/// Who is signed in to a Harness: a Harness entry on this computer as its
/// process says when it starts, and how a Person signs in to it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct Account {
    pub ways: Vec<SignInWay>,
    /// What runs, as it names itself.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<Adapter>,
    /// The Person's own CLI it runs, when it runs one.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<CliView>,
    /// Who it says is signed in; `None` when it does not say.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signed_in_as: Option<SignedInAs>,
    /// Signing out from Banda ends its sign-in: it declares ACP's logout,
    /// and an account is signed in. A key in its environment outlives a
    /// logout.
    pub signs_out: bool,
}

/// A Harness's program, as it names itself when it starts: for Claude
/// Code and Codex, their ACP adapter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct Adapter {
    pub name: String,
    pub version: String,
}

/// Who a Harness says is signed in, in its own words: a plan such as
/// "Claude Max" with its email, an API key, a gateway, or no one. Banda
/// reads none of its files to know.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct SignedInAs {
    /// Whether anyone is: `false` when the Harness says no one is.
    pub signed_in: bool,
    pub label: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
}

/// A way to sign in to a Harness, as the Harness offers it. Banda runs
/// it and holds none of the account's credentials: the Harness keeps them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct SignInWay {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The program a Person signs in with, in a terminal: it ends with
    /// code 0 when that worked. Without one the Harness signs in by itself,
    /// as Codex does in the browser.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<Program>,
}
