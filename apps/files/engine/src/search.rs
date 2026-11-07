//! `files.search`: words or a pattern in the files under a folder (ADR
//! 0073, decision 11), as ripgrep finds them, on its own crates: `ignore`
//! walks as `find` does, leaving out what `.gitignore` does and `.git`, and
//! `grep-searcher` reads each file with `grep-regex`'s matcher, skipping a
//! binary one. Each file's lines come as they are found, at most 100 a
//! file and a total cap, until the caller lets go.

use crate::model::{Matched, SearchAsk, Searched};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkMatch};
use std::path::Path;

/// The most lines answered unless asked, and the most at all.
pub const LIMIT: u32 = 2_000;
pub const MOST: u32 = 10_000;
/// The most lines of one file.
pub const PER_FILE: usize = 100;
/// About how long a line's text may be; a longer one is cut around its
/// first match.
const LONG: usize = 300;
/// How much of a long line is kept before its first match.
const BEFORE: usize = 60;

/// The matcher `ask` makes: its words as they are, or a pattern; its case
/// counting or not; whole words or not. Refused, a pattern that does not
/// read.
pub fn matcher(ask: &SearchAsk) -> Result<RegexMatcher, String> {
    RegexMatcherBuilder::new()
        .fixed_strings(!ask.regex)
        .case_insensitive(!ask.case)
        .word(ask.word)
        .line_terminator(Some(b'\n'))
        .build(&ask.query)
        .map_err(|error| error.to_string())
}

/// Looks under `dir` with `matcher`, saying each file's lines to `say`
/// until it says no more, or `limit` lines were found: then the end.
pub fn search(
    dir: &Path,
    matcher: &RegexMatcher,
    limit: usize,
    say: &mut dyn FnMut(Searched) -> bool,
) {
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();
    let (mut files, mut lines, mut cut) = (0u32, 0usize, false);
    for entry in crate::find::walker(dir).flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let room = (limit - lines).min(PER_FILE);
        let mut found = Found {
            matcher,
            lines: Vec::new(),
            room,
            more: false,
        };
        // A file that cannot be read is passed over.
        if searcher
            .search_path(matcher, entry.path(), &mut found)
            .is_err()
            || found.lines.is_empty()
        {
            continue;
        }
        files += 1;
        lines += found.lines.len();
        let Ok(path) = entry.path().strip_prefix(dir) else {
            continue;
        };
        let path = path
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        let file = Searched::File {
            path,
            lines: found.lines,
            more: found.more,
        };
        if !say(file) {
            return;
        }
        if lines >= limit {
            cut = true;
            break;
        }
    }
    say(Searched::Done {
        files,
        lines: u32::try_from(lines).unwrap_or(u32::MAX),
        cut,
    });
}

/// One file's lines, as the searcher finds them, until there is no room.
struct Found<'a> {
    matcher: &'a RegexMatcher,
    lines: Vec<Matched>,
    room: usize,
    more: bool,
}

impl Sink for Found<'_> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _: &grep_searcher::Searcher,
        hit: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        if self.lines.len() >= self.room {
            self.more = true;
            return Ok(false);
        }
        let bytes = hit.bytes();
        let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        let mut ranges = Vec::new();
        let _ = self.matcher.find_iter(bytes, |at| {
            if at.start() < at.end() {
                ranges.push((at.start(), at.end()));
            }
            true
        });
        let line = u32::try_from(hit.line_number().unwrap_or(0)).unwrap_or(u32::MAX);
        self.lines.push(clipped(line, bytes, &ranges));
        Ok(true)
    }
}

/// A line as it is answered: its text, a long one cut around its first
/// match, and its matches in JavaScript's counting.
fn clipped(line: u32, bytes: &[u8], ranges: &[(usize, usize)]) -> Matched {
    let text = String::from_utf8_lossy(bytes);
    // A lossy text has the line's bytes only where they read as UTF-8;
    // its ranges are found again in what it holds.
    let ranges: Vec<(usize, usize)> = if text.len() == bytes.len() {
        ranges.to_vec()
    } else {
        Vec::new()
    };
    let first = ranges.first().map_or(0, |range| range.0);
    let (start, end) = if text.len() <= LONG {
        (0, text.len())
    } else {
        let start = floor(&text, first.saturating_sub(BEFORE));
        (start, floor(&text, (start + LONG).min(text.len())))
    };
    let (before, after) = (start > 0, end < text.len());
    let mut kept = String::with_capacity(end - start + 6);
    if before {
        kept.push('…');
    }
    kept.push_str(&text[start..end]);
    if after {
        kept.push('…');
    }
    // Where a byte of the line is in `kept`, as JavaScript counts.
    let shift = u32::from(before);
    let at = |byte: usize| -> u32 {
        let byte = floor(&text, byte.clamp(start, end));
        let n = text[start..byte].encode_utf16().count();
        u32::try_from(n).unwrap_or(u32::MAX).saturating_add(shift)
    };
    let ranges = (ranges.iter())
        .filter(|(from, to)| *to > start && *from < end)
        .map(|&(from, to)| (at(from), at(to)))
        .filter(|(from, to)| from < to)
        .collect();
    Matched {
        line,
        text: kept,
        ranges,
    }
}

/// The nearest character's start at or before `at`.
fn floor(text: &str, mut at: usize) -> usize {
    while at > 0 && !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_says_its_matches_as_javascript_counts() {
        let line = "let ключ = ключ + 1";
        let ranges = [(4, 12), (15, 23)];
        let matched = clipped(3, line.as_bytes(), &ranges);
        assert_eq!(matched.text, line);
        assert_eq!(matched.ranges, vec![(4, 8), (11, 15)]);
    }

    #[test]
    fn it_stops_once_no_one_hears() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..20 {
            std::fs::write(dir.path().join(format!("{n}.txt")), "needle\n").unwrap();
        }
        let ask = SearchAsk {
            query: "needle".to_owned(),
            ..SearchAsk::default()
        };
        let mut heard = 0;
        search(dir.path(), &matcher(&ask).unwrap(), 1000, &mut |_| {
            heard += 1;
            false
        });
        assert_eq!(heard, 1);
    }

    #[test]
    fn a_long_line_is_cut_around_its_first_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let matched = clipped(1, line.as_bytes(), &[(500, 506)]);
        assert!(matched.text.starts_with('…') && matched.text.ends_with('…'));
        let (from, to) = matched.ranges[0];
        let units: Vec<u16> = matched.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[from as usize..to as usize]).unwrap(),
            "needle"
        );
    }
}
