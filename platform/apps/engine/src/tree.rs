//! The Tree an App's view answers: its screen as data, catalogue components
//! and their props, which each client draws with its own (ADR 0062,
//! decision 7).
//!
//! ```json
//! { "title": "Clients", "about": "The people I work with.",
//!   "children": [
//!     { "node": "Table", "rows": [{ "name": "Anna", "city": "Berlin" }],
//!       "columns": [{ "key": "name", "title": "Name" }, { "key": "city", "title": "City" }] },
//!     { "node": "Form", "title": "Add a client", "command": "add" } ] }
//! ```
//!
//! The engine reads what the App's code answered before any client sees
//! it ([`resolved`]): a client is trusted and a Tree is not. What it
//! refuses it refuses by where it is in the Tree, in words the App's
//! author puts right from. A control names one of the App's own commands
//! that its `methods.json` marks `ui`, and nothing else. A Form's fields
//! come from that command's params, so the App does not write them twice.

use crate::folder::{Declared, Folder};
use banda_kernel::Kind;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use ts_rs::TS;

/// The most nodes a Tree holds.
const NODES: usize = 500;
/// The most rows a Table shows, and items a List.
const ROWS: usize = 1000;
/// The most columns a Table has.
const COLUMNS: usize = 12;
/// The most columns a Grid sets its nodes in, and lines a Chart draws.
const ACROSS: usize = 6;

/// The names of the nodes, as a refusal lists them.
const NAMES: &str = "Card, Grid, Tabs, Accordion, Dialog, Table, List, Chart, Stat, Progress, Form, Button, Link, Badge, Alert, Empty, Separator and Markdown";

/// An App's screen, as its view answers it and the engine read it.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/")]
pub struct Tree {
    /// The place in the Project's log it shows: a client that follows
    /// the App's events from here misses none, and reads it again on one.
    #[ts(type = "number")]
    pub at: i64,
    pub title: String,
    /// What the screen is for, in a line under its title.
    pub about: Option<String>,
    pub children: Vec<Node>,
}

/// One component of a Tree, by its `node`.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(tag = "node")]
#[ts(export, export_to = "apps/", rename = "TreeNode")]
pub enum Node {
    Card(Card),
    Grid(Grid),
    Tabs(Tabs),
    Accordion(Accordion),
    Dialog(Dialog),
    Table(Table),
    List(List),
    Chart(Chart),
    Stat(Stat),
    Progress(Progress),
    Form(Form),
    Button(Button),
    Link(Link),
    Badge(Badge),
    Alert(Alert),
    Empty(Empty),
    Separator(Separator),
    Markdown(Markdown),
}

/// What a node says by its colour: nothing, that it is well, a warning,
/// or that it is wrong or cannot be undone.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "apps/", rename = "TreeTone")]
pub enum Tone {
    #[default]
    Plain,
    Good,
    Warn,
    Bad,
}

/// A box around other nodes, with a title when it has one.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeCard")]
pub struct Card {
    pub title: Option<String>,
    /// A line under its title.
    pub about: Option<String>,
    pub children: Vec<Node>,
}

/// Nodes side by side, in columns that fold where the Pane is narrow.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeGrid")]
pub struct Grid {
    /// How many across: as many as fit when unsaid.
    pub columns: Option<u8>,
    pub children: Vec<Node>,
}

/// Nodes under a title: a tab of Tabs, an item of an Accordion.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeSection")]
pub struct Section {
    pub title: String,
    pub children: Vec<Node>,
}

/// Sections one at a time, chosen by their titles in a row.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeTabs")]
pub struct Tabs {
    pub tabs: Vec<Section>,
}

/// Sections one under another, each opened by its title.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeAccordion")]
pub struct Accordion {
    pub items: Vec<Section>,
}

/// A button that opens nodes over the screen: a Form to fill, or more
/// of one thing.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeDialog")]
pub struct Dialog {
    /// The words on its button.
    pub label: String,
    pub title: String,
    pub about: Option<String>,
    pub children: Vec<Node>,
}

/// Rows by column.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeTable")]
pub struct Table {
    pub columns: Vec<Column>,
    /// Each a row by its columns' keys: text, a number, true, false or
    /// null. A row may hold more keys than columns, as its id, for an
    /// action to take.
    #[ts(type = "Array<Record<string, string | number | boolean | null>>")]
    pub rows: Vec<Map<String, Value>>,
    /// What it says with no row.
    pub empty: Option<String>,
    /// Whether it has a field that finds rows by their text.
    pub search: bool,
    /// The view a click on a row opens.
    pub open: Option<Open>,
    /// What can be done with each row.
    pub actions: Vec<Action>,
}

/// One column of a Table.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeColumn")]
pub struct Column {
    /// The key of a row its cells come from.
    pub key: String,
    pub title: String,
    /// How a cell is shown: as text when unsaid.
    #[serde(rename = "as", default)]
    pub shown: Shown,
    /// The tone of a badge by its cell's text: `{ "won": "good" }`.
    #[serde(default)]
    pub tones: BTreeMap<String, Tone>,
}

/// How a Table shows a cell.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "apps/", rename = "TreeShown")]
pub enum Shown {
    #[default]
    Text,
    Badge,
    /// True as a tick, false as nothing.
    Check,
    /// A number from 0 to 100 as a bar.
    Progress,
}

/// Another of the App's views, opened in the screen's place: a record's
/// own screen from its row, the same list by another filter. The Pane
/// keeps the way back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeOpen")]
pub struct Open {
    /// The App's view, without the App's prefix.
    pub view: String,
    /// The params written here.
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub params: Map<String, Value>,
    /// The params it takes from its row, each by the row's key.
    #[serde(default)]
    pub take: BTreeMap<String, String>,
}

/// Words that open another of the App's views.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeLink")]
pub struct Link {
    pub label: String,
    #[serde(flatten)]
    pub open: Open,
}

/// What can be done with a row of a Table or an item of a List: one of
/// the App's commands, sent at once, after a question, or from a form.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeAction")]
pub struct Action {
    pub label: String,
    /// The App's command it sends, without the App's prefix.
    pub command: String,
    /// The params written here.
    #[ts(type = "Record<string, unknown>")]
    pub params: Map<String, Value>,
    /// The params it takes from its row, each by the row's key.
    pub take: BTreeMap<String, String>,
    /// The question it asks first.
    pub confirm: Option<String>,
    /// The form it opens first, filled from the row.
    pub form: Option<Form>,
    pub tone: Tone,
}

