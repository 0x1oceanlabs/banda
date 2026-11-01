//! What every test of the `banda` program shares.

use std::path::Path;
use std::process::{Command, Output};

/// Runs `banda` on `config` alone: no Omarchy, no system fonts, no
/// Hyprland, so a test never reads the Person's own settings.
pub fn banda(config: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_banda"))
        .args(args)
        .env("BANDA_CONFIG", config)
        .env("BANDA_OMARCHY", "")
        .env("BANDA_FONTCONFIG", "")
        .env_remove("HYPRLAND_INSTANCE_SIGNATURE")
        .output()
        .expect("banda runs")
}
