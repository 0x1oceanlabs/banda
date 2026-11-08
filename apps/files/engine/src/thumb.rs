//! `files.thumb`: a file's small picture (ADR 0073, step F6), for a
//! Gallery's strip, the info of a file, and a row when the Person asks.
//!
//! A picture comes from, in order:
//!
//! 1. Banda's own cache, kept by the file's path, time and size and the
//!    size made ([`key`]);
//! 2. on Linux, freedesktop's shared cache (`~/.cache/thumbnails`), where
//!    the desktop's thumbnailers keep theirs, valid while it names the
//!    file's time;
//! 3. the file itself, when it is a picture `image` reads (PNG, JPEG, GIF,
//!    WebP, BMP, TIFF) and no bigger than [`MOST`]: decoded off the
//!    engine's threads, two at a time, turned as its EXIF says, and scaled
//!    with `fast_image_resize`.
//!
//! What is made goes in Banda's cache, which keeps the latest used
//! [`KEPT`] bytes, and in freedesktop's too, as a good neighbour does.
//! Anything else has no picture, and the window draws its icon. macOS's
//! QuickLook (`QLThumbnailGenerator`), a PDF's page (`pdfium-render`) and
//! a video's frame (an LGPL `ffmpeg`) come later.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, ImageDecoder, ImageReader, Limits};
use md5::{Digest as _, Md5};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC};
use sha2::Sha256;
use std::io::{Cursor, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::Thumb;

/// The sizes a picture is made at, its longest side in px.
pub const SIZES: [u32; 4] = [64, 128, 256, 512];

/// No file bigger than this is decoded, in bytes.
pub const MOST: u64 = 64 << 20;

/// What a decode may hold: a picture of about 85 megapixels.
const MOST_HELD: u64 = 256 << 20;

/// What Banda's cache keeps, in bytes; past it, the pictures used
/// longest ago go, until a quarter is free.
pub const KEPT: u64 = 128 << 20;

/// How many pictures are decoded at once.
const AT_ONCE: usize = 2;

/// The extensions of what `image` decodes here.
const PICTURES: [&str; 10] = [
    "png", "jpg", "jpeg", "jpe", "jfif", "gif", "webp", "bmp", "tif", "tiff",
];

/// freedesktop's folders, each with the longest side of what it keeps.
const SHARED: [(&str, u32); 4] = [
    ("normal", 128),
    ("large", 256),
    ("x-large", 512),
    ("xx-large", 1024),
];

/// What GLib leaves as it is in a file's URI, as freedesktop names a
/// thumbnail by it: the rest is `%XX`.
const IN_URI: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'!')
    .remove(b'$')
    .remove(b'&')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')')
    .remove(b'*')
    .remove(b'+')
    .remove(b',')
    .remove(b'-')
    .remove(b'.')
    .remove(b'/')
    .remove(b':')
    .remove(b'=')
    .remove(b'@')
    .remove(b'_')
    .remove(b'~');

/// The size made for one asked: the next of [`SIZES`], or the largest.
pub fn made_at(asked: u32) -> u32 {
    (SIZES.into_iter())
        .find(|size| *size >= asked)
        .unwrap_or(SIZES[SIZES.len() - 1])
}

/// What a picture is kept by in Banda's cache: the file's path, its time
/// and size, and the size made, hashed.
pub fn key(path: &Path, modified: SystemTime, bytes: u64, size: u32) -> String {
    let nanos = modified
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update(format!("\0{nanos}\0{bytes}\0{size}"));
    format!("{:x}", hash.finalize())
}

/// A file's URI as GLib writes it, which freedesktop's names hash.
pub fn uri_of(path: &Path) -> String {
    let bytes = path.as_os_str().as_encoded_bytes();
    let escaped: String = percent_encoding::percent_encode(bytes, IN_URI).collect();
    format!("file://{escaped}")
}

/// The name of a file's picture in freedesktop's cache: the MD5 of its
/// URI.
pub fn shared_name(path: &Path) -> String {
    format!("{:x}.png", Md5::digest(uri_of(path).as_bytes()))
}

/// freedesktop's cache on this machine: `BANDA_THUMBNAILS` moves it, empty
/// for none, so a test or a trial leaves the Person's alone; else
/// `$XDG_CACHE_HOME/thumbnails` on Linux, and none elsewhere.
pub fn shared_from_env() -> Option<PathBuf> {
    match std::env::var_os("BANDA_THUMBNAILS") {
        Some(set) if set.is_empty() => None,
        Some(set) => Some(PathBuf::from(set)),
        None if cfg!(target_os = "linux") => {
            dirs::cache_dir().map(|cache| cache.join("thumbnails"))
        }
        None => None,
    }
}

