//! Banda's settings whole, for the tests of the settings and of the keys:
//! every part's files and window part, as the engine hands them from its
//! list of Apps (`settings` in engine/src/apps.rs), whose tests hold this
//! list to that one. Only tests read it, each by this file's path: the
//! Apps' crates are dev-dependencies, so Cargo keeps them from the code
//! that ships.

use banda_settings::{Part, Settings};

/// The parts, the window parts in the window's order, which is the
/// engine's to say (`WINDOW_ORDER` in engine/build.rs).
pub const PARTS: &[Part] = &[
    Part {
        id: "agents",
        files: &banda_agents::SETTINGS,
        window: Some(include_str!("../../../../apps/agents/window.json")),
    },
    Part {
        id: "terminal",
        files: &banda_terminal::SETTINGS,
        window: Some(include_str!("../../../../apps/terminal/window.json")),
    },
    Part {
        id: "browser",
        files: &banda_browser::SETTINGS,
        window: Some(include_str!("../../../../apps/browser/window.json")),
    },
    Part {
        id: "git",
        files: &[],
        window: Some(include_str!("../../../../apps/git/window.json")),
    },
    Part {
        id: "files",
        files: &banda_files::SETTINGS,
        window: Some(include_str!("../../../../apps/files/window.json")),
    },
    Part {
        id: "pulls",
        files: &[],
        window: Some(include_str!("../../../../apps/pulls/window.json")),
    },
    Part {
        id: "harnesses",
        files: &banda_harnesses::SETTINGS,
        window: Some(include_str!("../../../../platform/harnesses/window.json")),
    },
    Part {
        id: "notifications",
        files: &[],
        window: Some(include_str!(
            "../../../../platform/notifications/window.json"
        )),
    },
    Part {
        id: "clock",
        files: &[],
        window: Some(include_str!("../../../../apps/clock/window.json")),
    },
    Part {
        id: "workspaces",
        files: &banda_workspaces::SETTINGS,
        window: Some(include_str!("../../../../platform/workspaces/window.json")),
    },
    Part {
        id: "apps",
        files: &[],
        window: Some(include_str!("../../../../platform/apps/window.json")),
    },
    Part {
        id: "window",
        files: &[],
        window: Some(include_str!("../../../../client/web/window.json")),
    },
    Part {
        id: "machines",
        files: &banda_machines::SETTINGS,
        window: None,
    },
    Part {
        id: "sharing",
        files: &banda_sharing::SETTINGS,
        window: None,
    },
];

pub const WHOLE: Settings = Settings::over(PARTS);
