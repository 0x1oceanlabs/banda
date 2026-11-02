//! A Question: what the Harness asks a Person in a turn, and the answer it
//! gets. Its rules, what it writes and its facts are here, from asking to
//! the answer or the close; `store.rs` reads its rows:
//!
//! - the Harness asks ([`ask`]): the engine answers by the Thread's mode
//!   where it may, and otherwise the Thread shows the Question, and
//!   [`Live`] holds the Harness's wait until an answer comes;
//! - a Person answers ([`answer`]): the Thread keeps the answer, and the
//!   outbox hands it to the Harness ([`REPLY`], [`reply`]), keyed by the
//!   Question, so it never waits behind the turn that asked;
//! - a Question nobody can answer any more closes: its turn ended
//!   ([`close_unanswered`]), the Harness took it back ([`withdrawn`]), or
//!   its answer never reached the Harness ([`abandoned`]).
//!
//! A secret typed into a form goes to the Harness only: neither the log
//! nor the outbox holds it, memory does.

use crate::live::Live;
use crate::model::{
    Body, Choice, Fact, Field, FieldValue, Input, Item, ItemId, Mode, QuestionState, ThreadId,
    ToolKind, TurnId, Values,
};
use crate::{emit, store};
use banda_kernel::{Effect, Error, Outcome, Participant, Refusal, Tx};
use serde::{Deserialize, Serialize};

pub const REPLY: &str = "question.reply";

/// A Person's answer on its way to the Harness.
#[derive(Serialize, Deserialize)]
pub struct ReplyEffect {
    pub item: ItemId,
    pub choice: String,
    /// What the Person filled in, for a form Question, but its secret
    /// fields: [`Live`] holds those.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<Values>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secret: bool,
}

/// What becomes of a Question the Harness asks.
pub enum Asked {
    /// The engine answers it with this choice, by the Thread's mode.
    ByMode(String),
    /// It opens for the Person: its item, and the fact that asks it.
    Open(Box<(ItemId, Body, Fact)>),
}

/// A Question the Harness asks in `turn`, offering every choice it has,
/// its "always" ones too (ADR 0003, decision 9). For a Harness with no
/// modes of its own, `by_mode` is the Thread's mode, and the engine
/// answers where the mode allows the tool, as T3 Code does; never a form,
/// which asks what only the Person knows.
pub fn ask(
    turn: TurnId,
    by_mode: Option<Mode>,
    tool: ToolKind,
    title: Option<String>,
    choices: Vec<Choice>,
    form: Option<Vec<Field>>,
    plan: Option<String>,
) -> Result<Asked, String> {
    if form.is_none()
        && by_mode.is_some_and(|mode| allowed(mode, tool))
        && let Some(once) = allow_once(&choices)
    {
        return Ok(Asked::ByMode(once.to_owned()));
    }
    if choices.is_empty() {
        return Err("The Harness asked without offering any answer.".to_owned());
    }
    let title = title.unwrap_or_else(|| "The Agent asks before it goes on.".to_owned());
    let item = ItemId::new();
    let asked = Fact::QuestionAsked {
        item,
        turn,
        title: title.clone(),
        choices: choices.clone(),
        form: form.clone(),
        plan: plan.clone(),
    };
    let body = Body::Question {
        title,
        choices,
        form,
        plan,
        state: QuestionState::Open,
        answer: None,
        values: None,
    };
    Ok(Asked::Open(Box::new((item, body, asked))))
}

/// Whether the Thread's mode allows the tool without asking.
fn allowed(mode: Mode, tool: ToolKind) -> bool {
    let reads = matches!(tool, ToolKind::Read | ToolKind::Search | ToolKind::Think);
    let edits = matches!(tool, ToolKind::Edit | ToolKind::Delete | ToolKind::Move);
    match mode {
        Mode::Supervised => reads,
        Mode::AcceptEdits => reads || edits,
        Mode::Auto | Mode::FullAccess => true,
    }
}

/// The answer that allows this once, if the Harness offers one. The
/// engine never picks an answer the Harness would keep for next time.
fn allow_once(choices: &[Choice]) -> Option<&str> {
    choices
        .iter()
        .find(|c| c.allows && !c.always)
        .map(|c| c.id.as_str())
}

