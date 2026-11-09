//! How the engine's runs go, in `run.json` in its state (ADR 0086,
//! decision 1): the port it listens on, and how it left. A run says
//! `stopping` as soon as it is asked to stop, and `stopped` once it has.
//! An engine that finds neither word from the run before knows that run
//! crashed, or was killed: it keeps that as a Problem (ADR 0039) before it
//! opens anything. One killed after it was asked to stop, as systemd kills
//! an engine that takes too long, left as asked. A `handed over`, to a
//! new version, comes with the updates of plan step 6.
//!
//! launchd, unlike systemd, puts no limit on how often it starts a job
//! that crashes: macOS's engine keeps the times it started after a crash
//! in `crash-starts.json`, and stops trying at the third in a minute.

use crate::places::{Places, write_private};
use banda_problems::model::{Record, Source};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// How a run left, as it says itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Left {
    /// It was asked to stop, and was stopping: what ended it then ended
    /// it as asked.
    Stopping,
    /// It stopped as asked.
    Stopped,
}

/// The run before this one, as the engine finds it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Before {
    /// None ran here before, or none that wrote how it went.
    None,
    /// It left as asked, and said so.
    Left(Left),
    /// It never said it was asked to stop.
    Crashed,
}

/// What `run.json` holds.
#[derive(Debug, Serialize, Deserialize)]
struct Said {
    /// The port it listened on.
    port: u16,
    /// How it left; none while it runs, and for good if it crashed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    left: Option<Left>,
}

/// The run before, and the port it listened on, which this one takes
/// again when it is free, so the address its Agents' passes name stays.
/// An engine from before `run.json` that crashed left `engine.json` behind.
pub fn before(places: &Places) -> (Before, Option<u16>) {
    let read = std::fs::read(places.run())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Said>(&bytes).ok());
    match read {
        Some(Said {
            port,
            left: Some(left),
        }) => (Before::Left(left), Some(port)),
        Some(Said { port, left: None }) => (Before::Crashed, Some(port)),
        None if places.running().is_ok() => (Before::Crashed, None),
        None => (Before::None, None),
    }
}

/// How many starts after a crash within [`CRASH_WITHIN_MS`] stop the
/// engine's launchd job, as `StartLimitBurst` its unit on Linux.
pub const CRASH_STARTS: usize = 3;

/// The span [`CRASH_STARTS`] are counted in: a minute.
const CRASH_WITHIN_MS: i64 = 60_000;

/// The file in the state the engine's launchd job keeps its starts after
/// a crash in, as ms since the epoch.
const CRASH_STARTS_FILE: &str = "crash-starts.json";

/// Where the engine's launchd job keeps its starts after a crash: a
/// client that loads the job anew takes the file away, so the job has its
/// three again, as a new unit has on Linux.
pub fn crash_starts_file(places: &Places) -> PathBuf {
    places.state.join(CRASH_STARTS_FILE)
}

/// Counts this start, at `now`, as one after a crash: how many there were
/// within the last minute, this one with them.
pub fn crash_starts(places: &Places, now: i64) -> usize {
    let file = crash_starts_file(places);
    let mut starts: Vec<i64> = std::fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    starts.retain(|start| (0..CRASH_WITHIN_MS).contains(&(now - start)));
    starts.push(now);
    let written = serde_json::to_vec(&starts)
        .map_err(std::io::Error::from)
        .and_then(|bytes| write_private(&file, &bytes));
    if let Err(error) = written {
        tracing::error!(%error, "the engine could not keep when it started after a crash");
    }
    starts.len()
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

/// This run, as it says how it goes.
#[derive(Clone)]
pub struct Run {
    file: PathBuf,
    port: u16,
}

impl Run {
    /// Says that a run on `port` began, and has not left.
    pub fn began(places: &Places, port: u16) -> Run {
        let run = Run {
            file: places.run(),
            port,
        };
        run.say(None);
        run
    }

    /// Says how this run left.
    pub fn left(&self, left: Left) {
        self.say(Some(left));
    }

    fn say(&self, left: Option<Left>) {
        let said = Said {
            port: self.port,
            left,
        };
        let written = serde_json::to_vec_pretty(&said)
            .map_err(std::io::Error::from)
            .and_then(|bytes| write_private(&self.file, &bytes));
        if let Err(error) = written {
            tracing::error!(%error, ?left, "the engine could not say how its run goes");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::Running;

    #[test]
    fn a_run_that_said_it_was_asked_to_stop_left_and_one_that_did_not_crashed() {
        let dir = tempfile::tempdir().unwrap();
        let places = Places::under(dir.path());
        assert_eq!(before(&places), (Before::None, None));
        let run = Run::began(&places, 4100);
        assert_eq!(before(&places), (Before::Crashed, Some(4100)));
        run.left(Left::Stopping);
        assert_eq!(before(&places), (Before::Left(Left::Stopping), Some(4100)));
        run.left(Left::Stopped);
        assert_eq!(before(&places), (Before::Left(Left::Stopped), Some(4100)));
        Run::began(&places, 4101);
        assert_eq!(before(&places), (Before::Crashed, Some(4101)));
    }

    #[test]
    fn the_third_start_after_a_crash_within_a_minute_is_one_too_many() {
        let dir = tempfile::tempdir().unwrap();
        let places = Places::under(dir.path());
        let at = 1_794_000_000_000;
        assert_eq!(crash_starts(&places, at), 1);
        assert_eq!(crash_starts(&places, at + 10_000), 2);
        assert_eq!(crash_starts(&places, at + 20_000), CRASH_STARTS);
        // A minute on, the first are forgotten.
        assert_eq!(crash_starts(&places, at + 75_000), 2);
        assert_eq!(crash_starts(&places, at + 200_000), 1);
        // A file that does not read starts the count again.
        std::fs::write(crash_starts_file(&places), "{").unwrap();
        assert_eq!(crash_starts(&places, at + 201_000), 1);
    }

    #[test]
    fn an_engine_from_before_run_json_crashed_if_it_left_engine_json() {
        let dir = tempfile::tempdir().unwrap();
        let places = Places::under(dir.path());
        let running = Running {
            port: 4100,
            ..Running::default()
        };
        places.announce(&running).unwrap();
        assert_eq!(before(&places), (Before::Crashed, None));
    }

    #[test]
    fn a_crash_is_kept_where_the_engines_panics_are() {
        let dir = tempfile::tempdir().unwrap();
        let places = Places::under(dir.path());
        keep_crash(&places);
        let kept = std::fs::read_to_string(places.problems().join("panics.jsonl")).unwrap();
        let record: Record = serde_json::from_str(kept.trim()).unwrap();
        assert_eq!(record.kind, "crash");
        assert_eq!(record.source, Source::Engine);
    }
}
