//! Watching folders for the modules (ADR 0073, decisions 4 and 14): what
//! changed in the folders a Pane shows, as the system tells it, with no
//! reading again on a timer.
//!
//! One watcher serves the whole engine, as the system's watches are
//! counted per user: each folder is watched once, however many ask, and
//! let go when the last one does. It watches a folder, not what is under
//! it, so a tree pays for the folders it has open. Changes less than
//! [`QUIET`] apart come as one. When the system drops changes, it says to
//! read every folder again; when it has no watch left to give (inotify's
//! `max_user_watches`), it says which folders it could not watch.

use notify_debouncer_full::notify::event::{AccessKind, MetadataKind, ModifyKind};
use notify_debouncer_full::notify::{self, EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, NoCache, new_debouncer_opt};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tokio::sync::mpsc;

/// How far apart two changes may be and still come as one.
const QUIET: Duration = Duration::from_millis(120);

/// What a [`Watch`] hears.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Changed {
    /// These folders' listings changed: a name came, went or was renamed,
    /// or what is behind one changed.
    Dirs(Vec<PathBuf>),
    /// The system lost track: read all of these folders again.
    Again(Vec<PathBuf>),
}

/// Some folders, watched until this is dropped.
pub struct Watch {
    id: u64,
    heard: mpsc::UnboundedReceiver<Changed>,
    watched: Vec<PathBuf>,
    limited: Vec<PathBuf>,
}

impl Watch {
    /// The folders watched: those asked, but for those gone, those that
    /// are no folder, and the [`Watch::limited`].
    pub fn watched(&self) -> &[PathBuf] {
        &self.watched
    }

    /// The folders the system had no watch left for, so no change in
    /// them is heard: raise inotify's `max_user_watches` to watch them.
    pub fn limited(&self) -> &[PathBuf] {
        &self.limited
    }

    /// What changed next, all that came meanwhile as one; none once the
    /// engine's watcher has stopped.
    pub async fn next(&mut self) -> Option<Changed> {
        let mut heard = self.heard.recv().await?;
        while let Ok(more) = self.heard.try_recv() {
            heard = match (heard, more) {
                (Changed::Again(dirs), _) | (_, Changed::Again(dirs)) => Changed::Again(dirs),
                (Changed::Dirs(mut dirs), Changed::Dirs(more)) => {
                    for dir in more {
                        if !dirs.contains(&dir) {
                            dirs.push(dir);
                        }
                    }
                    Changed::Dirs(dirs)
                }
            };
        }
        Some(heard)
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        if let Some(watcher) = WATCHER.get() {
            watcher.let_go(self.id);
        }
    }
}

/// Watches `dirs`, each by itself and not what is under it, until the
/// [`Watch`] is dropped. A path that is no folder, or one gone, is not
/// watched. Fails only when the system gives no watcher at all.
pub fn watch(dirs: impl IntoIterator<Item = PathBuf>) -> std::io::Result<Watch> {
    let watcher = match WATCHER.get() {
        Some(watcher) => watcher,
        None => {
            let started = Watcher::start().map_err(std::io::Error::other)?;
            WATCHER.get_or_init(|| started)
        }
    };
    Ok(watcher.watch(dirs))
}

/// Lets go of the system's watch of `folder` and of each folder under it,
/// as it is about to move: Windows moves no folder a watch holds, and
/// elsewhere one would go on under the old name. Whoever watched one still
/// does, till it moved ([`Released::moved`]).
pub(crate) fn let_go_under(folder: &Path) -> Released {
    let dirs = WATCHER.get().map(|watcher| watcher.unwatch_under(folder));
    Released {
        dirs: dirs.unwrap_or_default(),
    }
}

/// The folders [`let_go_under`] let go of. Dropped before they moved, as
/// when a move fails, each still heard is watched again.
pub(crate) struct Released {
    dirs: Vec<PathBuf>,
}

impl Released {
    /// They moved: whoever watched one hears to read it again, where it is
    /// gone, and watches it no more.
    pub(crate) fn moved(mut self) {
        let dirs = std::mem::take(&mut self.dirs);
        if let Some(watcher) = WATCHER.get() {
            watcher.moved(&dirs);
        }
    }
}

impl Drop for Released {
    fn drop(&mut self) {
        if let Some(watcher) = WATCHER.get().filter(|_| !self.dirs.is_empty()) {
            watcher.stayed(&self.dirs);
        }
    }
}

/// The engine's one watcher.
static WATCHER: OnceLock<Watcher> = OnceLock::new();

struct Watcher {
    /// Taken first, while folders are watched or let go.
    system: Mutex<Debouncer<RecommendedWatcher, NoCache>>,
    hearers: Arc<Mutex<Hearers>>,
}

