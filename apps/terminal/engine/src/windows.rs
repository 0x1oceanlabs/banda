//! The terminal module on Windows, which has no terminals yet: a ConPTY
//! comes with ADR 0090's step 7, and the servers started in Banda, found
//! in Windows' own tables of sockets and processes, with its step 8. Until
//! then `open`, `ports` and `stop_server` refuse and say so.

use crate::model::{Drawn, Open, Size};
use banda_kernel::{ModuleProject, ProjectId, Stream};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::watch;

/// Why a terminal does not open on Windows.
pub const NO_TERMINALS: &str = "Terminals are not on Windows yet: they come with a later \
    version of Banda (ADR 0090, step 7).";

/// Why Banda lists and stops no server on Windows.
pub const NO_SERVERS: &str = "The servers started in Banda are not on Windows yet: Banda \
    lists and stops them in a later version (ADR 0090, step 8).";

/// A terminal on Windows: none starts, so none is ever open.
pub struct Terminal {
    pub project: ProjectId,
    none: Infallible,
}

impl Terminal {
    pub fn start(
        _: &ModuleProject,
        _: Open,
        _: watch::Sender<()>,
    ) -> Result<Arc<Terminal>, String> {
        Err(NO_TERMINALS.to_owned())
    }

    pub fn ended(&self) -> bool {
        match self.none {}
    }

    pub fn runs_a_program(&self) -> bool {
        match self.none {}
    }

    pub async fn write(&self, _: &str) -> Result<(), String> {
        match self.none {}
    }

    pub async fn resize(&self, _: Size) -> Result<(), String> {
        match self.none {}
    }

    pub fn close(&self) {
        match self.none {}
    }

    pub fn watch(self: &Arc<Self>, _: Option<Drawn>) -> Stream {
        match self.none {}
    }
}
