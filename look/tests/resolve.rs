//! The look as a Person meets it: their files, Omarchy's theme and
//! Hyprland's windows, in throwaway folders.

use banda_look::hyprland::Windows;
use banda_look::motion::Move;
use banda_look::settings::{Material, SidebarStyle};
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
            },
            _dir: dir,
        }
    }

    fn look_toml(&self, text: &str) {
        write(&self.places.look_file(), text);
    }

    fn look(&self) -> Look {
        resolve(&self.places, &|| None, &[]).look
    }

    fn under_hyprland(&self) -> Look {
        let windows = Windows {
            rounding: 12.0,
            border: 2.0,
            gaps: 5.0,
            dim: Some(0.4),
            animations: true,
        };
        resolve(&self.places, &|| Some(windows), &[]).look
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
    assert_eq!(look.vars["--radius"], "10px");
    assert_eq!(look.vars["--tile-radius"], "14px");
    assert_eq!(look.vars["--tile-border"], "2px");
    assert_eq!(look.vars["--gap-inner"], "12px");
    assert_eq!(look.vars["--bar-height"], "36px");
    assert_eq!(look.vars["--tile-dim"], "0");
    // shadcn's own tokens, as globals.css has them today.
    assert_eq!(color(&look, false, "--border"), "oklch(0.922 0 0)");
    assert_eq!(color(&look, true, "--card"), "oklch(0.205 0 0)");
    assert_eq!(color(&look, false, "--attention"), "oklch(0.68 0.21 41)");
    // The focused tile takes the strongest colour, --primary.
    assert_eq!(color(&look, false, "--focus"), "#171717");
    assert_eq!(color(&look, true, "--focus"), "#e5e5e5");
    assert_eq!(color(&look, false, "--primary"), "#171717");
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
    assert!(look.sources.iter().any(|s| s.layer == "hyprland"));
}

#[test]
fn the_desk_is_banda_glass_made_of_the_wallpaper() {
    let machine = Machine::new(true);
    // No wallpaper Banda knows of: the desk is solid, and the tiles keep
    // Hyprland's gaps.
    let solid = machine.under_hyprland();
    assert!(!solid.desk.glass);
    assert_eq!(picture_of(&solid), None);
    assert_eq!(solid.vars["--gap-inner"], "5px");

    // Omarchy's background: Banda's glass is made of it, the same
    // everywhere, and the tiles float in Banda's own gaps.
    let picture = machine.background("1-mountains.jpg");
    let glass = machine.under_hyprland();
    assert!(glass.desk.glass);
    assert_eq!(glass.desk.material, Material::Banda);
    assert_eq!(picture_of(&glass), Some(picture.display().to_string()));
    assert_eq!(glass.desk.wallpaper.as_ref().unwrap().from, "Omarchy");
    assert_eq!(glass.desk.sidebar, SidebarStyle::Panel);
    assert_eq!(glass.vars["--gap-inner"], "12px");
    assert_eq!(glass.vars["--desk-blur"], "40px");
    assert_eq!(glass.vars["--desk-saturation"], "1.4");
    assert_eq!(glass.vars["--desk-grain"], "0.04");
    assert_eq!(glass.vars["--desk-opacity"], "40%");
    assert_eq!(glass.vars["--tile-opacity"], "95%");
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
    assert_eq!(look.vars["--tile-radius"], "14px");
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
fn columns_and_fonts_come_through_the_layers() {
    let machine = Machine::new(false);
    let look = machine.look();
    assert_eq!(look.columns.presets, ["1/3", "1/2", "2/3", "1"]);
    assert_eq!(look.vars["--font-family-mono"], "monospace");
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
    assert_eq!(look.vars["--gap-inner"], "12px");
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
    std::thread::spawn(move || follow(&places, None, &[], |look| seen.send(look.clone()).is_ok()));
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
        // Examples, not defaults: a theme's name, a picture of one's own.
        .filter(|line| !line.starts_with("# theme") && !line.starts_with("# wallpaper"))
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
    let machine = Machine::new(false);
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
    let picture = |name: &str| {
        let path = home.join("Pictures").join(name);
        write(&path, "a picture");
        fs::canonicalize(path).unwrap().display().to_string()
    };
    // No desktop Banda knows: the desk is solid, quietly.
    assert_eq!(from(&machine), None);
    assert!(machine.look().problems.is_empty());

    // GNOME, through gsettings, which answers from its files here: a URI,
    // escapes and all.
    let gsettings = home.join("bin/gsettings");
    write(
        &gsettings,
        "#!/bin/sh\ncat \"$(dirname \"$0\")/$2.$3\" 2>/dev/null || exit 1\n",
    );
    fs::set_permissions(
        &gsettings,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    machine.places.gsettings = Some(gsettings.clone());
    machine.places.desktops = vec!["ubuntu".into(), "gnome".into()];
    let sea = picture("the sea.jpg");
    let said = home.join("bin/org.gnome.desktop.background.picture-uri");
    write(&said, &format!("'file://{}'\n", sea.replace(' ', "%20")));
    assert_eq!(from(&machine), Some(("GNOME", sea.clone())));
    // Its setting changes, and dconf's file with it: the look asks again.
    let resolved = resolve(&machine.places, &|| None, &[]);
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
    write(&said, &format!("'{}'\n", show.display()));
    assert_eq!(from(&machine), Some(("GNOME", still.clone())));

    // A picture the page cannot draw: solid, and the look says why.
    write(&said, &format!("'{}'\n", picture("mac.heic")));
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
        &home.join("bin/org.mate.background.picture-filename"),
        &format!("'{sea}'\n"),
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
    assert!(large.ends_with("3840x2160.png"), "{large}");

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
