//! The kernel's words that code says without the kernel: the IDs, a
//! call's refusal and the reading of its parameters. The kernel hands them
//! on under its own name, so an engine's crate takes them from
//! `banda-kernel` as before. A crate that runs in a client too, as the Tiling's model does compiled to
//! WebAssembly (ADR 0088, decision 11), depends on this one alone: it
//! brings no store, no runtime and no source of randomness.
//!
//! The feature `engine` is the kernel's to turn on: with it an ID is text
//! in SQLite and `new()` makes one by the clock.

mod ids;
mod refusal;

pub use ids::{AgentId, CommandId, DeviceId, EventId, PersonId, ProjectId};
pub use refusal::{Code, Refusal, decode};

// The `id!` macro names these by this crate, so a crate that defines an ID
// need not depend on them itself.
#[cfg(feature = "engine")]
#[doc(hidden)]
pub use rusqlite;
#[doc(hidden)]
pub use schemars;
#[doc(hidden)]
pub use uuid;
