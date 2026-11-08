//! One reader for a Project's pull requests (ADR 0076, decision 2): it
//! reads GitHub while something follows the Project, at T3 Code's pace,
//! and tells each follower the list as it changes.

use crate::github::{self, Missed};
use crate::judge;
use crate::model::{By, Listed, Need, Pull, PullRef, Snapshot, State, Turn};
use crate::store::{self, Row};
use banda_kernel::{Error, ModuleProject, Stream, WeakModuleProject};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, mpsc, watch};

/// An open pull request is read every minute…
pub const OPEN: i64 = 60_000;
/// …or every five once none of a Project's changed for half an hour.
pub const QUIET: i64 = 300_000;
pub const QUIET_AFTER: i64 = 30 * 60_000;
/// How long it waits when GitHub asks it to.
pub const PAUSE: i64 = 10 * 60_000;
/// How long a merged or closed pull request stays in the list.
pub const LANDED_FOR: i64 = 24 * 60 * 60_000;

/// What a Project's reader holds. It holds the Project weakly: what hears
/// the log for it, and the module's own list of them, keep no Project
/// open, so one removed or let go of closes.
pub struct Live {
    project: WeakModuleProject,
    gh: PathBuf,
    /// None until the first list is made.
    listed: watch::Sender<Option<Arc<Listed>>>,
    wake: Notify,
    /// Read every open one at the next turn of the loop, as after a push.
    force: AtomicBool,
    reading: Mutex<bool>,
    /// The Threads whose Agent works now.
    pub(crate) working: Mutex<HashSet<String>>,
    state: Mutex<Read>,
}

/// How the last read went.
#[derive(Default)]
struct Read {
    paused_until: i64,
    missing: Option<String>,
    synced_at: Option<i64>,
}

