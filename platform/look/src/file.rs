//! Banda's settings files, each described once (ADR 0016, decision 4).
//!
//! A [`SettingsFile`] names a file in `~/.config/banda/`, its schema, what
//! a new one starts as, and how its text is checked. The look describes the
//! files it reads; a module describes its own; `banda_settings` gathers
//! them. A file that is one layer, the Person's, over Banda's defaults is a
//! [`OneFile`], and [`resolve`] resolves every such file the same way, so
//! the look carries a module's file by its name, a value and its keys.

use crate::Problem;
use crate::keyed::{self, Keyed, Layer};
use crate::theme::Places;
use schemars::generate::SchemaSettings;
use schemars::transform::RecursiveTransform;
use schemars::{JsonSchema, Schema};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// A file in `~/.config/banda/` that Banda reads. What it holds is its
/// root struct's doc comment, the schema's `description`.
#[derive(Clone, Copy)]
pub struct SettingsFile {
    /// Its name in the config folder.
    pub name: &'static str,
    schema: fn() -> Schema,
    template: fn() -> String,
    check: fn(&Path, &str) -> Vec<Problem>,
    resolve: Option<Resolve>,
}

/// How the look resolves a file: its value, and each key's.
type Resolve = fn(&Places, &mut Vec<Problem>, &mut Vec<PathBuf>) -> (Value, Keyed);

impl SettingsFile {
    /// The file `name`, whose keys are a `T`, that starts as `template`
    /// and whose text `check` checks.
    pub const fn new<T: JsonSchema>(
        name: &'static str,
        template: fn() -> String,
        check: fn(&Path, &str) -> Vec<Problem>,
    ) -> SettingsFile {
        SettingsFile {
            name,
            schema: schema_of::<T>,
            template,
            check,
            resolve: None,
        }
    }

    /// The file a [`OneFile`] is, which the look resolves.
    pub const fn of<T: OneFile>() -> SettingsFile {
        SettingsFile {
            resolve: Some(resolve_value::<T>),
            ..SettingsFile::new::<T>(T::NAME, template_of::<T>, check_of::<T>)
        }
    }

    /// The file's JSON Schema, titled with its name.
    pub fn schema(&self) -> Schema {
        let mut schema = (self.schema)();
        schema.insert("title".into(), self.name.into());
        schema
    }

    /// What a new file starts as, before its first key is written.
    pub fn template(&self) -> String {
        (self.template)()
    }

    /// What is wrong in `text`, the file at `path`.
    pub fn check(&self, path: &Path, text: &str) -> Vec<Problem> {
        (self.check)(path, text)
    }

    /// Whether the look resolves it into a value: a [`OneFile`] does.
    pub fn resolves(&self) -> bool {
        self.resolve.is_some()
    }

    /// The file on this machine, watched there or not: a [`OneFile`]'s
    /// value and each key's; any other's problems only, as its crate finds
    /// them, with `None`.
    pub fn resolve(
        &self,
        places: &Places,
        problems: &mut Vec<Problem>,
        watched: &mut Vec<PathBuf>,
    ) -> Option<(Value, Keyed)> {
        if let Some(resolve) = self.resolve {
            return Some(resolve(places, problems, watched));
        }
        let path = places.config.join(self.name);
        if let Ok(text) = std::fs::read_to_string(&path) {
            problems.extend(self.check(&path, &text));
        }
        watched.push(path);
        None
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

/// A settings file that is one layer, the Person's, over Banda's
/// defaults: every key optional.
pub trait OneFile: Default + Serialize + DeserializeOwned + JsonSchema {
    /// Its name in the config folder.
    const NAME: &'static str;
    /// The file as Banda writes it first, every default named.
    const TEMPLATE: &'static str;
    /// Names it may still say from before a rename (ADR 0069 grace).
    const RENAMED: &'static [crate::keyed::Renamed] = &[];
    /// What the window gets, every key resolved.
    type Resolved: Serialize;
    /// Banda's own, every key said.
    fn defaults() -> Self;
    /// The keys `self` says, over the keys of `under`.
    fn over(self, under: Self) -> Self;
    /// `self`, every key said, as the window gets it.
    fn resolved(self) -> Self::Resolved;
    /// What TOML alone does not check: a value that is wrong is named in
    /// `problems` and taken out.
    fn check(&mut self, _path: &Path, _text: &str, _problems: &mut Vec<Problem>) {}
}

/// Reads `text`, the file at `path`, as a `T`, as [`crate::read`] reads a
/// file, then checks it: a wrong key is named in `problems` and left
/// out, and the rest still reads. The engine reads a module's file so too.
pub fn read<T: OneFile>(path: &Path, text: &str, problems: &mut Vec<Problem>) -> Option<T> {
    crate::say_renamed(path, text, T::RENAMED, problems);
    let mut settings: T = crate::read(path, text, problems)?;
    settings.check(path, text, problems);
    Some(settings)
}

/// The file at `path` as a `T`, as the engine reads a module's own file
/// when it needs it: none when it is missing or does not read at all, a
/// wrong key left out; what is wrong goes to the log, as the look names
/// it to the Person.
pub fn read_at<T: OneFile>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut problems = Vec::new();
    let read = read::<T>(path, &text, &mut problems);
    for problem in &problems {
        tracing::warn!(%problem, file = T::NAME);
    }
    read
}

/// A `T` on this machine, its file over Banda's defaults, with each key's
/// value and where it comes from. The file is watched, there or not.
pub fn resolve<T: OneFile>(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> (T::Resolved, Keyed) {
    let path = places.config.join(T::NAME);
    watched.push(path.clone());
    let file = std::fs::read_to_string(&path).ok().map(|text| (path, text));
    let mine = file
        .as_ref()
        .and_then(|(path, text)| read::<T>(path, text, problems))
        .unwrap_or_default();
    let defaults = T::defaults();
    let layers = [
        Layer::new("defaults", &defaults, None),
        Layer::new("file", &mine, file.as_ref()),
    ];
    let merged = mine.over(defaults);
    let keyed = keyed::keyed(&merged, &layers);
    (merged.resolved(), keyed)
}

fn resolve_value<T: OneFile>(
    places: &Places,
    problems: &mut Vec<Problem>,
    watched: &mut Vec<PathBuf>,
) -> (Value, Keyed) {
    let (resolved, keyed) = resolve::<T>(places, problems, watched);
    let value = serde_json::to_value(resolved).expect("settings are plain data");
    (value, keyed)
}

fn template_of<T: OneFile>() -> String {
    T::TEMPLATE.to_owned()
}

fn check_of<T: OneFile>(path: &Path, text: &str) -> Vec<Problem> {
    let mut problems = Vec::new();
    read::<T>(path, text, &mut problems);
    problems
}

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
