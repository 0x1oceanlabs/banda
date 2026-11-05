//! Each key of a settings file: the value it has, and the layer it comes
//! from (ADR 0016, decision 6). The settings Pane shows both beside a
//! row, and a ↶ for a key the Person's file sets.

use crate::line_at;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;
use std::path::PathBuf;
use toml_edit::TableLike;
use ts_rs::TS;

/// Where a key's value comes from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct From {
    /// `defaults`, `theme`, `hyprland`, `preset`, or `file`: the
    /// Person's own.
    pub layer: String,
    /// The file it is in, when it is in one.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Its line there, from 1.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// A key's value, and where it comes from.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Setting {
    pub value: Value,
    pub from: From,
}

/// Every key a file's layers set, by its dotted name: `tile.border`.
pub type Keyed = BTreeMap<String, Setting>;

/// One layer: the keys it says, and the file it was read from, so each
/// key is known by its line.
pub struct Layer<'a> {
    name: &'static str,
    keys: BTreeSet<String>,
    file: Option<&'a (PathBuf, String)>,
}

impl<'a> Layer<'a> {
    pub fn new(
        name: &'static str,
        settings: &impl Serialize,
        file: Option<&'a (PathBuf, String)>,
    ) -> Layer<'a> {
        let mut keys = Vec::new();
        flatten(String::new(), values(settings), &mut keys);
        let keys = keys.into_iter().map(|(key, _)| key).collect();
        Layer { name, keys, file }
    }
}

/// The keys in force, with the values of `merged`, the layers laid over
/// each other; each from the highest of `layers`, bottom first, that
/// says it. A key a layer above put out of force is not there.
pub fn keyed(merged: &impl Serialize, layers: &[Layer<'_>]) -> Keyed {
    let read: Vec<_> = layers
        .iter()
        .map(|layer| {
            let (path, text) = layer.file?;
            let document = toml_edit::Document::parse(text.as_str()).ok()?;
            Some((path.display().to_string(), text, document))
        })
        .collect();
    let mut leaves = Vec::new();
    flatten(String::new(), values(merged), &mut leaves);
    leaves
        .into_iter()
        .map(|(key, value)| {
            let found = layers
                .iter()
                .zip(&read)
                .rev()
                .find(|(l, _)| l.keys.contains(&key));
            let from = match found {
                Some((layer, read)) => From {
                    layer: layer.name.to_owned(),
                    path: read.as_ref().map(|(path, _, _)| path.clone()),
                    line: read
                        .as_ref()
                        .and_then(|(_, text, document)| line_of(document.as_table(), &key, text)),
                },
                None => From {
                    layer: "defaults".to_owned(),
                    path: None,
                    line: None,
                },
            };
            (key, Setting { value, from })
        })
        .collect()
}

/// Every value that is not a table, by its dotted name. A table with no
/// keys says nothing.
fn flatten(prefix: String, value: Value, keys: &mut Vec<(String, Value)>) {
    match value {
        Value::Null => {}
        Value::Object(table) => {
            for (name, value) in table {
                let key = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}.{name}")
                };
                flatten(key, value, keys);
            }
        }
        value => keys.push((prefix, value)),
    }
}

/// The line `key` is on in `text`, through tables and inline tables.
fn line_of(table: &dyn TableLike, key: &str, text: &str) -> Option<u32> {
    let (first, rest) = key
        .split_once('.')
        .map_or((key, None), |(f, r)| (f, Some(r)));
    let (found, item) = table.get_key_value(first)?;
    match rest {
        None => Some(line_at(text, found.span().or_else(|| item.span())?.start)),
        Some(rest) => line_of(item.as_table_like()?, rest, text),
    }
}

/// The dotted key at `offset` in `text`, from its name to the end of its
/// value: where a value that does not read is. An entry of a list of
/// tables is named by its `id`, as `banda settings` names it:
/// `harness.codex.enabled`. None when the text is not TOML, or the place
/// is no key's.
pub fn key_at(text: &str, offset: usize) -> Option<String> {
    entry_at(text, offset).map(|(key, _)| key)
}

