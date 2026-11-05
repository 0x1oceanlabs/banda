//! A Thread's title (ADR 0077): the one its Person gives it, and the one
//! its Harness's small model suggests, from a prompt said here and a
//! reply cleaned here. Pure: the caller brings what the Thread said.

use crate::model::{HarnessOption, PlanStep, StepState};
use banda_kernel::Refusal;

/// The longest title a Person gives a Thread, in characters.
pub const LONGEST: usize = 120;
/// The longest title a model suggests, in characters.
pub const SUGGESTED: usize = 30;
/// How many of the latest messages a suggestion reads.
pub const MESSAGES: usize = 6;
/// How much of the Agent's last reply a suggestion reads: its end.
const REPLY_END: usize = 600;
/// How much of each message a suggestion reads: its start. A long text
/// pasted says little more of what the Thread does.
const MESSAGE_START: usize = 2000;

/// The title a Person gives a Thread, on one line, its spaces trimmed and
/// collapsed; none for a blank one, which gives the first message's title
/// back. One longer than [`LONGEST`] is refused.
pub fn named(title: Option<&str>) -> Result<Option<String>, Refusal> {
    let line = one_line(title.unwrap_or_default());
    if line.is_empty() {
        return Ok(None);
    }
    if line.chars().count() > LONGEST {
        return Err(Refusal::invalid(format!(
            "A Thread's title can be at most {LONGEST} characters."
        )));
    }
    Ok(Some(line))
}

/// The words a Harness's small model has in its name: Claude's Haiku,
/// OpenAI's mini, Gemini's Flash and Flash Lite.
const SMALL: [&str; 5] = ["haiku", "mini", "flash", "lite", "small"];

/// The Harness's small model among the `options` it offers: the model
/// option's ID, and the first value whose value or name has one of the
/// [`SMALL`] words, as a word of its own, so Gemini is not mini. None when
/// it offers none.
pub fn small_model(options: &[HarnessOption]) -> Option<(String, String)> {
    let model = options
        .iter()
        .find(|option| option.category.as_deref() == Some("model"))
        .or_else(|| options.iter().find(|option| option.id == "model"))?;
    let small = |name: &str| {
        name.split(|c: char| !c.is_alphanumeric())
            .any(|word| SMALL.iter().any(|small| word.eq_ignore_ascii_case(small)))
    };
    let choice =
        (model.choices.iter()).find(|choice| small(&choice.value) || small(&choice.name))?;
    Some((model.id.clone(), choice.value.clone()))
}

/// What the small model is asked: the rules of a title (ADR 0077,
/// decision 3).
const RULES: &str = "\
Name this conversation between a Person and a coding agent with a short title, \
for the list where the Person finds it again.

Rules:
- Say what the conversation does now, from its latest messages, not what it began with.
- Two to four words, at most 30 characters.
- Write in the language of the Person's latest messages.
- Keep the names the Person finds things by as they are written, such as #586, \
ADR 0069 or motion.spec.
- Leave out the project's name, words such as \"Discussion of\" or \"Work on\", \
quotes and a full stop.
- If the title now already says it, answer with that title unchanged.
- Answer with the title only, on one line, and use no tools.";

/// The prompt for a title of a Thread called `title` now, from its latest
/// `messages`, the latest first; the end of its Agent's last `reply`; and
/// its `plan`. The start of a long Thread is left out: only what it does
/// now names it.
pub fn prompt(messages: &[String], reply: Option<&str>, plan: &[PlanStep], title: &str) -> String {
    let mut prompt = format!("{RULES}\n\nThe title now: {title}\n");
    if !messages.is_empty() {
        prompt.push_str("\nThe Person's latest messages, the latest first:\n");
        for (at, message) in messages.iter().enumerate() {
            let latest = if at == 0 { ", the latest" } else { "" };
            let start = start(message.trim(), MESSAGE_START);
            prompt.push_str(&format!("\nMessage {}{latest}:\n{start}\n", at + 1));
        }
    }
    if let Some(reply) = reply.map(str::trim).filter(|reply| !reply.is_empty()) {
        let end = end(reply, REPLY_END);
        prompt.push_str(&format!("\nThe end of the agent's last reply:\n{end}\n"));
    }
    if !plan.is_empty() {
        prompt.push_str("\nThe agent's plan:\n");
        for step in plan {
            let state = match step.state {
                StepState::Pending => "to do",
                StepState::InProgress => "doing",
                StepState::Done => "done",
            };
            prompt.push_str(&format!("- [{state}] {}\n", one_line(&step.text)));
        }
    }
    prompt
}

/// Quotes a model may put around its title, each with its closing one.
const QUOTES: [(char, char); 8] = [
    ('"', '"'),
    ('\'', '\''),
    ('`', '`'),
    ('*', '*'),
    ('«', '»'),
    ('“', '”'),
    ('„', '“'),
    ('‘', '’'),
];

