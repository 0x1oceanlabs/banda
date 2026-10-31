//! The agents module's decisions and state machines. Pure: no database,
//! clock, randomness or Harness protocol. IDs come in from the caller.

use crate::model::{
    Body, Choice, Fact, Failure, Field, FieldValue, Image, ImageId, Input, ItemId, Mode,
    QuestionState, ToolContent, ToolKind, TurnId, TurnState, Values,
};
use bandaso_kernel::{Participant, Refusal};
use std::collections::HashSet;

/// How freely an Agent acts is a Person's choice: an Agent sends a message
/// with the settings its Thread has, and changes none.
pub fn may_choose(author: Participant) -> Result<(), Refusal> {
    match author {
        Participant::Person(_) => Ok(()),
        Participant::Agent(_) => Err(Refusal::forbidden(
            "Only a Person chooses how freely an Agent acts.",
        )),
    }
}

/// Whether a turn may start now: it waits, nobody stopped it, and its
/// Thread's queue is not held.
pub fn may_start(state: TurnState, held: bool) -> bool {
    state == TurnState::Queued && !held
}

/// Whether a turn has yet to end.
pub fn ongoing(state: TurnState) -> bool {
    matches!(state, TurnState::Queued | TurnState::Running)
}

/// What stopping a turn does.
#[derive(Debug, PartialEq, Eq)]
pub enum Stop {
    /// It has not started: it ends now and never runs.
    Now,
    /// It runs: the Harness is asked to stop, and the turn ends when it does.
    AskHarness,
    /// It has ended already.
    Nothing,
}

pub fn stop(state: TurnState) -> Stop {
    match state {
        TurnState::Queued => Stop::Now,
        TurnState::Running => Stop::AskHarness,
        TurnState::Done
        | TurnState::Stopped
        | TurnState::Failed
        | TurnState::Interrupted
        | TurnState::Withdrawn => Stop::Nothing,
    }
}

/// Whether a Person may still change a message, take it back or send it
/// now: only while its turn waits.
pub fn waits(state: TurnState) -> Result<(), Refusal> {
    if state == TurnState::Queued {
        Ok(())
    } else {
        Err(Refusal::invalid(
            "The Agent has taken this message, so it can no longer be changed.",
        ))
    }
}

/// How a turn ended: its state, in plain words why, and what kind of
/// failure it was.
#[derive(Debug, PartialEq, Eq)]
pub struct Ending {
    pub state: TurnState,
    pub reason: Option<String>,
    pub failure: Option<Failure>,
}

impl Ending {
    pub fn new(state: TurnState, reason: Option<&str>) -> Ending {
        Ending {
            state,
            reason: reason.map(str::to_owned),
            failure: None,
        }
    }

    pub fn failed(reason: impl Into<String>, failure: Option<Failure>) -> Ending {
        Ending {
            state: TurnState::Failed,
            reason: Some(reason.into()),
            failure,
        }
    }

    /// A usage limit learns when it resets, `at`, if it does not know.
    pub fn resets(mut self, at: Option<i64>) -> Ending {
        if let Some(Failure::UsageLimit {
            until: until @ None,
        }) = &mut self.failure
        {
            *until = at;
        }
        self
    }

    /// A turn the Harness ended as cancelled stopped when a Person asked
    /// for it, and failed otherwise, so nobody reads a stop that no Person
    /// made.
    pub fn stop_asked(self, asked: bool) -> Ending {
        match self.state {
            TurnState::Stopped if !asked => Ending::failed(
                "The Harness ended the turn by itself.",
                Some(Failure::Provider),
            ),
            _ => self,
        }
    }
}

/// Whether a turn may be tried again: it failed or was cut short, and
/// nothing came after it in its Thread.
pub fn retry(state: TurnState, latest: bool) -> Result<(), Refusal> {
    if !matches!(state, TurnState::Failed | TurnState::Interrupted) {
        return Err(Refusal::invalid(
            "Only a turn that failed or was cut short can be tried again.",
        ));
    }
    if !latest {
        return Err(Refusal::invalid(
            "Only the Thread's latest turn can be tried again.",
        ));
    }
    Ok(())
}