/// Items of two lines, for what reads badly in columns.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeList")]
pub struct List {
    pub items: Vec<Item>,
    /// What it says with no item.
    pub empty: Option<String>,
}

/// One item of a List.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeItem")]
pub struct Item {
    pub title: String,
    /// Its second line.
    pub about: Option<String>,
    pub badge: Option<String>,
    /// Its badge's tone.
    pub tone: Tone,
    /// The view a click on it opens.
    pub open: Option<Open>,
    /// What can be done with it.
    pub actions: Vec<Action>,
}

/// Numbers drawn: bars, lines or areas along `x`, or the parts of a
/// whole.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeChart")]
pub struct Chart {
    pub kind: ChartKind,
    pub title: Option<String>,
    /// The key of a row that names it: along the bottom, or a part.
    pub x: String,
    /// What is drawn of each row: one number each. A pie draws the first.
    pub series: Vec<Series>,
    #[ts(type = "Array<Record<string, string | number | boolean | null>>")]
    pub rows: Vec<Map<String, Value>>,
}

/// One number of a Chart's rows, and its name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeSeries")]
pub struct Series {
    pub key: String,
    pub title: String,
}

/// How a Chart draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "apps/", rename = "TreeChartKind")]
pub enum ChartKind {
    Bar,
    Line,
    Area,
    Pie,
}

/// One number that matters, large, under what it counts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeStat")]
pub struct Stat {
    pub label: String,
    /// Text or a number.
    #[ts(type = "string | number")]
    pub value: Value,
    /// A line under it: against what, or since when.
    pub about: Option<String>,
    /// The tone of that line.
    #[serde(default)]
    pub tone: Tone,
}

/// How far along, as a bar.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeProgress")]
pub struct Progress {
    pub value: f64,
    /// What `value` is out of: 100 when unsaid.
    #[serde(default = "hundred")]
    pub max: f64,
    pub label: Option<String>,
}

fn hundred() -> f64 {
    100.0
}

/// Words that must be seen, in a box of their tone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeAlert")]
pub struct Alert {
    pub title: String,
    pub about: Option<String>,
    #[serde(default)]
    pub tone: Tone,
}

/// A line between what is above and below.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeSeparator")]
pub struct Separator {}

/// A form that sends one of the App's commands, a field a param.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeForm")]
pub struct Form {
    pub title: Option<String>,
    /// The App's command it sends, without the App's prefix.
    pub command: String,
    /// The words on its button.
    pub submit: String,
    /// The params it sends as written, beside what its fields fill: the
    /// id of what it changes.
    #[ts(type = "Record<string, unknown>")]
    pub params: Map<String, Value>,
    pub fields: Vec<Field>,
}

/// One field of a Form: one param of its command.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeField")]
pub struct Field {
    /// The param it fills.
    pub name: String,
    pub label: String,
    pub kind: FieldKind,
    /// Whether the command requires it.
    pub required: bool,
    pub placeholder: Option<String>,
    /// A line under it.
    pub about: Option<String>,
    /// What it holds as the form opens.
    #[ts(type = "string | number | boolean | null")]
    pub value: Option<Value>,
    /// A number's least, most and step, from the param.
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    /// What a `select` or a `radio` offers.
    pub options: Vec<Choice>,
}

/// One thing a `select` offers: the value the command gets, and the
/// words shown for it.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeChoice")]
pub struct Choice {
    pub value: String,
    pub label: String,
}

/// What a field is filled with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "apps/", rename = "TreeFieldKind")]
pub enum FieldKind {
    Text,
    Textarea,
    Date,
    Time,
    Datetime,
    Email,
    Url,
    Password,
    Number,
    Slider,
    Select,
    Radio,
    Checkbox,
    Switch,
}

impl FieldKind {
    /// What kinds one param may be shown as: those of one family.
    fn family(self) -> u8 {
        match self {
            Self::Text
            | Self::Textarea
            | Self::Date
            | Self::Time
            | Self::Datetime
            | Self::Email
            | Self::Url
            | Self::Password => 0,
            Self::Number | Self::Slider => 1,
            Self::Select | Self::Radio => 2,
            Self::Checkbox | Self::Switch => 3,
        }
    }
}

/// A button that sends one of the App's commands with the params written
/// here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeButton")]
pub struct Button {
    pub label: String,
    /// The App's command it sends, without the App's prefix.
    pub command: String,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub params: Map<String, Value>,
    /// The question it asks first.
    pub confirm: Option<String>,
    #[serde(default)]
    pub tone: Tone,
}

/// A word or a count, set apart.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeBadge")]
pub struct Badge {
    pub text: String,
    #[serde(default)]
    pub tone: Tone,
}

/// What to say where there is nothing yet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeEmpty")]
pub struct Empty {
    pub title: String,
    pub about: Option<String>,
}

/// Text in Markdown.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeMarkdown")]
pub struct Markdown {
    pub text: String,
}

/// A Tree's own props, beside its children.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Titled {
    title: String,
    about: Option<String>,
}

/// A Card's props, beside its children.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Boxed {
    title: Option<String>,
    about: Option<String>,
}

/// A Grid's props, beside its children.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Across {
    columns: Option<u8>,
}

/// A Section's props, beside its children.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Headed {
    title: String,
}

/// A Dialog's props, beside its children.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Opened {
    label: String,
    title: String,
    about: Option<String>,
}

/// A Table as an App writes it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenTable {
    columns: Vec<Column>,
    rows: Vec<Map<String, Value>>,
    empty: Option<String>,
    #[serde(default)]
    search: bool,
    open: Option<Open>,
    #[serde(default)]
    actions: Vec<WrittenAction>,
}

/// A List as an App writes it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenList {
    items: Vec<WrittenItem>,
    empty: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenItem {
    title: String,
    about: Option<String>,
    badge: Option<String>,
    #[serde(default)]
    tone: Tone,
    open: Option<Open>,
    #[serde(default)]
    actions: Vec<WrittenAction>,
}

