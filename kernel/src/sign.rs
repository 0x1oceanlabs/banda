//! A Project's sign (ADR 0070): what the Person picked; else a picture
//! found in its folder, copied into the Project's data; else letters from
//! its name that no other Project's letters share.

use crate::kernel::ProjectSummary;
use crate::project::write_whole;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::path::Path;
use ts_rs::TS;

/// The most a picture may weigh, found or picked.
pub(crate) const PICTURE_MOST: usize = 256 * 1024;

/// The least a raster picture may measure, either way, in pixels.
const PICTURE_LEAST: u32 = 16;

/// How deep a file named as the Project is looked for: folders down.
const NAMED_DEPTH: usize = 3;

/// The kept picture's name beside the manifest, before its extension.
const KEPT: &str = "sign";

/// A colour a sign's letters or icon take, from a quiet palette that leaves
/// out what an Agent's state says (ADR 0070, decision 4). None is neutral.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SignColor {
    Violet,
    Magenta,
    Yellow,
    Teal,
    Sand,
}

/// What the Person picked as a Project's sign, as `project.json` keeps it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum Picked {
    Emoji {
        emoji: String,
    },
    Icon {
        icon: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<SignColor>,
    },
    Letters {
        letters: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<SignColor>,
    },
    /// The picture kept beside the manifest.
    Picture {
        picture: bool,
    },
}

/// What the Person picks, as `projects.update` takes it: a picture comes
/// as its bytes.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum SignPick {
    Emoji {
        emoji: String,
    },
    Icon {
        /// One of Lucide's icons, by its name, as `pen-line`.
        icon: String,
        #[serde(default)]
        #[ts(optional)]
        color: Option<SignColor>,
    },
    Letters {
        letters: String,
        #[serde(default)]
        #[ts(optional)]
        color: Option<SignColor>,
    },
    Picture {
        /// The file's bytes, in base64, at most 256 KB.
        picture: String,
        /// Its kind, by its extension.
        kind: PictureKind,
    },
}

/// A picture's kind, by its extension; in this order a place's are
/// looked at.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum PictureKind {
    Svg,
    Png,
    Webp,
    Ico,
}

impl PictureKind {
    const ALL: [PictureKind; 4] = [
        PictureKind::Svg,
        PictureKind::Png,
        PictureKind::Webp,
        PictureKind::Ico,
    ];

    fn of(path: &str) -> Option<PictureKind> {
        let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|kind| kind.extension() == extension)
    }

    fn extension(self) -> &'static str {
        match self {
            PictureKind::Svg => "svg",
            PictureKind::Png => "png",
            PictureKind::Webp => "webp",
            PictureKind::Ico => "ico",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            PictureKind::Svg => "image/svg+xml",
            PictureKind::Png => "image/png",
            PictureKind::Webp => "image/webp",
            PictureKind::Ico => "image/x-icon",
        }
    }
}

/// The picture a Project's data keeps for its sign.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Kept {
    pub kind: PictureKind,
    /// Changes with the file, so a window knows to read it again.
    pub version: String,
    /// Where in the folder it was found; none when the Person picked it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
}

/// What a sign is, as a window draws it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SignKind {
    Picture,
    Emoji,
    Icon,
    Letters,
}

/// A Project's sign as a window draws it (ADR 0070, decision 3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Sign {
    pub kind: SignKind,
    /// The emoji, the icon's Lucide name or the letters; for a picture,
    /// its version, which `projects.sign` answers it at.
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<SignColor>,
    /// The Person picked it; else Banda found it, or made the letters.
    pub picked: bool,
    /// Where in the folder the picture was found, from the folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub found: Option<String>,
}

