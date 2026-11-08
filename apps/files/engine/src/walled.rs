//! Where an Agent's call does its work (ADR 0083): on a thread of its
//! own, which the kernel keeps to its Project's folder, beside the path
//! guard (`banda_kernel::Reach`). On Linux, Landlock keeps the thread
//! there; it reads the system's own folders, and nothing else outside.
//! Where the kernel has no Landlock, the thread is as any other.

use std::cell::Cell;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, OnceLock};

/// A piece of work a walled thread hands [`outside`].
type Piece = Box<dyn FnOnce() + Send>;

/// The one thread that does, for walled threads, what reaches past their
/// Project: started by an engine thread, so no wall is on it. A thread a
/// walled one starts is walled too, so this one is never started there.
static OUTSIDE: OnceLock<Mutex<Sender<Piece>>> = OnceLock::new();

thread_local! {
    /// Whether this thread is kept to its Project's folder.
    static WALLED: Cell<bool> = const { Cell::new(false) };
}

/// The system's folders a walled thread reads, for what a library reads
/// of them, as the time zone: none of Banda's own is in them.
#[cfg(target_os = "linux")]
const SYSTEM: [&str; 2] = ["/usr", "/etc"];

/// Runs `work` on a thread of its own, kept to `folders`, and answers what
/// it did; refused when the thread could not be kept there.
pub async fn run<T: Send + 'static>(
    folders: Vec<PathBuf>,
    work: impl FnOnce() -> T + Send + 'static,
) -> io::Result<T> {
    let (done, answer) = tokio::sync::oneshot::channel();
    spawn(folders, move || {
        let _ = done.send(work());
    })?;
    answer
        .await
        .map_err(|_| io::Error::other("the work could not be kept to its Project's folder"))
}

/// Starts `work` on a thread of its own, kept to `folders`: it does not
/// run when the thread could not be kept there.
pub fn spawn(folders: Vec<PathBuf>, work: impl FnOnce() + Send + 'static) -> io::Result<()> {
    if OUTSIDE.get().is_none() {
        let (give, pieces) = channel::<Piece>();
        let started = std::thread::Builder::new()
            .name("banda-outside".to_owned())
            .spawn(move || pieces.into_iter().for_each(|piece| piece()));
        if started.is_ok() {
            let _ = OUTSIDE.set(Mutex::new(give));
        }
    }
    let thread = std::thread::Builder::new().name("banda-walled".to_owned());
    thread.spawn(move || match keep(&folders) {
        Ok(()) => {
            WALLED.set(true);
            work()
        }
        Err(error) => {
            tracing::warn!(%error, "a walled call's thread could not be kept to its Project")
        }
    })?;
    Ok(())
}

/// Does `work` where no wall is: on the thread it is called on, unless
/// that one is walled, and then on the one thread outside. For what the
/// system's Trash does, which reads the system's mounts and writes the
/// Trash's folder, for a path in the Project. `None` when the thread
/// outside is gone.
pub fn outside<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    if !WALLED.get() {
        return Some(work());
    }
    let (done, answer) = channel();
    let give = OUTSIDE.get()?.lock().ok()?.clone();
    give.send(Box::new(move || {
        let _ = done.send(work());
    }))
    .ok()?;
    answer.recv().ok()
}

/// Keeps this thread, and what it starts, to `folders`, and to reading
/// the system's: for good, so the thread ends with its work.
#[cfg(target_os = "linux")]
fn keep(folders: &[PathBuf]) -> io::Result<()> {
    use landlock::{
        ABI, Access, AccessFs, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr,
    };
    let abi = ABI::V5;
    let (all, read) = (AccessFs::from_all(abi), AccessFs::from_read(abi));
    let failed = |error: &dyn std::fmt::Display| io::Error::other(error.to_string());
    let mut rules = Ruleset::default()
        .handle_access(all)
        .and_then(|ruleset| ruleset.create())
        .map_err(|error| failed(&error))?;
    for folder in folders {
        let place = PathFd::new(folder).map_err(|error| failed(&error))?;
        rules = rules
            .add_rule(PathBeneath::new(place, all))
            .map_err(|error| failed(&error))?;
    }
    for folder in SYSTEM {
        if let Ok(place) = PathFd::new(folder) {
            rules = rules
                .add_rule(PathBeneath::new(place, read))
                .map_err(|error| failed(&error))?;
        }
    }
    rules.restrict_self().map_err(|error| failed(&error))?;
    Ok(())
}

