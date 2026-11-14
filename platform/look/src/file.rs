//! Banda's settings files, each described once (ADR 0016, decision 4).
//!
//! A [`SettingsFile`] names a file in `~/.config/banda/`, its schema, what
//! a new one starts as, and how its text is checked. The look describes the
//! files it reads; a module describes its own; the engine hands
//! `banda_settings` each from its list of Apps. A file that is one layer, the Person's, over Banda's defaults is a
//! [`OneFile`], and [`resolve`] resolves every such file the same way, so
//! the look carries a module's file by its name, a value and its keys.
//!
//! Each file says whose copy each of its sections is, its [`Class`] (ADR
//! 0101, decision 3): a machine's part is read through that machine's
//! engine, [`SettingsFile::part`], and nothing of the rest leaves it (ADR
//! 0106, decision 7).

use crate::Places;
use crate::Problem;
use crate::keyed::{self, Keyed, Layer, Moved, Retired};
use schemars::generate::SchemaSettings;
use schemars::transform::RecursiveTransform;
use schemars::{JsonSchema, Schema};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::{Path, PathBuf};
use ts_rs::TS;

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
    /// Whose copy its keys are, but for those of `sections`.
    class: Class,
    /// Its top-level keys of another class than the file's.
    sections: &'static [(&'static str, Class)],
    /// Its keys that moved here from other files (ADR 0069 grace).
    moved: &'static [Moved],
    /// Which of its keys only the Person changes (ADR 0083); none when
    /// an Agent may change them all.
    person: Option<OnlyThePerson>,
}

/// Why only the Person changes the key of these parts, as `start`,
/// `claude`, `mode`, to the value given as `banda settings set` takes it,
/// or takes it out with none; none when an Agent may change it.
pub type OnlyThePerson = fn(&[&str], Option<&str>) -> Option<&'static str>;

/// Whether `value`, as `banda settings set` takes it, is a whole table
/// that names one of the keys `wanted`: a table set at once sets each.
pub fn names(value: Option<&str>, wanted: &[&str]) -> bool {
    value
        .and_then(|value| value.parse::<toml_edit::Value>().ok())
        .is_some_and(|value| {
            value
                .as_inline_table()
                .is_some_and(|table| table.iter().any(|(key, _)| wanted.contains(&key)))
        })
}

/// How the look resolves a file, from its text at a path, there or not:
/// its value, and each key's.
type Resolve = fn(&Path, Option<&str>, &mut Vec<Problem>) -> (Value, Keyed);

/// Whose copy of a setting a window reads and writes (ADR 0101, decision
/// 3). When in doubt, a setting is the device's: never copied, it never
/// clashes, and moving it to shared later only adds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Class {
    /// What the Person means everywhere: a copy on every machine, and a
    /// window reads and writes its own machine's.
    Shared,
    /// How this screen looks and sits under the hand: it never leaves the
    /// device.
    Device,
    /// What that machine has: read and written through its engine, from
    /// any window (ADR 0106, decision 7).
    Machine,
}

