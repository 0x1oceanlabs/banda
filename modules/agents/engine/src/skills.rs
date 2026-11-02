//! Claude Code's skills (issue #149). Claude Code says each of its skills
//! as a slash command, with nothing to tell it from a command, so a slash
//! command is a skill when its `SKILL.md` is where claude-agent-acp looks
//! for one, as it does for a JetBrains AIR client. A skill named anywhere
//! in a message with `$` runs as Claude Code runs it: `/name` starting the
//! message's last text block, as T3 Code sends it.

use std::path::{Path, PathBuf};

/// The folders, under a project's or the home folder, that hold skills.
const CONTAINERS: [&str; 2] = [".claude/skills", ".agents/skills"];

/// The `SKILL.md` of the command `name`, in the project at `folder` or in
/// `home`: `<scope>:<name>` in a folder of the project, or in a plugin.
pub fn file(name: &str, folder: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    let (scope, name) = match name.split_once(':') {
        Some((scope, name)) => (Some(scope), name),
        None => (None, name),
    };
    let safe = |part: &str| !part.is_empty() && part != ".." && !part.contains(['/', '\\']);
    if !safe(name) || scope.is_some_and(|scope| !safe(scope)) {
        return None;
    }
    let bases: Vec<&Path> = folder.into_iter().chain(home).collect();
    let mut containers = Vec::new();
    if let Some(scope) = scope {
        for base in &bases {
            containers.extend(CONTAINERS.map(|c| base.join(scope).join(c)));
            let plugins = base.join(".claude/plugins");
            containers.push(plugins.join(scope).join("skills"));
            // An installed plugin lives under the marketplace it came from.
            let mut markets: Vec<PathBuf> = std::fs::read_dir(plugins.join("marketplaces"))
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .collect();
            markets.sort();
            containers.extend(
                markets
                    .iter()
                    .map(|m| m.join("plugins").join(scope).join("skills")),
            );
        }
    }
    for base in &bases {
        containers.extend(CONTAINERS.map(|c| base.join(c)));
    }
    containers
        .into_iter()
        .map(|container| container.join(name).join("SKILL.md"))
        .find(|file| file.is_file())
}

/// A message for Claude Code with the skills it names with `$`, of those
/// in `skills`: its text with each as `/name`, then `/name` of the last
/// and what follows it, which Claude Code runs as that skill. Its text is
/// empty when the skill starts it. None when it names none.
pub fn dispatch(text: &str, skills: &[String]) -> Option<(String, String)> {
    let named = mentions(text, skills);
    let &last = named.last()?;
    let mut slashed = text.to_owned();
    for &at in &named {
        slashed.replace_range(at..=at, "/");
    }
    let lead = match text[..last].trim().is_empty() {
        true => String::new(),
        false => slashed.trim_end().to_owned(),
    };
    Some((lead, slashed[last..].trim_end().to_owned()))
}

/// Where the `$` of each `$name` of `skills` is in `text`, as the composer
/// reads one: at a word's start, ending the word but for punctuation after
/// it.
fn mentions(text: &str, skills: &[String]) -> Vec<usize> {
    const AFTER: &str = ".,;:!?)]*~`";
    let mut found = Vec::new();
    for (at, _) in text.match_indices('$') {
        if text[..at]
            .chars()
            .next_back()
            .is_some_and(|c| !c.is_whitespace())
        {
            continue;
        }
        let rest = &text[at + 1..];
        let word = rest
            .find(char::is_whitespace)
            .map_or(rest, |end| &rest[..end]);
        // A name may end in `:`, as `$review:`, or be followed by one.
        let kept = word.trim_end_matches(|c: char| c != ':' && AFTER.contains(c));
        let bare = word.trim_end_matches(|c| AFTER.contains(c));
        if [kept, bare]
            .iter()
            .any(|name| skills.iter().any(|s| s == name))
        {
            found.push(at);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_named_anywhere_runs_as_the_last_text_starting_with_it() {
        let skills = ["review".to_owned(), "explain".to_owned()];
        assert_eq!(
            dispatch("$review the parser", &skills),
            Some((String::new(), "/review the parser".to_owned()))
        );
        assert_eq!(
            dispatch("look at this, then $review it.", &skills),
            Some((
                "look at this, then /review it.".to_owned(),
                "/review it.".to_owned()
            ))
        );
        // Only the last runs as itself; the others are named.
        assert_eq!(
            dispatch("$explain first, then $review:", &skills),
            Some((
                "/explain first, then /review:".to_owned(),
                "/review:".to_owned()
            ))
        );
    }

    #[test]
    fn only_a_known_skill_starting_a_word_is_one() {
        let skills = ["review".to_owned()];
        assert_eq!(dispatch("it costs $5", &skills), None);
        assert_eq!(dispatch("a$review", &skills), None);
        assert_eq!(dispatch("$reviews", &skills), None);
        assert_eq!(dispatch("plain text", &skills), None);
    }

    #[test]
    fn a_skill_is_found_by_its_skill_file() {
        let root = tempfile::tempdir().unwrap();
        let (folder, home) = (root.path().join("work"), root.path().join("home"));
        let put = |file: PathBuf| {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, "---\nname: x\n---\n").unwrap();
            file
        };
        let project = put(folder.join(".claude/skills/review/SKILL.md"));
        let mine = put(home.join(".agents/skills/notes/SKILL.md"));
        let plugin =
            put(home.join(".claude/plugins/marketplaces/m/plugins/kit/skills/lint/SKILL.md"));
        let find = |name| file(name, Some(&folder), Some(&home));
        assert_eq!(find("review"), Some(project));
        assert_eq!(find("notes"), Some(mine));
        assert_eq!(find("kit:lint"), Some(plugin));
        assert_eq!(find("compact"), None, "a command of its own has none");
        assert_eq!(find("../review"), None);
    }
}