impl Live {
    pub fn new(project: &ModuleProject, gh: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            project: project.downgrade(),
            gh,
            listed: watch::Sender::new(None),
            wake: Notify::new(),
            force: AtomicBool::new(false),
            reading: Mutex::new(false),
            working: Mutex::new(HashSet::new()),
            state: Mutex::new(Read::default()),
        })
    }

    /// The Project, while it is open.
    fn project(&self) -> Result<ModuleProject, Error> {
        self.project.upgrade().ok_or(Error::Closed)
    }

    /// Says something changed: a link, a turn, a push. With `force`, every
    /// open one is read again now.
    pub fn poke(&self, force: bool) {
        if force {
            self.force.store(true, Ordering::Relaxed);
        }
        self.wake.notify_one();
    }

    /// The list now, and again each time it changes. It reads while one of
    /// these is held.
    pub fn stream(self: &Arc<Self>) -> Stream {
        let mut listed = self.listed.subscribe();
        {
            let mut reading = self.reading.lock().unwrap();
            if !*reading {
                *reading = true;
                tokio::spawn(self.clone().read_while_followed());
            } else {
                self.poke(false);
            }
        }
        // One list waits at a time; a newer one replaces it.
        let (say, heard) = mpsc::channel(1);
        tokio::spawn(async move {
            let mut told: Option<Arc<Listed>> = None;
            loop {
                let now = listed.borrow_and_update().clone();
                if let Some(now) = now
                    && told.as_deref() != Some(&*now)
                {
                    let Ok(said) = serde_json::to_value(&*now) else {
                        return;
                    };
                    if say.send(said).await.is_err() {
                        return;
                    }
                    told = Some(now);
                }
                tokio::select! {
                    changed = listed.changed() => if changed.is_err() {
                        return;
                    },
                    () = say.closed() => return,
                }
            }
        });
        heard
    }

    /// The list as it is kept now, the links not read yet read first.
    pub async fn list(&self) -> Result<Listed, Error> {
        let rows = self.project()?.read(store::links).await?;
        let unread = self.unread(&rows).await?;
        if !unread.is_empty() {
            self.read(unread, banda_kernel::now_ms()).await?;
        }
        self.compose().await
    }

    async fn read_while_followed(self: Arc<Self>) {
        loop {
            let now = banda_kernel::now_ms();
            let next = match self.turn(now).await {
                Ok(next) => next,
                // Its Project closed: the list ends, and what follows it.
                Err(Error::Closed) => {
                    *self.reading.lock().unwrap() = false;
                    return;
                }
                Err(error) => {
                    tracing::warn!(%error, "the pull requests were not read");
                    Some(Duration::from_millis(OPEN as u64))
                }
            };
            let sleep = next.unwrap_or(Duration::from_secs(3600));
            tokio::select! {
                () = tokio::time::sleep(sleep) => {}
                () = self.wake.notified() => {}
                () = self.listed.closed() => {}
            }
            let mut reading = self.reading.lock().unwrap();
            if self.listed.receiver_count() == 0 {
                *reading = false;
                return;
            }
        }
    }

    /// One turn of the loop: reads what is due, tells the list, and says
    /// when the next is due.
    async fn turn(&self, now: i64) -> Result<Option<Duration>, Error> {
        let force = self.force.swap(false, Ordering::Relaxed);
        let rows = self.project()?.read(store::links).await?;
        let known = self.known(&rows).await?;
        let paused = now < self.state.lock().unwrap().paused_until;
        if !paused {
            let due = due(&known, now, force);
            if !due.is_empty() {
                self.read(due, now).await?;
            }
        }
        let listed = self.compose().await?;
        self.listed.send_if_modified(|was| {
            let changed = was.as_deref() != Some(&listed);
            if changed {
                *was = Some(Arc::new(listed));
            }
            changed
        });
        let known = self.known(&rows).await?;
        let paused_until = self.state.lock().unwrap().paused_until;
        Ok(next(&known, banda_kernel::now_ms()).map(|next| {
            let wait = (paused_until - now).max(0);
            next.max(Duration::from_millis(wait as u64))
        }))
    }

    /// Each linked pull request, once, with what was kept of it.
    async fn known(&self, rows: &[Row]) -> Result<Vec<(PullRef, Option<(Snapshot, bool)>)>, Error> {
        let pulls: Vec<PullRef> = unique(rows);
        self.project()?
            .read(move |sql| {
                pulls
                    .into_iter()
                    .map(|pull| {
                        let kept = store::read(sql, &pull)?;
                        Ok((pull, kept))
                    })
                    .collect()
            })
            .await
    }

    async fn unread(&self, rows: &[Row]) -> Result<Vec<PullRef>, Error> {
        let known = self.known(rows).await?;
        Ok(known
            .into_iter()
            .filter(|(_, kept)| kept.is_none())
            .map(|(pull, _)| pull)
            .collect())
    }

    /// Reads `pulls` from GitHub, a query a host, and keeps what it says.
    async fn read(&self, pulls: Vec<PullRef>, now: i64) -> Result<(), Error> {
        let mut hosts: BTreeMap<String, Vec<PullRef>> = BTreeMap::new();
        for pull in pulls {
            hosts.entry(pull.host.clone()).or_default().push(pull);
        }
        for (_, pulls) in hosts {
            match github::read(&self.gh, &pulls, now).await {
                Ok(read) => {
                    {
                        let mut state = self.state.lock().unwrap();
                        state.missing = None;
                        state.synced_at = Some(now);
                    }
                    let found = read.pulls;
                    self.project()?
                        .write(move |tx| {
                            for (pull, snapshot) in &found {
                                store::keep(tx.sql(), pull, snapshot)?;
                            }
                            Ok(())
                        })
                        .await?;
                }
                Err(missed) => {
                    let mut state = self.state.lock().unwrap();
                    if missed == Missed::RateLimited {
                        state.paused_until = now + PAUSE;
                    }
                    tracing::info!(missed = %missed.words(), "GitHub was not read");
                    state.missing = Some(missed.words());
                }
            }
        }
        Ok(())
    }

    /// The list from what is kept, and who works now.
    async fn compose(&self) -> Result<Listed, Error> {
        let rows = self.project()?.read(store::links).await?;
        let known: HashMap<PullRef, Snapshot> = self
            .known(&rows)
            .await?
            .into_iter()
            .filter_map(|(pull, kept)| Some((pull, kept?.0)))
            .collect();
        let working = self.working.lock().unwrap().clone();
        let state = self.state.lock().unwrap();
        let mut listed = list(&rows, &known, &working, banda_kernel::now_ms());
        listed.missing = state.missing.clone();
        listed.synced_at = state.synced_at;
        Ok(listed)
    }
}