/// A file's keys of one class, as this machine has them.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    /// The file as the look resolves it, for a file it resolves: its keys
    /// of the class as the file says them, the rest as Banda has them.
    pub value: Option<Value>,
    /// Each key of the class, its value and where it comes from.
    pub keyed: Keyed,
    /// What is wrong in the file at those keys, or in the whole file.
    pub problems: Vec<Problem>,
    /// For a file the look only checks, which has no value to tell one
    /// read from another: its text with only the class's keys in it.
    /// None for a file it resolves, or one that is not there.
    pub text: Option<String>,
}

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
            class: Class::Device,
            sections: &[],
            moved: &[],
            person: None,
        }
    }

    /// The file a [`OneFile`] is, which the look resolves.
    pub const fn of<T: OneFile>() -> SettingsFile {
        SettingsFile {
            resolve: Some(resolve_value::<T>),
            moved: T::MOVED,
            ..SettingsFile::new::<T>(T::NAME, template_of::<T>, check_of::<T>)
        }
    }

    /// This file, its keys `class`'s but for the top-level keys `sections`
    /// names. A file that says no class is the device's.
    pub const fn class(
        self,
        class: Class,
        sections: &'static [(&'static str, Class)],
    ) -> SettingsFile {
        SettingsFile {
            class,
            sections,
            ..self
        }
    }

    /// This file, with `person` to say which of its keys only the Person
    /// changes: the engine refuses an Agent those (ADR 0083).
    pub const fn only_the_person(self, person: OnlyThePerson) -> SettingsFile {
        SettingsFile {
            person: Some(person),
            ..self
        }
    }

    /// Why only the Person changes the key of `parts` to `value`, or takes
    /// it out with none, as the file says; none when an Agent may.
    pub fn person_alone(&self, parts: &[&str], value: Option<&str>) -> Option<&'static str> {
        self.person.and_then(|person| person(parts, value))
    }

    /// Whose copy `key` is, dotted, by its top-level key: `start` of
    /// `start.account`.
    pub fn class_of(&self, key: &str) -> Class {
        let section = key.split_once('.').map_or(key, |(section, _)| section);
        (self.sections.iter())
            .find(|(name, _)| *name == section)
            .map_or(self.class, |(_, class)| *class)
    }

    /// Whether any key of it is `class`'s.
    pub fn has(&self, class: Class) -> bool {
        self.class == class || self.sections.iter().any(|(_, each)| *each == class)
    }

    /// The top-level keys of another class than the file's.
    pub fn sections(&self) -> &'static [(&'static str, Class)] {
        self.sections
    }

    /// Its keys that moved here from other files, which the writer writes
    /// here whichever name it is given (ADR 0069 grace).
    pub fn moved(&self) -> &'static [Moved] {
        self.moved
    }

    /// The file's JSON Schema, titled with its name, saying its class as
    /// `x-class` and each top-level key its own, for the window to know
    /// whose copy the file is, and a row.
    pub fn schema(&self) -> Schema {
        let mut schema = (self.schema)();
        schema.insert("title".into(), self.name.into());
        let class = serde_json::to_value(self.class);
        schema.insert("x-class".into(), class.expect("a class is a word"));
        if let Some(Value::Object(keys)) = schema.get_mut("properties") {
            for (name, key) in keys.iter_mut() {
                if let Value::Object(key) = key {
                    let class = serde_json::to_value(self.class_of(name));
                    key.insert("x-class".into(), class.expect("a class is a word"));
                }
            }
        }
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
        let path = places.config.join(self.name);
        let text = std::fs::read_to_string(&path).ok();
        let resolved = self.resolve_text(&path, text.as_deref(), problems);
        watched.push(path);
        // The files its keys moved from are read with it.
        for old in self.moved.iter().map(|key| places.config.join(key.file)) {
            if !watched.contains(&old) {
                watched.push(old);
            }
        }
        resolved
    }

    /// Its keys of `class` on this machine, the rest of the file read as if
    /// it said nothing (ADR 0106, decision 7): what a window of another
    /// device may read of it. The rest's entries are blanked, not taken
    /// out, so each problem and key names its line in the file.
    pub fn part(&self, places: &Places, class: Class) -> Part {
        let path = places.config.join(self.name);
        let kept = |key: &str| self.class_of(key) == class;
        let whole = self.class == class && self.sections.iter().all(|(_, each)| *each == class);
        let text = std::fs::read_to_string(&path).ok().map(|text| {
            if whole {
                return text;
            }
            // A file that is not TOML reads as nothing anyway, and says
            // where it breaks.
            keyed::only(&text, kept).unwrap_or(text)
        });
        let mut problems = Vec::new();
        let (value, mut keyed, text) =
            match self.resolve_text(&path, text.as_deref(), &mut problems) {
                Some((value, keyed)) => (Some(value), keyed, None),
                None => (None, Keyed::new(), text),
            };
        keyed.retain(|key, _| kept(key));
        Part {
            value,
            keyed,
            problems,
            text,
        }
    }

    /// The file at `path` from its `text`: a [`OneFile`]'s value and each
    /// key's; any other's problems only, as its crate finds them, with
    /// `None`.
    fn resolve_text(
        &self,
        path: &Path,
        text: Option<&str>,
        problems: &mut Vec<Problem>,
    ) -> Option<(Value, Keyed)> {
        if let Some(resolve) = self.resolve {
            return Some(resolve(path, text, problems));
        }
        if let Some(text) = text {
            problems.extend(self.check(path, text));
        }
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
    /// Keys that moved here from another file, read there while this one
    /// does not say them (ADR 0069 grace).
    const MOVED: &'static [Moved] = &[];
    /// Keys it may still say that it no longer reads, as one that moved to
    /// another file: each is told where, and the rest still reads.
    const RETIRED: &'static [Retired] = &[];
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
    let kept = crate::say_retired(path, text, T::RETIRED, problems);
    let mut settings: T = crate::read(path, &kept, problems)?;
    settings.check(path, &kept, problems);
    Some(settings)
}

