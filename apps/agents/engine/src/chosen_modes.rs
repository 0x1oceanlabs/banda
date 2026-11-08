//! The mode the Person chose for each Harness's new Threads, in Settings →
//! Agents (ADR 0083, F0-3; Roma, 2026-11-08). The settings Pane writes
//! `agents.toml`'s `start.<id>.mode` through the engine, as the Person,
//! and the engine keeps here what they chose, in its state folder. Full
//! access in the file is the Person's choice only where it is what they
//! chose here: one written there by hand, or by anything else, is no
//! one's, so a new Thread on that Harness starts as the fence has it,
//! Supervised where it does not hold whole. A Thread's own mode menu is
//! the Person's through the engine already (`agents.configure`).
//!
//! It counts only where the fence does not hold, and there nothing keeps
//! a program the Person runs from what the Person can do: this keeps Full
//! access from a hand edit of `agents.toml` and from a program that
//! writes the file, not from an Agent that runs commands as the Person.

use crate::model::Mode;
use std::collections::BTreeMap;
use std::io;
use std::path::Path;

/// Its file, in the engine's state folder.
pub const FILE: &str = "modes-chosen.json";

/// The mode the Person chose for the new Threads of the Harness `harness`,
/// as `file` keeps it; none when they chose none, or the file says nothing
/// that reads.
pub fn chosen(file: &Path, harness: &str) -> Option<Mode> {
    read(file).remove(harness)
}

/// Keeps `mode` as what the Person chose for the new Threads of the
/// Harness `harness`; none takes their choice back.
pub fn choose(file: &Path, harness: &str, mode: Option<Mode>) -> io::Result<()> {
    let mut modes = read(file);
    let was = match mode {
        Some(mode) => modes.insert(harness.to_owned(), mode),
        None => modes.remove(harness),
    };
    match was == mode {
        true => Ok(()),
        false => write(file, &modes),
    }
}

/// Takes back every choice: the whole `[start]` changed some other way.
pub fn forget(file: &Path) -> io::Result<()> {
    match read(file).is_empty() {
        true => Ok(()),
        false => write(file, &BTreeMap::new()),
    }
}

fn read(file: &Path) -> BTreeMap<String, Mode> {
    let bytes = std::fs::read(file).unwrap_or_default();
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Writes `modes` whole or not at all: beside the file first, then renamed
/// over it.
fn write(file: &Path, modes: &BTreeMap<String, Mode>) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let mut aside = file.as_os_str().to_owned();
    aside.push(".new");
    let aside = Path::new(&aside);
    std::fs::write(aside, serde_json::to_vec_pretty(modes)?)?;
    banda_kernel::host::rename(aside, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_choice_is_kept_by_harness_until_taken_back() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("state").join(FILE);
        assert_eq!(chosen(&file, "claude"), None, "no file: none chosen");
        choose(&file, "claude", Some(Mode::FullAccess)).unwrap();
        choose(&file, "codex", Some(Mode::Supervised)).unwrap();
        assert_eq!(chosen(&file, "claude"), Some(Mode::FullAccess));
        assert_eq!(chosen(&file, "codex"), Some(Mode::Supervised));
        choose(&file, "claude", None).unwrap();
        assert_eq!(chosen(&file, "claude"), None);
        assert_eq!(chosen(&file, "codex"), Some(Mode::Supervised));
        forget(&file).unwrap();
        assert_eq!(chosen(&file, "codex"), None);
        // What does not read is no choice.
        std::fs::write(&file, "not json").unwrap();
        assert_eq!(chosen(&file, "codex"), None);
    }
}