#[derive(Default)]
struct Hearers {
    next: u64,
    by_id: HashMap<u64, Hearer>,
    /// How many hearers watch each folder.
    counts: HashMap<PathBuf, usize>,
}

struct Hearer {
    dirs: HashSet<PathBuf>,
    say: mpsc::UnboundedSender<Changed>,
}

fn held<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Watcher {
    fn start() -> notify::Result<Watcher> {
        let hearers = Arc::new(Mutex::<Hearers>::default());
        let told = hearers.clone();
        let system = new_debouncer_opt(
            QUIET,
            None,
            move |result: DebounceEventResult| tell(&held(&told), result),
            NoCache,
            notify::Config::default(),
        )?;
        Ok(Watcher {
            system: Mutex::new(system),
            hearers,
        })
    }

    fn watch(&self, dirs: impl IntoIterator<Item = PathBuf>) -> Watch {
        let mut system = held(&self.system);
        let mut hearers = held(&self.hearers);
        let (say, heard) = mpsc::unbounded_channel();
        let mut limited = Vec::new();
        let mut watched = HashSet::new();
        for dir in dirs {
            if watched.contains(&dir) || !dir.is_dir() {
                continue;
            }
            let count = hearers.counts.get(&dir).copied().unwrap_or(0);
            if count == 0 {
                match system.watch(&dir, RecursiveMode::NonRecursive) {
                    Ok(()) => {}
                    Err(error) if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) => {
                        limited.push(dir);
                        continue;
                    }
                    Err(error) => {
                        tracing::debug!(dir = %dir.display(), %error, "not watched");
                        continue;
                    }
                }
            }
            hearers.counts.insert(dir.clone(), count + 1);
            watched.insert(dir);
        }
        hearers.next += 1;
        let id = hearers.next;
        let hearer = Hearer {
            dirs: watched.clone(),
            say,
        };
        hearers.by_id.insert(id, hearer);
        let watched = watched.into_iter().collect();
        Watch {
            id,
            heard,
            watched,
            limited,
        }
    }

    fn let_go(&self, id: u64) {
        let mut system = held(&self.system);
        let mut hearers = held(&self.hearers);
        let Some(hearer) = hearers.by_id.remove(&id) else {
            return;
        };
        for dir in hearer.dirs {
            let Some(count) = hearers.counts.get_mut(&dir) else {
                continue;
            };
            *count -= 1;
            if *count == 0 {
                hearers.counts.remove(&dir);
                // A folder gone took its watch with it.
                let _ = system.unwatch(&dir);
            }
        }
    }
}

impl Watcher {
    /// The folders watched under `folder`, their system's watches let go
    /// of, which their hearers keep.
    fn unwatch_under(&self, folder: &Path) -> Vec<PathBuf> {
        let mut system = held(&self.system);
        let hearers = held(&self.hearers);
        let under: Vec<PathBuf> = (hearers.counts.keys())
            .filter(|dir| crate::host::within(dir, folder))
            .cloned()
            .collect();
        for dir in &under {
            let _ = system.unwatch(dir);
        }
        under
    }

    fn moved(&self, dirs: &[PathBuf]) {
        let mut hearers = held(&self.hearers);
        for dir in dirs {
            hearers.counts.remove(dir);
        }
        for hearer in hearers.by_id.values_mut() {
            let lost: Vec<PathBuf> = hearer.dirs.extract_if(|dir| dirs.contains(dir)).collect();
            if !lost.is_empty() {
                let _ = hearer.say.send(Changed::Again(lost));
            }
        }
    }

    /// `dirs` stayed: each still heard is watched again.
    fn stayed(&self, dirs: &[PathBuf]) {
        let mut system = held(&self.system);
        let hearers = held(&self.hearers);
        for dir in dirs.iter().filter(|dir| hearers.counts.contains_key(*dir)) {
            if let Err(error) = system.watch(dir, RecursiveMode::NonRecursive) {
                tracing::debug!(dir = %dir.display(), %error, "not watched again");
            }
        }
    }
}

/// Tells each hearer what changed in its folders.
fn tell(hearers: &Hearers, result: DebounceEventResult) {
    let mut changed: HashSet<&Path> = HashSet::new();
    let mut again = false;
    let events = match &result {
        Ok(events) => events.as_slice(),
        // What the system could not say may be anything.
        Err(_) => {
            again = true;
            &[]
        }
    };
    for event in events {
        if event.need_rescan() {
            again = true;
        }
        if !touches(&event.kind) {
            continue;
        }
        for path in &event.paths {
            changed.insert(path);
            if let Some(parent) = path.parent() {
                changed.insert(parent);
            }
        }
    }
    for hearer in hearers.by_id.values() {
        let changed = if again {
            Changed::Again(hearer.dirs.iter().cloned().collect())
        } else {
            let dirs: Vec<PathBuf> = (hearer.dirs.iter())
                .filter(|dir| changed.contains(dir.as_path()))
                .cloned()
                .collect();
            if dirs.is_empty() {
                continue;
            }
            Changed::Dirs(dirs)
        };
        let _ = hearer.say.send(changed);
    }
}