/// [`key_at`], and the bytes of its entry: from the first part of its
/// name, `tile` of `tile.border = 3`, to the end of its value.
pub fn entry_at(text: &str, offset: usize) -> Option<(String, Range<usize>)> {
    let document = toml_edit::Document::parse(text).ok()?;
    entry_in(document.as_table(), offset)
}

/// `text` with the bytes of `entry` as spaces, lines kept, and a comma
/// after it too, as in an inline table: TOML without that entry, every
/// place in it where it was.
pub fn blank(text: &str, entry: Range<usize>) -> String {
    let after = text[entry.end..].trim_start_matches([' ', '\t']);
    let end = after
        .strip_prefix(',')
        .map_or(entry.end, |after| text.len() - after.len());
    let mut bytes = text.as_bytes().to_vec();
    for byte in &mut bytes[entry.start..end] {
        if *byte != b'\n' {
            *byte = b' ';
        }
    }
    String::from_utf8(bytes).expect("whole characters, as the entry starts and ends at one")
}

fn entry_in(table: &dyn TableLike, offset: usize) -> Option<(String, Range<usize>)> {
    table.iter().find_map(|(name, item)| {
        if let toml_edit::Item::ArrayOfTables(list) = item {
            return list.iter().find_map(|entry| {
                let (rest, range) = entry_in(entry, offset)?;
                let key = match entry.get("id").and_then(|id| id.as_str()) {
                    Some(id) => format!("{name}.{id}.{rest}"),
                    None => format!("{name}.{rest}"),
                };
                Some((key, range))
            });
        }
        let (key, _) = table.get_key_value(name)?;
        if let Some(inner) = item.as_table_like() {
            let (rest, mut range) = entry_in(inner, offset)?;
            // `tile.border = 3` is one entry, from `tile`.
            if inner.is_dotted() {
                range.start = key.span()?.start;
            }
            return Some((format!("{name}.{rest}"), range));
        }
        let range = key.span()?.start..item.span()?.end;
        range.contains(&offset).then(|| (name.to_owned(), range))
    })
}

/// A name a file may still say from before a rename, and its name now: it
/// reads as the new one, and the file is told where (ADR 0069 grace).
pub struct Renamed {
    /// For a key, the dotted key of the table that holds it (`""` at the
    /// top); for a value, the dotted key it is at (`group.by`), or of the
    /// array it is in (`row.hide`).
    pub at: &'static str,
    pub was: &'static str,
    pub now: &'static str,
    /// The name of a key or a table, rather than a string value.
    pub key: bool,
}

impl Renamed {
    pub const fn key(at: &'static str, was: &'static str, now: &'static str) -> Renamed {
        Renamed {
            at,
            was,
            now,
            key: true,
        }
    }

    pub const fn value(at: &'static str, was: &'static str, now: &'static str) -> Renamed {
        Renamed {
            at,
            was,
            now,
            key: false,
        }
    }
}

/// Each place `text` still says a name of `renamed`: where it starts, the
/// dotted key it is at, and what it is called now.
pub fn renamed(text: &str, renamed: &[Renamed]) -> Vec<(usize, String, String)> {
    let Ok(document) = toml_edit::Document::parse(text) else {
        return Vec::new();
    };
    let mut said = Vec::new();
    for name in renamed {
        let Some(table) = table_at(document.as_table(), name.at, name.key) else {
            continue;
        };
        if name.key {
            if let Some((key, _)) = table.get_key_value(name.was)
                && let Some(span) = key.span()
            {
                let dotted = [name.at, name.was]
                    .join(".")
                    .trim_start_matches('.')
                    .to_owned();
                said.push((
                    span.start,
                    dotted,
                    format!("{} is called {} now", name.was, name.now),
                ));
            }
            continue;
        }
        let last = name.at.rsplit('.').next().unwrap_or(name.at);
        let Some(item) = table.get(last) else {
            continue;
        };
        let values: Vec<&toml_edit::Value> = match item.as_value() {
            Some(toml_edit::Value::Array(list)) => list.iter().collect(),
            Some(value) => vec![value],
            None => Vec::new(),
        };
        for value in values {
            if value.as_str() == Some(name.was)
                && let Some(span) = value.span()
            {
                let message = format!("\"{}\" is called \"{}\" now", name.was, name.now);
                said.push((span.start, name.at.to_owned(), message));
            }
        }
    }
    said.sort();
    said
}