/// An answer as the Harness offers it.
pub struct Offered {
    pub id: String,
    pub name: String,
    pub allows: bool,
    /// The Harness would remember this answer for next time.
    pub always: bool,
}

/// The choices a Question shows: all of the Harness's own, unchanged, its
/// "always" answers too (ADR 0003, decision 9).
pub fn choices(offered: Vec<Offered>) -> Vec<Choice> {
    offered
        .into_iter()
        .map(|o| Choice {
            id: o.id,
            name: o.name,
            allows: o.allows,
            always: o.always,
        })
        .collect()
}

/// What the engine does with a Harness's Question when the Harness has no
/// modes of its own: answers it by the Thread's mode, as T3 Code does, or
/// asks the Person.
#[derive(Debug, PartialEq, Eq)]
pub enum Disposition {
    Allow,
    Ask,
}

pub fn disposition(mode: Mode, tool: ToolKind) -> Disposition {
    let reads = matches!(tool, ToolKind::Read | ToolKind::Search | ToolKind::Think);
    let edits = matches!(tool, ToolKind::Edit | ToolKind::Delete | ToolKind::Move);
    let allowed = match mode {
        Mode::Supervised => reads,
        Mode::AcceptEdits => reads || edits,
        Mode::Auto | Mode::FullAccess => true,
    };
    if allowed {
        Disposition::Allow
    } else {
        Disposition::Ask
    }
}

/// The answer that allows this once, if the Harness offers one. The
/// engine never picks an answer the Harness would keep for next time.
pub fn allow_once(offered: &[Offered]) -> Option<&str> {
    offered
        .iter()
        .find(|o| o.allows && !o.always)
        .map(|o| o.id.as_str())
}

/// Answers a Question with one of its choices. A choice that submits a
/// form takes what the Person filled in, which must fit the form; it comes
/// back as the Question keeps it.
pub fn answer(
    body: &mut Body,
    choice: &str,
    given: Option<Values>,
) -> Result<Option<Filled>, Refusal> {
    let Body::Question {
        state,
        choices,
        form,
        answer,
        values,
        ..
    } = body
    else {
        return Err(Refusal::invalid("This item is not a Question."));
    };
    match state {
        QuestionState::Open => {
            let chosen = choices
                .iter()
                .find(|c| c.id == choice)
                .ok_or_else(|| Refusal::invalid("This Question does not offer that answer."))?;
            let filled = match form {
                Some(fields) if chosen.allows => {
                    let given = given.unwrap_or_default();
                    fits(fields, &given)?;
                    Some(Filled::new(fields, given))
                }
                _ if given.is_some_and(|g| !g.is_empty()) => {
                    return Err(Refusal::invalid("This answer takes nothing filled in."));
                }
                _ => None,
            };
            *state = QuestionState::Answered;
            *answer = Some(choice.to_owned());
            *values = filled.as_ref().map(|f| f.kept.clone());
            Ok(filled)
        }
        QuestionState::Answered => Err(Refusal::conflict("This Question has its answer.")),
        QuestionState::Closed => Err(Refusal::conflict(
            "This Question closed: its turn ended before an answer.",
        )),
    }
}

/// What the Thread keeps in a secret field instead of what was typed.
pub const MASK: &str = "••••••";

/// What a Person filled in a form: what the Thread keeps, with a mask in
/// each secret field, and the secrets, which only the Harness gets.
#[derive(Debug, Default, PartialEq)]
pub struct Filled {
    pub kept: Values,
    pub secret: Values,
}

impl Filled {
    fn new(fields: &[Field], mut given: Values) -> Filled {
        let mut secret = Values::new();
        for field in fields.iter().filter(|f| f.secret) {
            if let Some(value) = given.remove(&field.id) {
                given.insert(field.id.clone(), FieldValue::Text(MASK.to_owned()));
                secret.insert(field.id.clone(), value);
            }
        }
        Filled {
            kept: given,
            secret,
        }
    }
}

