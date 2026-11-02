//! What git prints, read: `status --porcelain=2 -z`, `--numstat -z` and
//! `log -z`.

use crate::model::{Change, Changed, Commit, FileDiff};

/// What `status --porcelain=2 --branch -z` says.
#[derive(Debug, Default, PartialEq)]
pub struct Porcelain {
    pub head: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// Its changes, each line's counts 0 until `--numstat` gives them.
    pub files: Vec<Changed>,
}

/// Reads `status --porcelain=2 --branch -z`.
pub fn porcelain(out: &[u8]) -> Porcelain {
    let text = String::from_utf8_lossy(out);
    let mut said = Porcelain::default();
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => said.head = Some(value.to_owned()),
                "branch.head" if value != "(detached)" => said.branch = Some(value.to_owned()),
                "branch.upstream" => said.upstream = Some(value.to_owned()),
                "branch.ab" => {
                    let mut counts = value.split(' ');
                    let mut count = |sign: char| {
                        counts
                            .next()
                            .and_then(|c| c.strip_prefix(sign))
                            .and_then(|c| c.parse().ok())
                    };
                    said.ahead = count('+');
                    said.behind = count('-');
                }
                _ => {}
            }
            continue;
        }
        let (kind, rest) = record.split_at(1);
        let rest = rest.strip_prefix(' ').unwrap_or(rest);
        // How many fields a record has, its path the last, which may hold
        // spaces:
        // 1 XY sub mH mI mW hH hI path
        // 2 XY sub mH mI mW hH hI Xscore path, then its old path
        // u XY sub m1 m2 m3 mW h1 h2 h3 path
        let fields = match kind {
            "?" => {
                said.files
                    .push(file(rest, None, Change::Untracked, Some(false)));
                continue;
            }
            "1" => 8,
            "2" => 9,
            "u" => 10,
            _ => continue,
        };
        let (x, y) = letters(rest);
        let Some(path) = rest.splitn(fields, ' ').last() else {
            continue;
        };
        let changed = match kind {
            "1" => {
                let status = if x == 'A' {
                    Change::Added
                } else if x == 'D' || y == 'D' {
                    Change::Deleted
                } else {
                    Change::Modified
                };
                file(path, None, status, staged(x, y))
            }
            "2" => {
                let old = records.next().map(str::to_owned);
                let score = rest.split(' ').nth(7).unwrap_or_default();
                match score.starts_with('C') {
                    true => file(path, None, Change::Added, staged(x, y)),
                    false => file(path, old, Change::Renamed, staged(x, y)),
                }
            }
            _ => file(path, None, Change::Conflicted, None),
        };
        said.files.push(changed);
    }
    said
}

/// A record's `XY`: how the index and the work tree changed it.
fn letters(xy: &str) -> (char, char) {
    let mut letters = xy.chars();
    (letters.next().unwrap_or('.'), letters.next().unwrap_or('.'))
}

/// Whether a change is all in the index, none of it, or a part.
fn staged(x: char, y: char) -> Option<bool> {
    match (x, y) {
        ('.', _) => Some(false),
        (_, '.') => Some(true),
        _ => None,
    }
}

fn file(path: &str, old_path: Option<String>, status: Change, staged: Option<bool>) -> Changed {
    Changed {
        path: path.to_owned(),
        old_path,
        status,
        staged,
        added: 0,
        removed: 0,
    }
}

/// Reads `--numstat -z`: `added\tremoved\tpath`, or for a rename
/// `added\tremoved\t`, then the old path and the new; `-` for a binary
/// file's counts.
pub fn numstat(out: &[u8]) -> Vec<FileDiff> {
    let text = String::from_utf8_lossy(out);
    let mut records = text.split('\0');
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        let mut fields = record.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let (path, old_path) = match path {
            "" => {
                let old = records.next().unwrap_or_default().to_owned();
                (records.next().unwrap_or_default().to_owned(), Some(old))
            }
            path => (path.to_owned(), None),
        };
        let binary = added == "-" && removed == "-";
        files.push(FileDiff {
            path,
            old_path,
            added: added.parse().unwrap_or(0),
            removed: removed.parse().unwrap_or(0),
            binary,
        });
    }
    files
}

/// The fields `log` is asked for, one per NUL, in this order.
pub const LOG_FORMAT: &str = "--format=%H%x00%h%x00%s%x00%an%x00%ct";
/// The most characters of a subject kept.
const SUBJECT: usize = 300;

/// Reads `log -z` with [`LOG_FORMAT`].
pub fn log(out: &[u8]) -> Vec<Commit> {
    let text = String::from_utf8_lossy(out);
    let fields: Vec<&str> = text.trim_end_matches('\0').split('\0').collect();
    let (commits, _) = fields.as_chunks::<5>();
    commits
        .iter()
        .map(|[sha, short, subject, author, time]| Commit {
            sha: sha.trim_start_matches('\n').to_owned(),
            short: (*short).to_owned(),
            subject: subject.chars().take(SUBJECT).collect(),
            author: (*author).to_owned(),
            time: time.trim().parse().unwrap_or(0),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_reads_the_branch_and_each_kind_of_change() {
        let out = [
            "# branch.oid 1111111111111111111111111111111111111111",
            "# branch.head feature",
            "# branch.upstream origin/feature",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa aaa a b.txt",
            "1 M. N... 100644 100644 100644 aaa bbb staged.txt",
            "1 MM N... 100644 100644 100644 aaa bbb both.txt",
            "1 D. N... 100644 000000 000000 aaa 000 gone.txt",
            "2 R. N... 100644 100644 100644 aaa aaa R100 new name.txt",
            "old name.txt",
            "u UU N... 100644 100644 100644 100644 a b c fought.txt",
            "? new/",
            "",
        ]
        .join("\0");
        let said = porcelain(out.as_bytes());
        assert_eq!(said.branch.as_deref(), Some("feature"));
        assert_eq!(said.upstream.as_deref(), Some("origin/feature"));
        assert_eq!((said.ahead, said.behind), (Some(2), Some(1)));
        let seen: Vec<(&str, Change, Option<bool>)> = said
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.status, f.staged))
            .collect();
        assert_eq!(
            seen,
            [
                ("a b.txt", Change::Modified, Some(false)),
                ("staged.txt", Change::Modified, Some(true)),
                ("both.txt", Change::Modified, None),
                ("gone.txt", Change::Deleted, Some(true)),
                ("new name.txt", Change::Renamed, Some(true)),
                ("fought.txt", Change::Conflicted, None),
                ("new/", Change::Untracked, Some(false)),
            ]
        );
        assert_eq!(said.files[4].old_path.as_deref(), Some("old name.txt"));
    }

    #[test]
    fn porcelain_before_the_first_commit_and_detached_has_no_head_or_branch() {
        let said = porcelain(b"# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!((said.head, said.branch), (None, None));
    }

    #[test]
    fn numstat_reads_renames_and_binary_files() {
        let out = b"3\t1\ta.txt\0-\t-\tlogo.png\x000\t0\t\0old.txt\0new.txt\0";
        let files = numstat(out);
        assert_eq!(files.len(), 3);
        assert_eq!((files[0].added, files[0].removed), (3, 1));
        assert!(files[1].binary);
        assert_eq!(files[2].path, "new.txt");
        assert_eq!(files[2].old_path.as_deref(), Some("old.txt"));
    }
}
