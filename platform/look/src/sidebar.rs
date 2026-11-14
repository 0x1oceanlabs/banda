//! How the sidebar arranges its Threads (ADR 0008, as ADR 0098 amends
//! it): the Person's `~/.config/banda/sidebar.toml`, over the preset it
//! names, over Banda's defaults. A preset is a file with the same keys:
//! Banda's own ship in this crate, and the Person's are
//! `~/.config/banda/sidebars/<name>.toml`.
//!
//! It is this machine's, as the look is, so `banda look` resolves it
//! with the look, watches its files with the look's, and names its
//! problems in the same list. The window only draws what it says.

use crate::Places;
use crate::Problem;
use crate::keyed::{self, Keyed, Layer, Renamed, Retired};
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::path::{Path, PathBuf};
use toml::Spanned;
use ts_rs::TS;

/// How the list is grouped (ADR 0098, decision 7).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum GroupBy {
    /// One list.
    None,
    /// Each Project under its header.
    Project,
    /// Each machine under its header.
    Machine,
}

/// How many lines a card has (ADR 0098, decision 9).
#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "sidebar/", type = "\"auto\" | 3 | 2 | 1")]
pub enum Card {
    /// By where it stands: three in Your turn, two there when grouped by
    /// Project, one for the rest.
    Auto,
    /// As many everywhere: 3, 2 or 1.
    Lines(u8),
}

impl TryFrom<toml::Value> for Card {
    type Error = String;

    fn try_from(value: toml::Value) -> Result<Card, String> {
        match value {
            toml::Value::String(word) if word == "auto" => Ok(Card::Auto),
            toml::Value::Integer(lines @ 1..=3) => Ok(Card::Lines(lines as u8)),
            value => Err(format!("card is \"auto\", 3, 2 or 1, not {value}")),
        }
    }
}

impl<'de> Deserialize<'de> for Card {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Card, D::Error> {
        crate::sound::from_toml(deserializer)
    }
}

impl Serialize for Card {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Card::Auto => serializer.serialize_str("auto"),
            Card::Lines(lines) => serializer.serialize_u8(*lines),
        }
    }
}

impl JsonSchema for Card {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "Card".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "description": "How many lines a card has: \"auto\", by where it stands, or 3, 2 or 1 everywhere.",
            "enum": ["auto", 3, 2, 1],
        })
    }
}

/// Your turn's order in the Inbox (ADR 0098, decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum InboxOrder {
    /// The one that waited longest first: no one waits forever.
    Oldest,
    /// The latest call first.
    Newest,
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

