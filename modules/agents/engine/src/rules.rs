//! The agents module's decisions and state machines. Pure: no database,
//! clock, randomness or Harness protocol. IDs come in from the caller.

use crate::model::{Body, Choice, Fact, ItemId, QuestionState, TurnId, TurnState};
use bandaso_kernel::Refusal;

/// Whether a turn may start now: it waits, and nobody stopped it.
pub fn may_start(state: TurnState) -> bool {
    state == TurnState::Queued
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
        TurnState::Done | TurnState::Stopped | TurnState::Failed | TurnState::Interrupted => {
            Stop::Nothing
        }
    }
}

/// How a turn that the Harness ended as cancelled ends: stopped when a
/// Person asked for it, failed otherwise, so nobody reads a stop that no
/// Person made.
pub fn cancelled(stop_asked: bool) -> (TurnState, Option<String>) {
    if stop_asked {
        (TurnState::Stopped, None)
    } else {
        (
            TurnState::Failed,
            Some("The Harness ended the turn by itself.".to_owned()),
        )
    }
}

/// An answer as the Harness offers it.
pub struct Offered {
    pub id: String,
    pub name: String,
    pub allows: bool,
    /// The Harness would remember this answer for next time.
    pub always: bool,
}

/// The choices a Question shows: the Harness's own, unchanged, without its
/// "always" answers. A Harness writes those to files the Agent itself can
/// change (ADR 0001, decision 7).
pub fn choices(offered: Vec<Offered>) -> Vec<Choice> {
    offered
        .into_iter()
        .filter(|o| !o.always)
        .map(|o| Choice {
            id: o.id,
            name: o.name,
            allows: o.allows,
        })
        .collect()
}

/// Answers a Question with one of its choices.
pub fn answer(body: &mut Body, choice: &str) -> Result<(), Refusal> {
    let Body::Question {
        state,
        choices,
        answer,
        ..
    } = body
    else {
        return Err(Refusal::invalid("This item is not a Question."));
    };
    match state {
        QuestionState::Open if choices.iter().any(|c| c.id == choice) => {
            *state = QuestionState::Answered;
            *answer = Some(choice.to_owned());
            Ok(())
        }
        QuestionState::Open => Err(Refusal::invalid(
            "This Question does not offer that answer.",
        )),
        QuestionState::Answered => Err(Refusal::conflict("This Question has its answer.")),
        QuestionState::Closed => Err(Refusal::conflict(
            "This Question closed: its turn ended before an answer.",
        )),
    }
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
pub fn title(text: &str) -> String {
    const LONGEST: usize = 60;
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= LONGEST {
        return line;
    }
    let mut short: String = line.chars().take(LONGEST - 1).collect();
    short.push('…');
    short
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
            Text::Reply => Body::Message { text },
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
    fn a_turn_starts_once_and_stops_by_its_state() {
        assert!(may_start(TurnState::Queued));
        assert!(!may_start(TurnState::Running));
        assert_eq!(stop(TurnState::Queued), Stop::Now);
        assert_eq!(stop(TurnState::Running), Stop::AskHarness);
        for ended in [
            TurnState::Done,
            TurnState::Stopped,
            TurnState::Failed,
            TurnState::Interrupted,
        ] {
            assert_eq!(stop(ended), Stop::Nothing);
            assert!(!ongoing(ended));
        }
        assert_eq!(cancelled(true).0, TurnState::Stopped);
        assert_eq!(
            cancelled(false).0,
            TurnState::Failed,
            "no Person stopped it"
        );
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
            state: QuestionState::Open,
            answer: None,
        }
    }

    #[test]
    fn a_question_never_offers_the_harness_always_answers() {
        let Body::Question { choices, .. } = question() else {
            unreachable!()
        };
        let ids: Vec<_> = choices.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["allow", "reject"]);
    }

    #[test]
    fn only_an_open_question_takes_one_of_its_choices() {
        let mut body = question();
        assert!(answer(&mut body, "always").is_err());
        assert!(answer(&mut body, "allow").is_ok());
        assert!(
            matches!(&body, Body::Question { state: QuestionState::Answered, answer: Some(a), .. } if a == "allow")
        );
        assert!(answer(&mut body, "reject").is_err(), "it has its answer");
        assert!(close(&mut body));
        assert!(!close(&mut body), "closed once");
        assert!(answer(&mut body, "allow").is_err());
    }

    #[test]
    fn a_title_is_one_short_line() {
        assert_eq!(title("  Fix\nthe   report "), "Fix the report");
        let long = title(&"word ".repeat(30));
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('…'));
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
