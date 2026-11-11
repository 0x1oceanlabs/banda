//! The wallpaper as Banda's glass draws it, measured so the desk's text
//! reads over it (ADR 0111): the picture blurred and saturated as the
//! page does, at its own size, without the grain; each colour it has once.

use crate::Wallpaper;
use image::{DynamicImage, ImageReader, Limits, imageops};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The longest side a picture is measured at. Its blur is 40 of its own
/// pixels by default, so a picture made this small first loses nothing
/// the blur would have kept.
const SIDE: u32 = 320;

/// The most a picture may take to read, as the files' thumbnails allow.
const MOST_HELD: u64 = 256 << 20;

/// What a picture measured, by its path, time, blur and saturation: the
/// light and the dark picture, and one before them, so a look resolved
/// again does not read a picture again (ADR 0111, decision 5).
type Measured = (String, u64, u64, u64, Option<Arc<[[f64; 3]]>>);
static MEASURED: Mutex<Vec<Measured>> = Mutex::new(Vec::new());
const KEPT: usize = 4;

/// Each colour of `wallpaper` as the page draws it, blurred by `blur`
/// pixels and saturated by `saturation`, sRGB from 0 to 1; none for a
/// picture the resolver does not read (ADR 0111, decision 6).
pub(crate) fn colours(
    wallpaper: &Wallpaper,
    blur: f64,
    saturation: f64,
) -> Option<Arc<[[f64; 3]]>> {
    kept_in(&MEASURED, wallpaper, blur, saturation)
}

/// [`colours`], kept in `measured`.
fn kept_in(
    measured: &Mutex<Vec<Measured>>,
    wallpaper: &Wallpaper,
    blur: f64,
    saturation: f64,
) -> Option<Arc<[[f64; 3]]>> {
    let key = |(path, modified, b, s, _): &Measured| {
        *path == wallpaper.path
            && *modified == wallpaper.modified
            && *b == blur.to_bits()
            && *s == saturation.to_bits()
    };
    let mut measured = measured
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(found) = measured.iter().find(|one| key(one)) {
        return found.4.clone();
    }
    let colours = read(Path::new(&wallpaper.path)).map(|picture| drawn(&picture, blur, saturation));
    if colours.is_none() {
        tracing::debug!(
            path = wallpaper.path,
            "the wallpaper is not a picture the look reads"
        );
    }
    if measured.len() == KEPT {
        measured.remove(0);
    }
    measured.push((
        wallpaper.path.clone(),
        wallpaper.modified,
        blur.to_bits(),
        saturation.to_bits(),
        colours.clone(),
    ));
    colours
}

/// The picture at `path`, none where `image` does not read it: JPEG XL,
/// AVIF and SVG, which the page draws, among them.
fn read(path: &Path) -> Option<DynamicImage> {
    let mut reader = ImageReader::open(path).ok()?.with_guessed_format().ok()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MOST_HELD);
    reader.limits(limits);
    reader.decode().ok()
}

/// Each colour of `picture`, blurred and saturated as the page draws it.
/// Its turn, where its EXIF says one, does not change its colours.
fn drawn(picture: &DynamicImage, blur: f64, saturation: f64) -> Arc<[[f64; 3]]> {
    let longest = picture.width().max(picture.height()).max(1);
    // Made smaller, never bigger.
    let small = if longest > SIDE {
        picture.thumbnail(SIDE, SIDE).into_rgb8()
    } else {
        picture.to_rgb8()
    };
    let scale = f64::from(small.width().max(small.height())) / f64::from(longest);
    let sigma = (blur * scale) as f32;
    let small = if sigma > 0.0 {
        imageops::blur(&small, sigma)
    } else {
        small
    };
    let unique: BTreeSet<[u8; 3]> = small.pixels().map(|pixel| pixel.0).collect();
    unique
        .into_iter()
        .map(|rgb| saturated(rgb.map(|c| f64::from(c) / 255.0), saturation))
        .collect()
}

/// `rgb` saturated by `amount`, as CSS's `saturate()` does: its matrix,
/// in sRGB, each channel kept from 0 to 1.
fn saturated(rgb: [f64; 3], amount: f64) -> [f64; 3] {
    let s = amount;
    let rows = [
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    rows.map(|row| (row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn wallpaper(path: &Path) -> Wallpaper {
        Wallpaper {
            path: path.display().to_string(),
            modified: 1,
            from: "look.toml",
        }
    }

    #[test]
    fn saturation_is_css_s() {
        // Grey stays grey; 1 changes nothing; 0 is CSS's grey of it.
        assert!(
            saturated([0.5; 3], 1.4)
                .iter()
                .all(|c| (c - 0.5).abs() < 1e-12)
        );
        let orange = [1.0, 0.6, 0.2];
        let same = saturated(orange, 1.0);
        assert!((0..3).all(|i| (same[i] - orange[i]).abs() < 1e-12));
        let grey = saturated(orange, 0.0);
        assert!((grey[0] - grey[2]).abs() < 1e-12);
        // More vivid, and kept within sRGB.
        let vivid = saturated(orange, 1.4);
        assert_eq!(vivid[0], 1.0);
        assert!(vivid[2] < orange[2]);
    }

    #[test]
    fn a_picture_is_blurred_as_the_page_draws_it_and_kept() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("halves.png");
        // Black and white halves: blurred, greys between them.
        RgbImage::from_fn(640, 400, |x, _| {
            Rgb(if x < 320 { [0; 3] } else { [255; 3] })
        })
        .save(&path)
        .unwrap();
        let kept = Mutex::new(Vec::new());
        let colours = kept_in(&kept, &wallpaper(&path), 40.0, 1.0).unwrap();
        assert!(colours.len() > 10, "{}", colours.len());
        assert!(colours.iter().all(|c| c[0] == c[1] && c[1] == c[2]));
        // Unblurred, the two it has.
        let sharp = drawn(&read(&path).unwrap(), 0.0, 1.0);
        assert_eq!(&*sharp, &[[0.0; 3], [1.0; 3]]);
        // Asked again, the same measure, not read again; a new time is a
        // new picture.
        std::fs::remove_file(&path).unwrap();
        let again = kept_in(&kept, &wallpaper(&path), 40.0, 1.0).unwrap();
        assert!(Arc::ptr_eq(&colours, &again));
        let rewritten = Wallpaper {
            modified: 2,
            ..wallpaper(&path)
        };
        assert!(kept_in(&kept, &rewritten, 40.0, 1.0).is_none());
    }

    #[test]
    fn a_picture_it_does_not_read_is_none() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("wall.jxl");
        std::fs::write(&path, b"not a picture image reads").unwrap();
        let kept = Mutex::new(Vec::new());
        assert!(kept_in(&kept, &wallpaper(&path), 40.0, 1.4).is_none());
    }
}
