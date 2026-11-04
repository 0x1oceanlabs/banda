//! A commit's message a Harness writes (ADR 0034, decision 3), as T3
//! Code's text model writes one
//! (`docs/research/2026-11-02-t3-code-git-backend.md`, section 4):
//! `prompt` says what the commit would take, the work tree against
//! `HEAD` as the Diff reads it, with the branch and the repository's last
//! subjects for its style; `written` reads the Harness's reply into a
//! message and, when asked, a new branch's name.

use crate::diff::diff;
use crate::model::{DiffAsk, FileDiff, Message, PromptAsk, Prompted, Scope, WrittenAsk};
use crate::repo::{Repo, chosen, in_way};
use banda_kernel::Refusal;
use serde::Deserialize;

/// The most of the files' list and of the patch a prompt holds, in bytes.
const FILES: usize = 6_000;
const PATCH: usize = 40_000;
/// How many of the last subjects show the repository's style.
const SUBJECTS: &str = "20";
/// The longest subject kept, in characters, and the one used when the
/// reply has none.
const SUBJECT: usize = 72;
const NO_SUBJECT: &str = "Update project files";
/// The longest branch name made, and the prefix of one with no folder.
const BRANCH: usize = 64;
const PREFIX: &str = "feature/";

/// The prompt for the commit that `ask` would make.
pub async fn prompt(repo: &Repo, ask: PromptAsk) -> Result<Prompted, Refusal> {
    chosen(&ask.files)?;
    let asked = DiffAsk {
        scope: Scope::Uncommitted,
        ignore_whitespace: false,
        files: ask.files,
    };
    let (read, branch, subjects) = futures::join!(
        diff(repo, asked, 0),
        repo.branch(),
        repo.verified(["log", "-n", SUBJECTS, "--no-merges", "--format=%s"]),
    );
    let read = read?;
    if read.files.is_empty() {
        return Err(Refusal::conflict(
            "Nothing to commit: those files have no changes.",
        ));
    }
    let files: Vec<String> = read.files.iter().map(listed).collect();
    // A repository with no commits has no subjects yet.
    let subjects = subjects?.unwrap_or_default();
    Ok(Prompted {
        prompt: words(
            &files.join("\n"),
            &read.patch,
            branch?.as_deref(),
            &subjects,
            ask.branch,
        ),
    })
}

/// A file as the prompt lists it: `a.txt (+3 −1)`, `old → new (+0 −0)`.
fn listed(file: &FileDiff) -> String {
    let path = match &file.old_path {
        Some(old) => format!("{old} → {}", file.path),
        None => file.path.clone(),
    };
    match file.binary {
        true => format!("{path} (binary)"),
        false => format!("{path} (+{} −{})", file.added, file.removed),
    }
}

/// The prompt itself, as T3 Code's.
fn words(
    files: &str,
    patch: &str,
    branch: Option<&str>,
    subjects: &str,
    new_branch: bool,
) -> String {
    let mut said = String::from(
        "You write concise git commit messages.\n\
         Return only a JSON object with keys: subject, body",
    );
    if new_branch {
        said.push_str(", branch");
    }
    said.push_str(&format!(
        ".\nRules:\n\
         - subject must be imperative, <= {SUBJECT} chars, and no trailing period\n\
         - body can be empty string or short bullet points\n",
    ));
    if new_branch {
        said.push_str("- branch must be a short semantic git branch fragment for this change\n");
    }
    said.push_str(
        "- capture the primary user-visible or developer-visible change\n\
         - do not run tools or change files: answer from what is below\n",
    );
    if !subjects.is_empty() {
        said.push_str(
            "- follow the repository's established commit message style, as its last subjects show\n\n\
             Last subjects:\n",
        );
        said.push_str(subjects);
        said.push('\n');
    }
    said.push_str(&format!(
        "\nBranch: {}\n\nFiles:\n{}\n\nPatch:\n{}\n",
        branch.unwrap_or("(detached)"),
        cut(files, FILES),
        cut(patch, PATCH),
    ));
    said
}

/// `text` cut at `most` bytes, at a character's start, saying so.
fn cut(text: &str, most: usize) -> String {
    if text.len() <= most {
        return text.trim_end().to_owned();
    }
    format!("{}\n[cut here]", &text[..text.floor_char_boundary(most)])
}

/// What a Harness replies, as the prompt asks it.
#[derive(Deserialize, Default)]
struct Reply {
    #[serde(default)]
    subject: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    branch: Option<String>,
}

