//! Banda's settings files, each described once (ADR 0016, decision 4).
//!
//! Each file's keys are Rust structs with a doc comment on every key, and
//! they derive a JSON Schema as well as their parser. The schema is what
//! the settings window draws its rows from, what the skill shows, and what
//! an editor completes and checks the file with. A new key appears in all
//! of them, with no list kept by hand.

use banda_agents::settings::{HarnessFile, Harnesses, template as harness_template};
use banda_look::Problem;
use banda_look::agents::AgentsSettings;
use banda_look::browser::BrowserSettings;
use banda_look::settings::Settings as LookSettings;
use banda_look::sidebar::SidebarSettings;
use banda_look::theme::Places;
use schemars::generate::SchemaSettings;
use schemars::transform::RecursiveTransform;
use schemars::{JsonSchema, Schema};
use serde_json::Value;
use std::path::{Path, PathBuf};

mod write;
pub use write::{reset, set};

/// A file in `~/.config/banda/` that Banda reads. What it holds is its
/// root struct's doc comment, the schema's `description`.
pub struct File {
    /// Its name in the config folder.
    pub name: &'static str,
    schema: fn() -> Schema,
    /// What a new file starts as, before its first key is written.
    template: fn() -> String,
}

const HARNESSES: &str = "harnesses.toml";

/// Every settings file, one per module (ADR 0016, decision 3).
pub const FILES: [File; 5] = [
    File {
        name: "look.toml",
        schema: schema_of::<LookSettings>,
        template: || banda_look::TEMPLATE.to_owned(),
    },
    File {
        name: "sidebar.toml",
        schema: schema_of::<SidebarSettings>,
        template: || banda_look::sidebar::TEMPLATE.to_owned(),
    },
    File {
        name: "browser.toml",
        schema: schema_of::<BrowserSettings>,
        template: || banda_look::browser::TEMPLATE.to_owned(),
    },
    File {
        name: "agents.toml",
        schema: schema_of::<AgentsSettings>,
        template: || banda_look::agents::TEMPLATE.to_owned(),
    },
    File {
        name: HARNESSES,
        schema: schema_of::<HarnessFile>,
        template: harness_template,
    },
];

fn schema_of<T: JsonSchema>() -> Schema {
    SchemaSettings::draft2020_12()
        .with_transform(RecursiveTransform(no_null))
        .into_generator()
        .into_root_schema_for::<T>()
}

/// TOML has no null: a key left out is how a file says nothing. So an
/// `Option`'s null is taken out of its schema.
fn no_null(schema: &mut Schema) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    if let Some(Value::Array(types)) = object.get_mut("type") {
        types.retain(|t| t != "null");
        if types.len() == 1 {
            let only = types.remove(0);
            object.insert("type".into(), only);
        }
    }
    // A table's default, now its keys serialize: each key unset, which
    // says nothing.
    if let Some(Value::Object(default)) = object.get("default")
        && !default.is_empty()
        && default.values().all(says_nothing)
    {
        object.remove("default");
    }
    // An optional table: `anyOf: [its $ref, null]`.
    if let Some(Value::Array(options)) = object.get_mut("anyOf") {
        options.retain(|option| option.get("type") != Some(&Value::from("null")));
        if options.len() == 1 {
            let only = options.remove(0);
            object.remove("anyOf");
            if let Value::Object(only) = only {
                for (name, value) in only {
                    object.entry(name).or_insert(value);
                }
            }
        }
    }
}

/// Null, or a table of nothing but.
fn says_nothing(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Object(table) => table.values().all(says_nothing),
        _ => false,
    }
}

impl File {
    /// The file's JSON Schema, titled with its name.
    pub fn schema(&self) -> Schema {
        let mut schema = (self.schema)();
        schema.insert("title".into(), self.name.into());
        schema
    }

    /// What it holds: its root struct's doc comment.
    pub fn about(&self) -> String {
        let schema = (self.schema)();
        let about = schema.get("description").and_then(Value::as_str);
        about.unwrap_or_default().replace('\n', " ")
    }

    /// Where its schema is kept: `look.schema.json`.
    pub fn schema_name(&self) -> String {
        format!("{}.schema.json", self.name.trim_end_matches(".toml"))
    }
}

/// The file called `name`.
pub fn file(name: &str) -> Option<&'static File> {
    FILES.iter().find(|file| file.name == name)
}