/// How another machine shows on its rows (ADR 0095, decision 5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum MachineRows {
    /// Its icon and its name, after the Project.
    Named,
    /// Its icon alone.
    Icon,
    /// Not at all: its label and its Panes' headers still name it.
    Off,
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
    /// How the list is grouped: one list, each Project under its header,
    /// or each machine.
    pub group: Option<GroupBy>,
    /// How many lines a card has: by where it stands, or 3, 2 or 1
    /// everywhere.
    pub card: Option<Card>,
    /// What the Inbox shows, and in what order.
    #[serde(default)]
    pub inbox: InboxSettings,
    /// Their order in a section.
    #[serde(default)]
    pub sort: SortSettings,
    /// The Projects in the list. `[spaces]` before ADR 0069 (grace).
    #[serde(default, alias = "spaces")]
    pub projects: ProjectsSettings,
    /// The counts in the bar's middle: who waits for you, who works.
    #[serde(default)]
    pub bar: BarSettings,
    /// The Later's presets (ADR 0074). `[snooze]` before ADR 0098 (grace).
    #[serde(default, alias = "snooze")]
    pub later: LaterSettings,
    /// How machines are named, with another machine in hosts.toml
    /// (ADR 0095).
    #[serde(default)]
    pub machines: MachinesSettings,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct InboxSettings {
    /// Your turn's order: the oldest call first, or the newest.
    pub order: Option<InboxOrder>,
    /// Open in the Inbox: Threads seen, with no turn running.
    pub open: Option<bool>,
    /// The Working shelf in the Inbox, under Open.
    pub working: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct MachinesSettings {
    /// How another machine shows on its rows: its icon and name, its icon
    /// alone, or not at all.
    pub rows: Option<MachineRows>,
    /// Name this machine too, as the others are: a label over its
    /// Projects, its rows where no label names it, its Panes' headers.
    /// Only with another machine in hosts.toml.
    pub this_too: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct LaterSettings {
    /// The times the Later's picker offers, in its field's words, up to
    /// eight: "1h", "18:00", "tomorrow 9:00", "mon 9:00".
    #[schemars(with = "Option<Vec<String>>")]
    pub presets: Option<Vec<Spanned<String>>>,
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
    /// The order of the Projects.
    pub order: Option<ProjectOrder>,
    /// A Project shows its loudest mark and how many need you.
    pub rollup: Option<bool>,
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
    /// writes its keys into it, and opens it.
    pub file: String,
    /// The preset in force.
    pub preset: String,
    /// Every preset there is: Banda's, then the Person's.
    pub presets: Vec<Preset>,
    pub group: GroupBy,
    pub card: Card,
    pub inbox: Inbox,
    pub sort: Sort,
    pub projects: Projects,
    pub bar: BarCounts,
    pub later: Later,
    pub machines: Machines,
}

/// What the Inbox shows, and in what order (ADR 0098, decision 3).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Inbox {
    /// Your turn's order.
    pub order: InboxOrder,
    /// Open shows, under Your turn.
    pub open: bool,
    /// The Working shelf shows, under Open.
    pub working: bool,
}

/// How the window names the machines (ADR 0095): with no other machine
/// in hosts.toml, it names none.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "sidebar/")]
pub struct Machines {
    /// How another machine shows on its rows.
    pub rows: MachineRows,
    /// This machine is named as the others are: a label over its
    /// Projects, its rows where no label names it, its Panes' headers.
    pub this_too: bool,
}

/// The Later's picker (ADR 0074, decision 9).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "sidebar/")]
pub struct Later {
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
pub struct Sort {
    pub by: SortBy,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "sidebar/")]
pub struct Projects {
    pub order: ProjectOrder,
    /// A Project shows its loudest mark and how many need the Person.
    pub rollup: bool,
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
/// table `[spaces]` and the preset `spaces`; and as before ADR 0098,
/// decision 28: the table `[snooze]`.
const RENAMED: &[Renamed] = &[
    Renamed::key("", "snooze", "later"),
    Renamed::key("", "spaces", "projects"),
    Renamed::value("preset", "spaces", "projects"),
];

/// What ADR 0098 put out of use: the presets' sections and rows, the
/// list of Projects (decisions 7, 9 and 16), and a Project's New Thread,
/// as the sidebar starts no Thread (decision 19, as Roma amended it on
/// 2026-11-12), and `[hold]`, as the order always keeps still under the
/// pointer (decision 6, as Roma amended it on 2026-11-14). A file that
/// still says them is told so, and the rest of it holds.
const RETIRED: &[Retired] = &[
    Retired {
        at: "group",
        table: true,
        says: "[group] is no longer used: group = \"none\", \"project\" or \"machine\" groups the list",
    },
    Retired {
        at: "row",
        table: true,
        says: "[row] is no longer used: card = \"auto\", 3, 2 or 1 says a card's lines",
    },
    Retired {
        at: "hold",
        table: true,
        says: "[hold] is no longer used: the list's order keeps still under the pointer",
    },
    Retired {
        at: "projects.list",
        table: false,
        says: "projects.list is no longer used",
    },
    Retired {
        at: "projects.new-thread",
        table: false,
        says: "projects.new-thread is no longer used: a Thread starts in the New Thread Pane",
    },
];

/// Banda's presets: files in this crate, kept so a file that names one
/// still reads (ADR 0098): `inbox` is one list, `projects` and `places`
/// group by Project.
pub const BUILT_IN: [(&str, &str); 3] = [
    ("inbox", include_str!("../sidebars/inbox.toml")),
    ("projects", include_str!("../sidebars/projects.toml")),
    ("places", include_str!("../sidebars/places.toml")),
];

/// What the view menu writes when there is no `sidebar.toml` yet: the
/// preset, and every other key with its default, commented out.
pub const TEMPLATE: &str = include_str!("../sidebar.toml");

impl SidebarSettings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: SidebarSettings) -> SidebarSettings {
        SidebarSettings {
            preset: self.preset.or(under.preset),
            group: self.group.or(under.group),
            card: self.card.or(under.card),
            inbox: InboxSettings {
                order: self.inbox.order.or(under.inbox.order),
                open: self.inbox.open.or(under.inbox.open),
                working: self.inbox.working.or(under.inbox.working),
            },
            sort: SortSettings {
                by: self.sort.by.or(under.sort.by),
            },
            projects: ProjectsSettings {
                order: self.projects.order.or(under.projects.order),
                rollup: self.projects.rollup.or(under.projects.rollup),
            },
            bar: BarSettings {
                show: self.bar.show.or(under.bar.show),
                counts: self.bar.counts.or(under.bar.counts),
                color: self.bar.color.or(under.bar.color),
                words: self.bar.words.or(under.bar.words),
                empty: self.bar.empty.or(under.bar.empty),
            },
            later: LaterSettings {
                presets: self.later.presets.or(under.later.presets),
            },
            machines: MachinesSettings {
                rows: self.machines.rows.or(under.machines.rows),
                this_too: self.machines.this_too.or(under.machines.this_too),
            },
        }
    }

    /// Banda's defaults: the bottom layer, the `inbox` preset's.
    pub fn defaults() -> SidebarSettings {
        SidebarSettings {
            preset: None,
            group: Some(GroupBy::None),
            card: Some(Card::Auto),
            inbox: InboxSettings {
                order: Some(InboxOrder::Oldest),
                open: Some(true),
                working: Some(true),
            },
            sort: SortSettings {
                by: Some(SortBy::Attention),
            },
            projects: ProjectsSettings {
                order: Some(ProjectOrder::Changed),
                rollup: Some(true),
            },
            bar: BarSettings {
                show: Some(BarShow::Closed),
                counts: Some(vec![Count::Asking, Count::Done, Count::Working]),
                color: Some(true),
                words: Some(false),
                empty: Some(BarEmpty::Mark),
            },
            later: LaterSettings {
                presets: Some(
                    (crate::later::PRESETS.iter())
                        .map(|word| Spanned::new(0..0, (*word).to_owned()))
                        .collect(),
                ),
            },
            machines: MachinesSettings {
                rows: Some(MachineRows::Named),
                this_too: Some(false),
            },
        }
    }

    /// The arrangement, from a layer over the defaults.
    fn arranged(self, file: &Path, preset: String, presets: Vec<Preset>) -> Sidebar {
        let all = self.over(SidebarSettings::defaults());
        Sidebar {
            file: file.display().to_string(),
            preset,
            presets,
            group: all.group.unwrap_or(GroupBy::None),
            card: all.card.unwrap_or(Card::Auto),
            inbox: Inbox {
                order: all.inbox.order.unwrap_or(InboxOrder::Oldest),
                open: all.inbox.open.unwrap_or(true),
                working: all.inbox.working.unwrap_or(true),
            },
            sort: Sort {
                by: all.sort.by.unwrap_or(SortBy::Attention),
            },
            projects: Projects {
                order: all.projects.order.unwrap_or(ProjectOrder::Changed),
                rollup: all.projects.rollup.unwrap_or(true),
            },
            bar: BarCounts {
                show: all.bar.show.unwrap_or(BarShow::Closed),
                counts: all.bar.counts.unwrap_or_default(),
                color: all.bar.color.unwrap_or(true),
                words: all.bar.words.unwrap_or(false),
                empty: all.bar.empty.unwrap_or(BarEmpty::Mark),
            },
            later: Later {
                presets: (all.later.presets.unwrap_or_default().into_iter())
                    .map(Spanned::into_inner)
                    .collect(),
            },
            machines: Machines {
                rows: all.machines.rows.unwrap_or(MachineRows::Named),
                this_too: all.machines.this_too.unwrap_or(false),
            },
        }
    }
}

