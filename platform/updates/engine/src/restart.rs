//! When the engine moves onto a copy in place (ADR 0119, decision 3): the
//! policy, one pure function of what holds now ([`next`], and [`now`] for
//! the Person's Update), apart from the mechanism, which is the
//! engine's ([`Restart`]: the module asks, the engine stops as a TERM
//! stops it and runs the new copy in its place).
//!
//! Nothing runs means no Turn runs, no terminal is open, as a restart
//! still ends them (#462), and no key reached one in the last
//! [`QUIET_MS`]: the keys the Person types into this machine's terminals,
//! the one input the engine itself receives. A Thread's composer is the
//! window's, and a Turn it sends holds the restart anyway.

use banda_kernel::InHand;
use banda_machines::TakeUpdates;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;
use ts_rs::TS;

/// How long after a key the engine still waits: it never restarts under
/// the Person's hands.
pub const QUIET_MS: i64 = 10 * 60 * 1000;

/// How this engine can move onto another copy, as it was started.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Moves {
    /// It runs the new copy in its own place: the session's service,
    /// macOS's launchd job, or an engine started in a shell.
    Itself,
    /// It cannot, and why, in words: the window's child moves as Banda
    /// restarts.
    Never(String),
}

/// What holds now, for [`next`] and [`now`].
#[derive(Clone, Debug)]
pub struct Facts<'a> {
    /// Whether a copy waits in place to be moved onto.
    pub ready: bool,
    /// What machine.toml says of updates.
    pub take: TakeUpdates,
    pub moves: &'a Moves,
    /// The Turns that run on this machine.
    pub turns: usize,
    pub in_hand: InHand,
    /// Now, in ms since the epoch.
    pub now: i64,
}

/// What a copy in place waits for before the engine moves onto it, as
/// `updates.state` says it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "updates/")]
pub struct Waits {
    /// The Turns that run.
    #[serde(default)]
    pub turns: u32,
    /// The terminals open, which a restart would end.
    #[serde(default)]
    pub terminals: u32,
    /// Until when the Person's last key holds it, in ms since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub typed_until: Option<i64>,
    /// The Person: machine.toml says `updates = "ask"`.
    #[serde(default)]
    pub person: bool,
    /// Why this engine does not move by itself, in words: it moves as
    /// Banda restarts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub restart: Option<String>,
}

/// What the engine does with a copy in place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Next {
    /// There is none, or machine.toml says `updates = "off"`.
    Nothing,
    /// Nothing runs: it moves now.
    Move,
    /// It waits for what [`Waits`] says.
    Wait(Waits),
}

/// What the engine does by itself, by what holds now.
pub fn next(facts: &Facts<'_>) -> Next {
    if !facts.ready || facts.take == TakeUpdates::Off {
        return Next::Nothing;
    }
    if let Moves::Never(why) = facts.moves {
        return Next::Wait(Waits {
            restart: Some(why.clone()),
            ..Waits::default()
        });
    }
    if facts.take == TakeUpdates::Ask {
        return Next::Wait(Waits {
            person: true,
            ..Waits::default()
        });
    }
    let typed_until = (facts.in_hand.typed)
        .map(|typed| typed + QUIET_MS)
        .filter(|until| *until > facts.now);
    let waits = Waits {
        turns: u32::try_from(facts.turns).unwrap_or(u32::MAX),
        terminals: u32::try_from(facts.in_hand.terminals).unwrap_or(u32::MAX),
        typed_until,
        ..Waits::default()
    };
    if waits == Waits::default() {
        Next::Move
    } else {
        Next::Wait(waits)
    }
}

/// What the Person's Update does at once (ADR 0137, decisions 3 and 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Does {
    /// The engine moves onto the copy in place.
    pub engine: bool,
    /// The app is asked to restart into its version ready.
    pub app: bool,
    /// The rest waits until no Turn runs.
    pub held: bool,
}