/// The message in a Harness's reply, and with `branch` the name of a new
/// branch, one not taken yet.
pub async fn written(repo: &Repo, ask: WrittenAsk) -> Result<Message, Refusal> {
    let reply = read(&ask.reply);
    let subject = subject(&reply.subject);
    let body = reply.body.trim();
    let message = match body.is_empty() {
        true => subject.clone(),
        false => format!("{subject}\n\n{body}"),
    };
    let branch = match ask.branch {
        false => None,
        true => {
            let wanted = reply.branch.as_deref().unwrap_or(&subject);
            Some(free(repo, &branch_name(wanted)).await?)
        }
    };
    Ok(Message { message, branch })
}

/// The JSON object in `reply`, fenced or not; a reply that is no JSON is
/// its subject.
fn read(reply: &str) -> Reply {
    let object = match (reply.find('{'), reply.rfind('}')) {
        (Some(start), Some(end)) if start < end => &reply[start..=end],
        _ => "",
    };
    serde_json::from_str(object).unwrap_or_else(|_| Reply {
        subject: reply.to_owned(),
        ..Reply::default()
    })
}

/// A subject's first line, with no trailing period, at most 72
/// characters.
fn subject(said: &str) -> String {
    let line = said
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let line = line.trim_end_matches('.').trim_end();
    let line: String = line.chars().take(SUBJECT).collect();
    match line.trim_end() {
        "" => NO_SUBJECT.to_owned(),
        line => line.to_owned(),
    }
}

/// A branch name from what a Harness wanted, as [`slug`] makes it, in
/// `feature/` when it names no folder of its own.
fn branch_name(wanted: &str) -> String {
    match slug(wanted) {
        name if name.is_empty() => format!("{PREFIX}update"),
        name if name.contains('/') => name,
        name => format!("{PREFIX}{name}"),
    }
}

/// A name of `wanted` as git takes it: lower case, letters, digits, `/`,
/// `_` and `-` only, each other character a `-`, no `-` nor `/` twice or
/// at an end, at most 64 long; empty when none is left. The branch
/// picker's Create branch makes the same (`branches.ts`), as
/// `branch-names.json` holds both to.
fn slug(wanted: &str) -> String {
    let mut name = String::new();
    for c in wanted.trim().to_lowercase().chars() {
        let c = match c {
            'a'..='z' | '0'..='9' | '/' | '_' | '-' => c,
            _ => '-',
        };
        let doubled = matches!(
            (name.chars().last(), c),
            (Some('-'), '-') | (Some('/'), '/')
        );
        if !doubled {
            name.push(c);
        }
    }
    let name: String = name.trim_matches(['-', '/']).chars().take(BRANCH).collect();
    name.trim_end_matches(['-', '/']).to_owned()
}

/// `name`, or `name-2`, `name-3` and on, the first no branch here has
/// nor is in the way of (`fix` is of `fix/login`).
async fn free(repo: &Repo, name: &str) -> Result<String, Refusal> {
    let branches = repo.branches().await?;
    let tried = (1..).map(|n| match n {
        1 => name.to_owned(),
        n => format!("{name}-{n}"),
    });
    Ok(tried
        .into_iter()
        .find(|tried| in_way(&branches, tried).is_none())
        .expect("some name is free"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_is_read_fenced_or_not_and_its_subject_kept_short() {
        let reply = read("```json\n{\"subject\": \"Add the card.\", \"body\": \"- one\"}\n```");
        assert_eq!(subject(&reply.subject), "Add the card");
        assert_eq!(reply.body, "- one");
        assert_eq!(subject(&read("Fix it\nmore").subject), "Fix it");
        assert_eq!(subject(""), NO_SUBJECT);
        assert_eq!(subject(&"a".repeat(100)).len(), SUBJECT);
    }

    #[test]
    fn a_branch_is_named_as_git_takes_it() {
        assert_eq!(branch_name("Search box!"), "feature/search-box");
        assert_eq!(branch_name("fix/Login  page"), "fix/login-page");
        assert_eq!(branch_name("--//"), "feature/update");
        assert_eq!(branch_name(&"x".repeat(80)).len(), PREFIX.len() + BRANCH);
    }

    #[test]
    fn a_name_is_made_as_the_branch_picker_makes_it() {
        #[derive(serde::Deserialize)]
        struct Case {
            words: String,
            name: String,
        }
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../branch-names.json")).unwrap();
        for case in cases {
            assert_eq!(slug(&case.words), case.name, "{:?}", case.words);
        }
    }

    #[test]
    fn a_long_patch_is_cut_at_a_character() {
        assert_eq!(cut("ééé", 3), "é\n[cut here]");
        assert_eq!(cut("short\n", 10), "short");
    }
}