/// No Landlock: the thread is as any other.
#[cfg(not(target_os = "linux"))]
fn keep(_: &[PathBuf]) -> io::Result<()> {
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// Whether the kernel keeps a thread to its folders here.
    fn kept_here() -> bool {
        use landlock::{ABI, Access, AccessFs, Ruleset, RulesetAttr, RulesetStatus};
        std::thread::spawn(|| {
            let made = Ruleset::default()
                .handle_access(AccessFs::from_all(ABI::V1))
                .and_then(|ruleset| ruleset.create())
                .and_then(|ruleset| ruleset.restrict_self());
            made.is_ok_and(|status| status.ruleset == RulesetStatus::FullyEnforced)
        })
        .join()
        .unwrap()
    }

    #[tokio::test]
    async fn a_walled_thread_reaches_nothing_outside_its_folders_through_a_link() {
        if !kept_here() {
            eprintln!("skipped: this kernel has no Landlock");
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(t.path()).unwrap();
        let (project, outside) = (root.join("project"), root.join("state"));
        std::fs::create_dir_all(project.join("a")).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(project.join("a/notes.md"), "mine").unwrap();
        std::fs::write(outside.join("engine.json"), "secret").unwrap();
        // A folder of the Project that is a link out of it.
        std::fs::rename(project.join("a"), project.join("was")).unwrap();
        std::os::unix::fs::symlink(&outside, project.join("a")).unwrap();
        let walls = vec![project.clone()];
        let read = |path: PathBuf| run(walls.clone(), move || std::fs::read_to_string(path));
        let refused = read(project.join("a/engine.json")).await.unwrap();
        assert_eq!(refused.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        let wrote = run(walls.clone(), {
            let path = project.join("a/new.json");
            move || std::fs::write(path, "x")
        });
        assert!(wrote.await.unwrap().is_err());
        assert!(!outside.join("new.json").exists());
        // Inside, as any other.
        let mine = read(project.join("was/notes.md")).await.unwrap();
        assert_eq!(mine.unwrap(), "mine");
        let made = run(walls, {
            let project = project.clone();
            move || {
                std::fs::write(project.join("x.tmp"), "x")?;
                std::fs::rename(project.join("x.tmp"), project.join("was/x"))
            }
        });
        made.await.unwrap().unwrap();
        // And the engine's other threads are as they were.
        assert_eq!(
            std::fs::read_to_string(outside.join("engine.json")).unwrap(),
            "secret"
        );
    }

    #[tokio::test]
    async fn what_the_trash_does_for_a_walled_thread_is_done_outside_it() {
        if !kept_here() {
            eprintln!("skipped: this kernel has no Landlock");
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(t.path()).unwrap();
        let (project, trash) = (root.join("project"), root.join("Trash"));
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&trash).unwrap();
        let wrote = run(vec![project], {
            let trash = trash.clone();
            move || {
                let walled = std::fs::write(trash.join("walled"), "x").is_err();
                let outside = outside(move || std::fs::write(trash.join("outside"), "x"));
                (walled, outside.map(|wrote| wrote.is_ok()))
            }
        });
        assert_eq!(wrote.await.unwrap(), (true, Some(true)));
        // And on a thread with no wall, right where it is called.
        let here = std::thread::current().id();
        assert_eq!(outside(|| std::thread::current().id()), Some(here));
    }
}