/// What the Person's Update does now, or why nothing, in words: the
/// engine moves where a copy is ready and it moves by itself, and the
/// app restarts where it has a version ready (`app`). While Turns run
/// that this would end, it refuses, unless `force`, as the Person said
/// to stop them; or holds what ends them until none runs, with `wait`.
/// Open terminals and keys hold it not: the Person asks.
pub fn now(facts: &Facts<'_>, app: bool, force: bool, wait: bool) -> Result<Does, Refused> {
    let itself = matches!(facts.moves, Moves::Itself);
    let engine = facts.ready && itself;
    if !engine && !app {
        return Err(match facts.moves {
            Moves::Never(why) if facts.ready => Refused::Never(why.clone()),
            _ => Refused::Nothing,
        });
    }
    // What ends the Turns: the engine's move, or the app's restart where
    // the engine stops with the app.
    let stops = engine || !itself;
    if stops && facts.turns > 0 && !force {
        if !wait {
            return Err(Refused::Working(facts.turns));
        }
        // An app's restart beside an engine that goes on ends nothing.
        return Ok(Does {
            engine: false,
            app: app && itself,
            held: true,
        });
    }
    Ok(Does {
        engine,
        app,
        held: false,
    })
}

/// Why an Update did nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    /// No copy waits: this one is the newest in place.
    Nothing,
    /// This engine does not move by itself, and why.
    Never(String),
    /// This many Turns run, and the Person has not said to stop them.
    Working(usize),
}

/// How the updates module asks the engine to move onto a copy: the
/// engine stops as asked to, then runs the program in its own place.
#[derive(Clone, Debug)]
pub struct Restart(Arc<Asked>);

#[derive(Debug)]
struct Asked {
    moves: Moves,
    to: watch::Sender<Option<PathBuf>>,
}

impl Restart {
    /// A restart of an engine that moves as `moves` says.
    pub fn new(moves: Moves) -> Restart {
        Restart(Arc::new(Asked {
            moves,
            to: watch::Sender::new(None),
        }))
    }

    pub fn moves(&self) -> &Moves {
        &self.0.moves
    }

    /// Asks the engine to stop and run `program` in its place; the first
    /// asked holds.
    pub fn ask(&self, program: PathBuf) {
        self.0.to.send_if_modified(|to| {
            let first = to.is_none();
            if first {
                *to = Some(program);
            }
            first
        });
    }

    /// Whether it was asked already: the engine stops, and moves.
    pub fn moving(&self) -> bool {
        self.0.to.borrow().is_some()
    }