/// The table `at` names: itself for a key, the one that holds it for a
/// value.
fn table_at<'a>(top: &'a toml_edit::Table, at: &str, key: bool) -> Option<&'a dyn TableLike> {
    let mut parts: Vec<&str> = at.split('.').filter(|part| !part.is_empty()).collect();
    if !key {
        parts.pop();
    }
    let mut table: &dyn TableLike = top;
    for part in parts {
        table = table.get(part)?.as_table_like()?;
    }
    Some(table)
}

/// Settings as values; nothing when they cannot be written.
fn values(settings: &impl Serialize) -> Value {
    serde_json::to_value(settings).unwrap_or(Value::Object(Map::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_highest_layer_wins_and_names_its_line() {
        let file = (
            PathBuf::from("/c/look.toml"),
            "radius = 4\n\n[tile]\nborder = 3\n".to_owned(),
        );
        let defaults = json!({ "radius": 10, "tile": { "border": 2, "ring": 0 } });
        let hyprland = json!({ "tile": { "border": 2.5 } });
        let mine = json!({ "radius": 4, "tile": { "border": 3 } });
        let merged = json!({ "radius": 4, "tile": { "border": 3, "ring": 0 } });
        let keyed = keyed(
            &merged,
            &[
                Layer::new("defaults", &defaults, None),
                Layer::new("hyprland", &hyprland, None),
                Layer::new("file", &mine, Some(&file)),
            ],
        );
        assert_eq!(keyed["tile.ring"].from.layer, "defaults");
        assert_eq!(keyed["tile.border"].value, json!(3));
        assert_eq!(keyed["tile.border"].from.line, Some(4));
        assert_eq!(keyed["radius"].from.line, Some(1));
        assert_eq!(keyed["radius"].from.path.as_deref(), Some("/c/look.toml"));
    }

    #[test]
    fn a_place_in_a_file_is_a_key_s() {
        let text = "radius = \"x\"\n\n[tile]\nborder = 3\nglass = { blur = \"no\" }\n";
        let at = |words: &str| key_at(text, text.find(words).unwrap());
        assert_eq!(at("\"x\"").as_deref(), Some("radius"));
        assert_eq!(at("3").as_deref(), Some("tile.border"));
        assert_eq!(at("\"no\"").as_deref(), Some("tile.glass.blur"));
        assert_eq!(at("[tile]"), None, "a table's header is no key's");
        assert_eq!(key_at("a = \n", 0), None, "not TOML");
        let list = "[[harness]]\nid = \"codex\"\nenabled = 3\n";
        assert_eq!(
            key_at(list, list.find('3').unwrap()).as_deref(),
            Some("harness.codex.enabled")
        );
        let binds = "[binds]\n\"Alt+M\" = \"nope\"\n";
        assert_eq!(
            key_at(binds, binds.find("nope").unwrap()).as_deref(),
            Some("binds.Alt+M")
        );
    }

    #[test]
    fn a_key_out_of_force_is_not_there() {
        let defaults = json!({ "strip": { "spring": { "bounce": 0.2 } } });
        let mine = json!({ "strip": { "easing": "ease" } });
        let merged = json!({ "strip": { "easing": "ease" } });
        let keyed = keyed(
            &merged,
            &[
                Layer::new("defaults", &defaults, None),
                Layer::new("file", &mine, None),
            ],
        );
        assert_eq!(keyed.keys().collect::<Vec<_>>(), ["strip.easing"]);
    }
}