/// An action as an App writes it: `"form": true` for a form of every
/// param it does not write or take, or `fields` to choose them.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenAction {
    label: String,
    command: String,
    #[serde(default)]
    params: Map<String, Value>,
    #[serde(default)]
    take: BTreeMap<String, String>,
    confirm: Option<String>,
    #[serde(default)]
    form: bool,
    fields: Option<Vec<WrittenField>>,
    /// The words on its form's button: its label when unsaid.
    submit: Option<String>,
    #[serde(default)]
    tone: Tone,
}

/// A Form as an App writes it: `fields` only to choose among its
/// command's params, to order them or to say more of one.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenForm {
    title: Option<String>,
    command: String,
    submit: Option<String>,
    fields: Option<Vec<WrittenField>>,
    /// What its fields hold as it opens, by param.
    #[serde(default)]
    values: Map<String, Value>,
    #[serde(default)]
    params: Map<String, Value>,
}

/// One field as an App writes it: the rest comes from the param.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenField {
    name: String,
    label: Option<String>,
    kind: Option<FieldKind>,
    placeholder: Option<String>,
    about: Option<String>,
}

/// The Tree `answer` is, which a view of `app` answered from what its
/// Project held at `at`: read, held to its limits, its controls checked
/// against the App's commands and its Forms filled from their params.
/// Refused with where in the Tree and why.
pub fn resolved(answer: Value, app: &Folder, at: i64) -> Result<Tree, String> {
    let Value::Object(mut tree) = answer else {
        return Err("a view answers a Tree, an object with \"title\" and \"children\".".to_owned());
    };
    let mut nodes = 0;
    let children = children(tree.remove("children"), "children", app, &mut nodes)?;
    let Titled { title, about } = read(tree, "the Tree")?;
    Ok(Tree {
        at,
        title,
        about,
        children,
    })
}

/// Props read from what is left of a node, an unknown one refused.
fn read<T: DeserializeOwned>(props: Map<String, Value>, at: &str) -> Result<T, String> {
    serde_json::from_value(Value::Object(props)).map_err(|error| format!("{at}: {error}."))
}

fn children(
    written: Option<Value>,
    at: &str,
    app: &Folder,
    nodes: &mut usize,
) -> Result<Vec<Node>, String> {
    let Some(Value::Array(written)) = written else {
        return Err(format!("{at}: it is a list of nodes."));
    };
    (written.into_iter().enumerate())
        .map(|(place, child)| node(child, &format!("{at}[{place}]"), app, nodes))
        .collect()
}

fn node(written: Value, at: &str, app: &Folder, nodes: &mut usize) -> Result<Node, String> {
    *nodes += 1;
    if *nodes > NODES {
        return Err(format!(
            "a Tree holds at most {NODES} nodes: show less, and the rest by the view's params."
        ));
    }
    let Value::Object(mut props) = written else {
        return Err(format!("{at}: a node is an object with \"node\"."));
    };
    let Some(Value::String(name)) = props.remove("node") else {
        return Err(format!("{at}: it has no \"node\": the nodes are {NAMES}."));
    };
    let at = &format!("{at} ({name})");
    Ok(match name.as_str() {
        "Card" => {
            let children = within(&mut props, at, app, nodes)?;
            let Boxed { title, about } = read(props, at)?;
            Node::Card(Card {
                title,
                about,
                children,
            })
        }
        "Grid" => {
            let children = within(&mut props, at, app, nodes)?;
            let Across { columns } = read(props, at)?;
            if columns.is_some_and(|columns| !(1..=ACROSS).contains(&usize::from(columns))) {
                return Err(format!("{at}: it has 1 to {ACROSS} columns."));
            }
            Node::Grid(Grid { columns, children })
        }
        "Tabs" => {
            let tabs = sections(props.remove("tabs"), &format!("{at}.tabs"), app, nodes)?;
            read::<Nothing>(props, at)?;
            Node::Tabs(Tabs { tabs })
        }
        "Accordion" => {
            let items = sections(props.remove("items"), &format!("{at}.items"), app, nodes)?;
            read::<Nothing>(props, at)?;
            Node::Accordion(Accordion { items })
        }
        "Dialog" => {
            let children = within(&mut props, at, app, nodes)?;
            let Opened {
                label,
                title,
                about,
            } = read(props, at)?;
            Node::Dialog(Dialog {
                label,
                title,
                about,
                children,
            })
        }
        "Table" => Node::Table(table(read(props, at)?, app, at)?),
        "List" => {
            let WrittenList { items, empty } = read(props, at)?;
            most(items.len(), "items", at)?;
            let items = (items.into_iter().enumerate())
                .map(|(place, item)| {
                    let at = &format!("{at}.items[{place}]");
                    Ok(Item {
                        actions: actions(item.actions, false, app, at)?,
                        open: (item.open)
                            .map(|open| opened(open, None, app, &format!("{at}.open")))
                            .transpose()?,
                        title: item.title,
                        about: item.about,
                        badge: item.badge,
                        tone: item.tone,
                    })
                })
                .collect::<Result<_, String>>()?;
            Node::List(List { items, empty })
        }
        "Chart" => Node::Chart(chart(read(props, at)?, at)?),
        "Stat" => {
            let stat: Stat = read(props, at)?;
            if !(stat.value.is_string() || stat.value.is_number()) {
                return Err(format!("{at}.value: it is text or a number."));
            }
            Node::Stat(stat)
        }
        "Progress" => {
            let progress: Progress = read(props, at)?;
            if progress.max <= 0.0 {
                return Err(format!("{at}.max: it is more than 0."));
            }
            Node::Progress(progress)
        }
        "Form" => Node::Form(form(read(props, at)?, &Map::new(), app, at)?),
        "Button" => {
            let button: Button = read(props, at)?;
            command(app, &button.command, at)?;
            Node::Button(button)
        }
        "Link" => {
            let link: Link = read(props, at)?;
            Node::Link(Link {
                open: opened(link.open, None, app, at)?,
                label: link.label,
            })
        }
        "Badge" => Node::Badge(read(props, at)?),
        "Alert" => Node::Alert(read(props, at)?),
        "Empty" => Node::Empty(read(props, at)?),
        "Separator" => Node::Separator(read(props, at)?),
        "Markdown" => Node::Markdown(read(props, at)?),
        _ => {
            return Err(format!(
                "{at}: there is no such node: the nodes are {NAMES}."
            ));
        }
    })
}