/// The title in a model's `reply`: its first line, without quotes around
/// it, a leading "Title:" or a full stop, its spaces collapsed, cut at a
/// word to [`SUGGESTED`] characters. None when nothing is left.
pub fn suggested(reply: &str) -> Option<String> {
    let mut title = reply.lines().map(str::trim).find(|line| !line.is_empty())?;
    loop {
        let before = title;
        title = unquoted(title).trim();
        title = unlabelled(title).trim();
        title = title.trim_end_matches(['.', '。']).trim_end();
        if title == before {
            break;
        }
    }
    let title = cut(&one_line(title), SUGGESTED);
    (!title.is_empty()).then_some(title)
}

fn unquoted(text: &str) -> &str {
    QUOTES
        .iter()
        .find_map(|(open, close)| text.strip_prefix(*open)?.strip_suffix(*close))
        .unwrap_or(text)
}

/// `text` without a leading "Title:", in any case.
fn unlabelled(text: &str) -> &str {
    const LABEL: &str = "title:";
    match text.get(..LABEL.len()) {
        Some(label) if label.eq_ignore_ascii_case(LABEL) => &text[LABEL.len()..],
        _ => text,
    }
}

/// `line` cut at a word to at most `longest` characters, without the
/// mark it may end on there; a first word longer than that, cut within.
fn cut(line: &str, longest: usize) -> String {
    if line.chars().count() <= longest {
        return line.to_owned();
    }
    let mut kept = String::new();
    for word in line.split(' ') {
        let wider = kept.chars().count() + usize::from(!kept.is_empty()) + word.chars().count();
        if wider > longest {
            break;
        }
        if !kept.is_empty() {
            kept.push(' ');
        }
        kept.push_str(word);
    }
    if kept.is_empty() {
        kept = line.chars().take(longest).collect();
    }
    let kept = kept.trim_end_matches([',', ';', ':', '-', '–', '—', '.']);
    kept.trim_end().to_owned()
}

/// `text` on one line, its spaces collapsed.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The first `longest` characters of `text`, and "…" if there are more.
fn start(text: &str, longest: usize) -> String {
    match text.char_indices().nth(longest) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_owned(),
    }
}

