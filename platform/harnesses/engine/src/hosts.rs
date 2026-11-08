//! A pool of Harness processes: one per Project and Harness entry (ADR 0003,
//! decision 6), or per Harness on the machine, keyed by the machine's
//! Project ID. What a host is, and when it has nothing to do, its client
//! says ([`Host`]).
//!
//! - A host starts when it is first asked for, one start at a time, in
//!   the environment of the Project it is asked for (ADR 0084).
//! - A host that keeps dying starts again after a growing pause.
//! - A host with nothing to do for `idle` is let go, unless what its
//!   process started still serves: a server or a trial an Agent started,
//!   listening, which would stop with it ([`Host::serving`], ADR 0083).
//! - A host is let go when its account changes, and every host of a
//!   Project when the Person's trust in it changes ([`Hosts::let_go`]).
//! - A host that started without the GitHub token its Project gets, as
//!   `gh` signed in later, goes the next time it is asked for with nothing
//!   to do and nothing serving, so its next start has it.
//!   One that was starting then is let go the next time it is asked for,
//!   so letting go never waits on a start (ADR 0040, decision 4).
//! - A host's process runs in its own process group, or its own Job Object
//!   on Windows, which is killed when the host is dropped; an engine that
//!   dies closes the host's stdin, and on Windows ends its Job Object.

