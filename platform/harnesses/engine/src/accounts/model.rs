use banda_kernel::Refusal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountProfile {
    pub harness: String,
    /// An existing folder; the Harness must still check its sign-in.
    pub folder: String,
    /// The Account already using this folder, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account: Option<String>,
}

#[derive(Clone, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct ConnectAccount {
    /// The registered Harness: claude or codex.
    pub harness: String,
    /// Stable Account ID: lowercase letters, digits and hyphens.
    pub id: String,
    /// Its display name. The Harness's name when omitted.
    #[ts(optional)]
    pub name: Option<String>,
    /// Adopt an existing folder. Omitted: create an empty private folder.
    #[ts(optional)]
    pub folder: Option<String>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct RemoveAccount {
    pub harness: String,
    /// If supplied, refuse when the default changed since confirmation.
    #[ts(optional)]
    pub to: Option<String>,
}

/// Kept with the old entry so a resumed session still knows its source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Retirement {
    pub to: String,
    pub by: banda_kernel::Participant,
}

/// The one settings writer, injected by the engine to avoid making the
/// Harness module depend on every module whose settings it describes.
pub trait AccountStore: Send + Sync {
    fn selection(&self) -> Result<(Option<String>, Option<String>), Refusal> {
        Err(Refusal::conflict("Account removal is not configured."))
    }
    fn retire(&self, _retirement: &PreparedRetirement) -> Result<(), Refusal> {
        Err(Refusal::conflict("Account removal is not configured."))
    }
    fn save(&self, account: &ConnectedAccount) -> Result<(), Refusal>;
}

/// A validated connection prepared by Accounts for the settings writer.
/// No caller-supplied program or arbitrary environment crosses this boundary.
pub struct ConnectedAccount {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) harness: String,
    pub(super) variable: &'static str,
    pub(super) folder: std::path::PathBuf,
}
impl ConnectedAccount {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn harness(&self) -> &str {
        &self.harness
    }
    pub fn profile(&self) -> (&'static str, &std::path::Path) {
        (self.variable, &self.folder)
    }
}

/// A provider's report without the sign-in program's environment.
#[derive(Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountStatus {
    pub harness: String,
    pub ways: Vec<AccountWay>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub signed_in_as: Option<crate::model::SignedInAs>,
}

/// A sign-in choice without its program or environment.
#[derive(Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountWay {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginAccount {
    pub harness: String,
    /// From account_status.ways; the sole way when omitted.
    #[ts(optional)]
    pub way: Option<String>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginId {
    pub login: String,
}

#[derive(Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export_to = "harnesses/")]
pub struct LoginInput {
    pub login: String,
    /// Terminal input, including a newline when submitting a code.
    pub text: String,
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct LoginStatus {
    pub login: String,
    pub harness: String,
    /// The last 64 KiB of terminal output. No credential files are read.
    pub output: String,
    pub done: bool,
    /// Set only when done. Ask account_status after login_finish to
    /// confirm who signed in; a successful exit alone is not proof.
    #[ts(optional)]
    pub succeeded: Option<bool>,
}

/// A retirement validated by Accounts, ready for the settings writer.
pub struct PreparedRetirement {
    pub(super) id: String,
    pub(super) to: String,
    pub(super) by: banda_kernel::Participant,
    pub(super) clear_fallback: bool,
}
impl PreparedRetirement {
    pub fn entry(&self) -> (&str, &str, banda_kernel::Participant, bool) {
        (&self.id, &self.to, self.by, self.clear_fallback)
    }
}