/// A picture made or found: a PNG's bytes and its size.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Png {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Png {
    /// The PNG `bytes`, by the size its header says; none for what is no
    /// PNG.
    fn of(bytes: Vec<u8>) -> Option<Png> {
        let header = bytes.get(..24)?;
        if &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
            return None;
        }
        let at = |from: usize| {
            u32::from_be_bytes([
                header[from],
                header[from + 1],
                header[from + 2],
                header[from + 3],
            ])
        };
        let (width, height) = (at(16), at(20));
        Some(Png {
            bytes,
            width,
            height,
        })
    }

    pub fn answer(self) -> Thumb {
        Thumb {
            mime: "image/png".to_owned(),
            data: BASE64.encode(&self.bytes),
            width: self.width,
            height: self.height,
        }
    }
}

/// What a file is, as its picture is kept by.
#[derive(Clone, Debug)]
pub struct File {
    path: PathBuf,
    modified: SystemTime,
    bytes: u64,
}

impl File {
    /// What is at `path`, when it is a file.
    pub fn at(path: &Path) -> Option<File> {
        let meta = std::fs::metadata(path).ok()?;
        meta.is_file().then(|| File {
            path: path.to_path_buf(),
            modified: meta.modified().unwrap_or(UNIX_EPOCH),
            bytes: meta.len(),
        })
    }

    /// Its time in whole seconds, as freedesktop's `Thumb::MTime` says it.
    fn seconds(&self) -> u64 {
        self.modified
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs())
    }

    /// Whether `image` decodes it here, by its name.
    fn decodable(&self) -> bool {
        (self.path.extension())
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| PICTURES.contains(&extension.to_ascii_lowercase().as_str()))
    }
}

/// What looking for a file's picture found before any is made.
pub enum Looked {
    /// A picture, or none and none to be made.
    Done(Option<Png>),
    /// A picture to make from the file.
    Make(File),
}

/// Where pictures are kept, and how many are made at once.
pub struct Thumbs {
    /// Banda's own cache.
    cache: Option<PathBuf>,
    /// freedesktop's.
    shared: Option<PathBuf>,
    /// The bytes Banda's cache holds, once counted.
    held: Mutex<Option<u64>>,
    pub decoding: tokio::sync::Semaphore,
}

impl Default for Thumbs {
    fn default() -> Self {
        Thumbs::new(None, None)
    }
}

impl Thumbs {
    pub fn new(cache: Option<PathBuf>, shared: Option<PathBuf>) -> Thumbs {
        Thumbs {
            cache,
            shared,
            held: Mutex::new(None),
            decoding: tokio::sync::Semaphore::new(AT_ONCE),
        }
    }

    /// The picture of the file at `path` that is kept, at `size`; or the
    /// file to make one from. Reads the disk.
    pub fn look(&self, path: &Path, size: u32) -> Looked {
        let Some(file) = File::at(path) else {
            return Looked::Done(None);
        };
        let key = key(&file.path, file.modified, file.bytes, size);
        if let Some(png) = self.cached(&key) {
            return Looked::Done(Some(png));
        }
        if let Some(png) = self.shared_of(&file, size) {
            if png.width.max(png.height) <= size {
                return Looked::Done(Some(png));
            }
            // A bigger one is made smaller, and kept.
            let made = image::load_from_memory(&png.bytes)
                .ok()
                .and_then(|picture| png_of(&scaled(picture, size), &[]));
            if let Some(made) = &made {
                self.keep(&key, made);
            }
            return Looked::Done(made);
        }
        if file.decodable() && file.bytes <= MOST {
            Looked::Make(file)
        } else {
            Looked::Done(None)
        }
    }

    /// Makes the picture of `file` at `size`, and keeps it here and, at
    /// one of freedesktop's sizes, there. Decodes.
    pub fn make(&self, file: &File, size: u32) -> Option<Png> {
        let picture = scaled(decode(&file.path)?, size);
        let uri = uri_of(&file.path);
        let said = [
            ("Thumb::URI", uri),
            ("Thumb::MTime", file.seconds().to_string()),
            ("Thumb::Size", file.bytes.to_string()),
            ("Software", "Banda".to_owned()),
        ];
        let png = png_of(&picture, &said)?;
        self.keep(&key(&file.path, file.modified, file.bytes, size), &png);
        self.share(file, size, &png);
        Some(png)
    }

    /// The picture Banda's cache keeps by `key`, used now.
    fn cached(&self, key: &str) -> Option<Png> {
        let path = self.cache.as_ref()?.join(format!("{key}.png"));
        let bytes = std::fs::read(&path).ok()?;
        // Its time says when it was used last.
        if let Ok(kept) = std::fs::File::options().write(true).open(&path) {
            let _ = kept.set_modified(SystemTime::now());
        }
        Png::of(bytes)
    }

