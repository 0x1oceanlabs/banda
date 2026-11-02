//! A turn's moves (ADR 0018, decision 1): one pure function, [`next`],
//! says what each event does to a turn. The rules a Person's commands ask
//! (`can`, `may_start`, `stop`, `waits`, `may_change`, `retry`, `steers`)
//! are questions to it. Step 3 adds the events the writer gives, with the
//! facts and effects of each step.

use crate::model::TurnState;
use banda_kernel::Refusal;

/// What the engine knows of a turn when something happens to it.
#[derive(Clone, Copy, Debug)]
pub struct TurnFacts {
    pub state: TurnState,
    /// The Agent opened it by itself, between turns.
    pub by_itself: bool,
    /// No turn ran its message before it ([`super::Position::first`]).
    pub first: bool,
    /// It is the Thread's latest that began ([`super::Position::latest`]).
    pub latest: bool,
    /// Its Thread's queue waits for a Person.
    pub held: bool,
    /// A turn of its Thread runs.
    pub works: bool,
}

impl TurnFacts {
    /// A Person's turn of `state`, first and latest of its Thread, whose
    /// queue goes on.
    pub fn of(state: TurnState) -> TurnFacts {
        TurnFacts {
            state,
            by_itself: false,
            first: true,
            latest: true,
            held: false,
            works: false,
        }
    }
}

/// What happened to a turn.
#[derive(Clone, Copy, Debug)]
pub enum Event {
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
    /// A Person tries it again: a new turn runs its message, and it stays
    /// as it ended.
    Retry,
    /// A Person forks its Thread at its end (ADR 0027); it stays as it
    /// ended.
    Fork,
}

/// What an event does to a turn.
#[derive(Debug, PartialEq, Eq)]
pub struct Step {
    /// Its state after.
    pub state: TurnState,
    /// It holds the Thread's queue now.
    pub held: bool,
}

const ENDED: &str = "This turn has ended.";
const TAKEN: &str = "The Agent has taken this message, so it can no longer be changed.";
const READ: &str = "The Agent has read this message, so it can no longer be changed.";

/// What `event` does to `turn`, or why it cannot happen. A late event, as
/// a steer into a turn that ended, is refused like any other.
pub fn next(turn: &TurnFacts, event: Event) -> Result<Step, Refusal> {
    use TurnState::{Failed, Interrupted, Queued, Running, Stopped, Withdrawn};
    let to = |state| Ok(Step { state, held: false });
    let state = turn.state;
    match event {
        // A turn stopped while it waited never runs; one in a held queue
        // waits until a Person lets the queue go. Step 3 makes a START
        // that finds another turn running wait for its end too.
        Event::Start if state != Queued => Err(Refusal::conflict("This turn no longer waits.")),
        Event::Start if turn.held => {
            Err(Refusal::conflict("The Thread's queue waits for a Person."))
        }
        Event::Start => to(Running),
        // A turn that waits ends now and never runs; one that runs is
        // asked to stop, and holds the queue behind it.
        Event::Stop if state == Queued => to(Stopped),
        Event::Stop if state == Running => Ok(Step { state, held: true }),
        Event::Stop => Err(Refusal::conflict(ENDED)),
        Event::Change | Event::Withdraw if state != Queued => Err(Refusal::invalid(TAKEN)),
        // One tried again cannot change: a turn already ran its message.
        Event::Change if !turn.first => Err(Refusal::invalid(READ)),
        Event::Change => to(Queued),
        Event::Withdraw => to(Withdrawn),
        // It runs, its queue is not held, and a Person asked for it: one
        // the Agent went on with by itself takes a message as a turn of
        // its own.
        Event::Steer if state != Running => {
            Err(Refusal::conflict("Only a turn that runs takes a message."))
        }
        Event::Steer if turn.by_itself => Err(Refusal::invalid(
            "The Agent went on by itself, so a message waits for a turn of its own.",
        )),
        Event::Steer if turn.held => Err(Refusal::conflict(
            "This turn is stopping, so a message waits for a turn of its own.",
        )),
        Event::Steer => to(Running),
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
        Event::Fork => to(state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use TurnState::{Done, Failed, Interrupted, Queued, Running, Stopped, Withdrawn};

    /// The state a step moves to, `H` when it holds the queue, `-` when
    /// the event is refused.
    fn moved(turn: &TurnFacts, event: Event) -> String {
        match next(turn, event) {
            Ok(Step { state, held }) => format!("{state:?}{}", if held { " H" } else { "" }),
            Err(_) => "-".to_owned(),
        }
    }

    #[test]
    fn every_event_moves_each_state_of_a_turn_or_is_refused() {
        use Event::{Change, Fork, Retry, Start, Steer, Stop, Withdraw};
        #[rustfmt::skip]
        let table = [
            //            Start      Stop         Change    Withdraw     Steer      Retry          Fork
            (Queued,      ["Running", "Stopped",   "Queued", "Withdrawn", "-",       "-",           "-"]),
            (Running,     ["-",       "Running H", "-",      "-",         "Running", "-",           "-"]),
            (Done,        ["-",       "-",         "-",      "-",         "-",       "-",           "Done"]),
            (Stopped,     ["-",       "-",         "-",      "-",         "-",       "-",           "Stopped"]),
            (Failed,      ["-",       "-",         "-",      "-",         "-",       "Failed",      "Failed"]),
            (Interrupted, ["-",       "-",         "-",      "-",         "-",       "Interrupted", "Interrupted"]),
            (Withdrawn,   ["-",       "-",         "-",      "-",         "-",       "-",           "-"]),
        ];
        for (state, row) in table {
            let events = [Start, Stop, Change, Withdraw, Steer, Retry, Fork];
            for (event, want) in events.into_iter().zip(row) {
                let turn = TurnFacts::of(state);
                assert_eq!(moved(&turn, event), want, "{state:?} {event:?}");
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
        let own = |state| TurnFacts {
            by_itself: true,
            ..of(state)
        };
        #[rustfmt::skip]
        let cases = [
            ("a held queue",     held(Queued),                              Event::Start,  "-"),
            ("a turn ran it",    TurnFacts { first: false, ..of(Queued) },  Event::Change, "-"),
            ("a stop asked",     held(Running),                             Event::Steer,  "-"),
            ("the Agent's own",  own(Running),                              Event::Steer,  "-"),
            ("the Agent's own",  own(Running),                              Event::Stop,   "Running H"),
            ("the Agent's own",  own(Failed),                               Event::Retry,  "-"),
            ("not the latest",   TurnFacts { latest: false, ..of(Failed) }, Event::Retry,  "-"),
            ("its Thread works", TurnFacts { works: true, ..of(Done) },     Event::Fork,   "-"),
        ];
        for (why, turn, event, want) in cases {
            assert_eq!(moved(&turn, event), want, "{why}");
        }
    }
}
