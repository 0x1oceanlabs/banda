//! The Harnesses of this computer (ADR 0040): the agent programs
//! `harnesses.toml` lists, how to find and start each, who is signed in to
//! it, and the pool of their processes; and the machine's module
//! `harnesses`, which a window asks about them ([`HarnessesModule`]). A
//! Thread runs on one, but this crate knows nothing of Threads: the agents
//! module builds on it, and never the other way.

pub mod acp;
pub mod cli;
pub mod hosts;
mod limits;
mod list;
pub mod model;
mod module;
mod record;

pub use list::{Cli, FILE, Harness, Harnesses, LimitsSettings};
pub use module::{HarnessesModule, LimitsNow, SETTINGS, account_changed};
