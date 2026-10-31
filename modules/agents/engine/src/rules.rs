//! The agents module's decisions and state machines. Pure: no database,
//! clock, randomness or Harness protocol. IDs come in from the caller.

use crate::model::{
    Body, Choice, Fact, Failure, ItemId, Mode, QuestionState, ToolKind, TurnId, TurnState,
};
use bandaso_kernel::{Participant, Refusal};

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
            state: QuestionState::Open,
            answer: None,
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
        assert!(answer(&mut body, "maybe").is_err());
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
