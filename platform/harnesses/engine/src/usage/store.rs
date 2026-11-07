use super::files::{Batch, Cursor};
use super::journal::Record;
use super::model::{UsageRead, UsageRow, UsageTotal};
use super::{DAY, Source, prices};
use banda_kernel::{Error, ModuleProject, Participant};
use rusqlite::{Connection, OptionalExtension};
use std::collections::{BTreeMap, HashSet};

/// Codex's journals read again: its prompts were not counted before.
pub(crate) const REREAD_CODEX: &str = "
DELETE FROM harnesses_usage_records WHERE source LIKE 'codex:%';
DELETE FROM harnesses_usage_files WHERE source LIKE 'codex:%';
";

pub(crate) const TABLES: &str = "
CREATE TABLE harnesses_usage_files (
 source TEXT NOT NULL, path TEXT NOT NULL, cursor TEXT NOT NULL,
 PRIMARY KEY (source,path)
);
CREATE TABLE harnesses_usage_records (
 source TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL,
 time INTEGER NOT NULL, weight INTEGER NOT NULL, record TEXT NOT NULL,
 PRIMARY KEY (source,path,key)
);
CREATE INDEX harnesses_usage_time ON harnesses_usage_records(time);
CREATE TABLE harnesses_usage_reads (
 source TEXT PRIMARY KEY, read_at INTEGER NOT NULL, problems TEXT NOT NULL
);
";

pub(super) async fn cursor(
    project: &ModuleProject,
    source: String,
    path: String,
) -> Result<Cursor, Error> {
    project
        .read(move |sql| {
            let text: Option<String> = sql
                .query_row(
                    "SELECT cursor FROM harnesses_usage_files WHERE source=?1 AND path=?2",
                    (&source, &path),
                    |r| r.get(0),
                )
                .optional()?;
            Ok(text
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default())
        })
        .await
}

