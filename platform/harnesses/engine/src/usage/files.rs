//! Bounded journal reads. A partial final line is retried next time;
//! offsets and parser state are committed together with their records.
use super::journal::{self, Codex, Record};
use crate::limits::Kind;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const LINE: u64 = 16 * 1024 * 1024;
const BATCH: u64 = 32 * 1024 * 1024;
const ANCHOR: u64 = 128;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct Cursor {
    pub offset: u64,
    pub codex: Codex,
    pub anchor: u64,
    pub prefix: u64,
    pub modified: u128,
    pub length: u64,
    #[serde(default)]
    pub skipped: usize,
}

pub(super) struct Batch {
    pub cursor: Cursor,
    pub records: Vec<Record>,
    pub reset: bool,
    pub skipped: usize,
    pub pending: bool,
}

/// Symlink directories are not followed: no loops or accidental scans
/// outside the configured journal root. An explicitly selected root may
/// itself be a symlink and is canonicalized before this walk.
pub(super) fn discover(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut pending = vec![root.to_owned()];
    let mut files = Vec::new();
    while let Some(folder) = pending.pop() {
        for entry in std::fs::read_dir(folder)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() && entry.path().extension().is_some_and(|ext| ext == "jsonl") {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    Ok(files)
}

// Only fingerprints are saved; no journal text enters the store.
fn fingerprint(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hash);
    hash.finish()
}

fn bytes(file: &mut File, offset: u64, size: u64) -> io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(offset))?;
    let mut out = Vec::new();
    file.take(size).read_to_end(&mut out)?;
    Ok(out)
}

pub(super) fn read(path: &Path, kind: Kind, mut cursor: Cursor) -> io::Result<Batch> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    let length = metadata.len();
    let modified = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let prefix = bytes(&mut file, 0, cursor.offset.min(ANCHOR))?;
    let anchor = bytes(
        &mut file,
        cursor.offset.saturating_sub(ANCHOR),
        cursor.offset.min(ANCHOR),
    )?;
    let reset = cursor.offset > 0
        && (length < cursor.offset
            || fingerprint(&prefix) != cursor.prefix
            || fingerprint(&anchor) != cursor.anchor
            || (length == cursor.length && modified != cursor.modified));
    if reset {
        cursor = Cursor::default();
    }
    let start = cursor.offset;
    file.seek(SeekFrom::Start(start))?;
    let mut reader = BufReader::new(file);
    let mut records = Vec::new();
    let mut skipped = cursor.skipped;
    let mut pending = false;
    loop {
        let mut line = Vec::new();
        // Bound allocations even for a damaged line without a newline.
        let count = reader
            .by_ref()
            .take(LINE + 1)
            .read_until(b'\n', &mut line)?;
        if count == 0 {
            break;
        }
        if count as u64 > LINE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "journal line exceeds 16 MiB",
            ));
        }
        if line.last() != Some(&b'\n') {
            pending = true;
            break;
        }
        let offset = cursor.offset;
        cursor.offset += count as u64;
        match serde_json::from_slice(&line) {
            Ok(value) => {
                let record = match kind {
                    Kind::Claude => {
                        journal::claude(&value).or_else(|| journal::claude_prompt(&value, offset))
                    }
                    Kind::Codex => cursor.codex.read(&value, offset),
                };
                if let Some(mut record) = record {
                    if record.session.is_empty() {
                        record.session = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned();
                    }
                    record.key = serde_json::to_string(&(&record.session, &record.key))
                        .expect("strings serialize");
                    records.push(record);
                }
            }
            Err(_) => skipped = skipped.saturating_add(1),
        }
        if cursor.offset - start >= BATCH {
            pending = cursor.offset < length;
            break;
        }
    }
    let mut file = reader.into_inner();
    cursor.anchor = fingerprint(&bytes(
        &mut file,
        cursor.offset.saturating_sub(ANCHOR),
        cursor.offset.min(ANCHOR),
    )?);
    cursor.prefix = fingerprint(&bytes(&mut file, 0, cursor.offset.min(ANCHOR))?);
    cursor.modified = modified;
    cursor.length = length;
    cursor.skipped = skipped;
    Ok(Batch {
        cursor,
        records,
        reset,
        skipped,
        pending,
    })
}