/// Whether `given` fits the form: only its fields, each of the kind it
/// takes, and every required one filled in.
fn fits(fields: &[Field], given: &Values) -> Result<(), Refusal> {
    let wrong =
        |field: &Field| Refusal::invalid(format!("\"{}\" does not take that answer.", field.title));
    for id in given.keys() {
        if !fields.iter().any(|f| f.id == *id) {
            return Err(Refusal::invalid(format!("The form has no field \"{id}\".")));
        }
    }
    for field in fields {
        let Some(value) = given.get(&field.id) else {
            if field.required {
                return Err(Refusal::invalid(format!(
                    "\"{}\" needs an answer.",
                    field.title
                )));
            }
            continue;
        };
        let offered = |choices: &[crate::model::OptionChoice], value: &str| {
            choices.iter().any(|c| c.value == value)
        };
        let within = |count: usize, least: &Option<u32>, most: &Option<u32>| {
            let count = u32::try_from(count).unwrap_or(u32::MAX);
            least.is_none_or(|l| count >= l) && most.is_none_or(|m| count <= m)
        };
        let fits = match (&field.input, value) {
            (
                Input::Text {
                    shortest, longest, ..
                },
                FieldValue::Text(text),
            ) => {
                (!field.required || !text.trim().is_empty())
                    && within(text.chars().count(), shortest, longest)
            }
            (Input::Choice { choices, .. }, FieldValue::Text(value)) => offered(choices, value),
            (
                Input::Choices {
                    choices,
                    fewest,
                    most,
                    ..
                },
                FieldValue::Choices(values),
            ) => {
                values.iter().all(|v| offered(choices, v))
                    && !(field.required && values.is_empty())
                    && within(values.len(), fewest, most)
            }
            (
                Input::Number {
                    integer,
                    minimum,
                    maximum,
                    ..
                },
                FieldValue::Number(number),
            ) => {
                let at = number.as_f64().unwrap_or(f64::NAN);
                let whole = number.is_i64() || number.is_u64();
                (!integer || whole)
                    && minimum
                        .as_ref()
                        .and_then(|m| m.as_f64())
                        .is_none_or(|m| at >= m)
                    && maximum
                        .as_ref()
                        .and_then(|m| m.as_f64())
                        .is_none_or(|m| at <= m)
            }
            (Input::Toggle { .. }, FieldValue::Toggle(_)) => true,
            _ => false,
        };
        if !fits {
            return Err(wrong(field));
        }
    }
    Ok(())
}

/// Closes a Question that can no longer be answered. Whether it changed.
pub fn close(body: &mut Body) -> bool {
    match body {
        Body::Question { state, .. } if *state != QuestionState::Closed => {
            *state = QuestionState::Closed;
            true
        }
        _ => false,
    }
}

/// A Thread's title: the start of its first message, on one line.
pub fn title(text: &str, images: &[Image]) -> String {
    const LONGEST: usize = 60;
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return match images {
            [one] => one.name.clone().unwrap_or_else(|| "An image".to_owned()),
            _ => format!("{} images", images.len()),
        };
    }
    if line.chars().count() <= LONGEST {
        return line;
    }
    let mut short: String = line.chars().take(LONGEST - 1).collect();
    short.push('…');
    short
}

/// The kinds of image a message can carry, as T3 Code takes them, and the
/// first bytes each kind's file starts with.
const IMAGE_KINDS: [(&str, &[u8]); 4] = [
    ("image/png", b"\x89PNG\r\n\x1a\n"),
    ("image/jpeg", b"\xff\xd8\xff"),
    ("image/gif", b"GIF8"),
    ("image/webp", b"RIFF"),
];
const MB: usize = 1024 * 1024;
/// The largest image, the most images and the most of their bytes one
/// message carries, as in T3 Code.
pub const LARGEST_IMAGE: usize = 10 * MB;
pub const MOST_IMAGES: usize = 100;
const MOST_IMAGE_BYTES: usize = 80 * MB;

