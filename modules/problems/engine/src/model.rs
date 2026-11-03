//! A Problem and its fingerprint (ADR 0039, decision 1).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where in Banda it broke.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export_to = "problems/")]
pub enum Source {
    /// The window's page.
    Page,
    /// The window's main process.
    Main,
    /// The engine.
    Engine,
    /// A process that crashed, as Electron's crash dumps say.
    Crash,
}

/// One place on the way to it, nearest first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Frame {
    /// The file, as the code names it: `browser/BrowserPane.tsx`.
    pub file: String,
    /// The function there; empty when it has no name.
    #[serde(default)]
    pub function: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<u32>,
}

/// What broke, as the part of Banda it broke in says it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Record {
    pub source: Source,
    /// The error's type: `TypeError`, `panic`.
    pub kind: String,
    pub message: String,
    /// Banda's own frames only, nearest first, each file from the
    /// repository's root as its source names it (after the source maps, for
    /// the page's), so the fingerprint is the same on every machine.
    #[serde(default)]
    pub frames: Vec<Frame>,
}

/// A Problem kept: its fingerprint, and whether it is new here.
#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Recorded {
    pub fingerprint: String,
    pub new: bool,
}

/// One Problem: one fingerprint, however often it broke, with how it
/// broke the last time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Problem {
    pub fingerprint: String,
    pub source: Source,
    pub kind: String,
    pub message: String,
    pub frames: Vec<Frame>,
    /// The version of Banda it broke in last.
    pub version: String,
    /// When it broke first and last, in ms since the epoch.
    #[ts(type = "number")]
    pub first: i64,
    #[ts(type = "number")]
    pub last: i64,
    /// How many times it broke.
    pub times: u32,
}

impl Problem {
    /// `record` as a Problem that broke the first time `at`, in `version`.
    pub fn first(record: Record, fingerprint: String, version: &str, at: i64) -> Problem {
        Problem {
            fingerprint,
            source: record.source,
            kind: record.kind,
            message: record.message,
            frames: record.frames,
            version: version.to_owned(),
            first: at,
            last: at,
            times: 1,
        }
    }
}

/// One Problem, by its fingerprint or as much of it as names one.
#[derive(Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Fingerprint {
    pub fingerprint: String,
}

/// What an Agent or an issue needs to look into a Problem.
#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Report {
    pub problem: Problem,
    /// The system and its machine: `linux x86_64`.
    pub system: String,
    /// The last lines of each log there is.
    pub logs: Vec<Log>,
    /// All of it in Markdown, as `banda problems report` prints it and
    /// the Person copies it.
    pub text: String,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export_to = "problems/")]
pub struct Log {
    /// `engine.log`, `window.log`.
    pub name: String,
    pub lines: Vec<String>,
}

/// The most a Problem keeps of each part, so one fault cannot fill the
/// store.
const KIND: usize = 200;
const MESSAGE: usize = 2_000;
const FRAMES: usize = 30;

impl Record {
    /// The record cut to what a Problem keeps.
    pub fn cut(mut self) -> Record {
        cut(&mut self.kind, KIND);
        cut(&mut self.message, MESSAGE);
        self.frames.truncate(FRAMES);
        for frame in &mut self.frames {
            cut(&mut frame.file, KIND);
            cut(&mut frame.function, KIND);
        }
        self
    }

    /// The same fault gives the same fingerprint on every machine: its
    /// source, its kind and its top three frames' files and functions,
    /// with no lines, which move as the code does. With no frames, its
    /// message with every number taken out.
    pub fn fingerprint(&self) -> String {
        let mut text = format!("{}\n{}\n", word(self.source), self.kind);
        if self.frames.is_empty() {
            text.push_str(&numberless(&self.message));
        }
        for frame in self.frames.iter().take(3) {
            text.push_str(&format!("{}:{}\n", frame.file, frame.function));
        }
        format!("{:012x}", fnv1a(text.as_bytes()) >> 16)
    }
}

/// A value as the word serde gives it, as the store keeps `Source`.
pub fn word<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn cut(text: &mut String, most: usize) {
    if text.len() > most {
        text.truncate(text.floor_char_boundary(most));
    }
}

/// `text` with each run of digits as one `#`: an address, a count or an
/// ID does not make another Problem.
fn numberless(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if !c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('#') {
            out.push('#');
        }
    }
    out
}

/// FNV-1a: the same on every machine and every build, as Rust's own
/// hasher is not promised to be.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(message: &str, frames: &[(&str, &str, u32)]) -> Record {
        Record {
            source: Source::Page,
            kind: "TypeError".into(),
            message: message.into(),
            frames: frames
                .iter()
                .map(|&(file, function, line)| Frame {
                    file: file.into(),
                    function: function.into(),
                    line: Some(line),
                })
                .collect(),
        }
    }

    #[test]
    fn a_fault_is_one_fingerprint_wherever_its_lines_and_numbers_are() {
        let here = record("a", &[("a.ts", "f", 1), ("b.ts", "g", 2)]);
        let moved = record("b", &[("a.ts", "f", 9), ("b.ts", "g", 7)]);
        assert_eq!(here.fingerprint(), moved.fingerprint());
        assert_eq!(here.fingerprint().len(), 12);
        let elsewhere = record("a", &[("a.ts", "h", 1)]);
        assert_ne!(here.fingerprint(), elsewhere.fingerprint());
        // With no frames, the message is the fault, its numbers aside.
        assert_eq!(
            record("tab 3 of 12", &[]).fingerprint(),
            record("tab 40 of 7", &[]).fingerprint()
        );
        assert_ne!(
            record("tab 3", &[]).fingerprint(),
            record("pane 3", &[]).fingerprint()
        );
    }

    #[test]
    fn a_record_keeps_only_so_much() {
        let long = record(&"é".repeat(5_000), &[("a.ts", "f", 1); 50]).cut();
        assert!(long.message.len() <= MESSAGE);
        assert_eq!(long.frames.len(), FRAMES);
    }
}