/// Writes each file's schema into `folder`, as `<name>.schema.json`. A
/// schema already there and the same is left alone.
pub fn export(folder: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    for file in &FILES {
        let path = folder.join(file.schema_name());
        let text = serde_json::to_string_pretty(&file.schema())? + "\n";
        if std::fs::read_to_string(&path).is_ok_and(|was| was == text) {
            continue;
        }
        std::fs::write(path, text)?;
    }
    Ok(())
}

/// Checks `paths`, or with none every file Banda reads: the look's, the
/// sidebar's and the Harness list. Says nothing when all is well.
pub fn check(places: &Places, paths: &[PathBuf]) -> Vec<Problem> {
    if paths.is_empty() {
        // No font's name is ever wrong, so the system is not asked for one.
        let places = Places {
            fontconfig: None,
            ..places.clone()
        };
        let mut problems = banda_look::resolve(&places, &|| None).look.problems;
        let harnesses = places.config.join(HARNESSES);
        if harnesses.exists() {
            problems.extend(check_file(&harnesses));
        }
        return problems;
    }
    paths.iter().flat_map(|path| check_file(path)).collect()
}

fn check_file(path: &Path) -> Vec<Problem> {
    match std::fs::read_to_string(path) {
        Ok(text) => check_text(path, &text),
        Err(error) => vec![Problem::whole(path, error.to_string())],
    }
}

/// Checks `text` as the file at `path` is read: the Harness list as the
/// engine reads it, anything else as the look does.
fn check_text(path: &Path, text: &str) -> Vec<Problem> {
    if path.file_name().is_none_or(|name| name != HARNESSES) {
        return banda_look::check_text(path, text);
    }
    match Harnesses::parse(text) {
        Ok(_) => Vec::new(),
        Err(error) => vec![Problem::toml(path, text, &error)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As ts-rs writes the types, the tests write the schemas into the
    /// contract; `scripts/check.sh` fails when that changed them.
    #[test]
    fn the_schemas_are_in_the_contract() {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../contract/src/generated/schema");
        export(&folder).unwrap();
        for file in &FILES {
            assert!(folder.join(file.schema_name()).exists());
        }
    }

    #[test]
    fn a_schema_has_every_key_with_its_doc_comment() {
        let look = serde_json::to_value(file("look.toml").unwrap().schema()).unwrap();
        assert_eq!(look["title"], "look.toml");
        assert!(look["properties"]["theme"].is_object());
        assert!(
            look["additionalProperties"] == false,
            "a wrong key is named"
        );
        let defs = &look["$defs"];
        let tile = &defs["Tile"]["properties"];
        assert!(tile["border"].is_object(), "{tile}");
        let sound = &defs["SoundSettings"]["properties"];
        assert_eq!(sound["volume"]["description"], "0 to 1, for every sound.");
        assert_eq!(sound["volume"]["maximum"], 1, "a range is in the schema");
        assert!(
            file("look.toml")
                .unwrap()
                .about()
                .starts_with("How Banda looks")
        );
        let families = &defs["Families"]["enum"];
        assert!(families.as_array().unwrap().contains(&"off".into()));

        let harnesses = serde_json::to_value(file("harnesses.toml").unwrap().schema()).unwrap();
        let harness = &harnesses["$defs"]["Harness"];
        assert_eq!(
            harness["required"],
            serde_json::json!(["id", "name", "command"])
        );
        assert!(
            harness["properties"].get("record").is_none(),
            "a test's key stays out"
        );
    }

    #[test]
    fn a_wrong_harness_list_is_named_at_its_line() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("harnesses.toml");
        std::fs::write(
            &path,
            "[[harness]]\nid = \"x\"\nname = 3\ncommand = \"x\"\n",
        )
        .unwrap();
        let problems = check(&Places::at(folder.path()), std::slice::from_ref(&path));
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].line, Some(3));
    }

    #[test]
    fn with_no_files_it_checks_every_file_there_is() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("look.toml"), "radius = \"round\"\n").unwrap();
        std::fs::write(folder.path().join("harnesses.toml"), "[[harness]]\n").unwrap();
        let problems = check(&Places::at(folder.path()), &[]);
        let files: Vec<_> = problems.iter().map(|p| p.path.clone()).collect();
        assert!(files.iter().any(|f| f.ends_with("look.toml")), "{files:?}");
        assert!(
            files.iter().any(|f| f.ends_with("harnesses.toml")),
            "{files:?}"
        );
    }
}
