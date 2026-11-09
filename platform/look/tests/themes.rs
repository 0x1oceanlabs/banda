//! The guard of the themes' moves (ADR 0100, steps 0a and 1): what
//! `banda look` resolves for each of Banda's own themes, light and dark,
//! glass on and off, as it was before they moved, and what the menu and
//! the settings show of them: the theme's layers, the keys it sets and
//! `banda look themes`. `themes.snap` keeps it; a change there is a
//! change on screen.
//!
//! `BANDA_BLESS=1 cargo test -p banda-look --test themes` writes it again,
//! for a change that means to show.

use banda_look::hyprland::Windows;
use banda_look::settings::Material;
use banda_look::theme::Places;
use banda_look::{Look, resolve};
use serde_json::Value;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

/// Omarchy's Forest Dusk, as it ships: a dark theme.
const FOREST_DUSK: &str = r##"
mode = "dark"
accent = "#a3b88c"
selection = "#354b3e"
muted = "#9e927a"
background = "#19251f"
dark_background = "#131d18"
darker_background = "#0e1612"
lighter_background = "#28392f"
foreground = "#dac49d"
dark_foreground = "#ab9d81"
light_foreground = "#c9b58f"
bright_foreground = "#ead4ad"
red = "#d88e82"
yellow = "#d7b678"
orange = "#d39d70"
green = "#a3b88c"
cyan = "#8fbcb0"
blue = "#94afba"
magenta = "#b7a0b9"
brown = "#9d8064"
bright_red = "#e9a498"
bright_yellow = "#ebcb90"
bright_green = "#bed0a2"
bright_cyan = "#a6d2c3"
bright_blue = "#adc8d2"
bright_magenta = "#cfb8cf"
"##;

/// A light Omarchy theme that says only some colours, as older ones do:
/// the rest are worked out.
const TOKYO_LIGHT: &str = r##"
mode = "light"
accent = "#2959aa"
background = "#e6e7ed"
foreground = "#343b58"
"##;

/// The machine a set of cases runs on.
#[derive(Clone, Copy)]
enum Machine {
    /// Linux with no Omarchy: Banda makes the glass.
    Linux,
    /// A Mac: the system makes the glass.
    Mac,
    /// Omarchy, its current theme this palette, under Hyprland.
    Omarchy(&'static str),
}

/// One set: a name, the machine, and what `look.toml` says of the theme.
const SETS: [(&str, Machine, &str); 7] = [
    ("banda", Machine::Linux, ""),
    ("macos", Machine::Mac, ""),
    ("omarchy-dark", Machine::Omarchy(FOREST_DUSK), ""),
    ("omarchy-light", Machine::Omarchy(TOKYO_LIGHT), ""),
    ("banda-on-a-mac", Machine::Mac, "theme = \"banda\"\n"),
    ("macos-on-linux", Machine::Linux, "theme = \"macos\"\n"),
    (
        "pair",
        Machine::Omarchy(FOREST_DUSK),
        "theme = { light = \"omarchy\", dark = \"banda-dark\" }\n",
    ),
];

/// The window Hyprland's windows look like, under it.
const WINDOWS: Windows = Windows {
    rounding: 12.0,
    border: 2.0,
    gaps: 5.0,
    dim: Some(0.4),
    animations: true,
};

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// The look of one case, on a machine of its own, the themes there, and
/// the case's folder as the look may name it: as it was made, and as the
/// system resolves it (macOS's `/private/var`, Windows' long names).
fn look_of(machine: Machine, theme: &str, mode: &str, glass: bool) -> (Look, Value, [String; 2]) {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("banda");
    let mut places = Places::at(&config);
    let mut hyprland = false;
    match machine {
        Machine::Linux => {}
        Machine::Mac => {
            places.mac = true;
            places.material = Material::System;
        }
        Machine::Omarchy(palette) => {
            let current = dir.path().join("omarchy/current/theme");
            write(&current.join("colors.toml"), palette);
            places.omarchy_current = Some(current);
            hyprland = true;
        }
    }
    // Banda's glass is made of a picture; the system's needs none.
    write(&config.join("wall.png"), "a picture");
    let desk = if glass {
        "[desk]\nglass = true\nwallpaper = \"wall.png\"\n"
    } else {
        "[desk]\nglass = false\n"
    };
    write(
        &places.look_file(),
        &format!("{theme}mode = \"{mode}\"\n{desk}"),
    );
    let windows = || hyprland.then_some(WINDOWS);
    let look = resolve(&places, &windows, &[], &Default::default()).look;
    let themes = serde_json::to_value(places.themes()).unwrap();
    let resolved = dunce::canonicalize(dir.path()).unwrap();
    let made = dir.path().display().to_string();
    (look, themes, [resolved.display().to_string(), made])
}

/// `value`'s leaves, by their dotted keys, in their keys' order: a
/// JSON object keeps the order it was made in where another crate asks
/// serde_json to.
fn leaves(prefix: &str, value: &Value, out: &mut Vec<(String, String)>) {
    let mut under = |key: &str, value: &Value| leaves(&format!("{prefix}.{key}"), value, out);
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                under(key, &map[key]);
            }
        }
        Value::Array(list) => {
            for (n, value) in list.iter().enumerate() {
                under(&n.to_string(), value);
            }
        }
        Value::String(text) => out.push((prefix.to_owned(), text.clone())),
        other => out.push((prefix.to_owned(), other.to_string())),
    }
}