/// Whether a change changes what a listing shows: reading a file or a
/// folder does not, nor does its time of last reading.
fn touches(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(_)) => true,
        EventKind::Access(_) => false,
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)) => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;

    const WITHIN: Duration = Duration::from_secs(5);

    async fn heard(watch: &mut Watch) -> Changed {
        timeout(WITHIN, watch.next())
            .await
            .expect("heard nothing in time")
            .expect("the watcher stopped")
    }

    #[tokio::test]
    async fn a_new_file_is_heard_in_its_folder_and_only_there() {
        let root = tempfile::tempdir().unwrap();
        let base = dunce::canonicalize(root.path()).unwrap();
        let (one, two) = (base.join("one"), base.join("two"));
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        let mut watch = watch([one.clone(), two.clone()]).unwrap();
        assert!(watch.limited().is_empty());
        std::fs::write(one.join("a.txt"), "a").unwrap();
        assert_eq!(heard(&mut watch).await, Changed::Dirs(vec![one.clone()]));
        std::fs::remove_file(one.join("a.txt")).unwrap();
        std::fs::write(two.join("b.txt"), "b").unwrap();
        let mut dirs = Vec::new();
        while dirs.len() < 2 {
            match heard(&mut watch).await {
                Changed::Dirs(more) => dirs.extend(more),
                Changed::Again(_) => panic!("the system lost track"),
            }
            dirs.sort();
            dirs.dedup();
        }
        assert_eq!(dirs, [one, two]);
    }

    #[tokio::test]
    async fn two_watches_of_one_folder_each_hear_and_one_let_go_leaves_the_other() {
        let root = tempfile::tempdir().unwrap();
        let dir = dunce::canonicalize(root.path()).unwrap();
        let first = watch([dir.clone()]).unwrap();
        let mut second = watch([dir.clone()]).unwrap();
        drop(first);
        std::fs::create_dir(dir.join("new")).unwrap();
        assert_eq!(heard(&mut second).await, Changed::Dirs(vec![dir]));
    }

    #[tokio::test]
    async fn changes_close_together_come_as_one() {
        let root = tempfile::tempdir().unwrap();
        let dir = dunce::canonicalize(root.path()).unwrap();
        let mut watch = watch([dir.clone()]).unwrap();
        for n in 0..20 {
            std::fs::write(dir.join(format!("{n}.txt")), "x").unwrap();
        }
        assert_eq!(heard(&mut watch).await, Changed::Dirs(vec![dir]));
        // Fewer pieces than changes: some came as one.
        let mut more = 0;
        while timeout(Duration::from_millis(400), watch.next())
            .await
            .is_ok()
        {
            more += 1;
        }
        assert!(more < 19, "{more} more pieces for 20 changes");
    }

    #[tokio::test]
    async fn a_folder_about_to_move_is_let_go_of_and_its_hearers_read_it_again() {
        let root = tempfile::tempdir().unwrap();
        let base = dunce::canonicalize(root.path()).unwrap();
        let (moving, beside) = (base.join("moving"), base.join("beside"));
        let inside = moving.join("src");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::create_dir_all(&beside).unwrap();
        let mut watch = watch([moving.clone(), inside.clone(), beside.clone()]).unwrap();
        // It would not move: it is heard again.
        drop(let_go_under(&moving));
        std::fs::write(inside.join("stayed.txt"), "x").unwrap();
        assert_eq!(heard(&mut watch).await, Changed::Dirs(vec![inside.clone()]));
        let released = let_go_under(&moving);
        std::fs::rename(&moving, base.join("moved")).unwrap();
        released.moved();
        let Changed::Again(mut again) = heard(&mut watch).await else {
            panic!("not told to read again");
        };
        again.sort();
        assert_eq!(again, [moving.clone(), inside]);
        // The folder beside it is still heard.
        std::fs::write(beside.join("new.txt"), "x").unwrap();
        assert_eq!(heard(&mut watch).await, Changed::Dirs(vec![beside]));
    }

    #[test]
    fn reading_is_no_change() {
        assert!(!touches(&EventKind::Access(AccessKind::Open(
            notify::event::AccessMode::Read
        ))));
        assert!(touches(&EventKind::Create(notify::event::CreateKind::File)));
    }
}
