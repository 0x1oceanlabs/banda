//! The lines of untracked files, as the status counts them: each a file
//! the Diff shows as added, its lines added too. `git.watch` reads the
//! status every few seconds, so a file is read once, then again only when
//! its size or time changed; a binary file, or one past [`FILE`], counts
//! as a file alone, as git counts a binary one.

use crate::diff::FILE;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// How far into a file git looks for a NUL byte to call it binary.
const SNIFF: usize = 8000;

/// The untracked files as last counted, by path from the top.
#[derive(Default)]
pub struct Counted(HashMap<String, Count>);

/// A file as it was counted: its size and time, and its lines, none when
/// it is binary, too large, or no plain file.
#[derive(Clone)]
struct Count {
    len: u64,
    modified: Option<SystemTime>,
    lines: Option<u32>,
}

impl Counted {
    /// The lines of each of `paths` in the work tree at `top`, read again
    /// only where a file changed since `self` counted it. What it counted
    /// is the next one's `self`, of these paths alone.
    pub async fn count(self, top: PathBuf, paths: Vec<String>) -> (Counted, Vec<u32>) {
        let before = self;
        let counting = tokio::task::spawn_blocking(move || {
            let mut now = HashMap::with_capacity(paths.len());
            let lines = paths
                .into_iter()
                .map(|path| {
                    let count = count(&top.join(&path), before.0.get(&path));
                    let lines = count.as_ref().and_then(|c| c.lines).unwrap_or(0);
                    if let Some(count) = count {
                        now.insert(path, count);
                    }
                    lines
                })
                .collect();
            (Counted(now), lines)
        });
        counting.await.unwrap_or_default()
    }
}

/// The file at `file`: `kept` when its size and time are the same; none
/// when it is gone.
fn count(file: &Path, kept: Option<&Count>) -> Option<Count> {
    let about = std::fs::symlink_metadata(file).ok()?;
    let (len, modified) = (about.len(), about.modified().ok());
    if let Some(kept) = kept
        && kept.len == len
        && kept.modified == modified
        && modified.is_some()
    {
        return Some(kept.clone());
    }
    let lines = match about.is_file() && len <= FILE as u64 {
        true => lines_of(file),
        false => None,
    };
    Some(Count {
        len,
        modified,
        lines,
    })
}

/// How many lines `file` has, as `--numstat` counts a new file's: a last
/// line with no newline counts too. None when it is binary.
fn lines_of(file: &Path) -> Option<u32> {
    let mut bytes = Vec::new();
    std::fs::File::open(file)
        .ok()?
        .take(FILE as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    lines_in(&bytes)
}

/// The lines in `bytes`; none when they are binary, as git tells.
fn lines_in(bytes: &[u8]) -> Option<u32> {
    if bytes[..bytes.len().min(SNIFF)].contains(&0) {
        return None;
    }
    let ends = bytes.iter().filter(|b| **b == b'\n').count();
    let open = bytes.last().is_some_and(|b| *b != b'\n');
    u32::try_from(ends + usize::from(open)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_count_as_numstat_counts_a_new_file() {
        assert_eq!(lines_in(b""), Some(0));
        assert_eq!(lines_in(b"one\ntwo\n"), Some(2));
        assert_eq!(lines_in(b"one\ntwo"), Some(2));
        assert_eq!(lines_in(b"\x89PNG\0\0"), None);
    }

    #[tokio::test]
    async fn a_file_is_read_again_only_once_it_changed() {
        let root = tempfile::tempdir().unwrap();
        let top = root.path().to_path_buf();
        std::fs::write(top.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(top.join("big.txt"), "x\n".repeat(FILE)).unwrap();
        let paths = vec!["a.txt".to_owned(), "big.txt".to_owned(), "gone".to_owned()];
        let (counted, lines) = Counted::default().count(top.clone(), paths).await;
        assert_eq!(lines, [2, 0, 0]);
        assert_eq!(counted.0.len(), 2, "a file that is gone is not kept");

        // Kept as it was counted, its lines are not read again.
        let mut counted = counted;
        counted.0.get_mut("a.txt").unwrap().lines = Some(7);
        let (counted, lines) = counted.count(top.clone(), vec!["a.txt".into()]).await;
        assert_eq!(lines, [7]);
        assert_eq!(counted.0.len(), 1, "only the paths asked are kept");

        std::fs::write(top.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        let (_, lines) = counted.count(top, vec!["a.txt".into()]).await;
        assert_eq!(lines, [3]);
    }
}
