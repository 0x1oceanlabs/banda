//! This machine's battery, as the `machine.power` stream says it to
//! another machine's window (ADR 0097, decision 6): its charge, whether it
//! charges, whether the machine is on power, and the time left, with why
//! the machine is held awake now. A machine with no battery of its own, a
//! desktop or a server, says none.
//!
//! - macOS: `pmset -g batt`, run as `found.rs` runs it.
//! - Linux: UPower's display device on the system bus, and its own
//!   `OnBattery`, which signals a change; else the kernel's power
//!   supplies, with no time left.
//! - Windows says none yet (ADR 0090), and no why, as nothing holds it.
//!
//! The battery is read only while a window hears `machine.power`: each
//! minute, and at once as the system says the power changed or the
//! machine is held awake for another reason; while none hears it, not at
//! all. What each system says is read by plain functions, which the tests
//! run on what arc's UPower said, and on `pmset -g batt` in the shape
//! macOS says it, not yet read from a Mac. This is also the one place
//! that knows whether the machine is on power, which the hold reads every
//! 30 s while it matters (`awake.rs`).

use crate::awake::Why;
use banda_kernel::Stream;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, mpsc, watch};
use ts_rs::TS;

#[cfg(any(target_os = "linux", test))]
pub(crate) mod linux;
#[cfg(any(target_os = "macos", test))]
pub(crate) mod mac;

/// How often the battery is read while a window hears it.
pub const EVERY: Duration = Duration::from_secs(60);

/// What `machine.power` says: the battery, and why the machine is held
/// awake now. Sent as a window opens the stream, and again when a word of
/// it changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "machines/")]
pub struct Power {
    /// None where the machine has no battery of its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub battery: Option<Battery>,
    /// Why the machine is held awake now, as the hold's rule says; none
    /// while it may idle-sleep, and where nothing holds it.
    pub awake: Option<Why>,
}

/// A machine's own battery, in the words a window says it: "42% · on
/// battery · 2:02 left". A reading that would say the same words is the
/// same battery.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "machines/")]
pub struct Battery {
    /// Its charge, 0 to 100.
    pub percent: u8,
    /// It charges now.
    pub charging: bool,
    /// The machine is on power: charging, full, or held where it is, as
    /// macOS's Optimized Battery Charging holds it at 80%.
    pub on_power: bool,
    /// Minutes left: to empty on battery, to full while charging. None
    /// while the system does not know yet, and on power when it does not
    /// charge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub left: Option<u32>,
}

/// The time left a battery says: to full while it charges, to empty on
/// battery, and none on power when it does not charge.
#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn left(
    charging: bool,
    on_power: bool,
    to_full: Option<u32>,
    to_empty: Option<u32>,
) -> Option<u32> {
    if charging {
        to_full
    } else if on_power {
        None
    } else {
        to_empty
    }
}

/// `seconds` in whole minutes, the nearest; none for no time, as a
/// system says a time it does not know.
#[cfg(any(target_os = "linux", test))]
fn minutes(seconds: i64) -> Option<u32> {
    let minutes = (seconds.saturating_add(30)) / 60;
    u32::try_from(minutes).ok().filter(|minutes| *minutes > 0)
}

/// What reads a machine's battery: the system's own, or a test's.
#[async_trait::async_trait]
pub trait Source: Send + 'static {
    /// The machine's own battery now; none when it has none.
    async fn read(&mut self) -> Option<Battery>;

    /// Returns as the system says the power changed, so the battery is
    /// read again at once; never, where the system says nothing.
    async fn changed(&mut self) {
        std::future::pending().await
    }

    /// Lets go of what it keeps to read, as the last window stops
    /// hearing.
    fn rest(&mut self) {}
}

/// This machine's power as `machine.power` says it: read while a window
/// hears it, and not at all while none does. The reading ends as it
/// drops.
pub struct Meter {
    told: Arc<Told>,
    _reading: Reading,
}

