//! An App's folder, as a Person's Agent writes it (ADR 0126, decisions 1
//! and 2): plain files that a Person and an Agent both read.
//!
//! ```text
//! clients/
//!   app.toml          its id, name, about, version, api, and entry
//!   methods.json      its methods, as data
//!   migrations/       001.sql, 002.sql, …: its tables, one step a file
//!   worker.mjs        its code, the entry
//! ```
//!
//! [`Folder::read`] reads one and checks it, and what it refuses it says
//! in words an Agent can act on: the file, and what is wrong in it.

use banda_kernel::{Does, Kind, Method, Refusal, Right, Tool};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

/// The file an App declares itself in, as Banda's own do (ADR 0022).
pub const MANIFEST: &str = "app.toml";
/// The file that holds its methods, as data.
pub const METHODS: &str = "methods.json";
/// The folder of its migration steps.
pub const MIGRATIONS: &str = "migrations";

/// The major of the App API this engine runs an App from a folder by.
pub const API: u32 = 1;

/// The longest an App's id may be: it prefixes its tables and its tools.
const ID_MOST: usize = 32;
/// The longest a method's name may be: it is part of its tool's.
const NAME_MOST: usize = 64;
/// The longest a file of its manifest may be, a step too.
const FILE_MOST: u64 = 1024 * 1024;

/// An App's `app.toml`, as it is written.
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct Manifest {
    id: String,
    name: String,
    about: String,
    version: String,
    api: u32,
    entry: String,
    /// `app`, as every App's that is not the platform's; left out, it is.
    kind: Option<String>,
    /// Banda's own Apps are built into it, and none comes from a folder.
    #[serde(default)]
    from_banda: bool,
    /// What it needs of Banda (ADR 0082, decision 2). None is built yet,
    /// so a need in it is refused.
    #[serde(default)]
    needs: BTreeMap<String, toml::Value>,
}

/// One method of `methods.json`, as it is written.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Written {
    kind: Kind,
    right: Option<Right>,
    about: String,
    params: Option<Value>,
    tool: Option<bool>,
    #[serde(default)]
    ui: bool,
}

/// One method an App gives, checked.
#[derive(Clone, Debug, PartialEq)]
pub struct Declared {
    /// Without the App's prefix: `add`.
    pub name: String,
    pub kind: Kind,
    pub right: Right,
    /// What it does, in words: an Agent reads it as its tool's
    /// description.
    pub about: String,
    /// The JSON Schema of its params, an object's.
    pub params: Value,
    /// Whether an Agent calls it as a tool, `<app>_<method>`.
    pub tool: bool,
    /// Whether a control of the App's screen may send it: a command's
    /// `ui` (ADR 0062, decision 7).
    pub ui: bool,
}

/// An App read from its folder, and checked.
#[derive(Clone, Debug, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub about: String,
    pub version: String,
    pub api: u32,
    /// Its code, a file's path inside the folder.
    pub entry: String,
    /// Its methods, by name.
    pub methods: Vec<Declared>,
    /// Its migration steps, in order: `migrations/001.sql` first.
    pub migrations: Vec<String>,
}

fn invalid(file: &str, why: impl std::fmt::Display) -> Refusal {
    Refusal::invalid(format!("{file}: {why}"))
}

/// A file of the folder as text; refused when it is missing, too long or
/// not UTF-8.
fn text(folder: &Path, file: &str) -> Result<String, Refusal> {
    let path = folder.join(file);
    let long = std::fs::metadata(&path).is_ok_and(|meta| meta.len() > FILE_MOST);
    if long {
        return Err(invalid(file, "it is longer than 1 MB."));
    }
    std::fs::read_to_string(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => {
            invalid(file, "an App's folder has one, and it is missing.")
        }
        _ => invalid(file, format!("it could not be read: {error}.")),
    })
}

/// Whether `name` is lowercase letters, then letters, digits and `_`: a
/// method's name, which is part of its tool's.
fn method_name(name: &str) -> bool {
    let mut letters = name.bytes();
    letters.next().is_some_and(|b| b.is_ascii_lowercase())
        && letters.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        && name.len() <= NAME_MOST
}

