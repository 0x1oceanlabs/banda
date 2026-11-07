//! The pulls module's tables: the links, the call that made each, what
//! GitHub last said, and which Agent is which Thread's.

use crate::model::{By, Linked, PullRef, Snapshot, State};
use banda_kernel::{Error, Participant, Tx};
use rusqlite::{Connection, OptionalExtension, params};

/// The module's migrations, append-only.
pub const MIGRATIONS: &[&str] = &[
    // One row a Thread and a pull request. One let go of keeps its row,
    // with when, so it is not linked again by what made it.
    "CREATE TABLE pulls_links (
         thread TEXT NOT NULL,
         host TEXT NOT NULL,
         repo TEXT NOT NULL,
         number INTEGER NOT NULL,
         url TEXT NOT NULL,
         by TEXT NOT NULL,
         linked_at INTEGER NOT NULL,
         unlinked_at INTEGER,
         auto_fix INTEGER NOT NULL,
         PRIMARY KEY (thread, host, repo, number)
     );
     CREATE INDEX pulls_links_pull ON pulls_links (host, repo, number);
     -- The calls that linked a pull request: an Agent's tool call, by its
     -- item. One heard again links nothing.
     CREATE TABLE pulls_made (key TEXT PRIMARY KEY);
     -- What GitHub last said of each pull request; `final` once it was
     -- read merged or closed twice, and is read no more.
     CREATE TABLE pulls_read (
         host TEXT NOT NULL,
         repo TEXT NOT NULL,
         number INTEGER NOT NULL,
         snapshot TEXT NOT NULL,
         final INTEGER NOT NULL,
         PRIMARY KEY (host, repo, number)
     );
     -- Each Agent's Thread, as its facts say: an Agent's tool names no
     -- Thread.
     CREATE TABLE pulls_agents (agent TEXT PRIMARY KEY, thread TEXT NOT NULL);",
];

/// The version of every event this module writes.
pub const VERSION: u32 = 1;

/// One link as it is kept.
#[derive(Clone, Debug)]
pub struct Row {
    pub thread: String,
    pub pull: PullRef,
    pub url: String,
    pub by: By,
    pub auto_fix: bool,
}

/// Links `pull` to `thread`, unless it is linked, or `made` already
/// linked it once. Says whether it linked it, with `pull.linked`.
pub fn link(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: &str,
    pull: &PullRef,
    by: By,
    made: Option<&str>,
) -> Result<bool, Error> {
    if let Some(key) = made {
        let fresh = tx
            .sql()
            .execute("INSERT OR IGNORE INTO pulls_made (key) VALUES (?1)", [key])?;
        if fresh == 0 {
            return Ok(false);
        }
    }
    let live: Option<Option<i64>> = tx
        .sql()
        .query_row(
            "SELECT unlinked_at FROM pulls_links
             WHERE thread = ?1 AND host = ?2 AND repo = ?3 AND number = ?4",
            params![thread, pull.host, pull.repo, pull.number],
            |row| row.get(0),
        )
        .optional()?;
    if matches!(live, Some(None)) {
        return Ok(false);
    }
    let now = tx.now();
    tx.sql().execute(
        "INSERT INTO pulls_links (thread, host, repo, number, url, by, linked_at, unlinked_at, auto_fix)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)
         ON CONFLICT (thread, host, repo, number) DO UPDATE SET
           url = ?5, by = ?6, linked_at = ?7, unlinked_at = NULL, auto_fix = ?8",
        params![
            thread,
            pull.host,
            pull.repo,
            pull.number,
            pull.url(),
            by.word(),
            now,
            by.made()
        ],
    )?;
    let linked = Linked {
        thread: thread.to_owned(),
        pull: pull.clone(),
        url: pull.url(),
        by,
    };
    tx.emit("pull.linked", VERSION, Some(thread), author, &linked)?;
    Ok(true)
}

/// Lets go of `pull` in `thread`, with `pull.unlinked`. Says whether it
/// was linked.
pub fn unlink(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: &str,
    pull: &PullRef,
) -> Result<bool, Error> {
    let now = tx.now();
    let changed = tx.sql().execute(
        "UPDATE pulls_links SET unlinked_at = ?5
         WHERE thread = ?1 AND host = ?2 AND repo = ?3 AND number = ?4 AND unlinked_at IS NULL",
        params![thread, pull.host, pull.repo, pull.number, now],
    )?;
    if changed == 0 {
        return Ok(false);
    }
    let by: String = tx.sql().query_row(
        "SELECT by FROM pulls_links WHERE thread = ?1 AND host = ?2 AND repo = ?3 AND number = ?4",
        params![thread, pull.host, pull.repo, pull.number],
        |row| row.get(0),
    )?;
    let unlinked = Linked {
        thread: thread.to_owned(),
        pull: pull.clone(),
        url: pull.url(),
        by: By::from_word(&by),
    };
    tx.emit("pull.unlinked", VERSION, Some(thread), author, &unlinked)?;
    Ok(true)
}

/// Every live link, the first linked first.
pub fn links(sql: &Connection) -> Result<Vec<Row>, Error> {
    let mut statement = sql.prepare(
        "SELECT thread, host, repo, number, url, by, auto_fix FROM pulls_links
         WHERE unlinked_at IS NULL ORDER BY linked_at, rowid",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Row {
            thread: row.get(0)?,
            pull: PullRef {
                host: row.get(1)?,
                repo: row.get(2)?,
                number: row.get(3)?,
            },
            url: row.get(4)?,
            by: By::from_word(&row.get::<_, String>(5)?),
            auto_fix: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// What GitHub last said of `pull`, and whether it is read no more.
pub fn read(sql: &Connection, pull: &PullRef) -> Result<Option<(Snapshot, bool)>, Error> {
    let found: Option<(String, bool)> = sql
        .query_row(
            "SELECT snapshot, final FROM pulls_read WHERE host = ?1 AND repo = ?2 AND number = ?3",
            params![pull.host, pull.repo, pull.number],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(found.and_then(|(text, done)| Some((serde_json::from_str(&text).ok()?, done))))
}

/// Keeps what GitHub said of `pull`. Read merged or closed after it was
/// already, it is final: read no more.
pub fn keep(sql: &Connection, pull: &PullRef, snapshot: &Snapshot) -> Result<(), Error> {
    let was = read(sql, pull)?;
    let ended = |state| state != State::Open;
    let done = ended(snapshot.state) && was.is_some_and(|(was, _)| ended(was.state));
    sql.execute(
        "INSERT INTO pulls_read (host, repo, number, snapshot, final) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (host, repo, number) DO UPDATE SET snapshot = ?4, final = ?5",
        params![
            pull.host,
            pull.repo,
            pull.number,
            serde_json::to_string(snapshot)?,
            done
        ],
    )?;
    Ok(())
}

/// The Thread an Agent works in, as its facts said.
pub fn thread_of(sql: &Connection, agent: &str) -> Result<Option<String>, Error> {
    Ok(sql
        .query_row(
            "SELECT thread FROM pulls_agents WHERE agent = ?1",
            [agent],
            |row| row.get(0),
        )
        .optional()?)
}

/// Keeps that `agent` works in `thread`.
pub fn agent_in(sql: &Connection, agent: &str, thread: &str) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO pulls_agents (agent, thread) VALUES (?1, ?2)
         ON CONFLICT (agent) DO UPDATE SET thread = ?2",
        [agent, thread],
    )?;
    Ok(())
}