/// Whether `bytes` can go with a message as an image of kind `mime`.
pub fn may_attach(mime: &str, bytes: &[u8]) -> Result<(), Refusal> {
    let Some((_, starts)) = IMAGE_KINDS.iter().find(|(kind, _)| *kind == mime) else {
        return Err(Refusal::invalid(
            "A message can carry PNG, JPEG, GIF and WebP images.",
        ));
    };
    if bytes.len() > LARGEST_IMAGE {
        return Err(Refusal::invalid(format!(
            "An image can be at most {} MB.",
            LARGEST_IMAGE / MB
        )));
    }
    let webp = mime != "image/webp" || bytes.get(8..12) == Some(b"WEBP");
    if !bytes.starts_with(starts) || !webp {
        return Err(Refusal::invalid(format!(
            "This file is not a {mime} image."
        )));
    }
    Ok(())
}

/// Whether a message of `text` can carry the images it names.
pub fn may_send(text: &str, images: &[ImageId]) -> Result<(), Refusal> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(Refusal::invalid("A message needs some text or an image."));
    }
    if images.len() > MOST_IMAGES {
        return Err(Refusal::invalid(format!(
            "A message can carry at most {MOST_IMAGES} images."
        )));
    }
    let named: HashSet<_> = images.iter().collect();
    if named.len() < images.len() {
        return Err(Refusal::invalid("A message carries each image once."));
    }
    Ok(())
}

/// Whether the images a message carries fit in it together.
pub fn may_carry(images: &[Image]) -> Result<(), Refusal> {
    let bytes: usize = images.iter().map(|image| image.size as usize).sum();
    if bytes > MOST_IMAGE_BYTES {
        return Err(Refusal::invalid(format!(
            "A message's images can be at most {} MB together.",
            MOST_IMAGE_BYTES / MB
        )));
    }
    Ok(())
}

/// What becomes of a message's images when `harness` takes none: it gets
/// the text alone, which a notice says; a message of images alone cannot
/// go, which the error says.
pub fn without_images(harness: &str, text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err(format!(
            "{harness} does not take images, and this message holds nothing else."
        ));
    }
    Ok(format!(
        "{harness} does not take images, so it got the text alone."
    ))
}

/// The most of one command's output, one text or one diff (its texts
/// before and after together) a Thread keeps, in bytes. The Thread keeps
/// everything the Harness says; only a runaway command reaches this.
pub const KEPT: usize = 4 * 1024 * 1024;

/// The start of `text` that fits in `room` bytes, ending where a character
/// ends.
pub fn fit(text: &str, room: usize) -> &str {
    if text.len() <= room {
        return text;
    }
    let mut end = room;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// A tool call's content as a Thread keeps it: a long text is cut, and a
/// diff too large to keep says so instead.
pub fn kept(content: Vec<ToolContent>) -> Vec<ToolContent> {
    content
        .into_iter()
        .map(|shown| match shown {
            ToolContent::Text { text } if text.len() > KEPT => ToolContent::Text {
                text: format!("{}…", fit(&text, KEPT)),
            },
            ToolContent::Diff { path, old, new }
                if old.as_ref().map_or(0, String::len) + new.len() > KEPT =>
            {
                ToolContent::Text {
                    text: format!("{path} changed too much to show here."),
                }
            }
            shown => shown,
        })
        .collect()
}

/// One command's output on its way into the Thread: what it printed that
/// is not written yet, within what the Thread keeps.
#[derive(Debug, Default)]
pub struct Printed {
    /// What the Thread holds of it already.
    kept: usize,
    waiting: String,
    /// It printed more than the Thread keeps; `told` once the Thread knows.
    cut: bool,
    told: bool,
}

impl Printed {
    /// Adds what the command printed since.
    pub fn add(&mut self, text: &str) {
        let fits = fit(text, KEPT - self.kept - self.waiting.len());
        self.waiting.push_str(fits);
        self.cut |= fits.len() < text.len();
    }

    /// What to write now, and whether the Thread keeps no more after it;
    /// none when there is nothing new.
    pub fn take(&mut self) -> Option<(String, bool)> {
        if self.waiting.is_empty() && self.cut == self.told {
            return None;
        }
        let text = std::mem::take(&mut self.waiting);
        self.kept += text.len();
        self.told = self.cut;
        Some((text, self.cut))
    }
}

/// The two kinds of text an Agent sends in pieces.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Text {
    Reply,
    Thought,
}