/// A Person's answer to Question `item`: the Thread keeps it, and the
/// outbox hands it to the Harness.
pub fn answer(
    tx: &mut Tx<'_>,
    live: &Live,
    author: Participant,
    item: ItemId,
    choice: String,
    values: Option<Values>,
) -> Result<(), Error> {
    let (thread, mut found) = store::item(tx.sql(), item)?
        .ok_or_else(|| Refusal::not_found("There is no such Question."))?;
    let filled = fill(&mut found.body, &choice, values)?;
    store::set_body(tx.sql(), item, &found.body)?;
    let fact = Fact::QuestionAnswered {
        item,
        choice: choice.clone(),
        values: filled.as_ref().map(|f| f.kept.clone()),
    };
    emit(tx, author, thread, &fact)?;
    let (values, secret) = match filled {
        Some(Filled { mut kept, secret }) => {
            kept.retain(|id, _| !secret.contains_key(id));
            (Some(kept), secret)
        }
        None => (None, Values::new()),
    };
    let kept_secret = !secret.is_empty();
    if kept_secret {
        live.keep_secret(item, secret);
    }
    let reply = ReplyEffect {
        item,
        choice,
        values,
        secret: kept_secret,
    };
    tx.enqueue(REPLY, &item.to_string(), &reply)?;
    Ok(())
}

/// Hands a Person's answer to the Harness that waits for it.
pub fn reply(live: &Live, effect: &Effect) -> Outcome {
    let Ok(reply) = serde_json::from_value::<ReplyEffect>(effect.payload.clone()) else {
        return Outcome::Fail("The answer could not be read.".to_owned());
    };
    let mut values = reply.values;
    if reply.secret {
        // Only memory held the secret: after a restart it is gone, and
        // so is the turn that asked.
        let Some(secret) = live.take_secret(reply.item) else {
            return Outcome::Fail("The turn that asked has ended.".to_owned());
        };
        values.get_or_insert_default().extend(secret);
    }
    if live.answer(reply.item, reply.choice, values) {
        Outcome::Done
    } else {
        Outcome::Fail("The turn that asked has ended.".to_owned())
    }
}

/// The answer of `effect` never reached the Harness: the Question closes,
/// as its Thread's Agent's.
pub fn abandoned(tx: &mut Tx<'_>, effect: &Effect) -> Result<(), Error> {
    let reply: ReplyEffect = serde_json::from_value(effect.payload.clone())?;
    let Some((thread, item)) = store::item(tx.sql(), reply.item)? else {
        return Ok(());
    };
    let agent = store::agent_of(tx.sql(), thread)?;
    let author = agent.map_or(item.author, Participant::Agent);
    shut(tx, author, thread, item)
}

/// The Harness no longer waits for Question `item`: it closes.
pub fn withdrawn(tx: &mut Tx<'_>, author: Participant, item: ItemId) -> Result<(), Error> {
    match store::item(tx.sql(), item)? {
        Some((thread, item)) => shut(tx, author, thread, item),
        None => Ok(()),
    }
}

/// `turn` ended, which `author` brought about: its Questions that never
/// got an answer close.
pub fn close_unanswered(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    turn: TurnId,
) -> Result<(), Error> {
    for item in store::open_questions(tx.sql(), turn)? {
        shut(tx, author, thread, item)?;
    }
    Ok(())
}

/// Closes `item` and tells its Thread, unless it was closed.
fn shut(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    mut item: Item,
) -> Result<(), Error> {
    if !close(&mut item.body) {
        return Ok(());
    }
    store::set_body(tx.sql(), item.id, &item.body)?;
    emit(tx, author, thread, &Fact::QuestionClosed { item: item.id })
}

