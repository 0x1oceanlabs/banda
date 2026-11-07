//! What the Person shares (ADR 0039, decision 4): their
//! `~/.config/banda/sharing.toml`, over Banda's defaults, which share
//! nothing. The first run's step and Settings → Sharing write it.
//!
//! The look resolves it, as `files["sharing.toml"]`, for the window to
//! draw; the engine reads the file itself each time it would send
//! ([`read`]), so a change by hand counts at once.

use banda_look::OneFile;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

/// The file as Banda writes it first, every default named.
pub const TEMPLATE: &str = include_str!("../sharing.toml");

/// What Banda sends to its makers. Every key is optional: what is left
/// out is not sent.
#[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SharingSettings {
    /// Send problem reports: what broke in Banda, where in its code, and
    /// its version and system. Each problem once a day.
    pub problems: Option<bool>,
    /// Send usage counts: one summary a day of how many Threads, Turns and
    /// Panes, by kind, and the country of the system's language. Never
    /// words, paths or names.
    pub usage: Option<bool>,
}

/// What the Person shares, every key resolved.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sharing/")]
pub struct Shares {
    pub problems: bool,
    pub usage: bool,
}

impl Shares {
    /// Whether anything is shared.
    pub fn any(self) -> bool {
        self.problems || self.usage
    }
}

impl OneFile for SharingSettings {
    const NAME: &'static str = "sharing.toml";
    const TEMPLATE: &'static str = TEMPLATE;
    type Resolved = Shares;

    fn defaults() -> Self {
        SharingSettings {
            problems: Some(false),
            usage: Some(false),
        }
    }

    fn over(self, under: Self) -> Self {
        SharingSettings {
            problems: self.problems.or(under.problems),
            usage: self.usage.or(under.usage),
        }
    }

    fn resolved(self) -> Shares {
        Shares {
            problems: self.problems.unwrap_or(false),
            usage: self.usage.unwrap_or(false),
        }
    }
}

/// What the file at `file` shares. A file that is missing or does not
/// read shares nothing; a key that does not read is not shared.
pub fn read(file: &Path) -> Shares {
    banda_look::file::read_at::<SharingSettings>(file)
        .map_or_else(Shares::default, OneFile::resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_shared_but_what_the_file_turns_on() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("sharing.toml");
        assert_eq!(read(&file), Shares::default());
        std::fs::write(&file, TEMPLATE).unwrap();
        assert_eq!(read(&file), Shares::default());
        std::fs::write(&file, "problems = true\n").unwrap();
        let shares = read(&file);
        assert!(shares.problems && !shares.usage);
        std::fs::write(&file, "problems = \"yes\"\nusage = true\n").unwrap();
        assert_eq!(
            read(&file),
            Shares {
                problems: false,
                usage: true
            }
        );
    }
}
