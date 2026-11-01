//! What every test of the `banda` program shares.
// Each test file uses some of these.
#![allow(dead_code)]

use std::path::Path;
use std::process::{Command, Output};

/// Runs `banda` on `config` alone: no Omarchy, no system fonts, no
/// Hyprland, so a test never reads the Person's own settings.
pub fn banda(config: &Path, args: &[&str]) -> Output {
    on(config).args(args).output().expect("banda runs")
}

/// `banda` with `args` on `config` alone, as [`banda`] runs it, with its
/// state in `state`.
pub fn banda_in(config: &Path, state: &Path, args: &[&str]) -> Output {
    on(config)
        .args(args)
        .env("BANDA_STATE", state)
        .output()
        .expect("banda runs")
}

fn on(config: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_banda"));
    command
        .env("BANDA_CONFIG", config)
        .env("BANDA_OMARCHY", "")
        .env("BANDA_FONTCONFIG", "")
        .env_remove("HYPRLAND_INSTANCE_SIGNATURE");
    command
}