/// `text` kept for as long as the engine runs: the kernel takes a module's
/// name, its steps and its methods' names so. A text kept before is the
/// same one again, so an App installed again keeps only what changed.
pub(crate) fn kept(text: String) -> &'static str {
    static KEPT: Mutex<BTreeSet<&'static str>> = Mutex::new(BTreeSet::new());
    let mut kept = KEPT.lock().unwrap();
    match kept.get(text.as_str()) {
        Some(had) => had,
        None => {
            let leaked: &'static str = Box::leak(text.into_boxed_str());
            kept.insert(leaked);
            leaked
        }
    }
}

/// `steps` kept so too: an App installed again with the steps it had
/// keeps the same list.
pub(crate) fn kept_steps(steps: Vec<&'static str>) -> &'static [&'static str] {
    static KEPT: Mutex<Vec<&'static [&'static str]>> = Mutex::new(Vec::new());
    let mut kept = KEPT.lock().unwrap();
    match kept.iter().find(|had| ***had == steps[..]) {
        Some(had) => had,
        None => {
            let leaked: &'static [&'static str] = Box::leak(steps.into_boxed_slice());
            kept.push(leaked);
            leaked
        }
    }
}

/// Whether `id` may be an App's from a folder: a module's name
/// ([`banda_kernel::module_name`]), no longer than its tables' and its
/// tools' names bear.
pub fn is_id(id: &str) -> bool {
    banda_kernel::module_name(id) && id.len() <= ID_MOST
}

impl Folder {
    /// Reads the App in `folder` and checks all it says. It runs nothing.
    pub fn read(folder: &Path) -> Result<Folder, Refusal> {
        if !folder.is_dir() {
            return Err(Refusal::not_found(format!(
                "{} is not a folder.",
                folder.display()
            )));
        }
        let manifest: Manifest = toml::from_str(&text(folder, MANIFEST)?)
            .map_err(|error| invalid(MANIFEST, error.message()))?;
        let Manifest {
            id,
            name,
            about,
            version,
            api,
            entry,
            kind,
            from_banda,
            needs,
        } = manifest;
        let said = |what: &str, value: &str| {
            if value.trim().is_empty() {
                return Err(invalid(MANIFEST, format!("{what} is empty.")));
            }
            Ok(())
        };
        if !is_id(&id) {
            return Err(invalid(
                MANIFEST,
                format!(
                    "id is {id:?}, and an App's id is 1 to {ID_MOST} lowercase letters that Banda does not keep for itself, as \"clients\": it prefixes the App's methods and tables."
                ),
            ));
        }
        said("name", &name)?;
        said("about", &about)?;
        said("version", &version)?;
        if api != API {
            return Err(invalid(
                MANIFEST,
                format!("api is {api}, and this Banda runs an App written to api {API}."),
            ));
        }
        if kind.as_deref().is_some_and(|kind| kind != "app") {
            return Err(invalid(MANIFEST, "kind is \"app\", or is left out."));
        }
        if from_banda {
            return Err(invalid(
                MANIFEST,
                "from-banda is for the Apps built into Banda.",
            ));
        }
        if let Some(need) = needs.keys().next() {
            return Err(invalid(
                MANIFEST,
                format!("[needs] names {need}, and no need is built yet: leave [needs] empty."),
            ));
        }
        let inside = Path::new(&entry)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)));
        if entry.is_empty() || !inside || !folder.join(&entry).is_file() {
            return Err(invalid(
                MANIFEST,
                format!("entry is {entry:?}, and that is no file in the App's folder."),
            ));
        }
        Ok(Folder {
            methods: methods(folder, &id)?,
            migrations: migrations(folder)?,
            id,
            name,
            about,
            version,
            api,
            entry,
        })
    }

    /// Reads the App in `folder` as [`Folder::read`] does, and tries its
    /// steps ([`Folder::tried`]). It runs none of its code.
    pub fn check(folder: &Path) -> Result<Folder, Refusal> {
        let app = Folder::read(folder)?;
        app.tried()?;
        Ok(app)
    }

    /// Tries its steps as a Project's store would run them, on a database
    /// of its own that is not kept: a step that would turn the App off
    /// there is refused here, with why. Its tables there are empty, so a
    /// step that fails only over what a Project holds passes.
    pub(crate) fn tried(&self) -> Result<(), Refusal> {
        let steps: Vec<&str> = self.migrations.iter().map(String::as_str).collect();
        banda_kernel::try_steps(kept(self.id.clone()), &steps)
            .map_err(|why| invalid(MIGRATIONS, why))
    }

    /// The method it declares by this name.
    pub fn declared(&self, name: &str) -> Option<&Declared> {
        self.methods.iter().find(|declared| declared.name == name)
    }

    /// The name an Agent calls `method` by, as a tool.
    pub fn tool_name(&self, method: &str) -> String {
        format!("{}_{method}", self.id)
    }

    /// Its methods as `apps.describe` lists them.
    pub fn described(&self) -> Vec<Method> {
        self.methods
            .iter()
            .map(|method| Method {
                name: kept(method.name.clone()),
                kind: method.kind,
                right: method.right,
                does: match (method.kind, method.right) {
                    // A view writes nothing, whatever right it asks.
                    (Kind::View, _) | (Kind::Call, Right::Read) => Does::Read,
                    _ => Does::Act,
                },
                tool: method.tool.then(|| kept(self.tool_name(&method.name))),
                pass: false,
                about: method.about.clone(),
            })
            .collect()
    }

    /// Its methods an Agent calls as tools (ADR 0126, decision 2).
    pub fn tools(&self) -> Vec<Tool> {
        (self.methods.iter())
            .filter(|method| method.tool)
            .map(|method| Tool {
                name: self.tool_name(&method.name),
                method: format!("{}.{}", self.id, method.name),
                // A tool's kind says only whether to send it again: a
                // view goes as a call does.
                kind: match method.kind {
                    Kind::View => Kind::Call,
                    kind => kind,
                },
                description: method.about.clone(),
                schema: method.params.clone(),
            })
            .collect()
    }
}