/// Each pull request `rows` link, once, in the order first linked.
fn unique(rows: &[Row]) -> Vec<PullRef> {
    let mut seen = HashSet::new();
    rows.iter()
        .filter(|row| seen.insert(row.pull.clone()))
        .map(|row| row.pull.clone())
        .collect()
}

/// How often the open ones are read: every minute, or every five once
/// none changed for half an hour.
fn every(known: &[(PullRef, Option<(Snapshot, bool)>)], now: i64) -> i64 {
    let newest = known
        .iter()
        .filter_map(|(_, kept)| kept.as_ref())
        .filter(|(snapshot, _)| snapshot.state == State::Open)
        .map(|(snapshot, _)| snapshot.updated_at)
        .max();
    match newest {
        Some(newest) if now - newest >= QUIET_AFTER => QUIET,
        _ => OPEN,
    }
}

/// Which pull requests are due to be read now: one never read; an open
/// one read longer ago than [`every`] says, or every open one with
/// `force`; one merged or closed once more, then never.
pub fn due(known: &[(PullRef, Option<(Snapshot, bool)>)], now: i64, force: bool) -> Vec<PullRef> {
    let every = every(known, now);
    known
        .iter()
        .filter(|(_, kept)| match kept {
            None => true,
            Some((_, true)) => false,
            Some((snapshot, false)) if snapshot.state != State::Open => true,
            Some((snapshot, false)) => force || now - snapshot.synced_at >= every,
        })
        .map(|(pull, _)| pull.clone())
        .collect()
}

/// When the next read is due; none while nothing is open.
pub fn next(known: &[(PullRef, Option<(Snapshot, bool)>)], now: i64) -> Option<Duration> {
    let every = every(known, now);
    known
        .iter()
        .filter_map(|(_, kept)| match kept {
            None => Some(0),
            Some((_, true)) => None,
            Some((snapshot, false)) if snapshot.state != State::Open => Some(0),
            Some((snapshot, false)) => Some((every - (now - snapshot.synced_at)).max(0)),
        })
        .min()
        .map(|ms| Duration::from_millis(ms.max(1000) as u64))
}

