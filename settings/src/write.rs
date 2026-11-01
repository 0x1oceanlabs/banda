//! The one writer of the settings files (ADR 0016, decision 5). The
//! window, an Agent and the Person's editor all change the same files; this
//! changes one key and leaves every other line, comment and blank as it was,
//! and writes nothing the file's own check would refuse.

use crate::{File, check_text, file};
use banda_look::Problem;
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item, Key, TableLike, Value};

/// Sets `key`, dotted as `tile.border`, in the file called `name` in
/// `config`, to `value`: a TOML value, or else the text as a string. A
/// file not there yet starts from its template. Refuses, with what is
/// wrong, a value the file would not take.
///
/// In a list of tables, as `[[harness]]`, the name after the list's is an
/// entry's `id`: `harness.codex.command`. An entry not there is added. An
/// inline table sets each of its keys, so `harness.gemini = { name = …,
/// command = … }` adds a whole entry at once.
pub fn set(config: &Path, name: &str, key: &str, value: &str) -> Result<(), Vec<Problem>> {
    let mut open = Open::new(config, name, key)?;
    let value = value
        .parse::<Value>()
        .unwrap_or_else(|_| Value::from(value));
    // The table the value goes in, and each key of it it sets.
    let mut keys = open.tables.clone();
    let pairs: Vec<(String, Value)> = match value {
        Value::InlineTable(pairs) => {
            keys.push(Key::new(open.leaf.clone()));
            pairs
                .into_iter()
                .map(|(leaf, mut value)| {
                    // Spaced as a key of its own, not as inside braces.
                    value.decor_mut().clear();
                    (leaf.to_string(), value)
                })
                .collect()
        }
        value => vec![(open.leaf.clone(), value)],
    };
    // A file of nothing but comments, as a template, keeps them first,
    // above what is set: its `#:schema` line stays its first.
    let only_comments = open.document.is_empty();
    // The keys alone too, for when the file was wrong before them.
    let mut alone = DocumentMut::new();
    for document in [&mut open.document, &mut alone] {
        let table = walk(document, &keys, &open.path)?;
        for (leaf, value) in &pairs {
            put(table, leaf, value.clone());
        }
    }
    let alone = alone.to_string();
    if only_comments {
        let mut comments = open.was.clone();
        if !comments.is_empty() && !comments.ends_with('\n') {
            comments.push('\n');
        }
        open.document = (comments + &alone)
            .parse()
            .map_err(|error| whole(&open.path, error))?;
    }
    open.save(Some(&alone))
}

/// Takes `key` out of the file called `name`, so the layer under it
/// shows; an entry of a list of tables, `harness.gemini`, goes whole. A
/// key or file not there is already reset.
pub fn reset(config: &Path, name: &str, key: &str) -> Result<(), Vec<Problem>> {
    let mut open = Open::new(config, name, key)?;
    let leaf = open.leaf.clone();
    if let Some((list, tables)) = open.tables.split_last()
        && let Ok(table) = walk(&mut open.document, tables, &open.path)
        && let Some(Item::ArrayOfTables(list)) = table.get_mut(list.get())
    {
        let before = list.len();
        list.retain(|entry| id_of(entry) != Some(&leaf));
        if list.len() == before {
            return Ok(());
        }
        return open.save(None);
    }
    let table = open.table()?;
    if !table.contains_key(&leaf) {
        return Ok(());
    }
    if let Some(comments) = remove(table, &leaf) {
        let trailing = open.document.trailing().as_str().unwrap_or_default();
        open.document.set_trailing(format!("{comments}{trailing}"));
    }
    open.save(None)
}

/// A file read to change one key of.
struct Open {
    path: PathBuf,
    was: String,
    document: DocumentMut,
    /// The tables the key is in, and its own name.
    tables: Vec<Key>,
    leaf: String,
}

impl Open {
    fn new(config: &Path, name: &str, key: &str) -> Result<Open, Vec<Problem>> {
        let path = config.join(name);
        let file =
            file(name).ok_or_else(|| whole(&path, format!("Banda reads no file called {name}")))?;
        let mut tables = Key::parse(key)
            .map_err(|error| whole(&path, format!("{key:?} is not a key: {error}")))?;
        let leaf = tables.pop().ok_or_else(|| whole(&path, "no key to set"))?;
        let was = read(&path, file).map_err(|error| whole(&path, error))?;
        let document = was
            .parse::<DocumentMut>()
            .map_err(|error| whole(&path, error))?;
        let leaf = written_as(&document, name, &tables, leaf.get());
        Ok(Open {
            path,
            was,
            document,
            tables,
            leaf,
        })
    }

