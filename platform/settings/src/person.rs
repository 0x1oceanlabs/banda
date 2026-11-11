//! What only the Person changes in Banda's settings (ADR 0083): what a
//! Harness runs, and with what; how freely a new Thread's Agent acts; what
//! Agents may do in the browser; what Banda sends; and what this machine is
//! called and drawn by, which every window shows, and whether Banda starts
//! at login on it. An Agent that
//! changes settings does so through the engine, which refuses these, until
//! Banda asks the Person to agree (B15); and every line of `keys.toml`,
//! which binds a key as `banda keys bind` checks it.

use banda_agents::chosen_modes;
use banda_agents::model::Mode;
use std::path::Path;
use toml_edit::Key;

/// The keys of a `[[harness]]` entry that change what runs, or where the
/// engine writes for it: which entry it is, its program and arguments, its
/// environment, its CLI, the Harness it is an account of, the adapter
/// Banda carries for it, and its recording's folder.
const RUNS: [&str; 9] = [
    "id", "command", "args", "env", "cli", "of", "carried", "record", "retired",
];

/// The keys of a `[[harness]]` entry that say how an Account shows and
/// whether it is offered: they change through `harnesses`' commands, the
/// one door to an Account (ADR 0108, decision 1).
const ACCOUNT: [&str; 4] = ["name", "icon", "colour", "enabled"];

/// Why only the Person changes `key` (dotted, as `banda settings set` takes
/// it) in the file called `name`, to `value` when it is set; `None` when
/// an Agent may change it. A key that does not read as one is refused too.
pub fn only_the_person(name: &str, key: &str, value: Option<&str>) -> Option<&'static str> {
    // As the writer reads it: quoted or not, spaced or not.
    let Ok(parts) = Key::parse(key) else {
        return Some(NO_KEY);
    };
    let parts: Vec<&str> = parts.iter().map(Key::get).collect();
    only_the_person_at(name, &parts, value)
}

/// Why only the Person names `key` `to` in the file called `name`: what
/// either names. The key keeps its table, and takes `to` as its own name.
pub fn only_the_person_renames(name: &str, key: &str, to: &str) -> Option<&'static str> {
    let Ok(mut parts) = Key::parse(key) else {
        return Some(NO_KEY);
    };
    let from: Vec<&str> = parts.iter().map(Key::get).collect();
    let why = only_the_person_at(name, &from, None);
    parts.pop();
    let mut renamed: Vec<&str> = parts.iter().map(Key::get).collect();
    renamed.push(to);
    why.or_else(|| only_the_person_at(name, &renamed, None))
}

fn only_the_person_at(name: &str, parts: &[&str], value: Option<&str>) -> Option<&'static str> {
    // A whole table set at once names each of its keys.
    let names = |wanted: &[&str]| {
        value
            .and_then(|value| value.parse::<toml_edit::Value>().ok())
            .is_some_and(|value| {
                value
                    .as_inline_table()
                    .is_some_and(|table| table.iter().any(|(key, _)| wanted.contains(&key)))
            })
    };
    match (name, parts) {
        ("keys.toml", _) => Some(
            "A key is bound with banda keys bind, which says which keys only your Person binds.",
        ),
        ("harnesses.toml", ["harness"]) => Some(RUNS_WORDS),
        ("harnesses.toml", ["harness", _]) if value.is_none() || names(&RUNS) => Some(RUNS_WORDS),
        ("harnesses.toml", ["harness", _, leaf, ..]) if RUNS.contains(leaf) => Some(RUNS_WORDS),
        ("harnesses.toml", ["harness", _]) if names(&ACCOUNT) => Some(ACCOUNT_WORDS),
        ("harnesses.toml", ["harness", _, leaf, ..]) if ACCOUNT.contains(leaf) => {
            Some(ACCOUNT_WORDS)
        }
        ("agents.toml", ["start"]) => Some(MODE_WORDS),
        ("agents.toml", ["start", "account" | "fallback"]) => Some(ACCOUNT_WORDS),
        ("agents.toml", ["start", _]) if value.is_none() || names(&["mode"]) => Some(MODE_WORDS),
        ("agents.toml", ["start", _, "mode"]) => Some(MODE_WORDS),
        ("browser.toml", ["agents", ..]) => Some(BROWSER_WORDS),
        ("sharing.toml", _) => Some(SHARING_WORDS),
        ("machine.toml", _) => Some(MACHINE_WORDS),
        _ => None,
    }
}

