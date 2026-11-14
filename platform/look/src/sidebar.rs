//! How the sidebar arranges its Threads (ADR 0008, as ADR 0098 amends
//! it): the Person's `~/.config/banda/sidebar.toml`, over Banda's
//! defaults.
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

/// How the list is grouped (ADR 0098, decision 7, as amended): one list,
/// the Inbox, or by Project.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "sidebar/")]
pub enum GroupBy {
    /// One list.
    None,
    /// Each Project under its header.
    Project,
}

/// How many lines a card has, the same wherever it stands (ADR 0098,
/// decision 9, as amended again): 3, 2 or 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "sidebar/", type = "3 | 2 | 1")]
pub struct Card(u8);

impl Card {
    /// Three lines: the default.
    pub const THREE: Card = Card(3);

    /// How many lines it is.
    pub fn lines(self) -> u8 {
        self.0
    }
}

impl TryFrom<toml::Value> for Card {
    type Error = String;

    /// `"auto"`, the lines by where a card stood, is no more: it reads as
    /// three, and says so at its line.
    fn try_from(value: toml::Value) -> Result<Card, String> {
        match value {
            toml::Value::Integer(lines @ 1..=3) => Ok(Card(lines as u8)),
            toml::Value::String(word) if word == "auto" => Err(
                "card = \"auto\" is no longer used: a card has 3, 2 or 1 lines everywhere, 3 by default"
                    .to_owned(),
            ),
            value => Err(format!("card is 3, 2 or 1, not {value}")),
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
        serializer.serialize_u8(self.0)
    }
}

impl JsonSchema for Card {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "Card".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "description": "How many lines a card has, the same everywhere: 3, 2 or 1.",
            "enum": [3, 2, 1],
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

/// How the sidebar arranges Threads: every key is optional.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SidebarSettings {
    /// How the list is grouped: one list, or each Project under its
    /// header.
    pub group: Option<GroupBy>,
    /// How many lines a card has, the same everywhere: 3, 2 or 1.
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
/// table `[spaces]`; and as before ADR 0098, decision 28: the table
/// `[snooze]`.
const RENAMED: &[Renamed] = &[
    Renamed::key("", "snooze", "later"),
    Renamed::key("", "spaces", "projects"),
];

/// What ADR 0098 put out of use: the presets and their sections and rows
/// (decisions 7 and 9, as amended), the list of Projects
/// (decision 16), a Project's New Thread, as the sidebar starts no Thread
/// (decision 19, as Roma amended it on 2026-11-12), and `[hold]`, as the
/// order always keeps still under the pointer (decision 6, as Roma
/// amended it on 2026-11-14). A file that
/// still says them is told so, and the rest of it holds.
const RETIRED: &[Retired] = &[
    Retired {
        at: "preset",
        table: false,
        says: "preset is no longer used: group = \"none\" or \"project\" groups the list",
    },
    Retired {
        at: "group",
        table: true,
        says: "[group] is no longer used: group = \"none\" or \"project\" groups the list",
    },
    Retired {
        at: "row",
        table: true,
        says: "[row] is no longer used: card = 3, 2 or 1 says a card's lines",
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

/// What the view menu writes when there is no `sidebar.toml` yet: every
/// key with its default, commented out.
pub const TEMPLATE: &str = include_str!("../sidebar.toml");

impl SidebarSettings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: SidebarSettings) -> SidebarSettings {
        SidebarSettings {
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

    /// Banda's defaults: the bottom layer, one list.
    pub fn defaults() -> SidebarSettings {
        SidebarSettings {
            group: Some(GroupBy::None),
            card: Some(Card::THREE),
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
    fn arranged(self, file: &Path) -> Sidebar {
        let all = self.over(SidebarSettings::defaults());
        Sidebar {
            file: file.display().to_string(),
            group: all.group.unwrap_or(GroupBy::None),
            card: all.card.unwrap_or(Card::THREE),
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

/// Reads a `sidebar.toml`, and checks what TOML alone does not, as
/// [`crate::read`] reads a file. A key ADR 0098 put out of use is named
/// and left out, and so is a value it no longer has: `group = "machine"`
/// is one list, and `card = "auto"` three lines.
pub fn read_sidebar(
    path: &Path,
    text: &str,
    problems: &mut Vec<Problem>,
) -> Option<SidebarSettings> {
    crate::say_renamed(path, text, RENAMED, problems);
    let kept = crate::say_retired(path, text, RETIRED, problems);
    let mut settings: SidebarSettings = crate::read(path, &kept, problems)?;
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

/// Resolves the sidebar on this machine: the Person's file, watched
/// there or not, over Banda's defaults.
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
        .and_then(|(path, text)| read_sidebar(path, text, problems))
        .unwrap_or_default();
    let defaults = SidebarSettings::defaults();
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("file", &mine, mine_file.as_ref()),
    ];
    let merged = mine.over(defaults);
    let keyed = keyed::keyed(&merged, &layers);
    (merged.arranged(&file), keyed)
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
        assert_eq!(sidebar.group, GroupBy::None);
        assert_eq!(sidebar.card, Card::THREE);
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
    }

    #[test]
    fn the_view_s_keys_are_the_person_s_to_change() {
        let (sidebar, problems) = with(
            "group = \"project\"\ncard = 1\n\
             [inbox]\norder = \"newest\"\nopen = false\nworking = false\n",
        );
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(sidebar.group, GroupBy::Project);
        assert_eq!(sidebar.card.lines(), 1);
        assert_eq!(
            sidebar.inbox,
            Inbox {
                order: InboxOrder::Newest,
                open: false,
                working: false
            }
        );
    }

    /// ADR 0098, decisions 7 and 9 as amended: a file that still names a
    /// preset, a card's lines by where it stands or the machine grouping
    /// still reads, as one list of three-line cards, and is told of each.
    #[test]
    fn presets_auto_cards_and_machine_grouping_are_named_and_the_rest_holds() {
        let (sidebar, problems) = with(
            "preset = \"projects\"\ncard = \"auto\"\ngroup = \"machine\"\n[sort]\nby = \"title\"\n",
        );
        let lines: Vec<_> = said(&problems).into_iter().map(|(line, _)| line).collect();
        assert_eq!(lines, [1, 2, 3], "{problems:?}");
        assert!(problems[0].message.starts_with("preset is no longer used"));
        assert_eq!(
            problems[1].message,
            "card = \"auto\" is no longer used: a card has 3, 2 or 1 lines everywhere, \
             3 by default"
        );
        assert_eq!(problems[1].column, Some(8), "at its value");
        assert!(problems[2].message.contains("machine"), "{problems:?}");
        assert!(problems.iter().all(|p| !p.left_out), "{problems:?}");
        assert_eq!(sidebar.group, GroupBy::None);
        assert_eq!(sidebar.card, Card::THREE);
        assert_eq!(sidebar.sort.by, SortBy::Title, "the rest holds");
    }

    /// ADR 0098, decision 9 as amended again: 3, 2 or 1 lines, as the
    /// Person picks.
    #[test]
    fn a_card_has_as_many_lines_as_the_person_picks() {
        for lines in [3, 2, 1] {
            let (sidebar, problems) = with(&format!("card = {lines}\n"));
            assert!(problems.is_empty(), "{problems:?}");
            assert_eq!(sidebar.card.lines(), lines);
        }
    }

    #[test]
    fn keys_out_of_use_are_named_and_the_rest_holds() {
        let (sidebar, problems) = with(
            "[group]\nby = \"project\"\nstates = [\"active\", \"settled\"]\nlimit = 0\n\
             [projects]\nlist = true\norder = \"name\"\nnew-thread = false\n\
             [row]\nlines = 1\nhide = [\"harness\"]\nline1 = [\"mark\"]\n\
             [machines]\nrows = \"icon\"\n",
        );
        assert_eq!(
            said(&problems),
            [
                (
                    1,
                    "[group] is no longer used: group = \"none\" or \"project\" groups the list"
                ),
                (6, "projects.list is no longer used"),
                (
                    8,
                    "projects.new-thread is no longer used: a Thread starts in the New Thread Pane"
                ),
                (
                    9,
                    "[row] is no longer used: card = 3, 2 or 1 says a card's lines"
                ),
            ]
        );
        assert_eq!(problems[0].column, Some(2), "at the table's name");
        assert!(problems.iter().all(|p| !p.left_out), "{problems:?}");
        assert_eq!(sidebar.group, GroupBy::None, "not by");
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
        let (sidebar, problems) = with("[spaces]\norder = \"name\" # by name\n");
        assert_eq!(sidebar.projects.order, ProjectOrder::Name);
        assert_eq!(said(&problems), [(1, "spaces is called projects now")]);
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
            with("group = \"project\"\n[machines]\nrows = \"icon\"\nthis-too = true\n");
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
    fn a_wrong_key_is_named_where_it_is() {
        let (sidebar, problems) = with("group = \"project\"\n[sort]\nby = 5\n");
        assert_eq!(sidebar.sort.by, SortBy::Attention, "left out");
        assert_eq!(sidebar.group, GroupBy::Project, "the rest holds");
        assert_eq!((problems[0].line, problems[0].column), (Some(3), Some(6)));

        let (sidebar, problems) = with("card = 5\n");
        assert_eq!(sidebar.card, Card::THREE, "left out");
        assert_eq!(problems[0].message, "card is 3, 2 or 1, not 5");

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
                "bar", "card", "group", "inbox", "later", "machines", "projects", "sort"
            ]
        );
        assert_eq!(schema["properties"]["group"]["$ref"], "#/$defs/GroupBy");
        assert_eq!(consts("GroupBy"), ["none", "project"]);
        assert_eq!(def("Card")["enum"], serde_json::json!([3, 2, 1]));
        assert_eq!(keys(def("InboxSettings")), ["open", "order", "working"]);
        assert_eq!(consts("InboxOrder"), ["oldest", "newest"]);
        assert_eq!(keys(def("ProjectsSettings")), ["order", "rollup"]);
    }

    #[test]
    fn the_template_parses() {
        let mut problems = Vec::new();
        read_sidebar(Path::new("sidebar.toml"), TEMPLATE, &mut problems).unwrap();
        assert!(problems.is_empty(), "{problems:?}");
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
        let settings = read_sidebar(Path::new("t"), &uncommented, &mut problems)
            .unwrap_or_else(|| panic!("{problems:?}\n{uncommented}"));
        assert!(problems.is_empty(), "{problems:?}\n{uncommented}");
        let file = Path::new("f");
        let template = settings.arranged(file);
        let defaults = SidebarSettings::default().arranged(file);
        assert_eq!(template, defaults);
    }
}