    /// The table the key is in, made when it is not there.
    fn table(&mut self) -> Result<&mut dyn TableLike, Vec<Problem>> {
        walk(&mut self.document, &self.tables, &self.path)
    }

    /// Writes the file when it changed, and refuses when it would now be
    /// wrong: when it was right before, as a whole; when it was wrong
    /// already, the key `alone`.
    fn save(self, alone: Option<&str>) -> Result<(), Vec<Problem>> {
        let text = self.document.to_string();
        if text == self.was {
            return Ok(());
        }
        let problems = check_text(&self.path, &text);
        if !problems.is_empty() {
            if check_text(&self.path, &self.was).is_empty() {
                return Err(problems);
            }
            if let Some(alone) = alone {
                let wrong: Vec<_> = check_text(&self.path, alone)
                    .into_iter()
                    .map(|problem| whole(&self.path, problem.message).remove(0))
                    .collect();
                if !wrong.is_empty() {
                    return Err(wrong);
                }
            }
        }
        write(&self.path, &text).map_err(|error| whole(&self.path, error))
    }
}

/// The table `tables` name in `document`, made when it is not there; in a
/// list of tables, the entry the next name is the `id` of.
/// The name `leaf` has in the file. A key of `keys.toml` goes by the key
/// it names, so `Alt+K` changes the line written `alt+k`, as one file has
/// one line for a key.
fn written_as(document: &DocumentMut, name: &str, tables: &[Key], leaf: &str) -> String {
    let binds = match tables {
        [table] if name == "keys.toml" && table.get() == "binds" => document.get("binds"),
        _ => None,
    };
    let names = banda_look::keys::canonical(leaf);
    binds
        .and_then(Item::as_table_like)
        .and_then(|binds| {
            binds
                .iter()
                .map(|(written, _)| written)
                .find(|written| names.is_some() && banda_look::keys::canonical(written) == names)
        })
        .unwrap_or(leaf)
        .to_owned()
}

fn walk<'d>(
    document: &'d mut DocumentMut,
    tables: &[Key],
    path: &Path,
) -> Result<&'d mut dyn TableLike, Vec<Problem>> {
    let not_table = |at: usize| {
        let walked: Vec<_> = tables[..=at].iter().map(Key::get).collect();
        whole(path, format!("{} is not a table", walked.join(".")))
    };
    let mut table: &mut dyn TableLike = document.as_table_mut();
    let mut names = tables.iter().enumerate();
    while let Some((at, name)) = names.next() {
        let item = table.entry(name.get()).or_insert_with(|| {
            let mut new = toml_edit::Table::new();
            // A table only for the ones in it has no header of its own.
            new.set_implicit(true);
            Item::Table(new)
        });
        table = match item {
            Item::ArrayOfTables(list) => {
                let (at, id) = names.next().ok_or_else(|| not_table(at))?;
                entry(list, id.get()).ok_or_else(|| not_table(at))?
            }
            item => item.as_table_like_mut().ok_or_else(|| not_table(at))?,
        };
    }
    Ok(table)
}

/// The entry of `list` whose `id` is `id`, added when there is none.
fn entry<'l>(list: &'l mut toml_edit::ArrayOfTables, id: &str) -> Option<&'l mut dyn TableLike> {
    let found = list.iter().position(|entry| id_of(entry) == Some(id));
    let at = match found {
        Some(at) => at,
        None => {
            let mut new = toml_edit::Table::new();
            new.insert("id", toml_edit::value(id));
            list.push(new);
            list.len() - 1
        }
    };
    list.get_mut(at).map(|entry| entry as &mut dyn TableLike)
}

fn id_of(entry: &toml_edit::Table) -> Option<&str> {
    entry.get("id")?.as_str()
}

/// Sets `leaf` in `table`, keeping the comment beside its old value.
fn put(table: &mut dyn TableLike, leaf: &str, mut value: Value) {
    match table.get_mut(leaf) {
        Some(Item::Value(old)) => {
            *value.decor_mut() = old.decor().clone();
            *old = value;
        }
        Some(item) => *item = Item::Value(value),
        None => {
            table.insert(leaf, Item::Value(value));
        }
    }
}

