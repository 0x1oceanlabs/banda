//! `files.stat` and `files.read`: what a path is, and a file's text (ADR
//! 0073, decision 4). Bytes past the text go through the window's file
//! host, not here (decision 5).

use crate::list::modified;
use crate::model::{Kind, Stat, Text};
use crate::shown;
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
        path: shown(path),
        kind: if folder { Kind::Folder } else { Kind::File },
        size: (!folder).then_some(meta.len()),
        modified: modified(&meta),
        mime: (!folder).then(|| mime(path)),
    })
}

/// A file's kind of content: by its extension, else by its first bytes,
/// else text when they read as text.
pub(crate) fn mime(path: &Path) -> String {
    if let Some(guess) = mime_guess::from_path(path).first() {
        return guess.essence_str().to_owned();
    }
    let Ok(head) = head(path) else {
        return "application/octet-stream".to_owned();
    };
    if let Some(kind) = infer::get(&head) {
        return kind.mime_type().to_owned();
    }
    match text_len(&head, true) {
        Some(_) => "text/plain".to_owned(),
        None => "application/octet-stream".to_owned(),
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

/// How many of `bytes` are text; none when they are binary: a NUL in
/// the first [`HEAD`], or not UTF-8. `cut` says they may end inside a
/// character, which is no fault: the text stops before it.
fn text_len(bytes: &[u8], cut: bool) -> Option<usize> {
    if bytes[..bytes.len().min(HEAD)].contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(_) => Some(bytes.len()),
        Err(error) if cut && error.error_len().is_none() => Some(error.valid_up_to()),
        Err(_) => None,
    }
}

/// The SHA-256 of `bytes`, in hex: what a file's text is known by, so a
/// write over it can tell it changed.
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// The text of the file at `path`, its first `upto` bytes at most.
pub fn read(path: &Path, upto: u64) -> std::io::Result<Text> {
    // Windows opens no folder as a file: it says access is denied.
    let file = std::fs::File::open(path).map_err(|error| match path.is_dir() {
        true => folder(),
        false => error,
    })?;
    read_from(file, path, upto)
}

fn folder() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::IsADirectory, "a folder")
}

/// The text of the file at `path` that an Agent's call reads, opened from
/// its Project's `folder` through no link ([`crate::beneath`]).
#[cfg(target_os = "linux")]
pub fn read_beneath(folder: &Path, path: &Path, upto: u64) -> std::io::Result<Text> {
    use rustix::fs::{Mode, OFlags};
    let beneath = crate::beneath::Beneath::open(folder)?;
    let opened = beneath.file(path, OFlags::RDONLY, Mode::empty())?;
    read_from(std::fs::File::from(opened), path, upto)
}

/// [`read`], of the file at `path` opened as `file`.
fn read_from(mut file: std::fs::File, path: &Path, upto: u64) -> std::io::Result<Text> {
    let meta = file.metadata()?;
    if meta.is_dir() {
        return Err(folder());
    }
    let upto = upto.min(MOST);
    let mut bytes = Vec::new();
    // One byte past, to know whether there is more.
    (&mut file).take(upto + 1).read_to_end(&mut bytes)?;
    let read = bytes.len() as u64;
    let truncated = read > upto;
    let hash = (!truncated).then(|| hash(&bytes));
    bytes.truncate(upto as usize);
    let text = text_len(&bytes, truncated).map(|len| {
        bytes.truncate(len);
        String::from_utf8(bytes).unwrap_or_default()
    });
    Ok(Text {
        path: shown(path),
        binary: text.is_none(),
        text,
        truncated,
        // Read whole, it is what was read; else what the system says,
        // which a file growing meanwhile may have passed.
        bytes: if truncated {
            meta.len().max(read)
        } else {
            read
        },
        hash,
        locked: None,
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
        // Not `nul`, which Windows keeps for its null device.
        for (name, bytes) in [
            ("a-nul", &b"ab\0cd"[..]),
            ("latin1", &b"caf\xe9 au lait"[..]),
        ] {
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

#[cfg(all(test, target_os = "linux"))]
mod beneath_tests {
    use super::*;

    #[test]
    fn an_agent_s_read_through_a_folder_put_in_another_s_place_reads_nothing_outside() {
        let t = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(t.path()).unwrap();
        let (project, other) = (root.join("project"), root.join("other"));
        std::fs::create_dir_all(project.join("a")).unwrap();
        std::fs::create_dir(&other).unwrap();
        std::fs::write(project.join("a/notes.md"), "mine").unwrap();
        std::fs::write(other.join("notes.md"), "secret").unwrap();
        let notes = project.join("a/notes.md");
        let text = read_beneath(&project, &notes, UPTO).unwrap();
        assert_eq!(text.text.as_deref(), Some("mine"));
        // The guard read `a/notes.md` as inside; then `a` becomes a link
        // to the folder outside.
        std::fs::rename(project.join("a"), project.join("was")).unwrap();
        std::os::unix::fs::symlink(&other, project.join("a")).unwrap();
        assert!(read_beneath(&project, &notes, UPTO).is_err());
        // The Person's read follows it, as their own reads do.
        assert_eq!(read(&notes, UPTO).unwrap().text.as_deref(), Some("secret"));
    }
}
