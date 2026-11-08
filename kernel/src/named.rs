//! What a host is called and drawn by, the same in every window that
//! shows it: a short name and one icon (ADR 0095). The host names itself,
//! in its own `machine.toml` (ADR 0081, decision 12: a file of the
//! host's), else as Banda found it; the engine says it in its `welcome`,
//! and again on the `machine.named` stream whenever it changes.

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// The longest a host's name is, in characters.
pub const NAME_MOST: usize = 16;

/// A host's name and icon.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Named {
    /// Up to 16 characters, never empty.
    pub name: String,
    pub icon: MachineIcon,
}

/// `named` as a `welcome` says it, read by a client that may be older
/// than the engine: an icon it has not reads as `desktop`, and what it
/// cannot read at all as none, so a newer engine's icon never stops it
/// connecting, as `banda mcp` does again after an update. `machine.toml`
/// holds to the icons Banda has.
pub(crate) fn lenient<'de, D: Deserializer<'de>>(said: D) -> Result<Option<Named>, D::Error> {
    #[derive(Deserialize)]
    struct Said {
        name: String,
        icon: serde_json::Value,
    }
    let said = Option::<serde_json::Value>::deserialize(said)?;
    let said = said.and_then(|said| serde_json::from_value::<Said>(said).ok());
    Ok(said.map(|said| Named {
        name: said.name,
        icon: serde_json::from_value(said.icon).unwrap_or(MachineIcon::Desktop),
    }))
}

/// The icons a host may take, each one of Lucide's, drawn in the text's
/// colour (ADR 0095, decision 1). None of them is drawn like an account's
/// emblem (ADR 0093), and no colour sets one machine apart: colour is the
/// account's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum MachineIcon {
    /// A laptop: Lucide's `laptop`.
    Laptop,
    /// A desktop, a Mac mini, an iMac: `monitor`.
    Desktop,
    /// A tower: `pc-case`.
    Tower,
    /// A server: `server`.
    Server,
    /// A database's server: `database`.
    Database,
    /// A NAS: `hard-drive`.
    Storage,
    /// A router, a Raspberry Pi: `router`.
    Router,
    /// A VM, a cloud host: `monitor-cloud`.
    Vm,
    /// A phone: `smartphone`.
    Phone,
    /// A tablet: `tablet`.
    Tablet,
}
