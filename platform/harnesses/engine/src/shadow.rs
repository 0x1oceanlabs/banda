//! Codex's accounts share their sessions (ADR 0078, decision 3).
//!
//! Each Codex account signs in in a home of its own, its `CODEX_HOME`.
//! Banda makes that home a shadow of the Harness's shared one: every entry
//! of the shared home is linked into it, but the account's own sign-in
//! and what Codex writes of it ([`own`]). So every account reads and
//! writes the same `sessions`, and any of them goes on with a Thread's
//! session, as T3 Code does.
//!
//! Codex's hidden reasoning is sealed for the account that wrote it. A
//! session that moves to another account forgets it ([`forget_reasoning`]),
//! else the new account's first request is refused with
//! `invalid_encrypted_content`.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

/// The variable that names Codex's home.
pub const VARIABLE: &str = crate::kinds::CODEX.home;

/// Whether a home can shadow another here: not where links need the
/// Person's leave, Windows, where each Codex account keeps its sessions and
/// a Thread moves to none (`Harness::sessions`).
pub const LINKS: bool = cfg!(unix);

/// What the shared home holds for every account, made there first when it
/// is not yet, so no account's Codex makes one of its own.
#[cfg(unix)]
const SHARED: [&str; 2] = ["sessions", "archived_sessions"];

/// Whether an entry of a Codex home is the account's own and never
/// shared: its sign-in and its lock, the models its sign-in may use, and
/// what Codex keeps of one process, as T3 Code keeps them.
#[cfg(unix)]
fn own(name: &str) -> bool {
    matches!(
        name,
        "auth.json" | "auth.lock" | "log" | "tmp" | "memories" | ".DS_Store"
    ) || name.starts_with("models_cache")
}

/// The Codex home `env` names: its `CODEX_HOME`, else the engine's own,
/// else `~/.codex`.
pub fn home(env: &BTreeMap<String, String>) -> Option<PathBuf> {
    crate::kinds::CODEX.home(env, dirs::home_dir().as_deref())
}

/// Whether two folders are one.
#[cfg(unix)]
fn same(a: &Path, b: &Path) -> bool {
    let real = |path: &Path| dunce::canonicalize(path).unwrap_or_else(|_| path.to_owned());
    real(a) == real(b)
}

/// Makes `home` a shadow of `shared`: each entry of `shared` linked into
/// it but the account's [`own`].
///
/// An entry `home` has of its own stays, the account's: its own
/// `config.toml`, say. Its own `sessions` and `archived_sessions` are moved
/// into the shared ones, file by file, so a Thread that ran on the account
/// before goes on; what could not move is set aside as
/// `<name>.before-banda`, and the link takes its place.
#[cfg(unix)]
pub fn make(home: &Path, shared: &Path) -> io::Result<()> {
    use std::os::unix::fs::symlink;
    if same(home, shared) {
        return Ok(());
    }
    std::fs::create_dir_all(home)?;
    for name in SHARED {
        std::fs::create_dir_all(shared.join(name))?;
    }
    for entry in std::fs::read_dir(shared)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_str().is_none_or(own) {
            continue;
        }
        let (there, here) = (entry.path(), home.join(&name));
        match std::fs::symlink_metadata(&here) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => symlink(&there, &here)?,
            Err(error) => return Err(error),
            Ok(found) if found.file_type().is_symlink() => {
                if std::fs::read_link(&here)? != there {
                    std::fs::remove_file(&here)?;
                    symlink(&there, &here)?;
                }
            }
            Ok(found) if found.is_dir() && SHARED.iter().any(|s| name == *s) => {
                merge(&here, &there)?;
                if std::fs::remove_dir(&here).is_err() {
                    std::fs::rename(&here, aside(&here))?;
                }
                symlink(&there, &here)?;
            }
            // The account's own.
            Ok(_) => {}
        }
    }
    Ok(())
}

/// Moves each file under `from` to the same place under `to`, where none
/// is yet, and removes each folder it empties.
#[cfg(unix)]
fn merge(from: &Path, to: &Path) -> io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let (here, there) = (entry.path(), to.join(entry.file_name()));
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&there)?;
            merge(&here, &there)?;
            let _ = std::fs::remove_dir(&here);
        } else if std::fs::symlink_metadata(&there).is_err() {
            std::fs::rename(&here, &there)?;
        }
    }
    Ok(())
}

/// A name beside `path` for what is set aside: `<name>.before-banda`, or
/// with a count after it when that is taken.
#[cfg(unix)]
fn aside(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    (1..)
        .map(|n| match n {
            1 => path.with_file_name(format!("{name}.before-banda")),
            n => path.with_file_name(format!("{name}.before-banda.{n}")),
        })
        .find(|path| std::fs::symlink_metadata(path).is_err())
        .expect("a free name")
}

/// Takes Codex's hidden reasoning out of `session`'s rollout in `home`,
/// as the session moves to another account, which cannot read what the
/// first sealed: the visible conversation, its tool calls and their
/// results stay. Whether there was any to take.
pub fn forget_reasoning(home: &Path, session: &str) -> io::Result<bool> {
    let Some(rollout) = rollout(&home.join("sessions"), session)? else {
        return Ok(false);
    };
    let text = std::fs::read_to_string(&rollout)?;
    if !text.lines().any(reasoning) {
        return Ok(false);
    }
    let written: String = (text.lines().filter(|line| !reasoning(line)))
        .flat_map(|line| [line, "\n"])
        .collect();
    let new = rollout.with_extension("jsonl.banda");
    std::fs::write(&new, written)?;
    banda_kernel::host::rename(&new, &rollout)?;
    Ok(true)
}