/// Keeps what the Person chose as a Harness's new Threads' mode, in
/// `record` ([`chosen_modes`]), as they change `key` of the file called
/// `name` to `value`, or take it out (none), through the engine, as the
/// settings Pane does (ADR 0083, F0-3). `start.<id>.mode` set is that mode
/// chosen; taken out, or its table taken out, the choice is taken back, and
/// the whole `[start]` changed takes back every one. Only the Person's own
/// changes come here: an Agent's are no choice.
pub fn chose(record: &Path, name: &str, key: &str, value: Option<&str>) -> std::io::Result<()> {
    let Ok(parts) = Key::parse(key) else {
        return Ok(());
    };
    let parts: Vec<&str> = parts.iter().map(Key::get).collect();
    let value = value.map(|value| {
        (value.parse::<toml_edit::Value>()).unwrap_or_else(|_| toml_edit::Value::from(value))
    });
    // As `set` takes the text: a TOML value, or else the text as a string.
    let mode_of = |value: Option<&toml_edit::Value>| {
        let text = value.and_then(toml_edit::Value::as_str)?;
        serde_json::from_value::<Mode>(serde_json::Value::from(text)).ok()
    };
    match (name, parts.as_slice(), &value) {
        ("agents.toml", ["start"], _) => chosen_modes::forget(record),
        // The accounts a new Thread starts on are no Harness's mode.
        ("agents.toml", ["start", "account" | "fallback"], _) => Ok(()),
        ("agents.toml", ["start", harness], None) => chosen_modes::choose(record, harness, None),
        ("agents.toml", ["start", harness], Some(table)) => {
            let set = (table.as_inline_table()).and_then(|table| table.get("mode"));
            match set {
                Some(mode) => chosen_modes::choose(record, harness, mode_of(Some(mode))),
                None => Ok(()),
            }
        }
        ("agents.toml", ["start", harness, "mode"], value) => {
            chosen_modes::choose(record, harness, mode_of(value.as_ref()))
        }
        _ => Ok(()),
    }
}

/// Takes back what the Person chose as a Harness's new Threads' mode, in
/// `record`, as they rename `key` of the file called `name` to `to`: a mode
/// that comes, or goes, by another name is no choice of theirs in Settings.
pub fn chose_renamed(record: &Path, name: &str, key: &str, to: &str) -> std::io::Result<()> {
    let Ok(mut parts) = Key::parse(key) else {
        return Ok(());
    };
    let from: Vec<String> = parts.iter().map(|part| part.get().to_owned()).collect();
    parts.pop();
    let mut renamed: Vec<String> = parts.iter().map(|part| part.get().to_owned()).collect();
    renamed.push(to.to_owned());
    for parts in [from, renamed] {
        let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
        // Taken out under either name.
        chose(record, name, &dotted(&parts), None)?;
    }
    Ok(())
}

/// `parts` as one key, each quoted where it needs it.
fn dotted(parts: &[&str]) -> String {
    let keys: Vec<String> = parts
        .iter()
        .map(|part| Key::new(*part).to_string())
        .collect();
    keys.join(".")
}

const NO_KEY: &str = "That is not a key as Banda's settings write them, as tile.border.";

const RUNS_WORDS: &str = "Only your Person changes which program a Harness runs, with what, and \
                          where Banda writes for it. Give them the line, to set it themselves.";

const ACCOUNT_WORDS: &str = "An Account is changed with banda account, as anyone changes it: \
                             rename, enable, disable, default, fallback.";

const MODE_WORDS: &str = "Only your Person chooses how freely a new Thread's Agent acts. Give \
                          them the line, to set it themselves.";

const BROWSER_WORDS: &str = "Only your Person says what Agents may do in Banda's browser. Give \
                             them the line, to set it themselves.";

const SHARING_WORDS: &str = "Only your Person says what Banda sends. Give them the line, to set \
                             it themselves.";

