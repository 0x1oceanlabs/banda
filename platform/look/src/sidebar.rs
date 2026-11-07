//! How the sidebar arranges its Threads (ADR 0008): the Person's
//! `~/.config/banda/sidebar.toml`, over the preset it names, over Banda's
//! defaults. A preset is a file with the same keys: Banda's own ship in
//! this crate, and the Person's are `~/.config/banda/sidebars/<name>.toml`.
//!
//! It is this machine's, as the look is, so `banda look` resolves it
//! with the look, watches its files with the look's, and names its
//! problems in the same list. The window only draws what it says.

use crate::Problem;
use crate::keyed::{self, Keyed, Layer, Renamed};
use crate::theme::Places;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use toml::Spanned;
use ts_rs::TS;

/// A Thread's mark as the sidebar sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum State {
    /// Neither at work nor archived: it asks, it failed, it finished, or
    /// the Person has it in hand.
    Active,
    /// Its Agent is at work.
    Working,
    /// Put away until a time, or until its turn ends (ADR 0074).
    Snoozed,
    /// Put away by the Person, until something new happens in it
    /// (ADR 0069). Its name was `settled`, which still reads as it.
    /// `settled` before ADR 0069 (grace).
    #[serde(alias = "settled")]
    Archived,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum GroupBy {
    /// Sections by what each Thread's mark says.
    State,
    /// Each Project a section of its own. `space` before ADR 0069 (grace).
    #[serde(alias = "space")]
    Project,
    /// One list.
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum SortBy {
    /// What needs the Person first, then the latest change.
    Attention,
    /// The latest change first.
    Changed,
    /// By title, A to Z.
    Title,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum ProjectOrder {
    /// The Project with the latest change first.
    Changed,
    /// By name, A to Z.
    Name,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum Empty {
    /// Left out.
    Hide,
    /// Shown with its title.
    Show,
}

/// A part of a row; `~` pushes the rest of its line to the right.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum Part {
    /// The Thread's mark.
    Mark,
    /// Its title.
    Title,
    /// Its Project. `space` before ADR 0069 (grace).
    #[serde(alias = "space")]
    Project,
    /// Its Harness.
    Harness,
    /// What it does now, and when it last changed.
    Status,
    /// The last thing said.
    Note,
    /// Pushes the rest of the line to the right.
    #[serde(rename = "~")]
    Push,
}

/// When the bar's middle shows the sidebar's counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum BarShow {
    /// While the sidebar is closed: it shows the same.
    Closed,
    /// Always, the sidebar open or not.
    Always,
    /// Never.
    Never,
}

/// What the bar's middle shows with nothing to count.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum BarEmpty {
    /// Nothing.
    Hide,
    /// The calm square: the counts stay in their place.
    Mark,
}

/// What the bar's middle counts, each with its mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum Count {
    /// Threads that ask the Person, or failed: they need an answer.
    Asking,
    /// Threads that finished and the Person has not seen.
    Done,
    /// Both of those: every Thread that waits for the Person.
    Waiting,
    /// Threads at work.
    Working,
}

