//! Omarchy's own themes, kept as fixtures (ADR 0100, decision 8): each
//! palette in its mode, solid and over glass, Banda's over a wallpaper
//! and the system's, with what still does not read once the resolver has
//! done its part.

use banda_theme::palette::Palette;
use banda_theme::readable::{Under, Unread, check};
use banda_theme::tokens::{Glass, scheme};
use banda_theme::{Device, Material};
use std::collections::BTreeMap;
use std::path::Path;

/// Each fixture's palette, by its theme's name.
fn fixtures() -> Vec<(String, Palette)> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/omarchy");
    let mut found: Vec<_> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|e| e == "toml"))
        .map(|path| {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).unwrap();
            (name, Palette::parse(&text).unwrap())
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

/// A wallpaper of night, dusk and day: the colours of a photo's dark,
/// middle and bright parts, blurred.
const DUSK: [[f64; 3]; 3] = [[0.08, 0.08, 0.12], [0.55, 0.42, 0.3], [0.92, 0.88, 0.8]];

/// The scheme of `palette` with nothing said over it, solid or over
/// glass at its material's own tint, `under` it, and what of it does not
/// read.
fn check_of(palette: &Palette, glass: Option<(Material, Under)>) -> Vec<Unread> {
    let none = BTreeMap::new();
    let under = glass.map_or(Under::Ground, |(_, under)| under);
    let glass = glass.map(|(material, under)| Glass {
        desk: material.tint(),
        tile: 1.0,
        under,
        tokens: &none,
    });
    let scheme = scheme(palette, [], [], None, None, &Device::default(), glass);
    check(&scheme, under)
}

#[test]
fn every_omarchy_theme_reads_solid_and_over_either_glass() {
    let fixtures = fixtures();
    assert_eq!(fixtures.len(), 23, "Omarchy 4.5.0's themes");
    let mut unread = Vec::new();
    for (name, palette) in &fixtures {
        for (over, glass) in [
            ("solid", None),
            (
                "over Banda's glass, its wallpaper not read",
                Some((Material::Banda, Under::Wallpaper(None))),
            ),
            (
                "over Banda's glass on a dusky wallpaper",
                Some((Material::Banda, Under::Wallpaper(Some(&DUSK)))),
            ),
            (
                "over the system's glass",
                Some((Material::System, Under::Ground)),
            ),
        ] {
            for one in check_of(palette, glass) {
                unread.push(format!("{name} ({}), {over}: {one}", palette.mode().word()));
            }
        }
    }
    assert!(unread.is_empty(), "{}", unread.join("\n"));
}
