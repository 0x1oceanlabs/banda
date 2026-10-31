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
//!   do something.
//! - [`api`] serves all of it over WebSocket.

pub mod access;
pub mod api;
mod error;
mod events;
mod ids;
mod kernel;
mod module;
mod outbox;
mod space;
mod store;

pub use access::Right;
pub use error::{Code, Error, Refusal};
pub use events::{Event, EventFilter};
pub use ids::{AgentId, CommandId, EventId, Participant, PersonId, SpaceId};
pub use kernel::{Kernel, KernelBuilder, SpaceSummary, decode};
pub use module::{Call, Module};
pub use outbox::{Effect, OnRestart, Outcome, Settled};
pub use space::{ModuleSpace, Space};
pub use store::Tx;

/// The version of the API's wire protocol. A window that speaks another
/// version is refused before anything else (ADR 0002, decision 8).
pub const PROTOCOL: u32 = 1;

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