    /// Keeps `png` by `key`; past [`KEPT`], those used longest ago go.
    fn keep(&self, key: &str, png: &Png) {
        let Some(cache) = &self.cache else { return };
        if put(cache, &format!("{key}.png"), &png.bytes).is_err() {
            return;
        }
        let mut held = self.held.lock().unwrap();
        let now = held.unwrap_or_else(|| total(cache)) + png.bytes.len() as u64;
        *held = Some(if now > KEPT {
            prune(cache, KEPT / 4 * 3)
        } else {
            now
        });
    }

    /// freedesktop's picture of `file`, valid for it now: one at least
    /// `size` big, or else the biggest smaller one.
    fn shared_of(&self, file: &File, size: u32) -> Option<Png> {
        let shared = self.shared.as_ref()?;
        let name = shared_name(&file.path);
        let uri = uri_of(&file.path);
        let (smaller, bigger): (Vec<_>, Vec<_>) = SHARED.iter().partition(|(_, side)| *side < size);
        (bigger.iter().chain(smaller.iter().rev()))
            .find_map(|(folder, _)| {
                let bytes = std::fs::read(shared.join(folder).join(&name)).ok()?;
                says(&bytes, &uri, file).then_some(bytes)
            })
            .and_then(Png::of)
    }

    /// Puts `png` in freedesktop's cache, at one of its sizes, unless the
    /// file is in that cache itself.
    fn share(&self, file: &File, size: u32, png: &Png) {
        let Some(shared) = &self.shared else { return };
        let Some((folder, _)) = SHARED.iter().find(|(_, side)| *side == size) else {
            return;
        };
        if file.path.starts_with(shared) {
            return;
        }
        let _ = put(&shared.join(folder), &shared_name(&file.path), &png.bytes);
    }
}

/// Whether a freedesktop picture's `bytes` say they show `file` as it is
/// now: its URI, its time in seconds, and its size where they say one.
fn says(bytes: &[u8], uri: &str, file: &File) -> bool {
    let Ok(read) = png::Decoder::new(Cursor::new(bytes)).read_info() else {
        return false;
    };
    let said = |key: &str| {
        let info = read.info();
        (info.uncompressed_latin1_text.iter())
            .find(|chunk| chunk.keyword == key)
            .map(|chunk| chunk.text.clone())
            .or_else(|| {
                (info.utf8_text.iter())
                    .find(|chunk| chunk.keyword == key)
                    .and_then(|chunk| chunk.get_text().ok())
            })
    };
    let time = said("Thumb::MTime").and_then(|time| time.trim().parse::<f64>().ok());
    said("Thumb::URI").as_deref() == Some(uri)
        && time.is_some_and(|time| time.trunc() as u64 == file.seconds())
        && said("Thumb::Size").is_none_or(|size| size.trim() == file.bytes.to_string())
}

/// The picture in the file at `path`, turned as its EXIF says; none for
/// one `image` does not read, or too big to hold.
fn decode(path: &Path) -> Option<DynamicImage> {
    let mut reader = ImageReader::open(path).ok()?.with_guessed_format().ok()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MOST_HELD);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    let orientation = decoder.orientation().ok();
    let mut picture = DynamicImage::from_decoder(decoder).ok()?;
    if let Some(orientation) = orientation {
        picture.apply_orientation(orientation);
    }
    Some(picture)
}

/// `picture` at most `size` on its longest side, never bigger than it
/// was, in 8 bits, with its alpha where it has one.
fn scaled(picture: DynamicImage, size: u32) -> DynamicImage {
    let picture = if picture.color().has_alpha() {
        DynamicImage::ImageRgba8(picture.into_rgba8())
    } else {
        DynamicImage::ImageRgb8(picture.into_rgb8())
    };
    let (width, height) = (picture.width(), picture.height());
    let longest = width.max(height);
    if longest <= size || longest == 0 {
        return picture;
    }
    let fit = |side: u32| {
        let side =
            (u64::from(side) * u64::from(size) + u64::from(longest) / 2) / u64::from(longest);
        side.max(1) as u32
    };
    let mut made = DynamicImage::new(fit(width), fit(height), picture.color());
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    match Resizer::new().resize(&picture, &mut made, &options) {
        Ok(()) => made,
        Err(_) => picture.thumbnail(size, size),
    }
}

