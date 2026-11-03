//! The Banda skill (ADR 0011): what an Agent needs to know to work in
//! Banda and to change it for its Person.
//!
//! It has two parts, as skills have:
//! - **the core**, `SKILL.md` in this crate: Banda's words, how to change
//!   it safely and where things live. It is short and always read first.
//! - **topics**, read when needed. Each part of Banda writes its own, in a
//!   `skill/` folder beside its code (`look/skill/sidebar.md`), and may
//!   include the files it ships, so a topic never drifts from the code.
//!   This crate gathers them when it is built; a new part of Banda adds a
//!   topic and changes nothing here.
//!
//! The same text reaches an Agent in several ways: `banda skill` prints
//! it, `banda skill --export` writes it as an Agent Skills folder, and
//! `banda mcp` gives a brief as its instructions, which a client keeps
//! only the start of, and the core and each topic through its `skill`
//! tool (ADR 0019, ADR 0037).

use std::fmt::Write as _;
use std::path::Path;

/// One topic: a page of the skill an Agent reads when it needs it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Topic {
    /// One word, the page's file name: `sidebar`.
    pub name: &'static str,
    /// One line that says when to read it.
    pub description: &'static str,
    /// The page, without its front matter.
    pub body: &'static str,
    /// Where the page is written, from the repository's top.
    pub source: &'static str,
}

/// How an Agent reaches a topic from the core.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    /// It runs `banda skill <topic>`.
    Command,
    /// It reads `references/<topic>.md` beside `SKILL.md`.
    Files,
    /// It calls the `skill` tool of `banda mcp` with the topic.
    Tool,
}

const CORE: &str = include_str!("../SKILL.md");
const BRIEF: &str = include_str!("../BRIEF.md");
const PAGES: &[(&str, &str)] = include!(concat!(env!("OUT_DIR"), "/topics.rs"));

/// Every topic, by name.
pub fn topics() -> Vec<Topic> {
    let mut topics: Vec<Topic> = PAGES
        .iter()
        .map(|(source, text)| page(source, text))
        .collect();
    topics.sort_by_key(|topic| topic.name);
    topics
}

/// The topic `name`, if there is one.
pub fn topic(name: &str) -> Option<Topic> {
    topics().into_iter().find(|topic| topic.name == name)
}

/// The core, with every topic listed at its end and how to reach it.
pub fn core(reach: Reach) -> String {
    let mut text = CORE.trim_end().to_owned();
    text.push_str("\n\n## Topics\n\n");
    text.push_str(&list(reach));
    text
}

/// What `banda mcp` says as its `instructions`, which a client keeps only
/// the start of (Claude Code, 4,096 characters): what Banda is, the rules
/// an Agent needs before it would ask, as when to show a Visual, and the
/// `skill` tool for the rest.
pub fn brief() -> &'static str {
    BRIEF
}

/// A topic's page, or with no topic the core; or, for a topic there is
/// not, words that say so and list the topics there are.
pub fn read(name: Option<&str>, reach: Reach) -> Result<String, String> {
    match name {
        None => Ok(core(reach)),
        Some(name) => topic(name)
            .map(|topic| topic.body.to_owned())
            .ok_or_else(|| format!("There is no topic \"{name}\".\n\n{}", list(reach))),
    }
}

/// How to reach a topic, then every topic with when to read it.
fn list(reach: Reach) -> String {
    let mut text = match reach {
        Reach::Command => "Read one with `banda skill <topic>`.\n\n",
        Reach::Files => "Each is a file in `references/`.\n\n",
        Reach::Tool => "Read one with the `skill` tool: `{\"topic\": \"<topic>\"}`.\n\n",
    }
    .to_owned();
    for topic in topics() {
        let name = match reach {
            Reach::Command | Reach::Tool => format!("`{}`", topic.name),
            Reach::Files => format!("[{0}](references/{0}.md)", topic.name),
        };
        writeln!(text, "- {name}: {}", topic.description).unwrap();
    }
    text
}

