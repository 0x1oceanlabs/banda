//! `files.find`: fuzzy paths under a folder (ADR 0073, decision 11). It
//! walks with ripgrep's `ignore`, which leaves out what `.gitignore` does,
//! and matches with `nucleo`, Helix's and Zed's matcher, a match in a
//! file's name above one in its folders. What the Person opened lately is
//! to rank higher too, once Files keeps it.

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The paths answered unless asked otherwise, and the most.
pub const LIMIT: u32 = 50;
pub const MOST: u32 = 200;
/// The most files one walk takes.
const WALKED: usize = 100_000;
/// How long one walk answers the searches typed after it.
const FRESH: Duration = Duration::from_secs(5);

/// The files under one folder, as one walk found them.
pub struct Walked {
    /// From the folder, with `/` between names.
    paths: Vec<String>,
    /// Whether the walk stopped at [`WALKED`].
    pub cut: bool,
}

/// Each folder's last walk, so the searches typed one letter after
/// another do not each walk it again.
#[derive(Default)]
pub struct Walks(Mutex<HashMap<PathBuf, (Instant, Arc<Walked>)>>);

impl Walks {
    /// The files under `dir`, walked at most [`FRESH`] ago.
    pub fn of(&self, dir: &Path) -> Arc<Walked> {
        let held = |walks: &Self| {
            let mut kept = walks.0.lock().unwrap_or_else(|p| p.into_inner());
            kept.retain(|_, (when, _)| when.elapsed() < FRESH);
            kept.get(dir).map(|(_, walked)| walked.clone())
        };
        if let Some(walked) = held(self) {
            return walked;
        }
        let walked = Arc::new(walk(dir, WALKED));
        let mut kept = self.0.lock().unwrap_or_else(|p| p.into_inner());
        kept.insert(dir.to_path_buf(), (Instant::now(), walked.clone()));
        walked
    }
}

/// The files under `dir`, at most `most`: hidden ones too, but not what
/// a `.gitignore` or `.ignore` leaves out, nor `.git`.
fn walk(dir: &Path, most: usize) -> Walked {
    let walker = ignore::WalkBuilder::new(dir)
        .hidden(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build();
    let mut paths = Vec::new();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if paths.len() == most {
            return Walked { paths, cut: true };
        }
        if let Ok(relative) = entry.path().strip_prefix(dir) {
            let path = relative.to_string_lossy();
            paths.push(if std::path::MAIN_SEPARATOR == '/' {
                path.into_owned()
            } else {
                path.replace(std::path::MAIN_SEPARATOR, "/")
            });
        }
    }
    Walked { paths, cut: false }
}

/// The paths of `walked` that match `query`, best first, at most `limit`:
/// those whose name matches before those whose folders do, each by
/// nucleo's score, then the shorter.
pub fn matching(walked: &Walked, query: &str, limit: usize) -> Vec<String> {
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut buffer = Vec::new();
    let mut found: Vec<(u8, std::cmp::Reverse<u32>, usize, &str)> = Vec::new();
    for path in &walked.paths {
        let name = path.rsplit('/').next().unwrap_or(path);
        let score = |text: &str, matcher: &mut Matcher, buffer: &mut Vec<char>| {
            pattern.score(Utf32Str::new(text, buffer), matcher)
        };
        let ranked = match score(name, &mut matcher, &mut buffer) {
            Some(score) => (0, score),
            None => match score(path, &mut matcher, &mut buffer) {
                Some(score) => (1, score),
                None => continue,
            },
        };
        found.push((ranked.0, std::cmp::Reverse(ranked.1), path.len(), path));
    }
    if found.len() > limit {
        found.select_nth_unstable(limit);
        found.truncate(limit);
    }
    found.sort_unstable();
    found
        .into_iter()
        .map(|(.., path)| path.to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn walked(paths: &[&str]) -> Walked {
        Walked {
            paths: paths.iter().map(|path| (*path).to_owned()).collect(),
            cut: false,
        }
    }

    #[test]
    fn a_match_in_the_name_comes_before_one_in_the_folders() {
        let paths = walked(&[
            "main/notes.txt",
            "src/domain.rs",
            "src/main.rs",
            "docs/x.md",
        ]);
        assert_eq!(
            matching(&paths, "main", 50),
            ["src/main.rs", "src/domain.rs", "main/notes.txt"]
        );
    }

    #[test]
    fn letters_in_order_match_fuzzily_and_the_limit_holds() {
        let paths = walked(&["src/main.rs", "src/model.rs", "README.md"]);
        assert_eq!(matching(&paths, "mrs", 50)[0], "src/main.rs");
        assert_eq!(matching(&paths, "", 2).len(), 2);
    }

    #[test]
    fn a_walk_leaves_out_what_gitignore_does_and_git_itself() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for path in [
            ".gitignore",
            ".github/ci.yml",
            ".git/config",
            "built/out.js",
            "src/app.ts",
        ] {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        std::fs::write(root.join(".gitignore"), "built/\n").unwrap();
        let mut found = walk(root, 100).paths;
        found.sort();
        assert_eq!(found, [".github/ci.yml", ".gitignore", "src/app.ts"]);
        let cut = walk(root, 2);
        assert!(cut.cut && cut.paths.len() == 2);
    }
}
