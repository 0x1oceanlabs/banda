//! The Apps this engine runs, as its scan of their manifests found them
//! (ADR 0062, decision 11): each by its id, its version and the major of
//! the App API it is written to, as the `welcome` lists them (ADR 0082,
//! decisions 11 and 14), and with the methods each gives, as
//! `apps.describe` answers (decision 2). The kernel names no App: the
//! engine hands it the list ([`KernelBuilder::apps`](crate::KernelBuilder::apps)).

use crate::{Method, Nothing, Participant, Refusal, Right};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
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

/// The Apps this engine runs, as the engine handed them.
pub(crate) struct Apps(Arc<[AppMethods]>);

crate::methods! {
    Apps(Participant) as "AppsMethods" in "./" {
        /// Each App this engine runs, and each part of the platform: its
        /// id, its version, the major of the App API it is written to, and
        /// the methods its engine part gives, `<id>.<name>`, each with its
        /// kind, the right it needs, whether it reads or acts, and what it
        /// does.
        call describe(Nothing) -> Vec<AppMethods>, Read;
    }
}

impl Apps {
    pub(crate) fn new(apps: Vec<AppMethods>) -> Self {
        Apps(apps.into())
    }

    /// Each App as the `welcome` lists it.
    pub(crate) fn listed(&self) -> Vec<App> {
        self.0
            .iter()
            .map(|described| described.app.clone())
            .collect()
    }

    /// The right a method of `apps.*` needs, or `None`.
    pub(crate) fn right(name: &str) -> Option<Right> {
        Self::method_right(name)
    }

    pub(crate) async fn call(
        &self,
        by: Participant,
        name: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        self.dispatch(by, name, params).await
    }

    async fn describe(&self, _: Participant, _: Nothing) -> Result<Vec<AppMethods>, Refusal> {
        Ok(self.0.to_vec())
    }
}
