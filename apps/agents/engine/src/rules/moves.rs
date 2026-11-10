//! A turn's moves (ADR 0018, decision 1): one pure function, [`next`],
//! says what each event does to a turn, and the writer (`writer.rs`)
//! writes the [`Step`] it gives. The rules a Person's commands ask (`can`,
//! `waits`, `may_change`, `retry`, `steers`) are questions to it.

use super::Ending;
use crate::model::{Failure, TurnState};
use banda_kernel::Refusal;

/// What the engine knows of a turn when something happens to it.
#[derive(Clone, Copy, Debug)]
pub struct TurnFacts {
    pub state: TurnState,
    /// The Agent opened it by itself, between turns.
    pub by_itself: bool,
    /// A Person's message opened it, not an Agent's.
    pub by_person: bool,
    /// No turn ran its message before it ([`super::Position::first`]).
    pub first: bool,
    /// It is the Thread's latest that began ([`super::Position::latest`]).
    pub latest: bool,
    /// Its Thread's queue waits for a Person.
    pub held: bool,
    /// It runs and was asked to stop: by a Person, or by Banda for a
    /// message its Harness cannot take while it works.
    pub stopping: bool,
    /// A turn of its Thread runs.
    pub works: bool,
    /// The turn that runs is one the Agent opened by itself.
    pub own_works: bool,
    /// A turn of its Thread waits in its queue.
    pub waits: bool,
    /// A sub-agent of its Thread is at work: it runs or asks (ADR 0103).
    pub lanes: bool,
    /// A direct one is, one the Agent started itself.
    #[expect(
        dead_code,
        reason = "the Thread's Stop reaches them from ADR 0103's E2"
    )]
    pub lanes_direct: bool,
}

impl TurnFacts {
    /// A Person's turn of `state`, first and latest of its Thread, whose
    /// queue goes on.
    pub fn of(state: TurnState) -> TurnFacts {
        TurnFacts {
            state,
            by_itself: false,
            by_person: true,
            first: true,
            latest: true,
            held: false,
            stopping: false,
            works: false,
            own_works: false,
            waits: false,
            lanes: false,
            lanes_direct: false,
        }
    }
}

/// What happened to a turn.
#[derive(Clone, Debug)]
pub enum Event {
    /// A new turn waits behind its Thread's earlier turns, for the outbox
    /// to start it.
    Queue,
    /// The Agent opens a new turn by itself, between turns: it runs from
    /// now.
    Open,
    /// The outbox starts it (`turn.start`).
    Start,
    /// A Person stops it.
    Stop,
    /// A Person changes its waiting message.
    Change,
    /// A Person takes its waiting message back.
    Withdraw,
    /// A message sent now goes into it.
    Steer,
    /// Banda stops it for a message its Harness cannot take while it
    /// works: the message gets a turn of its own.
    GiveWay,
    /// A Person tries it again: a new turn runs its message, and it stays
    /// as it ended.
    Retry,
    /// A Person forks its Thread at its end (ADR 0027); it stays as it
    /// ended.
    Fork,
    /// A Person takes its Thread back to before its message, to edit it
    /// (ADR 0027); it leaves the Thread, with every turn after it.
    Rewind,
    /// Its Harness ended it so, or Banda did for it.
    End(Ending),
    /// A restart cut it short: the Harness that ran it is gone.
    CutShort,
}

/// What an event does to a turn.
#[derive(Debug, PartialEq, Eq)]
pub struct Step {
    /// Its state after.
    pub state: TurnState,
    /// It holds the Thread's queue now.
    pub held: bool,
    /// How it ended, when this step ends it.
    pub ending: Option<Ending>,
    /// What the step sets going.
    pub then: Option<Then>,
}

/// What a step sets going, besides the turn's own state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Then {
    /// The outbox starts it, after the Thread's earlier turns.
    Start,
    /// It is stopping: the outbox asks its Harness to stop it, and it
    /// ends when the Harness does.
    AskStop,
    /// The Agent's own turn that runs ends: the Harness takes this turn's
    /// prompt into what it does.
    HandOver,
}