/// Reads a `sidebar.toml`, or a preset file when `preset`, and checks what
/// TOML alone does not, as [`crate::read`] reads a file. A key ADR 0098
/// put out of use is named and left out.
pub fn read_sidebar(
    path: &Path,
    text: &str,
    preset: bool,
    problems: &mut Vec<Problem>,
) -> Option<SidebarSettings> {
    crate::say_renamed(path, text, RENAMED, problems);
    let kept = crate::say_retired(path, text, RETIRED, problems);
    let mut settings: SidebarSettings = crate::read(path, &kept, problems)?;
    if preset && let Some(named) = settings.preset.take() {
        problems.push(Problem::at(
            path,
            text,
            Some(named.span()),
            "a preset cannot name another preset",
        ));
    }
    if let Some(presets) = &mut settings.later.presets {
        let (kept, unread): (Vec<_>, Vec<_>) = std::mem::take(presets)
            .into_iter()
            .partition(|word| crate::later::reads(word.get_ref()));
        for word in unread {
            let says = format!(
                "later.presets: \"{}\" is no time the picker reads, as 1h, 18:00, \
                 tomorrow 9:00 or mon 9:00",
                word.get_ref()
            );
            problems.push(Problem::at(path, text, Some(word.span()), &says));
        }
        *presets = kept;
        if presets.len() > crate::later::MOST {
            let past = presets[crate::later::MOST].span();
            problems.push(Problem::at(
                path,
                text,
                Some(past),
                "later.presets holds eight at most: the rest are left out",
            ));
            presets.truncate(crate::later::MOST);
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
    let file = places.config.join("sidebar.toml");
    watched.push(file.clone());
    let mine_file = std::fs::read_to_string(&file)
        .ok()
        .map(|text| (file.clone(), text));
    let mine = mine_file
        .as_ref()
        .and_then(|(path, text)| read_sidebar(path, text, false, problems))
        .unwrap_or_default();

    let folder = places.config.join("sidebars");
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

    /// The sidebar `text`, as `sidebar.toml`, resolves to.
    fn with(text: &str) -> (Sidebar, Vec<Problem>) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("sidebar.toml"), text).unwrap();
        resolved(dir.path())
    }

    /// Each problem's line and what it says.
    fn said(problems: &[Problem]) -> Vec<(u32, &str)> {
        (problems.iter())
            .map(|p| (p.line.unwrap(), p.message.as_str()))
            .collect()
    }

    #[test]
    fn no_file_is_the_inbox() {
        let dir = tempfile::tempdir().unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.preset, "inbox");
        assert_eq!(sidebar.group, GroupBy::None);
        assert_eq!(sidebar.card, Card::Auto);
        assert_eq!(
            sidebar.inbox,
            Inbox {
                order: InboxOrder::Oldest,
                open: true,
                working: true
            }
        );
        assert_eq!(sidebar.bar.show, BarShow::Closed);
        assert_eq!(
            sidebar.bar.counts,
            [Count::Asking, Count::Done, Count::Working]
        );
        assert_eq!(sidebar.machines.rows, MachineRows::Named);
        assert!(!sidebar.machines.this_too, "this machine is not named");
        let names: Vec<_> = sidebar.presets.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["inbox", "projects", "places"]);
    }

    /// ADR 0098, "What it amends": a file that names a preset still reads.
    #[test]
    fn each_preset_reads_as_a_group() {
        for (preset, group) in [
            ("inbox", GroupBy::None),
            ("projects", GroupBy::Project),
            ("places", GroupBy::Project),
        ] {
            let (sidebar, problems) = with(&format!("preset = \"{preset}\"\n"));
            assert!(problems.is_empty(), "{preset}: {problems:?}");
            assert_eq!(sidebar.preset, preset);
            assert_eq!(sidebar.group, group, "{preset}");
            assert_eq!(sidebar.card, Card::Auto, "{preset}");
        }
    }

    #[test]
    fn the_persons_keys_win_over_the_preset() {
        let (sidebar, problems) = with("preset = \"projects\"\ncard = 2\n");
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.preset, "projects");
        assert_eq!(sidebar.group, GroupBy::Project, "from the preset");
        assert_eq!(sidebar.card, Card::Lines(2), "the Person's key");
        let (sidebar, _) = with("preset = \"projects\"\ngroup = \"none\"\n");
        assert_eq!(sidebar.group, GroupBy::None);
    }

    #[test]
    fn the_view_s_keys_are_the_person_s_to_change() {
        let (sidebar, problems) = with(
            "group = \"machine\"\ncard = 1\n\
             [inbox]\norder = \"newest\"\nopen = false\nworking = false\n",
        );
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.group, GroupBy::Machine);
        assert_eq!(sidebar.card, Card::Lines(1));
        assert_eq!(
            sidebar.inbox,
            Inbox {
                order: InboxOrder::Newest,
                open: false,
                working: false
            }
        );
    }

    #[test]
    fn keys_out_of_use_are_named_and_the_rest_holds() {
        let (sidebar, problems) = with(
            "preset = \"projects\"\n\
             [group]\nby = \"none\"\nstates = [\"active\", \"settled\"]\nlimit = 0\n\
             [projects]\nlist = true\norder = \"name\"\nnew-thread = false\n\
             [row]\nlines = 1\nhide = [\"harness\"]\nline1 = [\"mark\"]\n\
             [machines]\nrows = \"icon\"\n",
        );
        assert_eq!(
            said(&problems),
            [
                (
                    2,
                    "[group] is no longer used: group = \"none\", \"project\" or \"machine\" \
                     groups the list"
                ),
                (7, "projects.list is no longer used"),
                (
                    9,
                    "projects.new-thread is no longer used: a Thread starts in the New Thread Pane"
                ),
                (
                    10,
                    "[row] is no longer used: card = \"auto\", 3, 2 or 1 says a card's lines"
                ),
            ]
        );
        assert_eq!(problems[0].column, Some(2), "at the table's name");
        assert!(problems.iter().all(|p| !p.left_out), "{problems:?}");
        assert_eq!(sidebar.group, GroupBy::Project, "the preset's, not by");
        assert_eq!(sidebar.card, Card::Auto, "not lines");
        assert_eq!(sidebar.projects.order, ProjectOrder::Name);
        assert_eq!(sidebar.machines.rows, MachineRows::Icon);
    }

    #[test]
    fn keys_out_of_use_are_named_however_they_are_written() {
        let (sidebar, problems) = with(
            "row.lines = 2\nprojects = { list = true, order = \"name\" }\n\
             group = { by = \"project\" }\n",
        );
        let keys: Vec<_> = (problems.iter())
            .map(|p| (p.line.unwrap(), p.key.as_deref().unwrap()))
            .collect();
        assert_eq!(keys, [(1, "row"), (2, "projects.list"), (3, "group")]);
        assert_eq!(sidebar.projects.order, ProjectOrder::Name, "beside it");
        assert_eq!(sidebar.group, GroupBy::None);
    }

    #[test]
    fn a_preset_of_ones_own_is_told_of_its_keys_out_of_use_too() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sidebars")).unwrap();
        let flat = dir.path().join("sidebars").join("flat.toml");
        std::fs::write(&flat, "group = \"none\"\n[row]\nlines = 1\n").unwrap();
        std::fs::write(dir.path().join("sidebar.toml"), "preset = \"flat\"\n").unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.group, GroupBy::None);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].path, flat.display().to_string());
        assert_eq!(problems[0].line, Some(2));
    }

    #[test]
    fn the_later_pickers_presets_are_t3s_unless_the_person_names_others() {
        let dir = tempfile::tempdir().unwrap();
        let (sidebar, _) = resolved(dir.path());
        assert_eq!(sidebar.later.presets, crate::later::PRESETS);
        let (sidebar, problems) = with("[later]\npresets = [\"30m\", \"someday\", \"fri 14\"]\n");
        assert_eq!(sidebar.later.presets, ["30m", "fri 14"]);
        let said: Vec<_> = problems.iter().map(|p| p.message.as_str()).collect();
        assert!(
            said.iter().any(|m| m.contains("\"someday\"")),
            "it names the one it cannot read: {said:?}"
        );
    }

    #[test]
    fn names_before_adr_0069_read_as_now_and_each_says_its_name_now() {
        let (sidebar, problems) =
            with("preset = \"spaces\"\n[spaces]\norder = \"name\" # by name\n");
        assert_eq!(sidebar.preset, "projects");
        assert_eq!(sidebar.projects.order, ProjectOrder::Name);
        assert_eq!(
            said(&problems),
            [
                (1, "\"spaces\" is called \"projects\" now"),
                (2, "spaces is called projects now"),
            ]
        );
    }

    #[test]
    fn names_before_adr_0098_read_as_now_and_each_says_its_name_now() {
        let (sidebar, problems) = with("[snooze]\npresets = [\"30m\"]\n");
        assert_eq!(sidebar.later.presets, ["30m"]);
        assert_eq!(said(&problems), [(1, "snooze is called later now")]);
    }

    #[test]
    fn the_bar_s_counts_are_the_person_s_to_change() {
        let (sidebar, problems) =
            with("[bar]\nshow = \"always\"\ncounts = [\"waiting\", \"working\"]\nwords = true\n");
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.bar.show, BarShow::Always);
        assert_eq!(sidebar.bar.counts, [Count::Waiting, Count::Working]);
        assert!(sidebar.bar.words);
        assert!(sidebar.bar.color, "Banda's");
        assert_eq!(sidebar.bar.empty, BarEmpty::Mark, "Banda's");
    }

    #[test]
    fn how_the_machines_are_named_is_the_person_s_to_change() {
        let (sidebar, problems) =
            with("preset = \"projects\"\n[machines]\nrows = \"icon\"\nthis-too = true\n");
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.machines.rows, MachineRows::Icon);
        assert!(sidebar.machines.this_too);
    }

    #[test]
    fn a_way_to_show_a_machine_that_is_none_is_named_at_its_line() {
        let (sidebar, problems) = with("[machines]\nrows = \"chip\"\nthis-too = true\n");
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].message.contains("chip"), "{problems:?}");
        assert_eq!(problems[0].line, Some(2));
        assert_eq!(sidebar.machines.rows, MachineRows::Named, "left out");
        assert!(sidebar.machines.this_too, "the rest of the file holds");
    }

    #[test]
    fn a_preset_of_ones_own_is_a_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sidebars")).unwrap();
        std::fs::write(
            dir.path().join("sidebars/focus.toml"),
            "preset = \"places\"\ncard = 1\n[sort]\nby = \"title\"\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("sidebar.toml"), "preset = \"focus\"\n").unwrap();
        let (sidebar, problems) = resolved(dir.path());
        assert_eq!(sidebar.preset, "focus");
        assert_eq!(sidebar.sort.by, SortBy::Title);
        assert_eq!(sidebar.card, Card::Lines(1));
        assert_eq!(sidebar.group, GroupBy::None, "not places'");
        assert_eq!(sidebar.presets.last().unwrap().origin, PresetOrigin::Yours);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].message.contains("cannot name another"));
        assert_eq!(problems[0].line, Some(1));
    }

    #[test]
    fn an_unknown_preset_is_named_and_the_inbox_shows() {
        let (sidebar, problems) = with("preset = \"nope\"\n");
        assert_eq!(sidebar.preset, "inbox");
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("no preset \"nope\""));
        assert!(problems[0].message.contains("\"places\""));
        assert_eq!((problems[0].line, problems[0].column), (Some(1), Some(10)));
    }

    #[test]
    fn a_wrong_key_is_named_where_it_is() {
        let (sidebar, problems) = with("group = \"project\"\ncard = 5\n");
        assert_eq!(sidebar.card, Card::Auto, "left out");
        assert_eq!(sidebar.group, GroupBy::Project, "the rest holds");
        assert_eq!((problems[0].line, problems[0].column), (Some(2), Some(8)));
        assert!(problems[0].message.contains("not 5"), "{problems:?}");

        let (_, problems) = with("group = \"colour\"\n");
        assert!(problems[0].message.contains("colour"), "{problems:?}");

        let (_, problems) = with("[inbox]\nordr = \"newest\"\n");
        assert!(problems[0].message.contains("ordr"), "{problems:?}");
    }

    /// The settings Pane draws a row of each key from the schema: the keys
    /// of ADR 0098, and none it put out of use.
    #[test]
    fn the_schema_has_the_view_s_keys_and_none_out_of_use() {
        let file = crate::FILES.iter().find(|f| f.name == "sidebar.toml");
        let schema = serde_json::to_value(file.unwrap().schema()).unwrap();
        let def = |name: &str| &schema["$defs"][name];
        let consts = |name: &str| -> Vec<String> {
            (def(name)["oneOf"].as_array().unwrap().iter())
                .map(|way| way["const"].as_str().unwrap().to_owned())
                .collect()
        };
        let keys = |at: &serde_json::Value| -> Vec<String> {
            let mut keys: Vec<_> = at["properties"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect();
            keys.sort();
            keys
        };
        assert_eq!(
            keys(&schema),
            [
                "bar", "card", "group", "inbox", "later", "machines", "preset", "projects", "sort"
            ]
        );
        assert_eq!(schema["properties"]["group"]["$ref"], "#/$defs/GroupBy");
        assert_eq!(consts("GroupBy"), ["none", "project", "machine"]);
        assert_eq!(def("Card")["enum"], serde_json::json!(["auto", 3, 2, 1]));
        assert_eq!(keys(def("InboxSettings")), ["open", "order", "working"]);
        assert_eq!(consts("InboxOrder"), ["oldest", "newest"]);
        assert_eq!(keys(def("ProjectsSettings")), ["order", "rollup"]);
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
            .map(|line| key(line).unwrap_or(line))
            .collect::<Vec<_>>()
            .join("\n");
        let mut problems = Vec::new();
        let settings = read_sidebar(Path::new("t"), &uncommented, false, &mut problems)
            .unwrap_or_else(|| panic!("{problems:?}\n{uncommented}"));
        assert!(problems.is_empty(), "{problems:?}\n{uncommented}");
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