/// How the sidebar arranges Threads: a preset, and the keys that change
/// it. A preset file in sidebars/ takes the same keys; every key is
/// optional.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SidebarSettings {
    /// Banda's inbox, projects or places, or one of yours in sidebars/.
    #[schemars(with = "Option<String>")]
    pub preset: Option<Spanned<String>>,
    /// How Threads fall into sections.
    #[serde(default)]
    pub group: GroupSettings,
    /// Their order in a section.
    #[serde(default)]
    pub sort: SortSettings,
    /// The Projects above the Threads. `[spaces]` before ADR 0069 (grace).
    #[serde(default, alias = "spaces")]
    pub projects: ProjectsSettings,
    /// What a Thread's row shows.
    #[serde(default)]
    pub row: RowSettings,
    /// The counts in the bar's middle: who waits for you, who works.
    #[serde(default)]
    pub bar: BarSettings,
    /// The snooze's presets (ADR 0074).
    #[serde(default)]
    pub snooze: SnoozeSettings,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SnoozeSettings {
    /// The times the snooze's picker offers, in its field's words, up to
    /// eight: "1h", "18:00", "tomorrow 9:00", "mon 9:00".
    #[schemars(with = "Option<Vec<String>>")]
    pub presets: Option<Vec<Spanned<String>>>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct GroupSettings {
    /// What makes a section: a Thread's state, its Project, or nothing.
    pub by: Option<GroupBy>,
    /// The sections by state, in this order.
    pub states: Option<Vec<State>>,
    /// Shelves at the bottom, each with its count.
    pub bottom: Option<Vec<State>>,
    /// Sections, shelves or Projects (by name) that start folded.
    pub folded: Option<Vec<String>>,
    /// Rows a section shows before "Show more"; 0 shows all.
    pub limit: Option<u32>,
    /// What an empty section does.
    pub empty: Option<Empty>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SortSettings {
    /// What comes first in a section.
    pub by: Option<SortBy>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct ProjectsSettings {
    /// A list of Projects above the Threads.
    pub list: Option<bool>,
    /// The order of that list.
    pub order: Option<ProjectOrder>,
    /// A Project shows its loudest mark and how many need you.
    pub rollup: Option<bool>,
    /// Each Project offers a new Thread in it.
    pub new_thread: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct RowSettings {
    /// 1, 2 or 3: one of Banda's layouts.
    #[schemars(with = "Option<u8>", range(min = 1, max = 3))]
    pub lines: Option<Spanned<u8>>,
    /// Parts the layout leaves out.
    pub hide: Option<Vec<Part>>,
    /// The first line of a layout of your own, which replaces the lines'.
    pub line1: Option<Vec<Part>>,
    /// Its second line.
    pub line2: Option<Vec<Part>>,
    /// Its third line.
    pub line3: Option<Vec<Part>>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct BarSettings {
    /// When they show.
    pub show: Option<BarShow>,
    /// What is counted, in this order; a count of none is left out.
    pub counts: Option<Vec<Count>>,
    /// A question in the attention colour, a failure in red, done in green.
    pub color: Option<bool>,
    /// Words beside the numbers.
    pub words: Option<bool>,
    /// What shows with nothing to count.
    pub empty: Option<BarEmpty>,
}

/// The arrangement the window draws, every key resolved.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "sidebar/")]
pub struct Sidebar {
    /// Where the Person's `sidebar.toml` is, there or not: the view menu
    /// writes the preset into it.
    pub file: String,
    /// The preset in force.
    pub preset: String,
    /// Every preset there is: Banda's, then the Person's.
    pub presets: Vec<Preset>,
    pub group: Group,
    pub sort: Sort,
    pub projects: Projects,
    pub row: Row,
    pub bar: BarCounts,
    pub snooze: Snooze,
}

/// The snooze's picker (ADR 0074, decision 9).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Snooze {
    /// The times it offers, in its field's words; the window reads each
    /// against its clock.
    pub presets: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Preset {
    pub name: String,
    pub origin: PresetOrigin,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum PresetOrigin {
    /// Shipped inside Banda.
    Banda,
    /// The Person's, in `~/.config/banda/sidebars/`.
    Yours,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Group {
    pub by: GroupBy,
    /// The sections, in this order.
    pub states: Vec<State>,
    /// Shelves at the bottom, each with its count.
    pub bottom: Vec<State>,
    /// Sections, shelves or Projects (by name) that start folded.
    pub folded: Vec<String>,
    /// Rows a section shows before "Show more"; 0 shows all.
    pub limit: u32,
    pub empty: Empty,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Sort {
    pub by: SortBy,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "sidebar/")]
pub struct Projects {
    /// A list of Projects above the Threads, as Herdr's.
    pub list: bool,
    pub order: ProjectOrder,
    /// A Project shows its loudest mark and how many need the Person.
    pub rollup: bool,
    /// Each Project offers a new Thread in it.
    pub new_thread: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Row {
    /// 1, 2 or 3: one of the built-in layouts.
    pub lines: u8,
    /// Parts left out of the layout.
    pub hide: Vec<Part>,
    /// A layout of the Person's own, line by line; it replaces `lines`'.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<Vec<Vec<Part>>>,
}

/// The counts in the bar's middle, as the window draws them.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct BarCounts {
    pub show: BarShow,
    /// What is counted, in this order.
    pub counts: Vec<Count>,
    pub color: bool,
    pub words: bool,
    pub empty: BarEmpty,
}

/// What a sidebar file may still say as before ADR 0069 (grace): the
/// table `[spaces]`, the preset `spaces`, `by` and a row's part `space`,
/// and the archive's state `settled`.
const RENAMED: &[Renamed] = &[
    Renamed::key("", "spaces", "projects"),
    Renamed::value("preset", "spaces", "projects"),
    Renamed::value("group.by", "space", "project"),
    Renamed::value("group.states", "settled", "archived"),
    Renamed::value("group.bottom", "settled", "archived"),
    Renamed::value("group.folded", "settled", "archived"),
    Renamed::value("row.hide", "space", "project"),
    Renamed::value("row.line1", "space", "project"),
    Renamed::value("row.line2", "space", "project"),
    Renamed::value("row.line3", "space", "project"),
];

/// Banda's presets: files in this crate, so they are examples too.
pub const BUILT_IN: [(&str, &str); 3] = [
    ("inbox", include_str!("../sidebars/inbox.toml")),
    ("projects", include_str!("../sidebars/projects.toml")),
    ("places", include_str!("../sidebars/places.toml")),
];

/// What the view menu writes when there is no `sidebar.toml` yet: the
/// preset, and every other key with its default, commented out.
pub const TEMPLATE: &str = include_str!("../sidebar.toml");

/// `bottom` with the snoozed shelf, when neither it nor `states` names
/// it: above Archive's, or last. A snooze always puts its Thread away
/// (ADR 0074), where a state named nowhere would go to the last section.
fn with_snoozed(mut bottom: Vec<State>, states: &[State]) -> Vec<State> {
    if !bottom.contains(&State::Snoozed) && !states.contains(&State::Snoozed) {
        let at = bottom.iter().position(|state| *state == State::Archived);
        bottom.insert(at.unwrap_or(bottom.len()), State::Snoozed);
    }
    bottom
}

impl SidebarSettings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: SidebarSettings) -> SidebarSettings {
        SidebarSettings {
            preset: self.preset.or(under.preset),
            group: GroupSettings {
                by: self.group.by.or(under.group.by),
                states: self.group.states.or(under.group.states),
                bottom: self.group.bottom.or(under.group.bottom),
                folded: self.group.folded.or(under.group.folded),
                limit: self.group.limit.or(under.group.limit),
                empty: self.group.empty.or(under.group.empty),
            },
            sort: SortSettings {
                by: self.sort.by.or(under.sort.by),
            },
            projects: ProjectsSettings {
                list: self.projects.list.or(under.projects.list),
                order: self.projects.order.or(under.projects.order),
                rollup: self.projects.rollup.or(under.projects.rollup),
                new_thread: self.projects.new_thread.or(under.projects.new_thread),
            },
            row: RowSettings {
                lines: self.row.lines.or(under.row.lines),
                hide: self.row.hide.or(under.row.hide),
                line1: self.row.line1.or(under.row.line1),
                line2: self.row.line2.or(under.row.line2),
                line3: self.row.line3.or(under.row.line3),
            },
            bar: BarSettings {
                show: self.bar.show.or(under.bar.show),
                counts: self.bar.counts.or(under.bar.counts),
                color: self.bar.color.or(under.bar.color),
                words: self.bar.words.or(under.bar.words),
                empty: self.bar.empty.or(under.bar.empty),
            },
            snooze: SnoozeSettings {
                presets: self.snooze.presets.or(under.snooze.presets),
            },
        }
    }

    /// Banda's defaults: the bottom layer, the `inbox` preset's order.
    pub fn defaults() -> SidebarSettings {
        SidebarSettings {
            preset: None,
            group: GroupSettings {
                by: Some(GroupBy::State),
                states: Some(vec![State::Active]),
                bottom: Some(vec![State::Working, State::Snoozed, State::Archived]),
                folded: Some(vec!["snoozed".to_owned(), "archived".to_owned()]),
                limit: Some(10),
                empty: Some(Empty::Hide),
            },
            sort: SortSettings {
                by: Some(SortBy::Attention),
            },
            projects: ProjectsSettings {
                list: Some(false),
                order: Some(ProjectOrder::Changed),
                rollup: Some(true),
                new_thread: Some(true),
            },
            row: RowSettings {
                lines: Some(Spanned::new(0..0, 3)),
                hide: Some(Vec::new()),
                line1: None,
                line2: None,
                line3: None,
            },
            bar: BarSettings {
                show: Some(BarShow::Closed),
                counts: Some(vec![Count::Asking, Count::Done, Count::Working]),
                color: Some(true),
                words: Some(false),
                empty: Some(BarEmpty::Mark),
            },
            snooze: SnoozeSettings {
                presets: Some(
                    (crate::snooze::PRESETS.iter())
                        .map(|word| Spanned::new(0..0, (*word).to_owned()))
                        .collect(),
                ),
            },
        }
    }

    /// The arrangement, from a layer over the defaults.
    fn arranged(self, file: &Path, preset: String, presets: Vec<Preset>) -> Sidebar {
        let all = self.over(SidebarSettings::defaults());
        let layout: Vec<Vec<Part>> = [all.row.line1, all.row.line2, all.row.line3]
            .into_iter()
            .flatten()
            .collect();
        Sidebar {
            file: file.display().to_string(),
            preset,
            presets,
            group: Group {
                by: all.group.by.unwrap_or(GroupBy::State),
                bottom: with_snoozed(
                    all.group.bottom.unwrap_or_default(),
                    all.group.states.as_deref().unwrap_or_default(),
                ),
                states: all.group.states.unwrap_or_default(),
                // `settled` is the archive's name before ADR 0069 (grace).
                folded: (all.group.folded.unwrap_or_default().into_iter())
                    .map(|name| {
                        if name == "settled" {
                            "archived".into()
                        } else {
                            name
                        }
                    })
                    .collect(),
                limit: all.group.limit.unwrap_or(10),
                empty: all.group.empty.unwrap_or(Empty::Hide),
            },
            sort: Sort {
                by: all.sort.by.unwrap_or(SortBy::Attention),
            },
            projects: Projects {
                list: all.projects.list.unwrap_or(false),
                order: all.projects.order.unwrap_or(ProjectOrder::Changed),
                rollup: all.projects.rollup.unwrap_or(true),
                new_thread: all.projects.new_thread.unwrap_or(true),
            },
            row: Row {
                lines: all.row.lines.map_or(3, Spanned::into_inner),
                hide: all.row.hide.unwrap_or_default(),
                layout: (!layout.is_empty()).then_some(layout),
            },
            bar: BarCounts {
                show: all.bar.show.unwrap_or(BarShow::Closed),
                counts: all.bar.counts.unwrap_or_default(),
                color: all.bar.color.unwrap_or(true),
                words: all.bar.words.unwrap_or(false),
                empty: all.bar.empty.unwrap_or(BarEmpty::Mark),
            },
            snooze: Snooze {
                presets: (all.snooze.presets.unwrap_or_default().into_iter())
                    .map(Spanned::into_inner)
                    .collect(),
            },
        }
    }
}

/// Reads a `sidebar.toml`, or a preset file when `preset`, and checks what
/// TOML alone does not, as [`crate::read`] reads a file.
pub fn read_sidebar(
    path: &Path,
    text: &str,
    preset: bool,
    problems: &mut Vec<Problem>,
) -> Option<SidebarSettings> {
    crate::say_renamed(path, text, RENAMED, problems);
    let mut settings: SidebarSettings = crate::read(path, text, problems)?;
    if preset && let Some(named) = settings.preset.take() {
        problems.push(Problem::at(
            path,
            text,
            Some(named.span()),
            "a preset cannot name another preset",
        ));
    }
    if let Some(lines) = &settings.row.lines
        && !(1..=3).contains(lines.get_ref())
    {
        problems.push(Problem::at(
            path,
            text,
            Some(lines.span()),
            "row.lines is 1, 2 or 3",
        ));
        settings.row.lines = None;
    }
    if let Some(presets) = &mut settings.snooze.presets {
        let (kept, unread): (Vec<_>, Vec<_>) = std::mem::take(presets)
            .into_iter()
            .partition(|word| crate::snooze::reads(word.get_ref()));
        for word in unread {
            let says = format!(
                "snooze.presets: \"{}\" is no time the picker reads, as 1h, 18:00, \
                 tomorrow 9:00 or mon 9:00",
                word.get_ref()
            );
            problems.push(Problem::at(path, text, Some(word.span()), &says));
        }
        *presets = kept;
        if presets.len() > crate::snooze::MOST {
            let past = presets[crate::snooze::MOST].span();
            problems.push(Problem::at(
                path,
                text,
                Some(past),
                "snooze.presets holds eight at most: the rest are left out",
            ));
            presets.truncate(crate::snooze::MOST);
        }
    }
    Some(settings)
}

/// Resolves the sidebar on this machine. Every file it read or looked for
/// goes to `watched`, the Person's presets folder too, so a new preset
/// shows in the view menu.
pub fn resolve(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> (Sidebar, Keyed) {
    let file = places.sidebar_file();
    watched.push(file.clone());
    let mine_file = std::fs::read_to_string(&file)
        .ok()
        .map(|text| (file.clone(), text));
    let mine = mine_file
        .as_ref()
        .and_then(|(path, text)| read_sidebar(path, text, false, problems))
        .unwrap_or_default();

    let folder = places.own_sidebars();
    watched.push(folder.clone());
    let yours = own_presets(&folder);
    watched.extend(yours.iter().cloned());
    let mut presets: Vec<Preset> = BUILT_IN
        .iter()
        .map(|(name, _)| Preset {
            name: (*name).to_owned(),
            origin: PresetOrigin::Banda,
            path: None,
        })
        .collect();
    for path in &yours {
        let name = stem(path);
        let preset = Preset {
            name: name.clone(),
            origin: PresetOrigin::Yours,
            path: Some(path.display().to_string()),
        };
        // The Person's file wins over Banda's of the same name.
        match presets.iter_mut().find(|p| p.name == name) {
            Some(shipped) => *shipped = preset,
            None => presets.push(preset),
        }
    }

    let wanted = match mine.preset.as_ref().map(|name| name.get_ref().as_str()) {
        // Its name before ADR 0069 (grace), unless the Person has one so named.
        Some("spaces") if !presets.iter().any(|p| p.name == "spaces") => "projects",
        name => name.unwrap_or("inbox"),
    };
    let found = presets.iter().find(|p| p.name == wanted);
    let (name, layer, preset_file) = match found {
        Some(Preset {
            path: Some(path), ..
        }) => {
            let path = PathBuf::from(path);
            let read = std::fs::read_to_string(&path).ok().map(|text| (path, text));
            let layer = read
                .as_ref()
                .and_then(|(path, text)| read_sidebar(path, text, true, problems));
            (wanted, layer.unwrap_or_default(), read)
        }
        Some(_) => (wanted, built_in(wanted), None),
        None => {
            let names = presets
                .iter()
                .map(|p| format!("\"{}\"", p.name))
                .collect::<Vec<_>>()
                .join(", ");
            let span = mine.preset.as_ref().map(Spanned::span);
            problems.push(Problem::at(
                &file,
                mine_file.as_ref().map_or("", |(_, text)| text.as_str()),
                span,
                format!("there is no preset \"{wanted}\"; the presets are {names}"),
            ));
            ("inbox", built_in("inbox"), None)
        }
    };
    let defaults = SidebarSettings::defaults();
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("preset", &layer, preset_file.as_ref()),
        Layer::new("file", &mine, mine_file.as_ref()),
    ];
    let name = name.to_owned();
    let merged = mine.over(layer).over(defaults);
    let keyed = keyed::keyed(&merged, &layers);
    (merged.arranged(&file, name, presets), keyed)
}

/// Banda's preset of this name; nothing over the defaults when none is.
fn built_in(name: &str) -> SidebarSettings {
    BUILT_IN
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, text)| toml::from_str(text).expect("Banda's own presets parse"))
        .unwrap_or_default()
}

/// The Person's preset files, by name.
fn own_presets(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|e| e == "toml")
                && !stem(path).starts_with('.')
                && path.is_file()
        })
        .collect();
    paths.sort();
    paths
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Whether `path` is read as the sidebar's schema by `banda look check`:
/// a `sidebar.toml`, or a file in a `sidebars` folder.
pub fn is_sidebar_file(path: &Path) -> Option<bool> {
    if path.file_name().is_some_and(|n| n == "sidebar.toml") {
        return Some(false);
    }
    let in_sidebars = path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|n| n == "sidebars");
    in_sidebars.then_some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places(config: &Path) -> Places {
        Places::at(config)
    }

    fn resolved(config: &Path) -> (Sidebar, Vec<Problem>) {
        let mut problems = Vec::new();
        let (sidebar, _) = resolve(&places(config), &mut problems, &mut Vec::new());
        (sidebar, problems)
    }

    #[test]
    fn no_file_is_the_inbox() {
        let dir = tempfile::tempdir().unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.preset, "inbox");
        assert_eq!(sidebar.group.states, vec![State::Active]);
        assert_eq!(
            sidebar.group.bottom,
            vec![State::Working, State::Snoozed, State::Archived]
        );
        assert_eq!(sidebar.group.folded, ["snoozed", "archived"]);
        assert_eq!(sidebar.row.lines, 3);
        assert_eq!(sidebar.bar.show, BarShow::Closed);
        assert_eq!(
            sidebar.bar.counts,
            [Count::Asking, Count::Done, Count::Working]
        );
        let names: Vec<_> = sidebar.presets.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["inbox", "projects", "places"]);
    }

    #[test]
    fn the_persons_keys_win_over_the_preset() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("sidebar.toml"),
            "preset = \"projects\"\n[row]\nlines = 2\n",
        )
        .unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.preset, "projects");
        assert_eq!(sidebar.group.by, GroupBy::Project, "from the preset");
        assert_eq!(sidebar.row.lines, 2, "the Person's key");
    }

    #[test]
    fn the_snoozes_presets_are_t3s_unless_the_person_names_others() {
        let dir = tempfile::tempdir().unwrap();
        let (sidebar, _) = resolved(dir.path());
        assert_eq!(sidebar.snooze.presets, crate::snooze::PRESETS);
        std::fs::write(
            dir.path().join("sidebar.toml"),
            "[snooze]\npresets = [\"30m\", \"someday\", \"fri 14\"]\n",
        )
        .unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.snooze.presets, ["30m", "fri 14"]);
        let said: Vec<_> = problems.iter().map(|p| p.message.as_str()).collect();
        assert!(
            said.iter().any(|m| m.contains("\"someday\"")),
            "it names the one it cannot read: {said:?}"
        );
    }

    #[test]
    fn a_snooze_has_its_shelf_where_the_persons_keys_name_it_nowhere() {
        let dir = tempfile::tempdir().unwrap();
        let write = |group: &str| {
            std::fs::write(
                dir.path().join("sidebar.toml"),
                format!("[group]\n{group}\n"),
            )
            .unwrap();
            resolved(dir.path()).0.group
        };
        let older = write("bottom = [\"working\", \"archived\"]");
        assert_eq!(
            older.bottom,
            [State::Working, State::Snoozed, State::Archived]
        );
        let none = write("bottom = []");
        assert_eq!(none.bottom, [State::Snoozed]);
        let named = write("states = [\"active\", \"snoozed\"]\nbottom = []");
        assert!(named.bottom.is_empty(), "a section of its own");
    }

    #[test]
    fn names_before_adr_0069_read_as_now_and_each_says_its_name_now() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("sidebar.toml"),
            "preset = \"spaces\"\n\
             [group]\nby = \"space\"\nstates = [\"active\", \"settled\"]\n\
             folded = [\"settled\", \"banda\"]\n\
             [spaces]\nlist = true # the list above\n\
             [row]\nhide = [\"space\"]\n",
        )
        .unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.preset, "projects");
        assert_eq!(sidebar.group.by, GroupBy::Project);
        assert_eq!(sidebar.group.states, [State::Active, State::Archived]);
        assert_eq!(sidebar.group.folded, ["archived", "banda"]);
        assert!(sidebar.projects.list);
        assert_eq!(sidebar.row.hide, [Part::Project]);
        let said: Vec<_> = (problems.iter())
            .map(|p| (p.line.unwrap(), p.message.as_str()))
            .collect();
        assert_eq!(
            said,
            [
                (1, "\"spaces\" is called \"projects\" now"),
                (3, "\"space\" is called \"project\" now"),
                (4, "\"settled\" is called \"archived\" now"),
                (5, "\"settled\" is called \"archived\" now"),
                (6, "spaces is called projects now"),
                (9, "\"space\" is called \"project\" now"),
            ]
        );
    }

    #[test]
    fn the_bar_s_counts_are_the_person_s_to_change() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("sidebar.toml"),
            "[bar]\nshow = \"always\"\ncounts = [\"waiting\", \"working\"]\nwords = true\n",
        )
        .unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.bar.show, BarShow::Always);
        assert_eq!(sidebar.bar.counts, [Count::Waiting, Count::Working]);
        assert!(sidebar.bar.words);
        assert!(sidebar.bar.color, "Banda's");
        assert_eq!(sidebar.bar.empty, BarEmpty::Mark, "Banda's");
    }

    #[test]
    fn a_preset_of_ones_own_is_a_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sidebars")).unwrap();
        std::fs::write(
            dir.path().join("sidebars/focus.toml"),
            "preset = \"places\"\n[sort]\nby = \"title\"\n[row]\nline1 = [\"mark\", \"title\", \"~\", \"status\"]\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("sidebar.toml"), "preset = \"focus\"\n").unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.preset, "focus");
        assert_eq!(sidebar.sort.by, SortBy::Title);
        assert_eq!(
            sidebar.row.layout,
            Some(vec![vec![
                Part::Mark,
                Part::Title,
                Part::Push,
                Part::Status
            ]])
        );
        assert_eq!(sidebar.presets.last().unwrap().origin, PresetOrigin::Yours);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].message.contains("cannot name another"));
        assert_eq!(problems[0].line, Some(1));
    }

    #[test]
    fn an_unknown_preset_is_named_and_the_inbox_shows() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("sidebar.toml"), "preset = \"nope\"\n").unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.preset, "inbox");
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("no preset \"nope\""));
        assert!(problems[0].message.contains("\"places\""));
        assert_eq!((problems[0].line, problems[0].column), (Some(1), Some(10)));
    }

    #[test]
    fn a_wrong_key_is_named_where_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sidebar.toml");
        std::fs::write(&file, "[row]\nlines = 5\n").unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.row.lines, 3, "left out");
        assert_eq!(problems[0].line, Some(2));

        std::fs::write(&file, "[group]\nby = \"colour\"\n").unwrap();
        let (_, problems) = resolved(dir.path());
        assert!(problems[0].message.contains("colour"), "{problems:?}");

        std::fs::write(&file, "[row]\nlinez = 2\n").unwrap();
        let (_, problems) = resolved(dir.path());
        assert!(problems[0].message.contains("linez"), "{problems:?}");
    }

    #[test]
    fn banda_s_presets_and_template_parse() {
        for (name, text) in BUILT_IN {
            let mut problems = Vec::new();
            read_sidebar(Path::new(name), text, true, &mut problems).expect(name);
            assert!(problems.is_empty(), "{name}: {problems:?}");
        }
        let mut problems = Vec::new();
        let template = read_sidebar(Path::new("sidebar.toml"), TEMPLATE, false, &mut problems);
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(template.unwrap().preset.unwrap().into_inner(), "inbox");
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
        let uncommented: String = TEMPLATE
            .lines()
            .filter(|line| !line.starts_with("# line"))
            .map(|line| key(line).unwrap_or(line))
            .collect::<Vec<_>>()
            .join("\n");
        let mut problems = Vec::new();
        let settings = read_sidebar(Path::new("t"), &uncommented, false, &mut problems)
            .unwrap_or_else(|| panic!("{problems:?}\n{uncommented}"));
        let file = Path::new("f");
        let template = settings.arranged(file, "inbox".into(), Vec::new());
        let defaults = SidebarSettings::default().arranged(file, "inbox".into(), Vec::new());
        assert_eq!(template, defaults);
    }

    #[test]
    fn check_knows_a_sidebar_file() {
        assert_eq!(is_sidebar_file(Path::new("/a/sidebar.toml")), Some(false));
        assert_eq!(is_sidebar_file(Path::new("/a/sidebars/x.toml")), Some(true));
        assert_eq!(is_sidebar_file(Path::new("/a/look.toml")), None);
    }
}
