//! The look as a Person meets it: their files, Omarchy's theme and
//! Hyprland's windows, in throwaway folders.

use banda_look::motion::Move;
#[cfg(unix)]
use banda_look::settings::SidebarStyle;
use banda_look::settings::{GroupAsking, GroupSaturation, GroupWorking, Material};
use banda_look::{Look, Origin, Places, Shown, Windows, follow, resolve};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// Omarchy's Forest Dusk, as it ships.
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

const TOKYO_LIGHT: &str = r##"
mode = "light"
accent = "#2959aa"
background = "#e6e7ed"
foreground = "#343b58"
"##;

struct Machine {
    _dir: tempfile::TempDir,
    places: Places,
}

impl Machine {
    fn new(omarchy: bool) -> Machine {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("banda");
        fs::create_dir_all(&config).unwrap();
        let omarchy_themes = dir.path().join("omarchy-themes");
        write(
            &omarchy_themes.join("tokyo-night-light/colors.toml"),
            TOKYO_LIGHT,
        );
        let omarchy_current = omarchy.then(|| {
            let current = dir.path().join("omarchy-current/theme");
            write(&current.join("colors.toml"), FOREST_DUSK);
            current
        });
        Machine {
            places: Places {
                config,
                omarchy_background: omarchy_current
                    .as_ref()
                    .map(|theme: &PathBuf| theme.parent().unwrap().join("background")),
                omarchy_current,
                home: None,
                omarchy_themes: vec![omarchy_themes],
                fontconfig: None,
                desktops: Vec::new(),
                config_home: None,
                gsettings: None,
                // The desk these tests describe is a Linux one, which
                // Banda glasses itself (ADR 0030, decision 1).
                material: Material::Banda,
                mac: false,
                device: None,
            },
            _dir: dir,
        }
    }

    fn look_toml(&self, text: &str) {
        write(&self.places.look_file(), text);
    }

    fn look(&self) -> Look {
        resolve(&self.places, &|| None, &[], &Default::default()).look
    }

    fn under_hyprland(&self) -> Look {
        let windows = Windows {
            rounding: 12.0,
            border: 2.0,
            gaps: 5.0,
            dim: Some(0.4),
            animations: true,
        };
        resolve(&self.places, &|| Some(windows), &[], &Default::default()).look
    }

    /// Omarchy's current background, beside its current theme, as a link
    /// to the picture: returns the picture.
    // Omarchy's background is a link, which Windows makes only in Developer Mode.
    #[cfg(unix)]
    fn background(&self, name: &str) -> PathBuf {
        let link = self.places.omarchy_background.as_ref().unwrap();
        let picture = link.with_file_name("theme/backgrounds").join(name);
        write(&picture, "a picture");
        let _ = fs::remove_file(link);
        std::os::unix::fs::symlink(&picture, link).unwrap();
        dunce::canonicalize(picture).unwrap()
    }
}

/// The path of the picture the desk is made of, if any.
#[cfg(unix)]
fn picture_of(look: &Look) -> Option<String> {
    look.desk
        .wallpaper
        .as_ref()
        .map(|wallpaper| wallpaper.path.clone())
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// A picture of one colour at `path`, which the resolver measures.
fn picture(path: &Path, rgb: [u8; 3]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    image::RgbImage::from_pixel(8, 8, image::Rgb(rgb))
        .save(path)
        .unwrap();
}

fn color<'a>(look: &'a Look, dark: bool, var: &str) -> &'a str {
    let scheme = if dark {
        &look.schemes.dark
    } else {
        &look.schemes.light
    };
    scheme.as_ref().unwrap()[var].as_str()
}

#[test]
fn without_omarchy_banda_shows_its_own_light_and_dark_as_today() {
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.mode, Shown::System);
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    // Banda's shape (ADR 0100, decisions 3 and 11): the window 30, so a
    // tile 22 in the gap of 8 and a card 14 in the tile's padding, a
    // control 10 and a chip 6; hairlines, gaps 8, and the focused tile
    // lifts off the desk.
    assert_eq!(look.vars["--window-radius"], "30px");
    assert_eq!(look.vars["--tile-radius"], "22px");
    assert_eq!(look.vars["--card-radius"], "14px");
    assert_eq!(look.vars["--control-radius"], "10px");
    assert_eq!(look.vars["--small-radius"], "6px");
    assert_eq!(look.vars["--tile-border"], "1px");
    assert_eq!(look.vars["--gap-inner"], "8px");
    assert_eq!(look.vars["--bar-height"], "36px");
    assert_eq!(look.vars["--focus-shadow-strength"], "0.25");
    assert_eq!(look.vars["--tile-dim"], "0");
    // Banda's colours (ADR 0075, decision 4).
    assert_eq!(color(&look, false, "--desk"), "#f4f4f5");
    assert_eq!(color(&look, true, "--desk"), "#111113");
    assert_eq!(color(&look, true, "--background"), "#19191c");
    assert_eq!(color(&look, false, "--border"), "oklch(0 0 0 / 8%)");
    assert_eq!(color(&look, false, "--attention"), "#e5590a");
    // The focus and the rings are the blue accent; the main buttons are
    // the text's colour.
    assert_eq!(color(&look, false, "--focus"), "#0b6fe0");
    assert_eq!(color(&look, true, "--focus"), "#4ea3ff");
    assert_eq!(color(&look, false, "--ring"), "#0b6fe0");
    assert_eq!(color(&look, false, "--primary"), "#18181b");
}

#[test]
fn with_omarchy_banda_takes_its_current_theme_and_mode() {
    let machine = Machine::new(true);
    let look = machine.look();
    assert_eq!(look.mode, Shown::Dark);
    assert!(look.schemes.light.is_none());
    assert_eq!(color(&look, true, "--background"), "#19251f");
    assert_eq!(color(&look, true, "--primary"), "#a3b88c");
    assert_eq!(color(&look, true, "--focus"), "#a3b88c");
    assert_eq!(color(&look, true, "--attention"), "#d39d70");
    // As t3code.json's sidebarRowActive: mix dark_background accent 18%.
    assert_eq!(color(&look, true, "--sidebar-accent"), "#2d392d");
    assert_eq!(color(&look, true, "--ansi-8"), "#9e927a");
    assert_eq!(color(&look, true, "--ansi-15"), "#ead4ad");
    assert_eq!(color(&look, true, "--cursor"), "#ead4ad");
    assert_eq!(color(&look, true, "--selection"), "#354b3e");
    // No ring by default: Hyprland's border shows the focus.
    assert_eq!(look.vars["--focus-ring"], "0px");
    let theme = &look.sources[1];
    assert_eq!(theme.origin, Some(Origin::Current));
}

