//! Search in a Project's messages (ADR 0098, decision 17): the text of
//! each message, its Person's and its Agents', in an FTS5 index beside the
//! items, `agents_search`, under each item's rowid. The store keeps it as
//! it writes items ([`index`], [`unindex`]), and [`backfill`] adds the
//! messages written before there was one, the latest first. Titles are
//! the window's to search, and each machine's engine searches only its own
//! Projects' messages: the window asks each. A message its Thread shows
//! nowhere, as one a Person took back before any turn ran it, the index
//! keeps no more, nor a sub-agent's, which only its lane shows (ADR 0103),
//! nor a deleted Thread's.
//!
//! The tokenizer is SQLite's `unicode61` with `remove_diacritics 2`: it
//! folds case in every script, and Latin accents, so "cafe" finds "café".
//! It leaves `ё` as it is, so the index keeps `ё` as `е`, as Russian is
//! often written: "елка" finds "ёлка", and the other way round. The fold
//! keeps each letter one character, so where the index marks a match in
//! its text is where it is in the message's own, which a snippet shows.

use crate::model::{ItemId, ThreadId};
use banda_kernel::{Error, WeakModuleProject};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::ops::Range;
use ts_rs::TS;

/// What `agents.search` is asked: the words the Person typed, without the
/// filters the window reads itself, and how many Threads at most.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct SearchAsk {
    pub words: String,
    /// 20 by default, and 100 at most.
    #[serde(default)]
    #[ts(optional)]
    pub limit: Option<u32>,
}

/// A Thread with a message that holds every word, by its best such
/// message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Found {
    pub thread: ThreadId,
    pub item: ItemId,
    /// A line of the message around the words: its spaces and line breaks
    /// each one space, and `…` where it is cut.
    pub snippet: String,
    /// Where the words are in `snippet`, in order.
    pub hits: Vec<Hit>,
    /// When the message was written, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub at: i64,
}

/// Where a word is in a snippet, in UTF-16 code units, as JavaScript
/// slices a string: from `from` to before `to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Hit {
    pub from: u32,
    pub to: u32,
}

/// How many Threads a search gives when it is not told, and at most.
const LIMIT: u32 = 20;
const MOST: u32 = 100;

/// How many words a search reads; it leaves out the rest.
const WORDS: usize = 16;

/// How many messages from before the index one write adds: a write this
/// short leaves the writer free for what the Agents say meanwhile.
const BATCH: u32 = 500;

/// How long a snippet is, in characters, and how many of them it shows
/// before its first word at most: about a line of the sidebar, with the
/// word near its start, where a line cut short still shows it.
const LINE: usize = 100;
const LEAD: usize = 20;

/// The marks SQLite's `highlight()` puts around each match: control
/// characters no message is written with, one byte each.
const OPEN: char = '\u{2}';
const CLOSE: char = '\u{3}';

/// Each message as the index keeps it: its text, `ё` as `е`, under its
/// item's rowid, beside the item's ID; a row the rowid had is replaced.
/// A message the Thread shows nowhere is left out, as the Pane's
/// `withdrawn` in `thread/state.ts` hides it: one in no turn, whose own
/// turns a Person all took back before any ran it. So is a sub-agent's,
/// an entry of its lane, which `agents.thread` leaves out (ADR 0103,
/// decision 8), so a hit always names an entry its Thread shows. A
/// condition on `agents_items` follows it, after `AND`.
const ROWS: &str = "INSERT OR REPLACE INTO agents_search (rowid, text, item)
    SELECT rowid, replace(replace(json_extract(body, '$.text'), 'ё', 'е'), 'Ё', 'Е'), id
    FROM agents_items WHERE json_extract(body, '$.kind') = 'message' AND sub IS NULL
    AND (turn IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM agents_turns t WHERE t.thread = agents_items.thread
            AND t.message = agents_items.id AND t.state = 'withdrawn')
        OR EXISTS (SELECT 1 FROM agents_turns t WHERE t.thread = agents_items.thread
            AND t.message = agents_items.id AND t.state != 'withdrawn'))";