/// A node with no props of its own, beside what was taken from it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

/// The children of the node at `at`, taken out of its props.
fn within(
    props: &mut Map<String, Value>,
    at: &str,
    app: &Folder,
    nodes: &mut usize,
) -> Result<Vec<Node>, String> {
    children(
        props.remove("children"),
        &format!("{at}.children"),
        app,
        nodes,
    )
}

/// The Sections of Tabs or an Accordion: at least one.
fn sections(
    written: Option<Value>,
    at: &str,
    app: &Folder,
    nodes: &mut usize,
) -> Result<Vec<Section>, String> {
    let wrong = || format!("{at}: it is a list of {{ \"title\", \"children\" }}, at least one.");
    let Some(Value::Array(written)) = written else {
        return Err(wrong());
    };
    if written.is_empty() {
        return Err(wrong());
    }
    (written.into_iter().enumerate())
        .map(|(place, section)| {
            let at = &format!("{at}[{place}]");
            let Value::Object(mut props) = section else {
                return Err(wrong());
            };
            let children = within(&mut props, at, app, nodes)?;
            let Headed { title } = read(props, at)?;
            Ok(Section { title, children })
        })
        .collect()
}

/// Whether `value` is text, a number, true, false or null.
fn plain(value: &Value) -> bool {
    !(value.is_array() || value.is_object())
}

/// Whether every cell of `rows` is text, a number, true, false or null.
fn cells(rows: &[Map<String, Value>], at: &str) -> Result<(), String> {
    for (place, row) in rows.iter().enumerate() {
        if let Some((key, _)) = row.iter().find(|(_, cell)| !plain(cell)) {
            return Err(format!(
                "{at}.rows[{place}].{key}: a cell is text, a number, true, false or null."
            ));
        }
    }
    Ok(())
}

fn chart(chart: Chart, at: &str) -> Result<Chart, String> {
    if chart.series.is_empty() || chart.series.len() > ACROSS {
        return Err(format!("{at}: it draws 1 to {ACROSS} series."));
    }
    most(chart.rows.len(), "rows", at)?;
    cells(&chart.rows, at)?;
    Ok(chart)
}

/// What `open` opens, checked: one of the App's own views, with params
/// the view takes and every one it requires. `rows` are the rows it
/// takes from, a Table's: nothing else has keys to take.
fn opened(
    open: Open,
    rows: Option<&[Map<String, Value>]>,
    app: &Folder,
    at: &str,
) -> Result<Open, String> {
    let declared = match app.declared(&open.view) {
        Some(declared) if declared.kind == Kind::View => declared,
        Some(_) => {
            return Err(format!(
                "{at}: {} is not a view: only a view is opened, and a command is sent by a Button.",
                open.view
            ));
        }
        None => {
            return Err(format!(
                "{at}: {} has no view {}: declare it in methods.json with \"kind\": \"view\".",
                app.id, open.view
            ));
        }
    };
    match rows {
        None if !open.take.is_empty() => {
            return Err(format!(
                "{at}.take: only a Table's row has keys to take from: write its params."
            ));
        }
        // A key no row has is a slip of the pen: a row leaves out only
        // what it has nothing for.
        Some(rows) if !rows.is_empty() => {
            let missing = |key: &&String| !rows.iter().any(|row| row.contains_key(*key));
            if let Some(key) = open.take.values().find(missing) {
                return Err(format!("{at}.take: no row has the key {key}."));
            }
        }
        _ => {}
    }
    let takes = declared.params.get("properties").and_then(Value::as_object);
    let given = |name: &str| open.params.contains_key(name) || open.take.contains_key(name);
    let named = open.params.keys().chain(open.take.keys());
    if let Some(name) = { named }.find(|name| !takes.is_some_and(|takes| takes.contains_key(*name)))
    {
        return Err(format!(
            "{at}: the view {} takes no param {name}: declare it in the view's params.",
            declared.name
        ));
    }
    let required = declared.params.get("required").and_then(Value::as_array);
    let required = required.into_iter().flatten().filter_map(Value::as_str);
    if let Some(name) = { required }.find(|name| !given(name)) {
        return Err(format!(
            "{at}: the view {} requires the param {name}: write it in \"params\", or take it from the row.",
            declared.name
        ));
    }
    Ok(open)
}

/// The actions of a row or an item, each checked as a control is. Only a
/// row has keys to take from.
fn actions(
    written: Vec<WrittenAction>,
    row: bool,
    app: &Folder,
    at: &str,
) -> Result<Vec<Action>, String> {
    (written.into_iter().enumerate())
        .map(|(place, action)| {
            let at = &format!("{at}.actions[{place}]");
            if !row && !action.take.is_empty() {
                return Err(format!(
                    "{at}.take: an item has no row to take from: write its params."
                ));
            }
            let declared = command(app, &action.command, at)?;
            let none = Map::new();
            let params =
                (declared.params.get("properties").and_then(Value::as_object)).unwrap_or(&none);
            if let Some(name) = (action.take.keys()).find(|name| !params.contains_key(*name)) {
                return Err(format!(
                    "{at}.take.{name}: the command {} takes no param of that name.",
                    declared.name
                ));
            }
            if action.confirm.is_some() && (action.form || action.fields.is_some()) {
                return Err(format!(
                    "{at}: it asks a question or opens a form, not both: a form is sent by its own button."
                ));
            }
            // The form fills what the action does not write: what it
            // takes from the row is what the form holds as it opens.
            let form = (action.form || action.fields.is_some())
                .then(|| {
                    let written = WrittenForm {
                        title: None,
                        command: action.command.clone(),
                        submit: Some(action.submit.unwrap_or_else(|| action.label.clone())),
                        fields: action.fields,
                        values: Map::new(),
                        params: Map::new(),
                    };
                    form(written, &action.params, app, at)
                })
                .transpose()?;
            Ok(Action {
                label: action.label,
                command: action.command,
                params: action.params,
                take: action.take,
                confirm: action.confirm,
                form,
                tone: action.tone,
            })
        })
        .collect()
}