#[test]
fn under_hyprland_its_rounding_is_the_windows_corner() {
    // Way A (ADR 0100, decision 11): Banda's window is as round as
    // Hyprland's, the rest inside it, and a control a third of it.
    let machine = Machine::new(true);
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--window-radius"], "12px");
    assert_eq!(look.vars["--tile-radius"], "7px");
    // The tile less its padding is below 0, so the card is a control's.
    assert_eq!(look.vars["--card-radius"], "4px");
    assert_eq!(look.vars["--control-radius"], "4px");
    assert_eq!(look.vars["--small-radius"], "2.4px");
    assert_eq!(look.vars["--tile-border"], "2px");
    assert_eq!(look.vars["--gap-inner"], "5px");
    assert_eq!(look.vars["--gap-outer"], "5px");
    // Hyprland dims windows without the focus: so do the tiles.
    assert_eq!(look.vars["--tile-dim"], "0.4");
    // Its border is the focus, as its windows show it: no shadow beside it.
    assert_eq!(look.vars["--focus-shadow-strength"], "0");
    assert!(look.sources.iter().any(|s| s.layer == "hyprland"));
}

#[test]
fn under_hyprland_another_theme_keeps_its_own_shape() {
    // Hyprland's settings are the omarchy theme's shape only (ADR 0075,
    // decision 3).
    let machine = Machine::new(true);
    machine.look_toml("theme = \"banda\"\n");
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--gap-inner"], "8px");
    assert_eq!(look.vars["--tile-border"], "1px");
    assert!(!look.sources.iter().any(|s| s.layer == "hyprland"));

    // A pair takes the shape of the theme shown: Banda's in the dark.
    machine.look_toml("theme = { light = \"omarchy\", dark = \"banda-dark\" }\nmode = \"dark\"\n");
    assert_eq!(machine.under_hyprland().vars["--gap-inner"], "8px");

    // Asked for, it is taken under any theme.
    machine.look_toml("theme = \"banda\"\nhyprland = true\n");
    assert_eq!(machine.under_hyprland().vars["--gap-inner"], "5px");
}

// Omarchy's background is a link, which Windows makes only in Developer Mode.
#[cfg(unix)]
#[test]
fn the_desk_is_banda_glass_made_of_the_wallpaper() {
    let machine = Machine::new(true);
    // No wallpaper Banda knows of: the desk is solid. The theme is
    // Omarchy's, so the tiles keep Hyprland's gaps.
    let solid = machine.under_hyprland();
    assert!(!solid.desk.glass);
    assert_eq!(picture_of(&solid), None);
    assert_eq!(solid.vars["--gap-inner"], "5px");

    // Omarchy's background: Banda's glass is made of it, the same
    // everywhere. The glass changes the background, never the gaps (ADR
    // 0075, decision 3).
    let picture = machine.background("1-mountains.jpg");
    let glass = machine.under_hyprland();
    assert!(glass.desk.glass);
    assert_eq!(glass.desk.material, Material::Banda);
    assert_eq!(picture_of(&glass), Some(picture.display().to_string()));
    assert_eq!(glass.desk.wallpaper.as_ref().unwrap().from, "Omarchy");
    assert_eq!(glass.desk.sidebar, SidebarStyle::Panel);
    assert_eq!(glass.vars["--gap-inner"], "5px");
    assert_eq!(glass.vars["--desk-blur"], "40px");
    assert_eq!(glass.vars["--desk-saturation"], "1.4");
    assert_eq!(glass.vars["--desk-grain"], "0.04");
    assert_eq!(glass.vars["--desk-opacity"], "40%");
    // The tiles stay solid over glass (ADR 0075, decision 3).
    assert_eq!(glass.vars["--tile-opacity"], "100%");
    // Only the sidebar's panel casts a shadow by default, not the tiles.
    assert_eq!(glass.vars["--tile-shadow-strength"], "0");
    assert_eq!(glass.vars["--sidebar-shadow-strength"], "0.45");

    // The background changes: so does the glass.
    let next = machine.background("2-sea.jpg");
    assert_eq!(
        picture_of(&machine.look()),
        Some(next.display().to_string())
    );

    // Rewritten in place, the same picture is new by its time.
    let before = machine.look().desk.wallpaper.unwrap().modified;
    let file = fs::File::options().write(true).open(&next).unwrap();
    file.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
        .unwrap();
    assert!(machine.look().desk.wallpaper.unwrap().modified > before);

    machine.look_toml(concat!(
        "[desk]\nopacity = 0.2\nsidebar = \"desk\"\nblur = 64\nsaturation = 1\ngrain = 0\n",
        "[tile]\nopacity = 1\nshadow = 0.5\n",
    ));
    let mine = machine.look();
    assert_eq!(mine.vars["--desk-opacity"], "20%");
    assert_eq!(mine.vars["--desk-blur"], "64px");
    assert_eq!(mine.vars["--desk-saturation"], "1");
    assert_eq!(mine.vars["--desk-grain"], "0");
    assert_eq!(mine.vars["--tile-opacity"], "100%");
    assert_eq!(mine.vars["--tile-shadow-strength"], "0.5");
    assert_eq!(mine.desk.sidebar, SidebarStyle::Desk);

    // A picture of the Person's own, from the config folder.
    write(&machine.places.config.join("walls/mine.png"), "a picture");
    machine.look_toml("[desk]\nwallpaper = \"walls/mine.png\"\n");
    let own = machine.look().desk.wallpaper.unwrap();
    assert!(own.path.ends_with("walls/mine.png"), "{}", own.path);
    assert_eq!(own.from, "look.toml");
    assert_eq!(machine.look().desk.wallpaper_dark, None);

    // And one for when Banda is dark. Set alone, it is the picture in light
    // too; the desktop's own are not asked once a key is set.
    write(&machine.places.config.join("walls/night.png"), "a picture");
    machine.look_toml(
        "[desk]\nwallpaper = \"walls/mine.png\"\nwallpaper-dark = \"walls/night.png\"\n",
    );
    let night = machine.look().desk.wallpaper_dark.unwrap();
    assert!(night.path.ends_with("walls/night.png"), "{}", night.path);
    machine.look_toml("[desk]\nwallpaper-dark = \"walls/night.png\"\n");
    let alone = machine.look();
    assert!(alone.desk.glass);
    assert_eq!(picture_of(&alone), None);
    assert!(alone.desk.wallpaper_dark.is_some());

    machine.look_toml("[desk]\nwallpaper = \"walls/none.png\"\n");
    let missing = machine.look();
    assert!(!missing.desk.glass);
    assert!(
        missing.problems.iter().any(|p| p
            .message
            .starts_with("desk.wallpaper: there is no picture at")),
        "{:?}",
        missing.problems
    );

    // The system's glass needs no picture: the compositor blurs.
    machine.look_toml("[desk]\nmaterial = \"system\"\nwallpaper = \"walls/none.png\"\n");
    let system = machine.look();
    assert!(system.desk.glass);
    assert_eq!(system.desk.material, Material::System);
    assert_eq!(picture_of(&system), None);
    assert!(system.problems.is_empty(), "{:?}", system.problems);

    machine.look_toml("[desk]\nglass = false\n");
    assert!(!machine.under_hyprland().desk.glass);

    machine.look_toml("[desk]\nopacity = 1.5\nblur = -1\n");
    let wrong = machine.look();
    for message in [
        "desk.opacity is from 0 to 1",
        "desk.blur cannot be negative",
    ] {
        assert!(
            wrong.problems.iter().any(|p| p.message == message),
            "{message}: {:?}",
            wrong.problems
        );
    }
}