struct Told {
    /// What `machine.power` says now: none while no window hears it, so
    /// the first that comes hears it read anew.
    now: watch::Sender<Option<Power>>,
    /// Wakes the reading as a window comes to hear it.
    came: Notify,
}

/// The reading's task, stopped as it drops.
struct Reading(tokio::task::JoinHandle<()>);

impl Drop for Reading {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl Meter {
    /// This machine's, read by its system's own means, each [`EVERY`];
    /// `awake` says why the hold keeps it awake ([`crate::awake::Keeping::why`]).
    pub fn new(awake: watch::Receiver<Option<Why>>) -> Meter {
        Meter::with(this_source(), awake, EVERY)
    }

    /// Read through `source`, `every` so often while a window hears it:
    /// the tests' own.
    pub fn with(
        source: impl Source,
        awake: watch::Receiver<Option<Why>>,
        every: Duration,
    ) -> Meter {
        let told = Arc::new(Told {
            now: watch::Sender::new(None),
            came: Notify::new(),
        });
        let reading = tokio::spawn(read(source, told.clone(), awake, every));
        Meter {
            told,
            _reading: Reading(reading),
        }
    }

    /// A `machine.power` stream: what it says now, read anew when no
    /// window heard it, then each change of its words, until the one who
    /// hears it stops.
    pub fn stream(&self) -> Stream {
        let mut now = self.told.now.subscribe();
        self.told.came.notify_one();
        let (send, hear) = mpsc::channel(1);
        tokio::spawn(async move {
            loop {
                let piece = tokio::select! {
                    said = now.wait_for(Option::is_some) => match said {
                        Ok(said) => serde_json::to_value(&*said),
                        Err(_) => break,
                    },
                    () = send.closed() => break,
                };
                let Ok(piece) = piece else { break };
                if send.send(piece).await.is_err() {
                    break;
                }
                tokio::select! {
                    changed = now.changed() => if changed.is_err() { break },
                    () = send.closed() => break,
                }
            }
        });
        hear
    }
}

/// Reads the battery through `source` while a window hears it: at once as
/// the first comes, then `every` so often, as the source says the power
/// changed, and as `awake` changes; and tells `told` when a word changed.
/// While none hears it, it reads nothing, and its source rests.
async fn read(
    mut source: impl Source,
    told: Arc<Told>,
    mut awake: watch::Receiver<Option<Why>>,
    every: Duration,
) {
    // Whether the hold went, as the engine stops: nothing holds it now.
    let mut awake_gone = false;
    loop {
        if told.now.receiver_count() == 0 {
            told.now.send_replace(None);
            source.rest();
            told.came.notified().await;
            continue;
        }
        let power = Power {
            battery: source.read().await,
            awake: if awake_gone {
                None
            } else {
                *awake.borrow_and_update()
            },
        };
        told.now.send_if_modified(|now| {
            let changed = now.as_ref() != Some(&power);
            if changed {
                *now = Some(power);
            }
            changed
        });
        tokio::select! {
            () = tokio::time::sleep(every) => {}
            () = source.changed() => {}
            changed = awake.changed(), if !awake_gone => awake_gone = changed.is_err(),
            () = told.now.closed() => {}
        }
    }
}

#[cfg(target_os = "linux")]
fn this_source() -> impl Source {
    linux::UPower::default()
}

#[cfg(target_os = "macos")]
fn this_source() -> impl Source {
    mac::Pmset
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn this_source() -> impl Source {
    Nothing
}

/// Windows reads its battery through WinRT with ADR 0090; until then, and
/// on any other system, the machine says none.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
struct Nothing;

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[async_trait::async_trait]
impl Source for Nothing {
    async fn read(&mut self) -> Option<Battery> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const DISCHARGING: Battery = Battery {
        percent: 42,
        charging: false,
        on_power: false,
        left: Some(122),
    };

    #[test]
    fn a_battery_says_its_words_and_a_machine_with_none_says_only_why_it_is_awake() {
        let power = Power {
            battery: Some(DISCHARGING),
            awake: Some(Why::PluggedIn),
        };
        let said = json!({
            "battery": { "percent": 42, "charging": false, "on_power": false, "left": 122 },
            "awake": "plugged-in",
        });
        assert_eq!(serde_json::to_value(&power).unwrap(), said);
        let unknown = Battery {
            left: None,
            ..DISCHARGING
        };
        let said = json!({ "percent": 42, "charging": false, "on_power": false });
        assert_eq!(serde_json::to_value(unknown).unwrap(), said, "no time yet");
        let desktop = Power {
            battery: None,
            awake: Some(Why::Working),
        };
        assert_eq!(
            serde_json::to_value(&desktop).unwrap(),
            json!({ "awake": "working" })
        );
        let asleep = Power {
            battery: None,
            awake: None,
        };
        assert_eq!(
            serde_json::to_value(&asleep).unwrap(),
            json!({ "awake": null })
        );
    }

    #[test]
    fn the_time_left_is_to_full_while_charging_to_empty_on_battery_and_none_else() {
        assert_eq!(left(true, true, Some(48), Some(300)), Some(48));
        assert_eq!(left(false, false, Some(48), Some(122)), Some(122));
        assert_eq!(left(false, true, Some(48), Some(122)), None, "full");
        assert_eq!(left(true, true, None, Some(122)), None, "not known yet");
        assert_eq!(minutes(7330), Some(122));
        assert_eq!(minutes(7350), Some(123), "the nearest minute");
        assert_eq!(minutes(0), None, "a time the system does not know");
        assert_eq!(minutes(-1), None);
        assert_eq!(minutes(20), None);
    }

    #[test]
    fn a_word_changes_with_the_percent_the_state_the_time_left_or_why_it_is_awake() {
        let now = Power {
            battery: Some(DISCHARGING),
            awake: None,
        };
        let same = now.clone();
        assert_eq!(now, same, "the same words: nothing to say");
        let changes = [
            Battery {
                percent: 41,
                ..DISCHARGING
            },
            Battery {
                charging: true,
                ..DISCHARGING
            },
            Battery {
                on_power: true,
                ..DISCHARGING
            },
            Battery {
                left: Some(121),
                ..DISCHARGING
            },
            Battery {
                left: None,
                ..DISCHARGING
            },
        ];
        for battery in changes {
            let changed = Power {
                battery: Some(battery),
                ..now.clone()
            };
            assert_ne!(now, changed, "{battery:?}");
        }
        let awake = Power {
            awake: Some(Why::Working),
            ..now.clone()
        };
        assert_ne!(now, awake);
        let gone = Power {
            battery: None,
            ..now.clone()
        };
        assert_ne!(now, gone);
        // What reads the same words is no change: a fraction of a percent,
        // or seconds within the same minute.
        let read = |percentage, to_empty| {
            linux::upower(&linux::Device {
                percentage,
                to_empty,
                ..linux::tests::DISCHARGING
            })
        };
        assert_eq!(read(42.2, 7330), read(41.6, 7310));
        assert_ne!(read(42.2, 7330), read(42.6, 7330));
        assert_ne!(read(42.2, 7330), read(42.2, 7400));
    }

    /// A battery the test says, and how many times it was read.
    struct Fake {
        said: watch::Receiver<Option<Battery>>,
        reads: Arc<AtomicUsize>,
        rests: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl Source for Fake {
        async fn read(&mut self) -> Option<Battery> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            *self.said.borrow_and_update()
        }

        async fn changed(&mut self) {
            if self.said.changed().await.is_err() {
                std::future::pending().await
            }
        }

        fn rest(&mut self) {
            self.rests.fetch_add(1, Ordering::Relaxed);
        }
    }

    struct Test {
        meter: Meter,
        battery: watch::Sender<Option<Battery>>,
        awake: watch::Sender<Option<Why>>,
        reads: Arc<AtomicUsize>,
        rests: Arc<AtomicUsize>,
    }

    impl Test {
        fn new(every: Duration) -> Test {
            let (battery, said) = watch::channel(Some(DISCHARGING));
            let (awake, why) = watch::channel(None);
            let reads = Arc::<AtomicUsize>::default();
            let rests = Arc::<AtomicUsize>::default();
            let fake = Fake {
                said,
                reads: reads.clone(),
                rests: rests.clone(),
            };
            Test {
                meter: Meter::with(fake, why, every),
                battery,
                awake,
                reads,
                rests,
            }
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::Relaxed)
        }

        /// Waits up to five seconds for `count` to be at least `least`.
        async fn until(count: &AtomicUsize, least: usize) {
            for _ in 0..500 {
                if count.load(Ordering::Relaxed) >= least {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("{} of {least}", count.load(Ordering::Relaxed));
        }
    }

    /// The next piece, within five seconds.
    async fn piece(stream: &mut Stream) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(5), stream.recv())
            .await
            .expect("a piece in time")
            .expect("an open stream")
    }

    /// No piece within a while.
    async fn no_piece(stream: &mut Stream) {
        let heard = tokio::time::timeout(Duration::from_millis(150), stream.recv()).await;
        assert!(heard.is_err(), "{heard:?}");
    }

    #[tokio::test]
    async fn nothing_is_read_while_no_window_hears_and_each_while_while_one_does() {
        let test = Test::new(Duration::from_millis(50));
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(test.reads(), 0, "no window hears it");

        let mut first = test.meter.stream();
        let said = piece(&mut first).await;
        assert_eq!(said["battery"]["percent"], 42);
        assert_eq!(said["awake"], serde_json::Value::Null);
        // Read again and again, the same words: nothing more said.
        Test::until(&test.reads, 3).await;
        no_piece(&mut first).await;

        // A second hears it as it is, read in the while.
        let mut second = test.meter.stream();
        assert_eq!(piece(&mut second).await, said);

        drop(first);
        drop(second);
        Test::until(&test.rests, 2).await;
        tokio::time::sleep(Duration::from_millis(60)).await;
        let rested = test.reads();
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(test.reads(), rested, "none hears it: nothing is read");

        // One comes again: read anew, not the last it heard.
        test.battery.send_replace(Some(Battery {
            percent: 30,
            ..DISCHARGING
        }));
        let mut again = test.meter.stream();
        assert_eq!(piece(&mut again).await["battery"]["percent"], 30);
    }

    #[tokio::test]
    async fn a_change_the_system_says_and_why_the_machine_is_awake_are_said_at_once() {
        // Each minute, as the engine reads it: the test is done well before.
        let test = Test::new(EVERY);
        let mut stream = test.meter.stream();
        piece(&mut stream).await;

        let charging = Battery {
            charging: true,
            on_power: true,
            left: Some(48),
            ..DISCHARGING
        };
        test.battery.send(Some(charging)).unwrap();
        let said = piece(&mut stream).await;
        assert_eq!(
            said["battery"],
            json!({ "percent": 42, "charging": true, "on_power": true, "left": 48 })
        );

        // Said again, the same: read, and nothing said.
        let reads = test.reads();
        test.battery.send(Some(charging)).unwrap();
        Test::until(&test.reads, reads + 1).await;
        no_piece(&mut stream).await;

        test.awake.send(Some(Why::Working)).unwrap();
        assert_eq!(piece(&mut stream).await["awake"], "working");
        assert_eq!(test.reads(), reads + 2, "the battery read with it");
        test.awake.send(Some(Why::PluggedIn)).unwrap();
        assert_eq!(piece(&mut stream).await["awake"], "plugged-in");

        // The battery taken out, as a machine's power supply goes.
        test.battery.send(None).unwrap();
        assert_eq!(piece(&mut stream).await, json!({ "awake": "plugged-in" }));
    }
}