/// `out` as lines, with the case's folder, either of `roots`, named
/// `<dir>`.
fn lines(out: Vec<(String, String)>, roots: &[String; 2]) -> String {
    let mut text = String::new();
    for (key, value) in out {
        // A path the same on every system, Windows' backslashes too.
        let value = match roots
            .iter()
            .find_map(|root| value.strip_prefix(root.as_str()))
        {
            Some(rest) => format!("<dir>{}", rest.replace('\\', "/")),
            None => value,
        };
        writeln!(text, "{key} = {value}").unwrap();
    }
    text
}

/// What the window draws of `look`: its mode, colours, sizes and desk,
/// with the case's folder named `<dir>` and no file's time; the layers
/// it came from, and the keys of `look.toml` a theme or Hyprland set.
fn drawn(look: &Look, roots: &[String; 2]) -> String {
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    let mut desk = serde_json::to_value(&look.desk).unwrap();
    for wallpaper in ["wallpaper", "wallpaper_dark"] {
        if let Some(found) = desk.get_mut(wallpaper) {
            found["modified"] = Value::from(0);
        }
    }
    let mut out = Vec::new();
    leaves("mode", &serde_json::to_value(look.mode).unwrap(), &mut out);
    leaves("desk", &desk, &mut out);
    leaves("vars", &serde_json::to_value(&look.vars).unwrap(), &mut out);
    leaves(
        "schemes",
        &serde_json::to_value(&look.schemes).unwrap(),
        &mut out,
    );
    leaves(
        "sources",
        &serde_json::to_value(&look.sources).unwrap(),
        &mut out,
    );
    let set: serde_json::Map<String, Value> = look.settings["look.toml"]
        .iter()
        .filter(|(_, setting)| ["theme", "hyprland"].contains(&setting.from.layer.as_str()))
        .map(|(key, setting)| (key.clone(), serde_json::to_value(setting).unwrap()))
        .collect();
    leaves("settings", &Value::Object(set), &mut out);
    lines(out, roots)
}

#[test]
fn each_theme_draws_as_it_did() {
    let mut now = String::from(
        "# What `banda look` resolves for Banda's own themes: written by\n\
         # tests/themes.rs, which says how to write it again.\n",
    );
    for (name, machine, theme) in SETS {
        for mode in ["light", "dark"] {
            for glass in [true, false] {
                let (look, themes, roots) = look_of(machine, theme, mode, glass);
                if mode == "light" && glass {
                    writeln!(now, "\n[{name} banda look themes]").unwrap();
                    let mut out = Vec::new();
                    leaves("themes", &themes, &mut out);
                    now.push_str(&lines(out, &roots));
                }
                let glass = if glass { "on" } else { "off" };
                writeln!(now, "\n[{name} mode={mode} glass={glass}]").unwrap();
                now.push_str(&drawn(&look, &roots));
            }
        }
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/themes.snap");
    if std::env::var_os("BANDA_BLESS").is_some() {
        fs::write(&path, &now).unwrap();
        return;
    }
    let kept = fs::read_to_string(&path).unwrap_or_default();
    if kept != now {
        let first = kept
            .lines()
            .zip(now.lines())
            .position(|(kept, now)| kept != now)
            .unwrap_or_else(|| kept.lines().count().min(now.lines().count()));
        let around = |text: &str| {
            text.lines()
                .skip(first.saturating_sub(3))
                .take(7)
                .collect::<Vec<_>>()
                .join("\n")
        };
        panic!(
            "the themes draw otherwise than {} says, from line {}:\n--- kept\n{}\n--- now\n{}\n\
             If that is meant, BANDA_BLESS=1 cargo test -p banda-look --test themes",
            path.display(),
            first + 1,
            around(&kept),
            around(&now),
        );
    }
}
