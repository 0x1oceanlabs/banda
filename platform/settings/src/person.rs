//! What only the Person changes in Banda's settings (ADR 0083): what a
//! Harness runs, and with what; what Banda sends; what this machine is
//! called and drawn by, which every window shows, and whether Banda starts
//! at login on it; and what a part's own file says of its keys
//! (`SettingsFile::only_the_person`), as how freely a new Thread's Agent
//! acts. An Agent that changes settings does so through the engine, which
//! refuses these, until Banda asks the Person to agree (B15); and every
//! line of `keys.toml`, which binds a key as `banda keys bind` checks it.

use crate::Settings;
use banda_harnesses::accounts::BY_ITS_COMMANDS as ACCOUNT_WORDS;
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

impl Settings {
    /// Why only the Person changes `key` (dotted, as `banda settings set` takes
    /// it) in the file called `name`, to `value` when it is set; `None` when
    /// an Agent may change it. A key that does not read as one is refused too.
    pub fn only_the_person(
        self,
        name: &str,
        key: &str,
        value: Option<&str>,
    ) -> Option<&'static str> {
        // As the writer reads it: quoted or not, spaced or not.
        let Ok(parts) = Key::parse(key) else {
            return Some(NO_KEY);
        };
        let parts: Vec<&str> = parts.iter().map(Key::get).collect();
        only_the_person_at(self, name, &parts, value)
    }

    /// Why only the Person names `key` `to` in the file called `name`: what
    /// either names. The key keeps its table, and takes `to` as its own name.
    pub fn only_the_person_renames(self, name: &str, key: &str, to: &str) -> Option<&'static str> {
        let Ok(mut parts) = Key::parse(key) else {
            return Some(NO_KEY);
        };
        let from: Vec<&str> = parts.iter().map(Key::get).collect();
        let why = only_the_person_at(self, name, &from, None);
        parts.pop();
        let mut renamed: Vec<&str> = parts.iter().map(Key::get).collect();
        renamed.push(to);
        why.or_else(|| only_the_person_at(self, name, &renamed, None))
    }
}

fn only_the_person_at(
    settings: Settings,
    name: &str,
    parts: &[&str],
    value: Option<&str>,
) -> Option<&'static str> {
    // A whole table set at once names each of its keys.
    let names = |wanted: &[&str]| banda_look::file::names(value, wanted);
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
        ("sharing.toml", _) => Some(SHARING_WORDS),
        ("machine.toml", _) => Some(MACHINE_WORDS),
        // What a part's own file says of its keys.
        _ => settings.file(name)?.person_alone(parts, value),
    }
}

/// Tells `chose`, which a part gave the engine to hear what the Person
/// changes in its file, that they renamed `key` of the file called `name`
/// to `to`: the key is taken out under either name, as what comes, or
/// goes, by another name is no value they set.
pub fn chose_renamed(
    chose: impl Fn(&str, &str, Option<&str>) -> std::io::Result<()>,
    name: &str,
    key: &str,
    to: &str,
) -> std::io::Result<()> {
    let Ok(mut parts) = Key::parse(key) else {
        return Ok(());
    };
    let from: Vec<String> = parts.iter().map(|part| part.get().to_owned()).collect();
    parts.pop();
    let mut renamed: Vec<String> = parts.iter().map(|part| part.get().to_owned()).collect();
    renamed.push(to.to_owned());
    for parts in [from, renamed] {
        let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
        chose(name, &dotted(&parts), None)?;
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

const SHARING_WORDS: &str = "Only your Person says what Banda sends. Give them the line, to set \
                             it themselves.";

const MACHINE_WORDS: &str = "Only your Person names this machine, which every window shows, and \
                             says whether Banda starts at login on it and when it stays awake. \
                             Give them the line, to set it themselves.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whole::WHOLE;

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
            assert!(
                WHOLE.only_the_person(name, key, value).is_some(),
                "{name} {key}"
            );
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
            assert_eq!(
                WHOLE.only_the_person(name, key, value),
                None,
                "{name} {key}"
            );
        }
    }

    /// A key renamed is told as taken out under either name, each as the
    /// writer writes it.
    #[test]
    fn a_key_renamed_is_told_as_taken_out_under_either_name() {
        let told = std::cell::RefCell::new(Vec::new());
        let chose = |name: &str, key: &str, value: Option<&str>| {
            (told.borrow_mut()).push((name.to_owned(), key.to_owned(), value.is_some()));
            Ok(())
        };
        chose_renamed(chose, "agents.toml", "start.'claude'.mode", "later").unwrap();
        let taken = |key: &str| ("agents.toml".to_owned(), key.to_owned(), false);
        assert_eq!(
            told.into_inner(),
            [taken("start.claude.mode"), taken("start.claude.later")]
        );
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
                WHOLE.only_the_person_renames(name, key, to).is_some(),
                "{name} {key} {to}"
            );
        }
        assert_eq!(
            WHOLE.only_the_person_renames("agents.toml", "start.claude.effort", "model"),
            None
        );
        assert_eq!(
            WHOLE.only_the_person_renames("look.toml", "tile.border", "gap"),
            None
        );
    }
}
