//! The files in a Space's folder, for `@` in the composer (ADR 0010,
//! decision 9): the ones git keeps or would, in a folder git knows, or
//! else what a walk finds; never Bandaso's own.

use bandaso_kernel::DATA;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The most paths one search answers.
const MOST: usize = 50;
/// The most files a folder git does not know is walked for.
const WALKED: usize = 20_000;
/// Folders a walk does not go into: hidden ones, and what tools build.
const SKIPPED: [&str; 2] = ["node_modules", "target"];
/// How long one listing answers the searches a Person types after it.
const FRESH: Duration = Duration::from_secs(5);

/// A file under a Space's folder, and its path in lower case to search.
pub struct Entry {
    path: String,
    lower: String,
}

/// Each folder's last listing, so the searches typed one letter after
/// another do not each list the folder again.
#[derive(Default)]
pub struct Listings(Mutex<HashMap<PathBuf, Listing>>);

/// When a folder was listed, and what it held.
type Listing = (Instant, Arc<Vec<Entry>>);

impl Listings {
    /// The files under `folder`, listed at most [`FRESH`] ago.
    pub fn of(&self, folder: &Path) -> Arc<Vec<Entry>> {
        let mut kept = self.0.lock().unwrap();
        kept.retain(|_, (when, _)| when.elapsed() < FRESH);
        if let Some((_, entries)) = kept.get(folder) {
            return entries.clone();
        }
        let entries: Arc<Vec<Entry>> = Arc::new(
            listed(folder)
                .into_iter()
                .map(|path| Entry {
                    lower: path.to_lowercase(),
                    path,
                })
                .collect(),
        );
        kept.insert(folder.to_path_buf(), (Instant::now(), entries.clone()));
        entries
    }
}

/// The files under `folder`, as paths from it with `/` between names.
fn listed(folder: &Path) -> Vec<String> {
    let paths = git(folder).unwrap_or_else(|| walk(folder));
    // Bandaso's own data, not the Person's files.
    let data = format!("{DATA}/");
    paths
        .into_iter()
        .filter(|path| !path.starts_with(&data))
        .collect()
}

fn git(folder: &Path) -> Option<Vec<String>> {
    let out = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let paths = out.stdout.split(|byte| *byte == 0);
    Some(
        paths
            .filter(|path| !path.is_empty())
            .filter_map(|path| std::str::from_utf8(path).ok().map(str::to_owned))
            .collect(),
    )
}

fn walk(folder: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut folders = vec![folder.to_path_buf()];
    while let Some(next) = folders.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || SKIPPED.contains(&name.as_ref()) {
                continue;
            }
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => folders.push(path),
                Ok(kind) if kind.is_file() => {
                    if let Ok(relative) = path.strip_prefix(folder) {
                        found.push(relative.to_string_lossy().into_owned());
                    }
                    if found.len() >= WALKED {
                        return found;
                    }
                }
                _ => {}
            }
        }
    }
    found
}

/// The paths that hold `query`, in any case, best first: a file whose name
/// starts with it, then one whose name holds it, then one whose folders
/// do; the shorter path first among them. At most [`MOST`].
pub fn matching(entries: &[Entry], query: &str) -> Vec<String> {
    let wanted = query.to_lowercase();
    let mut found: Vec<(u8, usize, &str)> = entries
        .iter()
        .filter_map(|Entry { path, lower }| {
            let name = lower.rsplit('/').next().unwrap_or(lower);
            let rank = if name.starts_with(&wanted) {
                0
            } else if name.contains(&wanted) {
                1
            } else if lower.contains(&wanted) {
                2
            } else {
                return None;
            };
            Some((rank, path.len(), path.as_str()))
        })
        .collect();
    if found.len() > MOST {
        found.select_nth_unstable(MOST);
        found.truncate(MOST);
    }
    found.sort_unstable();
    found
        .into_iter()
        .map(|(_, _, path)| path.to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_that_starts_with_the_words_comes_first() {
        let paths = [
            "docs/readme.md",
            "src/main.rs",
            "src/domain.rs",
            "main/x.txt",
        ]
        .map(|path| Entry {
            path: path.to_owned(),
            lower: path.to_lowercase(),
        });
        assert_eq!(
            matching(&paths, "Main"),
            ["src/main.rs", "src/domain.rs", "main/x.txt"]
        );
    }

    #[test]
    fn a_walk_finds_the_files_but_not_the_hidden_or_built_ones() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        for path in ["notes.md", "src/app.ts", ".git/config", "node_modules/x.js"] {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        std::fs::create_dir_all(root.join(".bandaso/images")).unwrap();
        let mut found = walk(root);
        found.sort();
        assert_eq!(found, ["notes.md", "src/app.ts"]);
    }

    #[test]
    fn in_a_folder_git_knows_it_lists_what_git_keeps_or_would() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        let git = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .unwrap()
        };
        if !git(&["init", "-q"]).status.success() {
            return;
        }
        std::fs::write(root.join(".gitignore"), "built/\n").unwrap();
        std::fs::create_dir_all(root.join("built")).unwrap();
        std::fs::write(root.join("built/out.js"), "").unwrap();
        std::fs::create_dir_all(root.join(".bandaso/images")).unwrap();
        std::fs::write(root.join(".bandaso/images/a"), "").unwrap();
        std::fs::write(root.join("kept.md"), "").unwrap();
        let mut found = listed(root);
        found.sort();
        assert_eq!(found, [".gitignore", "kept.md"]);
    }
}
