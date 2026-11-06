//! What every test of the `banda` program shares.
// Each test file uses some of these.
#![allow(dead_code)]

use std::path::Path;
use std::process::{Command, Output};
use std::time::{Duration, Instant};

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

/// `banda` on `config` alone, to run as the test likes.
pub fn on(config: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_banda"));
    command
        .env("BANDA_CONFIG", config)
        .env("BANDA_OMARCHY", "")
        .env("XDG_CURRENT_DESKTOP", "")
        .env("BANDA_FONTCONFIG", "")
        .env_remove("HYPRLAND_INSTANCE_SIGNATURE");
    command
}

/// What `found` finds, asked every ten milliseconds until `within` passes.
pub fn wait_for<T>(within: Duration, mut found: impl FnMut() -> Option<T>) -> Option<T> {
    let until = Instant::now() + within;
    while Instant::now() < until {
        if let Some(found) = found() {
            return Some(found);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}