fn most(count: usize, what: &str, at: &str) -> Result<(), String> {
    if count > ROWS {
        return Err(format!(
            "{at}: it has {count} {what}, and shows at most {ROWS}: answer fewer, and the rest by the view's params."
        ));
    }
    Ok(())
}

fn table(written: WrittenTable, app: &Folder, at: &str) -> Result<Table, String> {
    if written.columns.is_empty() || written.columns.len() > COLUMNS {
        return Err(format!("{at}: it has 1 to {COLUMNS} columns."));
    }
    most(written.rows.len(), "rows", at)?;
    cells(&written.rows, at)?;
    Ok(Table {
        actions: actions(written.actions, true, app, at)?,
        open: (written.open)
            .map(|open| opened(open, Some(&written.rows), app, &format!("{at}.open")))
            .transpose()?,
        columns: written.columns,
        rows: written.rows,
        empty: written.empty,
        search: written.search,
    })
}

/// The command of `app` a control at `at` names: its own, and marked
/// `ui`.
fn command<'a>(app: &'a Folder, name: &str, at: &str) -> Result<&'a Declared, String> {
    match app.declared(name) {
        Some(declared) if declared.kind == Kind::Command && declared.ui => Ok(declared),
        Some(declared) if declared.kind == Kind::Command => Err(format!(
            "{at}: the command {name} is not marked for a screen: write \"ui\": true on it in methods.json."
        )),
        Some(_) => Err(format!(
            "{at}: {name} is not a command: a control sends one of the App's commands."
        )),
        None => Err(format!(
            "{at}: {} has no command {name}: a control sends one of the App's own.",
            app.id
        )),
    }
}

/// The Form `written` is, its fields from its command's params. `sent`
/// are the params its control writes itself, which a form of every param
/// leaves out.
fn form(
    written: WrittenForm,
    sent: &Map<String, Value>,
    app: &Folder,
    at: &str,
) -> Result<Form, String> {
    let declared = command(app, &written.command, at)?;
    let none = Map::new();
    let params = (declared.params.get("properties").and_then(Value::as_object)).unwrap_or(&none);
    let required: Vec<&str> = (declared.params.get("required").and_then(Value::as_array))
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    // The params the App chose, in its order; or every param, in the
    // order methods.json writes them.
    let every = written.fields.is_none();
    let chosen = written.fields.unwrap_or_else(|| {
        let field = |name: &String| WrittenField {
            name: name.clone(),
            label: None,
            kind: None,
            placeholder: None,
            about: None,
        };
        (params.keys())
            .filter(|name| !sent.contains_key(*name) && !written.params.contains_key(*name))
            .map(field)
            .collect()
    });
    let mut values = written.values;
    let mut fields = Vec::with_capacity(chosen.len());
    for field in chosen {
        let at = &format!("{at}.fields ({})", field.name);
        let schema = params.get(&field.name).ok_or_else(|| {
            format!(
                "{at}: the command {} takes no param of that name.",
                declared.name
            )
        })?;
        let required = required.contains(&&*field.name);
        let Some((kind, options)) = filled_with(schema) else {
            // A list or an object has no field. A Form of every param
            // leaves it out, unless the command cannot go without it.
            if every && !required {
                continue;
            }
            return Err(format!(
                "{at}: a form has no field for what that param takes, a list or an object: send it with a Button's params, or take it apart into params a form fills."
            ));
        };
        let kind = match field.kind {
            None => kind,
            Some(asked) if asked.family() == kind.family() => asked,
            Some(_) => {
                return Err(format!(
                    "{at}: its kind follows the param's type: text may be a textarea, date, time, datetime, email, url or password; a number a slider; one of an enum a radio; true or false a switch."
                ));
            }
        };
        let number = |key: &str| schema.get(key).and_then(Value::as_f64);
        let (min, max) = (number("minimum"), number("maximum"));
        if kind == FieldKind::Slider && (min.is_none() || max.is_none()) {
            return Err(format!(
                "{at}: a slider goes from the param's \"minimum\" to its \"maximum\": write both in methods.json."
            ));
        }
        let value = values.remove(&field.name);
        if value.as_ref().is_some_and(|value| !plain(value)) {
            return Err(format!(
                "{at}: what it holds is text, a number, true, false or null."
            ));
        }
        fields.push(Field {
            label: field.label.unwrap_or_else(|| label(schema, &field.name)),
            placeholder: field.placeholder,
            about: field.about,
            value,
            min,
            max,
            // Where the param says no step, a whole number goes by ones
            // and a slider by a hundredth of its way.
            step: number("multipleOf").or_else(|| {
                if schema.get("type").and_then(Value::as_str) == Some("integer") {
                    return Some(1.0);
                }
                (kind == FieldKind::Slider).then_some((max? - min?) / 100.0)
            }),
            name: field.name,
            kind,
            required,
            options,
        });
    }
    if let Some(field) = (fields.iter()).find(|field| written.params.contains_key(&field.name)) {
        return Err(format!(
            "{at}.params.{}: it is one of the form's fields too: write it or let the form fill it.",
            field.name
        ));
    }
    if let Some(name) = (written.params.keys()).find(|name| !params.contains_key(*name)) {
        return Err(format!(
            "{at}.params.{name}: the command {} takes no param of that name.",
            declared.name
        ));
    }
    if let Some(name) = values.keys().next() {
        return Err(format!(
            "{at}.values.{name}: the form has no field of that name."
        ));
    }
    Ok(Form {
        title: written.title,
        submit: written.submit.unwrap_or_else(|| words(&declared.name)),
        command: written.command,
        params: written.params,
        fields,
    })
}

