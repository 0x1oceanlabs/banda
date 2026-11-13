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
use ts_rs::TS;

/// The most nodes a Tree holds.
const NODES: usize = 500;
/// The most rows a Table shows, and items a List.
const ROWS: usize = 1000;
/// The most columns a Table has.
const COLUMNS: usize = 12;

/// The names of the nodes, as a refusal lists them.
const NAMES: &str = "Card, Table, List, Form, Button, Badge, Empty and Markdown";

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
    Table(Table),
    List(List),
    Form(Form),
    Button(Button),
    Badge(Badge),
    Empty(Empty),
    Markdown(Markdown),
}

/// A box around other nodes, with a title when it has one.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeCard")]
pub struct Card {
    pub title: Option<String>,
    pub children: Vec<Node>,
}

/// Rows by column.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeTable")]
pub struct Table {
    pub columns: Vec<Column>,
    /// Each a row by its columns' keys: text, a number, true, false or
    /// null.
    #[ts(type = "Array<Record<string, string | number | boolean | null>>")]
    pub rows: Vec<Map<String, Value>>,
    /// What it says with no row.
    pub empty: Option<String>,
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
}

/// How a Table shows a cell.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "apps/", rename = "TreeShown")]
pub enum Shown {
    #[default]
    Text,
    Badge,
}

/// Items of two lines, for what reads badly in columns.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeList")]
pub struct List {
    pub items: Vec<Item>,
    /// What it says with no item.
    pub empty: Option<String>,
}

/// One item of a List.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeItem")]
pub struct Item {
    pub title: String,
    /// Its second line.
    pub about: Option<String>,
    pub badge: Option<String>,
}

/// A form that sends one of the App's commands, a field a param.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "apps/", rename = "TreeForm")]
pub struct Form {
    pub title: Option<String>,
    /// The App's command it sends, without the App's prefix.
    pub command: String,
    /// The words on its button.
    pub submit: String,
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
    /// What a `select` offers.
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
    Number,
    Select,
    Checkbox,
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
}

/// A word or a count, set apart.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "apps/", rename = "TreeBadge")]
pub struct Badge {
    pub text: String,
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
}

/// One field as an App writes it: the rest comes from the param.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrittenField {
    name: String,
    label: Option<String>,
    kind: Option<FieldKind>,
    placeholder: Option<String>,
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
            let children = children(
                props.remove("children"),
                &format!("{at}.children"),
                app,
                nodes,
            )?;
            let Boxed { title } = read(props, at)?;
            Node::Card(Card { title, children })
        }
        "Table" => Node::Table(table(read(props, at)?, at)?),
        "List" => {
            let list: List = read(props, at)?;
            most(list.items.len(), "items", at)?;
            Node::List(list)
        }
        "Form" => Node::Form(form(read(props, at)?, app, at)?),
        "Button" => {
            let button: Button = read(props, at)?;
            command(app, &button.command, at)?;
            Node::Button(button)
        }
        "Badge" => Node::Badge(read(props, at)?),
        "Empty" => Node::Empty(read(props, at)?),
        "Markdown" => Node::Markdown(read(props, at)?),
        _ => {
            return Err(format!(
                "{at}: there is no such node: the nodes are {NAMES}."
            ));
        }
    })
}

fn most(count: usize, what: &str, at: &str) -> Result<(), String> {
    if count > ROWS {
        return Err(format!(
            "{at}: it has {count} {what}, and shows at most {ROWS}: answer fewer, and the rest by the view's params."
        ));
    }
    Ok(())
}

fn table(table: Table, at: &str) -> Result<Table, String> {
    if table.columns.is_empty() || table.columns.len() > COLUMNS {
        return Err(format!("{at}: it has 1 to {COLUMNS} columns."));
    }
    most(table.rows.len(), "rows", at)?;
    for (place, row) in table.rows.iter().enumerate() {
        if let Some((key, _)) = (row.iter()).find(|(_, cell)| cell.is_array() || cell.is_object()) {
            return Err(format!(
                "{at}.rows[{place}].{key}: a cell is text, a number, true, false or null."
            ));
        }
    }
    Ok(table)
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

fn form(written: WrittenForm, app: &Folder, at: &str) -> Result<Form, String> {
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
        };
        params.keys().map(field).collect()
    });
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
        let kind = match (field.kind, kind) {
            (None, kind) => kind,
            (Some(FieldKind::Textarea), FieldKind::Text) => FieldKind::Textarea,
            (Some(asked), kind) if asked == kind => kind,
            (Some(_), _) => {
                return Err(format!(
                    "{at}: its kind follows the param's type; only text may be made a \"textarea\"."
                ));
            }
        };
        fields.push(Field {
            label: field.label.unwrap_or_else(|| label(schema, &field.name)),
            placeholder: field.placeholder,
            name: field.name,
            kind,
            required,
            options,
        });
    }
    Ok(Form {
        title: written.title,
        submit: written.submit.unwrap_or_else(|| words(&declared.name)),
        command: written.command,
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
            None => Some((FieldKind::Text, Vec::new())),
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
                method("purge", Kind::Command, false, none.clone()),
                method("tag", Kind::Command, true, tagged),
                method("find", Kind::Call, false, none),
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