use crate::{Failed, Harness};
use banda_kernel::{Environment, ProjectId};
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
    /// Starts `harness` in `environment`.
    fn start(
        environment: Arc<dyn Environment>,
        harness: &Harness,
    ) -> impl Future<Output = Result<Arc<Self>, Failed>> + Send;
    /// Whether the process still answers.
    fn alive(&self) -> bool;
    /// Since when it has had nothing to do, or `None` while it has.
    fn idle_since(&self) -> Option<Instant>;
    /// Whether what its process started still serves, listening: a host
    /// that serves is not idle, so what it started goes on.
    fn serving(&self) -> bool {
        false
    }
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

    /// The host for `harness` in `project`, started in `environment`, the
    /// Project's, if it is not running.
    pub async fn get(
        self: &Arc<Self>,
        project: ProjectId,
        environment: Arc<dyn Environment>,
        harness: &Harness,
    ) -> Result<Arc<H>, Failed> {
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
            let late = (slot.harness.as_ref())
                .is_some_and(|had| had.credentials.lacks_what(&harness.credentials));
            let quiet = host.idle_since().is_some() && !host.serving();
            if host.alive() && current && !(late && quiet) {
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
        match H::start(environment, harness).await {
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
    /// its account changed; with no entry, of every host of `project`, as
    /// whether the Person trusts it changed (ADR 0083, decision 5). It
    /// waits for none: a host that is starting is let go the next time it
    /// is asked for. Who holds a host keeps it until they drop it.
    pub fn let_go(&self, project: ProjectId, harness: Option<&str>) {
        let slots = self.slots.lock().unwrap();
        for ((of, id), entry) in slots.iter() {
            if *of == project && harness.is_none_or(|harness| harness == id) {
                Self::stale(entry);
            }
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
            let idle = slot.host.as_ref().is_some_and(|host| {
                (host.idle_since()).is_some_and(|since| since.elapsed() >= self.idle)
                    && !host.serving()
            });
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

    /// The environment these hosts are handed: they start nothing in it.
    fn here() -> Arc<dyn Environment> {
        Arc::new(banda_environments::Local)
    }

    /// A host that counts its starts, each held until `GO` lets it on.
    struct Counted(usize);

    static STARTS: AtomicUsize = AtomicUsize::new(0);
    static GO: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(0);

    impl Host for Counted {
        async fn start(_: Arc<dyn Environment>, _: &Harness) -> Result<Arc<Self>, Failed> {
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
            async move { hosts.get(project, here(), &harness).await.unwrap().0 }
        });
        // Its start holds the slot: letting go does not wait for it.
        while hosts.slots.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        hosts.let_go(project, Some(&harness.id));
        GO.add_permits(1);
        assert_eq!(starting.await.unwrap(), 1);
        GO.add_permits(1);
        let again = hosts.get(project, here(), &harness).await.unwrap();
        assert_eq!(again.0, 2, "it read the account before it changed");
        assert_eq!(
            hosts.get(project, here(), &harness).await.unwrap().0,
            2,
            "then it stays"
        );
    }

    /// A host that counts its starts, as many as asked, and lives on.
    struct Kept(usize);

    static KEPT: AtomicUsize = AtomicUsize::new(0);

    impl Host for Kept {
        async fn start(_: Arc<dyn Environment>, _: &Harness) -> Result<Arc<Self>, Failed> {
            Ok(Arc::new(Kept(KEPT.fetch_add(1, Ordering::SeqCst) + 1)))
        }

        fn alive(&self) -> bool {
            true
        }

        fn idle_since(&self) -> Option<Instant> {
            None
        }
    }

    #[tokio::test]
    async fn a_project_whose_trust_changed_lets_go_of_every_host_and_only_its_own() {
        let hosts = Hosts::<Kept>::new(Duration::from_secs(60));
        let known = crate::Harnesses::known();
        let entries: Vec<_> = (known.views().iter())
            .map(|view| known.find(&view.id).unwrap())
            .collect();
        let (project, other) = (ProjectId::new(), ProjectId::new());
        let mut first = Vec::new();
        for harness in &entries {
            first.push(hosts.get(project, here(), harness).await.unwrap().0);
        }
        let theirs = hosts.get(other, here(), &entries[0]).await.unwrap().0;

        hosts.let_go(project, None);
        assert!(hosts.running(project).await.is_empty(), "let go at once");
        for (harness, before) in entries.iter().zip(first) {
            let again = hosts.get(project, here(), harness).await.unwrap().0;
            assert!(again > before, "{} starts again", harness.id);
        }
        let kept = hosts.get(other, here(), &entries[0]).await.unwrap().0;
        assert_eq!(kept, theirs, "another Project's host stays");

        // Started for the other trust, a host is another entry, which a
        // Project's next turn starts afresh even unheard.
        let data = std::path::Path::new("/state/projects/p");
        let shells = Default::default();
        let (work, holes) = (std::path::Path::new("/work"), banda_kernel::Holes::default);
        let trusted = entries[0].in_project(project, data, work, holes(), &shells, true);
        let not = entries[0].in_project(project, data, work, holes(), &shells, false);
        let before = hosts.get(project, here(), &trusted).await.unwrap().0;
        let after = hosts.get(project, here(), &not).await.unwrap().0;
        assert!(after > before);
    }

    /// A host that counts its starts, held while `HELD` says so.
    struct Quiet(usize);

    static QUIET: AtomicUsize = AtomicUsize::new(0);
    static HELD: AtomicBool = AtomicBool::new(true);

    impl Host for Quiet {
        async fn start(_: Arc<dyn Environment>, _: &Harness) -> Result<Arc<Self>, Failed> {
            Ok(Arc::new(Quiet(QUIET.fetch_add(1, Ordering::SeqCst) + 1)))
        }

        fn alive(&self) -> bool {
            true
        }

        fn idle_since(&self) -> Option<Instant> {
            (!HELD.load(Ordering::SeqCst)).then(Instant::now)
        }
    }

    #[tokio::test]
    async fn a_host_that_started_without_its_token_goes_once_it_is_quiet() {
        let hosts = Hosts::<Quiet>::new(Duration::from_secs(60));
        let known = crate::Harnesses::known();
        let without = known.find(&known.views()[0].id).unwrap();
        let mut with = without.clone();
        with.credentials
            .set
            .insert("GH_TOKEN".to_owned(), "t".to_owned());
        let project = ProjectId::new();
        let first = hosts.get(project, here(), &without).await.unwrap().0;
        // Busy: it stays, as the token is no reason to stop a turn.
        let busy = hosts.get(project, here(), &with).await.unwrap().0;
        assert_eq!(busy, first);
        HELD.store(false, Ordering::SeqCst);
        let quiet = hosts.get(project, here(), &with).await.unwrap().0;
        assert!(quiet > first, "it starts again, with the token");
        // With it, a token read again is no reason to go.
        let mut other = with.clone();
        other
            .credentials
            .set
            .insert("GH_TOKEN".to_owned(), "u".to_owned());
        assert_eq!(hosts.get(project, here(), &other).await.unwrap().0, quiet);
        assert_eq!(hosts.get(project, here(), &without).await.unwrap().0, quiet);
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