/// What a form fills a param of this JSON Schema with, and a select's
/// options; none for what a form has no field for, a list or an object.
fn filled_with(schema: &Value) -> Option<(FieldKind, Vec<Choice>)> {
    let one_of = schema.get("enum").and_then(Value::as_array);
    match schema.get("type").and_then(Value::as_str)? {
        "string" => match one_of {
            Some(options) => {
                let choice = |option: &Value| {
                    let value = option.as_str()?.to_owned();
                    Some(Choice {
                        label: value.clone(),
                        value,
                    })
                };
                let options: Option<Vec<Choice>> = options.iter().map(choice).collect();
                Some((FieldKind::Select, options?))
            }
            None => {
                let kind = match schema.get("format").and_then(Value::as_str) {
                    Some("date") => FieldKind::Date,
                    Some("time") => FieldKind::Time,
                    Some("date-time") => FieldKind::Datetime,
                    Some("email") => FieldKind::Email,
                    Some("uri" | "url") => FieldKind::Url,
                    Some("password") => FieldKind::Password,
                    _ => FieldKind::Text,
                };
                Some((kind, Vec::new()))
            }
        },
        "integer" | "number" if one_of.is_none() => Some((FieldKind::Number, Vec::new())),
        "boolean" => Some((FieldKind::Checkbox, Vec::new())),
        _ => None,
    }
}

/// A field's label: the param's `title`, or its name in words.
fn label(schema: &Value, name: &str) -> String {
    (schema.get("title").and_then(Value::as_str)).map_or_else(|| words(name), str::to_owned)
}

