//! `machine.toml`: this machine's name and icon (ADR 0095, decision 2),
//! whether Banda starts at login here (ADR 0086, decision 1), and when it
//! stays awake (ADR 0097, decisions 1 and 2). It is a file of the host's
//! (ADR 0081, decision 12): only this machine reads it, and a window
//! elsewhere changes it through this machine's engine.
//! The settings know it as every file (ADR 0016): its schema, the text it
//! starts as, and its check; this says what it makes of what Banda found.

use crate::awake::Awake;
use banda_kernel::{MachineIcon, NAME_MOST, Named};
use banda_look::{Problem, SettingsFile};
use schemars::JsonSchema;
use serde::Deserialize;
use std::io;
use std::path::Path;

/// Its name in the config folder.
pub const NAME: &str = "machine.toml";

/// `machine.toml` as the settings know it.
pub const FILE: SettingsFile = SettingsFile::new::<MachineFile>(NAME, template, check);

/// This machine's name and icon, as every window shows it beside its
/// Projects and Threads, whether Banda starts at login here, and when it
/// stays awake. Each key is optional: Banda finds what is left out.
#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub(crate) struct MachineFile {
    /// Its name, up to 16 characters. Left out or empty: its hostname, or
    /// a word for a hostname the system made up.
    #[schemars(length(max = 16))]
    pub name: Option<String>,
    /// Its icon. Left out: what Banda finds the machine is, as a laptop by
    /// its battery.
    pub icon: Option<MachineIcon>,
    /// Start Banda at login: its engine starts as you log in, so its
    /// Agents and other machines find it running. Off, it starts as you
    /// open Banda. On by default; macOS has it so far, Linux next.
    pub start_at_login: Option<bool>,
    /// Stay awake while Agents work: this machine does not idle-sleep
    /// while a Turn runs here, and for 10 minutes after, so a message
    /// from another machine finds it awake. Its display still sleeps, and
    /// closing a MacBook's lid still sleeps it. On by default; macOS and
    /// Linux have it so far.
    pub awake_while_working: Option<bool>,
    /// Stay awake while plugged in: on power, this machine does not
    /// idle-sleep, Agents or none, so other machines reach it. One with
    /// no battery is always on power. Off by default.
    pub awake_plugged_in: Option<bool>,
}

/// What `machine.toml` says, over what Banda found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Said {
    /// The machine's name and icon.
    pub named: Named,
    /// Whether Banda starts at login: unless the file says it does not.
    pub at_login: bool,
    /// When the machine stays awake.
    pub awake: Awake,
}

fn template() -> String {
    include_str!("../machine.toml").to_owned()
}

fn check(path: &Path, text: &str) -> Vec<Problem> {
    let mut problems = Vec::new();
    read(path, text, &mut problems);
    problems
}

/// What `text`, the file at `path`, says: a key that is wrong is named in
/// `problems` and left out, as an icon Banda has not, and the rest reads.
fn read(path: &Path, text: &str, problems: &mut Vec<Problem>) -> MachineFile {
    let mut file: MachineFile = banda_look::read(path, text, problems).unwrap_or_default();
    if let Some(Err(why)) = file.name.as_deref().map(fits) {
        problems.push(Problem::of_key(path, "name", why));
        file.name = None;
    }
    file
}

/// Why `name` cannot name a machine. Empty, it names none: Banda finds one.
fn fits(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.chars().count() > NAME_MOST {
        Err(format!("name is {NAME_MOST} characters at most"))
    } else if name.chars().any(char::is_control) {
        Err("name is one line, with no tab".to_owned())
    } else {
        Ok(())
    }
}

/// What the file at `path` holds; none while it is not there. One that
/// cannot be read is named in the log, and is none.
pub(crate) fn held(path: &Path) -> Option<Vec<u8>> {
    match std::fs::read(path) {
        Ok(held) => Some(held),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            tracing::warn!(%error, file = NAME, "not read: the machine is named as Banda found it");
            None
        }
    }
}