impl Sign {
    /// What `picked` and `kept` make of a Project named `name`; letters
    /// alone, as `lettered` makes them two where they must be.
    pub(crate) fn of(name: &str, picked: Option<&Picked>, kept: Option<&Kept>) -> Sign {
        let sign = |kind, text: &str, color| Sign {
            kind,
            text: text.to_owned(),
            color,
            picked: true,
            found: None,
        };
        match (picked, kept) {
            (Some(Picked::Emoji { emoji }), _) => sign(SignKind::Emoji, emoji, None),
            (Some(Picked::Icon { icon, color }), _) => sign(SignKind::Icon, icon, *color),
            (Some(Picked::Letters { letters, color }), _) => {
                sign(SignKind::Letters, letters, *color)
            }
            (Some(Picked::Picture { .. }), Some(kept)) => {
                sign(SignKind::Picture, &kept.version, None)
            }
            (_, Some(kept)) if kept.found.is_some() => Sign {
                picked: false,
                found: kept.found.clone(),
                ..sign(SignKind::Picture, &kept.version, None)
            },
            _ => Sign {
                picked: false,
                ..sign(SignKind::Letters, &letters(name), None)
            },
        }
    }
}

/// Gives every Project whose sign is letters it did not pick two letters
/// where another such Project's start with the same one, each pair unlike
/// the others (ADR 0070, decision 2): `banda` and `bandad` are BD and BN.
pub(crate) fn lettered(projects: &mut [ProjectSummary]) {
    let made =
        |p: &ProjectSummary| p.sign.kind == SignKind::Letters && !p.sign.picked && !p.scratch;
    let firsts: Vec<String> = (projects.iter().filter(|p| made(p)))
        .map(|p| p.sign.text.clone())
        .collect();
    let mut taken: Vec<String> = (projects.iter())
        .filter(|p| p.sign.kind == SignKind::Letters)
        .map(|p| p.sign.text.clone())
        .collect();
    let mut order: Vec<usize> = (0..projects.len())
        .filter(|i| made(&projects[*i]))
        .collect();
    order.sort_by(|a, b| projects[*a].name.cmp(&projects[*b].name));
    for index in order {
        let project = &mut projects[index];
        let first = project.sign.text.clone();
        if firsts.iter().filter(|other| **other == first).count() < 2 {
            continue;
        }
        let pairs: Vec<String> = (seconds(&project.name).into_iter())
            .map(|second| format!("{first}{second}"))
            .collect();
        if let Some(pair) = pairs
            .iter()
            .find(|pair| !taken.contains(pair))
            .or(pairs.first())
        {
            taken.push(pair.clone());
            project.sign.text = pair.clone();
        }
    }
}

/// A name's first letter, its domain's ending left off.
pub(crate) fn letters(name: &str) -> String {
    (words(name).first().and_then(|w| w.chars().next()))
        .map(|first| first.to_uppercase().to_string())
        .unwrap_or_default()
}

/// What may follow a name's first letter, best first, each once: the
/// second word's first letter, then its consonants from the end, then the
/// rest from the end; none that is the first letter again.
fn seconds(name: &str) -> Vec<String> {
    let words = words(name);
    let Some(first) = words.first().and_then(|w| w.chars().next()) else {
        return Vec::new();
    };
    let upper = |c: char| c.to_uppercase().to_string();
    let rest: Vec<char> = words[0]
        .chars()
        .skip(1)
        .filter(|c| c.is_alphanumeric())
        .collect();
    let consonant = |c: &char| !"aeiouyAEIOUY".contains(*c);
    let mut seconds: Vec<String> = Vec::new();
    let next_words = words.iter().skip(1).filter_map(|w| w.chars().next());
    let consonants = rest.iter().rev().filter(|c| consonant(c)).copied();
    let others = rest.iter().rev().filter(|c| !consonant(c)).copied();
    for c in next_words.chain(consonants).chain(others) {
        let c = upper(c);
        if c != upper(first) && !seconds.contains(&c) {
            seconds.push(c);
        }
    }
    seconds
}

/// The words of `name`, its domain's ending left off.
fn words(name: &str) -> Vec<&str> {
    without_domain(name.trim())
        .split(|c: char| c.is_whitespace() || "._-".contains(c))
        .filter(|w| !w.is_empty())
        .collect()
}

/// `name` without a domain's ending: `romaocean.com` is `romaocean`.
fn without_domain(name: &str) -> &str {
    const ENDINGS: [&str; 10] = [
        "com", "org", "net", "io", "dev", "app", "ai", "co", "ru", "me",
    ];
    match name.rsplit_once('.') {
        Some((base, ending))
            if !base.is_empty() && ENDINGS.contains(&ending.to_ascii_lowercase().as_str()) =>
        {
            base
        }
        _ => name,
    }
}