/// Writes the skill into `folder` as an Agent Skills folder: `SKILL.md`
/// and `references/<topic>.md`, so a Person can give it to any Harness.
pub fn export(folder: &Path) -> std::io::Result<()> {
    let references = folder.join("references");
    std::fs::create_dir_all(&references)?;
    std::fs::write(folder.join("SKILL.md"), core(Reach::Files))?;
    for topic in topics() {
        std::fs::write(references.join(format!("{}.md", topic.name)), topic.body)?;
    }
    Ok(())
}

/// The front matter's `name` and `description`, and the page under it.
fn page(source: &'static str, text: &'static str) -> Topic {
    let wrong = |what: &str| -> ! { panic!("{source}: {what}") };
    let rest = text
        .strip_prefix("---\n")
        .unwrap_or_else(|| wrong("a topic starts with front matter, ---"));
    let (head, body) = rest
        .split_once("\n---\n")
        .unwrap_or_else(|| wrong("its front matter ends with ---"));
    let field = |key: &str| {
        head.lines()
            .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))
            .map(str::trim)
            .unwrap_or_else(|| wrong(&format!("its front matter needs {key}")))
    };
    Topic {
        name: field("name"),
        description: field("description"),
        body: body.trim_start_matches('\n'),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_topic_is_named_as_its_file_and_says_when_to_read_it() {
        let topics = topics();
        assert!(!topics.is_empty());
        for topic in &topics {
            let file = Path::new(topic.source).file_stem().unwrap();
            assert_eq!(file, topic.name, "{}", topic.source);
            assert!(
                topic
                    .name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c == '-'),
                "{}",
                topic.name
            );
            assert!(
                !topic.description.is_empty() && topic.description.len() <= 200,
                "{}: a description is one line of at most 200 bytes",
                topic.source
            );
            assert!(
                !topic.body.contains("<!-- include"),
                "{}: an include was left",
                topic.source
            );
        }
        let mut names: Vec<_> = topics.iter().map(|t| t.name).collect();
        names.dedup();
        assert_eq!(names.len(), topics.len(), "two topics share a name");
    }

    #[test]
    fn the_core_lists_every_topic() {
        let text = core(Reach::Command);
        assert!(text.starts_with("---\nname: banda\n"));
        for topic in topics() {
            assert!(text.contains(&format!("- `{}`: ", topic.name)));
        }
        assert!(core(Reach::Files).contains("(references/sidebar.md)"));
        assert!(core(Reach::Tool).contains("the `skill` tool"));
        assert_eq!(read(None, Reach::Tool), Ok(core(Reach::Tool)));
        assert_eq!(
            read(Some("look"), Reach::Command),
            Ok(topic("look").unwrap().body.into())
        );
        let none = read(Some("nope"), Reach::Command).unwrap_err();
        assert!(none.starts_with("There is no topic \"nope\".\n\nRead one with `banda skill"));
        assert!(none.contains("- `sidebar`: "));
    }

    #[test]
    fn the_brief_fits_what_a_client_keeps_and_names_the_skill() {
        // Claude Code keeps 4,096 characters of a server's instructions,
        // its own heading over them included.
        assert!(brief().chars().count() <= 4_000);
        // Its rules are the core's, word for word.
        let rules = brief()
            .split("\n## ")
            .skip(1)
            .filter(|part| !part.starts_with("The Banda skill"));
        for rule in rules {
            assert!(CORE.contains(rule), "the core lacks: {rule}");
        }
    }

    #[test]
    fn a_topic_shows_the_files_banda_ships() {
        let sidebar = topic("sidebar").unwrap().body;
        assert!(sidebar.contains(
            "```toml\n#:schema ./schemas/sidebar.schema.json\n# How Banda's sidebar arranges"
        ));
        let look = topic("look").unwrap().body;
        assert!(look.contains("```toml\n#:schema ./schemas/look.schema.json\n# How Banda looks."));
    }

    #[test]
    fn export_writes_an_agent_skills_folder() {
        let dir = tempfile::tempdir().unwrap();
        export(dir.path()).unwrap();
        let skill = std::fs::read_to_string(dir.path().join("SKILL.md")).unwrap();
        assert!(skill.starts_with("---\nname: banda\ndescription: "));
        for topic in topics() {
            let page = dir.path().join(format!("references/{}.md", topic.name));
            assert_eq!(std::fs::read_to_string(page).unwrap(), topic.body);
        }
    }
}
