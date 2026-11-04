//! Every event Banda sends, and every field of each (ADR 0039, decision
//! 6), declared once: the window's "See exactly what is sent" shows an
//! example of each as the engine makes it, and `docs/sharing.md` is
//! written from here by a test, which fails while a field goes without
//! its meaning. So neither can drift from what goes.

use crate::exception::{self, Banda};
use crate::usage::{self, Counts};
use banda_problems::model::{Frame, Problem, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// The ID an example goes with: the Person's is random, and made only as
/// sharing turns on.
const AN_ID: &str = "<a random ID>";

/// An example of each event, exactly as it goes.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "sharing/")]
pub struct Examples {
    #[ts(type = "unknown")]
    pub exception: Value,
    #[ts(type = "unknown")]
    pub day: Value,
}

/// The two events as `banda` would send them, `locale` in `day`.
pub fn examples(banda: &Banda, locale: Option<&str>) -> Examples {
    let problem = Problem {
        fingerprint: "3124d1bf35ad".to_owned(),
        source: Source::Page,
        kind: "TypeError".to_owned(),
        message: "Cannot read properties of undefined (reading 'tabs')".to_owned(),
        frames: vec![Frame {
            file: "app/web/src/browser/Tabs.tsx".to_owned(),
            function: "Tabs".to_owned(),
            line: Some(41),
        }],
        version: banda.version.clone(),
        first: 0,
        last: 0,
        times: 1,
    };
    let counts = Counts {
        threads: [("claude".to_owned(), 4), ("codex".to_owned(), 1)].into(),
        turns: 31,
        panes: [
            ("agents.thread".to_owned(), 6),
            ("terminal.terminal".to_owned(), 3),
        ]
        .into(),
        projects: 2,
        workspaces: 3,
    };
    // 2026-11-03.
    let day = 20_760;
    Examples {
        exception: exception::exception(&problem, AN_ID, banda),
        day: usage::day(day, &counts, locale, AN_ID, banda),
    }
}

/// What every event carries, beside its own properties.
const ALL: &[(&str, &str)] = &[
    (
        "api_key",
        "Banda's PostHog project's token. It is public: with it anyone can send, no one can read.",
    ),
    ("event", "The event's name."),
    (
        "distinct_id",
        "The random ID, made when sharing turns on and erased when it all turns off. It is not you.",
    ),
    (
        "properties.$process_person_profile",
        "Always `false`: PostHog keeps no profile of a person.",
    ),
    (
        "properties.$geoip_disable",
        "Always `true`: PostHog derives no place from the address.",
    ),
    ("properties.version", "Banda's version."),
    ("properties.channel", "`stable` or `dev`."),
    ("properties.os", "`linux`, `macos` or `windows`."),
];

/// An event: its name, when it goes, and its own fields, each with its
/// meaning.
struct Declared {
    name: &'static str,
    when: &'static str,
    own: &'static [(&'static str, &'static str)],
}

const EVENTS: &[Declared] = &[
    Declared {
        name: "$exception",
        when: "While **Send problem reports** is on: a Problem, once per fingerprint, version and day.",
        own: &[
            (
                "properties.$exception_fingerprint",
                "What tells this Problem from another, from its kind, message and frames.",
            ),
            (
                "properties.$exception_list",
                "What broke: its type, its message with paths and addresses taken out, and its frames, as Banda's own files and lines.",
            ),
            (
                "properties.source",
                "Which part of Banda broke: `page`, `main`, `engine` or `crash`.",
            ),
        ],
    },
    Declared {
        name: "day",
        when: "While **Send usage counts** is on: once a day, the UTC day before, if it was on all that day and something was counted.",
        own: &[
            (
                "timestamp",
                "That day's midnight, UTC: when it went says no time of day.",
            ),
            ("properties.day", "The day it counts."),
            (
                "properties.locale",
                "The system's language and the country in it, from your settings.",
            ),
            ("properties.country", "The country in the locale."),
            (
                "properties.threads",
                "The Threads started that day, by Harness.",
            ),
            ("properties.turns", "The Turns started that day."),
            ("properties.panes", "The Panes opened that day, by kind."),
            ("properties.projects", "How many Projects there are."),
            ("properties.workspaces", "How many workspaces hold a Pane."),
        ],
    },
];

/// `value` with each object's keys in order, as the doc shows it however
/// serde_json was built.
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let map = keys.into_iter().map(|key| (key.clone(), sorted(&map[key])));
            Value::Object(map.collect())
        }
        Value::Array(list) => Value::Array(list.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

/// `docs/sharing.md`: every event and field, from the declarations above
/// and the examples the engine makes.
pub fn doc() -> String {
    let banda = Banda {
        version: "0.2.0".to_owned(),
        channel: "stable",
        os: "linux",
    };
    let examples = examples(&banda, Some("de_DE"));
    let mut text = String::from(
        "<!-- Written by `cargo test -p banda-sharing` from modules/sharing/engine/src/events.rs: do not edit. -->\n\n\
         # What Banda sends\n\n\
         Banda sends nothing unless you turn it on, in the first run's question or in Settings → Sharing \
         (ADR 0039). Then it sends these two events to PostHog in the US, and nothing else. Each is kept on \
         your computer first, and Settings → Sharing → \"Sent by Banda\" shows its exact JSON. A Banda run \
         from a checkout, CI and the tests never send, nor a run with `BANDA_SHARING=0`.\n\n\
         What never goes: a Thread's title or words, prompts, answers, paths, addresses, a Project's name, git, \
         the time of day, your IP.\n\n\
         ## Every event\n\n| Field | What it is |\n|---|---|\n",
    );
    for (field, meaning) in ALL {
        text.push_str(&format!("| `{field}` | {meaning} |\n"));
    }
    for Declared { name, when, own } in EVENTS {
        let example = match *name {
            "$exception" => &examples.exception,
            _ => &examples.day,
        };
        text.push_str(&format!(
            "\n## `{name}`\n\n{when}\n\n| Field | What it is |\n|---|---|\n"
        ));
        for (field, meaning) in *own {
            text.push_str(&format!("| `{field}` | {meaning} |\n"));
        }
        let pretty = serde_json::to_string_pretty(&sorted(example)).unwrap_or_default();
        text.push_str(&format!("\nAn example:\n\n```json\n{pretty}\n```\n"));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::Path;

    /// Every field of `event`, as `parent.child` down to the properties' own.
    fn fields(event: &Value) -> Vec<String> {
        let mut all = Vec::new();
        for (key, value) in event.as_object().into_iter().flatten() {
            match value.as_object() {
                Some(inner) if key == "properties" => {
                    all.extend(inner.keys().map(|inner| format!("properties.{inner}")));
                }
                _ => all.push(key.clone()),
            }
        }
        all
    }

    #[test]
    fn every_field_of_every_event_is_declared() {
        let examples = examples(
            &Banda {
                version: "0.2.0".to_owned(),
                channel: "stable",
                os: "linux",
            },
            Some("de_DE"),
        );
        for Declared { name, own, .. } in EVENTS {
            let example = match *name {
                "$exception" => &examples.exception,
                _ => &examples.day,
            };
            assert_eq!(example["event"], *name);
            let sent: BTreeSet<String> = fields(example).into_iter().collect();
            let declared: BTreeSet<String> = (ALL.iter().chain(own.iter()))
                .map(|(field, _)| (*field).to_owned())
                .collect();
            assert_eq!(sent, declared, "{name}'s fields and their meanings differ");
        }
    }

    #[test]
    fn the_doc_lists_every_event() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/sharing.md");
        let text = doc();
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, &text).unwrap();
            panic!(
                "{} was stale: written; review it and run again",
                path.display()
            );
        }
    }
}
