//! The kernel: what every module needs, and nothing that names a module
//! (ADR 0001, decision 3; `docs/architecture.md`).
//!
//! - [`Kernel`] keeps the Spaces of this machine and routes each call to
//!   the module that owns it.
//! - [`Space`] is a folder with its own SQLite. One writer thread commits
//!   every change, and events are published only after commit (ADR 0002).
//! - A [`Module`] owns its words, its tables and its events. It reaches its
//!   Space only through a [`ModuleSpace`], which can emit only that module's
//!   events.
//! - The outbox runs side effects after commit, in order per target, and
//!   settles what a restart cut short.
//! - [`access::decide`] is the one place that says whether a Participant may
//!   do something, and [`access::within`] keeps an Agent in its Space.
//! - A pass names an Agent's session in its Space, for `banda mcp`
//!   ([`ModuleSpace::pass`]).
//! - The window's road lets a module ask the window and await its answer
//!   ([`Call::ask_window`]).
//! - [`api`] serves all of it over WebSocket.

pub mod access;
pub mod api;
mod error;
mod events;
mod ids;
mod kernel;
pub mod methods;
mod module;
mod old;
mod outbox;
mod passes;
mod space;
mod store;
mod window;

pub use access::{Caller, Right};
pub use error::{Code, Error, Refusal};
pub use events::{Event, EventFilter};
pub use ids::{AgentId, CommandId, EventId, Participant, PersonId, SpaceId};
pub use kernel::{Kernel, KernelBuilder, SpaceSummary, decode};
pub use methods::{Method, Nothing, Picture, Tool};
pub use module::{Call, Module, Scope, Stream, Wall};
pub use outbox::{Effect, OnRestart, Outcome, Settled};
pub use passes::secret;
/// For `methods!` and `id!`, which name it from a module's crate.
pub use schemars;
pub use space::{Committed, Heard, ModuleSpace, Space};
pub use store::Tx;
pub use window::{WindowAnswer, WindowRequest};

/// The variable that names its Space in the environment of what Banda
/// starts in one, a terminal's program or a Harness's process, which all
/// they start inherits: so the servers started in Banda are known by it
/// (ADR 0044, decision 2).
pub const SPACE_VARIABLE: &str = "BANDA_SPACE";

/// The version of the API's wire protocol. A window that speaks another
/// version is refused before anything else (ADR 0002, decision 8).
pub const PROTOCOL: u32 = 1;

static VERSION: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();

/// Banda's version, as its app says it (ADR 0033, decision 2): the one
/// the engine was built with (`engine/build.rs`), told as it starts, so a
/// new version rebuilds the engine alone. The workspace's until then.
pub fn version() -> &'static str {
    VERSION.get().copied().unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Tells the modules Banda's version; the engine does, once, as it starts.
pub fn set_version(version: &'static str) {
    let _ = VERSION.set(version);
}

/// A name that works as one file or folder name: 1 to 64 characters, with
/// no slashes and no leading dot. Returns it without surrounding spaces.
pub fn plain_name(name: &str) -> Option<&str> {
    let name = name.trim();
    let plain = !name.is_empty()
        && name.chars().count() <= 64
        && !name.starts_with('.')
        && !name.contains(['/', '\\', '\0']);
    plain.then_some(name)
}

/// Milliseconds since the Unix epoch: the one clock reading the kernel uses.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}
