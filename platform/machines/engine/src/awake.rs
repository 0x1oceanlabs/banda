//! Keeps this machine from idle sleep while its Agents work, and while it
//! is on power when the Person says so (ADR 0097, decisions 1 to 4). The
//! engine takes one hold at a time, by its system's own means, named
//! "Banda" with why: macOS's power assertion, as `caffeinate -i` makes
//! one, and logind's `idle` and `sleep` locks on Linux. Windows takes
//! none yet (ADR 0090).
//!
//! Only idle sleep: the display still sleeps, and the Person's own Sleep,
//! a closed lid and a low battery still sleep the machine. Banda never
//! changes the system's power settings. The system lets the hold go as
//! the engine ends, however it ends.
//!
//! [`why`] is the rule, a plain function. [`keep`] follows the count of
//! running Turns, `machine.toml` and the power source, and holds the
//! machine as the rule says, through a [`System`]: the tests give it one
//! of their own.

use std::time::Duration;
use tokio::sync::watch;
use tokio::time::Instant;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

/// How long the machine stays awake after the last Turn ended, so the
/// Person's next message, sent from another machine, finds it awake.
pub const TAIL: Duration = Duration::from_secs(10 * 60);

/// How often the power source is read, while it matters.
const POWER_EVERY: Duration = Duration::from_secs(30);

/// When this machine stays awake, as its `machine.toml` says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Awake {
    /// While its Agents work, and for [`TAIL`] after.
    pub while_working: bool,
    /// While it is on power, Agents or none.
    pub plugged_in: bool,
}

/// Why the machine is held awake.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    /// A Turn runs here, or one ended less than [`TAIL`] ago.
    Working,
    /// It is on power, and the Person said to stay awake then.
    PluggedIn,
}

impl Why {
    /// What the hold says, after "Banda".
    pub fn words(self) -> &'static str {
        match self {
            Why::Working => "Agents work",
            Why::PluggedIn => "Plugged in",
        }
    }
}

/// Why the machine is held awake now, if it is: while Agents work, as
/// `awake` allows, `working` Turns running or the last one ended less than
/// `tail` ago (`since_ended`); else while plugged in, as it allows, and
/// `on_power`. Agents at work say why first. The engine's tail is
/// [`TAIL`].
pub fn why(
    awake: Awake,
    working: usize,
    since_ended: Option<Duration>,
    tail: Duration,
    on_power: bool,
) -> Option<Why> {
    let in_tail = since_ended.is_some_and(|since| since < tail);
    if awake.while_working && (working > 0 || in_tail) {
        Some(Why::Working)
    } else if awake.plugged_in && on_power {
        Some(Why::PluggedIn)
    } else {
        None
    }
}

/// What holds a machine awake, and reads its power source: the system's
/// own, or a test's.
#[async_trait::async_trait]
pub(crate) trait System: Send + 'static {
    /// The hold: while it is kept, the machine does not idle-sleep; dropped,
    /// it lets go.
    type Held: Send;

    /// Takes a hold named "Banda" that says `why`. What the system refuses
    /// is said in the log, once, and the hold is what it granted.
    async fn take(&mut self, why: Why) -> Self::Held;

    /// Whether the machine is on power now: one with no battery always is.
    async fn on_power(&mut self) -> bool;
}

/// The hold [`keep`] keeps: let go as it drops, as the engine stops.
pub struct Keeping(tokio::task::JoinHandle<()>);

