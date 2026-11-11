//! Omarchy's own themes, kept as fixtures (ADR 0100, decision 8): each
//! palette in its mode, solid and over glass, Banda's and the system's,
//! with what still does not read once the resolver has done its part.

use banda_theme::palette::Palette;
use banda_theme::readable::{Unread, check};
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

/// The scheme of `palette` with nothing said over it, solid or over
/// `material`'s glass at its own tint, and what of it does not read.
fn check_of(palette: &Palette, material: Option<Material>) -> Vec<Unread> {
    let none = BTreeMap::new();
    let glass = material.map(|material| Glass {
        desk: material.tint(),
        tile: 1.0,
        material,
        tokens: &none,
    });
    let scheme = scheme(palette, [], [], None, None, &Device::default(), glass);
    check(&scheme, material)
}

#[test]
fn every_omarchy_theme_reads_solid_and_over_either_glass() {
    let fixtures = fixtures();
    assert_eq!(fixtures.len(), 23, "Omarchy 4.5.0's themes");
    let mut unread = Vec::new();
    for (name, palette) in &fixtures {
        for material in [None, Some(Material::Banda), Some(Material::System)] {
            let over = material.map_or("solid".to_owned(), |m| format!("over {m:?}'s glass"));
            for one in check_of(palette, material) {
                unread.push(format!("{name} ({}), {over}: {one}", palette.mode().word()));
            }
        }
    }
    assert!(unread.is_empty(), "{}", unread.join("\n"));
}