    /// The program to run in this one's place, once asked.
    pub async fn asked(&self) -> PathBuf {
        let mut to = self.0.to.subscribe();
        loop {
            if let Some(program) = to.borrow_and_update().clone() {
                return program;
            }
            if to.changed().await.is_err() {
                return std::future::pending().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_000_000_000;

    fn idle(moves: &Moves) -> Facts<'_> {
        Facts {
            ready: true,
            take: TakeUpdates::WhenIdle,
            moves,
            turns: 0,
            in_hand: InHand::default(),
            now: NOW,
        }
    }

    #[test]
    fn it_moves_by_itself_once_nothing_runs() {
        let itself = Moves::Itself;
        let child = Moves::Never("The window's child moves as Banda restarts".to_owned());
        let typed = |ago| InHand {
            typed: Some(NOW - ago),
            ..InHand::default()
        };
        let wait = |waits| Next::Wait(waits);
        let table: Vec<(&str, Facts<'_>, Next)> = vec![
            ("idle", idle(&itself), Next::Move),
            (
                "no copy waits",
                Facts {
                    ready: false,
                    ..idle(&itself)
                },
                Next::Nothing,
            ),
            (
                "off",
                Facts {
                    take: TakeUpdates::Off,
                    turns: 2,
                    ..idle(&itself)
                },
                Next::Nothing,
            ),
            (
                "ask",
                Facts {
                    take: TakeUpdates::Ask,
                    ..idle(&itself)
                },
                wait(Waits {
                    person: true,
                    ..Waits::default()
                }),
            ),
            (
                "the window's child",
                idle(&child),
                wait(Waits {
                    restart: Some("The window's child moves as Banda restarts".to_owned()),
                    ..Waits::default()
                }),
            ),
            (
                "Turns run",
                Facts {
                    turns: 2,
                    ..idle(&itself)
                },
                wait(Waits {
                    turns: 2,
                    ..Waits::default()
                }),
            ),
            (
                "a terminal is open",
                Facts {
                    in_hand: InHand {
                        terminals: 1,
                        typed: None,
                    },
                    ..idle(&itself)
                },
                wait(Waits {
                    terminals: 1,
                    ..Waits::default()
                }),
            ),
            (
                "a key a minute ago",
                Facts {
                    in_hand: typed(60_000),
                    ..idle(&itself)
                },
                wait(Waits {
                    typed_until: Some(NOW - 60_000 + QUIET_MS),
                    ..Waits::default()
                }),
            ),
            (
                "a key ten minutes ago",
                Facts {
                    in_hand: typed(QUIET_MS),
                    ..idle(&itself)
                },
                Next::Move,
            ),
            (
                "all at once",
                Facts {
                    turns: 1,
                    in_hand: InHand {
                        terminals: 3,
                        typed: Some(NOW),
                    },
                    ..idle(&itself)
                },
                wait(Waits {
                    turns: 1,
                    terminals: 3,
                    typed_until: Some(NOW + QUIET_MS),
                    ..Waits::default()
                }),
            ),
        ];
        for (what, facts, expected) in table {
            assert_eq!(next(&facts), expected, "{what}");
        }
    }

    #[test]
    fn an_update_warns_only_while_turns_run() {
        let itself = Moves::Itself;
        let engine = Does {
            engine: true,
            app: false,
            held: false,
        };
        let busy = Facts {
            turns: 2,
            in_hand: InHand {
                terminals: 1,
                typed: Some(NOW),
            },
            take: TakeUpdates::Off,
            ..idle(&itself)
        };
        assert_eq!(now(&busy, false, false, false), Err(Refused::Working(2)));
        assert_eq!(
            now(&busy, false, true, false),
            Ok(engine),
            "the Person said to"
        );
        let no_turns = Facts { turns: 0, ..busy };
        assert_eq!(
            now(&no_turns, false, false, false),
            Ok(engine),
            "terminals and keys hold it not"
        );
        let none = Facts {
            ready: false,
            ..idle(&itself)
        };
        assert_eq!(now(&none, false, true, false), Err(Refused::Nothing));
        let child = Moves::Never("why".to_owned());
        assert_eq!(
            now(&idle(&child), false, true, false),
            Err(Refused::Never("why".to_owned()))
        );
    }

    #[test]
    fn one_update_takes_the_engine_and_the_app_and_waits_only_for_what_it_would_stop() {
        let itself = Moves::Itself;
        let child = Moves::Never("why".to_owned());
        let does = |engine, app, held| Ok(Does { engine, app, held });
        // Nothing runs: both go, each where it has something ready.
        assert_eq!(
            now(&idle(&itself), true, false, false),
            does(true, true, false)
        );
        let none = Facts {
            ready: false,
            ..idle(&itself)
        };
        assert_eq!(now(&none, true, false, false), does(false, true, false));
        assert_eq!(
            now(&idle(&child), true, false, false),
            does(false, true, false)
        );
        // Agents work. An engine that goes on is not stopped by its app's
        // restart; one that moves, or stops with the app, is.
        let busy = |moves| Facts {
            turns: 1,
            ..idle(moves)
        };
        let app_only = Facts {
            ready: false,
            ..busy(&itself)
        };
        assert_eq!(now(&app_only, true, false, false), does(false, true, false));
        assert_eq!(
            now(&busy(&itself), true, false, false),
            Err(Refused::Working(1))
        );
        assert_eq!(
            now(&busy(&child), true, false, false),
            Err(Refused::Working(1))
        );
        // Waiting: the app restarts now where that ends nothing, and the
        // rest is held.
        assert_eq!(
            now(&busy(&itself), true, false, true),
            does(false, true, true)
        );
        assert_eq!(
            now(&busy(&child), true, false, true),
            does(false, false, true)
        );
        assert_eq!(
            now(&busy(&child), true, true, false),
            does(false, true, false)
        );
    }

    #[tokio::test]
    async fn the_first_program_asked_holds() {
        let restart = Restart::new(Moves::Itself);
        let heard = restart.clone();
        let asked = tokio::spawn(async move { heard.asked().await });
        restart.ask(PathBuf::from("/a/banda"));
        restart.ask(PathBuf::from("/b/banda"));
        assert_eq!(asked.await.unwrap(), PathBuf::from("/a/banda"));
        assert_eq!(
            restart.asked().await,
            PathBuf::from("/a/banda"),
            "asked later too"
        );
    }
}