/// macOS and Windows blur behind a window themselves, so there the desk is
/// glass with no picture to make it of, and tinted lightly over a material
/// that is tinted already. `[desk] material` still wins, either way
/// (ADR 0030, decision 1).
// Omarchy's background is a link, which Windows makes only in Developer Mode.
#[cfg(unix)]
#[test]
fn the_platform_says_who_makes_the_glass_and_the_person_overrules_it() {
    let mut machine = Machine::new(true);
    let picture = machine.background("1-mountains.jpg");
    machine.places.material = Material::System;

    // The system's: glass, Omarchy's background left unread, a light tint.
    let system = machine.look();
    assert!(system.desk.glass);
    assert_eq!(system.desk.material, Material::System);
    assert_eq!(picture_of(&system), None);
    assert_eq!(system.vars["--desk-opacity"], "10%");

    // Banda's, asked for on such a machine: its glass is the wallpaper,
    // and the denser tint comes with it.
    machine.look_toml("[desk]\nmaterial = \"banda\"\n");
    let own = machine.look();
    assert_eq!(own.desk.material, Material::Banda);
    assert_eq!(picture_of(&own), Some(picture.display().to_string()));
    assert_eq!(own.vars["--desk-opacity"], "40%");

    // The system's, asked for on a Linux one: glass without the picture.
    machine.places.material = Material::Banda;
    machine.look_toml("[desk]\nmaterial = \"system\"\n");
    let theirs = machine.look();
    assert!(theirs.desk.glass);
    assert_eq!(theirs.desk.material, Material::System);
    assert_eq!(picture_of(&theirs), None);
}

#[test]
fn look_toml_wins_key_by_key_and_can_turn_hyprland_off() {
    let machine = Machine::new(true);
    machine.look_toml("[gaps]\ninner = 10\n[tile]\nradius = \"lg\"\n");
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--gap-inner"], "10px");
    assert_eq!(look.vars["--gap-outer"], "5px");
    // A step of the control's, as the old ladder had it.
    assert_eq!(look.vars["--tile-radius"], "4px");

    machine.look_toml("hyprland = false\n");
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--tile-radius"], "22px");
    assert!(!look.sources.iter().any(|s| s.layer == "hyprland"));
}

#[test]
fn the_accent_is_the_persons_too() {
    let machine = Machine::new(true);
    machine.look_toml("[colors]\naccent = \"orange\"\n[focus]\ninactive-border = \"muted\"\n");
    let look = machine.look();
    assert_eq!(color(&look, true, "--primary"), "#d39d70");
    assert_eq!(color(&look, true, "--focus"), "#d39d70");
    assert_eq!(color(&look, true, "--focus-inactive"), "#9e927a");
}

#[test]
fn niri_ring_is_a_switch() {
    let machine = Machine::new(true);
    machine.look_toml("[focus]\nring = 3\n");
    let look = machine.look();
    assert_eq!(look.vars["--focus-ring"], "3px");

    // One frame, one colour: the ring has none of its own.
    machine.look_toml("[focus]\nring = 3\nring-color = \"orange\"\n");
    let look = machine.look();
    assert!(look.problems[0].message.contains("ring-color"));
}

#[test]
fn motion_comes_through_the_layers_slowed_and_checked() {
    let machine = Machine::new(false);
    let look = machine.look();
    assert!(matches!(look.motion.workspace, Move::Spring(s) if s.stiffness == 800.0));

    machine.look_toml("[motion]\nslowdown = 2\n[motion.strip]\noff = true\n");
    let look = machine.look();
    assert!(matches!(look.motion.workspace, Move::Spring(s) if s.stiffness == 200.0));
    assert_eq!(look.motion.strip, Move::Off);

    machine.look_toml("[motion.strip]\neasing = { curve = \"bouncy\" }\n");
    let look = machine.look();
    let problem = &look.problems[0];
    assert_eq!((problem.line, problem.column), (Some(2), Some(20)));
}

#[test]
fn a_groups_plate_takes_its_keys() {
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.groups.working, GroupWorking::Breath);
    assert_eq!(look.groups.asking, GroupAsking::Twice);
    assert_eq!(look.groups.saturation, GroupSaturation::Normal);
    assert!(!look.groups.handle);

    machine.look_toml("[groups]\nworking = \"line\"\nsaturation = \"vivid\"\nhandle = true\n");
    let look = machine.look();
    assert!(look.groups.handle);
    assert_eq!(look.groups.working, GroupWorking::Line);
    assert_eq!(look.groups.saturation, GroupSaturation::Vivid);
}

#[test]
fn columns_and_fonts_come_through_the_layers() {
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.columns.presets, ["1/3", "1/2", "2/3", "1"]);
    assert_eq!(
        look.vars["--font-family-mono"],
        "\"JetBrains Mono Variable\", monospace"
    );
    assert_eq!(
        look.vars["--font-family-sans"],
        "\"Inter Variable\", sans-serif"
    );
    assert_eq!(look.vars["--text-root"], "16px");

    machine.look_toml(
        "[columns]\npresets = [\"1/4\", \"3/4\"]\ndefault = \"3/4\"\ncenter = \"always\"\nmin = 24.5\n[font]\nmono = \"Iosevka\"\nsize = 12.25\n",
    );
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.columns.presets, ["1/4", "3/4"]);
    assert_eq!(look.columns.default, "3/4");
    assert_eq!(look.columns.center, banda_look::columns::Center::Always);
    assert_eq!(look.columns.min, 24.5);
    assert_eq!(look.vars["--font-family-mono"], "\"Iosevka\", monospace");
    assert_eq!(look.vars["--text-root"], "14px");

    machine.look_toml("[columns]\ndefault = \"wide\"\n");
    let problem = &machine.look().problems[0];
    assert_eq!((problem.line, problem.column), (Some(2), Some(11)));
}

#[test]
fn the_bar_s_widgets_stand_where_look_toml_lists_them() {
    let machine = Machine::new(false);
    let bar = machine.look().bar;
    assert_eq!(bar.left, ["workspaces.list", "window.flow"]);
    assert!(bar.center.is_empty());
    assert_eq!(
        bar.right,
        [
            "workspaces.aside",
            "terminal.ports",
            "harnesses.limits",
            "notifications.recent",
            "clock.now",
            "window.update",
            "window.problems",
            "window.connection"
        ]
    );

    // A list replaces Banda's for its part, and [] empties it: the
    // sidebar's counts stand in the middle only where the Person lists
    // them (ADR 0098, decision 22).
    machine.look_toml(
        "[bar]\ncenter = [\"sidebar.counts\"]\nright = [\"git.branch\", \"workspaces.aside\"]\n",
    );
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.bar.center, ["sidebar.counts"]);
    assert_eq!(look.bar.right, ["git.branch", "workspaces.aside"]);
    let right = &look.settings["look.toml"]["bar.right"].from;
    assert_eq!((right.layer.as_str(), right.line), ("file", Some(3)));

    // A left of the Person's own, written before the Flow came, has no
    // Flow: it replaces Banda's whole (ADR 0098, decision 20).
    machine.look_toml("[bar]\nleft = [\"workspaces.list\"]\n");
    assert_eq!(machine.look().bar.left, ["workspaces.list"]);
}

