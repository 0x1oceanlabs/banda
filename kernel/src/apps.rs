//! The Apps this engine runs, as its scan of their manifests found them
//! (ADR 0062, decision 11): each by its id, its version and the major of
//! the App API it is written to, as the `welcome` lists them (ADR 0082,
//! decisions 11 and 14), and with the methods each gives, as the
//! platform's `apps.describe` answers (decision 2). The kernel names no
//! App: the engine hands it the list
//! ([`KernelBuilder::apps`](crate::KernelBuilder::apps)).

use crate::Method;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One App, or a part of the platform, as an engine's `welcome` lists it.
/// A door to come lists its Apps the same way (ADR 0124, decision 3), so
/// what is added here only adds a field.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct App {
    /// Its id, its folder's name: `terminal`.
    pub id: String,
    /// Its version, as its manifest says.
    pub version: String,
    /// The major of the App API it is written to.
    pub api: u32,
}

/// An App and the methods its engine part gives, none when it has no
/// engine part, as `apps.describe` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct AppMethods {
    #[serde(flatten)]
    #[ts(flatten)]
    pub app: App,
    pub methods: Vec<Method>,
}