const MACHINE_WORDS: &str = "Only your Person names this machine, which every window shows, and \
                             says whether Banda starts at login on it and when it stays awake. \
                             Give them the line, to set it themselves.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_person_changes_what_a_harness_runs_and_a_new_thread_s_mode() {
        for (name, key, value) in [
            ("harnesses.toml", "harness.claude.command", Some("\"sh\"")),
            ("harnesses.toml", "harness.claude.args", Some("[\"-c\"]")),
            (
                "harnesses.toml",
                "harness.claude.env.PATH",
                Some("\"/tmp\""),
            ),
            ("harnesses.toml", "harness.claude.record", Some("\"/tmp\"")),
            ("harnesses.toml", "harness.claude.of", Some("\"codex\"")),
            ("harnesses.toml", "harness.claude.'command'", Some("\"sh\"")),
            (
                "harnesses.toml",
                "harness . \"claude\" . command",
                Some("\"sh\""),
            ),
            (
                "agents.toml",
                "start.'claude'.\"mode\"",
                Some("\"full_access\""),
            ),
            (
                "harnesses.toml",
                "harness.gemini",
                Some("{ name = \"G\", command = \"g\" }"),
            ),
            ("harnesses.toml", "harness.claude", None),
            ("harnesses.toml", "harness", None),
            ("agents.toml", "start.claude.mode", Some("\"full_access\"")),
            (
                "agents.toml",
                "start.claude",
                Some("{ mode = \"full_access\" }"),
            ),
            ("agents.toml", "start", None),
            ("keys.toml", "binds.\"Alt+M\"", Some("\"column.maximize\"")),
            ("harnesses.toml", "harness.claude.id", Some("\"codex\"")),
            (
                "browser.toml",
                "agents.sites.\"github.com\"",
                Some("\"allow\""),
            ),
            ("browser.toml", "agents.screenshots", Some("true")),
            ("browser.toml", "agents", Some("{ enabled = true }")),
            ("sharing.toml", "problems", Some("true")),
            ("machine.toml", "name", Some("\"m1pro\"")),
            ("machine.toml", "icon", None),
            ("machine.toml", "start-at-login", Some("false")),
            ("machine.toml", "awake-while-working", Some("false")),
            ("machine.toml", "awake-plugged-in", Some("true")),
            ("look.toml", "tile..border", Some("2")),
            ("harnesses.toml", "harness.claude.name", Some("\"Claude\"")),
            ("harnesses.toml", "harness.claude.enabled", Some("false")),
            ("harnesses.toml", "harness.gemini", Some("{ name = \"G\" }")),
            ("agents.toml", "start.account", Some("\"work\"")),
            ("agents.toml", "start.fallback", None),
        ] {
            assert!(only_the_person(name, key, value).is_some(), "{name} {key}");
        }
        for (name, key, value) in [
            (
                "harnesses.toml",
                "harness.gemini.url",
                Some("\"https://g\""),
            ),
            ("agents.toml", "start.claude.model", Some("\"opus\"")),
            ("agents.toml", "enter", Some("\"queue\"")),
            ("look.toml", "tile.border", Some("2")),
            ("browser.toml", "tabs", Some("\"rail\"")),
        ] {
            assert_eq!(only_the_person(name, key, value), None, "{name} {key}");
        }
    }

    /// What the Person sets as a Harness's new Threads' mode through the
    /// engine is kept as their choice, and taken back as it goes (ADR
    /// 0083, F0-3).
    #[test]
    fn the_person_s_new_thread_mode_is_kept_as_chosen_and_taken_back_as_it_goes() {
        let folder = tempfile::tempdir().unwrap();
        let record = folder.path().join(chosen_modes::FILE);
        let chosen = |harness| chosen_modes::chosen(&record, harness);
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

        // A mode that comes or goes by another name.
        set("start.claude.mode", "\"full_access\"");
        set("start.codex.mode", "\"full_access\"");
        chose_renamed(&record, "agents.toml", "start.claude.mode", "later").unwrap();
        chose_renamed(&record, "agents.toml", "start.codex.effort", "mode").unwrap();
        assert_eq!((chosen("claude"), chosen("codex")), (None, None));
    }

    #[test]
    fn a_key_renamed_is_what_it_was_and_what_it_becomes() {
        // Where it is named otherwise, in its own table.
        for (name, key, to) in [
            ("agents.toml", "start.claude.effort", "mode"),
            ("harnesses.toml", "harness.claude.short", "command"),
            ("harnesses.toml", "harness.'claude'.short", "env"),
            ("agents.toml", "start.claude.mode", "model"),
            ("browser.toml", "agent", "agents"),
        ] {
            assert!(
                only_the_person_renames(name, key, to).is_some(),
                "{name} {key} {to}"
            );
        }
        assert_eq!(
            only_the_person_renames("agents.toml", "start.claude.effort", "model"),
            None
        );
        assert_eq!(
            only_the_person_renames("look.toml", "tile.border", "gap"),
            None
        );
    }
}