/// A picture found in a folder: where, and its bytes.
pub(crate) struct Found {
    pub path: String,
    pub kind: PictureKind,
    pub bytes: Vec<u8>,
}

/// The places a picture is looked for after a file named as the Project,
/// by folder and name, in the order of ADR 0070's rules (decision 2): a
/// site's favicon (and Next.js's `app/icon`), a logo, an app's icon. In
/// each place SVG comes before PNG.
const PLACES: [(&str, &str); 13] = [
    ("", "favicon"),
    ("public", "favicon"),
    ("static", "favicon"),
    ("src", "favicon"),
    ("app", "favicon"),
    ("app", "icon"),
    ("", "logo"),
    ("assets", "logo"),
    ("docs", "logo"),
    (".github", "logo"),
    ("build", "icon"),
    ("resources", "icon"),
    ("src-tauri/icons", "icon"),
];

/// Folders the walk for a file named as the Project does not go into,
/// besides hidden ones: what tools build and fetch.
const SKIPPED: [&str; 4] = ["node_modules", "target", "dist", "build"];

/// The picture Banda finds in `folder` for a Project named `name` (ADR
/// 0070, decision 2): a file named as the Project, at most three folders
/// down; then the fixed places. Only a file that fits is taken, and only
/// it is read whole. No git is asked, so a search costs a few `stat`s and
/// a short walk.
pub(crate) fn find(folder: &Path, name: &str) -> Option<Found> {
    named(folder, name)
        .into_iter()
        .chain(placed(folder))
        .find_map(|(path, kind)| {
            let file = folder.join(&path);
            let small = std::fs::metadata(&file)
                .is_ok_and(|m| m.is_file() && m.len() as usize <= PICTURE_MOST);
            let bytes = small.then(|| std::fs::read(&file).ok()).flatten()?;
            fits(kind, &bytes).ok()?;
            Some(Found { path, kind, bytes })
        })
}

/// Files named as the Project, `<name>.svg` or `.png`, at most
/// [`NAMED_DEPTH`] folders down: the shallowest first, SVG before PNG.
fn named(folder: &Path, name: &str) -> Vec<(String, PictureKind)> {
    let name = name.trim().to_lowercase();
    if name.is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    let mut level = vec![String::new()];
    for depth in 0..=NAMED_DEPTH {
        let mut next = Vec::new();
        for at in level {
            let Ok(entries) = std::fs::read_dir(folder.join(&at)) else {
                continue;
            };
            for entry in entries.flatten() {
                let file = entry.file_name().to_string_lossy().into_owned();
                let path = if at.is_empty() {
                    file.clone()
                } else {
                    format!("{at}/{file}")
                };
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => {
                        if depth < NAMED_DEPTH
                            && !file.starts_with('.')
                            && !SKIPPED.contains(&file.as_str())
                        {
                            next.push(path);
                        }
                    }
                    Ok(_) => {
                        let lower = file.to_lowercase();
                        if let Some(kind) = PictureKind::of(&lower)
                            && matches!(kind, PictureKind::Svg | PictureKind::Png)
                            && lower.rsplit_once('.').is_some_and(|(stem, _)| stem == name)
                        {
                            found.push((depth, kind, path));
                        }
                    }
                    Err(_) => {}
                }
            }
        }
        level = next;
    }
    found.sort();
    found
        .into_iter()
        .map(|(_, kind, path)| (path, kind))
        .collect()
}