/// The list: one row a pull request, the most urgent first, landed ones
/// for a day.
pub fn list(
    rows: &[Row],
    known: &HashMap<PullRef, Snapshot>,
    working: &HashSet<String>,
    now: i64,
) -> Listed {
    let mut pulls: Vec<Pull> = Vec::new();
    for pull in unique(rows) {
        let linking: Vec<&Row> = rows.iter().filter(|row| row.pull == pull).collect();
        let owner = linking
            .iter()
            .find(|row| row.by != By::Person)
            .or(linking.last())
            .copied()
            .expect("a pull request in the rows has a row");
        let snapshot = known.get(&pull).cloned();
        let need = snapshot.as_ref().map(judge::need);
        let turn = (snapshot.as_ref()).zip(need).map(|(snapshot, need)| {
            judge::turn(
                need,
                snapshot,
                owner.auto_fix,
                working.contains(&owner.thread),
            )
        });
        if let Some(snapshot) = &snapshot {
            let landed = snapshot.merged_at.or(snapshot.closed_at);
            if snapshot.state != State::Open && landed.is_some_and(|at| now - at > LANDED_FOR) {
                continue;
            }
        }
        pulls.push(Pull {
            url: owner.url.clone(),
            threads: linking.iter().map(|row| row.thread.clone()).collect(),
            owner: owner.thread.clone(),
            by: owner.by,
            auto_fix: owner.auto_fix,
            pull,
            snapshot,
            need,
            turn,
        });
    }
    let rank = |pull: &Pull| {
        let turn = match pull.turn {
            Some(Turn::Person) => 0,
            Some(Turn::Agent) => 1,
            Some(Turn::Waiting) => 2,
            None => 3,
            Some(Turn::Landed) => 4,
        };
        (turn, pull.need.unwrap_or(Need::Closed))
    };
    pulls.sort_by_key(rank);
    Listed {
        pulls,
        missing: None,
        synced_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Checks, Counted};

    fn pull(number: u32) -> PullRef {
        PullRef {
            host: "github.com".into(),
            repo: "o/r".into(),
            number,
        }
    }

    fn read(state: State, synced_at: i64, updated_at: i64) -> Snapshot {
        Snapshot {
            state,
            draft: false,
            title: "t".into(),
            head: "h".into(),
            base: "main".into(),
            checks: Some(Checks::Passing),
            counted: Counted::default(),
            review: None,
            asked_of_you: false,
            conflicts: false,
            auto_merge: false,
            additions: 0,
            deletions: 0,
            updated_at,
            merged_at: (state == State::Merged).then_some(updated_at),
            closed_at: None,
            synced_at,
        }
    }

    #[test]
    fn reads_at_t3_code_s_pace() {
        let now = 10 * QUIET_AFTER;
        let busy = now - 1000;
        let known = vec![
            (pull(1), None),
            (pull(2), Some((read(State::Open, now - OPEN, busy), false))),
            (
                pull(3),
                Some((read(State::Open, now - 10_000, busy), false)),
            ),
            (
                pull(4),
                Some((read(State::Merged, now - 10_000, busy), false)),
            ),
            (
                pull(5),
                Some((read(State::Merged, now - 10_000, busy), true)),
            ),
        ];
        let numbers = |due: Vec<PullRef>| due.iter().map(|p| p.number).collect::<Vec<_>>();
        assert_eq!(numbers(due(&known, now, false)), [1, 2, 4]);
        assert_eq!(numbers(due(&known, now, true)), [1, 2, 3, 4]);
        // Quiet for half an hour: every five minutes.
        let quiet = vec![(
            pull(2),
            Some((read(State::Open, now - OPEN, now - QUIET_AFTER), false)),
        )];
        assert!(due(&quiet, now, false).is_empty());
        assert_eq!(
            next(&quiet, now),
            Some(Duration::from_millis((QUIET - OPEN) as u64))
        );
        // Nothing open: nothing due until something changes.
        let landed = vec![(pull(5), Some((read(State::Merged, now, busy), true)))];
        assert_eq!(next(&landed, now), None);
    }

    #[test]
    fn lists_the_most_urgent_first_and_owned_by_the_thread_that_made_it() {
        let row = |thread: &str, number, by: By| Row {
            thread: thread.into(),
            pull: pull(number),
            url: pull(number).url(),
            by,
            auto_fix: by.made(),
        };
        let rows = vec![
            row("a", 1, By::Agent),
            row("b", 1, By::Person),
            row("b", 2, By::Person),
            row("c", 3, By::Created),
        ];
        let now = 1_000_000_000;
        let mut failing = read(State::Open, now, now);
        failing.checks = Some(Checks::Failing);
        let known = HashMap::from([
            (pull(1), failing.clone()),
            (pull(2), read(State::Open, now, now)),
            (pull(3), read(State::Merged, now, now - 2 * LANDED_FOR)),
        ]);
        let listed = list(&rows, &known, &HashSet::new(), now);
        let numbers: Vec<u32> = listed.pulls.iter().map(|p| p.pull.number).collect();
        // #2 is ready, the Person's; #1 fails, its Agent's; #3 landed long
        // ago.
        assert_eq!(numbers, [2, 1]);
        assert_eq!(listed.pulls[1].owner, "a");
        assert_eq!(listed.pulls[1].threads, ["a", "b"]);
        assert_eq!(listed.pulls[1].turn, Some(Turn::Agent));
        assert_eq!(listed.pulls[0].turn, Some(Turn::Person));
    }
}
