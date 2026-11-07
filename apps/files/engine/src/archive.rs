//! `files.archive`: what a zip, a tar, a gzipped tar or a 7z holds, by
//! its names (ADR 0073, decision 6). Nothing is taken out: a name is
//! text, never joined to a path on this disk, so one that climbs out
//! (`../x`) or starts at the root is only shown.

use crate::model::{Archive, Packed, Packing};
use crate::shown;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// The most names listed.
pub const MOST: usize = 10_000;
/// A tar's block, and its header's.
const BLOCK: usize = 512;

/// Why an archive could not be listed.
#[derive(Debug)]
pub enum Unread {
    /// The disk said no.
    Io(std::io::Error),
    /// It is no archive Files reads, or a broken one, in words.
    Bad(String),
}

impl From<std::io::Error> for Unread {
    fn from(error: std::io::Error) -> Self {
        Unread::Io(error)
    }
}

/// What a library said of a broken archive.
fn bad(error: impl std::fmt::Display) -> Unread {
    Unread::Bad(error.to_string())
}

/// The names listed so far, at most [`MOST`].
#[derive(Default)]
struct Names {
    entries: Vec<Packed>,
    truncated: bool,
}

impl Names {
    /// Keeps `entry`; false once the list is full, and there was more.
    fn push(&mut self, entry: Packed) -> bool {
        if self.entries.len() >= MOST {
            self.truncated = true;
            return false;
        }
        self.entries.push(entry);
        true
    }
}

/// What the archive at `path` holds.
pub fn read(path: &Path) -> Result<Archive, Unread> {
    let mut file = File::open(path)?;
    if file.metadata()?.is_dir() {
        return Err(Unread::Io(std::io::Error::new(
            std::io::ErrorKind::IsADirectory,
            "a folder",
        )));
    }
    let head = head(&mut file)?;
    file.rewind()?;
    let mut packing = packing_of(&head, path)
        .ok_or_else(|| Unread::Bad("it is not a zip, a tar or a 7z".into()))?;
    let mut names = Names::default();
    match packing {
        Packing::Zip => zip_names(file, &mut names)?,
        Packing::Tar => tar_names(tar::Archive::new(BufReader::new(file)), &mut names)?,
        Packing::TarGz | Packing::Gz => packing = gz_names(file, path, &mut names)?,
        Packing::SevenZ => seven_names(path, &mut names)?,
    }
    Ok(Archive {
        path: shown(path),
        packing,
        entries: names.entries,
        truncated: names.truncated,
    })
}

/// What kind of archive starts with `head`: by its bytes, else by its
/// name.
fn packing_of(head: &[u8], path: &Path) -> Option<Packing> {
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        return Some(Packing::Zip);
    }
    if head.starts_with(b"7z\xbc\xaf\x27\x1c") {
        return Some(Packing::SevenZ);
    }
    if head.starts_with(b"\x1f\x8b") {
        return Some(Packing::TarGz);
    }
    if is_tar(head) {
        return Some(Packing::Tar);
    }
    // A zip may start with a program that unpacks it.
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(extension.as_str(), "zip" | "jar").then_some(Packing::Zip)
}

/// Whether `block` is a tar's header: `ustar` in its place, or its
/// checksum right, as the oldest tars have it.
fn is_tar(block: &[u8]) -> bool {
    if block.len() < BLOCK {
        return false;
    }
    if &block[257..262] == b"ustar" {
        return true;
    }
    let stored = std::str::from_utf8(&block[148..156])
        .ok()
        .map(|text| text.trim_matches(|c: char| c == '\0' || c == ' '))
        .and_then(|text| u32::from_str_radix(text, 8).ok());
    let sum: u32 = (block.iter().enumerate())
        .map(|(at, byte)| {
            if (148..156).contains(&at) {
                u32::from(b' ')
            } else {
                u32::from(*byte)
            }
        })
        .sum();
    block.iter().any(|byte| *byte != 0) && stored == Some(sum)
}

/// The first [`BLOCK`] bytes of `from`, or all of them when fewer.
fn head(from: impl Read) -> std::io::Result<Vec<u8>> {
    let mut head = Vec::with_capacity(BLOCK);
    from.take(BLOCK as u64).read_to_end(&mut head)?;
    Ok(head)
}

fn zip_names(file: File, names: &mut Names) -> Result<(), Unread> {
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(bad)?;
    for index in 0..zip.len() {
        let (path, folder, size, packed, written) = {
            let entry = zip.by_index_data(index).map_err(bad)?;
            let path = match entry.name() {
                Ok(name) => name.into_owned(),
                Err(_) => String::from_utf8_lossy(entry.name_raw()).into_owned(),
            };
            let folder = entry.is_dir();
            (
                path,
                folder,
                entry.size(),
                entry.compressed_size(),
                entry.last_modified(),
            )
        };
        // Its own time in UTC, where the zip keeps one; else the time it
        // writes, which names no zone.
        let stamped = zip.by_index_raw(index).ok().and_then(|file| {
            file.extra_data_fields().find_map(|field| match field {
                zip::ExtraField::ExtendedTimestamp(stamp) => stamp.mod_time(),
                _ => None,
            })
        });
        let modified = (stamped.map(|seconds| i64::from(seconds) * 1000))
            .or_else(|| written.map(|time| dos_ms(&time)));
        let entry = Packed {
            path,
            folder,
            size: (!folder).then_some(size),
            packed: (!folder).then_some(packed),
            modified,
        };
        if !names.push(entry) {
            break;
        }
    }
    Ok(())
}