/// The fixed places that hold a picture, in their rules' order. A
/// monorepo's `apps/*/public/favicon.*` comes after the other favicons.
fn placed(folder: &Path) -> Vec<(String, PictureKind)> {
    let mut apps: Vec<String> = std::fs::read_dir(folder.join("apps"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|app| format!("apps/{}/public", app.file_name().to_string_lossy()))
        .collect();
    apps.sort();
    let favicons = PLACES
        .iter()
        .take_while(|(_, stem)| *stem != "logo")
        .count();
    let places = PLACES[..favicons]
        .iter()
        .map(|(at, stem)| ((*at).to_owned(), *stem))
        .chain(apps.into_iter().map(|at| (at, "favicon")))
        .chain(
            PLACES[favicons..]
                .iter()
                .map(|(at, stem)| ((*at).to_owned(), *stem)),
        );
    places
        .flat_map(|(at, stem)| {
            PictureKind::ALL.map(|kind| {
                let file = format!("{stem}.{}", kind.extension());
                (
                    if at.is_empty() {
                        file
                    } else {
                        format!("{at}/{file}")
                    },
                    kind,
                )
            })
        })
        .filter(|(path, _)| folder.join(path).is_file())
        .collect()
}

/// Whether `bytes` are a picture of `kind` a sign may show: at most
/// [`PICTURE_MOST`], and a raster one at least [`PICTURE_LEAST`] pixels.
pub(crate) fn fits(kind: PictureKind, bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > PICTURE_MOST {
        return Err("A sign's picture is at most 256 KB.");
    }
    let at_least = |side: Option<u32>| match side {
        Some(side) if side >= PICTURE_LEAST => Ok(()),
        Some(_) => Err("A sign's picture is at least 16 pixels."),
        None => Err("That file is no picture of its kind."),
    };
    match kind {
        // An SVG starts so, past a byte-order mark and blank space.
        PictureKind::Svg => {
            let text = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]);
            let start = text.trim_start_matches('\u{feff}').trim_start();
            match start.starts_with("<svg") || start.starts_with("<?xml") {
                true => Ok(()),
                false => Err("That file is no SVG picture."),
            }
        }
        // PNG: width and height in IHDR, after the 8-byte signature.
        PictureKind::Png => at_least(
            (bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24).then(|| {
                let at = |i: usize| {
                    u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]])
                };
                at(16).min(at(20))
            }),
        ),
        // ICO: its largest image; a width of 0 is 256.
        PictureKind::Ico => at_least(
            (bytes.len() >= 6 && bytes[..4] == [0, 0, 1, 0])
                .then(|| {
                    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
                    (0..count)
                        .filter_map(|n| bytes.get(6 + n * 16))
                        .map(|w| if *w == 0 { 256 } else { u32::from(*w) })
                        .max()
                })
                .flatten(),
        ),
        PictureKind::Webp => {
            match bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
                true => Ok(()),
                false => Err("That file is no WebP picture."),
            }
        }
    }
}

