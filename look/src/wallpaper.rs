//! Where a Linux desktop keeps its wallpaper (ADR 0030). Each desktop is a
//! reader: it names the picture, and the dark desktop's when it keeps
//! another, and puts in `followed` the files whose change means asking
//! again, so a new wallpaper is new glass. They are followed by their size
//! and time: dconf's may be large.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::theme::Places;

/// What a desktop shows: its picture, the one for a dark desktop when it
/// keeps another, and the desktop's name, for the look to tell where the
/// picture came from.
pub(crate) struct Found {
    pub light: PathBuf,
    pub dark: Option<PathBuf>,
    pub from: &'static str,
}

/// The desktop's wallpaper: Omarchy's current background, else the
/// wallpaper of the desktop `XDG_CURRENT_DESKTOP` names.
pub(crate) fn of_desktop(places: &Places, followed: &mut Vec<PathBuf>) -> Option<Found> {
    if let Some(background) = &places.omarchy_background {
        return Some(Found {
            light: background.clone(),
            dark: None,
            from: "Omarchy",
        });
    }
    places.desktops.iter().find_map(|name| {
        let (light, dark, from) = match name.as_str() {
            "gnome" | "ubuntu" | "unity" | "budgie" | "pantheon" => {
                let said = gsettings(places, followed, "org.gnome.desktop.background")?;
                (
                    setting(&said, "picture-uri"),
                    setting(&said, "picture-uri-dark"),
                    "GNOME",
                )
            }
            "x-cinnamon" | "cinnamon" => {
                let said = gsettings(places, followed, "org.cinnamon.desktop.background")?;
                (setting(&said, "picture-uri"), None, "Cinnamon")
            }
            "mate" => {
                let said = gsettings(places, followed, "org.mate.background")?;
                (setting(&said, "picture-filename"), None, "MATE")
            }
            "kde" => {
                let (light, dark) = kde(places, followed)?;
                (Some(light), dark, "KDE")
            }
            "xfce" => (xfce(places, followed), None, "XFCE"),
            "hyprland" => (hyprpaper(places, followed), None, "hyprpaper"),
            _ => return None,
        };
        Some(Found {
            light: light?,
            dark,
            from,
        })
    })
}

/// A schema of GNOME's family, every key of it, through `gsettings`,
/// which knows the schema's defaults when the Person never set them: one
/// ask for all the keys. dconf writes every setting to one file, so its
/// change is when to ask again.
fn gsettings(places: &Places, followed: &mut Vec<PathBuf>, schema: &str) -> Option<String> {
    let program = places.gsettings.as_ref()?;
    if let Some(config_home) = &places.config_home {
        followed.push(config_home.join("dconf/user"));
    }
    let output = Command::new(program)
        .args(["list-recursively", schema])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    String::from_utf8(output.stdout).ok()
}

/// The picture a key names in a schema's listing (`schema key 'value'`
/// lines). A slideshow gives its first still picture.
fn setting(said: &str, key: &str) -> Option<PathBuf> {
    let value = said.lines().find_map(|line| {
        let (_, rest) = line.split_once(' ')?;
        rest.strip_prefix(key)?.strip_prefix(' ')
    })?;
    let picture = path_of(value.trim().trim_matches('\''))?;
    if picture
        .extension()
        .is_some_and(|extension| extension == "xml")
    {
        return slideshow(&picture);
    }
    Some(picture)
}

/// The first still picture of a GNOME slideshow: its first `<static>`'s
/// `<file>`, or that file's largest `<size>`.
fn slideshow(xml: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(xml).ok()?;
    let still = &text[text.find("<static>")?..];
    let file = between(still, "<file>", "</file>")?;
    let picture = match file.rfind("<size") {
        Some(at) => between(&file[at..], ">", "</size>")?,
        None => file,
    };
    path_of(picture.trim())
}

/// A file in the Person's config folder, followed, and its text.
fn config_file(places: &Places, followed: &mut Vec<PathBuf>, name: &str) -> Option<String> {
    let file = places.config_home.as_ref()?.join(name);
    let text = std::fs::read_to_string(&file).ok();
    followed.push(file);
    text
}

/// KDE Plasma: `Image=` of the first desktop's wallpaper, a picture or a
/// wallpaper package.
fn kde(places: &Places, followed: &mut Vec<PathBuf>) -> Option<(PathBuf, Option<PathBuf>)> {
    let text = config_file(places, followed, "plasma-org.kde.plasma.desktop-appletsrc")?;
    let mut image = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            image = line.ends_with("[Wallpaper][org.kde.image][General]");
        } else if image && let Some(value) = line.strip_prefix("Image=") {
            let picture = path_of(value)?;
            if !picture.is_dir() {
                return Some((picture, None));
            }
            return Some((
                largest(&picture.join("contents/images"))?,
                largest(&picture.join("contents/images_dark")),
            ));
        }
    }
    None
}

/// A KDE wallpaper package keeps the same picture in sizes, named by them
/// (`1920x1080.png`), in a folder for light and one for dark: a folder's
/// largest.
fn largest(folder: &Path) -> Option<PathBuf> {
    let size = |path: &Path| {
        let (width, height) = path.file_stem()?.to_str()?.split_once('x')?;
        Some(width.parse::<u64>().ok()? * height.parse::<u64>().ok()?)
    };
    std::fs::read_dir(folder)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .max_by_key(|path| size(path).unwrap_or(0))
}

/// XFCE: the first screen's `last-image`.
fn xfce(places: &Places, followed: &mut Vec<PathBuf>) -> Option<PathBuf> {
    let text = config_file(
        places,
        followed,
        "xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml",
    )?;
    let at = text.find(r#"name="last-image""#)?;
    let tag = &text[at..text[at..].find('>')? + at];
    path_of(between(tag, r#"value=""#, "\"")?)
}

/// hyprpaper: its first wallpaper, `wallpaper = monitor, path` or a
/// `path = …` in a `wallpaper { }` block.
fn hyprpaper(places: &Places, followed: &mut Vec<PathBuf>) -> Option<PathBuf> {
    let text = config_file(places, followed, "hypr/hyprpaper.conf")?;
    let named = text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        match key.trim() {
            "wallpaper" => Some(value.split_once(',')?.1.trim()),
            "path" => Some(value.trim()),
            _ => None,
        }
    })?;
    match named.strip_prefix("~/") {
        Some(rest) => Some(places.home.as_ref()?.join(rest)),
        None => path_of(named),
    }
}

/// A path, or a `file://` URI of one, its escapes undone.
fn path_of(named: &str) -> Option<PathBuf> {
    let path = named.strip_prefix("file://").unwrap_or(named);
    if !path.starts_with('/') {
        return None;
    }
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let escaped = (bytes[at] == b'%')
            .then(|| std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok())
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                out.push(byte);
                at += 3;
            }
            None => {
                out.push(bytes[at]);
                at += 1;
            }
        }
    }
    Some(PathBuf::from(String::from_utf8(out).ok()?))
}

fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = text.find(start)? + start.len();
    Some(&text[from..from + text[from..].find(end)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_uri_is_a_path() {
        assert_eq!(
            path_of("file:///home/me/My%20Pictures/sea.jpg"),
            Some(PathBuf::from("/home/me/My Pictures/sea.jpg"))
        );
        assert_eq!(
            path_of("/usr/share/a.png"),
            Some(PathBuf::from("/usr/share/a.png"))
        );
        assert_eq!(path_of("relative.png"), None);
        assert_eq!(
            path_of("file:///a%zz.png"),
            Some(PathBuf::from("/a%zz.png"))
        );
    }
}