/// A zip's time, read as UTC, in ms since the Unix epoch.
fn dos_ms(time: &zip::DateTime) -> i64 {
    let days = days_from_civil(
        i64::from(time.year()),
        i64::from(time.month()),
        i64::from(time.day()),
    );
    let seconds =
        i64::from(time.hour()) * 3600 + i64::from(time.minute()) * 60 + i64::from(time.second());
    (days * 86_400 + seconds) * 1000
}

/// Days since 1970-01-01 of a date in the proleptic Gregorian calendar
/// (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_cycle - 719_468
}

fn tar_names<R: Read>(mut archive: tar::Archive<R>, names: &mut Names) -> Result<(), Unread> {
    for entry in archive.entries()? {
        // A tar broken partway shows what came before the break.
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) if !names.entries.is_empty() => {
                names.truncated = true;
                break;
            }
            Err(error) => return Err(bad(error)),
        };
        let header = entry.header();
        let kind = header.entry_type();
        if kind.is_pax_global_extensions() {
            continue;
        }
        let folder = kind.is_dir();
        let modified = (header.mtime().ok())
            .and_then(|seconds| i64::try_from(seconds).ok())
            .map(|seconds| seconds * 1000);
        let entry = Packed {
            path: String::from_utf8_lossy(&entry.path_bytes()).into_owned(),
            folder,
            size: (!folder).then(|| entry.size()),
            packed: None,
            modified,
        };
        if !names.push(entry) {
            break;
        }
    }
    Ok(())
}

/// A gzip: the names of the tar in it, or the one file it packs.
fn gz_names(file: File, path: &Path, names: &mut Names) -> Result<Packing, Unread> {
    let mut gz = flate2::read::GzDecoder::new(BufReader::new(file));
    let block = head(&mut gz).map_err(bad)?;
    if is_tar(&block) {
        let tar = tar::Archive::new(std::io::Cursor::new(block).chain(gz));
        tar_names(tar, names)?;
        return Ok(Packing::TarGz);
    }
    let header = gz.header();
    let name = (header.and_then(|header| header.filename()))
        .map(|name| String::from_utf8_lossy(name).into_owned())
        .unwrap_or_else(|| inner_name(path));
    let modified = (header.map(|header| header.mtime()))
        .filter(|seconds| *seconds > 0)
        .map(|seconds| i64::from(seconds) * 1000);
    names.push(Packed {
        path: name,
        folder: false,
        size: gz_size(path).ok(),
        packed: std::fs::metadata(path).ok().map(|meta| meta.len()),
        modified,
    });
    Ok(Packing::Gz)
}

/// The name a gzip's file had: its own without `.gz`.
fn inner_name(path: &Path) -> String {
    let name = path.file_name().map(|name| name.to_string_lossy());
    let name = name.unwrap_or_default();
    match name.len().checked_sub(3) {
        Some(end) if name[end..].eq_ignore_ascii_case(".gz") => name[..end].to_owned(),
        _ => name.into_owned(),
    }
}

/// The size of what a gzip packs, as its last four bytes say it: modulo
/// 4 GiB.
fn gz_size(path: &Path) -> std::io::Result<u64> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::End(-4))?;
    let mut size = [0u8; 4];
    file.read_exact(&mut size)?;
    Ok(u64::from(u32::from_le_bytes(size)))
}

fn seven_names(path: &Path, names: &mut Names) -> Result<(), Unread> {
    let archive = sevenz_rust2::Archive::open(path).map_err(bad)?;
    for file in &archive.files {
        // What an update deletes, which no one sees.
        if file.is_anti_item {
            continue;
        }
        let modified = (file.has_last_modified_date)
            .then(|| std::time::SystemTime::from(file.last_modified_date))
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|since| i64::try_from(since.as_millis()).ok());
        let folder = file.is_directory;
        let entry = Packed {
            path: file.name.clone(),
            folder,
            size: (!folder).then_some(file.size),
            // A solid 7z packs many names in one stream.
            packed: None,
            modified,
        };
        if !names.push(entry) {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_date_counts_its_days_from_1970() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2026, 11, 6), 20_763);
    }

    #[test]
    fn a_gzips_file_is_named_without_its_gz() {
        assert_eq!(inner_name(Path::new("/a/notes.txt.gz")), "notes.txt");
        assert_eq!(inner_name(Path::new("/a/NOTES.GZ")), "NOTES");
        assert_eq!(inner_name(Path::new("/a/plain")), "plain");
    }
}
