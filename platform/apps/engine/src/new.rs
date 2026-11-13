//! `banda app new`: a folder to start an App from (ADR 0126, decision 5).
//! It is whole and small: one table, one command that writes it and one
//! call that reads it, each said in words, so it installs as it is and its
//! author changes it into their own.

use crate::folder::{MANIFEST, METHODS, MIGRATIONS, is_id};
use banda_kernel::Refusal;
use std::path::Path;

const WORKER: &str = r#"// __NAME__'s code. Banda calls each method of methods.json with its params
// and what the call gives:
//
//   read(sql, params)      rows of this App's own tables, in the call's Project
//   refuse(code, message)  a refusal to throw: "invalid", "not_found", "forbidden", "conflict"
//   by                     who calls: a Person or an Agent
//   project                the Project it calls in: { id, folder }
//
// A method answers { answer, write, emit }. Banda does the writing: `write`
// is statements on this App's tables (`__ID___…`), `emit` its events, and
// a command's are kept in one transaction, once. A call writes nothing.
// What a Person reads and edits themselves, write as files in
// project.folder; what the App keeps for itself, in its tables. One
// process serves every Project and caller, its calls side by side: keep
// nothing in the module that is one Project's.

export const methods = {
  async add({ text }, { refuse }) {
    if (!text.trim()) throw refuse("invalid", "The text is empty.")
    return {
      answer: { text },
      write: [
        { sql: "INSERT INTO __ID___items (text, at) VALUES (?, ?)", params: [text, Date.now()] },
      ],
      emit: [{ kind: "added", payload: { text } }],
    }
  },

  async list(_, { read }) {
    return { answer: await read("SELECT id, text, at FROM __ID___items ORDER BY id") }
  },
}
"#;

const METHODS_JSON: &str = r#"{
  "add": {
    "kind": "command",
    "about": "Adds an item: say here in words what it does, for an Agent reads this to know when to call it.",
    "params": {
      "type": "object",
      "properties": { "text": { "type": "string", "description": "What to keep." } },
      "required": ["text"]
    }
  },
  "list": {
    "kind": "call",
    "about": "Every item kept, the oldest first."
  }
}
"#;

/// Writes a new App named `id` in `folder`, which is not there yet.
pub fn write(folder: &Path, id: &str) -> Result<(), Refusal> {
    if !is_id(id) {
        return Err(Refusal::invalid(format!(
            "{id:?} cannot be an App's id: it is lowercase letters that Banda does not keep for itself, as \"clients\"."
        )));
    }
    if folder.exists() {
        return Err(Refusal::conflict(format!(
            "{} is there already.",
            folder.display()
        )));
    }
    let name = format!("{}{}", id[..1].to_uppercase(), &id[1..]);
    let manifest = format!(
        "# What this App is, as Banda reads it. Its methods are in {METHODS}, its\n\
         # tables in {MIGRATIONS}/, one step a file, and its code in the entry.\n\
         id = \"{id}\"\nname = \"{name}\"\n\
         about = \"What it is for, in a sentence.\"\n\
         version = \"0.1.0\"\napi = 1\nentry = \"worker.mjs\"\n"
    );
    let step = format!(
        "-- This App's tables are named {id}_…: Banda refuses it any other. A step\n\
         -- that ran never runs again: change a table in a new step, 002.sql.\n\
         CREATE TABLE {id}_items (\n  id INTEGER PRIMARY KEY,\n  text TEXT NOT NULL,\n  at INTEGER NOT NULL\n);\n"
    );
    let worker = WORKER.replace("__NAME__", &name).replace("__ID__", id);
    let files = [
        (MANIFEST.to_owned(), manifest),
        (METHODS.to_owned(), METHODS_JSON.to_owned()),
        (format!("{MIGRATIONS}/001.sql"), step),
        ("worker.mjs".to_owned(), worker),
    ];
    let wrote = || -> std::io::Result<()> {
        std::fs::create_dir_all(folder.join(MIGRATIONS))?;
        files
            .iter()
            .try_for_each(|(file, text)| std::fs::write(folder.join(file), text))
    };
    wrote().map_err(|error| {
        Refusal::invalid(format!(
            "{} could not be written: {error}.",
            folder.display()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder::Folder;
    use banda_kernel::Code;

    #[test]
    fn a_new_app_reads_as_it_is_written_and_is_written_once() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("habits");
        write(&folder, "habits").unwrap();
        let app = Folder::read(&folder).unwrap();
        assert_eq!((&*app.id, &*app.name), ("habits", "Habits"));
        let tools: Vec<_> = app.tools().into_iter().map(|tool| tool.name).collect();
        assert_eq!(tools, ["habits_add", "habits_list"]);
        assert!(app.migrations[0].contains("CREATE TABLE habits_items"));
        let worker = std::fs::read_to_string(folder.join("worker.mjs")).unwrap();
        assert!(worker.contains("INSERT INTO habits_items"), "{worker}");
        assert!(!worker.contains("__"), "{worker}");

        assert_eq!(write(&folder, "habits").unwrap_err().code, Code::Conflict);
        let other = dir.path().join("other");
        assert_eq!(write(&other, "My App").unwrap_err().code, Code::Invalid);
        assert_eq!(write(&other, "kernel").unwrap_err().code, Code::Invalid);
    }
}