/// A name in words: `first_name` as "First name".
fn words(name: &str) -> String {
    let spaced = name.replace('_', " ");
    let mut letters = spaced.chars();
    match letters.next() {
        Some(first) => first.to_uppercase().chain(letters).collect(),
        None => spaced,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Right;
    use serde_json::json;

    fn method(name: &str, kind: Kind, ui: bool, params: Value) -> Declared {
        Declared {
            name: name.to_owned(),
            kind,
            right: Right::Write,
            about: "It does.".to_owned(),
            params,
            tool: true,
            ui,
        }
    }

    fn clients() -> Folder {
        let add = json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "city": { "type": "string", "title": "Town" },
                "vip": { "type": "boolean" },
                "tier": { "type": "string", "enum": ["a", "b"] },
                "tags": { "type": "array" },
                "first_seen": { "type": "integer" }
            },
            "required": ["name"]
        });
        let none = json!({ "type": "object", "properties": {} });
        let update = json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "name": { "type": "string" },
                "born": { "type": "string", "format": "date", "description": "Their birthday." },
                "score": { "type": "integer", "minimum": 0, "maximum": 10, "multipleOf": 1 },
                "rate": { "type": "number" }
            },
            "required": ["id"]
        });
        let tagged = json!({
            "type": "object",
            "properties": { "tags": { "type": "array" } },
            "required": ["tags"]
        });
        Folder {
            id: "clients".to_owned(),
            name: "Clients".to_owned(),
            about: "Clients.".to_owned(),
            version: "0.1.0".to_owned(),
            api: 1,
            entry: "worker.mjs".to_owned(),
            methods: vec![
                method("add", Kind::Command, true, add),
                method("update", Kind::Command, true, update),
                method("purge", Kind::Command, false, none.clone()),
                method("tag", Kind::Command, true, tagged),
                method("find", Kind::Call, false, none.clone()),
                method(
                    "card",
                    Kind::View,
                    false,
                    json!({ "type": "object", "required": ["id"],
                        "properties": { "id": { "type": "integer" } } }),
                ),
                method("home", Kind::View, false, none),
            ],
            migrations: Vec::new(),
        }
    }

    fn tree(children: Value) -> Result<Tree, String> {
        resolved(
            json!({ "title": "Clients", "children": children }),
            &clients(),
            7,
        )
    }

    #[test]
    fn a_form_takes_its_fields_from_its_commands_params_as_they_are_written() {
        let read = tree(json!([{ "node": "Form", "command": "add" }])).unwrap();
        let Node::Form(form) = &read.children[0] else {
            panic!("a Form");
        };
        assert_eq!(form.submit, "Add");
        let fields: Vec<_> = (form.fields.iter())
            .map(|field| (&*field.name, &*field.label, field.kind, field.required))
            .collect();
        // A list has no field, and is left out while the command does
        // not require it.
        assert_eq!(
            fields,
            [
                ("name", "Name", FieldKind::Text, true),
                ("city", "Town", FieldKind::Text, false),
                ("vip", "Vip", FieldKind::Checkbox, false),
                ("tier", "Tier", FieldKind::Select, false),
                ("first_seen", "First seen", FieldKind::Number, false),
            ]
        );
        let offered: Vec<_> = (form.fields[3].options.iter())
            .map(|choice| (&*choice.value, &*choice.label))
            .collect();
        assert_eq!(offered, [("a", "a"), ("b", "b")]);
    }

    #[test]
    fn a_form_shows_the_fields_an_app_chose_as_it_wrote_them() {
        let chosen = json!([{ "node": "Form", "command": "add", "submit": "Save", "fields": [
            { "name": "city", "kind": "textarea", "placeholder": "Where" },
            { "name": "name", "label": "Who" }
        ] }]);
        let read = tree(chosen).unwrap();
        let Node::Form(form) = &read.children[0] else {
            panic!("a Form");
        };
        assert_eq!(form.submit, "Save");
        assert_eq!(form.fields.len(), 2);
        assert_eq!(form.fields[0].kind, FieldKind::Textarea);
        assert_eq!(form.fields[0].placeholder.as_deref(), Some("Where"));
        assert_eq!(
            (&*form.fields[1].label, form.fields[1].required),
            ("Who", true)
        );
    }

    #[test]
    fn a_field_is_shown_by_its_params_format_and_as_another_of_its_family() {
        let written = json!([{ "node": "Form", "command": "update",
            "values": { "name": "Anna", "score": 7 },
            "fields": [{ "name": "name", "kind": "password" },
                       { "name": "born", "about": "Their birthday." },
                       { "name": "score", "kind": "slider" }] }]);
        let read = tree(written).unwrap();
        let Node::Form(form) = &read.children[0] else {
            panic!("a Form");
        };
        let kinds: Vec<_> = form.fields.iter().map(|field| field.kind).collect();
        assert_eq!(
            kinds,
            [FieldKind::Password, FieldKind::Date, FieldKind::Slider]
        );
        assert_eq!(form.fields[0].value, Some(json!("Anna")));
        assert_eq!(form.fields[1].about.as_deref(), Some("Their birthday."));
        let score = &form.fields[2];
        assert_eq!(
            (score.min, score.max, score.step, &score.value),
            (Some(0.0), Some(10.0), Some(1.0), &Some(json!(7)))
        );

        let refused = |children: Value| tree(children).unwrap_err();
        let said = refused(json!([{ "node": "Form", "command": "update",
            "fields": [{ "name": "rate", "kind": "slider" }] }]));
        assert!(said.contains("a slider goes from"), "{said}");
        // What it sends as written is no field of a form of every param.
        let read =
            tree(json!([{ "node": "Form", "command": "update", "params": { "id": 4 } }])).unwrap();
        let Node::Form(form) = &read.children[0] else {
            panic!("a Form");
        };
        assert_eq!(form.params["id"], 4);
        assert!(form.fields.iter().all(|field| field.name != "id"));
        let said = refused(json!([{ "node": "Form", "command": "update",
            "params": { "id": 4, "name": "Anna" }, "fields": [{ "name": "name" }] }]));
        assert!(
            said.contains("params.name: it is one of the form's fields too"),
            "{said}"
        );
        let said =
            refused(json!([{ "node": "Form", "command": "update", "params": { "who": 4 } }]));
        assert!(
            said.contains("(Form).params.who: the command update takes no param"),
            "{said}"
        );
        let said = refused(json!([{ "node": "Form", "command": "update",
            "fields": [{ "name": "name" }], "values": { "born": "2000-01-01" } }]));
        assert!(
            said.starts_with("children[0] (Form).values.born: the form has no field"),
            "{said}"
        );
    }

    #[test]
    fn a_rows_action_is_one_of_the_apps_commands_and_its_form_fills_the_rest() {
        let written = json!([{ "node": "Table", "search": true,
            "columns": [{ "key": "name", "title": "Name" },
                        { "key": "stage", "title": "Stage", "as": "badge", "tones": { "won": "good" } }],
            "rows": [{ "id": 1, "name": "Anna", "stage": "won" }],
            "actions": [
                { "label": "Edit", "command": "update", "take": { "id": "id", "name": "name" },
                  "fields": [{ "name": "name" }, { "name": "born" }] },
                { "label": "Reset", "command": "update", "take": { "id": "id" },
                  "params": { "score": 0 }, "confirm": "Reset Anna's score?", "tone": "bad" },
                { "label": "More", "command": "update", "params": { "id": 1 }, "form": true, "submit": "Save" } ] }]);
        let read = tree(written).unwrap();
        let Node::Table(table) = &read.children[0] else {
            panic!("a Table");
        };
        assert!(table.search);
        assert_eq!(table.columns[1].tones["won"], Tone::Good);
        let fields = |action: &Action| -> Vec<String> {
            let form = action.form.as_ref().unwrap();
            form.fields.iter().map(|field| field.name.clone()).collect()
        };
        assert_eq!(fields(&table.actions[0]), ["name", "born"]);
        assert_eq!(table.actions[0].form.as_ref().unwrap().submit, "Edit");
        assert_eq!(table.actions[2].form.as_ref().unwrap().submit, "Save");
        let reset = &table.actions[1];
        assert_eq!(
            (reset.form.is_none(), reset.confirm.as_deref(), reset.tone),
            (true, Some("Reset Anna's score?"), Tone::Bad)
        );
        // A form of every param leaves out what the action writes itself.
        assert_eq!(fields(&table.actions[2]), ["name", "born", "score", "rate"]);

        let refused = |children: Value| tree(children).unwrap_err();
        let said = refused(
            json!([{ "node": "Table", "columns": [{ "key": "n", "title": "N" }],
            "rows": [], "actions": [{ "label": "Go", "command": "update", "take": { "who": "id" } }] }]),
        );
        assert!(
            said.starts_with(
                "children[0] (Table).actions[0].take.who: the command update takes no param"
            ),
            "{said}"
        );
        let said = refused(json!([{ "node": "List", "items": [{ "title": "Anna",
            "actions": [{ "label": "Go", "command": "update", "take": { "id": "id" } }] }] }]));
        assert!(said.contains("an item has no row to take from"), "{said}");
        let said = refused(json!([{ "node": "List", "items": [{ "title": "Anna",
            "actions": [{ "label": "Edit", "command": "update", "params": { "id": 1 },
                          "form": true, "confirm": "Sure?" }] }] }]));
        assert!(
            said.contains("a question or opens a form, not both"),
            "{said}"
        );
        let said = refused(json!([{ "node": "List", "items": [{ "title": "Anna",
            "actions": [{ "label": "Purge", "command": "purge" }] }] }]));
        assert!(said.contains("\"ui\": true"), "{said}");
    }

    #[test]
    fn a_row_an_item_and_a_link_open_another_of_the_apps_views() {
        let written = json!([
            { "node": "Table", "columns": [{ "key": "name", "title": "Name" }],
              "rows": [{ "id": 1, "name": "Anna" }],
              "open": { "view": "card", "take": { "id": "id" } } },
            { "node": "List", "items": [
                { "title": "Anna", "open": { "view": "card", "params": { "id": 1 } } }] },
            { "node": "Link", "label": "All clients", "view": "home" }
        ]);
        let read = tree(written).unwrap();
        let Node::Table(table) = &read.children[0] else {
            panic!("a Table");
        };
        assert_eq!(table.open.as_ref().unwrap().take["id"], "id");
        let Node::Link(link) = &read.children[2] else {
            panic!("a Link");
        };
        assert_eq!((&*link.label, &*link.open.view), ("All clients", "home"));
        assert_eq!(
            serde_json::to_value(link).unwrap(),
            json!({ "label": "All clients", "view": "home", "params": {}, "take": {} })
        );

        let refused = |children: Value| tree(children).unwrap_err();
        let said = refused(json!([{ "node": "Link", "label": "Add", "view": "add" }]));
        assert!(said.contains("add is not a view"), "{said}");
        let said = refused(json!([{ "node": "Link", "label": "Gone", "view": "gone" }]));
        assert!(said.contains("clients has no view gone"), "{said}");
        let said = refused(
            json!([{ "node": "Link", "label": "Anna", "view": "card", "params": { "who": 1 } }]),
        );
        assert!(said.contains("the view card takes no param who"), "{said}");
        let said = refused(
            json!([{ "node": "Link", "label": "Anna", "view": "card", "take": { "id": "id" } }]),
        );
        assert!(said.contains("only a Table's row has keys"), "{said}");
        let said = refused(json!([{ "node": "Link", "label": "Anna", "view": "card" }]));
        assert!(
            said.contains("the view card requires the param id"),
            "{said}"
        );
        let said = refused(
            json!([{ "node": "Table", "columns": [{ "key": "name", "title": "Name" }],
            "rows": [{ "id": 1, "name": "Anna" }],
            "open": { "view": "card", "take": { "id": "ID" } } }]),
        );
        assert!(
            said.contains("(Table).open.take: no row has the key ID"),
            "{said}"
        );
    }

    #[test]
    fn nodes_hold_nodes_and_each_is_read_where_it_is() {
        let written = json!([
            { "node": "Grid", "columns": 3, "children": [
                { "node": "Stat", "label": "Clients", "value": 12, "about": "+2 this week", "tone": "good" },
                { "node": "Progress", "value": 3, "max": 5, "label": "Onboarding" } ] },
            { "node": "Tabs", "tabs": [
                { "title": "All", "children": [{ "node": "Separator" }] },
                { "title": "Chart", "children": [
                    { "node": "Chart", "kind": "bar", "x": "month",
                      "series": [{ "key": "won", "title": "Won" }],
                      "rows": [{ "month": "Jan", "won": 3 }] } ] } ] },
            { "node": "Accordion", "items": [{ "title": "More", "children": [
                { "node": "Alert", "title": "Two invoices are late", "tone": "warn" } ] }] },
            { "node": "Dialog", "label": "Add", "title": "Add a client", "children": [
                { "node": "Form", "command": "add" } ] }
        ]);
        let read = tree(written).unwrap();
        let names: Vec<String> = (read.children.iter())
            .map(|node| {
                serde_json::to_value(node).unwrap()["node"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(names, ["Grid", "Tabs", "Accordion", "Dialog"]);
        let Node::Tabs(tabs) = &read.children[1] else {
            panic!("Tabs");
        };
        assert!(matches!(tabs.tabs[1].children[0], Node::Chart(_)));

        let refused = |children: Value| tree(children).unwrap_err();
        let said = refused(json!([{ "node": "Tabs", "tabs": [] }]));
        assert!(
            said.starts_with("children[0] (Tabs).tabs: it is a list of"),
            "{said}"
        );
        let said = refused(json!([{ "node": "Tabs", "tabs": [
            { "title": "All", "children": [{ "node": "Tabel" }] }] }]));
        assert!(
            said.starts_with(
                "children[0] (Tabs).tabs[0].children[0] (Tabel): there is no such node"
            ),
            "{said}"
        );
        let said = refused(json!([{ "node": "Grid", "columns": 9, "children": [] }]));
        assert!(said.contains("it has 1 to 6 columns"), "{said}");
        let said = refused(json!([{ "node": "Stat", "label": "Clients", "value": [1] }]));
        assert!(said.contains("it is text or a number"), "{said}");
        let said = refused(
            json!([{ "node": "Chart", "kind": "bar", "x": "m", "series": [], "rows": [] }]),
        );
        assert!(said.contains("it draws 1 to 6 series"), "{said}");
        let said = refused(json!([{ "node": "Separator", "thick": true }]));
        assert!(
            said.starts_with("children[0] (Separator): unknown field `thick`"),
            "{said}"
        );
    }

    #[test]
    fn what_a_tree_gets_wrong_is_refused_by_where_it_is() {
        let refused = |children: Value| tree(children).unwrap_err();
        let said = refused(json!([{ "node": "Card", "children": [{ "node": "Tabel" }] }]));
        assert!(
            said.starts_with("children[0] (Card).children[0] (Tabel): there is no such node"),
            "{said}"
        );
        let said = refused(json!([{ "node": "Badge", "text": "3", "colour": "red" }]));
        assert!(
            said.starts_with("children[0] (Badge): unknown field `colour`"),
            "{said}"
        );
        let said = refused(
            json!([{ "node": "Table", "columns": [{ "key": "tags", "title": "Tags" }],
            "rows": [{ "tags": "a" }, { "tags": ["a"] }] }]),
        );
        assert!(
            said.starts_with("children[0] (Table).rows[1].tags: a cell is"),
            "{said}"
        );
        // A control sends only the App's own command, marked for a
        // screen.
        let said = refused(json!([{ "node": "Button", "label": "Purge", "command": "purge" }]));
        assert!(said.contains("\"ui\": true"), "{said}");
        let said = refused(json!([{ "node": "Button", "label": "Find", "command": "find" }]));
        assert!(said.contains("find is not a command"), "{said}");
        let said = refused(json!([{ "node": "Form", "command": "send" }]));
        assert!(said.contains("clients has no command send"), "{said}");
        let said = refused(json!([{ "node": "Form", "command": "tag" }]));
        assert!(
            said.starts_with("children[0] (Form).fields (tags): a form has no field for"),
            "{said}"
        );
        let said = refused(
            json!([{ "node": "Form", "command": "add", "fields": [{ "name": "vip", "kind": "text" }] }]),
        );
        assert!(said.contains("its kind follows the param's type"), "{said}");
        // And no Tree at all.
        assert!(
            resolved(json!([]), &clients(), 7)
                .unwrap_err()
                .contains("a view answers a Tree")
        );
        let said = resolved(json!({ "children": [] }), &clients(), 7).unwrap_err();
        assert!(
            said.starts_with("the Tree: missing field `title`"),
            "{said}"
        );
    }

    #[test]
    fn a_tree_is_held_to_its_limits() {
        let rows: Vec<Value> = (0..=ROWS).map(|n| json!({ "n": n })).collect();
        let long =
            json!([{ "node": "Table", "columns": [{ "key": "n", "title": "N" }], "rows": rows }]);
        assert!(tree(long).unwrap_err().contains("shows at most 1000"));
        let many: Vec<Value> = (0..=NODES)
            .map(|_| json!({ "node": "Badge", "text": "1" }))
            .collect();
        assert!(tree(json!(many)).unwrap_err().contains("at most 500 nodes"));
    }
}