/// The methods `methods.json` declares, by name.
fn methods(folder: &Path, id: &str) -> Result<Vec<Declared>, Refusal> {
    let written: BTreeMap<String, Value> =
        serde_json::from_str(&text(folder, METHODS)?).map_err(|error| {
            invalid(
                METHODS,
                format!("it is an object of methods by name: {error}."),
            )
        })?;
    let mut methods = Vec::with_capacity(written.len());
    for (name, method) in written {
        let wrong = |why: String| invalid(METHODS, format!("{name}: {why}"));
        if !method_name(&name) {
            return Err(wrong(
                "a method's name starts with a lowercase letter, then letters, digits and _."
                    .into(),
            ));
        }
        let Written {
            kind,
            right,
            about,
            params,
            tool,
            ui,
        } = serde_json::from_value(method).map_err(|error| wrong(format!("{error}.")))?;
        if kind == Kind::Stream {
            return Err(wrong("kind is \"call\", \"command\" or \"view\".".into()));
        }
        if ui && kind != Kind::Command {
            return Err(wrong(
                "\"ui\" marks a command a control of the App's screen may send: this is no command."
                    .into(),
            ));
        }
        if about.trim().is_empty() {
            return Err(wrong(
                "about is empty: say in words what the method does, for an Agent reads it.".into(),
            ));
        }
        let right = right.unwrap_or(match kind {
            Kind::Command => Right::Write,
            _ => Right::Read,
        });
        if (kind, right) == (Kind::Command, Right::Read) {
            return Err(wrong(
                "a command changes what the App keeps: its right is \"write\".".into(),
            ));
        }
        // To decide for a Person and to run programs as them are no
        // App's from a folder.
        if matches!(right, Right::Decide | Right::Run) {
            return Err(wrong("right is \"read\", \"write\" or \"manage\".".into()));
        }
        let params = params.unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
        if params.get("type") != Some(&json!("object")) {
            return Err(wrong(format!(
                "params is a JSON Schema of an object, with \"type\": \"object\": {id}.{name} takes its params by name."
            )));
        }
        methods.push(Declared {
            name,
            kind,
            right,
            about: about.trim().to_owned(),
            params,
            // A view's answer is a screen for a client to draw: no
            // Agent's tool unless the App says so.
            tool: tool.unwrap_or(kind != Kind::View),
            ui,
        });
    }
    Ok(methods)
}