impl Text {
    pub fn body(self, text: String) -> Body {
        match self {
            Text::Reply => Body::Message {
                text,
                images: Vec::new(),
            },
            Text::Thought => Body::Thought { text },
        }
    }

    pub fn grew(self, item: ItemId, turn: TurnId, text: String) -> Fact {
        match self {
            Text::Reply => Fact::ReplyGrew { item, turn, text },
            Text::Thought => Fact::ThoughtGrew { item, turn, text },
        }
    }
}

/// Text that arrives in pieces: pieces of one kind in a row make one item,
/// and they are written in batches.
#[derive(Default)]
pub struct Pieces {
    open: Option<Piece>,
}

/// Text of one item not yet written.
#[derive(Debug, PartialEq)]
pub struct Piece {
    pub item: ItemId,
    pub kind: Text,
    pub text: String,
}

impl Pieces {
    /// Adds text. Text of another kind ends the open item, which comes back
    /// with whatever of it is not yet written. `fresh` names the item that
    /// text of a new kind starts.
    pub fn add(&mut self, kind: Text, text: &str, fresh: ItemId) -> Option<Piece> {
        if let Some(open) = &mut self.open
            && open.kind == kind
        {
            open.text.push_str(text);
            return None;
        }
        let ended = self.close();
        self.open = Some(Piece {
            item: fresh,
            kind,
            text: text.to_owned(),
        });
        ended
    }

    /// The text not yet written. The item stays open for more.
    pub fn take(&mut self) -> Option<Piece> {
        let open = self.open.as_mut()?;
        if open.text.is_empty() {
            return None;
        }
        Some(Piece {
            item: open.item,
            kind: open.kind,
            text: std::mem::take(&mut open.text),
        })
    }

