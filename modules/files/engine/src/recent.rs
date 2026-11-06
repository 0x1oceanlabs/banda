//! What the Person opened lately (ADR 0073, decisions 1 and 11): each
//! file `files.file` showed, when last and how often, in `files_recent`.
//! Files lists them as Recent, and `files.find` raises them a little.

use crate::model::Opened;
use banda_kernel::Error;
use rusqlite::{Connection, params};
use std::collections::HashMap;
use std::path::Path;

/// The most files kept; the ones opened longest ago go first.
const KEPT: i64 = 500;

/// Its table.
pub const MIGRATION: &str = "CREATE TABLE files_recent (
   path TEXT PRIMARY KEY,
   last INTEGER NOT NULL,
   count INTEGER NOT NULL
 )";

/// Says `path` was opened at `now`.
pub fn open(sql: &Connection, path: &str, now: i64) -> Result<(), Error> {
    sql.execute(
        "INSERT INTO files_recent (path, last, count) VALUES (?1, ?2, 1)
         ON CONFLICT (path) DO UPDATE SET last = ?2, count = count + 1",
        params![path, now],
    )?;
    sql.execute(
        "DELETE FROM files_recent WHERE path NOT IN
           (SELECT path FROM files_recent ORDER BY last DESC LIMIT ?1)",
        [KEPT],
    )?;
    Ok(())
}

/// The files opened lately, the latest first: at most `limit`, or every
/// one kept.
pub fn latest(sql: &Connection, limit: Option<u32>) -> Result<Vec<Opened>, Error> {
    let limit = limit.map_or(KEPT, i64::from);
    let mut query =
        sql.prepare("SELECT path, last, count FROM files_recent ORDER BY last DESC LIMIT ?1")?;
    let rows = query.query_map([limit], |row| {
        Ok(Opened {
            path: row.get(0)?,
            last: row.get(1)?,
            count: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// How much `files.find` raises each file opened under `dir`, by its path
/// from `dir` with `/` between names, as the walk names it.
pub fn raised(opened: &[Opened], dir: &Path, now: i64) -> HashMap<String, u32> {
    (opened.iter())
        .filter_map(|file| {
            let path = Path::new(&file.path).strip_prefix(dir).ok()?;
            let raise = raise(file, now);
            let path = path
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            (raise > 0).then_some((path, raise))
        })
        .collect()
}

/// A little, by how often and how lately it was opened: as much as a
/// letter or two matched well, never as much as the whole query.
pub fn raise(file: &Opened, now: i64) -> u32 {
    const DAY: i64 = 24 * 60 * 60 * 1000;
    let lately = match now - file.last {
        age if age < DAY => 4,
        age if age < 7 * DAY => 2,
        age if age < 30 * DAY => 1,
        _ => 0,
    };
    lately * file.count.min(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 24 * 60 * 60 * 1000;

    fn opened(path: &str, last: i64, count: u32) -> Opened {
        Opened {
            path: path.to_owned(),
            last,
            count,
        }
    }

    #[test]
    fn a_file_is_raised_more_the_oftener_and_the_later_it_was_opened() {
        let now = 100 * DAY;
        let today = raise(&opened("/a", now - 1000, 1), now);
        assert!(today > raise(&opened("/a", now - 3 * DAY, 1), now));
        assert!(
            raise(&opened("/a", now - 3 * DAY, 5), now)
                > raise(&opened("/a", now - 3 * DAY, 1), now)
        );
        assert_eq!(raise(&opened("/a", now - 60 * DAY, 9), now), 0);
        assert_eq!(
            raise(&opened("/a", now, 100), now),
            raise(&opened("/a", now, 8), now)
        );
    }

    #[test]
    fn only_files_under_the_folder_are_raised_by_their_path_from_it() {
        let now = 10 * DAY;
        let files = [
            opened("/work/src/main.rs", now, 2),
            opened("/elsewhere/notes.md", now, 1),
            opened("/work/old.txt", now - 90 * DAY, 3),
        ];
        let raised = raised(&files, Path::new("/work"), now);
        assert_eq!(raised.len(), 1);
        assert_eq!(raised["src/main.rs"], 8);
    }

    #[test]
    fn the_table_keeps_the_last_time_and_counts_each_open() {
        let sql = Connection::open_in_memory().unwrap();
        sql.execute(MIGRATION, []).unwrap();
        open(&sql, "/a", 1).unwrap();
        open(&sql, "/b", 2).unwrap();
        open(&sql, "/a", 3).unwrap();
        let latest = latest(&sql, None).unwrap();
        assert_eq!(latest, [opened("/a", 3, 2), opened("/b", 2, 1)]);
    }
}
