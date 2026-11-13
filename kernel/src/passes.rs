//! A pass is how an Agent's session reaches the engine (ADR 0019, decision
//! 2; ADR 0083, decision 2). The agents module asks for one when it opens a
//! session, for its `banda mcp` and its shell, and one for each Harness
//! process, whose Agents' shells share it. Whoever says it in `hello` is
//! that Agent, and works only in that Project.
//!
//! A session's pass names its Thread too, which a module reads as
//! [`Call::thread`](crate::Call::thread); a Harness process's names none.
//! Either may name what runs it, an Agent's Harness entry, which a module
//! reads as [`Call::runs`](crate::Call::runs): a gateway account's key goes
//! only to its own (ADR 0078, decision 1). The module that asks for the
//! pass names both, as the engine opens the session: nothing an Agent
//! sends does.
//!
//! The kernel keeps passes in the host's own store, `passes.sqlite3` in
//! the engine's state, until the Host scope has a store of its own (ADR
//! 0082, decision 1). It keeps them hashed: the store holds a pass's
//! SHA-256, never the pass, so whoever reads the store holds no pass. Each
//! row names its Agent, Project and Thread, its audience and when it
//! expires.
//!
//! - A pass lasts while the session it was made for holds it ([`Pass`]),
//!   renewed a term ahead as long as it does. Dropping it revokes it: its
//!   session ended.
//! - A pass no session of this run of the engine holds, as one of the run
//!   before, lasts until it expires, at most a term after the run that
//!   held it last renewed it; a use does not renew it. So an engine
//!   restart keeps the passes of the sessions that go on, and lets go of
//!   the rest within the term.
//! - As the engine stops, every pass its sessions hold gets a whole term
//!   and none is revoked ([`Passes::stopping`]).
//! - A Project removed takes its passes with it.
//! - A pass is taken only by its audience: today every pass is the API's,
//!   `ws`.
//! - A store that does not open is put aside, and a new one started: the
//!   passes from before are gone, and the sessions that held them reach
//!   Banda no more.

use crate::{AgentId, Error, ProjectId, now_ms};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;
use uuid::Uuid;

/// How long a pass lasts once no session renews it: past a restart, and
/// past an engine that crashed.
pub const TERM: Duration = Duration::from_secs(3600);

/// The store's own steps.
const STEPS: &[&str] = &[
    r#"
CREATE TABLE passes (
    hash TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    project TEXT NOT NULL,
    audience TEXT NOT NULL CHECK (audience IN ('ws', 'gateway', 'door')),
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX passes_by_project ON passes (project);
"#,
    // The Thread whose session a pass was made for (ADR 0083, decision 2):
    // none for a Harness process's, nor for one made before.
    r#"
ALTER TABLE passes ADD COLUMN thread TEXT;
"#,
    // What runs the process or the session a pass is for, an Agent's
    // Harness entry (ADR 0078, decision 1): none for one made before.
    r#"
ALTER TABLE passes ADD COLUMN runs TEXT;
"#,
];

/// 32 bytes no one can guess, from the system's random source.
pub(crate) fn random() -> Result<[u8; 32], Error> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| Error::Io(std::io::Error::other(e)))?;
    Ok(bytes)
}

/// A secret no one can guess: 32 random bytes, in hex.
pub fn secret() -> Result<String, Error> {
    Ok(random()?.iter().map(|b| format!("{b:02x}")).collect())
}

/// Where a pass is taken (ADR 0083, decision 2). Anywhere else it is
/// refused. Today only the API takes passes; the store knows the
/// gateway's MCP over HTTP and an isolated Project's door, which come
/// with the fence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Audience {
    Ws,
}

impl Audience {
    fn word(self) -> &'static str {
        match self {
            Audience::Ws => "ws",
        }
    }
}

/// Who holds a pass: its Agent, the Project it works in, the Thread whose
/// session it was made for, none for a Harness process's, and what runs
/// that process or session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Holder {
    pub(crate) agent: AgentId,
    pub(crate) project: ProjectId,
    pub(crate) thread: Option<Uuid>,
    pub(crate) runs: Option<String>,
}

