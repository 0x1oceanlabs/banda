//! How Banda tells its Person of a call, as the look sets it (ADR 0011,
//! decision 7): `[notify]` in `look.toml` and in a theme's `banda.toml`,
//! layered as every other key of the look, beside `[sound]`. The window
//! tells; here it is only chosen.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// When a call becomes a system notification.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "look/")]
pub enum System {
    /// When the window is not in front.
    Away,
    /// Always, instead of a toast too.
    Always,
    Off,
}

/// When a call becomes a toast in the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "look/")]
pub enum Toasts {
    /// For a thing whose Pane is not on screen.
    OutOfSight,
    /// For one on screen too.
    Always,
    Off,
}

/// Whose quiet Banda keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "look/")]
pub enum Quiet {
    /// The desktop's: nothing but the Marks while its Do Not Disturb is on.
    Desktop,
    /// None: Banda tells its Person regardless.
    Never,
}

/// `[notify]` as one layer says it: every key optional.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct NotifySettings {
    pub system: Option<System>,
    pub window: Option<Toasts>,
    /// What the Thread said, in the words; false shows only its title.
    pub detail: Option<bool>,
    pub quiet: Option<Quiet>,
    pub done: Option<bool>,
    pub asking: Option<bool>,
    pub failed: Option<bool>,
}

/// How the window tells of a call, every key resolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Notify {
    pub system: System,
    pub window: Toasts,
    pub detail: bool,
    pub quiet: Quiet,
    /// Which calls notify: a Thread finished, asks, or failed.
    pub done: bool,
    pub asking: bool,
    pub failed: bool,
}

impl NotifySettings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: NotifySettings) -> NotifySettings {
        NotifySettings {
            system: self.system.or(under.system),
            window: self.window.or(under.window),
            detail: self.detail.or(under.detail),
            quiet: self.quiet.or(under.quiet),
            done: self.done.or(under.done),
            asking: self.asking.or(under.asking),
            failed: self.failed.or(under.failed),
        }
    }

    /// Every key: what the layers said, else Banda's own.
    pub fn resolved(&self) -> Notify {
        let own = Notify::default();
        Notify {
            system: self.system.unwrap_or(own.system),
            window: self.window.unwrap_or(own.window),
            detail: self.detail.unwrap_or(own.detail),
            quiet: self.quiet.unwrap_or(own.quiet),
            done: self.done.unwrap_or(own.done),
            asking: self.asking.unwrap_or(own.asking),
            failed: self.failed.unwrap_or(own.failed),
        }
    }
}

impl Default for Notify {
    /// Banda's own (ADR 0011): a notification when the window is behind, a
    /// toast for what is out of sight, the words, the desktop's quiet.
    /// `DEFAULT_NOTIFY` in `app/web/src/calls/settings.ts` says the same
    /// till the look comes.
    fn default() -> Notify {
        Notify {
            system: System::Away,
            window: Toasts::OutOfSight,
            detail: true,
            quiet: Quiet::Desktop,
            done: true,
            asking: true,
            failed: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notify(text: &str) -> Result<NotifySettings, toml::de::Error> {
        toml::from_str(text)
    }

    #[test]
    fn the_defaults_tell_once_where_the_person_looks() {
        let notify = NotifySettings::default().resolved();
        assert_eq!(notify.system, System::Away);
        assert_eq!(notify.window, Toasts::OutOfSight);
        assert!(notify.detail);
        assert_eq!(notify.quiet, Quiet::Desktop);
        assert!(notify.done && notify.asking && notify.failed);
    }

    #[test]
    fn a_layer_changes_only_what_it_says() {
        let mine = notify("window = \"off\"\ndone = false\n").unwrap();
        let theirs = notify("system = \"always\"\nwindow = \"always\"\n").unwrap();
        let notify = mine.over(theirs).resolved();
        assert_eq!(notify.system, System::Always);
        assert_eq!(notify.window, Toasts::Off);
        assert!(!notify.done);
        assert!(notify.asking);
    }

    #[test]
    fn a_wrong_value_names_the_right_ones() {
        let wrong = notify("system = \"sometimes\"\n").unwrap_err();
        assert!(wrong.message().contains("sometimes"), "{wrong}");
        assert!(wrong.message().contains("away"), "{wrong}");
        let wrong = notify("window = \"out_of_sight\"\n").unwrap_err();
        assert!(wrong.message().contains("out-of-sight"), "{wrong}");
        let typo = notify("details = false\n").unwrap_err();
        assert!(typo.message().contains("details"), "{typo}");
    }

    #[test]
    fn the_window_reads_it_as_the_ui_names_it() {
        let notify = notify("window = \"out-of-sight\"\nquiet = \"never\"\n")
            .unwrap()
            .resolved();
        let json = serde_json::to_value(notify).unwrap();
        assert_eq!(json["system"], "away");
        assert_eq!(json["window"], "out-of-sight");
        assert_eq!(json["quiet"], "never");
        assert_eq!(json["detail"], true);
    }
}
