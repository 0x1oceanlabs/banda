//! The Harnesses of this computer (ADR 0040, decision 6): the agent
//! programs `harnesses.toml` lists, how to find and start each, who is
//! signed in to it, and the pool of their processes. A Thread runs on one,
//! but this crate knows nothing of Threads: the agents module builds on
//! it, and never the other way.

pub mod acp;
pub mod cli;
pub mod hosts;
mod list;
pub mod model;
mod record;

pub use list::{Cli, FILE, Harness, Harnesses};