impl Drop for Keeping {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Holds this machine awake as [`why`] says, from now until the returned
/// [`Keeping`] drops: `working` counts the running Turns, and `awake` is
/// what `machine.toml` says.
pub fn keep(working: watch::Receiver<usize>, awake: watch::Receiver<Awake>) -> Keeping {
    let times = Times {
        tail: TAIL,
        power_every: POWER_EVERY,
    };
    Keeping(tokio::spawn(follow(this_system(), working, awake, times)))
}

#[cfg(target_os = "linux")]
fn this_system() -> impl System {
    linux::Logind::default()
}

#[cfg(target_os = "macos")]
fn this_system() -> impl System {
    macos::Assertions::default()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn this_system() -> impl System {
    Nothing
}

/// Windows holds `ES_SYSTEM_REQUIRED` with ADR 0090; until then, and on
/// any other system, nothing holds the machine.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
struct Nothing;

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[async_trait::async_trait]
impl System for Nothing {
    type Held = ();

    async fn take(&mut self, _: Why) {}

    async fn on_power(&mut self) -> bool {
        true
    }
}

/// How long the tail is, and how often the power source is read: the
/// tests' are short.
#[derive(Clone, Copy, Debug)]
struct Times {
    tail: Duration,
    power_every: Duration,
}

/// Follows the count of running Turns, `awake` and, while `awake` says it
/// matters, the power source, and holds the machine through `system` as
/// the rule says. One hold at a time: one for another reason is taken
/// before the last is let go, so the machine is never let go between. It
/// ends, letting go, as either watch's sender goes.
async fn follow(
    mut system: impl System,
    mut working: watch::Receiver<usize>,
    mut awake: watch::Receiver<Awake>,
    times: Times,
) {
    let mut held = None;
    let mut ended = None;
    let mut was = 0;
    // What the power source said last, and when.
    let mut power: Option<(bool, Instant)> = None;
    loop {
        let count = *working.borrow_and_update();
        let said = *awake.borrow_and_update();
        if count == 0 && was > 0 {
            ended = Some(Instant::now());
        }
        was = count;
        if !said.plugged_in {
            power = None;
        } else if power.is_none_or(|(_, read)| read.elapsed() >= times.power_every) {
            power = Some((system.on_power().await, Instant::now()));
        }
        let now = Instant::now();
        let on_power = power.is_some_and(|(on, _)| on);
        let since_ended = ended.map(|ended| now.saturating_duration_since(ended));
        let wanted = why(said, count, since_ended, times.tail, on_power);
        held = settle(&mut system, held, wanted).await;
        // What to look again at, besides a change.
        let tail_ends = (ended.map(|ended| ended + times.tail))
            .filter(|end| said.while_working && count == 0 && *end > now);
        let read_again = power.map(|(_, read)| read + times.power_every);
        tokio::select! {
            changed = working.changed() => if changed.is_err() { return },
            changed = awake.changed() => if changed.is_err() { return },
            () = until(tail_ends) => {}
            () = until(read_again) => {}
        }
    }
}

/// Keeps `held` when it is for `wanted`; else takes a hold for `wanted`,
/// then lets `held` go, or only lets it go when nothing is wanted.
async fn settle<S: System>(
    system: &mut S,
    held: Option<(Why, S::Held)>,
    wanted: Option<Why>,
) -> Option<(Why, S::Held)> {
    match (held, wanted) {
        (Some((why, hold)), Some(wanted)) if why == wanted => Some((why, hold)),
        (before, Some(wanted)) => {
            let taken = system.take(wanted).await;
            tracing::info!(why = wanted.words(), "the machine is kept awake");
            drop(before);
            Some((wanted, taken))
        }
        (Some(_), None) => {
            tracing::info!("the machine may sleep again");
            None
        }
        (None, None) => None,
    }
}

/// Returns at `at`; never with none.
async fn until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const WORKING: Awake = Awake {
        while_working: true,
        plugged_in: false,
    };

    fn minutes(minutes: u64) -> Option<Duration> {
        Some(Duration::from_secs(minutes * 60))
    }

    #[test]
    fn it_holds_while_agents_work_and_for_the_tail_after() {
        let rule = |working, since_ended| why(WORKING, working, since_ended, TAIL, true);
        assert_eq!(TAIL, minutes(10).unwrap());
        assert_eq!(rule(0, None), None, "no Turn yet");
        assert_eq!(rule(1, None), Some(Why::Working));
        assert_eq!(rule(3, minutes(60)), Some(Why::Working));
        assert_eq!(rule(0, minutes(9)), Some(Why::Working));
        assert_eq!(rule(0, minutes(10)), None, "the tail ran out");
        let off = Awake {
            while_working: false,
            plugged_in: false,
        };
        assert_eq!(
            why(off, 2, minutes(1), TAIL, true),
            None,
            "the Person said not"
        );
    }

    #[test]
    fn plugged_in_it_holds_on_power_only_and_agents_at_work_say_why_first() {
        let plugged = Awake {
            while_working: true,
            plugged_in: true,
        };
        let rule = |awake, working, on_power| why(awake, working, None, TAIL, on_power);
        assert_eq!(rule(plugged, 0, true), Some(Why::PluggedIn));
        assert_eq!(rule(plugged, 0, false), None, "on battery");
        assert_eq!(rule(plugged, 1, true), Some(Why::Working));
        assert_eq!(rule(plugged, 1, false), Some(Why::Working));
        assert_eq!(
            why(plugged, 0, minutes(20), TAIL, true),
            Some(Why::PluggedIn),
            "after the tail"
        );
        let only_plugged = Awake {
            while_working: false,
            plugged_in: true,
        };
        assert_eq!(rule(only_plugged, 2, true), Some(Why::PluggedIn));
        assert_eq!(rule(only_plugged, 2, false), None);
        assert_eq!(Why::Working.words(), "Agents work");
        assert_eq!(Why::PluggedIn.words(), "Plugged in");
    }

    #[test]
    fn a_turn_that_ends_as_another_starts_keeps_the_same_reason() {
        let just = Some(Duration::ZERO);
        // One ends: the count is nothing, and the tail begins at once.
        assert_eq!(why(WORKING, 0, just, TAIL, false), Some(Why::Working));
        // The next starts: the same reason, so the same hold.
        assert_eq!(why(WORKING, 1, just, TAIL, false), Some(Why::Working));
    }

    /// What a test's system was asked: each hold taken, and each let go.
    #[derive(Clone, Default)]
    struct Asked(Arc<Mutex<Vec<String>>>);

    impl Asked {
        fn said(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }

        fn add(&self, said: String) {
            self.0.lock().unwrap().push(said);
        }
    }

    struct Hold(Why, Asked);

    impl Drop for Hold {
        fn drop(&mut self) {
            self.1.add(format!("let go: {}", self.0.words()));
        }
    }

    /// A system whose power source is `power`.
    struct Fake {
        asked: Asked,
        power: watch::Receiver<bool>,
    }

    #[async_trait::async_trait]
    impl System for Fake {
        type Held = Hold;

        async fn take(&mut self, why: Why) -> Hold {
            self.asked.add(format!("take: {}", why.words()));
            Hold(why, self.asked.clone())
        }

        async fn on_power(&mut self) -> bool {
            *self.power.borrow()
        }
    }

    struct Test {
        working: banda_kernel::Working,
        awake: watch::Sender<Awake>,
        power: watch::Sender<bool>,
        asked: Asked,
        keeping: tokio::task::JoinHandle<()>,
    }

    impl Test {
        fn new(awake: Awake, times: Times) -> Test {
            let working = banda_kernel::Working::new();
            let (awake, awake_now) = watch::channel(awake);
            let (power, power_now) = watch::channel(true);
            let asked = Asked::default();
            let system = Fake {
                asked: asked.clone(),
                power: power_now,
            };
            let keeping = tokio::spawn(follow(system, working.count(), awake_now, times));
            Test {
                working,
                awake,
                power,
                asked,
                keeping,
            }
        }

        /// Waits up to five seconds for the system to have been asked
        /// `said`.
        async fn until(&self, said: &[&str]) {
            for _ in 0..500 {
                if self.asked.said() == said {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(self.asked.said(), said);
        }
    }

    const SHORT: Times = Times {
        tail: Duration::from_millis(300),
        power_every: Duration::from_millis(50),
    };

    #[tokio::test]
    async fn one_hold_while_turns_run_back_to_back_let_go_after_the_tail() {
        let test = Test::new(WORKING, SHORT);
        let first = test.working.hold();
        test.until(&["take: Agents work"]).await;
        // One ends as another starts, and one more ends after it: still
        // the one hold.
        let second = test.working.hold();
        drop(first);
        tokio::time::sleep(Duration::from_millis(20)).await;
        let third = test.working.hold();
        drop(second);
        drop(third);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(test.asked.said(), ["take: Agents work"], "within the tail");
        test.until(&["take: Agents work", "let go: Agents work"])
            .await;
    }

    #[tokio::test]
    async fn plugged_in_it_holds_on_power_and_a_turn_takes_its_own_before_that_goes() {
        let plugged = Awake {
            while_working: true,
            plugged_in: true,
        };
        let test = Test::new(plugged, SHORT);
        test.until(&["take: Plugged in"]).await;
        let turn = test.working.hold();
        test.until(&[
            "take: Plugged in",
            "take: Agents work",
            "let go: Plugged in",
        ])
        .await;
        drop(turn);
        // After the tail, on power still: plugged in again.
        test.until(&[
            "take: Plugged in",
            "take: Agents work",
            "let go: Plugged in",
            "take: Plugged in",
            "let go: Agents work",
        ])
        .await;
        // On battery, read at its next turn.
        test.power.send(false).unwrap();
        test.until(&[
            "take: Plugged in",
            "take: Agents work",
            "let go: Plugged in",
            "take: Plugged in",
            "let go: Agents work",
            "let go: Plugged in",
        ])
        .await;
    }

    #[tokio::test]
    async fn the_setting_turned_off_lets_go_and_the_hold_goes_as_its_count_does() {
        let test = Test::new(WORKING, SHORT);
        let turn = test.working.hold();
        test.until(&["take: Agents work"]).await;
        test.awake.send_modify(|awake| awake.while_working = false);
        test.until(&["take: Agents work", "let go: Agents work"])
            .await;
        test.awake.send_modify(|awake| awake.while_working = true);
        test.until(&[
            "take: Agents work",
            "let go: Agents work",
            "take: Agents work",
        ])
        .await;

        // The engine stops: its count goes, and the hold with it.
        let Test {
            working,
            asked,
            keeping,
            ..
        } = test;
        drop(turn);
        drop(working);
        keeping.await.unwrap();
        assert_eq!(asked.said().last().unwrap(), "let go: Agents work");
    }
}