pub(super) async fn keep(
    project: &ModuleProject,
    source: String,
    path: String,
    batch: Batch,
    cutoff: i64,
) -> Result<(), Error> {
    let owner = Participant::Person(project.owner());
    project.write(move |tx| {
        let sql=tx.sql();
        let mut changed=0;
        if batch.reset {
            changed+=sql.execute("DELETE FROM harnesses_usage_records WHERE source=?1 AND path=?2",(&source,&path))?;
        }
        for record in batch.records {
            let Some(time)=timestamp(&record.timestamp) else { continue; };
            if time < cutoff || time > banda_kernel::now_ms()+DAY { continue; }
            let t=&record.tokens;
            let weight=t.input.saturating_add(t.cache_read).saturating_add(t.cache_write).saturating_add(t.output).min(i64::MAX as u64) as i64;
            let text=serde_json::to_string(&record)?;
            changed+=sql.execute("INSERT INTO harnesses_usage_records(source,path,key,time,weight,record) VALUES(?1,?2,?3,?4,?5,?6)
                ON CONFLICT(source,path,key) DO UPDATE SET time=MIN(time,excluded.time),weight=excluded.weight,record=excluded.record
                WHERE excluded.weight>=weight AND excluded.record<>record",rusqlite::params![source,path,record.key,time,weight,text])?;
        }
        sql.execute("INSERT INTO harnesses_usage_files(source,path,cursor) VALUES(?1,?2,?3)
            ON CONFLICT(source,path) DO UPDATE SET cursor=excluded.cursor",(&source,&path,serde_json::to_string(&batch.cursor)?))?;
        if changed>0 { tx.emit("usage_changed",1,None,owner,&serde_json::Value::Null)?; }
        Ok(())
    }).await
}

pub(super) async fn read_done(
    project: &ModuleProject,
    source: String,
    problems: Vec<String>,
) -> Result<(), Error> {
    let owner = Participant::Person(project.owner());
    project
        .write(move |tx| {
            tx.sql().execute(
                "INSERT INTO harnesses_usage_reads(source,read_at,problems) VALUES(?1,?2,?3)
            ON CONFLICT(source) DO UPDATE SET read_at=excluded.read_at,problems=excluded.problems",
                (
                    &source,
                    banda_kernel::now_ms(),
                    serde_json::to_string(&problems)?,
                ),
            )?;
            tx.emit("usage_changed", 1, None, owner, &serde_json::Value::Null)?;
            Ok(())
        })
        .await
}

pub(super) async fn prune(project: &ModuleProject, cutoff: i64) -> Result<(), Error> {
    project
        .write(move |tx| {
            tx.sql().execute(
                "DELETE FROM harnesses_usage_records WHERE time<?1",
                [cutoff],
            )?;
            Ok(())
        })
        .await
}

/// Accept only a well-formed provider timestamp before using the shared
/// RFC3339 conversion; malformed numbers cannot overflow its arithmetic.
fn timestamp(text: &str) -> Option<i64> {
    let (date, rest) = text.split_once('T')?;
    let (clock, zone) = rest.split_at(rest.find(['Z', '+', '-'])?);
    let date: Vec<u32> = date
        .split('-')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let time: Vec<u32> = clock
        .split('.')
        .next()?
        .split(':')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    if date.len() != 3
        || time.len() != 3
        || !(1..=9999).contains(&date[0])
        || !(1..=12).contains(&date[1])
        || !(1..=31).contains(&date[2])
        || time[0] > 23
        || time[1] > 59
        || time[2] > 59
    {
        return None;
    }
    let leap =
        date[0].is_multiple_of(4) && (!date[0].is_multiple_of(100) || date[0].is_multiple_of(400));
    let days = match date[1] {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if date[2] > days
        || clock
            .split_once('.')
            .is_some_and(|(_, f)| f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    if zone != "Z" {
        let parts: Vec<u32> = zone
            .get(1..)?
            .split(':')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        if parts.len() != 2 || parts[0] > 23 || parts[1] > 59 {
            return None;
        }
    }
    crate::limits::instant(text)
}

#[derive(Default)]
struct Sum {
    total: UsageTotal,
    sessions: HashSet<(String, String)>,
}
impl Sum {
    fn add(&mut self, source: &str, record: &Record) {
        let total = &mut self.total;
        let t = &record.tokens;
        total.tokens.input = total.tokens.input.saturating_add(t.input);
        total.tokens.cache_read = total.tokens.cache_read.saturating_add(t.cache_read);
        total.tokens.cache_write = total.tokens.cache_write.saturating_add(t.cache_write);
        total.tokens.output = total.tokens.output.saturating_add(t.output);
        self.sessions
            .insert((source.into(), record.session.clone()));
        if record.prompt {
            total.prompts += 1;
        } else {
            total.requests += 1;
            if let Some(cost) = prices::cost(record) {
                total.cost_usd += cost;
            } else {
                total.unpriced += 1;
            }
        }
    }
    fn finish(mut self) -> UsageTotal {
        self.total.sessions = self.sessions.len() as u64;
        self.total
    }
}

pub(super) type View = (UsageTotal, Vec<UsageRow>, Vec<UsageRead>);
pub(super) fn view(
    sql: &Connection,
    sources: &[Source],
    since: i64,
    until: i64,
) -> Result<View, Error> {
    let ids: Vec<&str> = sources.iter().map(|s| s.id.as_str()).collect();
    let names: BTreeMap<&str, &Source> = sources.iter().map(|s| (s.id.as_str(), s)).collect();
    // Copies and resumed journals can repeat records. Keep one per
    // source/key, choosing the fullest copy of a streaming message.
    let mut query=sql.prepare("WITH ranked AS (
        SELECT source,time,record,ROW_NUMBER() OVER(PARTITION BY source,key ORDER BY weight DESC,path) AS rank
        FROM harnesses_usage_records WHERE source IN (SELECT value FROM json_each(?1)) AND time>=?2 AND time<?3
    ) SELECT source,time,record FROM ranked WHERE rank=1")?;
    let mut cursor = query.query(rusqlite::params![
        serde_json::to_string(&ids)?,
        since,
        until
    ])?;
    let mut all = Sum::default();
    let mut by: BTreeMap<(i64, String, String), Sum> = BTreeMap::new();
    while let Some(row) = cursor.next()? {
        let source: String = row.get(0)?;
        let time: i64 = row.get(1)?;
        let record: Record = serde_json::from_str(&row.get::<_, String>(2)?)?;
        all.add(&source, &record);
        let harness = names[source.as_str()].harness.clone();
        by.entry((time.div_euclid(DAY) * DAY, harness, record.model.clone()))
            .or_default()
            .add(&source, &record);
    }
    let rows = by
        .into_iter()
        .map(|((day, harness, model), sum)| UsageRow {
            day,
            harness,
            model,
            total: sum.finish(),
        })
        .collect();
    let mut reads = Vec::new();
    for source in sources {
        let found: Option<(i64, String)> = sql
            .query_row(
                "SELECT read_at,problems FROM harnesses_usage_reads WHERE source=?1",
                [&source.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (read_at, problems) = match found {
            Some((at, text)) => (Some(at), serde_json::from_str(&text)?),
            None => (None, vec![]),
        };
        reads.push(UsageRead {
            harness: source.harness.clone(),
            name: source.name.clone(),
            read_at,
            problems,
        });
    }
    Ok((all.finish(), rows, reads))
}

#[cfg(test)]
mod tests {
    use super::timestamp;

    #[test]
    fn damaged_timestamps_do_not_overflow_or_become_another_day() {
        for value in [
            "999999999999999999-01-01T00:00:00Z",
            "2026-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-11-04T24:00:00Z",
            "2026-11-04T00:00:00.123oopsZ",
            "2026-11-04T00:00:00+99:00",
        ] {
            assert_eq!(timestamp(value), None, "{value}");
        }
        assert_eq!(timestamp("2024-02-29T00:00:00Z"), Some(1_709_164_800_000));
    }
}
