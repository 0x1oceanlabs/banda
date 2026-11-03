//! The Harnesses of this computer (ADR 0040, decision 6): the agent
//! programs `harnesses.toml` lists, and how to find and start each. A
//! Thread runs on one, but this crate knows nothing of Threads: the agents
//! module builds on it, and never the other way.

pub mod cli;
mod list;
pub mod model;

pub use list::{Cli, FILE, Harness, Harnesses};
