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
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc;

/// How far apart two changes may be and still come as one.
const QUIET: Duration = Duration::from_millis(120);

/// Whether the system tells changes through FSEvents, as on a Mac, whose
/// watch can hear a change from just before it began ([`told`]).
fn fsevents() -> bool {
    <RecommendedWatcher as notify::Watcher>::kind() == notify::WatcherKind::Fsevent
}

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
    /// Each folder heard, and when it was made, as its watch began.
    dirs: HashMap<PathBuf, Made>,
    say: mpsc::UnboundedSender<Changed>,
}

/// When a folder was made, which tells it from one made at its path since:
/// none where the system does not say.
type Made = Option<SystemTime>;

/// When the folder at `path` was made: none if it is gone.
fn made(path: &Path) -> Made {
    std::fs::metadata(path).and_then(|meta| meta.created()).ok()
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
        let mut watched = HashMap::new();
        for dir in dirs {
            if watched.contains_key(&dir) {
                continue;
            }
            let Some(meta) = std::fs::metadata(&dir).ok().filter(|meta| meta.is_dir()) else {
                continue;
            };
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
            watched.insert(dir, meta.created().ok());
        }
        hearers.next += 1;
        let id = hearers.next;
        let hearer = Hearer {
            dirs: watched.clone(),
            say,
        };
        hearers.by_id.insert(id, hearer);
        let watched = watched.into_keys().collect();
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
        for dir in hearer.dirs.into_keys() {
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
            let lost: Vec<PathBuf> = (hearer.dirs.extract_if(|dir, _| dirs.contains(dir)))
                .map(|(dir, _)| dir)
                .collect();
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
    let events = match &result {
        Ok(events) => events.as_slice(),
        // What the system could not say may be anything.
        Err(_) => &[],
    };
    let again = result.is_err() || events.iter().any(|event| event.need_rescan());
    let fsevents = fsevents();
    for hearer in hearers.by_id.values() {
        let changed = if again {
            Changed::Again(hearer.dirs.keys().cloned().collect())
        } else {
            let dirs: HashSet<&Path> = (events.iter())
                .flat_map(|event| event.paths.iter().map(move |path| (&event.kind, path)))
                .flat_map(|(kind, path)| told(kind, path, &hearer.dirs, fsevents, made))
                .collect();
            if dirs.is_empty() {
                continue;
            }
            Changed::Dirs(dirs.into_iter().map(Path::to_path_buf).collect())
        };
        let _ = hearer.say.send(changed);
    }
}

/// The folders of a hearer's `dirs` whose listings a change of `kind` to
/// `path` changes: the folder that holds `path`, and `path` itself when it
/// is one of them. `made` says when the folder at a path was made.
///
/// With FSEvents (`fsevents`), a watch starts the stream from "now", and on
/// a busy Mac a change from just before can still come after it (#732): a
/// folder made just before it was watched is heard made. When the folder
/// there is the very one watched, as `made` says, that is no news to it or
/// its parent.
fn told<'a>(
    kind: &EventKind,
    path: &'a Path,
    dirs: &HashMap<PathBuf, Made>,
    fsevents: bool,
    made: impl FnOnce(&Path) -> Made,
) -> Vec<&'a Path> {
    if !touches(kind) {
        return Vec::new();
    }
    let parent = path.parent().filter(|parent| dirs.contains_key(*parent));
    let Some(watched) = dirs.get(path) else {
        return parent.into_iter().collect();
    };
    // The very folder watched, made before its watch began: said late.
    let late = fsevents
        && matches!(kind, EventKind::Create(_))
        && watched.is_some()
        && made(path) == *watched;
    if late {
        return Vec::new();
    }
    [path].into_iter().chain(parent).collect()
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

    /// FSEvents has one stream for all the folders watched, made again for
    /// each folder watched or let go: a change made meanwhile is still
    /// heard (#1166).
    #[tokio::test]
    async fn a_change_is_heard_while_other_folders_are_watched() {
        let root = tempfile::tempdir().unwrap();
        let base = dunce::canonicalize(root.path()).unwrap();
        let heard_in = base.join("heard");
        std::fs::create_dir(&heard_in).unwrap();
        let others: Vec<PathBuf> = (0..20).map(|n| base.join(format!("other-{n}"))).collect();
        for other in &others {
            std::fs::create_dir(other).unwrap();
        }
        let mut watch = watch([heard_in.clone()]).unwrap();
        let mut kept = Vec::new();
        for (n, other) in others.into_iter().enumerate() {
            std::fs::write(heard_in.join(format!("{n}.txt")), "x").unwrap();
            kept.push(super::watch([other]).unwrap());
            match heard(&mut watch).await {
                Changed::Dirs(dirs) => assert_eq!(dirs, std::slice::from_ref(&heard_in)),
                Changed::Again(_) => panic!("the system lost track"),
            }
        }
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

    /// What a Pane that shows `/p`, its folder `src` open, hears of a change
    /// to `path`, from inotify or from FSEvents (`fsevents`): the folder at
    /// `path` was made `made_at` seconds in, `/p` at 1 and `src` at 2 as
    /// their watch began.
    fn told_to_a_pane(kind: EventKind, path: &str, fsevents: bool, made_at: u64) -> Vec<PathBuf> {
        let at = |secs| Some(SystemTime::UNIX_EPOCH + Duration::from_secs(secs));
        let dirs = HashMap::from([
            (PathBuf::from("/p"), at(1)),
            (PathBuf::from("/p/src"), at(2)),
        ]);
        let mut told: Vec<PathBuf> =
            (super::told(&kind, Path::new(path), &dirs, fsevents, |_| at(made_at)))
                .into_iter()
                .map(Path::to_path_buf)
                .collect();
        told.sort();
        told
    }

    fn paths(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_change_is_told_to_the_folder_whose_listing_has_it_on_linux_and_on_a_mac() {
        use notify::event::{CreateKind, DataChange, RemoveKind, RenameMode};
        for fsevents in [false, true] {
            let told = |kind, path| told_to_a_pane(kind, path, fsevents, 2);
            // A file written in src: src, not the folder above it.
            let new = EventKind::Create(CreateKind::File);
            assert_eq!(told(new, "/p/src/new.rs"), paths(&["/p/src"]));
            let written = EventKind::Modify(ModifyKind::Data(DataChange::Content));
            assert_eq!(told(written, "/p/src/new.rs"), paths(&["/p/src"]));
            // A file made or gone in the root: the root.
            assert_eq!(told(new, "/p/notes.md"), paths(&["/p"]));
            let gone_file = EventKind::Remove(RemoveKind::File);
            assert_eq!(told(gone_file, "/p/notes.md"), paths(&["/p"]));
            // A folder not watched, made or renamed: the one that holds it.
            let new_folder = EventKind::Create(CreateKind::Folder);
            assert_eq!(told(new_folder, "/p/lib"), paths(&["/p"]));
            let renamed = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
            assert_eq!(told(renamed, "/p/lib"), paths(&["/p"]));
            // src gone, renamed, or changed itself: src, and the folder that
            // lists it.
            let gone = EventKind::Remove(RemoveKind::Folder);
            assert_eq!(told(gone, "/p/src"), paths(&["/p", "/p/src"]));
            assert_eq!(told(renamed, "/p/src"), paths(&["/p", "/p/src"]));
            let changed = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any));
            assert_eq!(told(changed, "/p/src"), paths(&["/p", "/p/src"]));
            let content = EventKind::Modify(ModifyKind::Any);
            assert_eq!(told(content, "/p/src"), paths(&["/p", "/p/src"]));
            // Reading is no change.
            let read = EventKind::Access(AccessKind::Open(notify::event::AccessMode::Read));
            assert_eq!(told(read, "/p/src"), paths(&[]));
        }
    }

    #[test]
    fn on_a_mac_a_watched_folder_heard_made_late_is_no_news() {
        use notify::event::CreateKind;
        let new_folder = EventKind::Create(CreateKind::Folder);
        // inotify, as before: src made tells src and the root, as the
        // root's watch says it.
        for made_at in [2, 3] {
            assert_eq!(
                told_to_a_pane(new_folder, "/p/src", false, made_at),
                paths(&["/p", "/p/src"])
            );
        }
        // FSEvents: the making of src, or of /p itself, from before the
        // watch, as it says it late: no news (#732).
        assert_eq!(told_to_a_pane(new_folder, "/p/src", true, 2), paths(&[]));
        assert_eq!(told_to_a_pane(new_folder, "/p", true, 1), paths(&[]));
        // src made again since: the root lists it again.
        assert_eq!(
            told_to_a_pane(new_folder, "/p/src", true, 3),
            paths(&["/p", "/p/src"])
        );
    }

    #[test]
    fn reading_is_no_change() {
        assert!(!touches(&EventKind::Access(AccessKind::Open(
            notify::event::AccessMode::Read
        ))));
        assert!(touches(&EventKind::Create(notify::event::CreateKind::File)));
    }
}