/// What changes with a picture's bytes.
pub(crate) fn version(bytes: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Keeps `bytes`, a picture of `kind`, as the sign in `data`, in place of
/// any kept before, and says what was kept.
pub(crate) fn keep(
    data: &Path,
    kind: PictureKind,
    bytes: &[u8],
    found: Option<String>,
) -> std::io::Result<Kept> {
    forget(data);
    write_whole(&data.join(format!("{KEPT}.{}", kind.extension())), bytes)?;
    Ok(Kept {
        kind,
        version: version(bytes),
        found,
    })
}

/// Lets go of the sign's picture in `data`, if one is kept.
pub(crate) fn forget(data: &Path) {
    for kind in [
        PictureKind::Svg,
        PictureKind::Png,
        PictureKind::Webp,
        PictureKind::Ico,
    ] {
        let _ = std::fs::remove_file(data.join(format!("{KEPT}.{}", kind.extension())));
    }
}

/// The kept picture in `data`, as a `data:` URL a window draws with `<img>`.
pub(crate) fn data_url(data: &Path, kept: &Kept) -> Option<String> {
    let bytes = std::fs::read(data.join(format!("{KEPT}.{}", kept.kind.extension()))).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{encoded}", kept.kind.mime()))
}

/// The bytes of a picked picture, from base64.
pub(crate) fn decoded(picture: &str) -> Result<Vec<u8>, &'static str> {
    let picture = picture.trim();
    if picture.len() > PICTURE_MOST.div_ceil(3) * 4 {
        return Err("A sign's picture is at most 256 KB.");
    }
    base64::engine::general_purpose::STANDARD
        .decode(picture)
        .map_err(|_| "The picture's bytes are no base64.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(side: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend(side.to_be_bytes());
        bytes.extend(side.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    fn files(root: &Path, paths: &[&str], bytes: &[u8]) {
        for path in paths {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
    }

    #[test]
    fn the_rules_go_in_their_order_svg_before_png() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>";
        files(
            root,
            &[
                "README.md",
                "deep/a/b/c/banda.svg",
                "node_modules/x/banda.svg",
            ],
            svg,
        );
        files(
            root,
            &[
                "logo.png",
                "build/icon.png",
                "client/desktop/icons/banda.png",
            ],
            &png(32),
        );
        files(
            root,
            &["public/favicon.svg", "client/desktop/icons/banda.svg"],
            svg,
        );
        let named = |root: &Path| {
            named(root, "Banda")
                .into_iter()
                .map(|(p, _)| p)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            named(root),
            [
                "client/desktop/icons/banda.svg",
                "client/desktop/icons/banda.png"
            ]
        );
        let placed: Vec<_> = placed(root).into_iter().map(|(p, _)| p).collect();
        assert_eq!(placed, ["public/favicon.svg", "logo.png", "build/icon.png"]);
        assert_eq!(
            find(root, "banda").unwrap().path,
            "client/desktop/icons/banda.svg"
        );
        assert_eq!(find(root, "site").unwrap().path, "public/favicon.svg");

        let monorepo = tempfile::tempdir().unwrap();
        files(
            monorepo.path(),
            &["apps/web/public/favicon.png", "assets/logo.png"],
            &png(32),
        );
        assert_eq!(
            find(monorepo.path(), "x").unwrap().path,
            "apps/web/public/favicon.png"
        );
    }

    #[test]
    fn a_picture_found_is_one_that_fits() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        files(root, &["public/favicon.png"], &png(8));
        files(root, &["logo.png"], &png(64));
        let found = find(root, "site").unwrap();
        assert_eq!(found.path, "logo.png", "the favicon is too small");
        assert_eq!(found.kind, PictureKind::Png);
        assert!(find(tempfile::tempdir().unwrap().path(), "none").is_none());
    }

    #[test]
    fn a_picture_fits_by_its_kind_and_size() {
        assert!(fits(PictureKind::Png, &png(32)).is_ok());
        assert!(fits(PictureKind::Png, &png(8)).is_err());
        assert!(fits(PictureKind::Png, b"not a png").is_err());
        assert!(fits(PictureKind::Svg, b"<?xml version=\"1.0\"?><svg/>").is_ok());
        assert!(fits(PictureKind::Svg, b"hello").is_err());
        assert!(
            fits(PictureKind::Svg, b"<html><svg/></html>").is_err(),
            "an SVG starts so"
        );
        assert!(fits(PictureKind::Svg, &vec![b' '; PICTURE_MOST + 1]).is_err());
        let ico = [
            0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert!(fits(PictureKind::Ico, &ico).is_ok(), "a width of 0 is 256");
    }

    #[test]
    fn a_name_has_its_first_letter_and_seconds_to_tell_it_apart() {
        assert_eq!(letters("banda"), "B");
        assert_eq!(letters("romaocean.com"), "R");
        assert_eq!(letters(""), "");
        assert_eq!(seconds("bandad"), ["D", "N", "A"]);
        assert_eq!(seconds("My Work"), ["W", "Y"]);
        assert!(seconds("aaa").is_empty(), "nothing tells it apart");
    }

    #[test]
    fn a_kept_picture_is_read_as_a_data_url_and_lets_go_of_the_last() {
        let data = tempfile::tempdir().unwrap();
        keep(data.path(), PictureKind::Png, &png(32), None).unwrap();
        let kept = keep(
            data.path(),
            PictureKind::Svg,
            b"<svg/>",
            Some("logo.svg".into()),
        )
        .unwrap();
        assert!(!data.path().join("sign.png").exists());
        let url = data_url(data.path(), &kept).unwrap();
        assert!(url.starts_with("data:image/svg+xml;base64,"));
    }
}
