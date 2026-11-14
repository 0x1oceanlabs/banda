//! What `banda-update run` keeps beside the engine's copies (ADR 0131,
//! decision 2): the copies that did not start, which nothing takes again,
//! and the state of its last look, which the engine reads. And the guard
//! of a move: once the engine moved onto a copy, that copy must answer on
//! its version within [`GRACE_MS`], or it is put back.

use crate::UpdateState;
use serde::Deserialize;
use std::path::Path;

/// How long a copy the engine moved onto has to answer on its version.
pub const GRACE_MS: i64 = 2 * 60 * 1000;

/// A move older than this is history: what runs now came some other way,
/// as a window's newer app.
const HISTORY_MS: i64 = 30 * 60 * 1000;

/// The file in `engine/` that lists the versions that did not start, one a
/// line.
const BAD: &str = "bad";

/// The file in `engine/` that keeps the last look's state.
const STATE: &str = "state.json";

/// The versions that did not start, as `engine/bad` lists them.
pub fn bad(engine: &Path) -> Vec<String> {
    std::fs::read_to_string(engine.join(BAD))
        .map(|said| {
            said.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// Lists `version` as one that did not start: whole or not at all.
pub fn mark_bad(engine: &Path, version: &str) -> std::io::Result<()> {
    let mut listed = bad(engine);
    if listed.iter().any(|one| one == version) {
        return Ok(());
    }
    listed.push(version.to_owned());
    let fresh = engine.join(format!(".{BAD}.new"));
    std::fs::write(&fresh, format!("{}\n", listed.join("\n")))?;
    std::fs::rename(&fresh, engine.join(BAD))
}

/// Keeps `state` as the last look's, whole or not at all.
pub fn keep_state(engine: &Path, state: &UpdateState) {
    let Ok(text) = serde_json::to_vec(state) else {
        return;
    };
    let fresh = engine.join(format!(".{STATE}.new"));
    let kept = std::fs::create_dir_all(engine)
        .and_then(|()| std::fs::write(&fresh, text))
        .and_then(|()| std::fs::rename(&fresh, engine.join(STATE)));
    if let Err(error) = kept {
        tracing::warn!(%error, "the updates' state is not kept");
    }
}

/// The last look's state, and when it was kept.
pub fn kept_state(engine: &Path) -> Option<(UpdateState, std::time::SystemTime)> {
    let path = engine.join(STATE);
    let when = std::fs::metadata(&path).ok()?.modified().ok()?;
    let state = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
    Some((state, when))
}

/// A move, as the engine keeps it in `engine/moved` before it moves.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Moved {
    pub to: String,
    pub from: String,
    pub at: i64,
    /// The copy moved onto ran for [`GRACE_MS`], and said so.
    #[serde(default)]
    pub arrived: bool,
}

/// The last move, as `engine/moved` says it.
pub fn moved(engine: &Path) -> Option<Moved> {
    serde_json::from_str(&std::fs::read_to_string(engine.join(crate::MOVED)).ok()?).ok()
}

/// The copy the engine that runs `version` moved onto and came back
/// from: the last move went from `version`, and its copy never said it
/// arrived. It crashed as it started, and the engine's unit, or job,
/// started the copy before again.
pub fn came_back(engine: &Path, version: &str) -> Option<String> {
    let moved = moved(engine)?;
    (moved.from == version && moved.to != version && !moved.arrived).then_some(moved.to)
}

/// Says in `engine/moved` that the copy that runs `version` arrived, when
/// the last move went onto it: whole or not at all.
pub fn keep_arrived(engine: &Path, version: &str) {
    let path = engine.join(crate::MOVED);
    let Some(mut said) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return;
    };
    if said["to"] != version || said["arrived"] == true {
        return;
    }
    said["arrived"] = true.into();
    let fresh = engine.join(format!(".{}.new", crate::MOVED));
    let kept =
        std::fs::write(&fresh, said.to_string()).and_then(|()| std::fs::rename(&fresh, &path));
    if let Err(error) = kept {
        tracing::warn!(%error, "that the engine arrived is not kept");
    }
}

/// Waits for any other look or take on `engine` to finish, and holds
/// `engine/.update.lock` until the file it answers is dropped: two never
/// take at once, `banda-update`'s service and one the engine asked. It
/// blocks while it waits.
pub fn lock(engine: &Path) -> Option<std::fs::File> {
    std::fs::create_dir_all(engine).ok()?;
    let file = std::fs::File::create(engine.join(".update.lock")).ok()?;
    file.lock().ok()?;
    Some(file)
}

/// What the guard does about a move.
#[derive(Debug, PartialEq, Eq)]
pub enum Guard {
    /// The copy answers on its version.
    Fine,
    /// It still has time.
    Wait,
    /// It did not answer in time: it is marked bad, and the copy it moved
    /// from starts again.
    PutBack,
}

/// What the guard does about `moved`, as the engine that answers says
/// `running`, at `now`. A move onto a copy already marked `bad` was put
/// back, by the guard or by the engine as it came back from it: put back
/// again, it would stop the copy before as it starts, again and again.
pub fn guard(moved: &Moved, running: Option<&str>, bad: &[String], now: i64) -> Guard {
    let past = running
        .is_some_and(|running| running == moved.to || crate::feed::is_above(running, &moved.to));
    if past || bad.contains(&moved.to) || now - moved.at >= HISTORY_MS {
        Guard::Fine
    } else if now - moved.at < GRACE_MS {
        Guard::Wait
    } else {
        Guard::PutBack
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copy_that_answers_in_time_is_fine_and_one_that_does_not_goes_back() {
        let moved = Moved {
            to: "0.1.0-dev.12".into(),
            from: "0.1.0-dev.11".into(),
            at: 1_000,
            arrived: false,
        };
        assert_eq!(
            guard(&moved, Some("0.1.0-dev.12"), &[], 1_000 + GRACE_MS * 2),
            Guard::Fine
        );
        assert_eq!(guard(&moved, None, &[], 1_000 + 5_000), Guard::Wait);
        assert_eq!(
            guard(&moved, Some("0.1.0-dev.11"), &[], 1_000 + 5_000),
            Guard::Wait
        );
        assert_eq!(guard(&moved, None, &[], 1_000 + GRACE_MS), Guard::PutBack);
        // Newer than the copy, or long ago: it came some other way.
        assert_eq!(
            guard(&moved, Some("0.1.0-dev.13"), &[], 1_000 + GRACE_MS),
            Guard::Fine
        );
        assert_eq!(
            guard(&moved, None, &[], 1_000 + 60 * 60 * 1000),
            Guard::Fine
        );
        assert_eq!(
            guard(&moved, Some("0.1.0-dev.11"), &[], 1_000 + GRACE_MS),
            Guard::PutBack
        );
        // Put back already: the copy before runs, or is starting, and
        // stays.
        let bad = ["0.1.0-dev.12".to_owned()];
        assert_eq!(guard(&moved, None, &bad, 1_000 + GRACE_MS), Guard::Fine);
        assert_eq!(
            guard(&moved, Some("0.1.0-dev.11"), &bad, 1_000 + GRACE_MS),
            Guard::Fine
        );
    }

    #[test]
    fn a_copy_the_engine_came_back_from_is_one_that_never_arrived() {
        let engine = tempfile::tempdir().unwrap();
        let (old, new) = ("0.1.0-dev.11", "0.1.0-dev.12");
        assert_eq!(came_back(engine.path(), old), None, "it never moved");
        std::fs::write(
            engine.path().join(crate::MOVED),
            format!(r#"{{"to":"{new}","from":"{old}","at":1000,"idle":true}}"#),
        )
        .unwrap();
        assert_eq!(came_back(engine.path(), old).as_deref(), Some(new));
        assert_eq!(came_back(engine.path(), new), None, "the copy itself");
        // The copy before says nothing for the one moved onto.
        keep_arrived(engine.path(), old);
        assert_eq!(came_back(engine.path(), old).as_deref(), Some(new));
        keep_arrived(engine.path(), new);
        assert_eq!(came_back(engine.path(), old), None, "it ran, and stopped");
        let kept = moved(engine.path()).unwrap();
        assert!(kept.arrived);
        assert_eq!(
            (kept.to.as_str(), kept.from.as_str(), kept.at),
            (new, old, 1000)
        );
    }

    #[test]
    fn a_bad_version_is_listed_once() {
        let engine = tempfile::tempdir().unwrap();
        assert!(bad(engine.path()).is_empty());
        mark_bad(engine.path(), "0.1.0-dev.12").unwrap();
        mark_bad(engine.path(), "0.1.0-dev.12").unwrap();
        mark_bad(engine.path(), "0.1.0-dev.13").unwrap();
        assert_eq!(bad(engine.path()), ["0.1.0-dev.12", "0.1.0-dev.13"]);
    }

    #[test]
    fn the_state_is_kept_whole() {
        let engine = tempfile::tempdir().unwrap();
        let state = UpdateState {
            running: "0.1.0-dev.11".into(),
            ready: Some("0.1.0-dev.12".into()),
            ..UpdateState::default()
        };
        keep_state(engine.path(), &state);
        assert_eq!(kept_state(engine.path()).unwrap().0, state);
    }
}