/// Whether a rollout's line is a reasoning item.
fn reasoning(line: &str) -> bool {
    if !line.contains("\"reasoning\"") {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    value["type"] == "response_item" && value["payload"]["type"] == "reasoning"
}

/// The rollout of `session` under `sessions`, named
/// `rollout-<time>-<session>.jsonl` in a folder of its day: the newest days
/// first, as a session that moves is mostly a recent one.
fn rollout(sessions: &Path, session: &str) -> io::Result<Option<PathBuf>> {
    let ending = format!("-{session}.jsonl");
    let mut entries = match std::fs::read_dir(sessions) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        entries => entries?.collect::<io::Result<Vec<_>>>()?,
    };
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    for entry in entries {
        if entry.file_type()?.is_dir() {
            if let Some(found) = rollout(&entry.path(), session)? {
                return Ok(Some(found));
            }
        } else if entry.file_name().to_string_lossy().ends_with(&ending) {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn an_accounts_home_links_the_shared_one_but_its_own_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let (shared, home) = (dir.path().join("codex"), dir.path().join("personal"));
        fs::create_dir_all(shared.join("sessions/2026/11/09")).unwrap();
        for file in [
            "auth.json",
            "config.toml",
            "state_5.sqlite",
            "models_cache.json",
        ] {
            fs::write(shared.join(file), "shared").unwrap();
        }
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("auth.json"), "personal").unwrap();
        fs::write(home.join("config.toml"), "personal's own").unwrap();

        make(&home, &shared).unwrap();

        assert_eq!(
            fs::read_to_string(home.join("auth.json")).unwrap(),
            "personal"
        );
        assert!(
            !home.join("models_cache.json").exists(),
            "the account's own"
        );
        assert_eq!(
            fs::read_to_string(home.join("config.toml")).unwrap(),
            "personal's own",
            "what the account has of its own stays"
        );
        assert_eq!(
            fs::read_link(home.join("sessions")).unwrap(),
            shared.join("sessions")
        );
        assert_eq!(
            fs::read_link(home.join("state_5.sqlite")).unwrap(),
            shared.join("state_5.sqlite")
        );
        assert!(
            shared.join("archived_sessions").is_dir(),
            "made shared first"
        );
        assert_eq!(
            fs::read_link(home.join("archived_sessions")).unwrap(),
            shared.join("archived_sessions")
        );
        make(&home, &shared).unwrap();
        assert_eq!(
            fs::read_link(home.join("sessions")).unwrap(),
            shared.join("sessions")
        );
    }

    #[test]
    fn an_accounts_own_sessions_move_into_the_shared_ones() {
        let dir = tempfile::tempdir().unwrap();
        let (shared, home) = (dir.path().join("codex"), dir.path().join("work"));
        let day = "sessions/2026/11/08";
        fs::create_dir_all(shared.join(day)).unwrap();
        fs::write(shared.join(day).join("rollout-a.jsonl"), "shared").unwrap();
        fs::create_dir_all(home.join(day)).unwrap();
        fs::write(home.join(day).join("rollout-a.jsonl"), "work's a").unwrap();
        fs::write(home.join(day).join("rollout-b.jsonl"), "work's b").unwrap();

        make(&home, &shared).unwrap();

        let read = |path: PathBuf| fs::read_to_string(path).unwrap();
        assert_eq!(read(shared.join(day).join("rollout-b.jsonl")), "work's b");
        assert_eq!(read(shared.join(day).join("rollout-a.jsonl")), "shared");
        assert_eq!(
            read(home.join("sessions.before-banda/2026/11/08/rollout-a.jsonl")),
            "work's a",
            "what could not move is set aside"
        );
        assert_eq!(
            fs::read_link(home.join("sessions")).unwrap(),
            shared.join("sessions")
        );
    }

    #[test]
    fn the_shared_home_itself_is_left_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("sessions")).unwrap();
        make(dir.path(), dir.path()).unwrap();
        assert!(
            !fs::symlink_metadata(dir.path().join("sessions"))
                .unwrap()
                .is_symlink()
        );
    }

    #[test]
    fn a_moved_session_forgets_its_reasoning_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("sessions/2026/11/09");
        fs::create_dir_all(&day).unwrap();
        let lines = [
            r#"{"ordinal":0,"type":"session_meta","payload":{"id":"s1"}}"#,
            r#"{"ordinal":1,"type":"response_item","payload":{"type":"reasoning","encrypted_content":"sealed"}}"#,
            r#"{"ordinal":2,"type":"response_item","payload":{"type":"message","role":"assistant"}}"#,
            r#"{"ordinal":3,"type":"event_msg","payload":{"type":"task_complete"}}"#,
        ];
        let file = day.join("rollout-2026-11-09T10-00-00-s1.jsonl");
        fs::write(&file, lines.join("\n") + "\n").unwrap();

        assert!(forget_reasoning(dir.path(), "s1").unwrap());
        let left = fs::read_to_string(&file).unwrap();
        assert_eq!(left, [lines[0], lines[2], lines[3]].join("\n") + "\n");
        assert!(!forget_reasoning(dir.path(), "s1").unwrap(), "none left");
        assert!(
            !forget_reasoning(dir.path(), "s2").unwrap(),
            "no such session"
        );
    }
}
