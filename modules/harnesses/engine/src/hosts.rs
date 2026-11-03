//! A pool of Harness processes: one per Space and Harness entry (ADR 0003,
//! decision 6), or per Harness on the machine, keyed by the machine's
//! Space ID. What a host is, and when it has nothing to do, its client
//! says ([`Host`]).
//!
//! - A host starts when it is first asked for, one start at a time.
//! - A host that keeps dying starts again after a growing pause.
//! - A host with nothing to do for `idle` is let go.
//! - A host's process runs in its own process group, which is killed when
//!   the host is dropped; an engine that dies closes the host's stdin.

use crate::Harness;
use banda_kernel::SpaceId;
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

/// A Harness process as its client holds it.
pub trait Host: Send + Sync + Sized + 'static {
    /// Starts `harness`.
    fn start(harness: &Harness) -> impl Future<Output = Result<Arc<Self>, String>> + Send;
    /// Whether the process still answers.
    fn alive(&self) -> bool;
    /// Since when it has had nothing to do, or `None` while it has.
    fn idle_since(&self) -> Option<Instant>;
}

pub struct Hosts<H> {
    idle: Duration,
    slots: Mutex<HashMap<Key, Arc<tokio::sync::Mutex<Slot<H>>>>>,
    sweeping: std::sync::Once,
}

struct Slot<H> {
    host: Option<Arc<H>>,
    /// The entry the host started from: a changed entry starts a new host.
    harness: Option<Harness>,
    started: Option<Instant>,
    /// Deaths in a row, each soon after its start.
    deaths: u32,
}

impl<H> Default for Slot<H> {
    fn default() -> Self {
        Slot {
            host: None,
            harness: None,
            started: None,
            deaths: 0,
        }
    }
}

impl<H> Slot<H> {
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

impl<H: Host> Hosts<H> {
    pub fn new(idle: Duration) -> Arc<Hosts<H>> {
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
    ) -> Result<Arc<H>, String> {
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
        match H::start(harness).await {
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
    /// Space, once it is no longer starting. Who holds a host keeps it
    /// until they drop it.
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

    /// Forgets every host of `space`, as the Space is removed, and answers
    /// them, so what they run can be stopped.
    pub async fn forget(&self, space: SpaceId) -> Vec<Arc<H>> {
        let slots: Vec<_> = (self.slots.lock().unwrap())
            .extract_if(|(of, _), _| *of == space)
            .map(|(_, slot)| slot)
            .collect();
        let mut hosts = Vec::new();
        for slot in slots {
            hosts.extend(slot.lock().await.host.take());
        }
        hosts
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

async fn sweep<H: Host>(hosts: Weak<Hosts<H>>, idle: Duration) {
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
        let mut slot = Slot::<()> {
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