/// The steps in `migrations/`, `001.sql` first, with none left out. An App
/// that keeps nothing has no such folder.
fn migrations(folder: &Path) -> Result<Vec<String>, Refusal> {
    let dir = folder.join(MIGRATIONS);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let wrong = |why: String| invalid(MIGRATIONS, why);
    let entries = std::fs::read_dir(&dir).map_err(|error| wrong(format!("{error}.")))?;
    let mut names: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort();
    let mut steps = Vec::with_capacity(names.len());
    for (step, name) in (1..).zip(names) {
        let expected = format!("{step:03}.sql");
        if name != expected {
            return Err(wrong(format!(
                "it holds {name} where {expected} is next: the steps are 001.sql, 002.sql, … with none left out."
            )));
        }
        let file = format!("{MIGRATIONS}/{name}");
        let script = text(folder, &file)?;
        if script.trim().is_empty() {
            return Err(invalid(&file, "it is empty."));
        }
        steps.push(script);
    }
    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Code;

    const MANIFEST_OK: &str = "id = \"clients\"\nname = \"Clients\"\nabout = \"The people I work with.\"\nversion = \"0.1.0\"\napi = 1\nentry = \"worker.mjs\"\n";

    /// A clients App's folder, with `files` over its own.
    fn app(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let own = [
            (MANIFEST, MANIFEST_OK),
            (
                METHODS,
                r#"{ "find": { "kind": "call", "about": "The clients in a city." } }"#,
            ),
            (
                "migrations/001.sql",
                "CREATE TABLE clients_people (name TEXT)",
            ),
            ("worker.mjs", "export const methods = {}"),
        ];
        for (file, text) in own.iter().chain(files) {
            let path = dir.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        dir
    }

    #[test]
    fn a_folder_reads_as_its_app_with_its_methods_and_steps() {
        let methods = r#"{
            "add": { "kind": "command", "about": " Adds a client. ", "ui": true,
                     "params": { "type": "object", "required": ["name"] } },
            "purge": { "kind": "command", "right": "manage", "about": "Forgets all.", "tool": false },
            "find": { "kind": "call", "about": "The clients in a city." },
            "home": { "kind": "view", "about": "The clients, and a form to add one." }
        }"#;
        let dir = app(&[
            (METHODS, methods),
            (
                "migrations/002.sql",
                "ALTER TABLE clients_people ADD COLUMN city TEXT",
            ),
        ]);
        let read = Folder::read(dir.path()).unwrap();
        assert_eq!(
            (&*read.id, &*read.version, read.api),
            ("clients", "0.1.0", 1)
        );
        assert_eq!(read.migrations.len(), 2);
        let said: Vec<_> = (read.methods.iter())
            .map(|m| (&*m.name, m.kind, m.right, m.tool))
            .collect();
        assert_eq!(
            said,
            [
                ("add", Kind::Command, Right::Write, true),
                ("find", Kind::Call, Right::Read, true),
                // A view reads, and is a screen: no tool unless it says so.
                ("home", Kind::View, Right::Read, false),
                ("purge", Kind::Command, Right::Manage, false),
            ]
        );
        // Only the command marked so may be sent from the App's screen.
        let ui: Vec<_> = (read.methods.iter()).filter(|m| m.ui).collect();
        assert_eq!(ui.len(), 1);
        assert_eq!(ui[0].name, "add");
        // A method with no params takes an object with nothing in it.
        assert_eq!(
            read.methods[1].params,
            json!({ "type": "object", "properties": {} })
        );
        // Each is an Agent's tool by its App's name, but those left out.
        let tools: Vec<_> = read
            .tools()
            .into_iter()
            .map(|t| (t.name, t.method))
            .collect();
        assert_eq!(
            tools,
            [
                ("clients_add".to_owned(), "clients.add".to_owned()),
                ("clients_find".to_owned(), "clients.find".to_owned()),
            ]
        );
        let described = read.described();
        assert_eq!(described[0].about, "Adds a client.");
        assert_eq!(
            (described[0].does, described[1].does),
            (Does::Act, Does::Read)
        );
        assert_eq!(
            (described[1].tool, described[2].tool),
            (Some("clients_find"), None)
        );
    }

    #[test]
    fn what_is_wrong_in_a_folder_is_said_by_its_file() {
        let manifest = |change: &str| {
            let (from, to) = change.split_once(" -> ").unwrap();
            MANIFEST_OK.replace(from, to)
        };
        let cases: [(&str, String, &str); 17] = [
            (
                MANIFEST,
                manifest("\"clients\" -> \"Clients2\""),
                "app.toml: id is \"Clients2\"",
            ),
            (
                MANIFEST,
                manifest("\"clients\" -> \"json\""),
                "app.toml: id is \"json\"",
            ),
            (
                MANIFEST,
                manifest("api = 1 -> api = 2"),
                "app.toml: api is 2",
            ),
            (
                MANIFEST,
                manifest("\"worker.mjs\" -> \"../worker.mjs\""),
                "app.toml: entry is \"../worker.mjs\"",
            ),
            (
                MANIFEST,
                manifest("\"worker.mjs\" -> \"gone.mjs\""),
                "app.toml: entry is \"gone.mjs\"",
            ),
            (
                MANIFEST,
                manifest("about = \"The people I work with.\" -> about = \" \""),
                "app.toml: about is empty",
            ),
            (
                MANIFEST,
                format!("{MANIFEST_OK}from-banda = true\n"),
                "app.toml: from-banda",
            ),
            (
                MANIFEST,
                format!("{MANIFEST_OK}[needs]\nnet = [\"example.com\"]\n"),
                "app.toml: [needs] names net",
            ),
            (
                MANIFEST,
                format!("{MANIFEST_OK}colour = \"red\"\n"),
                "app.toml: unknown field `colour`",
            ),
            (
                METHODS,
                "[]".into(),
                "methods.json: it is an object of methods by name",
            ),
            (
                METHODS,
                r#"{ "Find": { "kind": "call", "about": "x" } }"#.into(),
                "methods.json: Find: a method's name",
            ),
            (
                METHODS,
                r#"{ "find": { "kind": "stream", "about": "x" } }"#.into(),
                "methods.json: find: kind is",
            ),
            (
                METHODS,
                r#"{ "find": { "kind": "call", "about": "" } }"#.into(),
                "methods.json: find: about is empty",
            ),
            (
                METHODS,
                r#"{ "add": { "kind": "command", "right": "read", "about": "x" } }"#.into(),
                "methods.json: add: a command changes",
            ),
            (
                METHODS,
                r#"{ "add": { "kind": "command", "right": "run", "about": "x" } }"#.into(),
                "methods.json: add: right is",
            ),
            (
                METHODS,
                r#"{ "find": { "kind": "call", "about": "x", "params": { "type": "string" } } }"#
                    .into(),
                "methods.json: find: params is a JSON Schema of an object",
            ),
            (
                METHODS,
                r#"{ "find": { "kind": "call", "about": "x", "ui": true } }"#.into(),
                "methods.json: find: \"ui\" marks a command",
            ),
        ];
        for (file, text, words) in cases {
            let dir = app(&[(file, &text)]);
            let refused = Folder::read(dir.path()).unwrap_err();
            assert_eq!(refused.code, Code::Invalid, "{text}");
            assert!(refused.message.starts_with(words), "{}", refused.message);
        }
        // A step left out, or an empty one.
        let gap = app(&[("migrations/003.sql", "SELECT 1")]);
        let refused = Folder::read(gap.path()).unwrap_err();
        assert!(
            refused
                .message
                .starts_with("migrations: it holds 003.sql where 002.sql is next"),
            "{}",
            refused.message
        );
        let empty = app(&[("migrations/002.sql", " \n")]);
        let refused = Folder::read(empty.path()).unwrap_err();
        assert_eq!(refused.message, "migrations/002.sql: it is empty.");
        // A file that is not there.
        let bare = tempfile::tempdir().unwrap();
        let refused = Folder::read(bare.path()).unwrap_err();
        assert!(
            refused
                .message
                .starts_with("app.toml: an App's folder has one"),
            "{}",
            refused.message
        );
    }

    #[test]
    fn a_check_tries_the_steps_as_a_project_would_run_them() {
        assert_eq!(Folder::check(app(&[]).path()).unwrap().migrations.len(), 1);
        let cases = [
            ("CREATE TABEL clients_notes (id INTEGER)", "syntax error"),
            ("CREATE TABLE notes (id INTEGER)", "not authorized"),
            (
                "INSERT INTO clients_peple (name) VALUES ('x')",
                "no such table",
            ),
        ];
        for (step, why) in cases {
            let dir = app(&[("migrations/002.sql", step)]);
            let refused = Folder::check(dir.path()).unwrap_err();
            assert_eq!(refused.code, Code::Invalid, "{step}");
            let words = "migrations: Step 2 of its tables failed:";
            assert!(refused.message.starts_with(words), "{}", refused.message);
            assert!(refused.message.contains(why), "{}", refused.message);
            // Read alone, it is the folder it says it is.
            assert!(Folder::read(dir.path()).is_ok());
        }
    }

    #[test]
    fn an_app_that_keeps_nothing_has_no_steps() {
        let dir = app(&[]);
        std::fs::remove_dir_all(dir.path().join(MIGRATIONS)).unwrap();
        assert!(Folder::read(dir.path()).unwrap().migrations.is_empty());
    }
}