/// Takes `leaf` out of `table`. The comments above it may be about more
/// than it, the file's own among them: they stay, above what comes next.
/// Returns them when nothing does, for the file's end.
fn remove(table: &mut dyn TableLike, leaf: &str) -> Option<String> {
    let next = {
        let mut names = table.iter().map(|(name, _)| name);
        names.find(|name| *name == leaf);
        names.next().map(str::to_owned)
    };
    let comments = table
        .key(leaf)
        .and_then(|key| key.leaf_decor().prefix()?.as_str())
        .filter(|prefix| prefix.contains('#'))
        .map(str::to_owned);
    table.remove(leaf);
    let comments = comments?;
    let Some(next) = next else {
        return Some(comments);
    };
    match table.get_mut(&next) {
        Some(Item::Table(next)) => prepend(next.decor_mut(), &comments),
        Some(Item::ArrayOfTables(_)) => return Some(comments),
        _ => match table.key_mut(&next) {
            Some(mut key) => prepend(key.leaf_decor_mut(), &comments),
            None => return Some(comments),
        },
    }
    None
}

fn prepend(decor: &mut toml_edit::Decor, comments: &str) {
    let had = decor.prefix().and_then(|p| p.as_str()).unwrap_or_default();
    decor.set_prefix(format!("{comments}{had}"));
}

fn whole(path: &Path, message: impl ToString) -> Vec<Problem> {
    vec![Problem::whole(path, message.to_string())]
}

/// The file's text; its template when it is not there yet.
fn read(path: &Path, file: &File) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((file.template)()),
        read => read,
    }
}