/// A pass's row, as the store keeps it.
struct Row {
    agent: String,
    project: String,
    thread: Option<String>,
    runs: Option<String>,
    audience: String,
    expires_at: i64,
}

/// A pass as the session it was made for holds it. Its secret is what the
/// session says in `hello`; dropping it revokes it, unless the engine is
/// stopping, which keeps every pass for the next.
pub struct Pass {
    secret: String,
    hash: String,
    passes: Weak<Passes>,
}

impl Pass {
    /// What the session says in `hello`, in `BANDA_TOKEN`.
    pub fn secret(&self) -> &str {
        &self.secret
    }
}

impl std::fmt::Debug for Pass {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Pass(…)")
    }
}

impl Drop for Pass {
    fn drop(&mut self) {
        if let Some(passes) = self.passes.upgrade() {
            passes.revoke(&self.hash);
        }
    }
}

/// The passes of this host.
pub(crate) struct Passes {
    sql: Mutex<Connection>,
    /// The hashes of the passes a session of this run holds.
    held: Mutex<HashSet<String>>,
    term: Duration,
    /// Set as the engine stops: what holds a pass goes then, and revokes
    /// nothing.
    stopping: AtomicBool,
}

impl Passes {
    /// Opens the store at `path`, made for this user alone on first use, and
    /// lets go of the passes that expired. One that does not open is put
    /// aside beside it, and a new one made.
    pub(crate) fn open(path: &Path, term: Duration) -> Result<Arc<Passes>, Error> {
        match Passes::opened(path, term) {
            Ok(passes) => Ok(passes),
            Err(error) => {
                let aside = path.with_extension("sqlite3.broken");
                tracing::error!(
                    %error,
                    aside = %aside.display(),
                    "the passes' store did not open: it is put aside, and the Agents' sessions \
                     from before reach Banda no more"
                );
                crate::host::rename(path, &aside)?;
                for kept in ["-wal", "-shm"] {
                    let mut file = path.as_os_str().to_owned();
                    file.push(kept);
                    let _ = std::fs::remove_file(file);
                }
                Passes::opened(path, term)
            }
        }
    }

    fn opened(path: &Path, term: Duration) -> Result<Arc<Passes>, Error> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        let mut options = std::fs::File::options();
        options.create(true).append(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        options.open(path)?;
        let mut sql = Connection::open(path)?;
        sql.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        crate::store::migrate(&mut sql, "passes", STEPS)?;
        sql.execute(
            "DELETE FROM passes WHERE expires_at <= ?1",
            params![now_ms()],
        )?;
        Ok(Arc::new(Passes {
            sql: Mutex::new(sql),
            held: Mutex::default(),
            term,
            stopping: AtomicBool::new(false),
        }))
    }

    fn sql(&self) -> MutexGuard<'_, Connection> {
        self.sql
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn held(&self) -> MutexGuard<'_, HashSet<String>> {
        self.held
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn until(&self) -> i64 {
        let term = i64::try_from(self.term.as_millis()).unwrap_or(i64::MAX);
        now_ms().saturating_add(term)
    }

