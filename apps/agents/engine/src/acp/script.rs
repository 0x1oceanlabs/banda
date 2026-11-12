//! A Workflow's script, as Claude's Workflow call carries it: its
//! `export const meta = {…}`, a JavaScript object literal, read into what
//! the Question to start a Crew shows (ADR 0103, decision 30).
//!
//! A small reader of literals, not of JavaScript: objects, arrays,
//! strings in any of the three quotes, numbers, `true`, `false`, `null`,
//! unquoted keys, trailing commas and comments. Anything else, such as a
//! name or a call, makes `meta` unreadable, and the Question shows what
//! Claude says without it.

use crate::model::{CrewStart, Phase};
use serde_json::{Map, Value};

/// How a script names its `meta`.
const META: &str = "export const meta";

/// What the script's `meta` says of the Crew it starts: its name, its
/// description and its phases. None when it has none Banda can read, or
/// no name.
pub fn start(script: &str) -> Option<CrewStart> {
    let meta = meta(script)?;
    let title = string(&meta, "name").or_else(|| string(&meta, "title"))?;
    let phases = meta.get("phases").and_then(Value::as_array);
    let phases = phases
        .into_iter()
        .flatten()
        .filter_map(|phase| match phase {
            Value::String(title) => Some((title.trim().to_owned(), None)),
            Value::Object(_) => Some((
                string(phase, "title").or_else(|| string(phase, "name"))?,
                string(phase, "detail").or_else(|| string(phase, "description")),
            )),
            _ => None,
        });
    let phases = phases
        .filter(|(title, _)| !title.is_empty())
        .enumerate()
        .map(|(at, (title, detail))| Phase {
            index: u16::try_from(at + 1).unwrap_or(u16::MAX),
            title,
            detail,
        })
        .collect();
    Some(CrewStart {
        title,
        description: string(&meta, "description"),
        phases,
        script: script.to_owned(),
    })
}

fn string(value: &Value, key: &str) -> Option<String> {
    let said = value.get(key)?.as_str()?.trim();
    (!said.is_empty()).then(|| said.to_owned())
}

/// The script's `meta`, as a value.
fn meta(script: &str) -> Option<Value> {
    let after = &script[script.find(META)? + META.len()..];
    let mut reader = Reader::new(after);
    reader.blank();
    // A type, as `meta: Meta = {…}`, is not read.
    if !reader.eat('=') {
        return None;
    }
    let value = reader.value(0)?;
    value.is_object().then_some(value)
}

/// How deep a literal may nest.
const DEEPEST: usize = 32;

