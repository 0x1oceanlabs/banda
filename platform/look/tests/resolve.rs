//! The look as a Person meets it: their files, Omarchy's theme and
//! Hyprland's windows, in throwaway folders.

use banda_look::hyprland::Windows;
use banda_look::motion::Move;
use banda_look::settings::{GroupAsking, GroupSaturation, GroupWorking, Material, SidebarStyle};
use banda_look::theme::{Origin, Places};
use banda_look::{Look, Shown, follow, resolve};
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
    fn background(&self, name: &str) -> PathBuf {
        let link = self.places.omarchy_background.as_ref().unwrap();
        let picture = link.with_file_name("theme/backgrounds").join(name);
        write(&picture, "a picture");
        let _ = fs::remove_file(link);
        std::os::unix::fs::symlink(&picture, link).unwrap();
        fs::canonicalize(picture).unwrap()
    }
}

/// The path of the picture the desk is made of, if any.
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
    // Banda's shape (ADR 0075, decision 1): tiles 10 round, hairlines,
    // gaps 8, and the focused tile lifts off the desk.
    assert_eq!(look.vars["--radius"], "7px");
    assert_eq!(look.vars["--tile-radius"], "9.8px");
    assert_eq!(look.vars["--tile-border"], "1px");
    assert_eq!(look.vars["--gap-inner"], "8px");
    assert_eq!(look.vars["--bar-height"], "36px");
    assert_eq!(look.vars["--focus-shadow-strength"], "0.25");
    assert_eq!(look.vars["--tile-dim"], "0");
    // Banda's colours (ADR 0075, decision 4), as globals.css has them.
    assert_eq!(color(&look, false, "--desk-solid"), "#f4f4f5");
    assert_eq!(color(&look, true, "--desk-solid"), "#111113");
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
fn under_hyprland_the_tiles_look_like_its_windows() {
    let machine = Machine::new(true);
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--tile-radius"], "12px");
    assert_eq!(look.vars["--radius"], "8.571px");
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
    assert_eq!(look.vars["--tile-radius"], "8.571px");

    machine.look_toml("hyprland = false\n");
    let look = machine.under_hyprland();
    assert_eq!(look.vars["--tile-radius"], "9.8px");
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
    assert_eq!(bar.left, ["workspaces.list"]);
    assert_eq!(bar.center, ["sidebar.counts"]);
    assert_eq!(
        bar.right,
        [
            "workspaces.aside",
            "terminal.ports",
            "harnesses.limits",
            "notifications.recent"
        ]
    );

    // A list replaces Banda's for its part, and [] empties it.
    machine.look_toml("[bar]\ncenter = []\nright = [\"git.branch\", \"workspaces.aside\"]\n");
    let look = machine.look();
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    assert!(look.bar.center.is_empty());
    assert_eq!(look.bar.right, ["git.branch", "workspaces.aside"]);
    let right = &look.settings["look.toml"]["bar.right"].from;
    assert_eq!((right.layer.as_str(), right.line), ("file", Some(3)));
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
    assert_eq!(look.vars["--tile-radius"], "0px");
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
    assert!(look.settings["sidebar.toml"].contains_key("group.by"));
}

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
        fs::canonicalize(path).unwrap().display().to_string()
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
    // The accent is the system's, which the window sets (ADR 0075,
    // decision 6); [colors] accent still wins.
    assert_eq!(color(&look, false, "--focus"), "var(--system-accent)");
    assert_eq!(color(&look, true, "--primary"), "var(--system-accent)");
    assert_eq!(color(&look, true, "--desk-solid"), "#28282a");

    machine.look_toml("[colors]\naccent = \"#e07a3f\"\n");
    assert_eq!(color(&machine.look(), false, "--focus"), "#e07a3f");

    // Anywhere else it is a theme to pick.
    machine.places.mac = false;
    machine.look_toml("theme = \"macos\"\n");
    assert_eq!(machine.look().vars["--bar-height"], "38px");
}
