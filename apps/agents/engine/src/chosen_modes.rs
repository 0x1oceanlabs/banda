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
//!
//! Which keys of `agents.toml` only the Person changes is said here too
//! ([`only_the_person`]), beside what is kept as they change them
//! ([`chose`]): both read the keys of `[start]`.

use crate::model::Mode;
use std::collections::BTreeMap;
use std::io;
use std::path::Path;
use toml_edit::Key;

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

/// Why only the Person changes the key of `parts` in `agents.toml`, to
/// `value` when it is set (ADR 0083): how freely a new Thread's Agent
/// acts, and the Accounts it starts on, which `banda account` changes.
pub fn only_the_person(parts: &[&str], value: Option<&str>) -> Option<&'static str> {
    match parts {
        ["start"] => Some(MODE_WORDS),
        ["start", "account" | "fallback"] => Some(banda_harnesses::accounts::BY_ITS_COMMANDS),
        // A whole table set at once names each of its keys.
        ["start", _] if value.is_none() || banda_look::file::names(value, &["mode"]) => {
            Some(MODE_WORDS)
        }
        ["start", _, "mode"] => Some(MODE_WORDS),
        _ => None,
    }
}

const MODE_WORDS: &str = "Only your Person chooses how freely a new Thread's Agent acts. Give \
                          them the line, to set it themselves.";

/// Keeps what the Person chose as a Harness's new Threads' mode, in
/// `record`, as they change `key` of the file called
/// `name` to `value`, or take it out (none), through the engine, as the
/// settings Pane does (ADR 0083, F0-3). `start.<id>.mode` set is that mode
/// chosen; taken out, or its table taken out, the choice is taken back, and
/// the whole `[start]` changed takes back every one. Only the Person's own
/// changes come here: an Agent's are no choice. A key renamed comes as
/// taken out under either name.
pub fn chose(record: &Path, name: &str, key: &str, value: Option<&str>) -> io::Result<()> {
    let Ok(parts) = Key::parse(key) else {
        return Ok(());
    };
    if name != "agents.toml" {
        return Ok(());
    }
    let parts: Vec<&str> = parts.iter().map(Key::get).collect();
    // As `set` takes the text: a TOML value, or else the text as a string.
    let value = value.map(|value| {
        (value.parse::<toml_edit::Value>()).unwrap_or_else(|_| toml_edit::Value::from(value))
    });
    let mode_of = |value: &toml_edit::Value| {
        serde_json::from_value::<Mode>(serde_json::Value::from(value.as_str()?)).ok()
    };
    match (parts.as_slice(), &value) {
        (["start"], _) => forget(record),
        // The accounts a new Thread starts on are no Harness's mode.
        (["start", "account" | "fallback"], _) => Ok(()),
        (["start", harness], None) => choose(record, harness, None),
        // A whole table set that names no mode chooses none, and takes
        // none back.
        (["start", harness], Some(table)) => {
            match table.as_inline_table().and_then(|table| table.get("mode")) {
                Some(mode) => choose(record, harness, mode_of(mode)),
                None => Ok(()),
            }
        }
        (["start", harness, "mode"], value) => {
            choose(record, harness, value.as_ref().and_then(mode_of))
        }
        _ => Ok(()),
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

    /// What the Person sets as a Harness's new Threads' mode through the
    /// engine is kept as their choice, and taken back as it goes (ADR
    /// 0083, F0-3).
    #[test]
    fn the_person_s_new_thread_mode_is_kept_as_chosen_and_taken_back_as_it_goes() {
        let folder = tempfile::tempdir().unwrap();
        let record = folder.path().join(FILE);
        let chosen = |harness| chosen(&record, harness);
        let set = |key: &str, value: &str| chose(&record, "agents.toml", key, Some(value)).unwrap();
        let reset = |key: &str| chose(&record, "agents.toml", key, None).unwrap();

        set("start.claude.mode", "\"full_access\"");
        set("start.'codex'.\"mode\"", "auto");
        assert_eq!(chosen("claude"), Some(Mode::FullAccess));
        assert_eq!(
            chosen("codex"),
            Some(Mode::Auto),
            "as `set` reads bare text"
        );
        // What is not a mode's key, or not agents.toml's, chooses nothing.
        set("start.claude.model", "\"opus\"");
        chose(&record, "look.toml", "start.claude.mode", Some("\"auto\"")).unwrap();
        set("start.claude", "{ model = \"opus\" }");
        assert_eq!(chosen("claude"), Some(Mode::FullAccess));
        set("start.claude", "{ mode = \"supervised\" }");
        assert_eq!(chosen("claude"), Some(Mode::Supervised));
        set("start.claude.mode", "\"fast\"");
        assert_eq!(chosen("claude"), None, "no mode Banda has");

        set("start.claude.mode", "\"full_access\"");
        reset("start.claude");
        assert_eq!(chosen("claude"), None);
        set("start.claude.mode", "\"full_access\"");
        reset("start.claude.mode");
        assert_eq!(chosen("claude"), None);
        reset("start");
        assert_eq!(chosen("codex"), None);
    }

    /// The file itself says it, so the engine refuses an Agent these keys
    /// (ADR 0083).
    #[test]
    fn only_the_person_changes_a_new_thread_s_mode_and_its_accounts() {
        let file = &crate::SETTINGS[0];
        for (key, value) in [
            (&["start"][..], None),
            (&["start", "claude"], None),
            (&["start", "claude", "mode"], Some("\"full_access\"")),
            (&["start", "claude"], Some("{ mode = \"full_access\" }")),
            (&["start", "account"], Some("\"work\"")),
            (&["start", "fallback"], None),
        ] {
            assert!(file.person_alone(key, value).is_some(), "{key:?}");
        }
        for (key, value) in [
            (&["start", "claude", "model"][..], Some("\"opus\"")),
            (&["start", "claude"], Some("{ model = \"opus\" }")),
            (&["enter"], Some("\"queue\"")),
            (&["models", "claude"], None),
        ] {
            assert_eq!(file.person_alone(key, value), None, "{key:?}");
        }
    }
}
