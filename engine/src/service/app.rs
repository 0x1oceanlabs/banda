//! A Mac's engine opens its app, Banda.app, when it has none (ADR 0086,
//! decision 4): started from another machine, at login or by a command,
//! or left running after the app crashed, the engine's launchd job opens
//! it hidden, by its path (`open -g -j <app> --args --hidden`), so the
//! menu bar icon and the calls are there. Opened so, the app shows no
//! window and no Dock icon, only its icon in the menu bar
//! (`client/desktop/src/main.ts`).
//!
//! The engine knows its app by its own program: one in the app's
//! resources (`<app>.app/Contents/Resources/banda`), or the window's copy
//! of it (`engine/<version>/banda`), which names the app's own program
//! beside it (`electron`, `<app>.app/Contents/MacOS/<folder>`). A
//! checkout's program, Banda Local's, or one in no app has none, and opens
//! nothing; nor does an engine of a state folder other than the default, a
//! test's or a trial's, as the app it would open is the default's.
//!
//! The app runs while it holds its lock: Electron's `SingletonLock` in the
//! window's profile (`<state>/window`), a link that names the app's
//! process. The app takes it as it starts, before it starts the engine,
//! and takes it away as it quits, as the Person quits it or logs out; a
//! crash, or a kill, as a Force Quit is, leaves it naming a process that
//! is gone. A crash also leaves a dump where Electron's crash reporter
//! keeps them (`<state>/problems/crashes`); a kill leaves none. So the
//! engine opens its app:
//!
//! - when its lock names a process that is gone, and a dump newer than
//!   the lock says it crashed;
//! - when no app holds it and none has run in this engine's run: the
//!   engine started with no app.
//!
//! It never opens one that holds its lock, so `open` never reaches an app
//! that runs, and never one the Person quit, or ended with Force Quit: a
//! Force Quit is a quit (Roma, 2026-11-10, #1038). Quit Banda stops the
//! engine, which opens nothing as it stops. It opens only on two looks in
//! a row, a few seconds apart, so an app that starts meanwhile takes its
//! lock first. After three opens with no app that ran for five minutes
//! between them, it opens none for the rest of its run, so an app that
//! crashes as it starts is not opened again and again. An `open` that
//! fails opened nothing: it is tried again, later each time.
//!
//! Every look and every open goes through [`Desktop`], so tests give their
//! own.

use crate::places::{FOLDER, Places, default_state};
use banda_harnesses::carried::ELECTRON;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

/// The system's own `open`, which only root changes.
const OPEN: &str = "/usr/bin/open";

/// What the app is told as the engine opens it: a launch of its own shows
/// no window (`client/desktop/src/main.ts`).
const HIDDEN: &str = "--hidden";

/// Electron's lock in the window's profile, a link to `<host>-<pid>`.
const LOCK: &str = "SingletonLock";

/// How long between two looks at the app.
const EVERY: Duration = Duration::from_secs(5);

/// How long an app opened has to take its lock before the next look.
const TAKES_LOCK: Duration = Duration::from_secs(30);

/// The most opens with no app that ran for [`SETTLES`] between them.
const MOST: u32 = 3;
/// How long an app runs before the opens that came before are forgotten.
const SETTLES: Duration = Duration::from_secs(5 * 60);

/// The longest wait after an `open` that failed.
const WAITS_AT_MOST: Duration = Duration::from_secs(10 * 60);

/// The app, as its lock says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seen {
    /// It holds its lock: it runs.
    Runs,
    /// Its lock names a process that is gone, which left a crash dump: it
    /// crashed.
    Crashed,
    /// No lock, or one naming a process that is gone with no dump: it
    /// quit, was ended with Force Quit, or has not run.
    Quit,
}

/// The Mac, as the engine looks at its app and opens it.
pub trait Desktop: Send + Sync {
    /// The app, as its lock says now.
    fn app(&self) -> Seen;
    /// Opens the app at `app`, hidden, with no window.
    fn open(&self, app: &Path) -> Result<(), String>;
}

/// The Mac's own: the lock in the window's profile, the crash dumps, and
/// `open`.
pub struct Mac {
    lock: PathBuf,
    crashes: PathBuf,
}

impl Mac {
    /// The Mac of the engine of `places`, whose window keeps its profile
    /// and its crash dumps in its state folder
    /// (`client/desktop/src/main.ts`, `problems.ts`).
    pub fn of(places: &Places) -> Mac {
        Mac {
            lock: places.state.join("window").join(LOCK),
            crashes: places.problems().join("crashes"),
        }
    }

