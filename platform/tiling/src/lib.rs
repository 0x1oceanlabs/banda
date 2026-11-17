//! The Tiling's model: the arrangement and its rules (`model`), where a
//! Pane goes when no one named a place (`placing`), and its commands as
//! functions of it (`commands`), with the words of `tiling.toml` they read
//! (`rule`, `columns`).
//!
//! It is a leaf: no store, no file, no clock, and no kernel but its IDs
//! and its refusal (`banda-base`). So the same code runs in the
//! engine, which keeps the arrangement (`banda-workspaces`), and, compiled
//! to WebAssembly, in a client that draws ahead of the engine's answer
//! (ADR 0088, decision 11; ADR 0135, step 3): the window does
//! (`platform/tiling/wasm`).

pub mod columns;
pub mod commands;
pub mod model;
pub mod placing;
pub mod rule;
