//! What only the Person changes in Banda's settings (ADR 0083): what a
//! Harness runs, and with what; how freely a new Thread's Agent acts; what
//! Agents may do in the browser; and what Banda sends. An Agent that
//! changes settings does so through the engine, which refuses these, until
//! Banda asks the Person to agree (B15); and every line of `keys.toml`,
//! which binds a key as `banda keys bind` checks it.

use toml_edit::Key;

/// The keys of a `[[harness]]` entry that change what runs, or where the
/// engine writes for it: which entry it is, its program and arguments, its
/// environment, its CLI, the Harness it is an account of, the adapter
/// Banda carries for it, and its recording's folder.
const RUNS: [&str; 8] = [
    "id", "command", "args", "env", "cli", "of", "carried", "record",
];

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
        ("agents.toml", ["start"]) => Some(MODE_WORDS),
        ("agents.toml", ["start", _]) if value.is_none() || names(&["mode"]) => Some(MODE_WORDS),
        ("agents.toml", ["start", _, "mode"]) => Some(MODE_WORDS),
        ("browser.toml", ["agents", ..]) => Some(BROWSER_WORDS),
        ("sharing.toml", _) => Some(SHARING_WORDS),
        _ => None,
    }
}

const NO_KEY: &str = "That is not a key as Banda's settings write them, as tile.border.";

const RUNS_WORDS: &str = "Only your Person changes which program a Harness runs, with what, and \
                          where Banda writes for it. Give them the line, to set it themselves.";

const MODE_WORDS: &str = "Only your Person chooses how freely a new Thread's Agent acts. Give \
                          them the line, to set it themselves.";

const BROWSER_WORDS: &str = "Only your Person says what Agents may do in Banda's browser. Give \
                             them the line, to set it themselves.";

const SHARING_WORDS: &str = "Only your Person says what Banda sends. Give them the line, to set \
                             it themselves.";

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
            ("look.toml", "tile..border", Some("2")),
        ] {
            assert!(only_the_person(name, key, value).is_some(), "{name} {key}");
        }
        for (name, key, value) in [
            ("harnesses.toml", "harness.claude.name", Some("\"Claude\"")),
            ("harnesses.toml", "harness.claude.enabled", Some("false")),
            ("harnesses.toml", "harness.gemini", Some("{ name = \"G\" }")),
            ("agents.toml", "start.claude.model", Some("\"opus\"")),
            ("agents.toml", "enter", Some("\"queue\"")),
            ("look.toml", "tile.border", Some("2")),
            ("browser.toml", "tabs", Some("\"rail\"")),
        ] {
            assert_eq!(only_the_person(name, key, value), None, "{name} {key}");
        }
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