    /// Whether the app left a crash dump since it took its lock.
    fn dumped(&self) -> bool {
        let taken = std::fs::symlink_metadata(&self.lock).and_then(|lock| lock.modified());
        taken.is_ok_and(|taken| dump_since(&self.crashes, taken, 1))
    }
}

impl Desktop for Mac {
    fn app(&self) -> Seen {
        seen(
            std::fs::read_link(&self.lock),
            crate::control::alive,
            || self.dumped(),
        )
    }

    fn open(&self, app: &Path) -> Result<(), String> {
        let output = opening(app)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("open did not start: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if said.is_empty() {
            format!("open ended with {}", output.status)
        } else {
            said
        })
    }
}

/// `open` for the app at `app`: in the background (`-g`), hidden (`-j`),
/// told it was opened so (`--args --hidden`), which only an app that
/// starts hears.
fn opening(app: &Path) -> Command {
    let mut open = Command::new(OPEN);
    open.args(["-g", "-j"]).arg(app).args(["--args", HIDDEN]);
    open
}

/// The app, as its lock, a link to `<host>-<pid>`, names it (`link`),
/// with `alive` saying whether a process runs, and `dumped` whether the
/// app left a crash dump since it took the lock. No lock is no app; a lock
/// it cannot read is taken as held, so the engine never opens over it.
fn seen(
    link: io::Result<PathBuf>,
    alive: impl Fn(u32) -> bool,
    dumped: impl FnOnce() -> bool,
) -> Seen {
    let link = match link {
        Ok(link) => link,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Seen::Quit,
        Err(_) => return Seen::Runs,
    };
    let pid = (link.to_str())
        .and_then(|link| link.rsplit_once('-'))
        .and_then(|(_, pid)| pid.parse().ok());
    match pid {
        Some(pid) if !alive(pid) => {
            if dumped() {
                Seen::Crashed
            } else {
                Seen::Quit
            }
        }
        _ => Seen::Runs,
    }
}

/// Whether `folder`, or a folder in it down to `depth`, has a crash dump
/// (`.dmp`) written at `since` or later: Electron's crash reporter keeps
/// them in `new`, `pending` or `completed`.
fn dump_since(folder: &Path, since: SystemTime, depth: usize) -> bool {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let Ok(about) = entry.metadata() else {
            return false;
        };
        let path = entry.path();
        if about.is_dir() {
            return depth > 0 && dump_since(&path, since, depth - 1);
        }
        path.extension().is_some_and(|extension| extension == "dmp")
            && about.modified().is_ok_and(|at| at >= since)
    })
}

/// The app the engine of `places` keeps open: on macOS, for its launchd
/// `job` of the default state folder, the app of its `program`, when it
/// has one.
pub fn to_keep(places: &Places, program: &Path, job: bool) -> Option<PathBuf> {
    let default = default_state().is_some_and(|state| state == places.state);
    if !(cfg!(target_os = "macos") && job && default) {
        return None;
    }
    of(program)
}

/// The app of the engine's `program`, when there is one: the app it is in
/// the resources of, or the one whose program the file beside it names, as
/// the window's copy has (`electron`), of this Banda's own (`FOLDER`).
fn of(program: &Path) -> Option<PathBuf> {
    let program = dunce::canonicalize(program).unwrap_or_else(|_| program.to_owned());
    let resources = program.parent()?;
    let app = if resources.file_name()? == "Resources" {
        resources.parent()?.parent()?.to_owned()
    } else {
        let named = std::fs::read_to_string(resources.join(ELECTRON)).ok()?;
        let named = Path::new(named.trim());
        if !named.is_absolute() || named.file_name()? != FOLDER {
            return None;
        }
        let macos = named.parent()?;
        if macos.file_name()? != "MacOS" {
            return None;
        }
        macos.parent()?.parent()?.to_owned()
    };
    (app.extension()? == "app" && whole(&app)).then_some(app)
}

/// Whether the app at `app` has its program: one being replaced, as brew
/// does, may not for a moment.
fn whole(app: &Path) -> bool {
    app.join("Contents/MacOS").join(FOLDER).is_file()
}

/// Keeps the app at `app` open, as `desktop` sees it and opens it, until
/// the task is aborted (see the module's words).
pub async fn keep_open(desktop: impl Desktop, app: PathBuf) {
    keep(&desktop, &app, EVERY, TAKES_LOCK).await;
}

