//! The lines of untracked files, as the status counts them: each a file
//! the Diff's Uncommitted shows as added, its lines added too. `git.watch`
//! reads the status every few seconds, so a file is read once, then again
//! only when its size or time changed. A binary file counts as a file
//! alone, told as git tells one by its first bytes, though git reads the
//! repository's `.gitattributes` too and this does not; so does one past
//! [`FILE`], which the Diff counts and this leaves at 0.

use crate::diff::{FILE, SNIFF, binary};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

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
    /// The files of `paths` in the work tree at `top` counted, each read
    /// again only where it changed since `self` counted it: these alone.
    pub async fn count(self, top: PathBuf, paths: Vec<String>) -> Counted {
        let counting = tokio::task::spawn_blocking(move || {
            let counted = paths.into_iter().filter_map(|path| {
                let count = count(&top.join(&path), self.0.get(&path))?;
                Some((path, count))
            });
            Counted(counted.collect())
        });
        counting.await.unwrap_or_default()
    }

    /// The lines of the file at `path`; 0 when none were counted.
    pub fn lines(&self, path: &str) -> u32 {
        self.0.get(path).and_then(|c| c.lines).unwrap_or(0)
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
        true => std::fs::File::open(file).ok().and_then(lines_of),
        false => None,
    };
    Some(Count {
        len,
        modified,
        lines,
    })
}

/// How many lines `from` has, as `--numstat` counts a new file's: a last
/// line with no newline counts too. None when it is binary.
fn lines_of(mut from: impl Read) -> Option<u32> {
    let mut buffer = vec![0; SNIFF.max(64 * 1024)];
    // Its first bytes say whether it is binary.
    let mut head = 0;
    while head < SNIFF {
        match from.read(&mut buffer[head..SNIFF]).ok()? {
            0 => break,
            read => head += read,
        }
    }
    if binary(&buffer[..head]) {
        return None;
    }
    let ends = |bytes: &[u8]| bytes.iter().filter(|b| **b == b'\n').count();
    let mut lines = ends(&buffer[..head]);
    let mut last = buffer[..head].last().copied();
    loop {
        match from.read(&mut buffer).ok()? {
            0 => break,
            read => {
                lines += ends(&buffer[..read]);
                last = Some(buffer[read - 1]);
            }
        }
    }
    let open = last.is_some_and(|b| b != b'\n');
    u32::try_from(lines + usize::from(open)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_count_as_numstat_counts_a_new_file() {
        assert_eq!(lines_of(&b""[..]), Some(0));
        assert_eq!(lines_of(&b"one\ntwo\n"[..]), Some(2));
        assert_eq!(lines_of(&b"one\ntwo"[..]), Some(2));
        assert_eq!(lines_of(&b"\x89PNG\0\0"[..]), None);
        // Past the bytes that say it is text, its lines count all the same.
        let long = "x\n".repeat(SNIFF);
        assert_eq!(lines_of(long.as_bytes()), Some(SNIFF as u32));
    }

    #[tokio::test]
    async fn a_file_is_read_again_only_once_it_changed() {
        let root = tempfile::tempdir().unwrap();
        let top = root.path().to_path_buf();
        std::fs::write(top.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(top.join("big.txt"), "x\n".repeat(FILE)).unwrap();
        let paths = vec!["a.txt".to_owned(), "big.txt".to_owned(), "gone".to_owned()];
        let counted = Counted::default().count(top.clone(), paths).await;
        assert_eq!(
            ["a.txt", "big.txt", "gone"].map(|p| counted.lines(p)),
            [2, 0, 0]
        );
        assert_eq!(counted.0.len(), 2, "a file that is gone is not kept");

        // Kept as it was counted, its lines are not read again.
        let mut counted = counted;
        counted.0.get_mut("a.txt").unwrap().lines = Some(7);
        let counted = counted.count(top.clone(), vec!["a.txt".into()]).await;
        assert_eq!(counted.lines("a.txt"), 7);
        assert_eq!(counted.0.len(), 1, "only the paths asked are kept");

        std::fs::write(top.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        let counted = counted.count(top, vec!["a.txt".into()]).await;
        assert_eq!(counted.lines("a.txt"), 3);
    }
}