/// The last `longest` characters of `text`, after "…" if there are more.
fn end(text: &str, longest: usize) -> String {
    let count = text.chars().count();
    if count <= longest {
        return text.to_owned();
    }
    let (at, _) = text.char_indices().nth(count - longest).unwrap_or((0, ' '));
    format!("…{}", &text[at..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{OptionChoice, OptionValue};

    #[test]
    fn a_title_is_one_line_of_up_to_120_characters_and_blank_gives_none() {
        assert_eq!(
            named(Some("  Fix the\n list   order ")).unwrap(),
            Some("Fix the list order".to_owned())
        );
        assert_eq!(named(Some(" \n\t ")).unwrap(), None);
        assert_eq!(named(None).unwrap(), None);
        let longest = "a".repeat(LONGEST);
        assert_eq!(named(Some(&longest)).unwrap(), Some(longest.clone()));
        let refused = named(Some(&format!("{longest}b"))).unwrap_err();
        assert!(refused.message.contains("120"), "{}", refused.message);
        // Characters, not bytes.
        let cyrillic = "я".repeat(LONGEST);
        assert!(named(Some(&cyrillic)).is_ok());
    }

    fn models(choices: &[(&str, &str)]) -> Vec<HarnessOption> {
        let choices = choices
            .iter()
            .map(|(value, name)| OptionChoice {
                value: (*value).to_owned(),
                name: (*name).to_owned(),
                description: None,
            })
            .collect::<Vec<_>>();
        let effort = HarnessOption {
            id: "effort".into(),
            name: "Effort".into(),
            description: None,
            category: Some("thought_level".into()),
            value: OptionValue::Choice("lite".into()),
            choices: vec![OptionChoice {
                value: "lite".into(),
                name: "Lite".into(),
                description: None,
            }],
        };
        let model = HarnessOption {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: Some("model".into()),
            value: OptionValue::Choice(choices[0].value.clone()),
            choices,
        };
        vec![effort, model]
    }

    fn small(choices: &[(&str, &str)]) -> Option<String> {
        small_model(&models(choices)).map(|(id, value)| {
            assert_eq!(id, "model");
            value
        })
    }

    #[test]
    fn the_small_model_is_the_first_a_harness_names_small() {
        let claude = [
            ("default", "Default (recommended)"),
            ("opus", "Opus"),
            ("haiku", "Haiku"),
        ];
        assert_eq!(small(&claude).as_deref(), Some("haiku"));
        let codex = [
            ("gpt-5.1-codex", "gpt-5.1-codex"),
            ("gpt-5.1-codex-mini", "gpt-5.1-codex-mini"),
            ("gpt-5-mini", "gpt-5-mini"),
        ];
        assert_eq!(small(&codex).as_deref(), Some("gpt-5.1-codex-mini"));
        // By its name, when its value says nothing.
        let named = [("a1", "Large"), ("b2", "Small and quick")];
        assert_eq!(small(&named).as_deref(), Some("b2"));
        // Gemini is not mini; its Flash is small.
        let gemini = [
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
            ("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ];
        assert_eq!(small(&gemini).as_deref(), Some("gemini-2.5-flash"));
        assert_eq!(small(&[("HAIKU-4-5", "x")]).as_deref(), Some("HAIKU-4-5"));
        // None small: the Thread's model stays. The effort's "lite" is no model.
        assert_eq!(small(&[("fast", "Fast"), ("smart", "Smart")]), None);
        assert_eq!(small_model(&[]), None);
    }

    fn step(text: &str, state: StepState) -> PlanStep {
        PlanStep {
            text: text.into(),
            state,
        }
    }

    #[test]
    fn the_prompt_holds_the_rules_the_latest_messages_the_reply_and_the_plan() {
        let messages = vec!["now fix motion.spec".to_owned(), "look at #586".to_owned()];
        let reply = format!("{}THE END", "x".repeat(1000));
        let plan = [
            step("Read the spec", StepState::Done),
            step("Fix\nthe test", StepState::InProgress),
        ];
        let prompt = prompt(&messages, Some(&reply), &plan, "Look at #586");
        assert!(prompt.starts_with(RULES));
        assert!(prompt.contains("The title now: Look at #586\n"));
        let latest = prompt
            .find("Message 1, the latest:\nnow fix motion.spec")
            .unwrap();
        let earlier = prompt.find("Message 2:\nlook at #586").unwrap();
        assert!(latest < earlier, "{prompt}");
        // Only the reply's end, 600 characters of it.
        let said = prompt.split("last reply:\n").nth(1).unwrap();
        let said = said.lines().next().unwrap();
        assert_eq!(said.chars().count(), 1 + REPLY_END);
        assert!(said.starts_with('…') && said.ends_with("THE END"));
        assert!(prompt.contains("- [done] Read the spec\n- [doing] Fix the test\n"));
        for rule in [
            "30 characters",
            "language",
            "#586",
            "unchanged",
            "title only",
        ] {
            assert!(RULES.contains(rule), "{rule}");
        }
    }

    #[test]
    fn the_prompt_leaves_out_what_there_is_not_and_cuts_a_long_message() {
        let long = "y".repeat(5000);
        let prompt = prompt(&[long], None, &[], "Hello");
        assert!(!prompt.contains("reply"), "{prompt}");
        assert!(!prompt.contains("plan:"), "{prompt}");
        let message = prompt.split("the latest:\n").nth(1).unwrap().trim_end();
        assert_eq!(message.chars().count(), MESSAGE_START + 1);
        assert!(message.ends_with('…'));
    }

    #[test]
    fn a_reply_gives_its_first_line_bare_and_cut_at_a_word() {
        let cleaned = |reply: &str| suggested(reply);
        assert_eq!(
            cleaned("Fix motion.spec").as_deref(),
            Some("Fix motion.spec")
        );
        assert_eq!(
            cleaned("\n\n  \"Fix motion.spec.\"  \nbecause…").as_deref(),
            Some("Fix motion.spec")
        );
        assert_eq!(
            cleaned("Title: ADR 0069 rename").as_deref(),
            Some("ADR 0069 rename")
        );
        assert_eq!(
            cleaned("TITLE: «Ревью #586».").as_deref(),
            Some("Ревью #586")
        );
        assert_eq!(
            cleaned("`Title: Tiling   perf`").as_deref(),
            Some("Tiling perf")
        );
        assert_eq!(cleaned("**Usage bars**").as_deref(), Some("Usage bars"));
        assert_eq!(cleaned("“Snooze menu”").as_deref(), Some("Snooze menu"));
        // At a word, within 30 characters, without the comma it ends on there.
        assert_eq!(
            cleaned("Mode plan, model smart, brief false").as_deref(),
            Some("Mode plan, model smart, brief")
        );
        assert_eq!(
            cleaned("Review the tiling benchmark, motion.spec").as_deref(),
            Some("Review the tiling benchmark")
        );
        let long = "a".repeat(40);
        assert_eq!(cleaned(&long), Some("a".repeat(SUGGESTED)));
        assert_eq!(
            cleaned("я".repeat(40).as_str()),
            Some("я".repeat(SUGGESTED))
        );
        for empty in ["", "  \n ", "\"\"", "Title:", "«».", "``"] {
            assert_eq!(cleaned(empty), None, "{empty:?}");
        }
    }
}