/// [`keep_open`], looking `every` while, and `after` an open.
async fn keep(desktop: &dyn Desktop, app: &Path, every: Duration, after: Duration) {
    let mut keeper = Keeper::default();
    let mut failed = 0_u32;
    loop {
        tokio::time::sleep(every).await;
        if !keeper.looked(desktop.app(), Instant::now()) {
            continue;
        }
        if !whole(app) {
            tracing::debug!(app = %app.display(), "Banda's app is not whole: the engine opens it later");
            continue;
        }
        let opened = desktop.open(app);
        match &opened {
            Ok(()) => tracing::info!(
                app = %app.display(),
                "Banda's app does not run: the engine opens it, hidden"
            ),
            Err(said) => tracing::warn!(app = %app.display(), "Banda's app did not open: {said}"),
        }
        failed = if opened.is_ok() {
            0
        } else {
            failed.saturating_add(1)
        };
        keeper.opened(opened.is_ok());
        tokio::time::sleep(waited(after, failed)).await;
    }
}

/// How long to wait `after` an open, twice as long for each of the
/// `failed` ones in a row it ends, up to [`WAITS_AT_MOST`].
fn waited(after: Duration, failed: u32) -> Duration {
    after.saturating_mul(1 << failed.min(8)).min(WAITS_AT_MOST)
}

/// What the engine knows of its app, look after look.
#[derive(Debug, Default)]
struct Keeper {
    /// What the look before saw.
    before: Option<Seen>,
    /// Whether an app ran, or was opened, in this engine's run.
    had: bool,
    /// Since when the app has held its lock, look after look.
    runs: Option<Instant>,
    /// The opens since an app last ran for [`SETTLES`].
    opens: u32,
}

impl Keeper {
    /// Whether to open the app, as a look at `now` sees it (`seen`).
    fn looked(&mut self, seen: Seen, now: Instant) -> bool {
        let again = self.before.replace(seen) == Some(seen);
        let wanted = match seen {
            Seen::Runs => {
                self.had = true;
                let since = *self.runs.get_or_insert(now);
                if now.duration_since(since) >= SETTLES {
                    self.opens = 0;
                }
                false
            }
            Seen::Crashed => true,
            Seen::Quit => !self.had,
        };
        if seen != Seen::Runs {
            self.runs = None;
        }
        wanted && again && self.opens < MOST
    }