/// What the files beside the one at `path` still say of the keys that
/// moved into it ([`OneFile::MOVED`]), file by file as it names them: each
/// as a `T`, with its path and text. What is wrong there is
/// left out with no word here: the old file says where its key went.
fn moved_here<T: OneFile>(path: &Path) -> Vec<(T, (PathBuf, String))> {
    let mut names: Vec<&'static str> = T::MOVED.iter().map(|key| key.file).collect();
    names.dedup();
    let folder = path.parent().unwrap_or(Path::new(""));
    names
        .into_iter()
        .filter_map(|name| {
            let old = folder.join(name);
            let text = std::fs::read_to_string(&old).ok()?;
            let said = keyed::moved(&text, name, T::MOVED)?;
            let read = read::<T>(&old, &said, &mut Vec::new())?;
            Some((read, (old, text)))
        })
        .collect()
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

/// The file at `path` as the engine reads a module's own file to act by
/// it: every key resolved, the file's own over what its keys' old files
/// still say, over Banda's defaults. A file that is missing says nothing;
/// what is wrong goes to the log, as [`read_at`] sends it.
pub fn resolved_at<T: OneFile>(path: &Path) -> T::Resolved {
    let text = std::fs::read_to_string(path).ok();
    let mut problems = Vec::new();
    let (resolved, _) = resolve_from::<T>(path, text.as_deref(), &mut problems);
    for problem in &problems {
        tracing::warn!(%problem, file = T::NAME);
    }
    resolved
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
    let text = std::fs::read_to_string(&path).ok();
    resolve_from::<T>(&path, text.as_deref(), problems)
}

/// [`resolve`], from the file's `text` at `path`, there or not.
fn resolve_from<T: OneFile>(
    path: &Path,
    text: Option<&str>,
    problems: &mut Vec<Problem>,
) -> (T::Resolved, Keyed) {
    let file = text.map(|text| (path.to_owned(), text.to_owned()));
    let mine = file
        .as_ref()
        .and_then(|(path, text)| read::<T>(path, text, problems))
        .unwrap_or_default();
    let defaults = T::defaults();
    // What a key's old file still says lies under the file's own, and is
    // the Person's word as much: `file`, at its path there (ADR 0069
    // grace).
    let (before, olds): (Vec<_>, Vec<_>) = moved_here::<T>(path).into_iter().unzip();
    let mut layers = vec![Layer::new("defaults", &defaults, None)];
    for (said, old) in before.iter().zip(&olds).rev() {
        layers.push(Layer::new("file", said, Some(old)));
    }
    layers.push(Layer::new("file", &mine, file.as_ref()));
    let merged = before.into_iter().fold(mine, T::over).over(defaults);
    let keyed = keyed::keyed(&merged, &layers);
    (merged.resolved(), keyed)
}

fn resolve_value<T: OneFile>(
    path: &Path,
    text: Option<&str>,
    problems: &mut Vec<Problem>,
) -> (Value, Keyed) {
    let (resolved, keyed) = resolve_from::<T>(path, text, problems);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;
    use std::collections::BTreeMap;

    /// A file of two classes, as `browser.toml` is: the machine's
    /// `[agents]` beside the device's own keys.
    #[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
    #[serde(deny_unknown_fields)]
    struct Mixed {
        search: Option<String>,
        tabs: Option<String>,
        agents: Option<Agents>,
    }

    #[derive(Debug, Default, Deserialize, Serialize, JsonSchema)]
    #[serde(deny_unknown_fields)]
    struct Agents {
        enabled: Option<bool>,
        sites: Option<BTreeMap<String, String>>,
    }

    impl OneFile for Mixed {
        const NAME: &'static str = "mixed.toml";
        const TEMPLATE: &'static str = "";
        type Resolved = Mixed;

        fn defaults() -> Self {
            Mixed {
                search: Some("duck".to_owned()),
                tabs: Some("row".to_owned()),
                agents: Some(Agents {
                    enabled: Some(true),
                    sites: None,
                }),
            }
        }

        fn over(self, under: Self) -> Self {
            Mixed {
                search: self.search.or(under.search),
                tabs: self.tabs.or(under.tabs),
                agents: self.agents.or(under.agents),
            }
        }

        fn resolved(self) -> Self {
            self
        }
    }

    const MIXED: SettingsFile =
        SettingsFile::of::<Mixed>().class(Class::Device, &[("agents", Class::Machine)]);

    /// The device's keys say a search and a wrong `tabs`; the machine's,
    /// a site and a wrong `enabled`.
    const TEXT: &str = "search = \"https://kagi.com/?q=%s\"\ntabs = 3\n\n[agents]\nenabled = \"yes\"\nsites.github = \"allow\"\n";

    fn places_with(text: &str) -> (tempfile::TempDir, Places) {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("mixed.toml"), text).unwrap();
        let places = Places::at(folder.path());
        (folder, places)
    }

    #[test]
    fn a_part_is_its_class_s_keys_and_nothing_else_of_the_file() {
        let (_folder, places) = places_with(TEXT);
        let machine = MIXED.part(&places, Class::Machine);
        assert_eq!(
            machine.keyed.keys().collect::<Vec<_>>(),
            ["agents.sites.github"]
        );
        let site = &machine.keyed["agents.sites.github"];
        assert_eq!(
            (site.from.layer.as_str(), site.from.line),
            ("file", Some(6))
        );
        // The device's search and tabs are Banda's here, not the file's.
        assert_eq!(
            machine.value,
            Some(json!({
                "search": "duck",
                "tabs": "row",
                "agents": { "enabled": null, "sites": { "github": "allow" } },
            }))
        );
        let said: Vec<_> = (machine.problems.iter())
            .map(|problem| (problem.key.as_deref(), problem.line))
            .collect();
        assert_eq!(said, [(Some("agents.enabled"), Some(5))]);

        let device = MIXED.part(&places, Class::Device);
        assert_eq!(device.keyed.keys().collect::<Vec<_>>(), ["search", "tabs"]);
        assert_eq!(device.keyed["search"].from.line, Some(1));
        assert_eq!(device.value.unwrap()["agents"]["enabled"], json!(true));
        let said: Vec<_> = (device.problems.iter())
            .map(|problem| (problem.key.as_deref(), problem.line))
            .collect();
        assert_eq!(said, [(Some("tabs"), Some(2))]);
    }

    #[test]
    fn a_part_of_a_file_that_is_not_there_is_banda_s_own() {
        let folder = tempfile::tempdir().unwrap();
        let machine = MIXED.part(&Places::at(folder.path()), Class::Machine);
        assert_eq!(machine.keyed.keys().collect::<Vec<_>>(), ["agents.enabled"]);
        assert_eq!(machine.keyed["agents.enabled"].from.layer, "defaults");
        assert!(machine.problems.is_empty());
        assert_eq!(machine.value.unwrap()["agents"]["enabled"], json!(true));
    }

    #[test]
    fn a_file_that_is_not_toml_says_where_it_breaks() {
        let (_folder, places) = places_with("[agents]\nenabled = \n");
        let machine = MIXED.part(&places, Class::Machine);
        assert_eq!(machine.problems.len(), 1, "{:?}", machine.problems);
        assert_eq!(machine.problems[0].line, Some(2));
        assert_eq!(machine.value.unwrap()["agents"]["enabled"], json!(true));
    }

    #[test]
    fn a_key_is_of_its_section_s_class_or_the_file_s() {
        assert_eq!(MIXED.class_of("agents"), Class::Machine);
        assert_eq!(MIXED.class_of("agents.sites.github.com"), Class::Machine);
        assert_eq!(MIXED.class_of("search"), Class::Device);
        assert_eq!(MIXED.class_of("nothing.said"), Class::Device);
        assert!(MIXED.has(Class::Machine) && MIXED.has(Class::Device));
        assert!(!MIXED.has(Class::Shared));
        let unsaid = SettingsFile::of::<Mixed>();
        assert_eq!(unsaid.class_of("agents"), Class::Device, "when in doubt");
    }

    #[test]
    fn the_schema_says_the_file_s_class_and_each_top_level_key_s() {
        let schema = serde_json::to_value(MIXED.schema()).unwrap();
        let properties = &schema["properties"];
        assert_eq!(properties["agents"]["x-class"], "machine");
        assert_eq!(properties["search"]["x-class"], "device");
        assert_eq!(properties["tabs"]["x-class"], "device");
        assert_eq!(schema["x-class"], "device", "the file's own");
    }
}
