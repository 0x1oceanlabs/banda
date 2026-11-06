//! Reading a pull request out of words: the Person's URL or `#42`, and an
//! Agent's shell call that made one with `gh pr create`, as T3 Code reads
//! it (ADR 0076, decision 1).

use crate::model::PullRef;

/// A pull request's URL, `https://github.com/owner/name/pull/595`, with
/// anything after its number.
pub fn parse_url(text: &str) -> Option<PullRef> {
    let rest = text.trim().strip_prefix("https://")?;
    let mut parts = rest.split('/');
    let host = parts.next()?;
    let owner = parts.next()?;
    let name = parts.next()?;
    if parts.next()? != "pull" {
        return None;
    }
    let digits: String = parts
        .next()?
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    let number = digits.parse().ok().filter(|n| *n > 0)?;
    let named = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !named(host) || !named(owner) || !named(name) {
        return None;
    }
    Some(PullRef {
        host: host.to_ascii_lowercase(),
        repo: format!("{owner}/{name}"),
        number,
    })
}

/// `#42` or `42`: a number in the Project's own repository.
pub fn parse_number(text: &str) -> Option<u32> {
    let text = text.trim();
    let digits = text.strip_prefix('#').unwrap_or(text);
    digits.parse().ok().filter(|n| *n > 0)
}

/// The first pull request's URL that `output` prints.
pub fn find_url(output: &str) -> Option<PullRef> {
    output
        .split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '(' | ')'))
        .find_map(parse_url)
}

/// Whether `command` runs `gh pr create`: one of its commands, run as it
/// is or through `sh -c`, not words in a quote, a comment or a heredoc.
pub fn creates_pull(command: &str) -> bool {
    let command = command.trim().trim_matches('`');
    commands(&unwrap_shell(command))
        .iter()
        .any(|words| is_create(words))
}

/// What `sh -lc '…'` and `bash -c "…"` run, or the command as it is.
fn unwrap_shell(command: &str) -> String {
    let words = split(command);
    let shell = |w: &str| {
        let name = w.rsplit('/').next().unwrap_or(w);
        matches!(name, "sh" | "bash" | "zsh" | "dash")
    };
    if let Some(first) = words.first()
        && shell(first)
    {
        let mut rest = words.iter().skip(1);
        while let Some(word) = rest.next() {
            if word.starts_with('-')
                && word.contains('c')
                && let Some(script) = rest.next()
            {
                return script.clone();
            }
        }
    }
    command.to_owned()
}

/// The words of each command `script` runs, split at `&&`, `||`, `;`,
/// `|` and line ends outside quotes, a heredoc's body left out.
fn commands(script: &str) -> Vec<Vec<String>> {
    let mut lines = script.lines();
    let mut joined = String::new();
    while let Some(line) = lines.next() {
        joined.push_str(line);
        joined.push('\n');
        // A heredoc's body is text, not commands.
        if let Some(at) = line.find("<<") {
            let tag: String = line[at + 2..]
                .trim_start_matches('-')
                .trim()
                .trim_matches(|c| c == '\'' || c == '"')
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !tag.is_empty() {
                for body in lines.by_ref() {
                    if body.trim() == tag || body.trim_start().starts_with(&format!("{tag})")) {
                        break;
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut chars = joined.chars().peekable();
    let end_word = |word: &mut String, words: &mut Vec<String>| {
        if !word.is_empty() {
            words.push(std::mem::take(word));
        }
    };
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '\'' | '"') => quote = Some(c),
            (None, '#') if word.is_empty() => {
                // A comment, to the line's end.
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
                end_word(&mut word, &mut words);
                out.push(std::mem::take(&mut words));
            }
            (None, ';' | '\n' | '|' | '&') => {
                end_word(&mut word, &mut words);
                out.push(std::mem::take(&mut words));
                if matches!(c, '|' | '&') && chars.peek() == Some(&c) {
                    chars.next();
                }
            }
            (None, c) if c.is_whitespace() => end_word(&mut word, &mut words),
            (None, c) => word.push(c),
        }
    }
    end_word(&mut word, &mut words);
    out.push(words);
    out.retain(|words| !words.is_empty());
    out
}

/// Whether one command's words are `gh pr create`, after any `VAR=value`,
/// `env`, `command` or `exec`.
fn is_create(words: &[String]) -> bool {
    let mut words = words.iter().map(String::as_str).peekable();
    while let Some(&word) = words.peek() {
        let assigns = word.contains('=') && !word.starts_with('-');
        if assigns || matches!(word, "env" | "command" | "exec" | "time") {
            words.next();
        } else {
            break;
        }
    }
    let gh = words
        .next()
        .is_some_and(|w| w.rsplit('/').next() == Some("gh"));
    gh && words.next() == Some("pr") && words.next() == Some("create")
}

/// Splits `text` into words as a shell would, quotes kept apart.
fn split(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in text.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started || !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                started = false;
            }
            (None, c) => word.push(c),
        }
    }
    if started || !word.is_empty() {
        words.push(word);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_pull_request_s_url_and_number() {
        let pull = parse_url("https://github.com/0x1oceanlabs/banda/pull/595/files").unwrap();
        assert_eq!(pull.host, "github.com");
        assert_eq!(pull.repo, "0x1oceanlabs/banda");
        assert_eq!(pull.number, 595);
        assert_eq!(pull.url(), "https://github.com/0x1oceanlabs/banda/pull/595");
        assert!(parse_url("https://github.com/a/b/issues/3").is_none());
        assert!(parse_url("http://github.com/a/b/pull/3").is_none());
        assert!(parse_url("https://github.com/a/b\"){x}/pull/3").is_none());
        assert_eq!(parse_number("#42"), Some(42));
        assert_eq!(parse_number(" 7 "), Some(7));
        assert_eq!(parse_number("#0"), None);
        assert_eq!(parse_number("#x"), None);
    }

    #[test]
    fn finds_the_url_gh_prints() {
        let printed =
            "Creating pull request for feat/a into main in o/r\n\nhttps://github.com/o/r/pull/12\n";
        assert_eq!(find_url(printed).unwrap().number, 12);
        assert!(find_url("no pull request here").is_none());
    }

    #[test]
    fn knows_a_call_that_creates_a_pull_request() {
        for command in [
            "gh pr create --fill",
            "`gh pr create --draft --title x`",
            "git push -u origin HEAD && gh pr create --title 'a; b' --body \"c && d\"",
            "bash -lc 'cd /x && GH_HOST=github.com gh pr create --fill'",
            "/usr/bin/gh pr create",
            "gh pr create --title t --body \"$(cat <<'EOF'\nSummary\nEOF\n)\"",
        ] {
            assert!(creates_pull(command), "{command}");
        }
        for command in [
            "gh pr view 12",
            "gh pr list",
            "gh pr status",
            "gh api repos/o/r/pulls",
            "echo 'gh pr create'",
            "# gh pr create\ngit status",
            "cat <<EOF\ngh pr create\nEOF",
            "gh pr checks 12",
        ] {
            assert!(!creates_pull(command), "{command}");
        }
    }
}