    /// The engine asked for the app to open: what it sees next is what it
    /// asked for. An open that failed (not `done`) opened nothing, and
    /// counts for nothing.
    fn opened(&mut self, done: bool) {
        self.before = None;
        if done {
            self.opens += 1;
            self.had = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// An app in `base`, with its program and the engine in its resources.
    fn app_in(base: &Path) -> PathBuf {
        let app = base.join("Banda.app");
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::create_dir_all(app.join("Contents/Resources")).unwrap();
        std::fs::write(app.join("Contents/MacOS").join(FOLDER), "").unwrap();
        std::fs::write(app.join("Contents/Resources/banda"), "").unwrap();
        dunce::canonicalize(app).unwrap()
    }

    #[test]
    fn the_engine_knows_its_app_by_its_program_or_the_copy_s_note() {
        let base = tempfile::tempdir().unwrap();
        let app = app_in(base.path());
        assert_eq!(of(&app.join("Contents/Resources/banda")), Some(app.clone()));
        // The window's copy, which names the app's program beside it.
        let copy = base.path().join("data").join(FOLDER).join("engine/0.3.0");
        std::fs::create_dir_all(&copy).unwrap();
        std::fs::write(copy.join("banda"), "").unwrap();
        assert_eq!(of(&copy.join("banda")), None, "a copy that names none");
        let program = app.join("Contents/MacOS").join(FOLDER);
        std::fs::write(copy.join(ELECTRON), format!("{}\n", program.display())).unwrap();
        assert_eq!(of(&copy.join("banda")), Some(app.clone()));
        // Another Electron, as Banda Local's, or a relative path: none.
        let other = app.join("Contents/MacOS/Electron");
        std::fs::write(&other, "").unwrap();
        std::fs::write(copy.join(ELECTRON), other.display().to_string()).unwrap();
        assert_eq!(of(&copy.join("banda")), None);
        std::fs::write(
            copy.join(ELECTRON),
            format!("Banda.app/Contents/MacOS/{FOLDER}"),
        )
        .unwrap();
        assert_eq!(of(&copy.join("banda")), None);
        // An app moved away since, or half replaced, opens nothing.
        std::fs::write(copy.join(ELECTRON), program.display().to_string()).unwrap();
        std::fs::remove_file(&program).unwrap();
        assert_eq!(of(&copy.join("banda")), None);
        assert_eq!(of(&app.join("Contents/Resources/banda")), None);
        // A checkout's program, or one in no app.
        let checkout = base.path().join("target/debug");
        std::fs::create_dir_all(&checkout).unwrap();
        std::fs::write(checkout.join("banda"), "").unwrap();
        assert_eq!(of(&checkout.join("banda")), None);
        let resources = base.path().join("folder/Contents/Resources");
        std::fs::create_dir_all(&resources).unwrap();
        assert_eq!(of(&resources.join("banda")), None, "no .app");
    }

    #[test]
    fn only_the_default_state_s_launchd_job_on_a_mac_keeps_its_app_open() {
        let base = tempfile::tempdir().unwrap();
        let app = app_in(base.path());
        let program = app.join("Contents/Resources/banda");
        // A test's state folder is never the default.
        let places = Places::under(base.path());
        assert_eq!(to_keep(&places, &program, true), None);
        assert_eq!(to_keep(&places, &program, false), None);
        if let Some(state) = default_state() {
            let default = Places {
                state,
                ..Places::under(base.path())
            };
            let kept = to_keep(&default, &program, true);
            assert_eq!(kept.is_some(), cfg!(target_os = "macos"), "{kept:?}");
            assert_eq!(to_keep(&default, &program, false), None, "not the job");
        }
    }

    #[test]
    fn the_engine_opens_its_app_hidden_and_tells_it_so() {
        let app = Path::new("/Applications/Banda Dev.app");
        let open = opening(app);
        assert_eq!(open.get_program(), OPEN);
        let args: Vec<_> = open.get_args().collect();
        assert_eq!(
            args,
            [
                "-g",
                "-j",
                "/Applications/Banda Dev.app",
                "--args",
                "--hidden"
            ]
        );
    }

    #[test]
    fn an_app_the_person_force_quit_is_never_opened_again() {
        // Force Quit kills the app: its lock is left naming a process
        // that is gone, and no crash dump is newer than the lock. That is
        // a quit (Roma, 2026-11-10, #1038).
        let gone = |_| false;
        let force_quit = seen(Ok(PathBuf::from("m1pro.local-4242")), gone, || false);
        assert_eq!(force_quit, Seen::Quit);
        let now = Instant::now();
        let at = |seconds| now + Duration::from_secs(seconds);
        let mut keeper = Keeper::default();
        assert!(!keeper.looked(Seen::Runs, at(0)));
        assert!(!keeper.looked(Seen::Runs, at(5)));
        for look in 2..1000 {
            assert!(!keeper.looked(force_quit, at(look * 5)), "{look}");
        }
    }

    #[test]
    fn the_app_runs_while_its_lock_names_a_process_that_runs() {
        let alive = |pid| pid == 4242;
        let link = |to: &str| Ok(PathBuf::from(to));
        let failed = |kind: io::ErrorKind| Err(io::Error::from(kind));
        let dumped = || true;
        let none = || false;
        assert_eq!(
            seen(failed(io::ErrorKind::NotFound), alive, dumped),
            Seen::Quit
        );
        assert_eq!(seen(link("m1pro.local-4242"), alive, dumped), Seen::Runs);
        // Gone with a dump, it crashed; with none, it was ended.
        assert_eq!(seen(link("m1pro-4243"), alive, dumped), Seen::Crashed);
        assert_eq!(seen(link("m1pro-4243"), alive, none), Seen::Quit);
        // A lock it cannot read is held: garbled, a plain file, or one it
        // may not read.
        assert_eq!(seen(link("garbled"), alive, dumped), Seen::Runs);
        assert_eq!(seen(link("m1pro-x"), alive, dumped), Seen::Runs);
        let plain = failed(io::ErrorKind::InvalidInput);
        assert_eq!(seen(plain, alive, dumped), Seen::Runs);
        let denied = failed(io::ErrorKind::PermissionDenied);
        assert_eq!(seen(denied, alive, dumped), Seen::Runs);
    }

    #[cfg(unix)]
    #[test]
    fn the_mac_reads_the_lock_in_the_window_s_profile_and_the_crash_dumps() {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        let mac = Mac::of(&places);
        assert_eq!(mac.app(), Seen::Quit);
        let window = places.state.join("window");
        std::fs::create_dir_all(&window).unwrap();
        let own = format!("arc-{}", std::process::id());
        std::os::unix::fs::symlink(&own, window.join(LOCK)).unwrap();
        assert_eq!(mac.app(), Seen::Runs);
        std::fs::remove_file(window.join(LOCK)).unwrap();
        // No process has the largest number there is: gone, with no dump,
        // it was ended.
        std::os::unix::fs::symlink("arc-2147483646", window.join(LOCK)).unwrap();
        assert_eq!(mac.app(), Seen::Quit);
        let taken = std::fs::symlink_metadata(window.join(LOCK))
            .and_then(|lock| lock.modified())
            .unwrap();
        let completed = places.problems().join("crashes/completed");
        std::fs::create_dir_all(&completed).unwrap();
        let dump = |name: &str, at: SystemTime| {
            let file = std::fs::File::create(completed.join(name)).unwrap();
            file.set_modified(at).unwrap();
        };
        // An earlier crash's dump, or what is not a dump: still ended.
        dump("earlier.dmp", taken - Duration::from_secs(60));
        dump("settings.txt", taken + Duration::from_secs(5));
        assert_eq!(mac.app(), Seen::Quit);
        dump("this.dmp", taken + Duration::from_secs(5));
        assert_eq!(mac.app(), Seen::Crashed);
        // A lock that is a plain file is held.
        std::fs::remove_file(window.join(LOCK)).unwrap();
        std::fs::write(window.join(LOCK), "").unwrap();
        assert_eq!(mac.app(), Seen::Runs);
    }

    #[test]
    fn the_engine_opens_its_app_when_it_crashed_or_none_ran_yet() {
        let now = Instant::now();
        let at = |seconds| now + Duration::from_secs(seconds);
        // Started with none: opened on the second look.
        let mut keeper = Keeper::default();
        assert!(!keeper.looked(Seen::Quit, at(0)));
        assert!(keeper.looked(Seen::Quit, at(5)));
        keeper.opened(true);
        // It runs, then quits: never opened again.
        assert!(!keeper.looked(Seen::Quit, at(35)));
        assert!(!keeper.looked(Seen::Runs, at(40)));
        assert!(!keeper.looked(Seen::Quit, at(45)));
        assert!(!keeper.looked(Seen::Quit, at(50)));

        // Started by its app, which crashes later.
        let mut keeper = Keeper::default();
        assert!(!keeper.looked(Seen::Runs, at(0)));
        assert!(!keeper.looked(Seen::Runs, at(5)));
        assert!(!keeper.looked(Seen::Crashed, at(10)), "seen once");
        assert!(keeper.looked(Seen::Crashed, at(15)));
        keeper.opened(true);
        // Its lock still names the process that crashed, before the new
        // one takes it.
        assert!(!keeper.looked(Seen::Crashed, at(45)));
        assert!(!keeper.looked(Seen::Runs, at(50)));

        // An app that starts meanwhile takes its lock: nothing is opened.
        let mut keeper = Keeper::default();
        assert!(!keeper.looked(Seen::Crashed, at(0)));
        assert!(!keeper.looked(Seen::Runs, at(5)));
        assert!(!keeper.looked(Seen::Quit, at(10)));
        assert!(!keeper.looked(Seen::Quit, at(15)), "it ran: it quit");
    }

    #[test]
    fn an_app_that_crashes_as_it_starts_is_opened_three_times_and_no_more() {
        let now = Instant::now();
        let at = |seconds| now + Duration::from_secs(seconds);
        let mut keeper = Keeper::default();
        let mut opens = vec![];
        // Each one opened runs half a minute and crashes, for a day.
        let mut seconds = 0;
        while seconds < 24 * 60 * 60 {
            if keeper.looked(Seen::Crashed, at(seconds)) {
                keeper.opened(true);
                opens.push(seconds);
                for _ in 0..6 {
                    seconds += 5;
                    assert!(!keeper.looked(Seen::Runs, at(seconds)));
                }
            }
            seconds += 5;
        }
        assert_eq!(opens.len(), 3, "{opens:?}");

        // The Person opens it, and it runs five minutes: the opens before
        // are forgotten, and a crash then is opened again.
        let began = seconds;
        while seconds <= began + 5 * 60 {
            assert!(!keeper.looked(Seen::Runs, at(seconds)));
            seconds += 5;
        }
        assert!(!keeper.looked(Seen::Crashed, at(seconds)));
        assert!(keeper.looked(Seen::Crashed, at(seconds + 5)));
    }

    #[test]
    fn an_open_that_failed_opened_nothing_and_is_tried_again_later_each_time() {
        let now = Instant::now();
        let at = |seconds| now + Duration::from_secs(seconds);
        let mut keeper = Keeper::default();
        for round in 0..2 * u64::from(MOST) {
            assert!(!keeper.looked(Seen::Quit, at(round * 10)));
            assert!(keeper.looked(Seen::Quit, at(round * 10 + 5)), "{round}");
            keeper.opened(false);
        }
        keeper.opened(true);
        assert!(!keeper.looked(Seen::Quit, at(100)));
        assert!(!keeper.looked(Seen::Quit, at(105)), "opened at last");

        let after = Duration::from_secs(30);
        let waits: Vec<_> = (0..7)
            .map(|failed| waited(after, failed).as_secs())
            .collect();
        assert_eq!(waits, [30, 60, 120, 240, 480, 600, 600]);
    }

    /// The Mac as told: what the app's lock says, look after look, the
    /// opens asked, and how many of the first fail.
    struct Fake {
        seen: Mutex<Vec<Seen>>,
        opened: Mutex<Vec<PathBuf>>,
        fails: AtomicU32,
    }

    impl Fake {
        fn seeing(seen: &[Seen]) -> Fake {
            Fake {
                seen: Mutex::new(seen.iter().rev().copied().collect()),
                opened: Mutex::new(vec![]),
                fails: AtomicU32::new(0),
            }
        }

        fn failing(self, fails: u32) -> Fake {
            self.fails.store(fails, Ordering::SeqCst);
            self
        }
    }

    impl Desktop for Fake {
        fn app(&self) -> Seen {
            let mut seen = self.seen.lock().unwrap();
            if seen.len() > 1 {
                seen.pop().unwrap()
            } else {
                seen[0]
            }
        }
        fn open(&self, app: &Path) -> Result<(), String> {
            self.opened.lock().unwrap().push(app.to_owned());
            let fails = self.fails.load(Ordering::SeqCst);
            if fails == 0 {
                return Ok(());
            }
            self.fails.store(fails - 1, Ordering::SeqCst);
            Err("LaunchServices is not ready".into())
        }
    }

    /// The opens `desktop` was asked for in `app`, kept open for a while.
    async fn opens(desktop: &Fake, app: &Path) -> Vec<PathBuf> {
        let a_while = Duration::from_millis(300);
        let pace = Duration::from_millis(2);
        let _ = tokio::time::timeout(a_while, keep(desktop, app, pace, pace)).await;
        desktop.opened.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn the_engine_opens_its_app_by_its_path_and_never_one_that_runs() {
        let base = tempfile::tempdir().unwrap();
        let app = app_in(base.path());
        let most = MOST as usize;
        let none = Fake::seeing(&[Seen::Quit]);
        assert_eq!(opens(&none, &app).await, std::slice::from_ref(&app), "once");
        let runs = Fake::seeing(&[Seen::Runs]);
        assert_eq!(opens(&runs, &app).await, Vec::<PathBuf>::new());
        let quit = Fake::seeing(&[Seen::Runs, Seen::Runs, Seen::Quit]);
        assert_eq!(opens(&quit, &app).await, Vec::<PathBuf>::new());
        let crashed = Fake::seeing(&[Seen::Runs, Seen::Crashed]);
        assert_eq!(opens(&crashed, &app).await.len(), most, "no more");
        // An open that fails is tried again; once one opens, no more.
        let once = Fake::seeing(&[Seen::Quit]).failing(1);
        assert_eq!(opens(&once, &app).await.len(), 2, "tried again");
        let never = Fake::seeing(&[Seen::Quit]).failing(u32::MAX);
        assert!(
            opens(&never, &app).await.len() > most,
            "failed opens count toward no limit"
        );
        // One being replaced is opened once it is whole.
        std::fs::remove_file(app.join("Contents/MacOS").join(FOLDER)).unwrap();
        let none = Fake::seeing(&[Seen::Quit]);
        assert_eq!(opens(&none, &app).await, Vec::<PathBuf>::new());
    }
}