/// What `held`, the file at `path`, says, over what Banda `found`: with no
/// file, or one that is not UTF-8, what was found, and Banda starting at
/// login. What is wrong in it goes to the log, as the look names it to the
/// Person.
pub(crate) fn said(path: &Path, held: Option<&[u8]>, found: &Named) -> Said {
    let file = logged(path, held);
    let name = (file.name.as_deref().map(str::trim)).filter(|name| !name.is_empty());
    Said {
        named: Named {
            name: name.map_or_else(|| found.name.clone(), str::to_owned),
            icon: file.icon.unwrap_or(found.icon),
        },
        at_login: at_login(&file),
        awake: awake(&file),
    }
}

/// Whether Banda starts at login, as `file` says: unless it says not.
pub(crate) fn at_login(file: &MachineFile) -> bool {
    file.start_at_login.unwrap_or(true)
}

/// When the machine stays awake, as `file` says: while Agents work unless
/// it says not, and while plugged in only where it says so.
pub(crate) fn awake(file: &MachineFile) -> Awake {
    Awake {
        while_working: file.awake_while_working.unwrap_or(true),
        plugged_in: file.awake_plugged_in.unwrap_or(false),
    }
}

/// What `held`, the file at `path`, holds: nothing with no file, or one
/// that is not UTF-8. What is wrong in it goes to the log.
pub(crate) fn logged(path: &Path, held: Option<&[u8]>) -> MachineFile {
    let text = held.and_then(|held| {
        (std::str::from_utf8(held).inspect_err(|error| {
            tracing::warn!(%error, file = NAME, "not UTF-8: the machine is named as Banda found it");
        }))
        .ok()
    });
    let mut problems = Vec::new();
    let file = text.map_or_else(MachineFile::default, |text| read(path, text, &mut problems));
    for problem in &problems {
        tracing::warn!(%problem, file = NAME);
    }
    file
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found() -> Named {
        Named {
            name: "arc".to_owned(),
            icon: MachineIcon::Server,
        }
    }

    fn named(path: &Path, held: Option<&[u8]>, found: &Named) -> Named {
        said(path, held, found).named
    }

    fn read_text(text: &str) -> (Named, Vec<Problem>) {
        let path = Path::new("/c/machine.toml");
        (
            named(path, Some(text.as_bytes()), &found()),
            check(path, text),
        )
    }

    #[test]
    fn what_the_file_leaves_out_is_what_banda_found() {
        let path = Path::new("/c/machine.toml");
        assert_eq!(named(path, None, &found()), found());
        for text in ["", "name = \"\"\n", "name = \"   \"\n", &template()] {
            let (named, problems) = read_text(text);
            assert_eq!(named, found(), "{text:?}");
            assert!(problems.is_empty(), "{text:?}: {problems:?}");
        }
    }

    #[test]
    fn the_file_names_the_machine_trimmed() {
        let (named, problems) = read_text("name = \"  studio \"\nicon = \"tower\"\n");
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(
            named,
            Named {
                name: "studio".to_owned(),
                icon: MachineIcon::Tower
            }
        );
        let (named, _) = read_text("name = \"Сервер у окна №1\"\n");
        assert_eq!(named.name, "Сервер у окна №1", "16 characters, not bytes");
    }

    #[test]
    fn a_name_too_long_or_an_icon_banda_has_not_is_named_and_found_again() {
        let (named, problems) = read_text("name = \"a-name-of-17-char\"\nicon = \"laptop\"\n");
        assert_eq!(named.name, "arc");
        assert_eq!(named.icon, MachineIcon::Laptop, "the rest reads");
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].key.as_deref(), Some("name"));
        assert!(problems[0].message.contains("16 characters"));

        let (named, problems) = read_text("name = \"studio\"\nicon = \"toaster\"\n");
        assert_eq!(named.name, "studio");
        assert_eq!(named.icon, MachineIcon::Server);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].line, Some(2));

        let (named, problems) = read_text("name = \"two\\nlines\"\nnote = 1\n");
        assert_eq!(named, found());
        assert_eq!(problems.len(), 2, "{problems:?}");
    }

    #[test]
    fn a_file_that_is_not_toml_or_not_utf8_names_what_banda_found() {
        let (said, problems) = read_text("name = \nicon = \"tower\"\n");
        assert_eq!(said, found(), "no key of a file that does not read");
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].line, Some(1));

        let path = Path::new("/c/machine.toml");
        let latin1 = b"name = \"caf\xe9\"\n";
        assert_eq!(named(path, Some(latin1), &found()), found());
    }

    #[test]
    fn banda_starts_at_login_unless_the_file_says_it_does_not() {
        let path = Path::new("/c/machine.toml");
        let at_login = |text: &str| said(path, Some(text.as_bytes()), &found()).at_login;
        assert!(said(path, None, &found()).at_login, "with no file");
        assert!(at_login(&template()));
        assert!(at_login("start-at-login = true\n"));
        assert!(!at_login("start-at-login = false\n"));
        assert!(!at_login("name = \"studio\"\nstart-at-login = false\n"));
        // A file that does not read leaves it on.
        assert!(at_login("start-at-login = \"no\"\n"));
        let (_, problems) = read_text("start-at-login = \"no\"\n");
        assert_eq!(problems.len(), 1, "{problems:?}");
    }

    #[test]
    fn the_machine_stays_awake_while_agents_work_and_plugged_in_only_as_the_file_says() {
        let path = Path::new("/c/machine.toml");
        let awake = |text: &str| said(path, Some(text.as_bytes()), &found()).awake;
        let default = Awake {
            while_working: true,
            plugged_in: false,
        };
        assert_eq!(said(path, None, &found()).awake, default, "with no file");
        assert_eq!(awake(&template()), default);
        assert_eq!(awake("name = \"studio\"\n"), default);
        assert_eq!(
            awake("awake-while-working = false\nawake-plugged-in = true\n"),
            Awake {
                while_working: false,
                plugged_in: true
            }
        );
        assert_eq!(
            awake("awake-plugged-in = true\n"),
            Awake {
                while_working: true,
                plugged_in: true
            }
        );
        // A file that does not read leaves both as they are by default,
        // and is named.
        assert_eq!(awake("awake-plugged-in = \"yes\"\n"), default);
        let (_, problems) = read_text("awake-plugged-in = \"yes\"\n");
        assert_eq!(problems.len(), 1, "{problems:?}");
        let (_, problems) = read_text("awake-plugged-in = true\nawake-while-working = false\n");
        assert!(problems.is_empty(), "{problems:?}");
    }

    #[test]
    fn its_schema_offers_the_ten_icons_and_bounds_the_name() {
        let schema = serde_json::to_value(FILE.schema()).unwrap();
        assert_eq!(schema["title"], NAME);
        assert_eq!(schema["properties"]["name"]["maxLength"], 16);
        let icons = serde_json::to_string(&schema).unwrap();
        for icon in ["laptop", "desktop", "tower", "storage", "vm", "phone"] {
            assert!(icons.contains(&format!("\"{icon}\"")), "{icon}");
        }
        assert!(FILE.about().starts_with("This machine's name and icon"));
        let login = &schema["properties"]["start-at-login"];
        assert!(
            login["description"]
                .as_str()
                .unwrap()
                .starts_with("Start Banda at login")
        );
        for (key, words) in [
            ("awake-while-working", "Stay awake while Agents work"),
            ("awake-plugged-in", "Stay awake while plugged in"),
        ] {
            let key = &schema["properties"][key];
            assert_eq!(key["type"], "boolean", "{key}");
            assert!(key["description"].as_str().unwrap().starts_with(words));
        }
    }
}
