//! A pool of Harness processes: one per Project and Harness entry (ADR 0003,
//! decision 6), or per Harness on the machine, keyed by the machine's
//! Project ID. What a host is, and when it has nothing to do, its client
//! says ([`Host`]).
//!
//! - A host starts when it is first asked for, one start at a time.
//! - A host that keeps dying starts again after a growing pause.
//! - A host with nothing to do for `idle` is let go.
//! - A host is let go when its account changes ([`Hosts::let_go`]), and
//!   one that was starting then is let go the next time it is asked for,
//!   so letting go never waits on a start (ADR 0040, decision 4).
//! - A host's process runs in its own process group, which is killed when
//!   the host is dropped; an engine that dies closes the host's stdin.

use crate::Harness;
use banda_kernel::ProjectId;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

type Key = (ProjectId, String);

/// When a host was last used, and how many hold it busy now: whether it
/// is idle, for [`Host::idle_since`]. Clones share it.
#[derive(Clone)]
pub struct Activity(Arc<Used>);

struct Used {
    busy: AtomicUsize,
    last: Mutex<Instant>,
}

/// While it lives, its host is busy, so not let go as idle.
pub struct Held(Activity);

impl Drop for Held {
    fn drop(&mut self) {
        self.0.touch();
        self.0.0.busy.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Activity {
    /// Keeps the host busy while the guard lives.
    pub fn hold(&self) -> Held {
        self.0.busy.fetch_add(1, Ordering::SeqCst);
        Held(self.clone())
    }

    /// Marks the host as just used.
    pub fn touch(&self) {
        *self.0.last.lock().unwrap() = Instant::now();
    }

    /// Since when it has been used, or `None` while it is held.
    pub fn idle_since(&self) -> Option<Instant> {
        let busy = self.0.busy.load(Ordering::SeqCst) > 0;
        (!busy).then(|| *self.0.last.lock().unwrap())
    }
}

/// Just used, and held by no one.
impl Default for Activity {
    fn default() -> Self {
        Activity(Arc::new(Used {
            busy: AtomicUsize::new(0),
            last: Mutex::new(Instant::now()),
        }))
    }
}

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
    slots: Mutex<HashMap<Key, Arc<Entry<H>>>>,
    sweeping: std::sync::Once,
}

/// A Project's place for one Harness's host.
struct Entry<H> {
    /// Its account changed since its host started: set without waiting
    /// for the slot, which a start holds.
    stale: AtomicBool,
    slot: tokio::sync::Mutex<Slot<H>>,
}

impl<H> Default for Entry<H> {
    fn default() -> Self {
        Entry {
            stale: AtomicBool::new(false),
            slot: tokio::sync::Mutex::default(),
        }
    }
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

    /// The host for `harness` in `project`, started if it is not running.
    pub async fn get(
        self: &Arc<Self>,
        project: ProjectId,
        harness: &Harness,
    ) -> Result<Arc<H>, String> {
        self.sweeping.call_once(|| {
            tokio::spawn(sweep(Arc::downgrade(self), self.idle));
        });
        let entry = self
            .slots
            .lock()
            .unwrap()
            .entry((project, harness.id.clone()))
            .or_default()
            .clone();
        let mut slot = entry.slot.lock().await;
        // Taken before the start: a change during it marks it again.
        let stale = entry.stale.swap(false, Ordering::SeqCst);
        if let Some(host) = &slot.host {
            let current = slot.harness.as_ref() == Some(harness) && !stale;
            if host.alive() && current {
                return Ok(host.clone());
            }
            if host.alive() {
                // The entry or its account changed: the old host goes, and
                // its sessions with it.
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

    /// Lets go of the host of the Harness entry `harness` in `project`, as
    /// its account changed. It waits for none: a host that is starting is
    /// let go the next time it is asked for. Who holds a host keeps it
    /// until they drop it.
    pub fn let_go(&self, project: ProjectId, harness: &str) {
        let slots = self.slots.lock().unwrap();
        if let Some(entry) = slots.get(&(project, harness.to_owned())) {
            Self::stale(entry);
        }
    }

    fn stale(entry: &Arc<Entry<H>>) {
        entry.stale.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = entry.slot.try_lock() {
            slot.host = None;
            slot.deaths = 0;
        }
    }

    /// The hosts that run for `project` now, by their Harness entry: none
    /// is started.
    pub async fn running(&self, project: ProjectId) -> Vec<(String, Arc<H>)> {
        let entries: Vec<_> = (self.slots.lock().unwrap().iter())
            .filter(|((of, _), _)| *of == project)
            .map(|((_, harness), entry)| (harness.clone(), entry.clone()))
            .collect();
        let mut running = Vec::new();
        for (harness, entry) in entries {
            let slot = entry.slot.lock().await;
            if let Some(host) = slot.host.as_ref().filter(|host| host.alive()) {
                running.push((harness, host.clone()));
            }
        }
        running
    }

    /// Forgets every host of `project`, as the Project is removed, and answers
    /// them, so what they run can be stopped.
    pub async fn forget(&self, project: ProjectId) -> Vec<Arc<H>> {
        let entries: Vec<_> = (self.slots.lock().unwrap())
            .extract_if(|(of, _), _| *of == project)
            .map(|(_, entry)| entry)
            .collect();
        let mut hosts = Vec::new();
        for entry in entries {
            hosts.extend(entry.slot.lock().await.host.take());
        }
        hosts
    }

    /// Lets go of every host that has had nothing to do for `idle`.
    fn release_idle(&self) {
        let entries: Vec<_> = self.slots.lock().unwrap().values().cloned().collect();
        for entry in entries {
            // A host that is starting is not idle.
            let Ok(mut slot) = entry.slot.try_lock() else {
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

    /// A host that counts its starts, each held until `GO` lets it on.
    struct Counted(usize);

    static STARTS: AtomicUsize = AtomicUsize::new(0);
    static GO: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(0);

    impl Host for Counted {
        async fn start(_: &Harness) -> Result<Arc<Self>, String> {
            GO.acquire().await.unwrap().forget();
            Ok(Arc::new(Counted(STARTS.fetch_add(1, Ordering::SeqCst) + 1)))
        }

        fn alive(&self) -> bool {
            true
        }

        fn idle_since(&self) -> Option<Instant> {
            None
        }
    }

    #[tokio::test]
    async fn an_account_changed_while_a_host_starts_starts_it_again_when_next_asked() {
        let hosts = Hosts::<Counted>::new(Duration::from_secs(60));
        let known = crate::Harnesses::known();
        let (project, harness) = (ProjectId::new(), known.find(&known.views()[0].id).unwrap());
        let starting = tokio::spawn({
            let (hosts, harness) = (hosts.clone(), harness.clone());
            async move { hosts.get(project, &harness).await.unwrap().0 }
        });
        // Its start holds the slot: letting go does not wait for it.
        while hosts.slots.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        hosts.let_go(project, &harness.id);
        GO.add_permits(1);
        assert_eq!(starting.await.unwrap(), 1);
        GO.add_permits(1);
        let again = hosts.get(project, &harness).await.unwrap();
        assert_eq!(again.0, 2, "it read the account before it changed");
        assert_eq!(
            hosts.get(project, &harness).await.unwrap().0,
            2,
            "then it stays"
        );
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
