//! `files.list`: one folder's names, folders first, with what git ignores
//! marked as T3 Code marks it (ADR 0073, decision 3).

use crate::model::{Entry, Kind};
use std::cmp::Ordering;
use std::fs::Metadata;
use std::path::Path;
use std::process::Stdio;
use std::time::UNIX_EPOCH;
use tokio::io::AsyncWriteExt;

/// How many names one `git check-ignore` is asked about.
const CHUNK: usize = 1000;

/// The names in `dir`, unsorted and not yet marked ignored.
pub fn read(dir: &Path) -> std::io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for found in std::fs::read_dir(dir)? {
        let Ok(found) = found else { continue };
        let name = found.file_name().to_string_lossy().into_owned();
        let Ok(own) = found.path().symlink_metadata() else {
            continue;
        };
        let link = own.file_type().is_symlink();
        // A link's size and time are what it leads to, when it leads
        // somewhere.
        let meta = if link {
            std::fs::metadata(found.path()).ok()
        } else {
            Some(own)
        };
        let to_folder = link && meta.as_ref().is_some_and(Metadata::is_dir);
        let kind = match &meta {
            _ if link => Kind::Link,
            Some(meta) if meta.is_dir() => Kind::Folder,
            _ => Kind::File,
        };
        let size = meta.as_ref().filter(|m| !m.is_dir()).map(Metadata::len);
        entries.push(Entry {
            hidden: name.starts_with('.'),
            name,
            kind,
            to_folder,
            size,
            modified: meta.as_ref().and_then(modified),
            ignored: false,
        });
    }
    Ok(entries)
}

/// When it last changed, in ms since the Unix epoch.
pub fn modified(meta: &Metadata) -> Option<i64> {
    let since = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}

/// Folders first, then the rest, each by [`natural`] name.
pub fn sort(entries: &mut [Entry]) {
    let folder = |entry: &Entry| entry.kind == Kind::Folder || entry.to_folder;
    entries.sort_by(|a, b| {
        (folder(b).cmp(&folder(a)))
            .then_with(|| natural(&a.name, &b.name))
            .then_with(|| a.name.cmp(&b.name))
    });
}

/// Names as a person reads them: any case, and the numbers in them by
/// their value, so `2` comes before `10`.
pub fn natural(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let number = |chars: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut digits = String::new();
                    while let Some(digit) = chars.next_if(char::is_ascii_digit) {
                        digits.push(digit);
                    }
                    digits.trim_start_matches('0').to_owned()
                };
                let (x, y) = (number(&mut a), number(&mut b));
                let by_value = x.len().cmp(&y.len()).then_with(|| x.cmp(&y));
                if by_value != Ordering::Equal {
                    return by_value;
                }
            }
            (Some(x), Some(y)) => {
                let by_letter = x.to_lowercase().cmp(y.to_lowercase());
                if by_letter != Ordering::Equal {
                    return by_letter;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Marks the entries of `dir` that git ignores. Nothing is marked outside a
/// work tree, or when git is not there; `.git` itself is not asked about.
pub async fn mark_ignored(dir: &Path, entries: &mut [Entry]) {
    let asked: Vec<usize> = (0..entries.len())
        .filter(|&at| entries[at].name != ".git")
        .collect();
    for chunk in asked.chunks(CHUNK) {
        let names: Vec<&str> = chunk.iter().map(|&at| entries[at].name.as_str()).collect();
        let Some(ignored) = check_ignore(dir, &names).await else {
            return;
        };
        for &at in chunk {
            if ignored.contains(entries[at].name.as_str()) {
                entries[at].ignored = true;
            }
        }
    }
}

/// The names of `names` in `dir` that git ignores; none when `dir` is in
/// no work tree.
async fn check_ignore(dir: &Path, names: &[&str]) -> Option<std::collections::HashSet<String>> {
    let mut input = Vec::new();
    for name in names {
        input.extend_from_slice(name.as_bytes());
        input.push(0);
    }
    let mut git = tokio::process::Command::new("git")
        .args([
            "-c",
            "core.fsmonitor=false",
            "check-ignore",
            "-z",
            "--stdin",
        ])
        .current_dir(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let mut stdin = git.stdin.take()?;
    // Written beside the read, so a full pipe keeps neither waiting.
    let writing = tokio::spawn(async move {
        let _ = stdin.write_all(&input).await;
    });
    let out = git.wait_with_output().await.ok()?;
    let _ = writing.await;
    // 0: some are ignored; 1: none is; anything else: no work tree here.
    match out.status.code() {
        Some(0) => {}
        Some(1) => return Some(Default::default()),
        _ => return None,
    }
    let said = out.stdout.split(|byte| *byte == 0);
    Some(
        said.filter(|name| !name.is_empty())
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_read_by_their_value_and_letters_in_any_case() {
        let mut names = ["b10", "B2", "a", "b1", "_x", "B02x", "README", "readme"];
        names.sort_by(|a, b| natural(a, b).then_with(|| a.cmp(b)));
        assert_eq!(
            names,
            ["_x", "a", "b1", "B2", "B02x", "b10", "README", "readme"]
        );
    }
}