impl Step {
    fn to(state: TurnState) -> Step {
        Step {
            state,
            held: false,
            ending: None,
            then: None,
        }
    }

    fn ended(ending: Ending) -> Step {
        let state = ending.state;
        Step {
            ending: Some(ending),
            ..Step::to(state)
        }
    }

    fn holding(self, held: bool) -> Step {
        Step { held, ..self }
    }

    fn then(self, then: Then) -> Step {
        Step {
            then: Some(then),
            ..self
        }
    }
}

const ENDED: &str = "This turn has ended.";
const TAKEN: &str = "The Agent has taken this message, so it can no longer be changed.";
const READ: &str = "The Agent has read this message, so it can no longer be changed.";

/// What `event` does to `turn`, or why it cannot happen. A late event, as
/// a steer into a turn that ended, or a Harness ending a turn that ended,
/// is refused like any other.
pub fn next(turn: &TurnFacts, event: Event) -> Result<Step, Refusal> {
    use TurnState::{Failed, Interrupted, Queued, Running, Stopped, Withdrawn};
    let to = |state| Ok(Step::to(state));
    let state = turn.state;
    // A Thread runs one turn at a time.
    let other = || Err(Refusal::conflict("Another turn runs in this Thread."));
    match event {
        Event::Queue | Event::Open | Event::Start if state != Queued => {
            Err(Refusal::conflict("This turn no longer waits."))
        }
        Event::Queue => Ok(Step::to(Queued).then(Then::Start)),
        // What the Agent does by itself opens a turn once the one that ran
        // has ended, held queue or not: it already works.
        Event::Open if turn.works => other(),
        Event::Open => to(Running),
        // A turn stopped while it waited never runs; one in a held queue
        // waits until a Person lets the queue go. One that finds the
        // Agent's own turn running takes it over, as the Harness takes its
        // prompt into what it does.
        Event::Start if turn.held => {
            Err(Refusal::conflict("The Thread's queue waits for a Person."))
        }
        Event::Start if turn.own_works => Ok(Step::to(Running).then(Then::HandOver)),
        Event::Start if turn.works => other(),
        Event::Start => to(Running),
        // A turn that waits ends now and never runs; one that runs is
        // asked to stop, and holds the queue behind it.
        Event::Stop if state == Queued => Ok(Step::ended(Ending::new(Stopped, None))),
        Event::Stop if state == Running => Ok(Step::to(Running).holding(true).then(Then::AskStop)),
        Event::Stop => Err(Refusal::conflict(ENDED)),
        Event::Change | Event::Withdraw if state != Queued => Err(Refusal::invalid(TAKEN)),
        // One tried again cannot change: a turn already ran its message.
        Event::Change if !turn.first => Err(Refusal::invalid(READ)),
        Event::Change => to(Queued),
        Event::Withdraw => Ok(Step::ended(Ending::new(Withdrawn, None))),
        // It runs, its queue is not held, and a Person asked for it: one
        // the Agent went on with by itself takes a message as a turn of
        // its own.
        Event::Steer | Event::GiveWay if state != Running => {
            Err(Refusal::conflict("Only a turn that runs takes a message."))
        }
        Event::Steer | Event::GiveWay if turn.by_itself => Err(Refusal::invalid(
            "The Agent went on by itself, so a message waits for a turn of its own.",
        )),
        Event::Steer | Event::GiveWay if turn.held || turn.stopping => Err(Refusal::conflict(
            "This turn is stopping, so a message waits for a turn of its own.",
        )),
        Event::Steer => to(Running),
        // Stopped for a message, it holds nothing: the message runs next.
        Event::GiveWay => Ok(Step::to(Running).then(Then::AskStop)),
        // A Person asked for it, it failed or was cut short, and nothing
        // came after it in its Thread.
        Event::Retry if turn.by_itself => Err(Refusal::invalid(
            "Only a turn a Person asked for can be tried again.",
        )),
        Event::Retry if !matches!(state, Failed | Interrupted) => Err(Refusal::invalid(
            "Only a turn that failed or was cut short can be tried again.",
        )),
        Event::Retry if !turn.latest => Err(Refusal::invalid(
            "Only the Thread's latest turn can be tried again.",
        )),
        Event::Retry => to(state),
        // It ran and ended, and its Thread does not work now.
        Event::Fork if matches!(state, Queued | Running | Withdrawn) => Err(Refusal::conflict(
            "A Thread is forked at the end of a turn that ran.",
        )),
        Event::Fork if turn.works => Err(Refusal::conflict(
            "The Thread can be forked once its turn ends.",
        )),
        // A fork's session could not reach a sub-agent still at work.
        Event::Fork if turn.lanes => Err(Refusal::conflict(
            "The Thread can be forked once its sub-agents end.",
        )),
        Event::Fork => to(state),
        // A Person's message a turn ran first, that turn ended, and
        // nothing runs or waits in its Thread.
        Event::Rewind if !turn.by_person || !turn.first => Err(Refusal::invalid(
            "Only a message a Person sent is edited from here.",
        )),
        Event::Rewind if matches!(state, Queued | Running | Withdrawn) => Err(Refusal::conflict(
            "A Thread goes back to a message a turn ran.",
        )),
        Event::Rewind if turn.works || turn.waits => Err(Refusal::conflict(
            "The Thread can go back once nothing runs or waits in it.",
        )),
        Event::Rewind if turn.lanes => Err(Refusal::conflict(
            "The Thread can go back once its sub-agents end.",
        )),
        Event::Rewind => to(state),
        // A turn ends once, and the queue waits behind it when its Harness
        // stopped, whoever opened it (ADR 0018, decision 4), so a waiting
        // message does not start on a Harness that just died unseen.
        Event::End(_) | Event::CutShort if !matches!(state, Queued | Running) => {
            Err(Refusal::conflict(ENDED))
        }
        Event::End(ending) => {
            let ending = match ending.state {
                // What the Agent did by itself was stopped once a stop was
                // asked, however its Harness ended it.
                _ if turn.by_itself && turn.stopping => Ending::new(Stopped, None),
                // A Harness that cancels a turn nobody stopped failed it, so
                // nobody reads a stop that no one made.
                Stopped if !turn.stopping => Ending::failed(
                    "The Harness ended the turn by itself.",
                    Some(Failure::Provider),
                ),
                _ => ending,
            };
            let died = ending.failure == Some(Failure::HarnessStopped);
            Ok(Step::ended(ending).holding(died))
        }
        // After a restart the queue waits for a Person, behind what was
        // sent to the Agent; a turn that never began waits in it.
        Event::CutShort => {
            let step = match state {
                Queued => Step::to(Queued),
                _ => Step::ended(Ending::cut_short()),
            };
            Ok(step.holding(!turn.by_itself))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use TurnState::{Done, Failed, Interrupted, Queued, Running, Stopped, Withdrawn};

    /// The state a step moves to, `H` when it holds the queue, and what it
    /// sets going; `-` when the event is refused.
    fn moved(turn: &TurnFacts, event: Event) -> String {
        match next(turn, event) {
            Ok(Step {
                state, held, then, ..
            }) => {
                let held = if held { " H" } else { "" };
                let then = then.map_or(String::new(), |then| format!(" {then:?}"));
                format!("{state:?}{held}{then}")
            }
            Err(_) => "-".to_owned(),
        }
    }

    fn done() -> Event {
        Event::End(Ending::new(Done, None))
    }

    fn own(state: TurnState) -> TurnFacts {
        TurnFacts {
            by_itself: true,
            ..TurnFacts::of(state)
        }
    }

    fn stopping(turn: TurnFacts) -> TurnFacts {
        TurnFacts {
            stopping: true,
            ..turn
        }
    }

    fn cancelled() -> Event {
        Event::End(Ending::new(Stopped, None))
    }

    fn harness_stopped() -> Event {
        Event::End(Ending::failed("It stopped.", Some(Failure::HarnessStopped)))
    }

    #[test]
    fn every_event_moves_each_state_of_a_turn_or_is_refused() {
        use Event::{
            Change, CutShort, Fork, Open, Queue, Retry, Rewind, Start, Steer, Stop, Withdraw,
        };
        #[rustfmt::skip]
        let table = [
            //            Queue           Open       Start      Stop                 Change    Withdraw     Steer      Retry          Fork           Rewind         End     CutShort
            (Queued,      ["Queued Start", "Running", "Running", "Stopped",           "Queued", "Withdrawn", "-",       "-",           "-",           "-",           "Done", "Queued H"]),
            (Running,     ["-",            "-",       "-",       "Running H AskStop", "-",      "-",         "Running", "-",           "-",           "-",           "Done", "Interrupted H"]),
            (Done,        ["-",            "-",       "-",       "-",                 "-",      "-",         "-",       "-",           "Done",        "Done",        "-",    "-"]),
            (Stopped,     ["-",            "-",       "-",       "-",                 "-",      "-",         "-",       "-",           "Stopped",     "Stopped",     "-",    "-"]),
            (Failed,      ["-",            "-",       "-",       "-",                 "-",      "-",         "-",       "Failed",      "Failed",      "Failed",      "-",    "-"]),
            (Interrupted, ["-",            "-",       "-",       "-",                 "-",      "-",         "-",       "Interrupted", "Interrupted", "Interrupted", "-",    "-"]),
            (Withdrawn,   ["-",            "-",       "-",       "-",                 "-",      "-",         "-",       "-",           "-",           "-",           "-",    "-"]),
        ];
        for (state, row) in table {
            let events = [
                Queue,
                Open,
                Start,
                Stop,
                Change,
                Withdraw,
                Steer,
                Retry,
                Fork,
                Rewind,
                done(),
                CutShort,
            ];
            for (event, want) in events.into_iter().zip(row) {
                let turn = TurnFacts::of(state);
                let what = format!("{state:?} {event:?}");
                assert_eq!(moved(&turn, event), want, "{what}");
            }
        }
    }

    #[test]
    fn what_a_turn_knows_changes_where_it_moves() {
        let of = TurnFacts::of;
        let held = |state| TurnFacts {
            held: true,
            ..of(state)
        };
        let works = |state| TurnFacts {
            works: true,
            ..of(state)
        };
        let own_works = |state| TurnFacts {
            own_works: true,
            ..works(state)
        };
        #[rustfmt::skip]
        let cases = [
            ("a held queue",     held(Queued),                              Event::Start,      "-"),
            ("one runs",         works(Queued),                             Event::Start,      "-"),
            ("the Agent's runs", own_works(Queued),                         Event::Start,      "Running HandOver"),
            ("one runs",         works(Queued),                             Event::Open,       "-"),
            ("the Agent's runs", own_works(Queued),                         Event::Open,       "-"),
            ("a held queue",     held(Queued),                              Event::Open,       "Running"),
            ("a turn ran it",    TurnFacts { first: false, ..of(Queued) },  Event::Change,     "-"),
            ("a stop asked",     held(Running),                             Event::Steer,      "-"),
            ("the Agent's own",  own(Running),                              Event::Steer,      "-"),
            ("the Agent's own",  own(Running),                              Event::Stop,       "Running H AskStop"),
            ("the Agent's own",  own(Failed),                               Event::Retry,      "-"),
            ("not the latest",   TurnFacts { latest: false, ..of(Failed) }, Event::Retry,      "-"),
            ("its Thread works", works(Done),                               Event::Fork,       "-"),
            ("its Thread works", works(Done),                               Event::Rewind,     "-"),
            ("a turn waits",     TurnFacts { waits: true, ..of(Done) },     Event::Rewind,     "-"),
            ("a waiting fork",   TurnFacts { waits: true, ..of(Done) },     Event::Fork,       "Done"),
            ("an Agent's word",  TurnFacts { by_person: false, ..of(Done) }, Event::Rewind,    "-"),
            ("tried again",      TurnFacts { first: false, ..of(Done) },    Event::Rewind,     "-"),
            ("its Harness died", of(Running),                               harness_stopped(), "Failed H"),
            ("the Agent's own",  own(Running),                              Event::CutShort,   "Interrupted"),
            ("its Harness died", own(Running),                              harness_stopped(), "Failed H"),
            ("cancelled unasked", of(Running),                              cancelled(),       "Failed"),
            ("cancelled asked",  stopping(of(Running)),                     cancelled(),       "Stopped"),
            ("asked, then done", stopping(of(Running)),                     done(),            "Done"),
            ("the Agent's own",  stopping(own(Running)),                    done(),            "Stopped"),
            ("for a message",    of(Running),                               Event::GiveWay,    "Running AskStop"),
            ("the Agent's own",  own(Running),                              Event::GiveWay,    "-"),
            ("a stop asked",     stopping(of(Running)),                     Event::GiveWay,    "-"),
            ("a stop asked",     stopping(of(Running)),                     Event::Steer,      "-"),
            ("it ended",         of(Done),                                  Event::GiveWay,    "-"),
        ];
        for (why, turn, event, want) in cases {
            assert_eq!(moved(&turn, event), want, "{why}");
        }
    }

    /// ADR 0103, Open questions: neither waits for a turn, both for a
    /// sub-agent at work, whichever way the turn ended.
    #[test]
    fn a_sub_agent_at_work_keeps_its_thread_from_forking_or_going_back() {
        for state in [Done, Stopped, Failed, Interrupted] {
            let lanes = TurnFacts {
                lanes: true,
                ..TurnFacts::of(state)
            };
            let direct = TurnFacts {
                lanes_direct: true,
                ..lanes
            };
            for (turn, event) in [
                (lanes, Event::Fork),
                (lanes, Event::Rewind),
                (direct, Event::Fork),
                (direct, Event::Rewind),
            ] {
                let what = format!("{state:?} {event:?}");
                let refused = next(&turn, event).unwrap_err();
                assert!(refused.message.contains("sub-agents end"), "{what}");
            }
            let at_rest = TurnFacts::of(state);
            assert_eq!(moved(&at_rest, Event::Fork), format!("{state:?}"));
            assert_eq!(moved(&at_rest, Event::Rewind), format!("{state:?}"));
        }
    }

    /// ADR 0018, decision 4: a row each.
    #[test]
    fn when_the_queue_waits_for_a_person_is_one_rule() {
        let of = TurnFacts::of;
        let asked = stopping(of(Running));
        #[rustfmt::skip]
        let rows = [
            ("a Person stopped it",                     of(Running),  Event::Stop,       true),
            ("its Harness stopped",                     of(Running),  harness_stopped(), true),
            ("its Harness stopped, the Agent's own",    own(Running), harness_stopped(), true),
            ("a restart, a Person's turn ran",          of(Running),  Event::CutShort,   true),
            ("a restart, a Person's turn was starting", of(Queued),   Event::CutShort,   true),
            ("a restart, the Agent's own ran",          own(Running), Event::CutShort,   false),
            ("Banda stopped it for a message",          of(Running),  Event::GiveWay,    false),
            ("its Harness stopped it, as asked",        asked,        cancelled(),       false),
            ("it ended",                                of(Running),  done(),            false),
            ("it failed",                               of(Running),  Event::End(Ending::failed("No.", None)), false),
        ];
        for (why, turn, event, holds) in rows {
            assert_eq!(next(&turn, event).unwrap().held, holds, "{why}");
        }
    }

    #[test]
    fn a_step_that_ends_a_turn_says_how() {
        let stopped = next(&TurnFacts::of(Running), harness_stopped()).unwrap();
        assert_eq!(
            stopped.ending.and_then(|e| e.failure),
            Some(Failure::HarnessStopped)
        );
        let cut = next(&TurnFacts::of(Running), Event::CutShort).unwrap();
        assert_eq!(cut.ending, Some(Ending::cut_short()));
        let asked = next(&TurnFacts::of(Running), Event::Stop).unwrap();
        assert_eq!(asked.ending, None, "it ends when its Harness does");
    }
}