#[test]
fn any_omarchy_theme_by_name_and_a_pair_for_the_system() {
    let machine = Machine::new(true);
    machine.look_toml("theme = \"tokyo-night-light\"\n");
    let look = machine.look();
    assert_eq!(look.mode, Shown::Light);
    assert_eq!(color(&look, false, "--primary"), "#2959aa");

    machine.look_toml("theme = { light = \"tokyo-night-light\", dark = \"omarchy\" }\n");
    let look = machine.look();
    assert_eq!(look.mode, Shown::System);
    assert_eq!(color(&look, false, "--primary"), "#2959aa");
    assert_eq!(color(&look, true, "--primary"), "#a3b88c");
}

#[test]
fn a_theme_of_the_persons_brings_its_own_sizes() {
    let machine = Machine::new(false);
    write(
        &machine.places.own_themes().join("square/colors.toml"),
        FOREST_DUSK,
    );
    write(
        &machine.places.own_themes().join("square/banda.toml"),
        "radius = 0\n",
    );
    machine.look_toml("theme = \"square\"\n");
    let look = machine.look();
    // The old radius is the roundness of it over 7: 0 squares them all.
    for level in ["window", "tile", "card", "control", "small"] {
        assert_eq!(look.vars[&format!("--{level}-radius")], "0px", "{level}");
    }
    assert_eq!(look.sources[1].origin, Some(Origin::Yours));
}

