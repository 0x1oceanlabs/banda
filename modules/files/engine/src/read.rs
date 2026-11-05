//! `files.stat` and `files.read`: what a path is, and a file's text (ADR
//! 0073, decision 4). Bytes past the text go through the window's file
//! host, not here (decision 5).

use crate::list::modified;
use crate::model::{Kind, Stat, Text};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

/// What `files.read` reads unless asked otherwise: 1 MiB.
pub const UPTO: u64 = 1024 * 1024;
/// The most it reads, whatever is asked: 16 MiB.
pub const MOST: u64 = 16 * 1024 * 1024;
/// How much of a file's start shows whether it is binary.
const HEAD: usize = 8 * 1024;

/// What `path` is, or none when it is gone.
pub fn stat(path: &Path) -> Option<Stat> {
    let meta = std::fs::metadata(path).ok()?;
    let folder = meta.is_dir();
    Some(Stat {
        path: path.to_string_lossy().into_owned(),
        kind: if folder { Kind::Folder } else { Kind::File },
        size: (!folder).then_some(meta.len()),
        modified: modified(&meta),
        mime: (!folder).then(|| mime(path)),
    })
}

/// A file's kind of content: by its extension, else by its first bytes,
/// else text when they read as text.
fn mime(path: &Path) -> String {
    if let Some(guess) = mime_guess::from_path(path).first() {
        return guess.essence_str().to_owned();
    }
    let Ok(head) = head(path) else {
        return "application/octet-stream".to_owned();
    };
    if let Some(kind) = infer::get(&head) {
        return kind.mime_type().to_owned();
    }
    if binary(&head, true) {
        "application/octet-stream".to_owned()
    } else {
        "text/plain".to_owned()
    }
}

/// The first [`HEAD`] bytes of a file.
fn head(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut head = Vec::with_capacity(HEAD);
    std::fs::File::open(path)?
        .take(HEAD as u64)
        .read_to_end(&mut head)?;
    Ok(head)
}

/// Whether bytes are no text: a NUL in the first [`HEAD`], or not UTF-8.
/// `cut` says the bytes may end inside a character, which is no fault.
fn binary(bytes: &[u8], cut: bool) -> bool {
    if bytes[..bytes.len().min(HEAD)].contains(&0) {
        return true;
    }
    match std::str::from_utf8(bytes) {
        Ok(_) => false,
        // Only the end is cut short: the rest reads.
        Err(error) => !(cut && error.error_len().is_none()),
    }
}

/// The text of the file at `path`, its first `upto` bytes at most.
pub fn read(path: &Path, upto: u64) -> std::io::Result<Text> {
    let mut file = std::fs::File::open(path)?;
    let meta = file.metadata()?;
    if meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::IsADirectory,
            "a folder",
        ));
    }
    let upto = upto.min(MOST);
    let mut bytes = Vec::new();
    // One byte past, to know whether there is more.
    (&mut file).take(upto + 1).read_to_end(&mut bytes)?;
    let read = bytes.len() as u64;
    let truncated = read > upto;
    let mut hash = None;
    if truncated {
        bytes.truncate(upto as usize);
    } else {
        hash = Some(hex(&Sha256::digest(&bytes)));
    }
    let binary = binary(&bytes, truncated);
    let text = (!binary).then(|| {
        let whole = match std::str::from_utf8(&bytes) {
            Ok(_) => bytes.len(),
            Err(error) => error.valid_up_to(),
        };
        bytes.truncate(whole);
        String::from_utf8(bytes).unwrap_or_default()
    });
    Ok(Text {
        path: path.to_string_lossy().into_owned(),
        text,
        binary,
        truncated,
        // Read whole, it is what was read; else what the system says,
        // which a file growing meanwhile may have passed.
        bytes: if truncated {
            meta.len().max(read)
        } else {
            read
        },
        hash,
    })
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02x}");
        hex
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_long_text_is_cut_before_a_character_not_inside_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cyrillic.txt");
        // Each letter is two bytes: 5 bytes end inside the third.
        std::fs::write(&path, "абвгд").unwrap();
        let text = read(&path, 5).unwrap();
        assert_eq!(text.text.as_deref(), Some("аб"));
        assert!(text.truncated && !text.binary);
        assert_eq!(text.bytes, 10);
        assert_eq!(text.hash, None, "a file read in part has no hash");
    }

    #[test]
    fn a_whole_text_comes_with_its_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "abc").unwrap();
        let text = read(&path, UPTO).unwrap();
        assert_eq!(text.text.as_deref(), Some("abc"));
        assert!(!text.truncated && !text.binary);
        assert_eq!(
            text.hash.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
    }

    #[test]
    fn a_nul_or_bytes_that_are_not_utf8_make_it_binary() {
        let dir = tempfile::tempdir().unwrap();
        for (name, bytes) in [("nul", &b"ab\0cd"[..]), ("latin1", &b"caf\xe9 au lait"[..])] {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            let text = read(&path, UPTO).unwrap();
            assert!(text.binary, "{name}");
            assert_eq!(text.text, None, "{name}");
            assert!(text.hash.is_some(), "{name}");
        }
    }

    #[test]
    fn a_kind_is_read_from_the_extension_then_the_first_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        for (name, bytes, mime) in [
            ("notes.md", &b"# hi"[..], "text/markdown"),
            ("picture", &png[..], "image/png"),
            ("LICENSE", &b"Apache"[..], "text/plain"),
            ("blob", &b"\0\x01\x02"[..], "application/octet-stream"),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(stat(&path).unwrap().mime.as_deref(), Some(mime), "{name}");
        }
        assert_eq!(stat(&dir.path().join("gone")), None);
        let folder = stat(dir.path()).unwrap();
        assert_eq!((folder.kind, folder.mime), (Kind::Folder, None));
    }
}