/// `picture` as a PNG, saying `said` in its text.
fn png_of(picture: &DynamicImage, said: &[(&str, String)]) -> Option<Png> {
    let (color, data) = match picture {
        DynamicImage::ImageRgba8(rgba) => (png::ColorType::Rgba, rgba.as_raw()),
        DynamicImage::ImageRgb8(rgb) => (png::ColorType::Rgb, rgb.as_raw()),
        _ => return png_of(&DynamicImage::ImageRgba8(picture.to_rgba8()), said),
    };
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, picture.width(), picture.height());
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Balanced);
    for (key, text) in said {
        encoder
            .add_text_chunk((*key).to_owned(), text.clone())
            .ok()?;
    }
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(data).ok()?;
    writer.finish().ok()?;
    Png::of(bytes)
}

/// Writes `bytes` as `name` in `folder`, only this user's, whole or not
/// at all.
fn put(folder: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let mut making = std::fs::DirBuilder::new();
    making.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut making, 0o700);
    making.create(folder)?;
    let mut file = tempfile::NamedTempFile::new_in(folder)?;
    file.write_all(bytes)?;
    crate::write::persisted(file, &folder.join(name), true)
}

/// The pictures in `cache`, each with its size and when it was used last.
fn kept(cache: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let Ok(found) = std::fs::read_dir(cache) else {
        return Vec::new();
    };
    found
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "png")
        })
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            Some((
                entry.path(),
                meta.len(),
                meta.modified().unwrap_or(UNIX_EPOCH),
            ))
        })
        .collect()
}

/// What `cache` holds, in bytes.
fn total(cache: &Path) -> u64 {
    kept(cache).iter().map(|(_, bytes, _)| bytes).sum()
}

/// Lets the pictures used longest ago go until `cache` holds at most
/// `keep` bytes; what it holds then.
pub fn prune(cache: &Path, keep: u64) -> u64 {
    let mut kept = kept(cache);
    kept.sort_by_key(|(_, _, used)| std::cmp::Reverse(*used));
    let mut held = 0;
    for (path, bytes, _) in kept {
        if held + bytes <= keep {
            held += bytes;
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
    held
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_size_asked_is_made_at_the_next_size_or_the_largest() {
        assert_eq!(made_at(0), 64);
        assert_eq!(made_at(64), 64);
        assert_eq!(made_at(65), 128);
        assert_eq!(made_at(200), 256);
        assert_eq!(made_at(4096), 512);
    }

    #[test]
    fn the_key_changes_with_the_files_time_size_and_the_size_asked() {
        let path = Path::new("/home/a/b.png");
        let time = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let one = key(path, time, 10, 128);
        assert_eq!(one, key(path, time, 10, 128));
        assert_eq!(one.len(), 64);
        // Windows' clock counts in 100 ns.
        let tick = std::time::Duration::from_nanos(if cfg!(windows) { 100 } else { 1 });
        for other in [
            key(Path::new("/home/a/c.png"), time, 10, 128),
            key(path, time + tick, 10, 128),
            key(path, time, 11, 128),
            key(path, time, 10, 256),
        ] {
            assert_ne!(one, other);
        }
    }

    #[test]
    fn a_uri_is_escaped_as_glib_escapes_it_and_named_by_its_md5() {
        assert_eq!(
            uri_of(Path::new("/home/jens/photos/me.png")),
            "file:///home/jens/photos/me.png"
        );
        assert_eq!(
            uri_of(Path::new("/tmp/a b/#1;é.png")),
            "file:///tmp/a%20b/%231%3B%C3%A9.png"
        );
        assert_eq!(
            uri_of(Path::new("/x/!$&'()*+,-.:=@_~")),
            "file:///x/!$&'()*+,-.:=@_~"
        );
        // The spec's own example.
        assert_eq!(
            shared_name(Path::new("/home/jens/photos/me.png")),
            "c6ee772d9e49320e97ec29a7eb5b1697.png"
        );
    }

    #[test]
    fn the_cache_lets_go_of_what_was_used_longest_ago() {
        let cache = tempfile::tempdir().unwrap();
        let at = |n: u64| UNIX_EPOCH + std::time::Duration::from_secs(1_000 + n);
        for n in 0..4 {
            let path = cache.path().join(format!("{n}.png"));
            std::fs::write(&path, vec![0; 100]).unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(at(n)).unwrap();
        }
        assert_eq!(prune(cache.path(), 250), 200);
        let mut left: Vec<String> = (std::fs::read_dir(cache.path()).unwrap())
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["2.png", "3.png"]);
    }

    #[test]
    fn a_picture_is_scaled_to_its_longest_side_and_never_up() {
        let wide = DynamicImage::new_rgb8(400, 100);
        let made = scaled(wide, 128);
        assert_eq!((made.width(), made.height()), (128, 32));
        let small = DynamicImage::new_rgba8(10, 20);
        let made = scaled(small, 128);
        assert_eq!((made.width(), made.height()), (10, 20));
        assert!(made.color().has_alpha());
    }
}