    /// Ends the open item.
    pub fn close(&mut self) -> Option<Piece> {
        let piece = self.take();
        self.open = None;
        piece
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thread_keeps_tool_content_within_bounds() {
        assert_eq!(fit("héllo", 2), "h", "never half a character");
        assert_eq!(fit("hello", 9), "hello");
        let big = "x".repeat(KEPT);
        let content = kept(vec![
            ToolContent::Diff {
                path: "a.rs".into(),
                old: Some("a".into()),
                new: big,
            },
            ToolContent::Text { text: "ok".into() },
        ]);
        assert_eq!(
            content,
            [
                ToolContent::Text {
                    text: "a.rs changed too much to show here.".into()
                },
                ToolContent::Text { text: "ok".into() },
            ]
        );
    }

    #[test]
    fn a_thread_keeps_a_commands_output_up_to_a_runaway() {
        let mut printed = Printed::default();
        assert_eq!(printed.take(), None);
        printed.add("one\n");
        printed.add("two\n");
        assert_eq!(printed.take(), Some(("one\ntwo\n".into(), false)));
        assert_eq!(printed.take(), None, "written once");

        printed.add(&"x".repeat(KEPT));
        let (text, cut) = printed.take().expect("the rest that fits");
        assert_eq!((text.len(), cut), (KEPT - 8, true));
        printed.add("more");
        assert_eq!(printed.take(), None, "nothing past the limit");

        let mut exact = Printed::default();
        exact.add(&"x".repeat(KEPT));
        assert_eq!(exact.take().map(|(_, cut)| cut), Some(false));
        exact.add("more");
        assert_eq!(exact.take(), Some((String::new(), true)), "told it is cut");
    }

    #[test]
    fn a_turn_starts_once_stops_by_its_state_and_changes_while_it_waits() {
        assert!(may_start(TurnState::Queued, false));
        assert!(!may_start(TurnState::Queued, true), "the queue is held");
        assert!(!may_start(TurnState::Running, false));
        assert_eq!(stop(TurnState::Queued), Stop::Now);
        assert_eq!(stop(TurnState::Running), Stop::AskHarness);
        for ended in [
            TurnState::Done,
            TurnState::Stopped,
            TurnState::Failed,
            TurnState::Interrupted,
            TurnState::Withdrawn,
        ] {
            assert_eq!(stop(ended), Stop::Nothing);
            assert!(!ongoing(ended));
            assert!(waits(ended).is_err(), "{ended:?}");
        }
        assert!(waits(TurnState::Queued).is_ok());
        assert!(waits(TurnState::Running).is_err(), "the Agent has it");
        let cancelled = || Ending::new(TurnState::Stopped, None);
        assert_eq!(cancelled().stop_asked(true).state, TurnState::Stopped);
        assert_eq!(
            cancelled().stop_asked(false).state,
            TurnState::Failed,
            "no Person stopped it"
        );
    }

    #[test]
    fn a_usage_limit_learns_when_it_resets_and_nothing_else_does() {
        let limit = |until| Ending::failed("Limit.", Some(Failure::UsageLimit { until }));
        assert_eq!(
            limit(None).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(5) })
        );
        assert_eq!(
            limit(Some(3)).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(3) }),
            "what the failure itself says wins"
        );
        let other = Ending::failed("Down.", Some(Failure::Provider)).resets(Some(5));
        assert_eq!(other.failure, Some(Failure::Provider));
    }

    #[test]
    fn only_the_latest_turn_that_failed_or_was_cut_short_is_tried_again() {
        assert!(retry(TurnState::Failed, true).is_ok());
        assert!(retry(TurnState::Interrupted, true).is_ok());
        assert!(retry(TurnState::Failed, false).is_err());
        for state in [
            TurnState::Queued,
            TurnState::Running,
            TurnState::Done,
            TurnState::Stopped,
            TurnState::Withdrawn,
        ] {
            assert!(retry(state, true).is_err(), "{state:?}");
        }
    }

    fn question() -> Body {
        let offer = |id: &str, allows, always| Offered {
            id: id.into(),
            name: id.into(),
            allows,
            always,
        };
        Body::Question {
            title: "Run it?".into(),
            choices: choices(vec![
                offer("allow", true, false),
                offer("always", true, true),
                offer("reject", false, false),
                offer("never", false, true),
            ]),
            form: None,
            state: QuestionState::Open,
            answer: None,
            values: None,
        }
    }

    #[test]
    fn a_question_offers_every_answer_of_the_harness() {
        let Body::Question { choices, .. } = question() else {
            unreachable!()
        };
        let ids: Vec<_> = choices.iter().map(|c| (c.id.as_str(), c.always)).collect();
        assert_eq!(
            ids,
            [
                ("allow", false),
                ("always", true),
                ("reject", false),
                ("never", true)
            ]
        );
    }

    #[test]
    fn without_modes_of_its_own_a_harness_is_answered_by_the_mode() {
        use Disposition::{Allow, Ask};
        for (mode, read, run, edit) in [
            (Mode::Supervised, Allow, Ask, Ask),
            (Mode::AcceptEdits, Allow, Ask, Allow),
            (Mode::Auto, Allow, Allow, Allow),
            (Mode::FullAccess, Allow, Allow, Allow),
        ] {
            assert_eq!(disposition(mode, ToolKind::Read), read, "{mode:?}");
            assert_eq!(disposition(mode, ToolKind::Execute), run, "{mode:?}");
            assert_eq!(disposition(mode, ToolKind::Edit), edit, "{mode:?}");
        }
        let offer = |id: &str, allows, always| Offered {
            id: id.into(),
            name: id.into(),
            allows,
            always,
        };
        let offered = [offer("always", true, true), offer("once", true, false)];
        assert_eq!(allow_once(&offered), Some("once"));
        assert_eq!(allow_once(&offered[..1]), None, "never an always answer");
    }

    #[test]
    fn only_an_open_question_takes_one_of_its_choices() {
        let mut body = question();
        assert!(answer(&mut body, "maybe", None).is_err());
        let filled = Values::from([("x".to_owned(), FieldValue::Toggle(true))]);
        assert!(answer(&mut body, "allow", Some(filled)).is_err(), "no form");
        assert!(answer(&mut body, "allow", None).is_ok());
        assert!(
            matches!(&body, Body::Question { state: QuestionState::Answered, answer: Some(a), .. } if a == "allow")
        );
        assert!(
            answer(&mut body, "reject", None).is_err(),
            "it has its answer"
        );
        assert!(close(&mut body));
        assert!(!close(&mut body), "closed once");
        assert!(answer(&mut body, "allow", None).is_err());
    }

    fn form() -> Body {
        use crate::model::OptionChoice;
        let colours = ["Red", "Blue"]
            .map(|c| OptionChoice {
                value: c.into(),
                name: c.into(),
                description: None,
            })
            .to_vec();
        let field = |id: &str, required, input| Field {
            id: id.into(),
            title: id.into(),
            description: None,
            required,
            secret: id == "key",
            input,
        };
        Body::Question {
            title: "Which colour?".into(),
            choices: vec![
                Choice {
                    id: "accept".into(),
                    name: "Submit".into(),
                    allows: true,
                    always: false,
                },
                Choice {
                    id: "decline".into(),
                    name: "Skip".into(),
                    allows: false,
                    always: false,
                },
            ],
            form: Some(vec![
                field(
                    "colour",
                    true,
                    Input::Choice {
                        choices: colours,
                        default: None,
                    },
                ),
                field(
                    "note",
                    false,
                    Input::Text {
                        default: None,
                        shortest: None,
                        longest: Some(5),
                        format: None,
                    },
                ),
                field(
                    "key",
                    false,
                    Input::Text {
                        default: None,
                        shortest: None,
                        longest: None,
                        format: None,
                    },
                ),
                field(
                    "count",
                    false,
                    Input::Number {
                        integer: true,
                        minimum: Some(1.into()),
                        maximum: Some(3.into()),
                        default: None,
                    },
                ),
            ]),
            state: QuestionState::Open,
            answer: None,
            values: None,
        }
    }

    #[test]
    fn a_form_takes_only_what_fits_it() {
        let text = |t: &str| FieldValue::Text(t.into());
        let given = |pairs: &[(&str, FieldValue)]| {
            Some(
                pairs
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.clone()))
                    .collect::<Values>(),
            )
        };
        for wrong in [
            given(&[]),
            given(&[("colour", text("Green"))]),
            given(&[("colour", text("Red")), ("size", text("L"))]),
            given(&[
                ("colour", text("Red")),
                ("count", FieldValue::Number(5.into())),
            ]),
            given(&[("colour", FieldValue::Toggle(true))]),
            given(&[("colour", text("Red")), ("note", text("too long"))]),
        ] {
            assert!(
                answer(&mut form(), "accept", wrong.clone()).is_err(),
                "{wrong:?}"
            );
        }
        let mut body = form();
        let right = given(&[
            ("colour", text("Blue")),
            ("count", FieldValue::Number(2.into())),
        ]);
        answer(&mut body, "accept", right.clone()).unwrap();
        assert!(matches!(&body, Body::Question { values, .. } if *values == right));

        let mut body = form();
        let with_key = given(&[("colour", text("Red")), ("key", text("s3cret"))]);
        let filled = answer(&mut body, "accept", with_key).unwrap().unwrap();
        assert_eq!(filled.secret, given(&[("key", text("s3cret"))]).unwrap());
        let kept = given(&[("colour", text("Red")), ("key", text(MASK))]);
        assert_eq!(Some(filled.kept), kept);
        assert!(
            matches!(&body, Body::Question { values, .. } if *values == kept),
            "the Thread never holds a secret"
        );

        let mut skipped = form();
        answer(&mut skipped, "decline", None).unwrap();
        assert!(matches!(&skipped, Body::Question { values: None, .. }));
    }

    #[test]
    fn a_title_is_one_short_line() {
        assert_eq!(title("  Fix\nthe   report ", &[]), "Fix the report");
        let long = title(&"word ".repeat(30), &[]);
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_message_of_images_alone_is_named_after_them() {
        let image = |name: Option<&str>| Image {
            id: crate::model::ImageId::new(),
            mime: "image/png".to_owned(),
            size: 1,
            name: name.map(str::to_owned),
        };
        assert_eq!(title(" ", &[image(Some("shot.png"))]), "shot.png");
        assert_eq!(title("", &[image(None)]), "An image");
        assert_eq!(title("", &[image(None), image(None)]), "2 images");
        assert_eq!(title("Look", &[image(None)]), "Look");
    }

    #[test]
    fn an_image_is_one_of_four_kinds_its_bytes_bear_out() {
        let png = b"\x89PNG\r\n\x1a\n....";
        assert_eq!(may_attach("image/png", png), Ok(()));
        assert_eq!(may_attach("image/jpeg", b"\xff\xd8\xff\xe0"), Ok(()));
        assert_eq!(may_attach("image/gif", b"GIF89a"), Ok(()));
        assert_eq!(may_attach("image/webp", b"RIFF\0\0\0\0WEBPVP8 "), Ok(()));
        assert!(may_attach("image/webp", b"RIFF\0\0\0\0WAVEfmt ").is_err());
        assert!(may_attach("image/jpeg", png).is_err(), "a PNG named a JPEG");
        assert!(may_attach("image/svg+xml", b"<svg/>").is_err());
        let large = [png.as_slice(), &vec![0; LARGEST_IMAGE]].concat();
        assert_eq!(
            may_attach("image/png", &large).unwrap_err().message,
            "An image can be at most 10 MB."
        );
    }

    #[test]
    fn a_message_carries_some_text_or_images_each_once_and_not_too_many() {
        let one = ImageId::new();
        assert!(may_send(" ", &[]).is_err());
        assert_eq!(may_send("", &[one]), Ok(()));
        assert!(may_send("look", &[one, one]).is_err());
        let many: Vec<_> = (0..=MOST_IMAGES).map(|_| ImageId::new()).collect();
        assert!(may_send("look", &many).is_err());
        assert_eq!(may_send("look", &many[1..]), Ok(()));

        let image = |size| Image {
            id: ImageId::new(),
            mime: "image/png".to_owned(),
            size,
            name: None,
        };
        let full = (LARGEST_IMAGE as u32, MOST_IMAGE_BYTES as u32);
        assert_eq!(may_carry(&vec![image(full.0); 8]), Ok(()));
        assert!(may_carry(&[vec![image(full.0); 8], vec![image(1)]].concat()).is_err());
        assert_eq!(may_carry(&[image(full.1)]), Ok(()));
    }

    #[test]
    fn pieces_of_one_kind_make_one_item_and_another_kind_ends_it() {
        let (reply, thought) = (ItemId::new(), ItemId::new());
        let mut pieces = Pieces::default();
        assert_eq!(pieces.add(Text::Reply, "Hel", reply), None);
        assert_eq!(pieces.add(Text::Reply, "lo", ItemId::new()), None);
        assert_eq!(pieces.take().unwrap().text, "Hello");
        assert_eq!(pieces.take(), None, "nothing new to write");
        pieces.add(Text::Reply, "!", ItemId::new());
        assert_eq!(
            pieces.take().unwrap().item,
            reply,
            "the reply goes on in the same item"
        );

        pieces.add(Text::Reply, " Bye", ItemId::new());
        let ended = pieces.add(Text::Thought, "hmm", thought).unwrap();
        assert_eq!((ended.item, ended.text.as_str()), (reply, " Bye"));
        assert_eq!(pieces.close().unwrap().item, thought);
        assert_eq!(pieces.close(), None);
    }
}