#[test]
fn a_broken_file_is_named_by_line_and_the_rest_still_applies() {
    let machine = Machine::new(true);
    machine.look_toml("[gaps]\ninner = 6\n\n[tile]\nradiuss = 3\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1);
    let problem = &look.problems[0];
    assert_eq!((problem.line, problem.column), (Some(5), Some(1)));
    assert!(problem.message.contains("radiuss"), "{}", problem.message);
    assert!(problem.to_string().contains("look.toml:5:1: "), "{problem}");
    assert_eq!(problem.key.as_deref(), Some("tile.radiuss"));
    // Only the wrong key is left out: the file's gap applies, and
    // Omarchy's theme still shows.
    assert_eq!(color(&look, true, "--primary"), "#a3b88c");
    assert_eq!(look.vars["--gap-inner"], "6px");

    // TOML written wrong leaves the whole file out.
    machine.look_toml("[gaps]\ninner = 6\n\n[tile\n");
    let look = machine.look();
    assert_eq!(look.problems[0].key, None);
    assert_eq!(look.vars["--gap-inner"], "8px");
}

#[test]
fn a_missing_theme_says_so_and_banda_shows() {
    let machine = Machine::new(true);
    machine.look_toml("theme = \"nope\"\n");
    let look = machine.look();
    assert!(look.problems[0].message.contains("no theme \"nope\""));
    assert_eq!(look.mode, Shown::System);
    assert!(look.schemes.light.is_some() && look.schemes.dark.is_some());
}

#[test]
fn following_prints_each_change_and_keeps_the_last_good_look() {
    let machine = Machine::new(false);
    machine.look_toml("[gaps]\ninner = 6\n");
    let (seen, looks) = mpsc::channel();
    let places = machine.places.clone();
    std::thread::spawn(move || {
        follow(&places, None, &[], &Default::default(), |look| {
            seen.send(look.clone()).is_ok()
        })
    });
    let next = || looks.recv_timeout(Duration::from_secs(5)).expect("a look");

    assert_eq!(next().vars["--gap-inner"], "6px");
    machine.look_toml("[gaps]\ninner = 9\n");
    assert_eq!(next().vars["--gap-inner"], "9px");
    machine.look_toml("[gaps]\ninner = oops\n");
    let broken = next();
    assert_eq!(broken.vars["--gap-inner"], "9px");
    assert_eq!(broken.problems.len(), 1);
    machine.look_toml("[gaps]\ninner = 12\n");
    let fixed = next();
    assert_eq!(fixed.vars["--gap-inner"], "12px");
    assert!(fixed.problems.is_empty());
}

#[test]
fn notify_in_look_toml_reaches_the_window_and_a_wrong_value_is_named() {
    use banda_look::notify::{Quiet, System, Toasts};
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.notify.system, System::Away);
    assert_eq!(look.notify.window, Toasts::OutOfSight);

    machine.look_toml("[notify]\nsystem = \"off\"\nquiet = \"never\"\nasking = false\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.notify.system, System::Off);
    assert_eq!(look.notify.quiet, Quiet::Never);
    assert!(!look.notify.asking);
    assert!(look.notify.done);

    machine.look_toml("[notify]\nwindow = \"sometimes\"\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1);
    assert!(
        look.problems[0].message.contains("out-of-sight"),
        "{:?}",
        look.problems
    );
    assert_eq!(look.problems[0].line, Some(2), "{:?}", look.problems);
}

#[test]
fn sound_in_look_toml_reaches_the_window_and_a_wrong_key_is_named() {
    use banda_look::sound::{Call, Families, Family};
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.sound.family, Families::One(Family::Banda));
    assert_eq!(look.sound.volume, 0.6);

    machine.look_toml("[sound]\nfamily = \"wood\"\nvolume = 0.4\ndone = false\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.sound.family, Families::One(Family::Wood));
    assert_eq!(look.sound.volume, 0.4);
    assert_eq!(look.sound.done, Call::On(false));
    assert_eq!(look.sound.asking, Call::On(true));

    machine.look_toml("[sound]\nvolume = 2\nasking = \"pop\"\n");
    let look = machine.look();
    let words: Vec<_> = look.problems.iter().map(|p| p.message.as_str()).collect();
    assert_eq!(words, ["sound.volume is from 0 to 1"]);
    assert_eq!(look.sound.volume, 0.6, "a wrong volume keeps the default");
    assert_eq!(
        look.sound.asking,
        Call::From(Family::Pop),
        "the rest applies"
    );

    machine.look_toml("[sound]\nfamily = \"bell\"\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1);
    assert!(look.problems[0].message.contains("\"bell\" is no family"));
    assert_eq!(look.problems[0].line, Some(2), "{:?}", look.problems);
}

/// The template's commented keys are the defaults, so a Person who
/// uncomments one changes only what they change.
#[test]
fn the_template_says_the_defaults() {
    fn key(line: &str) -> Option<&str> {
        let rest = line.strip_prefix("# ")?;
        let starts = rest.starts_with('[')
            || rest
                .split_once(" = ")
                .is_some_and(|(k, _)| k.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        starts.then_some(rest)
    }
    let uncommented: String = banda_look::TEMPLATE
        .lines()
        // Examples, not defaults: a theme's name, a picture of one's own,
        // the drawer's Harness.
        .filter(|line| {
            !["# theme", "# wallpaper", "# harness"]
                .iter()
                .any(|example| line.starts_with(example))
        })
        .map(|line| key(line).unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(uncommented.contains("[motion.strip]"), "{uncommented}");
    let machine = Machine::new(false);
    let defaults = machine.look();
    machine.look_toml(&uncommented);
    let template = machine.look();
    assert!(template.problems.is_empty(), "{:?}", template.problems);
    let values = |look: &Look| {
        look.settings
            .iter()
            .map(|(file, keys)| {
                let keys: BTreeMap<_, _> = keys
                    .iter()
                    .map(|(k, s)| (k.clone(), s.value.clone()))
                    .collect();
                (file.clone(), keys)
            })
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(values(&template), values(&defaults));
    assert_eq!(
        Look {
            sources: defaults.sources.clone(),
            settings: defaults.settings.clone(),
            ..template
        },
        defaults
    );
}

#[test]
fn each_key_says_where_its_value_comes_from() {
    let machine = Machine::new(true);
    machine.look_toml("# mine\nradius = 4\n\n[tile]\nborder = 3\n");
    let look = machine.under_hyprland();
    let keys = &look.settings["look.toml"];
    let radius = &keys["radius"];
    assert_eq!(radius.value, serde_json::json!(4.0));
    assert_eq!(radius.from.layer, "file");
    assert_eq!(radius.from.line, Some(2));
    let path = machine.places.look_file().display().to_string();
    assert_eq!(radius.from.path.as_deref(), Some(path.as_str()));
    assert_eq!(keys["tile.border"].from.line, Some(5));
    assert_eq!(keys["tile.dim-inactive"].from.layer, "hyprland");
    assert_eq!(keys["bar.height"].from.layer, "defaults");
    assert!(look.settings["sidebar.toml"].contains_key("group"));
}

// Its `gsettings` is a `sh` script.
#[cfg(unix)]
#[test]
fn a_linux_desktop_gives_its_wallpaper() {
    let mut machine = Machine::new(false);
    let home = machine.places.config.parent().unwrap().to_owned();
    let config_home = home.join("config-home");
    machine.places.config_home = Some(config_home.clone());
    machine.places.home = Some(home.clone());
    let from = |machine: &Machine| {
        let look = machine.look();
        look.desk
            .wallpaper
            .map(|wallpaper| (wallpaper.from, wallpaper.path))
    };
    let dark = |machine: &Machine| {
        let look = machine.look();
        look.desk.wallpaper_dark.map(|wallpaper| wallpaper.path)
    };
    let picture = |name: &str| {
        let path = home.join("Pictures").join(name);
        write(&path, "a picture");
        dunce::canonicalize(path).unwrap().display().to_string()
    };
    // No desktop Banda knows: the desk is solid, quietly.
    assert_eq!(from(&machine), None);
    assert!(machine.look().problems.is_empty());

    // GNOME, through gsettings, which lists a schema from its file here,
    // as the real one does: a URI, escapes and all.
    let gsettings = home.join("bin/gsettings");
    write(
        &gsettings,
        "#!/bin/sh\ncat \"$(dirname \"$0\")/$2\" 2>/dev/null || exit 1\n",
    );
    fs::set_permissions(
        &gsettings,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    machine.places.gsettings = Some(gsettings.clone());
    machine.places.desktops = vec!["ubuntu".into(), "gnome".into()];
    let gnome = |keys: &[(&str, &str)]| {
        let schema = "org.gnome.desktop.background";
        let lines: String = keys
            .iter()
            .map(|(key, value)| format!("{schema} {key} '{value}'\n"))
            .collect();
        write(
            &home.join("bin").join(schema),
            &format!("{schema} picture-opacity 100\n{lines}"),
        );
    };
    let sea = picture("the sea.jpg");
    let sea_uri = format!("file://{}", sea.replace(' ', "%20"));
    gnome(&[("picture-uri", &sea_uri)]);
    assert_eq!(from(&machine), Some(("GNOME", sea.clone())));
    assert_eq!(dark(&machine), None);
    // GNOME keeps a picture for its dark style: the look carries both, and
    // the same picture twice is one.
    let night = picture("night.png");
    gnome(&[
        ("picture-uri", &sea_uri),
        ("picture-uri-dark", &format!("file://{night}")),
    ]);
    assert_eq!(from(&machine), Some(("GNOME", sea.clone())));
    assert_eq!(dark(&machine), Some(night.clone()));
    gnome(&[("picture-uri", &sea_uri), ("picture-uri-dark", &sea_uri)]);
    assert_eq!(dark(&machine), None);
    // Its setting changes, and dconf's file with it: the look asks again.
    let resolved = resolve(&machine.places, &|| None, &[], &Default::default());
    assert!(resolved.followed.contains(&config_home.join("dconf/user")));

    // A slideshow gives its first still picture.
    let still = picture("still.png");
    let show = home.join("Pictures/day.xml");
    write(
        &show,
        &format!(
            "<background><starttime/><static><duration>60</duration><file>{still}</file></static></background>"
        ),
    );
    gnome(&[("picture-uri", &show.display().to_string())]);
    assert_eq!(from(&machine), Some(("GNOME", still.clone())));

    // A picture the page cannot draw: solid, and the look says why.
    gnome(&[("picture-uri", &picture("mac.heic"))]);
    let unseen = machine.look();
    assert!(!unseen.desk.glass);
    assert!(
        unseen
            .problems
            .iter()
            .any(|p| p.message.starts_with("desk.wallpaper: GNOME's wallpaper")),
        "{:?}",
        unseen.problems
    );

    // MATE keeps a plain path, under its own schema.
    machine.places.desktops = vec!["mate".into()];
    write(
        &home.join("bin/org.mate.background"),
        &format!("org.mate.background picture-filename '{sea}'\n"),
    );
    assert_eq!(from(&machine), Some(("MATE", sea.clone())));

    // KDE: the first desktop's image, or its package's largest picture.
    machine.places.desktops = vec!["kde".into()];
    let applets = config_home.join("plasma-org.kde.plasma.desktop-appletsrc");
    write(
        &applets,
        &format!(
            "[Containments][1][General]\nImage=file:///nowhere.png\n\n[Containments][1][Wallpaper][org.kde.image][General]\nImage=file://{sea}\nSlidePaths=/usr/share/wallpapers/\n"
        ),
    );
    assert_eq!(from(&machine), Some(("KDE", sea.clone())));
    let next = home.join("wallpapers/Next");
    write(&next.join("contents/images/1280x800.png"), "small");
    write(&next.join("contents/images/3840x2160.png"), "large");
    write(
        &applets,
        &format!(
            "[Containments][1][Wallpaper][org.kde.image][General]\nImage={}\n",
            next.display()
        ),
    );
    let (_, large) = from(&machine).unwrap();
    assert!(large.ends_with("images/3840x2160.png"), "{large}");
    assert_eq!(dark(&machine), None);
    // A package with dark pictures: its largest is the dark wallpaper.
    write(&next.join("contents/images_dark/1280x800.png"), "small");
    write(&next.join("contents/images_dark/2560x1440.png"), "large");
    let night = dark(&machine).unwrap();
    assert!(night.ends_with("images_dark/2560x1440.png"), "{night}");

    // XFCE: the first screen's last image.
    machine.places.desktops = vec!["xfce".into()];
    write(
        &config_home.join("xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml"),
        &format!(
            "<channel name=\"xfce4-desktop\">\n  <property name=\"last-image\" type=\"string\" value=\"{sea}\"/>\n</channel>\n"
        ),
    );
    assert_eq!(from(&machine), Some(("XFCE", sea.clone())));

    // Hyprland without Omarchy: hyprpaper's first wallpaper, from home.
    machine.places.desktops = vec!["hyprland".into()];
    write(
        &config_home.join("hypr/hyprpaper.conf"),
        "preload = ~/Pictures/the sea.jpg\nwallpaper = DP-1, ~/Pictures/the sea.jpg\n",
    );
    assert_eq!(from(&machine), Some(("hyprpaper", sea.clone())));

    // The key still wins over the desktop's.
    let mine = picture("mine.webp");
    machine.look_toml(&format!("[desk]\nwallpaper = \"{mine}\"\n"));
    assert_eq!(from(&machine), Some(("look.toml", mine)));
}

#[test]
fn a_mac_starts_on_the_macos_theme_with_its_shape() {
    // Each platform starts on its own theme (ADR 0075, decision 2).
    let mut machine = Machine::new(false);
    machine.places.mac = true;
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    let names: Vec<_> = look.sources.iter().filter_map(|s| s.name.clone()).collect();
    assert_eq!(names, ["macos-light", "macos-dark"]);
    // The Mac's shape over Banda's: the system's font at 13, a taller bar.
    assert!(look.vars["--font-family-sans"].starts_with("-apple-system"));
    assert_eq!(look.vars["--bar-height"], "38px");
    assert_eq!(look.vars["--gap-inner"], "8px");
    // Banda's corners on the Mac until Tahoe's are measured (ADR 0100,
    // step 5): a tile about 10, a control 7.
    assert_eq!(look.vars["--tile-radius"], "10px");
    assert_eq!(look.vars["--control-radius"], "7px");
    // The tile less its padding is 2, below a control: the card is 7.
    assert_eq!(look.vars["--card-radius"], "7px");
    // The accent is the system's, which the window writes for the look
    // (ADR 0075, decision 6), else Apple's blue; [colors] accent still
    // wins.
    assert_eq!(color(&look, false, "--focus"), "#007aff");
    assert_eq!(color(&look, true, "--primary"), "#0a84ff");
    assert_eq!(color(&look, true, "--desk"), "#28282a");
    let device = machine.places.config.join("device.json");
    write(&device, r##"{"accent":"#e0478c"}"##);
    machine.places.device = Some(device);
    let look = machine.look();
    assert_eq!(color(&look, false, "--focus"), "#e0478c");
    assert_eq!(color(&look, true, "--sidebar-primary"), "#e0478c");

    machine.look_toml("[colors]\naccent = \"#c2410c\"\n");
    assert_eq!(color(&machine.look(), false, "--focus"), "#c2410c");

    // Anywhere else it is a theme to pick.
    machine.places.mac = false;
    machine.places.device = None;
    machine.look_toml("theme = \"macos\"\n");
    assert_eq!(machine.look().vars["--bar-height"], "38px");
}

/// Writes the Person's theme `name`, a `theme.toml`.
fn theme_toml(machine: &Machine, name: &str, text: &str) {
    write(
        &machine.places.own_themes().join(name).join("theme.toml"),
        text,
    );
}

#[test]
fn a_theme_toml_has_light_and_dark_and_its_shape_inside() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "sea",
        r##"name = "Sea"

[colors]
accent = "#2a9d8f"
background = { light = "#f7fbfb", dark = "#0e1a1c" }

[shape]
window = 20
control = 4

[font]
sans = "Inter"

[glass]
blur = 30

[tokens]
card = { dark = "#101010" }
"##,
    );
    machine.look_toml("theme = \"sea\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.mode, Shown::System);
    let names: Vec<_> = look.sources.iter().filter_map(|s| s.name.clone()).collect();
    assert_eq!(names, ["sea-light", "sea-dark"]);
    assert_eq!(look.sources[1].origin, Some(Origin::Yours));
    assert_eq!(color(&look, false, "--background"), "#f7fbfb");
    assert_eq!(color(&look, true, "--background"), "#0e1a1c");
    assert_eq!(color(&look, false, "--focus"), "#2a9d8f");
    assert_eq!(color(&look, true, "--focus"), "#2a9d8f");
    assert_eq!(color(&look, true, "--card"), "#101010");
    assert_ne!(color(&look, false, "--card"), "#101010");
    assert_eq!(look.vars["--window-radius"], "20px");
    assert_eq!(look.vars["--tile-radius"], "12px");
    assert_eq!(look.vars["--card-radius"], "4px");
    assert_eq!(look.vars["--control-radius"], "4px");
    assert_eq!(look.vars["--desk-blur"], "30px");
    assert_eq!(look.vars["--font-family-sans"], "\"Inter\", sans-serif");
    let keys = &look.settings["look.toml"];
    assert_eq!(keys["shape.control"].from.layer, "theme");
    let listed: Vec<_> = (machine.places.themes().into_iter())
        .filter(|theme| theme.origin == Origin::Yours)
        .map(|theme| theme.name)
        .collect();
    assert_eq!(listed, ["sea-light", "sea-dark"]);
}

#[test]
fn the_system_turns_glass_off_while_it_reduces_transparency_or_raises_contrast() {
    let mut machine = Machine::new(false);
    write(&machine.places.config.join("wall.png"), "a picture");
    machine.look_toml("[desk]\nwallpaper = \"wall.png\"\n");
    let device = machine.places.config.join("device.json");
    machine.places.device = Some(device.clone());
    // The window writes what the system says; the look follows it.
    for (says, glass) in [
        ("{}", true),
        (r#"{"reduce_transparency":true}"#, false),
        (r#"{"high_contrast":true}"#, false),
        (
            r#"{"reduce_transparency":false,"high_contrast":false}"#,
            true,
        ),
    ] {
        write(&device, says);
        let resolved = resolve(&machine.places, &|| None, &[], &Default::default());
        let look = resolved.look;
        assert!(look.problems.is_empty(), "{:?}", look.problems);
        assert_eq!(look.desk.glass, glass, "{says}");
        assert_eq!(look.schemes.light_glass.is_some(), glass, "{says}");
        assert!(resolved.watched.contains(&device), "the look follows it");
    }
    // The Person's own setting stays as they said it.
    machine.look_toml("[desk]\nglass = false\nwallpaper = \"wall.png\"\n");
    write(&device, "{}");
    assert!(!machine.look().desk.glass);
}

#[test]
fn glass_is_worked_out_from_the_solid_colours_and_a_theme_corrects_it() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "sea",
        r##"[colors]
background = { light = "#ffffff", dark = "#0e1a1c" }
foreground = { light = "#18181b", dark = "#ededef" }

[glass]
opacity = 0.5

[glass.tokens]
border = { light = "#0000001f" }
"##,
    );
    // A light wallpaper, which a light theme's desk reads over as it is.
    picture(&machine.places.config.join("wall.png"), [235, 235, 235]);
    machine.look_toml("theme = \"sea\"\n[desk]\nglass = false\nwallpaper = \"wall.png\"\n");
    let solid = machine.look();
    assert!(solid.problems.is_empty(), "{:?}", solid.problems);
    assert!(!solid.desk.glass);
    assert_eq!(solid.schemes.light_glass, None);
    assert_eq!(solid.schemes.dark_glass, None);
    assert_eq!(color(&solid, false, "--tile"), "#ffffff");
    assert_eq!(
        color(&solid, true, "--panel"),
        color(&solid, true, "--sidebar")
    );

    machine.look_toml("theme = \"sea\"\n[desk]\nwallpaper = \"wall.png\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert!(look.desk.glass);
    let light = look.schemes.light_glass.as_ref().unwrap();
    let dark = look.schemes.dark_glass.as_ref().unwrap();
    // The theme's `[glass] opacity`: the desk half solid, the tiles
    // solid, the panel halfway. The dark desk is denser over the light
    // wallpaper, for its text to read (ADR 0111).
    assert_eq!(look.vars["--desk-opacity"], "50%");
    assert_eq!(light["--desk"], "rgb(255 255 255 / 0.5)");
    assert_eq!(light["--tile"], "rgb(255 255 255)");
    assert!(
        light["--panel"].ends_with(" / 0.75)"),
        "{}",
        light["--panel"]
    );
    assert_ne!(dark["--desk"], "rgb(14 26 28 / 0.5)");
    // ADR 0036's: the fills, lines and quiet text are the text, thinned,
    // but where the theme corrects one.
    assert!(dark["--muted"].ends_with(" / 0.1)"), "{}", dark["--muted"]);
    assert!(
        dark["--border"].ends_with(" / 0.1)"),
        "{}",
        dark["--border"]
    );
    assert!(light["--muted-foreground"].ends_with(" / 0.62)"));
    assert_eq!(light["--border"], "#0000001f");
    // The rest is the solid scheme's.
    assert_eq!(light["--primary"], color(&look, false, "--primary"));
    assert_eq!(light["--background"], "#ffffff");

    // A key `[glass]` does not have is still named, at its line.
    theme_toml(&machine, "sea", "[glass]\nopacity = 0.5\nblurr = 3\n");
    let problems = machine.look().problems;
    assert!(
        problems
            .iter()
            .any(|p| p.message.contains("blurr") && p.line.is_some()),
        "{problems:?}"
    );
}

/// Over Banda's glass, the desk is as dense as its text needs over the
/// wallpaper, the dark one for the dark scheme (ADR 0111).
#[test]
fn the_desk_is_as_dense_as_its_text_needs_over_the_wallpaper() {
    let machine = Machine::new(false);
    let walls = machine.places.config.join("walls");
    let desk = |look: &Look, dark: bool| {
        let schemes = &look.schemes;
        let scheme = if dark {
            &schemes.dark_glass
        } else {
            &schemes.light_glass
        };
        scheme.as_ref().unwrap()["--desk"].clone()
    };
    // Black: Banda's dark desk keeps its tint; the light one is as dense
    // as the worst backdrops would make it, black among them.
    picture(&walls.join("black.png"), [0, 0, 0]);
    machine.look_toml("[desk]\nwallpaper = \"walls/black.png\"\n");
    let black = machine.look();
    assert!(black.problems.is_empty(), "{:?}", black.problems);
    assert_eq!(desk(&black, true), "rgb(25 25 28 / 0.4)");
    assert_eq!(desk(&black, false), "rgb(255 255 255 / 0.571)");
    // A picture the resolver does not read: both as dense as that.
    write(&walls.join("night.jxl"), "a picture");
    machine.look_toml("[desk]\nwallpaper = \"walls/night.jxl\"\n");
    let unread = machine.look();
    assert_eq!(desk(&unread, true), "rgb(25 25 28 / 0.673)");
    assert_eq!(desk(&unread, false), desk(&black, false));
    // White by day and black by night: each scheme over its own, both as
    // clear as the theme says.
    picture(&walls.join("white.png"), [255, 255, 255]);
    machine.look_toml(
        "[desk]\nwallpaper = \"walls/white.png\"\nwallpaper-dark = \"walls/black.png\"\n",
    );
    let both = machine.look();
    assert_eq!(desk(&both, false), "rgb(255 255 255 / 0.4)");
    assert_eq!(desk(&both, true), "rgb(25 25 28 / 0.4)");
}

#[test]
fn a_theme_of_only_seeds_takes_the_rest_from_the_platform() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "seeds",
        "[colors]\naccent = \"#c2410c\"\nbackground = { light = \"#fbf8f3\", dark = \"#1d1a16\" }\nforeground = { light = \"#2b2620\", dark = \"#ece4d8\" }\n",
    );
    machine.look_toml("theme = \"seeds\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    // Each scheme is complete: the palette worked out, then its tokens,
    // over Banda's own, this device's (ADR 0100, decision 2): the accent
    // marks the focus, and the buttons take the text's colour as Banda's do.
    for (dark, ink) in [(false, "#2b2620"), (true, "#ece4d8")] {
        assert_eq!(color(&look, dark, "--focus"), "#c2410c");
        assert_eq!(color(&look, dark, "--primary"), ink);
        for var in [
            "--card",
            "--sidebar-accent",
            "--border",
            "--ansi-8",
            "--block",
        ] {
            assert!(!color(&look, dark, var).is_empty(), "{var}");
        }
    }
    assert_eq!(color(&look, true, "--background"), "#1d1a16");
    assert_eq!(color(&look, true, "--attention"), "#ff8a3d");

    // Under Omarchy the platform is its current theme, of one scheme.
    let machine = Machine::new(true);
    theme_toml(&machine, "seeds", "[colors]\naccent = \"#c2410c\"\n");
    machine.look_toml("theme = \"seeds\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.mode, Shown::Dark);
    assert_eq!(color(&look, true, "--background"), "#19251f");
    assert_eq!(color(&look, true, "--primary"), "#c2410c");
}

#[test]
fn a_theme_extends_another_and_so_on() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "dusk",
        "extends = \"warm\"\n[colors]\nbackground = { dark = \"#101418\" }\n",
    );
    theme_toml(
        &machine,
        "warm",
        "extends = \"banda\"\n[colors]\naccent = \"#c2410c\"\n[shape]\ncontrol = 3\n[tokens]\nattention = \"#ff0000\"\n",
    );
    machine.look_toml("theme = \"dusk\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    // dusk's own background, warm's accent, shape and token, and Banda's
    // colours and tokens under them.
    assert_eq!(color(&look, true, "--background"), "#101418");
    assert_eq!(color(&look, false, "--background"), "#ffffff");
    assert_eq!(color(&look, false, "--focus"), "#c2410c");
    assert_eq!(color(&look, false, "--attention"), "#ff0000");
    assert_eq!(color(&look, false, "--primary"), "#18181b");
    assert_eq!(color(&look, true, "--card"), "#1f1f23");
    assert_eq!(look.vars["--control-radius"], "3px");
    let names: Vec<_> = look.sources.iter().filter_map(|s| s.name.clone()).collect();
    assert_eq!(names, ["dusk-light", "dusk-dark"]);
}

#[test]
fn a_theme_on_the_platform_takes_what_the_device_shows() {
    // Under Omarchy, "platform" is its current theme, dark: a theme over
    // it is dark too.
    let machine = Machine::new(true);
    theme_toml(
        &machine,
        "mine",
        "extends = \"platform\"\n[colors]\naccent = \"#c2410c\"\n",
    );
    machine.look_toml("theme = \"mine\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(look.mode, Shown::Dark);
    assert!(look.schemes.light.is_none());
    assert_eq!(color(&look, true, "--background"), "#19251f");
    assert_eq!(color(&look, true, "--focus"), "#c2410c");
    assert_eq!(look.sources[1].name.as_deref(), Some("mine"));

    // "platform" as look.toml's theme is the device's own, as no theme.
    machine.look_toml("theme = \"platform\"\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(color(&look, true, "--background"), "#19251f");

    // Elsewhere it is Banda's own.
    let machine = Machine::new(false);
    theme_toml(&machine, "mine", "extends = \"platform\"\n");
    machine.look_toml("theme = \"mine\"\n");
    let look = machine.look();
    assert_eq!(look.mode, Shown::System);
    assert_eq!(color(&look, true, "--background"), "#19191c");
}

#[test]
fn a_base_that_is_not_there_is_named_and_the_theme_takes_the_platform() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "lone",
        "extends = \"nope\"\n\n[colors]\naccent = \"#c2410c\"\n",
    );
    machine.look_toml("theme = \"lone\"\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1, "{:?}", look.problems);
    let problem = &look.problems[0];
    assert!(problem.message.contains("no theme \"nope\""), "{problem}");
    assert!(
        problem.message.ends_with("extends \"platform\""),
        "{problem}"
    );
    assert_eq!(problem.line, Some(1));
    assert!(problem.path.ends_with("theme.toml"), "{problem}");
    assert_eq!(color(&look, false, "--focus"), "#c2410c");
    assert_eq!(color(&look, false, "--background"), "#ffffff");
}

#[test]
fn a_theme_that_does_not_read_says_so_and_banda_shows() {
    let machine = Machine::new(false);
    machine.look_toml("theme = \"bent\"\n");
    for (text, said) in [
        ("[colors\naccent = \"#c2410c\"\n", "unclosed table"),
        ("names = \"bent\"\n", "unknown field"),
    ] {
        theme_toml(&machine, "bent", text);
        let look = machine.look();
        let messages: Vec<_> = look.problems.iter().map(|p| p.message.as_str()).collect();
        assert_eq!(messages.len(), 2, "{messages:?}");
        assert!(messages[0].contains(said), "{messages:?}");
        assert_eq!(
            messages[1],
            "theme = \"bent\" does not read; Banda's own shows"
        );
        assert!(look.problems[0].left_out, "{messages:?}");
        assert_eq!(color(&look, false, "--background"), "#ffffff");
    }

    // A token the list does not have, or that is not a value, is named
    // and left out; the theme shows.
    theme_toml(
        &machine,
        "bent",
        "[tokens]\ncrad = \"#ffffff\"\ncard = \"color-mix(in oklab, red 10%, blue)\"\n",
    );
    let look = machine.look();
    let messages: Vec<_> = look.problems.iter().map(|p| p.message.as_str()).collect();
    assert_eq!(messages.len(), 2, "{messages:?}");
    assert!(
        messages[0].starts_with("tokens.card is a palette name"),
        "{messages:?}"
    );
    assert_eq!(messages[1], "there is no token \"crad\"");
    assert_eq!(look.sources[1].name.as_deref(), Some("bent-light"));
    assert_eq!(color(&look, false, "--card"), "#ffffff");

    // And so in look.toml.
    machine.look_toml("theme = \"banda\"\n[tokens]\ncrad = \"#ffffff\"\ngap-inner = \"4px\"\n");
    let look = machine.look();
    let messages: Vec<_> = look.problems.iter().map(|p| p.message.as_str()).collect();
    assert_eq!(messages.len(), 2, "{messages:?}");
    assert_eq!(messages[0], "there is no token \"crad\"");
    assert!(messages[1].contains("is a length"), "{messages:?}");
    assert_eq!(look.problems[0].key.as_deref(), Some("tokens.crad"));
    assert!(!look.schemes.light.as_ref().unwrap().contains_key("--crad"));
    assert_eq!(look.vars["--gap-inner"], "8px");
}

#[test]
fn a_ring_of_themes_is_refused_and_each_still_shows() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "a",
        "extends = \"b\"\n[colors]\naccent = \"#c2410c\"\n",
    );
    theme_toml(
        &machine,
        "b",
        "extends = \"a\"\n[colors]\nbackground = \"#101418\"\n",
    );
    machine.look_toml("theme = \"a\"\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1, "{:?}", look.problems);
    let problem = &look.problems[0];
    assert!(problem.message.contains("comes back round"), "{problem}");
    assert!(
        Path::new(&problem.path).ends_with("b/theme.toml"),
        "{problem}"
    );
    // b stands alone and a over it.
    assert_eq!(color(&look, false, "--focus"), "#c2410c");
    assert_eq!(color(&look, false, "--background"), "#101418");

    // A theme that extends itself the same.
    theme_toml(&machine, "a", "extends = \"a\"\n");
    let look = machine.look();
    assert_eq!(look.problems.len(), 1, "{:?}", look.problems);
}

#[test]
fn a_pair_takes_each_scheme_of_a_theme_of_both() {
    let machine = Machine::new(false);
    theme_toml(
        &machine,
        "sea",
        "[colors]\nbackground = { light = \"#f7fbfb\", dark = \"#0e1a1c\" }\n",
    );
    machine.look_toml("theme = { light = \"sea\", dark = \"banda\" }\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert_eq!(color(&look, false, "--background"), "#f7fbfb");
    assert_eq!(color(&look, true, "--background"), "#19191c");
    let names: Vec<_> = look.sources.iter().filter_map(|s| s.name.clone()).collect();
    assert_eq!(names, ["sea-light", "banda-dark"]);
}

#[test]
fn a_theme_toml_is_checked_as_it_is_written() {
    let path = Path::new("themes/sea/theme.toml");
    let problems = banda_look::check_text(path, "[shape]\nradiuss = 3\n");
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].message.contains("radiuss"), "{}", problems[0]);
    let problems = banda_look::check_text(path, "[tokens]\ncard = \"red; --x: 1\"\n");
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].line, Some(2));
    let problems = banda_look::check_text(path, "[shape]\nradius = -1\n");
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(banda_look::check_text(path, "extends = \"banda\"\n").is_empty());
}
