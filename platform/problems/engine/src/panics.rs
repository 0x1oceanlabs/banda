//! The engine's own panics (ADR 0039, decision 1). A panic hook cannot
//! wait for the store, so it adds the Problem to a file in the module's
//! folder and says so; the module takes them in then, and as it opens,
//! for the panics of the run before.

use crate::model::{Frame, Record, Source};
use std::backtrace::Backtrace;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use tokio::sync::Notify;

/// Told after each panic is in the file.
pub static PANICKED: Notify = Notify::const_new();

const FILE: &str = "panics.jsonl";
const TAKING: &str = "panics.taking";

/// From now on, a panic anywhere in this program is kept as a Problem,
/// after the hook before it has said it.
pub fn catch(folder: PathBuf) {
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        before(info);
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|said| (*said).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic with no message".into());
        let mut frames = own(&Backtrace::force_capture().to_string());
        if frames.is_empty()
            && let Some(at) = info.location()
        {
            frames.push(Frame {
                file: relative(at.file()),
                function: String::new(),
                line: Some(at.line()),
            });
        }
        let record = Record {
            source: Source::Engine,
            kind: "panic".into(),
            message,
            frames,
        };
        // A panic that cannot be kept is still said by the hook before.
        if add(&folder, &record).is_ok() {
            PANICKED.notify_one();
        }
    }));
}

/// Keeps `record` beside the panics in `folder`: the module takes it in
/// as it opens, as a crash of the run before is (ADR 0086, decision 1).
pub fn add(folder: &Path, record: &Record) -> std::io::Result<()> {
    let mut file = append_private(&folder.join(FILE))?;
    writeln!(file, "{}", serde_json::to_string(record)?)
}

/// Opens `path` to add to, made first, with its folder, for this user
/// alone: a log or a panic may name the Person's files.
pub fn append_private(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let mut options = std::fs::File::options();
    options.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// The panics kept since the last time, taken out of their file.
pub fn take(folder: &Path) -> Vec<Record> {
    let taking = folder.join(TAKING);
    // A panic while this reads goes into a new file, for the next time.
    if std::fs::rename(folder.join(FILE), &taking).is_err() && !taking.exists() {
        return Vec::new();
    }
    let records = std::fs::File::open(&taking)
        .map(|file| {
            std::io::BufReader::new(file)
                .lines()
                .map_while(Result::ok)
                .filter_map(|line| serde_json::from_str(&line).ok())
                .collect()
        })
        .unwrap_or_default();
    let _ = std::fs::remove_file(&taking);
    records
}

/// Banda's own frames of a backtrace, as Rust prints one: a line
/// `  12: banda_git::checkpoint::follow`, then `at <file>:<line>:<column>`.
fn own(backtrace: &str) -> Vec<Frame> {
    let mut frames: Vec<Frame> = Vec::new();
    let mut ours = false;
    for line in backtrace.lines().map(str::trim) {
        if let Some((number, function)) = line.split_once(": ")
            && number.chars().all(|c| c.is_ascii_digit())
        {
            ours = function.starts_with("banda");
            if ours {
                frames.push(Frame {
                    file: String::new(),
                    function: unhashed(function).to_owned(),
                    line: None,
                });
            }
        } else if let Some(at) = line.strip_prefix("at ")
            && ours
            && let Some(frame) = frames.last_mut()
        {
            let mut parts = at.rsplitn(3, ':');
            let (_column, number, file) = (parts.next(), parts.next(), parts.next());
            frame.file = relative(file.unwrap_or(at));
            frame.line = number.and_then(|n| n.parse().ok());
        }
    }
    // The panic machinery's own frames come first, under Banda's name too.
    frames.retain(|frame| !frame.function.starts_with("banda_problems::panics"));
    frames
}

/// A function's name without the hash Rust adds: `::h0123456789abcdef`.
fn unhashed(function: &str) -> &str {
    match function.rsplit_once("::h") {
        Some((name, hash)) if hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit()) => {
            name
        }
        _ => function,
    }
}

/// The repository's root, where this crate was built.
pub(crate) fn root() -> Option<&'static Path> {
    Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3)
}

/// A source file from the repository's root, as every machine names it.
/// A backtrace names one under the working folder from there, `./…`.
fn relative(file: &str) -> String {
    let file = Path::new(file);
    let whole = match file.strip_prefix(".") {
        Ok(under) => std::env::current_dir().map(|here| here.join(under)).ok(),
        Err(_) => Some(file.to_owned()),
    };
    root()
        .zip(whole)
        .and_then(|(root, whole)| Some(whole.strip_prefix(root).ok()?.display().to_string()))
        .unwrap_or_else(|| file.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backtrace_gives_banda_s_own_frames_from_the_repository_root() {
        let root = root().unwrap();
        let backtrace = format!(
            "   0: std::backtrace::Backtrace::force_capture
             at /rustc/abc/library/std/src/backtrace.rs:331:13
   1: banda_problems::panics::catch::{{{{closure}}}}::h0123456789abcdef
             at {root}/platform/problems/engine/src/panics.rs:20:9
   2: banda_git::checkpoint::follow::h0123456789abcdef
             at {root}/apps/git/engine/src/checkpoint.rs:40:5
   3: tokio::runtime::task::harness::poll
             at /home/x/.cargo/registry/src/tokio/harness.rs:1:1",
            root = root.display()
        );
        assert_eq!(
            own(&backtrace),
            [Frame {
                file: "apps/git/engine/src/checkpoint.rs".into(),
                function: "banda_git::checkpoint::follow".into(),
                line: Some(40),
            }]
        );
    }

    #[test]
    fn a_file_under_the_working_folder_is_named_from_the_repository_root() {
        // Tests run in the crate's folder.
        assert_eq!(
            relative("./src/panics.rs"),
            "platform/problems/engine/src/panics.rs"
        );
        assert_eq!(relative("/elsewhere/x.rs"), "/elsewhere/x.rs");
    }

    #[test]
    fn panics_kept_in_the_file_are_taken_once() {
        let folder = tempfile::tempdir().unwrap();
        let record = Record {
            source: Source::Engine,
            kind: "panic".into(),
            message: "boom".into(),
            frames: vec![],
        };
        add(folder.path(), &record).unwrap();
        add(folder.path(), &record).unwrap();
        assert_eq!(take(folder.path()).len(), 2);
        assert!(take(folder.path()).is_empty());
    }
}
