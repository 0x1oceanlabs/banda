//! The Harness processes: one per Space and Harness entry (ADR 0003,
//! decision 6). Every Thread on that Harness in that Space is a session in
//! the one process.
//!
//! - A host starts on the first turn that needs it, one start at a time.
//! - A host that keeps dying starts again after a growing pause.
//! - A host with nothing to do for `idle` is let go. Its Threads resume
//!   their sessions when it starts again.
//! - After a sign-in every host of that Harness entry is let go, so each
//!   reads the account again when it starts.
//! - A host's process runs in its own process group, which is killed when
//!   the host is dropped; an engine that dies closes the host's stdin.

use crate::acp::Connection;
use crate::settings::Harness;
use bandaso_kernel::SpaceId;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

/// How long a host may sit with nothing to do.
pub const IDLE: Duration = Duration::from_secs(30 * 60);
/// The pause before a host that died starts again, doubled each time.
const FIRST_PAUSE: Duration = Duration::from_millis(500);
const LONGEST_PAUSE: Duration = Duration::from_secs(30);
/// A host that ran this long before it died starts again at once.
const HEALTHY: Duration = Duration::from_secs(5 * 60);
/// How often idle hosts are looked for, at most.
const LOOK: Duration = Duration::from_secs(60);

type Key = (SpaceId, String);

pub struct Hosts {
    idle: Duration,
    slots: Mutex<HashMap<Key, Arc<tokio::sync::Mutex<Slot>>>>,
    sweeping: std::sync::Once,
}

#[derive(Default)]
struct Slot {
    host: Option<Arc<Connection>>,
    /// The entry the host started from: a changed entry starts a new host.
    harness: Option<Harness>,
    started: Option<Instant>,
    /// Deaths in a row, each soon after its start.
    deaths: u32,
}

impl Slot {
    fn died(&mut self) {
        let healthy = self.started.is_some_and(|at| at.elapsed() >= HEALTHY);
        self.deaths = if healthy { 0 } else { self.deaths + 1 };
        self.host = None;
    }
}

/// The pause before the next start after `deaths` deaths in a row.
fn pause(deaths: u32) -> Option<Duration> {
    let doublings = deaths.checked_sub(1)?;
    let pause = FIRST_PAUSE.saturating_mul(2u32.saturating_pow(doublings.min(16)));
    Some(pause.min(LONGEST_PAUSE))
}

impl Hosts {
    pub fn new(idle: Duration) -> Arc<Hosts> {
        Arc::new(Hosts {
            idle,
            slots: Mutex::default(),
            sweeping: std::sync::Once::new(),
        })
    }

    /// The host for `harness` in `space`, started if it is not running.
    pub async fn get(
        self: &Arc<Self>,
        space: SpaceId,
        harness: &Harness,
    ) -> Result<Arc<Connection>, String> {
        self.sweeping.call_once(|| {
            tokio::spawn(sweep(Arc::downgrade(self), self.idle));
        });
        let slot = self
            .slots
            .lock()
            .unwrap()
            .entry((space, harness.id.clone()))
            .or_default()
            .clone();
        let mut slot = slot.lock().await;
        if let Some(host) = &slot.host {
            if host.alive() && slot.harness.as_ref() == Some(harness) {
                return Ok(host.clone());
            }
            if host.alive() {
                // The entry changed: the old host goes, and its sessions with it.
                slot.host = None;
                slot.deaths = 0;
            } else {
                slot.died();
            }
        }
        if let Some(pause) = pause(slot.deaths) {
            tokio::time::sleep(pause).await;
        }
        match Connection::start(harness).await {
            Ok(host) => {
                slot.host = Some(host.clone());
                slot.harness = Some(harness.clone());
                slot.started = Some(Instant::now());
                Ok(host)
            }
            Err(error) => {
                slot.deaths += 1;
                slot.started = None;
                Err(error)
            }
        }
    }

    /// Lets go of every host of the Harness entry `harness`, in every
    /// Space, once it is no longer starting. A turn that runs keeps its
    /// host until it ends.
    pub async fn let_go(&self, harness: &str) {
        let slots: Vec<_> = self
            .slots
            .lock()
            .unwrap()
            .iter()
            .filter(|((_, id), _)| id == harness)
            .map(|(_, slot)| slot.clone())
            .collect();
        for slot in slots {
            let mut slot = slot.lock().await;
            slot.host = None;
            slot.deaths = 0;
        }
    }

    /// Lets go of every host that has had nothing to do for `idle`.
    fn release_idle(&self) {
        let slots: Vec<_> = self.slots.lock().unwrap().values().cloned().collect();
        for slot in slots {
            // A host that is starting is not idle.
            let Ok(mut slot) = slot.try_lock() else {
                continue;
            };
            let idle = slot
                .host
                .as_ref()
                .and_then(|host| host.idle_since())
                .is_some_and(|since| since.elapsed() >= self.idle);
            if idle {
                slot.host = None;
                slot.deaths = 0;
            }
        }
    }
}

async fn sweep(hosts: Weak<Hosts>, idle: Duration) {
    let every = (idle / 4).clamp(Duration::from_millis(10), LOOK);
    loop {
        tokio::time::sleep(every).await;
        let Some(hosts) = hosts.upgrade() else {
            return;
        };
        hosts.release_idle();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_that_keeps_dying_waits_longer_each_time() {
        assert_eq!(pause(0), None);
        assert_eq!(pause(1), Some(Duration::from_millis(500)));
        assert_eq!(pause(2), Some(Duration::from_secs(1)));
        assert_eq!(pause(4), Some(Duration::from_secs(4)));
        assert_eq!(pause(40), Some(LONGEST_PAUSE));
    }

    #[test]
    fn a_host_that_ran_long_before_it_died_starts_at_once() {
        let mut slot = Slot {
            started: Some(Instant::now() - HEALTHY),
            deaths: 3,
            ..Slot::default()
        };
        slot.died();
        assert_eq!(slot.deaths, 0);
        slot.started = Some(Instant::now());
        slot.died();
        assert_eq!(slot.deaths, 1);
    }
}
