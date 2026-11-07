//! How the engine's runs go, in `run.json` in its state (ADR 0086,
//! decision 1): since when the engine runs, the port it listens on, and,
//! once it left cleanly, how: `stopped`, or `handed over` to a new version
//! (step 6). An engine that finds no such word from the run before knows
//! that run crashed, or was killed: it keeps that as a Problem (ADR 0039)
//! before it opens anything.

use crate::places::{Places, write_private};
use banda_problems::model::{Record, Source};
use serde::{Deserialize, Serialize};

/// How a run left, as it says itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Left {
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "handed over")]
    HandedOver,
}

/// The run before this one, as the engine finds it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Before {
    /// None ran here before, or none that wrote how it went.
    None,
    /// It left, and said how.
    Left(Left),
    /// It never said it left.
    Crashed,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Run {
    /// When it began to serve, in ms since the epoch.
    #[serde(default)]
    since: i64,
    /// The port it listened on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    /// How it left; none while it runs, and for good if it crashed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    left: Option<Left>,
    /// When it left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    at: Option<i64>,
}

/// The run before, and the port it listened on, which this one takes
/// again when it is free, so the address its Agents' passes name stays.
/// An engine from before `run.json` that crashed left `engine.json` behind.
pub fn before(places: &Places) -> (Before, Option<u16>) {
    let read = std::fs::read(places.run())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Run>(&bytes).ok());
    match read {
        Some(run) => match run.left {
            Some(left) => (Before::Left(left), run.port),
            None => (Before::Crashed, run.port),
        },
        None if places.running().is_ok() => (Before::Crashed, None),
        None => (Before::None, None),
    }
}

/// Keeps a run that crashed as a Problem, where the problems module takes
/// the engine's panics in as it opens (ADR 0039, decision 1).
pub fn keep_crash(places: &Places) {
    let record = Record {
        source: Source::Engine,
        kind: "crash".to_owned(),
        message: "Banda's engine ended without stopping: it crashed, or something killed it."
            .to_owned(),
        frames: Vec::new(),
    };
    if let Err(error) = banda_problems::keep_crash(&places.problems(), &record) {
        tracing::error!(%error, "a crash of the engine was not kept as a Problem");
    }
}

/// Says that a run began at `since`, on `port`, and has not left.
pub fn began(places: &Places, since: i64, port: u16) -> std::io::Result<()> {
    write(
        places,
        &Run {
            since,
            port: Some(port),
            ..Run::default()
        },
    )
}

/// Says that the run that began at `since`, on `port`, left as `left`.
pub fn left(places: &Places, since: i64, port: u16, left: Left) -> std::io::Result<()> {
    write(
        places,
        &Run {
            since,
            port: Some(port),
            left: Some(left),
            at: Some(banda_kernel::now_ms()),
        },
    )
}

fn write(places: &Places, run: &Run) -> std::io::Result<()> {
    write_private(&places.run(), &serde_json::to_vec_pretty(run)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::Running;

    fn places(dir: &tempfile::TempDir) -> Places {
        let at = |name: &str| dir.path().join(name);
        Places {
            root: at("root"),
            data: at("data"),
            state: at("state"),
            config: at("config"),
            cache: at("cache"),
        }
    }

    #[test]
    fn a_run_that_said_how_it_left_left_and_one_that_did_not_crashed() {
        let dir = tempfile::tempdir().unwrap();
        let places = places(&dir);
        assert_eq!(before(&places), (Before::None, None));
        began(&places, 1, 4100).unwrap();
        assert_eq!(before(&places), (Before::Crashed, Some(4100)));
        left(&places, 1, 4100, Left::Stopped).unwrap();
        assert_eq!(before(&places), (Before::Left(Left::Stopped), Some(4100)));
        left(&places, 2, 4101, Left::HandedOver).unwrap();
        assert_eq!(
            before(&places),
            (Before::Left(Left::HandedOver), Some(4101))
        );
    }

    #[test]
    fn an_engine_from_before_run_json_crashed_if_it_left_engine_json() {
        let dir = tempfile::tempdir().unwrap();
        let places = places(&dir);
        let running = Running {
            protocol: 1,
            port: 4100,
            secret: "s".into(),
            build: None,
            version: None,
            since: None,
            pid: None,
            unit: None,
        };
        places.announce(&running).unwrap();
        assert_eq!(before(&places), (Before::Crashed, None));
    }

    #[test]
    fn a_crash_is_kept_where_the_engines_panics_are() {
        let dir = tempfile::tempdir().unwrap();
        let places = places(&dir);
        keep_crash(&places);
        let kept = std::fs::read_to_string(places.problems().join("panics.jsonl")).unwrap();
        let record: Record = serde_json::from_str(kept.trim()).unwrap();
        assert_eq!(record.kind, "crash");
        assert_eq!(record.source, Source::Engine);
    }
}