    /// A new pass for `agent` in `project`, and in the session of
    /// `thread` when it is a Thread's, of a process or a session that
    /// `runs` names, taken by the API, which its session holds.
    pub(crate) fn issue(
        self: &Arc<Self>,
        agent: AgentId,
        project: ProjectId,
        thread: Option<Uuid>,
        runs: Option<&str>,
    ) -> Result<Pass, Error> {
        let secret = secret()?;
        let hash = hash(&secret);
        self.sql().execute(
            "INSERT INTO passes (hash, agent, project, thread, runs, audience, issued_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                hash,
                agent.to_string(),
                project.to_string(),
                thread.map(|thread| thread.to_string()),
                runs,
                Audience::Ws.word(),
                now_ms(),
                self.until()
            ],
        )?;
        self.held().insert(hash.clone());
        Ok(Pass {
            secret,
            hash,
            passes: Arc::downgrade(self),
        })
    }

    /// What `pass` names, when it is a pass for `audience` that a session
    /// holds, or that has not expired.
    pub(crate) fn named(&self, pass: &str, audience: Audience) -> Option<Holder> {
        let hash = hash(pass);
        let held = self.held().contains(&hash);
        let row = match self.row(&hash) {
            Ok(row) => row?,
            Err(error) => {
                tracing::error!(%error, "the passes could not be read");
                return None;
            }
        };
        if row.audience != audience.word() || (!held && row.expires_at <= now_ms()) {
            return None;
        }
        Some(Holder {
            agent: row.agent.parse().ok()?,
            project: row.project.parse().ok()?,
            // One that does not read names no Thread, and is still its
            // Agent's pass.
            thread: row.thread.and_then(|thread| thread.parse().ok()),
            runs: row.runs,
        })
    }

    /// The Agent `pass` names and the Project it works in, as
    /// [`Passes::named`] has them.
    pub(crate) fn holder(&self, pass: &str, audience: Audience) -> Option<(AgentId, ProjectId)> {
        self.named(pass, audience)
            .map(|holder| (holder.agent, holder.project))
    }

    /// The row of the pass with `hash`.
    fn row(&self, hash: &str) -> Result<Option<Row>, Error> {
        let row = self
            .sql()
            .query_row(
                "SELECT agent, project, thread, runs, audience, expires_at FROM passes WHERE hash = ?1",
                params![hash],
                |row| {
                    Ok(Row {
                        agent: row.get(0)?,
                        project: row.get(1)?,
                        thread: row.get(2)?,
                        runs: row.get(3)?,
                        audience: row.get(4)?,
                        expires_at: row.get(5)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Revokes the pass with `hash`: its session ended. Nothing while the
    /// engine stops.
    fn revoke(&self, hash: &str) {
        if self.stopping.load(Ordering::SeqCst) {
            return;
        }
        self.held().remove(hash);
        if let Err(error) = self
            .sql()
            .execute("DELETE FROM passes WHERE hash = ?1", params![hash])
        {
            tracing::error!(%error, "a pass could not be revoked");
        }
    }

    /// Revokes every pass of `project`, as it is removed.
    pub(crate) fn revoke_project(&self, project: ProjectId) {
        let gone = self.sql().execute(
            "DELETE FROM passes WHERE project = ?1",
            params![project.to_string()],
        );
        if let Err(error) = gone {
            tracing::error!(%error, "a removed Project's passes could not be revoked");
        }
    }

    /// Renews every pass a session holds, a whole term ahead.
    pub(crate) fn renew(&self) {
        let held: Vec<String> = self.held().iter().cloned().collect();
        let renewed = self.sql().execute(
            "UPDATE passes SET expires_at = MAX(expires_at, ?2)
             WHERE hash IN (SELECT value FROM json_each(?1))",
            params![
                serde_json::to_string(&held).unwrap_or_default(),
                self.until()
            ],
        );
        if let Err(error) = renewed {
            tracing::error!(%error, "the passes could not be renewed");
        }
    }

    /// The engine stops: the passes its sessions hold get a whole term, for
    /// the sessions that go on past the restart, and from now on none is
    /// revoked as what holds it goes.
    pub(crate) fn stopping(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.renew();
    }
}

/// Renews the passes sessions hold, four times a term, while the engine
/// keeps them: so an engine that crashes leaves each pass at least three
/// quarters of a term.
pub(crate) async fn renewing(passes: Weak<Passes>) {
    let Some(every) = passes.upgrade().map(|passes| passes.term / 4) else {
        return;
    };
    loop {
        tokio::time::sleep(every).await;
        let Some(passes) = passes.upgrade() else {
            return;
        };
        if passes.stopping.load(Ordering::SeqCst) {
            return;
        }
        passes.renew();
    }
}

/// What the store keeps of a pass.
fn hash(pass: &str) -> String {
    Sha256::digest(pass.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(dir: &tempfile::TempDir, term: Duration) -> Arc<Passes> {
        Passes::open(&dir.path().join("passes.sqlite3"), term).unwrap()
    }

    #[test]
    fn a_pass_names_its_agent_and_its_project_and_nothing_else_does() {
        let dir = tempfile::tempdir().unwrap();
        let passes = open(&dir, TERM);
        let (agent, project) = (AgentId::new(), ProjectId::new());
        let pass = passes.issue(agent, project, None, None).unwrap();
        assert_eq!(pass.secret().len(), 64);
        assert!(pass.secret().bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(
            passes.holder(pass.secret(), Audience::Ws),
            Some((agent, project))
        );
        let other = passes.issue(agent, project, None, None).unwrap();
        assert_ne!(other.secret(), pass.secret(), "a session gets its own");
        assert_eq!(passes.holder("", Audience::Ws), None);
        assert_eq!(passes.holder(&secret().unwrap(), Audience::Ws), None);
        // Only its audience takes it: one for the gateway, which comes with
        // the fence, is not the API's.
        let gateway = secret().unwrap();
        passes
            .sql()
            .execute(
                "INSERT INTO passes (hash, agent, project, audience, issued_at, expires_at)
                 VALUES (?1, ?2, ?3, 'gateway', 0, ?4)",
                params![
                    hash(&gateway),
                    agent.to_string(),
                    project.to_string(),
                    i64::MAX
                ],
            )
            .unwrap();
        assert_eq!(passes.holder(&gateway, Audience::Ws), None);
    }

    #[test]
    fn a_sessions_pass_names_its_thread_and_a_process_pass_none() {
        let dir = tempfile::tempdir().unwrap();
        let passes = open(&dir, TERM);
        let (agent, project, thread) = (AgentId::new(), ProjectId::new(), Uuid::now_v7());
        let session = passes.issue(agent, project, Some(thread), None).unwrap();
        let process = passes.issue(agent, project, None, None).unwrap();
        assert_eq!(
            passes.named(session.secret(), Audience::Ws),
            Some(Holder {
                agent,
                project,
                thread: Some(thread),
                runs: None,
            })
        );
        assert_eq!(
            passes.named(process.secret(), Audience::Ws),
            Some(Holder {
                agent,
                project,
                thread: None,
                runs: None,
            })
        );
        // A Thread that does not read names none, and the pass is still
        // its Agent's.
        passes
            .sql()
            .execute(
                "UPDATE passes SET thread = 'not a thread' WHERE thread IS NOT NULL",
                [],
            )
            .unwrap();
        assert_eq!(
            (passes.named(session.secret(), Audience::Ws)).map(|holder| holder.thread),
            Some(None)
        );
    }

    #[test]
    fn a_pass_names_what_runs_its_process_or_session() {
        let dir = tempfile::tempdir().unwrap();
        let passes = open(&dir, TERM);
        let (agent, project, thread) = (AgentId::new(), ProjectId::new(), Uuid::now_v7());
        let session = passes
            .issue(agent, project, Some(thread), Some("gw"))
            .unwrap();
        let process = passes.issue(agent, project, None, Some("claude")).unwrap();
        let runs = |pass: &Pass| (passes.named(pass.secret(), Audience::Ws)).map(|h| h.runs);
        assert_eq!(runs(&session), Some(Some("gw".to_owned())));
        assert_eq!(runs(&process), Some(Some("claude".to_owned())));
    }

    #[test]
    fn a_store_from_before_threads_takes_them_and_its_passes_name_none() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("passes.sqlite3");
        let pass = secret().unwrap();
        let (agent, project) = (AgentId::new(), ProjectId::new());
        {
            let mut sql = Connection::open(&file).unwrap();
            crate::store::migrate(&mut sql, "passes", &STEPS[..1]).unwrap();
            sql.execute(
                "INSERT INTO passes (hash, agent, project, audience, issued_at, expires_at)
                 VALUES (?1, ?2, ?3, 'ws', 0, ?4)",
                params![
                    hash(&pass),
                    agent.to_string(),
                    project.to_string(),
                    i64::MAX
                ],
            )
            .unwrap();
        }
        let passes = open(&dir, TERM);
        assert!(!dir.path().join("passes.sqlite3.broken").exists());
        assert_eq!(
            passes.named(&pass, Audience::Ws),
            Some(Holder {
                agent,
                project,
                thread: None,
                runs: None,
            })
        );
        let thread = Uuid::now_v7();
        let session = passes.issue(agent, project, Some(thread), None).unwrap();
        assert_eq!(
            (passes.named(session.secret(), Audience::Ws)).map(|holder| holder.thread),
            Some(Some(thread))
        );
    }

    #[test]
    fn the_store_keeps_a_hash_and_never_the_pass() {
        let dir = tempfile::tempdir().unwrap();
        let passes = open(&dir, TERM);
        let pass = passes
            .issue(AgentId::new(), ProjectId::new(), None, None)
            .unwrap();
        let secret = pass.secret().to_owned();
        passes.stopping();
        drop(pass);
        drop(passes);
        let mut kept = Vec::new();
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            kept.extend(std::fs::read(entry.unwrap().path()).unwrap());
        }
        let kept = String::from_utf8_lossy(&kept);
        assert!(!kept.contains(&secret));
        assert!(kept.contains(&hash(&secret)));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file = std::fs::metadata(dir.path().join("passes.sqlite3")).unwrap();
            assert_eq!(file.permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn a_pass_is_revoked_as_its_session_lets_go_of_it_but_not_as_the_engine_stops() {
        let dir = tempfile::tempdir().unwrap();
        let passes = open(&dir, TERM);
        let (agent, project) = (AgentId::new(), ProjectId::new());
        let ended = passes.issue(agent, project, None, None).unwrap();
        let secret = ended.secret().to_owned();
        drop(ended);
        assert_eq!(passes.holder(&secret, Audience::Ws), None);

        let going_on = passes.issue(agent, project, None, None).unwrap();
        let secret = going_on.secret().to_owned();
        passes.stopping();
        drop(going_on);
        drop(passes);
        let again = open(&dir, TERM);
        assert_eq!(again.holder(&secret, Audience::Ws), Some((agent, project)));
    }

    #[test]
    fn a_pass_no_session_holds_lasts_the_term_its_last_engine_gave_it_and_a_use_does_not_renew_it()
    {
        let dir = tempfile::tempdir().unwrap();
        let term = Duration::from_millis(600);
        let passes = open(&dir, term);
        let (agent, project) = (AgentId::new(), ProjectId::new());
        let pass = passes.issue(agent, project, None, None).unwrap();
        let secret = pass.secret().to_owned();
        passes.stopping();
        drop(pass);
        drop(passes);
        let again = open(&dir, term);
        std::thread::sleep(term / 2);
        assert!(again.holder(&secret, Audience::Ws).is_some());
        std::thread::sleep(term * 3 / 4);
        assert_eq!(again.holder(&secret, Audience::Ws), None);
        // And it goes from the store as the next engine opens it.
        drop(again);
        let count: i64 = open(&dir, term)
            .sql()
            .query_row("SELECT COUNT(*) FROM passes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn a_store_that_does_not_open_is_put_aside_and_a_new_one_made() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("passes.sqlite3");
        std::fs::write(
            &file,
            b"not a database, and longer than its header ".repeat(4),
        )
        .unwrap();
        let passes = open(&dir, TERM);
        let pass = passes
            .issue(AgentId::new(), ProjectId::new(), None, None)
            .unwrap();
        assert!(passes.holder(pass.secret(), Audience::Ws).is_some());
        assert!(dir.path().join("passes.sqlite3.broken").exists());
    }

    #[test]
    fn a_held_pass_does_not_expire_and_a_removed_projects_go() {
        let dir = tempfile::tempdir().unwrap();
        let term = Duration::from_millis(50);
        let passes = open(&dir, term);
        let (agent, work, home) = (AgentId::new(), ProjectId::new(), ProjectId::new());
        let at_work = passes.issue(agent, work, None, None).unwrap();
        let at_home = passes.issue(agent, home, None, None).unwrap();
        std::thread::sleep(term * 2);
        assert!(passes.holder(at_work.secret(), Audience::Ws).is_some());
        passes.revoke_project(work);
        assert_eq!(passes.holder(at_work.secret(), Audience::Ws), None);
        assert!(passes.holder(at_home.secret(), Audience::Ws).is_some());
    }
}