/// Writes whole or not at all, so a reader never meets half a file: into
/// a file beside it, then over it. A link is followed, so the Person's
/// dotfiles keep it.
fn write(path: &Path, text: &str) -> std::io::Result<()> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let folder = target.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    std::fs::create_dir_all(&folder)?;
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let beside = folder.join(format!(".{name}.{}.new", std::process::id()));
    std::fs::write(&beside, text)?;
    std::fs::rename(&beside, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&beside);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(look: &str) -> tempfile::TempDir {
        let config = tempfile::tempdir().unwrap();
        std::fs::write(config.path().join("look.toml"), look).unwrap();
        config
    }

    fn look(config: &tempfile::TempDir) -> String {
        std::fs::read_to_string(config.path().join("look.toml")).unwrap()
    }

    #[test]
    fn a_key_changes_and_every_other_line_stays() {
        let config = config("# Mine.\nradius = 4 # small\n\n[tile]\n# thick\nborder = 3\n");
        set(config.path(), "look.toml", "radius", "6").unwrap();
        set(config.path(), "look.toml", "tile.border", "2.5").unwrap();
        assert_eq!(
            look(&config),
            "# Mine.\nradius = 6 # small\n\n[tile]\n# thick\nborder = 2.5\n"
        );
    }

    #[test]
    fn a_new_key_makes_its_table() {
        let config = config("radius = 4\n");
        set(config.path(), "look.toml", "motion.strip.off", "true").unwrap();
        set(config.path(), "look.toml", "mode", "dark").unwrap();
        let text = look(&config);
        assert!(text.contains("mode = \"dark\""), "{text}");
        assert!(text.contains("[motion.strip]\noff = true"), "{text}");
        assert!(!text.contains("[motion]\n"), "{text}");
    }

    #[test]
    fn a_file_not_there_starts_from_its_template() {
        let config = tempfile::tempdir().unwrap();
        set(config.path(), "sidebar.toml", "sort.by", "title").unwrap();
        let text = std::fs::read_to_string(config.path().join("sidebar.toml")).unwrap();
        assert!(
            text.starts_with("#:schema ./schemas/sidebar.schema.json\n"),
            "{text}"
        );
        assert!(text.contains("\n[sort]\nby = \"title\"\n"), "{text}");
        assert!(
            text.contains("# by = \"attention\""),
            "the template's comments stay"
        );
    }

    #[test]
    fn a_wrong_value_is_refused_and_nothing_written() {
        let config = config("radius = 4\n");
        let refused = set(config.path(), "look.toml", "radius", "big").unwrap_err();
        assert!(refused[0].message.contains("expected f64"), "{refused:?}");
        let refused = set(config.path(), "look.toml", "nope", "1").unwrap_err();
        assert!(refused[0].message.contains("nope"), "{refused:?}");
        let refused = set(config.path(), "look.toml", "radius.x", "1").unwrap_err();
        assert_eq!(refused[0].message, "radius is not a table");
        assert_eq!(look(&config), "radius = 4\n");
    }

    #[test]
    fn what_was_already_wrong_does_not_stop_a_change() {
        let config = config("radius = \"big\"\n");
        set(config.path(), "look.toml", "mode", "dark").unwrap();
        assert!(look(&config).contains("mode = \"dark\""));
        let refused = set(config.path(), "look.toml", "tile.border", "thick").unwrap_err();
        assert!(refused[0].message.contains("expected f64"), "{refused:?}");
        assert!(!look(&config).contains("thick"));
    }

    #[test]
    fn a_key_of_keys_toml_changes_the_line_that_names_it() {
        let config = tempfile::tempdir().unwrap();
        let keys = config.path().join("keys.toml");
        std::fs::write(&keys, "[binds]\n\"alt+k\" = \"pane.new\" # mine\n").unwrap();
        set(config.path(), "keys.toml", "binds.\"Alt+K\"", "none").unwrap();
        set(config.path(), "keys.toml", "binds.\"Alt+M\"", "pane.new").unwrap();
        assert_eq!(
            std::fs::read_to_string(&keys).unwrap(),
            "[binds]\n\"alt+k\" = \"none\" # mine\n\"Alt+M\" = \"pane.new\"\n"
        );
    }

    #[test]
    fn reset_takes_the_key_out() {
        let config = config("radius = 4\n\n[tile]\nborder = 3\n");
        reset(config.path(), "look.toml", "tile.border").unwrap();
        reset(config.path(), "look.toml", "tile.nothing").unwrap();
        assert_eq!(look(&config), "radius = 4\n\n[tile]\n");
        let config = self::config("# Mine.\nradius = 4\n# thick\nborder = 3\n");
        reset(config.path(), "look.toml", "radius").unwrap();
        assert_eq!(look(&config), "# Mine.\n# thick\nborder = 3\n");
        let empty = tempfile::tempdir().unwrap();
        reset(empty.path(), "look.toml", "radius").unwrap();
        assert!(!empty.path().join("look.toml").exists());
    }

    #[test]
    fn a_file_of_only_comments_keeps_them_first() {
        let config = tempfile::tempdir().unwrap();
        set(config.path(), "agents.toml", "enter", "queue").unwrap();
        let text = std::fs::read_to_string(config.path().join("agents.toml")).unwrap();
        assert!(text.starts_with("#:schema "), "{text}");
        assert!(
            text.ends_with("# enter = \"steer\"\nenter = \"queue\"\n"),
            "{text}"
        );
        let look = config.path().join("look.toml");
        std::fs::write(&look, "#:schema ./schemas/look.schema.json\n# Mine.\n").unwrap();
        set(config.path(), "look.toml", "tile.border", "3").unwrap();
        let text = std::fs::read_to_string(&look).unwrap();
        assert_eq!(
            text,
            "#:schema ./schemas/look.schema.json\n# Mine.\n[tile]\nborder = 3\n"
        );
    }

    #[test]
    fn a_harness_is_named_by_its_id() {
        let config = tempfile::tempdir().unwrap();
        let read = || std::fs::read_to_string(config.path().join("harnesses.toml")).unwrap();
        set(
            config.path(),
            "harnesses.toml",
            "harness.codex.enabled",
            "false",
        )
        .unwrap();
        let text = read();
        assert!(
            text.contains("id = \"claude\""),
            "the template keeps the rest: {text}"
        );
        let codex = text.find("id = \"codex\"").unwrap();
        assert!(text[codex..].contains("enabled = false"), "{text}");
        assert!(!text[..codex].contains("enabled"), "{text}");

        let refused = set(
            config.path(),
            "harnesses.toml",
            "harness.gemini.command",
            "gemini",
        );
        assert!(
            refused.unwrap_err()[0].message.contains("name"),
            "an entry needs its name"
        );
        set(
            config.path(),
            "harnesses.toml",
            "harness.gemini",
            r#"{ name = "Gemini CLI", command = "gemini", args = ["--acp"] }"#,
        )
        .unwrap();
        let text = read();
        assert!(
            text.ends_with("[[harness]]\nid = \"gemini\"\nname = \"Gemini CLI\"\ncommand = \"gemini\"\nargs = [\"--acp\"]\n"),
            "{text}"
        );
        set(
            config.path(),
            "harnesses.toml",
            "harness.gemini.env.KEY",
            "secret",
        )
        .unwrap();
        assert!(
            read().contains("[harness.env]\nKEY = \"secret\""),
            "{}",
            read()
        );

        reset(config.path(), "harnesses.toml", "harness.gemini").unwrap();
        reset(config.path(), "harnesses.toml", "harness.nobody").unwrap();
        assert!(!read().contains("gemini"), "{}", read());
        reset(config.path(), "harnesses.toml", "harness.codex.enabled").unwrap();
        assert!(!read().contains("enabled"), "{}", read());
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_file_stays_linked() {
        let config = tempfile::tempdir().unwrap();
        let dotfiles = tempfile::tempdir().unwrap();
        let real = dotfiles.path().join("look.toml");
        std::fs::write(&real, "radius = 4\n").unwrap();
        let link = config.path().join("look.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        set(config.path(), "look.toml", "radius", "6").unwrap();
        assert!(link.is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "radius = 6\n");
    }
}