/// Answers a Question with one of its choices. A choice that submits a
/// form takes what the Person filled in, which must fit the form; it comes
/// back as the Question keeps it.
fn fill(body: &mut Body, choice: &str, given: Option<Values>) -> Result<Option<Filled>, Refusal> {
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
const MASK: &str = "••••••";

/// What a Person filled in a form: what the Thread keeps, with a mask in
/// each secret field, and the secrets, which only the Harness gets.
#[derive(Debug, Default, PartialEq)]
struct Filled {
    kept: Values,
    secret: Values,
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
fn close(body: &mut Body) -> bool {
    match body {
        Body::Question { state, .. } if *state != QuestionState::Closed => {
            *state = QuestionState::Closed;
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(id: &str, allows: bool, always: bool) -> Choice {
        Choice {
            id: id.into(),
            name: id.into(),
            allows,
            always,
        }
    }

    fn question() -> Body {
        let choices = vec![
            choice("allow", true, false),
            choice("always", true, true),
            choice("reject", false, false),
            choice("never", false, true),
        ];
        let turn = TurnId::new();
        let title = Some("Run it?".to_owned());
        match ask(turn, None, ToolKind::Execute, title, choices, None, None) {
            Ok(Asked::Open(opened)) => opened.1,
            _ => unreachable!("a Person answers without a mode"),
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
        for (mode, read, run, edit) in [
            (Mode::Supervised, true, false, false),
            (Mode::AcceptEdits, true, false, true),
            (Mode::Auto, true, true, true),
            (Mode::FullAccess, true, true, true),
        ] {
            assert_eq!(allowed(mode, ToolKind::Read), read, "{mode:?}");
            assert_eq!(allowed(mode, ToolKind::Execute), run, "{mode:?}");
            assert_eq!(allowed(mode, ToolKind::Edit), edit, "{mode:?}");
        }
        let offered = vec![choice("always", true, true), choice("once", true, false)];
        let asks = |by_mode, form: Option<Vec<Field>>, offered: Vec<Choice>| match ask(
            TurnId::new(),
            by_mode,
            ToolKind::Read,
            None,
            offered,
            form,
            None,
        ) {
            Ok(Asked::ByMode(id)) => Some(id),
            _ => None,
        };
        assert_eq!(
            asks(Some(Mode::Supervised), None, offered.clone()),
            Some("once".into())
        );
        assert_eq!(
            asks(Some(Mode::Supervised), None, offered[..1].to_vec()),
            None,
            "never an always answer"
        );
        assert_eq!(asks(None, None, offered.clone()), None, "its own modes");
        assert_eq!(
            asks(Some(Mode::Auto), Some(Vec::new()), offered),
            None,
            "a form"
        );
        assert!(
            ask(
                TurnId::new(),
                None,
                ToolKind::Read,
                None,
                Vec::new(),
                None,
                None
            )
            .is_err()
        );
    }

    #[test]
    fn only_an_open_question_takes_one_of_its_choices() {
        let mut body = question();
        assert!(fill(&mut body, "maybe", None).is_err());
        let filled = Values::from([("x".to_owned(), FieldValue::Toggle(true))]);
        assert!(fill(&mut body, "allow", Some(filled)).is_err(), "no form");
        assert!(fill(&mut body, "allow", None).is_ok());
        assert!(
            matches!(&body, Body::Question { state: QuestionState::Answered, answer: Some(a), .. } if a == "allow")
        );
        assert!(
            fill(&mut body, "reject", None).is_err(),
            "it has its answer"
        );
        assert!(close(&mut body));
        assert!(!close(&mut body), "closed once");
        assert!(fill(&mut body, "allow", None).is_err());
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
            plan: None,
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
                fill(&mut form(), "accept", wrong.clone()).is_err(),
                "{wrong:?}"
            );
        }
        let mut body = form();
        let right = given(&[
            ("colour", text("Blue")),
            ("count", FieldValue::Number(2.into())),
        ]);
        fill(&mut body, "accept", right.clone()).unwrap();
        assert!(matches!(&body, Body::Question { values, .. } if *values == right));

        let mut body = form();
        let with_key = given(&[("colour", text("Red")), ("key", text("s3cret"))]);
        let filled = fill(&mut body, "accept", with_key).unwrap().unwrap();
        assert_eq!(filled.secret, given(&[("key", text("s3cret"))]).unwrap());
        let kept = given(&[("colour", text("Red")), ("key", text(MASK))]);
        assert_eq!(Some(filled.kept), kept);
        assert!(
            matches!(&body, Body::Question { values, .. } if *values == kept),
            "the Thread never holds a secret"
        );

        let mut skipped = form();
        fill(&mut skipped, "decline", None).unwrap();
        assert!(matches!(&skipped, Body::Question { values: None, .. }));
    }
}