/// The best message of each Thread that holds every word, `?1`, the best
/// first, at most `?2`: by FTS5's rank, then the latest. `item` names the
/// row's item, so a row whose rowid another item has now is never read as
/// that item's. Each message with its text, and its text as the index
/// marks the words in it.
const SEARCH: &str = "WITH best AS (
        SELECT rowid FROM (
            SELECT s.rowid, s.rank AS score, i.at, ROW_NUMBER() OVER (
                PARTITION BY i.thread ORDER BY s.rank, i.at DESC, i.rowid DESC
            ) AS nth
            FROM agents_search s JOIN agents_items i ON i.rowid = s.rowid AND i.id = s.item
            WHERE agents_search MATCH ?1
        ) WHERE nth = 1 ORDER BY score, at DESC, rowid DESC LIMIT ?2
    )
    SELECT i.thread, i.id, i.at, json_extract(i.body, '$.text'),
        highlight(agents_search, 0, char(2), char(3))
    FROM agents_search s JOIN agents_items i ON i.rowid = s.rowid
    WHERE agents_search MATCH ?1 AND s.rowid IN best
    ORDER BY s.rank, i.at DESC, i.rowid DESC";

/// Writes the item's text into the index as the item reads now, if it is
/// a message its Thread shows, in place of what the index kept of it.
pub fn index(sql: &Connection, item: ItemId) -> Result<(), Error> {
    unindex(sql, "?1", params![item])?;
    sql.execute(&format!("{ROWS} AND id = ?1"), params![item])?;
    Ok(())
}

/// Writes each message of the Thread into the index: a fork's, which its
/// items and turns were copied into.
pub fn index_thread(sql: &Connection, thread: ThreadId) -> Result<(), Error> {
    sql.execute(&format!("{ROWS} AND thread = ?1"), params![thread])?;
    Ok(())
}

/// Takes the items `items` lists out of the index, before they leave
/// their Thread or move: `items` is SQL that lists their IDs, with
/// `values` bound.
pub fn unindex(sql: &Connection, items: &str, values: impl rusqlite::Params) -> Result<(), Error> {
    let mut listed = sql.prepare(&format!(
        "SELECT rowid FROM agents_items WHERE id IN ({items})"
    ))?;
    let rowids = listed
        .query_map(values, |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // One row at a time: FTS5 finds a rowid, but reads all of itself for
    // a list of them.
    let mut taken = sql.prepare("DELETE FROM agents_search WHERE rowid = ?1")?;
    for rowid in rowids {
        taken.execute(params![rowid])?;
    }
    Ok(())
}

/// Indexes up to `batch` of the messages written before the index, the
/// latest first, and keeps where it stopped, in the same write: whether
/// any may be left.
pub fn fill(sql: &Connection, batch: u32) -> Result<bool, Error> {
    let below: i64 = sql.query_row("SELECT below FROM agents_backfill", [], |row| row.get(0))?;
    if below == 0 {
        return Ok(false);
    }
    let floor: Option<i64> = sql.query_row(
        "SELECT MIN(rowid) FROM (
             SELECT rowid FROM agents_items
             WHERE rowid < ?1 AND json_extract(body, '$.kind') = 'message' AND sub IS NULL
             ORDER BY rowid DESC LIMIT ?2
         )",
        params![below, batch],
        |row| row.get(0),
    )?;
    let floor = floor.unwrap_or(0);
    sql.execute(
        &format!("{ROWS} AND rowid >= ?1 AND rowid < ?2"),
        params![floor, below],
    )?;
    sql.execute("UPDATE agents_backfill SET below = ?1", params![floor])?;
    Ok(floor > 0)
}

/// Fills the index with the messages from before it, in writes of
/// [`BATCH`], until none is left or the Project closes; it goes on where
/// it stopped as the Project opens again.
pub async fn backfill(project: WeakModuleProject) {
    while let Some(open) = project.upgrade() {
        match open.write(|tx| fill(tx.sql(), BATCH)).await {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                tracing::warn!(%error, "the message index stopped filling");
                return;
            }
        }
    }
}