struct Reader<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> Reader<'a> {
    fn new(text: &'a str) -> Reader<'a> {
        Reader {
            chars: text.chars().peekable(),
        }
    }

    /// Passes white space and comments.
    fn blank(&mut self) {
        loop {
            match self.chars.peek() {
                Some(c) if c.is_whitespace() => {
                    self.chars.next();
                }
                Some('/') => {
                    let mut ahead = self.chars.clone();
                    ahead.next();
                    match ahead.next() {
                        Some('/') => {
                            for c in self.chars.by_ref() {
                                if c == '\n' {
                                    break;
                                }
                            }
                        }
                        Some('*') => {
                            self.chars.next();
                            self.chars.next();
                            let mut last = ' ';
                            for c in self.chars.by_ref() {
                                if last == '*' && c == '/' {
                                    break;
                                }
                                last = c;
                            }
                        }
                        _ => return,
                    }
                }
                _ => return,
            }
        }
    }

    fn eat(&mut self, wanted: char) -> bool {
        self.blank();
        if self.chars.peek() == Some(&wanted) {
            self.chars.next();
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        if depth > DEEPEST {
            return None;
        }
        self.blank();
        match *self.chars.peek()? {
            '{' => self.object(depth),
            '[' => self.array(depth),
            '"' | '\'' | '`' => self.string().map(Value::String),
            c if c == '-' || c == '.' || c.is_ascii_digit() => self.number(),
            _ => match self.word()?.as_str() {
                "true" => Some(Value::Bool(true)),
                "false" => Some(Value::Bool(false)),
                "null" | "undefined" => Some(Value::Null),
                _ => None,
            },
        }
    }

    fn object(&mut self, depth: usize) -> Option<Value> {
        self.chars.next();
        let mut fields = Map::new();
        loop {
            if self.eat('}') {
                return Some(Value::Object(fields));
            }
            self.blank();
            let key = match self.chars.peek()? {
                '"' | '\'' | '`' => self.string()?,
                _ => self.word()?,
            };
            if !self.eat(':') {
                return None;
            }
            fields.insert(key, self.value(depth + 1)?);
            if !self.eat(',') {
                return self.eat('}').then_some(Value::Object(fields));
            }
        }
    }

    fn array(&mut self, depth: usize) -> Option<Value> {
        self.chars.next();
        let mut items = Vec::new();
        loop {
            if self.eat(']') {
                return Some(Value::Array(items));
            }
            items.push(self.value(depth + 1)?);
            if !self.eat(',') {
                return self.eat(']').then_some(Value::Array(items));
            }
        }
    }

    /// A string in its quotes. A template's `${…}` is code, so unreadable.
    fn string(&mut self) -> Option<String> {
        let quote = self.chars.next()?;
        let mut said = String::new();
        loop {
            match self.chars.next()? {
                c if c == quote => return Some(said),
                '$' if quote == '`' && self.chars.peek() == Some(&'{') => return None,
                '\\' => match self.chars.next()? {
                    'n' => said.push('\n'),
                    't' => said.push('\t'),
                    'r' => said.push('\r'),
                    '\n' => {}
                    other => said.push(other),
                },
                c => said.push(c),
            }
        }
    }

    fn number(&mut self) -> Option<Value> {
        let mut said = String::new();
        while let Some(&c) = self.chars.peek() {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_') {
                said.push(c);
                self.chars.next();
            } else {
                break;
            }
        }
        let said = said.replace('_', "");
        if let Ok(whole) = said.parse::<i64>() {
            return Some(Value::from(whole));
        }
        said.parse::<f64>().ok().map(Value::from)
    }

    /// A name: an unquoted key, or a word as `true`.
    fn word(&mut self) -> Option<String> {
        let mut said = String::new();
        while let Some(&c) = self.chars.peek() {
            if c.is_alphanumeric() || c == '_' || c == '$' {
                said.push(c);
                self.chars.next();
            } else {
                break;
            }
        }
        (!said.is_empty()).then_some(said)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scripts_meta_names_its_crew_and_phases() {
        let script = "export const meta = { name: 'read-two', description: 'Read two small \
                      files', phases: [ { title: 'Read', detail: 'read a.txt' }, { title: \
                      'Check', detail: 'cat b.txt' } ] }\nphase('Read')\nreturn 1";
        let start = start(script).unwrap();
        assert_eq!(start.title, "read-two");
        assert_eq!(start.description.as_deref(), Some("Read two small files"));
        let phases: Vec<_> = (start.phases.iter())
            .map(|p| (p.index, p.title.as_str(), p.detail.as_deref()))
            .collect();
        assert_eq!(
            phases,
            [
                (1, "Read", Some("read a.txt")),
                (2, "Check", Some("cat b.txt"))
            ]
        );
        assert_eq!(start.script, script);
    }

    #[test]
    fn it_reads_quotes_comments_trailing_commas_and_phases_as_words() {
        let script = r#"// audit
export const meta = {
  "name": `audit-routes`, // the name
  /* a description
     over lines */
  description: "Find \"dead\" routes",
  phases: ['Scan', "Fix", { title: 'Verify', },],
  limit: 1_000, ratio: -0.5, on: true, off: null,
}
"#;
        let start = start(script).unwrap();
        assert_eq!(start.title, "audit-routes");
        assert_eq!(start.description.as_deref(), Some("Find \"dead\" routes"));
        let titles: Vec<_> = start.phases.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, ["Scan", "Fix", "Verify"]);
        assert_eq!(start.phases[2].index, 3);
    }

    #[test]
    fn code_or_no_name_reads_as_no_meta() {
        assert_eq!(start("phase('Read')"), None, "no meta");
        assert_eq!(
            start("export const meta = { description: 'x' }"),
            None,
            "no name"
        );
        assert_eq!(start("export const meta = { name: NAME }"), None, "a name");
        assert_eq!(
            start("export const meta = { name: `a-${b}` }"),
            None,
            "a template"
        );
        assert_eq!(start("export const meta = { name: 'a'"), None, "cut short");
        let deep = format!(
            "export const meta = {{ name: 'a', x: {}1{} }}",
            "[".repeat(40),
            "]".repeat(40)
        );
        assert_eq!(start(&deep), None, "too deep");
    }
}