/// The Threads whose messages hold every one of `words`, each once by its
/// best message, the best first, at most `limit`.
pub fn search(sql: &Connection, words: &str, limit: Option<u32>) -> Result<Vec<Found>, Error> {
    let Some(query) = query(words) else {
        return Ok(Vec::new());
    };
    let limit = limit.unwrap_or(LIMIT).clamp(1, MOST);
    let mut found = sql.prepare(SEARCH)?;
    let rows = found.query_map(params![query, limit], |row| {
        let (text, marked): (String, String) = (row.get(3)?, row.get(4)?);
        let (snippet, hits) = snippet(&text, &matched(&marked, text.chars().count()));
        Ok(Found {
            thread: row.get(0)?,
            item: row.get(1)?,
            at: row.get(2)?,
            snippet,
            hits,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The FTS5 query for `words`: each word, `ё` as `е`, quoted, so the
/// Person's quotes, stars and dashes are text, not syntax; a word of two
/// letters or more matches as the start of a word too. A word with no
/// letter or digit is left out, as the tokenizer would leave it; with
/// none left there is nothing to search.
fn query(words: &str) -> Option<String> {
    let quoted: Vec<String> = words
        .split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .take(WORDS)
        .map(|word| {
            let letters = word.chars().filter(|c| c.is_alphanumeric()).count();
            let word = word
                .replace('ё', "е")
                .replace('Ё', "Е")
                .replace('"', "\"\"");
            let start = if letters >= 2 { "*" } else { "" };
            format!("\"{word}\"{start}")
        })
        .collect();
    (!quoted.is_empty()).then(|| quoted.join(" "))
}

/// Where `marked`, a text with each match between [`OPEN`] and
/// [`CLOSE`], marks: character ranges in the text without the marks. No
/// range when that text is not `len` characters long, as a message that
/// holds such a mark itself would make it: its snippet then marks nothing.
fn matched(marked: &str, len: usize) -> Vec<Range<usize>> {
    let (mut hits, mut at, mut open) = (Vec::new(), 0, None);
    for c in marked.chars() {
        match c {
            OPEN => open = Some(at),
            CLOSE => hits.extend(open.take().map(|from| from..at)),
            _ => at += 1,
        }
    }
    if at == len { hits } else { Vec::new() }
}

/// A line of `text` around `hits`, its character ranges of what matched:
/// up to [`LINE`] characters from a word up to [`LEAD`] characters before
/// the first hit of the line that holds the most, cut at words, with
/// where the hits are in it. With no hit, the text's start.
fn snippet(text: &str, hits: &[Range<usize>]) -> (String, Vec<Hit>) {
    let chars: Vec<char> = text.chars().collect();
    let mut anchor = 0..0;
    let mut most = 0;
    for (n, span) in hits.iter().enumerate() {
        let held = hits[n..]
            .iter()
            .take_while(|other| other.end <= span.start + LINE)
            .count();
        if held > most {
            (anchor, most) = (span.clone(), held);
        }
    }
    let space = |at: usize| chars[at].is_whitespace();
    // From a word's start, unless a single word runs past the lead.
    let mut begin = anchor.start.saturating_sub(LEAD);
    if begin > 0 && !space(begin - 1) {
        begin = (begin..anchor.start)
            .find(|&at| space(at))
            .map_or(begin, |at| at + 1);
    }
    // To a word's end, past the first hit's.
    let mut end = (begin + LINE).min(chars.len());
    if end < chars.len() && !space(end) {
        end = (anchor.end..end).rev().find(|&at| space(at)).unwrap_or(end);
    }
    let mut line = String::new();
    let mut units = 0;
    if begin > 0 {
        line.push('…');
        units += 1;
    }
    // Where each character of the line, and its end, is in it: runs of
    // spaces and line breaks are one space, none at its ends.
    let mut placed = Vec::with_capacity(end - begin + 1);
    let (mut written, mut spaced) = (false, false);
    for &c in &chars[begin..end] {
        if c.is_whitespace() {
            spaced = written;
            placed.push(units);
            continue;
        }
        if std::mem::take(&mut spaced) {
            line.push(' ');
            units += 1;
        }
        written = true;
        placed.push(units);
        line.push(c);
        units += c.len_utf16() as u32;
    }
    placed.push(units);
    if end < chars.len() {
        line.push('…');
    }
    let hits = hits
        .iter()
        .filter(|span| span.start < end && span.end > begin)
        .map(|span| Hit {
            from: placed[span.start.max(begin) - begin],
            to: placed[span.end.min(end) - begin],
        })
        .filter(|hit| hit.from < hit.to)
        .collect();
    (line, hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Body, Item, Settings, ThreadSummary};
    use crate::store;
    use banda_kernel::{AgentId, Participant};

    fn migrated() -> Connection {
        let sql = Connection::open_in_memory().unwrap();
        for migration in store::MIGRATIONS {
            sql.execute_batch(migration).unwrap();
        }
        sql
    }

    fn thread(sql: &Connection, title: &str) -> ThreadId {
        let agent = AgentId::new();
        let summary = ThreadSummary {
            id: ThreadId::new(),
            harness: "fake".to_owned(),
            title: title.to_owned(),
            updated_at: 0,
            was: None,
        };
        let author = Participant::Agent(agent);
        store::insert_thread(sql, &summary, agent, author, &Settings::default()).unwrap();
        summary.id
    }

    fn message(text: &str, at: i64) -> Item {
        Item {
            id: ItemId::new(),
            turn: None,
            author: Participant::Agent(AgentId::new()),
            at,
            body: Body::Message {
                text: text.to_owned(),
                images: Vec::new(),
                answers: false,
            },
        }
    }

    fn post(sql: &Connection, thread: ThreadId, text: &str, at: i64) -> ItemId {
        let item = message(text, at);
        store::insert_item(sql, thread, &item, None).unwrap();
        item.id
    }

    /// Each Thread found, in order, with its snippet.
    fn found(sql: &Connection, words: &str) -> Vec<(ThreadId, String)> {
        let found = search(sql, words, None).unwrap();
        found.into_iter().map(|f| (f.thread, f.snippet)).collect()
    }

    /// What each hit of each Thread found marks in its snippet.
    fn marked(sql: &Connection, words: &str) -> Vec<Vec<String>> {
        let found = search(sql, words, None).unwrap();
        let each = |f: Found| {
            let units: Vec<u16> = f.snippet.encode_utf16().collect();
            let mark = |hit: &Hit| String::from_utf16(&units[hit.from as usize..hit.to as usize]);
            f.hits.iter().map(|hit| mark(hit).unwrap()).collect()
        };
        found.into_iter().map(each).collect()
    }

    /// Where `word` is in `text`, each time, as the index marks it: in
    /// characters.
    fn each(text: &str, word: &str) -> Vec<Range<usize>> {
        let from = |at: usize| text[..at].chars().count();
        let at = text.match_indices(word);
        at.map(|(at, word)| from(at)..from(at) + word.chars().count())
            .collect()
    }

    #[test]
    fn each_word_is_quoted_and_matches_the_start_of_a_word() {
        assert_eq!(query("side bar").as_deref(), Some(r#""side"* "bar"*"#));
        assert_eq!(
            query(r#"say "hi" -not OR x*"#).as_deref(),
            Some(r#""say"* """hi"""* "-not"* "OR"* "x*""#),
            "the Person's syntax is text"
        );
        assert_eq!(query("ёлка Ёж").as_deref(), Some(r#""елка"* "Еж"*"#));
        assert_eq!(
            query("a b").as_deref(),
            Some(r#""a" "b""#),
            "one letter is a word"
        );
        assert_eq!(query("— ? ...").as_deref(), None, "no word to search");
        assert_eq!(query("   ").as_deref(), None);
        let many = vec!["word"; WORDS + 4].join(" ");
        assert_eq!(query(&many).unwrap().matches("word").count(), WORDS);
    }

    #[test]
    fn a_snippet_is_a_line_around_the_words_with_where_they_are() {
        let hit = |from, to| Hit { from, to };
        // A short message whole, its line breaks as spaces.
        let text = "Keep the\n\n  sidebar  still";
        assert_eq!(
            snippet(text, &each(text, "sidebar")),
            ("Keep the sidebar still".to_owned(), vec![hit(9, 16)])
        );
        // A long one from a word before the hit, cut at words.
        let text = format!(
            "{} the sidebar row {}",
            "early words".repeat(10),
            "late ".repeat(40)
        );
        let (line, hits) = snippet(&text, &each(&text, "sidebar"));
        assert!(line.starts_with("…words the sidebar row late"), "{line}");
        assert!(line.ends_with("late…"), "{line}");
        assert!(line.chars().count() <= LINE + 2, "{line}");
        assert_eq!(hits, [hit(11, 18)]);
        // No hit: the start.
        let (line, hits) = snippet(&text, &[]);
        assert!(line.starts_with("early wordsearly"), "{line}");
        assert!(hits.is_empty());
    }

    #[test]
    fn a_snippet_shows_the_line_with_the_most_hits_in_javascript_s_units() {
        let text = format!(
            "Ключ 🔑 once. {} Ключ и ключ, 🔑 ключ.",
            "filler ".repeat(30)
        );
        let hits: Vec<Range<usize>> = each(&text, "люч")
            .into_iter()
            .map(|at| at.start - 1..at.end)
            .collect();
        let (line, at) = snippet(&text, &hits);
        assert!(line.ends_with("Ключ и ключ, 🔑 ключ."), "{line}");
        let units: Vec<u16> = line.encode_utf16().collect();
        let words: Vec<String> = at
            .iter()
            .map(|h| String::from_utf16(&units[h.from as usize..h.to as usize]).unwrap())
            .collect();
        assert_eq!(
            words,
            ["Ключ", "ключ", "ключ"],
            "past the emoji's two units"
        );
    }

    #[test]
    fn a_text_that_holds_a_mark_itself_marks_nothing() {
        let marked = format!("a {OPEN}word{CLOSE} b");
        let plain = "a word b";
        let len = |text: &str| text.chars().count();
        assert_eq!(matched(&marked, len(plain)), each(plain, "word"));
        assert!(matched(&marked, len("a \u{2}word b")).is_empty());
    }

    #[test]
    fn the_best_message_finds_its_thread_once_and_the_best_first() {
        let sql = migrated();
        let (once, often, none) = (
            thread(&sql, "Once"),
            thread(&sql, "Often"),
            thread(&sql, "None"),
        );
        post(
            &sql,
            once,
            "We could move the sidebar settings later, among other things.",
            1,
        );
        post(
            &sql,
            often,
            "The sidebar: the sidebar's rows, the sidebar's counts.",
            2,
        );
        post(&sql, often, "And the sidebar once more.", 3);
        post(&sql, none, "Nothing to see here.", 4);
        let order: Vec<ThreadId> = found(&sql, "sidebar").into_iter().map(|(t, _)| t).collect();
        assert_eq!(order, [often, once], "each Thread once, the most first");
        let found = search(&sql, "sidebar", Some(1)).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].at, 2, "by its best message");
        // Every word, each the start of one.
        assert_eq!(found_threads(&sql, "side count"), [often]);
        assert!(found_threads(&sql, "sidebar zed").is_empty());
        assert!(
            found_threads(&sql, "z").is_empty(),
            "one letter is a whole word"
        );
    }

    fn found_threads(sql: &Connection, words: &str) -> Vec<ThreadId> {
        found(sql, words).into_iter().map(|(t, _)| t).collect()
    }

    #[test]
    fn of_two_as_good_the_latest_comes_first() {
        let sql = migrated();
        let (old, new) = (thread(&sql, "Old"), thread(&sql, "New"));
        post(&sql, old, "Ship it", 1);
        post(&sql, new, "Ship it", 2);
        assert_eq!(found_threads(&sql, "ship"), [new, old]);
    }

    #[test]
    fn case_accents_and_yo_are_folded_in_any_script() {
        let sql = migrated();
        let russian = thread(&sql, "Russian");
        post(&sql, russian, "Ёлка и ЁЖИК: Привет, мир!", 1);
        let french = thread(&sql, "French");
        post(&sql, french, "Un café crème", 2);
        let plain = thread(&sql, "Plain");
        post(&sql, plain, "Елка без ё, и йогурт", 3);
        for words in ["привет", "ПРИВ", "мир", "ежик", "ёжик", "Ёж"] {
            assert_eq!(found_threads(&sql, words), [russian], "{words}");
        }
        assert_eq!(found_threads(&sql, "cafe creme"), [french]);
        assert_eq!(found_threads(&sql, "CAFÉ"), [french]);
        let both = found_threads(&sql, "елка");
        assert_eq!(both.len(), 2, "ё as е, and е as ё");
        assert_eq!(found_threads(&sql, "ёлка").len(), 2);
        assert_eq!(found_threads(&sql, "йогурт"), [plain]);
        assert!(found_threads(&sql, "иогурт").is_empty(), "й is not и");
        // The snippet is the message's own, ё and all.
        assert_eq!(
            marked(&sql, "ежик привет"),
            [vec!["ЁЖИК".to_owned(), "Привет".to_owned()]]
        );
        assert_eq!(found(&sql, "ежик")[0].1, "Ёлка и ЁЖИК: Привет, мир!");
    }

    #[test]
    fn a_message_is_found_as_it_reads_now() {
        let sql = migrated();
        let at = thread(&sql, "Edited");
        let item = post(&sql, at, "first words", 1);
        let edited = Body::Message {
            text: "second words".to_owned(),
            images: Vec::new(),
            answers: false,
        };
        store::set_body(&sql, item, &edited).unwrap();
        assert_eq!(found_threads(&sql, "second"), [at]);
        assert!(
            found_threads(&sql, "first").is_empty(),
            "the old words are gone"
        );
        // A reply that comes in pieces is found by the last.
        let mut reply = message("The answer ", 2);
        store::put(&sql, at, &reply, None, None).unwrap();
        reply.body = Body::Message {
            text: "is forty-two.".to_owned(),
            images: Vec::new(),
            answers: false,
        };
        store::put(&sql, at, &reply, None, None).unwrap();
        assert_eq!(
            found(&sql, "forty"),
            [(at, "The answer is forty-two.".to_owned())]
        );
        // What is not a message is never found.
        let thought = Item {
            body: Body::Thought {
                text: "a hidden thought".to_owned(),
            },
            ..message("", 3)
        };
        store::put(&sql, at, &thought, None, None).unwrap();
        assert!(found_threads(&sql, "hidden").is_empty());
    }

    #[test]
    fn a_moved_message_is_found_once_and_a_taken_one_never() {
        let sql = migrated();
        let at = thread(&sql, "Moved");
        let queued = post(&sql, at, "queued words", 1);
        post(&sql, at, "after it", 2);
        store::move_last(&sql, queued).unwrap();
        let found = search(&sql, "queued", None).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].item, queued);
        let rows: i64 = sql
            .query_row("SELECT count(*) FROM agents_search", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 2, "its old row went with its rowid");
        unindex(&sql, "?1", params![queued]).unwrap();
        assert!(found_threads(&sql, "queued").is_empty());
    }

    /// A sub-agent's words show in its lane only, so the search, whose hit
    /// names an entry of its Thread, never finds them (ADR 0103, decision
    /// 8).
    #[test]
    fn a_sub_agent_s_message_is_found_nowhere() {
        use crate::model::SubagentId;
        let sql = migrated();
        let at = thread(&sql, "Crew");
        let lane = Some(SubagentId::new());
        let mut reply = message("the lane's otter ", 1);
        store::put(&sql, at, &reply, None, lane).unwrap();
        reply.body = Body::Message {
            text: "grows".to_owned(),
            images: Vec::new(),
            answers: false,
        };
        store::put(&sql, at, &reply, None, lane).unwrap();
        post(&sql, at, "the Thread's own otter", 2);
        assert_eq!(
            found(&sql, "otter"),
            [(at, "the Thread's own otter".to_owned())]
        );
        assert!(found_threads(&sql, "grows").is_empty());
        // Nor does the backfill add it.
        sql.execute_batch(
            "DELETE FROM agents_search;
             UPDATE agents_backfill SET below = (SELECT MAX(rowid) + 1 FROM agents_items);",
        )
        .unwrap();
        while fill(&sql, 1).unwrap() {}
        assert!(found_threads(&sql, "grows").is_empty());
        assert_eq!(found_threads(&sql, "otter"), [at]);
    }

    /// A Thread its Person deleted takes its messages out of the index,
    /// so none of its rows is left there (ADR 0098, decisions 14 and 17).
    #[test]
    fn a_deleted_thread_s_messages_leave_the_index() {
        let sql = migrated();
        let gone = thread(&sql, "Gone");
        let kept = thread(&sql, "Kept");
        post(&sql, gone, "the heron flew", 1);
        post(&sql, gone, "a heron again", 2);
        post(&sql, kept, "the heron stayed", 3);
        assert_eq!(found_threads(&sql, "heron").len(), 2);
        store::delete_thread(&sql, gone).unwrap();
        assert_eq!(found_threads(&sql, "heron"), [kept]);
        let rows: i64 = sql
            .query_row("SELECT count(*) FROM agents_search", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1, "only the kept Thread's message");
    }

    #[test]
    fn a_message_taken_back_before_any_turn_ran_it_is_found_nowhere() {
        use crate::model::{Opener, TurnId, TurnState};
        let sql = migrated();
        let at = thread(&sql, "Taken");
        let agent = store::agent_of(&sql, at).unwrap().unwrap();
        let turn = |message: ItemId, state: TurnState| {
            let turn = store::Turn {
                id: TurnId::new(),
                thread: at,
                agent,
                message,
                state,
                opener: Opener::Person,
                from_thread: None,
                stopping: false,
            };
            let author = Participant::Agent(agent);
            store::insert_turn(&sql, &turn, author, 1, &Settings::default()).unwrap();
            turn.id
        };
        // As `agents.withdraw` takes a waiting message back.
        let take_back = |turn: TurnId, message: ItemId| {
            store::set_turn(&sql, turn, TurnState::Withdrawn, None, None, 2).unwrap();
            index(&sql, message).unwrap();
        };
        let taken = post(&sql, at, "the walrus, taken back", 1);
        take_back(turn(taken, TurnState::Queued), taken);
        // A turn ran it before: the Thread still shows it.
        let tried = post(&sql, at, "the narwhal, tried again", 2);
        turn(tried, TurnState::Failed);
        take_back(turn(tried, TurnState::Queued), tried);
        // Sent into the turn that runs: the Thread shows it there.
        let running = turn(post(&sql, at, "go", 3), TurnState::Running);
        let steered = post(&sql, at, "the seal, sent now", 4);
        take_back(turn(steered, TurnState::Queued), steered);
        store::set_item_turn(&sql, steered, Some(running)).unwrap();
        store::move_last(&sql, steered).unwrap();
        let shown = || ["walrus", "narwhal", "seal"].map(|word| found_threads(&sql, word).len());
        assert_eq!(shown(), [0, 1, 1]);
        // Nor does a fork show it, nor the backfill add it.
        let fork = thread(&sql, "Fork");
        let forker = store::agent_of(&sql, fork).unwrap().unwrap();
        store::copy_turns(&sql, (at, agent), running, (fork, forker)).unwrap();
        assert_eq!(shown(), [0, 2, 2], "in the fork too");
        sql.execute_batch(
            "DELETE FROM agents_search;
             UPDATE agents_backfill SET below = (SELECT MAX(rowid) + 1 FROM agents_items);",
        )
        .unwrap();
        while fill(&sql, 2).unwrap() {}
        assert_eq!(shown(), [0, 2, 2], "from before the index");
    }

    #[test]
    fn a_fork_s_messages_are_found_in_it_too_and_a_rewound_turn_s_no_more() {
        use crate::model::{Opener, TurnId, TurnState};
        let sql = migrated();
        let from = thread(&sql, "From");
        let agent = store::agent_of(&sql, from).unwrap().unwrap();
        let author = Participant::Agent(agent);
        let turn = |text: &str, at: i64| {
            let asked = post(&sql, from, text, at);
            let turn = store::Turn {
                id: TurnId::new(),
                thread: from,
                agent,
                message: asked,
                state: TurnState::Done,
                opener: Opener::Person,
                from_thread: None,
                stopping: false,
            };
            store::insert_turn(&sql, &turn, author, at, &Settings::default()).unwrap();
            let reply = Item {
                turn: Some(turn.id),
                ..message(&format!("Done: {text}"), at)
            };
            store::insert_item(&sql, from, &reply, None).unwrap();
            turn.id
        };
        let first = turn("plant the oak", 1);
        let second = turn("water the birch", 2);
        let fork = thread(&sql, "Fork");
        let forker = store::agent_of(&sql, fork).unwrap().unwrap();
        store::copy_turns(&sql, (from, agent), first, (fork, forker)).unwrap();
        let mut both = vec![from, fork];
        both.sort();
        let mut oak = found_threads(&sql, "oak");
        oak.sort();
        assert_eq!(oak, both, "the message and its reply, in each");
        assert_eq!(
            found_threads(&sql, "birch"),
            [from],
            "not past the fork's turn"
        );
        store::rewind(&sql, from, second, 3).unwrap();
        assert!(found_threads(&sql, "birch").is_empty());
        assert_eq!(found_threads(&sql, "oak").len(), 2);
    }

    #[test]
    fn the_messages_from_before_the_index_join_it_the_latest_first_where_it_stopped() {
        let sql = Connection::open_in_memory().unwrap();
        let at = store::MIGRATIONS
            .iter()
            .position(|m| m.contains("agents_backfill"))
            .unwrap();
        let (before, from) = store::MIGRATIONS.split_at(at);
        for migration in before {
            sql.execute_batch(migration).unwrap();
        }
        let old = thread(&sql, "Old");
        let author = Participant::Agent(AgentId::new());
        // As the store wrote them then, with no index.
        for (n, text) in ["one apple", "a tool", "two apples", "three apples"]
            .into_iter()
            .enumerate()
        {
            let body = if text == "a tool" {
                serde_json::json!({ "kind": "thought", "text": "apple tool" })
            } else {
                serde_json::to_value(message(text, 0).body).unwrap()
            };
            sql.execute(
                "INSERT INTO agents_items (id, thread, author, at, body) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    ItemId::new(),
                    old,
                    serde_json::to_string(&author).unwrap(),
                    n as i64,
                    body.to_string()
                ],
            )
            .unwrap();
        }
        for migration in from {
            sql.execute_batch(migration).unwrap();
        }
        let new = thread(&sql, "New");
        post(&sql, new, "a new apple", 10);
        let snippets = |sql: &Connection| -> Vec<String> {
            let mut found: Vec<String> = found(sql, "apple").into_iter().map(|(_, s)| s).collect();
            found.sort();
            found
        };
        assert_eq!(snippets(&sql), ["a new apple"], "a new message at once");
        let rows = |sql: &Connection| -> i64 {
            sql.query_row("SELECT count(*) FROM agents_search", [], |row| row.get(0))
                .unwrap()
        };
        assert!(fill(&sql, 2).unwrap(), "two of three, the latest");
        assert_eq!(rows(&sql), 3);
        assert_eq!(found_threads(&sql, "three"), [old]);
        assert_eq!(found_threads(&sql, "two"), [old]);
        assert!(found_threads(&sql, "one").is_empty(), "the oldest waits");
        // As if the engine stopped here: what it kept is where it goes on.
        assert!(fill(&sql, 2).unwrap());
        assert_eq!(rows(&sql), 4, "the thought is no message");
        assert!(!fill(&sql, 2).unwrap(), "none left");
        assert!(!fill(&sql, 2).unwrap(), "and it stays done");
        assert_eq!(rows(&sql), 4);
        let below: i64 = sql
            .query_row("SELECT below FROM agents_backfill", [], |row| row.get(0))
            .unwrap();
        assert_eq!(below, 0);
        assert_eq!(
            search(&sql, "apple", None).unwrap().len(),
            2,
            "each Thread once"
        );
        let old_one = found(&sql, "one");
        assert_eq!(old_one, [(old, "one apple".to_owned())]);
    }

    /// What the index costs on a copy of a real Project's log, and on that
    /// log's messages copied over and over to a large one, and what a
    /// reply that comes in pieces costs then: `BANDA_SEARCH_LOG=<a copy of
    /// project.sqlite3> BANDA_SEARCH_STEPS=<its agents steps> cargo test -p
    /// banda-agents --lib search::tests::cost -- --ignored --nocapture`. It
    /// changes the copy.
    #[test]
    #[ignore = "a measure to read, not a check"]
    fn cost() {
        use std::time::Instant;
        let Some(path) = std::env::var_os("BANDA_SEARCH_LOG") else {
            panic!("BANDA_SEARCH_LOG names a copy of a Project's log");
        };
        let sql = Connection::open(path).unwrap();
        // The copy is brought up to this build's steps, as the kernel would
        // as the Project opens: from the step its agents ledger stands at,
        // which BANDA_SEARCH_STEPS says (the count of that ledger's rows in
        // the kernel's migrations table). Left out, the copy is taken to
        // stand just before the index's own step.
        let stands = std::env::var("BANDA_SEARCH_STEPS")
            .ok()
            .map(|steps| steps.parse::<usize>().unwrap())
            .unwrap_or_else(|| {
                store::MIGRATIONS
                    .iter()
                    .position(|m| m.contains("agents_backfill"))
                    .unwrap()
            });
        for step in &store::MIGRATIONS[stands..] {
            sql.execute_batch(step).unwrap();
        }
        let one = |query: &str| -> i64 { sql.query_row(query, [], |row| row.get(0)).unwrap() };
        let size = || one("SELECT sum(pgsize) FROM dbstat WHERE name LIKE 'agents_search%'");
        let messages = || {
            (
                one("SELECT count(*) FROM agents_items WHERE json_extract(body, '$.kind') = 'message'"),
                one("SELECT sum(length(CAST(json_extract(body, '$.text') AS BLOB))) FROM agents_items
                     WHERE json_extract(body, '$.kind') = 'message'"),
            )
        };
        let backfill = |what: &str| {
            let started = Instant::now();
            let mut writes = 0;
            loop {
                sql.execute_batch("BEGIN").unwrap();
                let more = fill(&sql, BATCH).unwrap();
                sql.execute_batch("COMMIT").unwrap();
                writes += 1;
                if !more {
                    break;
                }
            }
            let (count, bytes) = messages();
            println!(
                "{what}: {count} messages, {} KiB of text: backfill {:?} in {writes} writes, index {} KiB",
                bytes / 1024,
                started.elapsed(),
                size() / 1024
            );
        };
        let searches = || {
            for words in ["sidebar", "the", "a", "сообщ", "thread pane", "zzzz"] {
                let started = Instant::now();
                let found = search(&sql, words, None).unwrap();
                println!(
                    "  {words:?}: {} Threads in {:?}",
                    found.len(),
                    started.elapsed()
                );
            }
        };
        backfill("the copy");
        searches();
        // Its messages again and again, as each were new, then all again
        // from before the index.
        for _ in 0..7 {
            sql.execute_batch(
                "INSERT INTO agents_items (id, thread, turn, author, at, body)
                 SELECT lower(hex(randomblob(16))), thread, turn, author, at, body
                 FROM agents_items WHERE json_extract(body, '$.kind') = 'message'",
            )
            .unwrap();
        }
        sql.execute_batch(
            "DELETE FROM agents_search;
             UPDATE agents_backfill SET below = (SELECT MAX(rowid) + 1 FROM agents_items);",
        )
        .unwrap();
        backfill("128 times its messages");
        searches();
        // A reply of 20 KB in pieces of 50 bytes, each a write.
        let at = thread(&sql, "Pieces");
        let mut reply = message("", 0);
        let started = Instant::now();
        for n in 0..400 {
            reply.body = Body::Message {
                text: format!("piece {n:03} of the reply, written as it comes. "),
                images: Vec::new(),
                answers: false,
            };
            sql.execute_batch("BEGIN").unwrap();
            store::put(&sql, at, &reply, None, None).unwrap();
            sql.execute_batch("COMMIT").unwrap();
        }
        println!(
            "a reply of 20 KB in 400 pieces, each a write: {:?} each, index {} KiB",
            started.elapsed() / 400,
            size() / 1024
        );
    }
}
