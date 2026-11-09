//! The engine as a launchd job on macOS (ADR 0086, decision 1):
//! `<bundle id>.engine` (`so.banda.app.engine`, `so.banda.dev.engine`),
//! and for a state folder other than the default a short hash of it
//! after, in the Person's gui domain, `gui/<uid>`: the session at the
//! screen, with the Person's sign-ins. launchd keeps the job: it starts the
//! engine again after a crash, and not after it stopped as asked
//! (`KeepAlive`, with `SuccessfulExit` false).
//!
//! - **At login**, while "Start Banda at login" is on (`machine.toml`'s
//!   `start-at-login`, on by default), the job's plist is in
//!   `~/Library/LaunchAgents`: launchd loads it as the Person logs in, and
//!   so starts the engine. macOS lists it under Login Items then.
//! - **On demand**, while it is off, the plist is in the state folder
//!   (`engine.plist`): a client loads it from there, and the job goes as
//!   the Person logs out.
//!
//! Only the default state folder's engine starts at login: a test's or a
//! trial's job is loaded on demand. A client that finds no engine
//! answering writes the plist where the setting says, takes away the one
//! in the other place, and loads it (`launchctl bootstrap`), which starts
//! the engine; a job loaded and stopped is booted out first, so the plist
//! loaded names this client's build. The engine moves its plist itself as
//! the setting changes ([`follow_login`]). `banda stop` boots the job out.
//!
//! Another machine's window is such a client too, over ssh, while the
//! Person is logged in at the screen, locked or not (ADR 0086, plan step
//! 7c; `control.rs`): loaded from the ssh session into the Person's gui
//! domain, the job runs in the screen's session, with their sign-ins, as
//! if started there. Its plist carries nothing of the ssh session's but
//! Banda's own variables ([`job`]).
//!
//! The plist names no PATH, and launchd's is bare
//! (`/usr/bin:/bin:/usr/sbin:/sbin`): the engine asks the login shell for
//! its own as it starts, and starts itself again with it, without
//! launchd's own variables, so no program of its thinks it is the job
//! ([`begin`]). The engine's log is `engine.log`, as everywhere;
//! launchd's stderr for it, `logs/engine.stderr.log`, gets only what comes
//! before that opens, and a panic. Its `ProcessType` is Interactive, so
//! macOS does not slow it and its Harnesses as a background job, and it
//! has 15 s to stop its Harnesses on SIGTERM before launchd kills it
//! (`ExitTimeOut`).
//!
//! launchd puts no limit on starts: an engine started again after a crash
//! three times within a minute stops with exit 0, which launchd leaves
//! stopped (`run::crash_starts`), and so does one whose state folder
//! another engine holds the lock of.
//!
//! Every call to launchd goes through [`Launchd`], so tests give their own.

use super::{Manager, Service, Why};
use crate::Failure;
use crate::places::{APP_ID, Places, default_state};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tokio::sync::watch;

/// The system's own launchctl, which only root changes.
const LAUNCHCTL: &str = "/bin/launchctl";

/// The plist's name in the state folder, for an engine loaded on demand.
const ON_DEMAND: &str = "engine.plist";

/// launchd's stderr for the job, in the logs folder.
const STDERR: &str = "engine.stderr.log";

/// How long launchd gives the engine to stop its Harnesses and Terminals
/// on SIGTERM before it kills it, as the unit's `TimeoutStopSec` on Linux.
const EXIT_WITHIN: u32 = 15;

/// How long a boot-out is waited for: past [`EXIT_WITHIN`].
const GOES_WITHIN: Duration = Duration::from_secs(20);

/// launchd's own variables of a job, which no program of the engine's
/// gets: the label says to a program that it is the job.
const LAUNCHD_OWN: [&str; 2] = ["XPC_SERVICE_NAME", "XPC_FLAGS"];

/// launchd, as the engine and its clients ask it, in the Person's gui
/// domain; what [`Manager`] asks of it is by the job's label.
pub trait Launchd: Manager {
    /// Whether the Person has a gui domain here: they are logged in at
    /// the screen, locked or not.
    fn session(&self) -> bool;
    /// Loads the job of `plist` into the gui domain, which starts it.
    fn bootstrap(&self, plist: &Path) -> Result<(), String>;
    /// Whether job `label` is loaded, running or not.
    fn loaded(&self, label: &str) -> bool;
}

/// launchd, through `launchctl`, in this user's gui domain.
pub struct Launchctl;

impl Launchctl {
    /// This user's gui domain, `gui/<uid>`.
    fn domain() -> String {
        #[cfg(unix)]
        let uid = rustix::process::getuid().as_raw();
        #[cfg(not(unix))]
        let uid = 0;
        format!("gui/{uid}")
    }

    /// Job `label` in the gui domain.
    fn service(label: &str) -> String {
        format!("{}/{label}", Launchctl::domain())
    }

    /// What `launchctl arguments…` printed, or the first line it failed
    /// with, as `Bootstrap failed: 5: Input/output error`: the next tells
    /// to run it as root.
    fn ran(arguments: &[&str]) -> Result<String, String> {
        let output = Command::new(LAUNCHCTL)
            .args(arguments)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("launchctl did not start: {error}"))?;
        let said = |bytes: &[u8]| String::from_utf8_lossy(bytes).trim().to_owned();
        if output.status.success() {
            return Ok(said(&output.stdout));
        }
        let words = [said(&output.stderr), said(&output.stdout)];
        let first = (words.iter()).find_map(|words| words.lines().next().filter(|l| !l.is_empty()));
        Err(first.map_or_else(
            || format!("launchctl ended with {}", output.status),
            str::to_owned,
        ))
    }

    /// What `launchctl print` says of job `label`; none while it is not
    /// loaded.
    fn printed(label: &str) -> Option<Printed> {
        Launchctl::ran(&["print", &Launchctl::service(label)])
            .ok()
            .map(|said| printed(&said))
    }
}

impl Manager for Launchctl {
    fn runs(&self, label: &str) -> bool {
        Launchctl::printed(label).is_some_and(|printed| printed.runs())
    }

    fn main_pid(&self, label: &str) -> Option<u32> {
        Launchctl::printed(label)?.pid
    }

    fn stop(&self, label: &str) -> Result<(), String> {
        Launchctl::ran(&["bootout", &Launchctl::service(label)])?;
        let began = Instant::now();
        while self.loaded(label) && began.elapsed() < GOES_WITHIN {
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

impl Launchd for Launchctl {
    fn session(&self) -> bool {
        Launchctl::ran(&["print", &Launchctl::domain()]).is_ok()
    }

    fn bootstrap(&self, plist: &Path) -> Result<(), String> {
        let plist = plist.to_string_lossy();
        Launchctl::ran(&["bootstrap", &Launchctl::domain(), &plist]).map(drop)
    }

    fn loaded(&self, label: &str) -> bool {
        Launchctl::printed(label).is_some()
    }
}

/// What `launchctl print` says of a job, of what a client needs.
#[derive(Debug, Default, PartialEq, Eq)]
struct Printed {
    /// `running`, `not running`, `spawn scheduled`…
    state: String,
    /// Its process, while it runs one.
    pid: Option<u32>,
}

impl Printed {
    /// Whether it runs, or starts.
    fn runs(&self) -> bool {
        self.pid.is_some() || matches!(self.state.as_str(), "running" | "spawn scheduled")
    }
}

/// The job's own `state` and `pid`, as `launchctl print` says them one
/// tab in; those of what it holds are further in.
fn printed(said: &str) -> Printed {
    let mut printed = Printed::default();
    for line in said.lines() {
        let Some(line) = line
            .strip_prefix('\t')
            .filter(|line| !line.starts_with('\t'))
        else {
            continue;
        };
        match line.split_once(" = ") {
            Some(("state", state)) if printed.state.is_empty() => {
                state.clone_into(&mut printed.state)
            }
            Some(("pid", pid)) if printed.pid.is_none() => printed.pid = pid.trim().parse().ok(),
            _ => {}
        }
    }
    printed
}

/// A launchd job, while the Person is logged in at the screen.
pub(super) fn here(launchd: &dyn Launchd) -> Result<Service, Why> {
    if launchd.session() {
        Ok(Service::Job)
    } else {
        Err(Why::NoScreen)
    }
}

/// The label of the job that runs the engine of `places`.
pub fn label_of(places: &Places) -> String {
    label_name(&places.state, default_state().as_deref())
}

/// `<bundle id>.engine`, and for a state folder other than the `default`
/// a short hash of it after, as the unit's name has on Linux.
fn label_name(state: &Path, default: Option<&Path>) -> String {
    match super::apart(state, default) {
        None => format!("{APP_ID}.engine"),
        Some(short) => format!("{APP_ID}.engine.{short}"),
    }
}

/// Where the job's plist is kept: in LaunchAgents, so launchd loads it at
/// login, or in the state folder.
#[derive(Clone, Debug)]
pub struct Plists {
    /// In `~/Library/LaunchAgents`: for the default state folder's engine
    /// alone.
    at_login: Option<PathBuf>,
    on_demand: PathBuf,
}

impl Plists {
    /// The plists of `places`' engine, its job `label`.
    pub fn of(places: &Places, label: &str) -> Plists {
        let default = default_state().is_some_and(|state| state == places.state);
        let agents = dirs::home_dir().map(|home| home.join("Library/LaunchAgents"));
        Plists::in_agents(places, label, agents.filter(|_| default))
    }

    /// The plists of `places`' engine, with LaunchAgents `agents`, where
    /// it starts at login.
    fn in_agents(places: &Places, label: &str, agents: Option<PathBuf>) -> Plists {
        Plists {
            at_login: agents.map(|agents| agents.join(format!("{label}.plist"))),
            on_demand: places.state.join(ON_DEMAND),
        }
    }

    /// Where the plist is, as `at_login` says, and the other place, where
    /// none is left.
    fn places(&self, at_login: bool) -> (&Path, Option<&Path>) {
        match &self.at_login {
            Some(agents) if at_login => (agents, Some(&self.on_demand)),
            Some(agents) => (&self.on_demand, Some(agents)),
            None => (&self.on_demand, None),
        }
    }

    /// Writes the plist `text` where `at_login` says, and takes away the
    /// one in the other place; returns where it is.
    fn put(&self, text: &str, at_login: bool) -> io::Result<PathBuf> {
        let (here, other) = self.places(at_login);
        crate::places::write_private(here, text.as_bytes())?;
        if let Some(other) = other {
            gone(std::fs::remove_file(other))?;
        }
        Ok(here.to_owned())
    }

    /// Moves the plist where `at_login` says, when it is in the other
    /// place: launchd keeps the job it loaded either way, and loads it at
    /// the next login only from LaunchAgents.
    pub fn settle(&self, at_login: bool) -> io::Result<()> {
        let (here, Some(other)) = self.places(at_login) else {
            return Ok(());
        };
        if !other.exists() {
            return Ok(());
        }
        if here.exists() {
            return gone(std::fs::remove_file(other));
        }
        if let Some(folder) = here.parent() {
            std::fs::create_dir_all(folder)?;
        }
        if banda_kernel::host::rename(other, here).is_err() {
            std::fs::copy(other, here)?;
            gone(std::fs::remove_file(other))?;
        }
        Ok(())
    }
}

/// `removed`, where a file that was not there is gone too.
fn gone(removed: io::Result<()>) -> io::Result<()> {
    match removed {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// The job that runs a program as the engine of `places`, as a client
/// starts it.
pub struct Job {
    pub label: String,
    /// The plist's text.
    plist: String,
    plists: Plists,
    /// Whether it starts at login: "Start Banda at login" is on, and it
    /// is the default state folder's engine.
    pub at_login: bool,
    /// launchd's stderr for it.
    stderr: PathBuf,
    /// Where its engine counts its starts after a crash
    /// (`run::crash_starts`).
    crash_starts: PathBuf,
}

impl Job {
    /// Writes its plist where it belongs, and makes the logs folder its
    /// stderr goes in, which launchd would make with a mode of its own;
    /// returns where the plist is.
    fn put(&self) -> io::Result<PathBuf> {
        if let Some(logs) = self.stderr.parent() {
            std::fs::create_dir_all(logs)?;
        }
        self.plists.put(&self.plist, self.at_login)
    }
}

/// The job that runs `program serve` as the engine of `places`, with
/// Banda's own variables of this program's environment.
pub fn job(places: &Places, program: &Path) -> Job {
    let label = label_of(places);
    let plists = Plists::of(places, &label);
    let at_login = plists.at_login.is_some() && banda_machines::starts_at_login(&places.config);
    let starter: Vec<(String, String)> = std::env::vars().collect();
    let stderr = places.logs().join(STDERR);
    Job {
        plist: plist(&label, program, &variables(&starter, places), &stderr),
        label,
        plists,
        at_login,
        stderr,
        crash_starts: crate::run::crash_starts_file(places),
    }
}

/// What the job gets of its `starter`'s variables, a window's here or an
/// ssh session's: Banda's own ([`super::own`]), and its places only where
/// the starter set them. A Mac's places never follow the XDG folders, so
/// those a starter's shell sets, as an ssh session's may, move none.
fn variables(starter: &[(String, String)], places: &Places) -> Vec<(String, String)> {
    let xdg: Vec<(String, String)> = (starter.iter())
        .filter(|(name, _)| name.starts_with("XDG_"))
        .cloned()
        .collect();
    super::own(starter, places, &xdg)
}

/// The job's plist: launchd runs `program serve` with `env`, keeps it
/// alive but for a clean exit, and writes its stderr to `stderr`.
///
/// - `RunAtLoad`: loading it starts it, at login or as a client loads it.
/// - `KeepAlive`: it starts again unless it exited 0, so after a crash or
///   a kill, and not after it stopped as asked.
/// - `ProcessType` Interactive: neither it nor its Harnesses are slowed as
///   a background job's.
/// - `LimitLoadToSessionType` Aqua: it runs only in the session at the
///   screen, one loaded from an ssh session too, never in that session.
/// - `AssociatedBundleIdentifiers`: Login Items may name it by the app,
///   where macOS lets it.
///
/// `ProgramArguments` names the program itself, never a shell that runs
/// it: launchd tells its own process the job's label (`XPC_SERVICE_NAME`),
/// which a shell would not pass on, and [`begin`] knows the job by it.
fn plist(label: &str, program: &Path, env: &[(String, String)], stderr: &Path) -> String {
    let program = escaped(&program.to_string_lossy());
    let stderr = escaped(&stderr.to_string_lossy());
    let label = escaped(label);
    let variables: String = (env.iter())
        .map(|(name, value)| {
            let (name, value) = (escaped(name), escaped(value));
            format!("\t\t<key>{name}</key>\n\t\t<string>{value}</string>\n")
        })
        .collect();
    let environment = if variables.is_empty() {
        String::new()
    } else {
        format!("\t<key>EnvironmentVariables</key>\n\t<dict>\n{variables}\t</dict>\n")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{program}</string>
		<string>serve</string>
	</array>
{environment}	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>ExitTimeOut</key>
	<integer>{EXIT_WITHIN}</integer>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<key>StandardErrorPath</key>
	<string>{stderr}</string>
	<key>AssociatedBundleIdentifiers</key>
	<string>{APP_ID}</string>
</dict>
</plist>
"#
    )
}

/// `text` as XML holds it.
fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Writes `job`'s plist, loads it and waits for its engine to answer
/// (`answers`), as [`super::start`] does a unit's. A job loaded with no
/// process, as one whose engine stopped itself, or one launchd only means
/// to start, as again and again where its program has gone, is booted out
/// first, so the job is the plist's just written; one that runs, which
/// another client just started, is waited for.
pub async fn start<T, F>(
    launchd: &dyn Launchd,
    job: &Job,
    answers: impl FnMut() -> F,
) -> Result<T, Failure>
where
    F: Future<Output = Result<T, Failure>>,
{
    let plist = job.put().map_err(|error| {
        Failure::Broken(format!(
            "Banda's engine's launchd job was not written: {error}"
        ))
    })?;
    if launchd.main_pid(&job.label).is_none() {
        if launchd.loaded(&job.label) {
            let _ = launchd.stop(&job.label);
        }
        // Loaded anew, it has its starts after a crash again, as a new
        // unit has on Linux: one that stopped trying starts as asked.
        if let Err(error) = gone(std::fs::remove_file(&job.crash_starts)) {
            tracing::warn!(%error, "the engine's starts after a crash were not forgotten");
        }
        if let Err(said) = launchd.bootstrap(&plist)
            && !launchd.runs(&job.label)
        {
            // Only a plist in LaunchAgents is a login item.
            let hint = if job.at_login {
                " If banda is switched off in System Settings → General → Login Items & \
                 Extensions, switch it on."
            } else {
                ""
            };
            return Err(Failure::Broken(format!(
                "launchd did not start Banda's engine ({said}).{hint}"
            )));
        }
    }
    let says = job.stderr.display().to_string();
    super::answered(launchd, &job.label, &says, answers).await
}

/// Keeps the plist of `places`' job where "Start Banda at login" says, as
/// `at_login` follows it: for the default state folder's engine, the job
/// or a window's child, so a plist left in LaunchAgents goes as the
/// setting goes off either way.
pub fn follow_login(places: &Places, mut at_login: watch::Receiver<bool>) {
    let plists = Plists::of(places, &label_of(places));
    if plists.at_login.is_none() {
        return;
    }
    tokio::spawn(async move {
        loop {
            let on = *at_login.borrow_and_update();
            match plists.settle(on) {
                Ok(()) => tracing::debug!(at_login = on, "the engine's launchd job is in place"),
                Err(error) => {
                    tracing::warn!(%error, at_login = on, "the engine's launchd plist was not moved");
                }
            }
            if at_login.changed().await.is_err() {
                return;
            }
        }
    });
}

/// Whether this `banda serve` is the engine's launchd job, launchd its
/// parent: launchd named it by the label of `places`' job
/// (`XPC_SERVICE_NAME`), or it started itself again as the job
/// (`again`, `serve --job`). Started by launchd, it first starts itself
/// again, once, with the login shell's PATH before launchd's and without
/// launchd's own variables, so that comes back only where that failed.
pub fn begin(again: bool) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let named = std::env::var("XPC_SERVICE_NAME").ok();
    let label = || Places::from_env().ok().map(|places| label_of(&places));
    match begun(by_launchd(), again, named.as_deref(), label) {
        Begun::Not => false,
        Begun::Job => true,
        Begun::Again => {
            let error = start_again();
            eprintln!(
                "banda: the engine did not start again with the login shell's PATH, and has \
                 launchd's: {error}"
            );
            true
        }
    }
}

/// What a `banda serve` is, as [`begin`] tells it.
#[derive(Debug, PartialEq, Eq)]
enum Begun {
    /// Not the engine's launchd job.
    Not,
    /// The job, started again by itself.
    Job,
    /// The job as launchd started it, which starts itself again.
    Again,
}

/// What a `banda serve` is: the job only with launchd its parent
/// (`by_launchd`), and either started again by itself (`again`) or named
/// by launchd (`named`) with the label of this state folder's job
/// (`label`).
fn begun(
    by_launchd: bool,
    again: bool,
    named: Option<&str>,
    label: impl FnOnce() -> Option<String>,
) -> Begun {
    if !by_launchd {
        return Begun::Not;
    }
    if again {
        return Begun::Job;
    }
    match (named, label()) {
        (Some(named), Some(label)) if named == label => Begun::Again,
        _ => Begun::Not,
    }
}

/// Whether launchd started this process: it is its parent.
#[cfg(unix)]
fn by_launchd() -> bool {
    rustix::process::getppid() == Some(rustix::process::Pid::INIT)
}

#[cfg(not(unix))]
fn by_launchd() -> bool {
    false
}

/// Starts this program again in its place, with `--job` and the
/// environment [`settled`] says; returns only why it did not.
fn start_again() -> io::Error {
    let own: Vec<(String, String)> = std::env::vars().collect();
    let launchd_path = super::given(&own, "PATH").unwrap_or_default();
    let login = super::login_path_now(&super::shell(), &own, &launchd_path);
    let (unset, path) = settled(&own, login.as_deref());
    let program = match std::env::current_exe() {
        Ok(program) => program,
        Err(error) => return error,
    };
    let mut again = Command::new(program);
    again.args(std::env::args_os().skip(1)).arg("--job");
    for name in unset {
        again.env_remove(name);
    }
    again.env("PATH", path);
    in_place(again)
}

/// Runs `command` in this process's place; returns only why it did not.
#[cfg(unix)]
fn in_place(mut command: Command) -> io::Error {
    std::os::unix::process::CommandExt::exec(&mut command)
}

#[cfg(not(unix))]
fn in_place(_: Command) -> io::Error {
    io::Error::other("only on macOS")
}

/// What the job takes away of its environment `own`, launchd's own
/// variables, and the PATH it runs with: the login shell's (`login`),
/// then launchd's.
fn settled<'a>(own: &'a [(String, String)], login: Option<&str>) -> (Vec<&'a str>, String) {
    let unset = (own.iter())
        .map(|(name, _)| name.as_str())
        .filter(|name| LAUNCHD_OWN.contains(name))
        .collect();
    let launchd_path = super::given(own, "PATH").unwrap_or_default();
    (
        unset,
        super::merged(login.unwrap_or_default(), &launchd_path),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Refusal;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// What a loaded job does, as launchd says it.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Is {
        Stopped,
        /// To start, with no process yet: `spawn scheduled`.
        Scheduled,
        Running,
    }

    /// launchd as told, keeping what it was asked: each job is loaded or
    /// not, and what it does.
    #[derive(Default)]
    struct Fake {
        /// Whether the Person is logged in at the screen.
        session: bool,
        /// Whether bootstrap refuses, saying this.
        refuses: Option<String>,
        /// Whether a job that starts stops at once.
        dies: bool,
        /// The jobs loaded, by label.
        jobs: Mutex<HashMap<String, Is>>,
        asked: Mutex<Vec<String>>,
    }

    impl Fake {
        fn asked(&self) -> Vec<String> {
            self.asked.lock().unwrap().clone()
        }
        fn with(self, label: &str, is: Is) -> Fake {
            self.jobs.lock().unwrap().insert(label.to_owned(), is);
            self
        }
        fn is(&self, label: &str) -> Option<Is> {
            self.jobs.lock().unwrap().get(label).copied()
        }
    }

    impl Manager for Fake {
        fn runs(&self, label: &str) -> bool {
            matches!(self.is(label), Some(Is::Scheduled | Is::Running))
        }
        fn main_pid(&self, label: &str) -> Option<u32> {
            (self.is(label) == Some(Is::Running)).then_some(4242)
        }
        fn stop(&self, label: &str) -> Result<(), String> {
            self.asked.lock().unwrap().push(format!("bootout {label}"));
            self.jobs.lock().unwrap().remove(label);
            Ok(())
        }
    }

    impl Launchd for Fake {
        fn session(&self) -> bool {
            self.session
        }
        fn bootstrap(&self, plist: &Path) -> Result<(), String> {
            self.asked
                .lock()
                .unwrap()
                .push(format!("bootstrap {}", plist.display()));
            if let Some(said) = &self.refuses {
                return Err(said.clone());
            }
            let text = std::fs::read_to_string(plist).map_err(|error| error.to_string())?;
            let label = text
                .split("<string>")
                .nth(1)
                .unwrap()
                .split('<')
                .next()
                .unwrap();
            let is = if self.dies { Is::Stopped } else { Is::Running };
            self.jobs.lock().unwrap().insert(label.to_owned(), is);
            Ok(())
        }
        fn loaded(&self, label: &str) -> bool {
            self.jobs.lock().unwrap().contains_key(label)
        }
    }

    /// A job of a test's own places, its LaunchAgents in `base` too, with
    /// "Start Banda at login" `at_login`.
    fn job_in(base: &Path, at_login: bool) -> Job {
        let places = Places::under(base);
        let label = format!("{APP_ID}.engine");
        let program =
            Path::new("/Users/person/Library/Application Support/banda/engine/0.3.0/banda");
        let stderr = places.logs().join(STDERR);
        Job {
            plist: plist(&label, program, &[], &stderr),
            plists: Plists::in_agents(&places, &label, Some(base.join("LaunchAgents"))),
            label,
            at_login,
            stderr,
            crash_starts: crate::run::crash_starts_file(&places),
        }
    }

    #[test]
    fn the_job_is_named_by_the_app_and_another_state_s_hash() {
        let default = Path::new("/Users/person/Library/Application Support/banda");
        assert_eq!(
            label_name(default, Some(default)),
            format!("{APP_ID}.engine")
        );
        let state = Path::new("/tmp/test/state");
        let named = label_name(state, Some(default));
        assert!(named.starts_with(&format!("{APP_ID}.engine.")), "{named}");
        assert_eq!(named.len(), format!("{APP_ID}.engine.").len() + 8);
        assert_eq!(named, label_name(state, None), "the same each time");
        assert_ne!(named, label_name(Path::new("/tmp/other/state"), None));
        // The same hash as the unit's on Linux.
        let unit = super::super::unit_name(state, Some(default));
        assert!(unit.ends_with(named.rsplit('.').next().unwrap()), "{unit}");
    }

    #[test]
    fn the_plist_keeps_the_engine_alive_in_the_screen_s_session_and_names_no_path() {
        let env = vec![
            ("BANDA_LOG".to_owned(), "debug".to_owned()),
            (
                "BANDA_NODE".to_owned(),
                "/Applications/Banda & Co.app/x".to_owned(),
            ),
        ];
        let program =
            Path::new("/Users/person/Library/Application Support/banda/engine/0.3.0/banda");
        let stderr =
            Path::new("/Users/person/Library/Application Support/banda/logs/engine.stderr.log");
        let text = plist("so.banda.app.engine", program, &env, stderr);
        for part in [
            "<key>Label</key>\n\t<string>so.banda.app.engine</string>",
            "<array>\n\t\t<string>/Users/person/Library/Application Support/banda/engine/0.3.0/banda</string>\n\t\t<string>serve</string>\n\t</array>",
            "<key>BANDA_LOG</key>\n\t\t<string>debug</string>",
            "<string>/Applications/Banda &amp; Co.app/x</string>",
            "<key>RunAtLoad</key>\n\t<true/>",
            "<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>",
            "<key>ProcessType</key>\n\t<string>Interactive</string>",
            "<key>ExitTimeOut</key>\n\t<integer>15</integer>",
            "<key>LimitLoadToSessionType</key>\n\t<string>Aqua</string>",
            "<key>StandardErrorPath</key>\n\t<string>/Users/person/Library/Application Support/banda/logs/engine.stderr.log</string>",
        ] {
            assert!(text.contains(part), "{part}\nin\n{text}");
        }
        assert!(
            !text.contains("PATH"),
            "launchd's PATH, then the login shell's"
        );
        assert!(text.starts_with("<?xml"));
        assert!(text.ends_with("</plist>\n"));
        // With nothing of Banda's to carry, no empty dict.
        let bare = plist("so.banda.app.engine", program, &[], stderr);
        assert!(!bare.contains("EnvironmentVariables"));
    }

    #[test]
    fn a_job_loaded_over_ssh_carries_nothing_of_the_ssh_session_s() {
        let starter: Vec<(String, String)> = [
            ("SSH_CONNECTION", "100.64.0.1 50000 100.79.149.28 22"),
            ("SSH_CLIENT", "100.64.0.1 50000 22"),
            ("SSH_AUTH_SOCK", "/tmp/ssh-x/agent.1"),
            ("SSH_TTY", "/dev/ttys004"),
            ("TERM", "xterm-256color"),
            ("LANG", "en_US.UTF-8"),
            ("LC_ALL", "C"),
            ("PATH", "/usr/bin:/bin"),
            ("HOME", "/Users/person"),
            ("USER", "person"),
            ("SHELL", "/bin/zsh"),
            ("XDG_RUNTIME_DIR", "/run/user/501"),
            ("XDG_CONFIG_HOME", "/Users/person/.config"),
            ("XDG_DATA_HOME", "/Users/person/.local/share"),
            ("BANDA_OVER_SSH", "1"),
            ("BANDA_LOG", "debug"),
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .into();
        let places = Places::under(Path::new("/Users/person/Library/Application Support"));
        let env = variables(&starter, &places);
        assert_eq!(env, [("BANDA_LOG".to_owned(), "debug".to_owned())]);
        let program =
            Path::new("/Users/person/Library/Application Support/banda/engine/0.3.0/banda");
        let text = plist("so.banda.app.engine", program, &env, Path::new("/x.log"));
        for never in [
            "SSH_",
            "TERM",
            "LANG",
            "LC_ALL",
            "PATH",
            "HOME",
            "USER",
            "SHELL",
            "XDG_",
            "OVER_SSH",
            "BANDA_CONFIG",
            "BANDA_DATA",
        ] {
            assert!(!text.contains(never), "{never} in\n{text}");
        }
        // A place the starter set is carried, as it resolved it.
        let mut moved = starter.clone();
        moved.push(("BANDA_STATE".into(), "/elsewhere".into()));
        let env = variables(&moved, &places);
        assert!(env.iter().any(|(name, _)| name == "BANDA_STATE"), "{env:?}");
    }

    #[test]
    fn the_job_says_its_state_and_process_as_launchctl_prints_them() {
        let running = "gui/501/so.banda.dev.engine = {\n\tactive count = 1\n\tstate = running\n\n\tprogram = /x/banda\n\tpid = 4242\n\tendpoints = {\n\t\tstate = active\n\t\tpid = 1\n\t}\n}\n";
        assert_eq!(
            printed(running),
            Printed {
                state: "running".into(),
                pid: Some(4242)
            }
        );
        assert!(printed(running).runs());
        let stopped =
            "gui/501/so.banda.dev.engine = {\n\tstate = not running\n\tlast exit code = 0\n}\n";
        assert!(!printed(stopped).runs());
        assert_eq!(printed(stopped).pid, None);
        assert!(printed("\tstate = spawn scheduled\n").runs());
        assert!(!printed("").runs());
    }

    #[test]
    fn a_job_runs_only_while_the_person_is_logged_in_at_the_screen() {
        let at_screen = Fake {
            session: true,
            ..Fake::default()
        };
        assert_eq!(here(&at_screen), Ok(Service::Job));
        assert_eq!(here(&Fake::default()), Err(Why::NoScreen));
    }

    #[tokio::test]
    async fn a_client_loads_the_job_and_waits_for_its_engine() {
        let base = tempfile::tempdir().unwrap();
        let job = job_in(base.path(), false);
        let launchd = Fake::default();
        let mut asked = 0;
        let answers = || {
            asked += 1;
            let up = launchd.runs(&job.label) && asked > 3;
            async move {
                if up {
                    Ok(4100)
                } else {
                    Err(Failure::broken("no answer yet"))
                }
            }
        };
        assert_eq!(start(&launchd, &job, answers).await.ok(), Some(4100));
        let on_demand = base.path().join("state").join(ON_DEMAND);
        assert_eq!(
            launchd.asked(),
            [format!("bootstrap {}", on_demand.display())]
        );
        assert!(on_demand.exists());
        assert!(
            base.path().join("state/logs").is_dir(),
            "where launchd writes stderr"
        );
    }

    #[tokio::test]
    async fn start_at_login_keeps_the_plist_in_launch_agents_and_off_in_the_state() {
        let base = tempfile::tempdir().unwrap();
        let launchd = Fake::default();
        let at_login = job_in(base.path(), true);
        let agents = base
            .path()
            .join(format!("LaunchAgents/{}.plist", at_login.label));
        let on_demand = base.path().join("state").join(ON_DEMAND);
        assert!(
            start(&launchd, &at_login, || async { Ok(()) })
                .await
                .is_ok()
        );
        assert!(agents.exists());
        assert!(!on_demand.exists());
        launchd.stop(&at_login.label).unwrap();

        let off = job_in(base.path(), false);
        assert!(start(&launchd, &off, || async { Ok(()) }).await.is_ok());
        assert!(!agents.exists(), "no start at login");
        assert!(on_demand.exists());

        // The engine moves it as the setting changes.
        off.plists.settle(true).unwrap();
        assert!(agents.exists());
        assert!(!on_demand.exists());
        off.plists.settle(true).unwrap();
        assert!(agents.exists(), "in place already");
        off.plists.settle(false).unwrap();
        assert!(!agents.exists());
        assert!(on_demand.exists());
        // A test's or a trial's state never starts at login.
        let places = Places::under(base.path());
        let apart = Plists::in_agents(&places, &off.label, None);
        apart.settle(true).unwrap();
        assert!(on_demand.exists());
        assert!(!agents.exists());
    }

    #[tokio::test]
    async fn a_job_loaded_and_stopped_is_loaded_again_and_one_that_runs_is_waited_for() {
        let base = tempfile::tempdir().unwrap();
        let job = job_in(base.path(), false);
        // As an engine that stopped trying after crashes left it.
        let places = Places::under(base.path());
        let crashed = |now| crate::run::crash_starts(&places, now);
        (0..3).for_each(|at| _ = crashed(at));
        // And as one whose program has gone leaves it: launchd means to
        // start it, and never does.
        for is in [Is::Stopped, Is::Scheduled] {
            let loaded = Fake::default().with(&job.label, is);
            assert!(start(&loaded, &job, || async { Ok(()) }).await.is_ok());
            let asked = loaded.asked();
            assert_eq!(asked.len(), 2, "{is:?}: {asked:?}");
            assert_eq!(asked[0], format!("bootout {}", job.label));
            assert!(asked[1].starts_with("bootstrap "), "{asked:?}");
            assert_eq!(loaded.is(&job.label), Some(Is::Running));
        }
        assert_eq!(crashed(10), 1, "loaded anew, it has its starts again");

        let runs = Fake::default().with(&job.label, Is::Running);
        assert!(start(&runs, &job, || async { Ok(()) }).await.is_ok());
        assert_eq!(runs.asked(), Vec::<String>::new(), "nothing loaded again");
        assert_eq!(crashed(20), 2, "the one that runs keeps its count");
    }

    #[tokio::test]
    async fn a_job_launchd_refuses_or_that_stops_at_once_is_said() {
        let base = tempfile::tempdir().unwrap();
        let job = job_in(base.path(), false);
        let none = || async { Err::<(), _>(Failure::broken("no answer")) };
        let refused = Fake {
            refuses: Some("Bootstrap failed: 5: Input/output error".into()),
            ..Fake::default()
        };
        let said = start(&refused, &job, none).await.err().unwrap().words();
        assert!(said.contains("Input/output error"), "{said}");
        assert!(!said.contains("Login Items"), "loaded on demand: {said}");
        let at_login = job_in(base.path(), true);
        let said = start(&refused, &at_login, none)
            .await
            .err()
            .unwrap()
            .words();
        assert!(said.contains("Login Items"), "{said}");

        let dies = Fake {
            dies: true,
            ..Fake::default()
        };
        let said = start(&dies, &job, none).await.err().unwrap().words();
        assert!(said.contains("stopped as it started"), "{said}");
        assert!(said.contains(STDERR), "{said}");

        let other = Fake::default().with(&job.label, Is::Running);
        let refusal = start(&other, &job, || async {
            Err::<(), _>(Failure::Refused(Refusal::forbidden("another protocol")))
        })
        .await;
        assert!(matches!(refusal, Err(Failure::Refused(_))));
    }

    #[test]
    fn the_job_starts_again_without_launchd_s_variables_and_with_the_login_shell_s_path() {
        let own: Vec<(String, String)> = [
            ("XPC_SERVICE_NAME", "so.banda.dev.engine"),
            ("XPC_FLAGS", "0x0"),
            ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
            ("HOME", "/Users/person"),
            ("BANDA_LOG", "debug"),
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .into();
        let (unset, path) = settled(&own, Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(unset, ["XPC_SERVICE_NAME", "XPC_FLAGS"]);
        assert_eq!(path, "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
        let (_, bare) = settled(&own, None);
        assert_eq!(
            bare, "/usr/bin:/bin:/usr/sbin:/sbin",
            "launchd's, when the shell says none"
        );
    }

    #[test]
    fn only_launchd_s_own_job_is_the_job() {
        let label = || Some("so.banda.dev.engine".to_owned());
        let named = Some("so.banda.dev.engine");
        assert_eq!(begun(true, false, named, label), Begun::Again);
        assert_eq!(begun(true, true, None, label), Begun::Job, "started again");
        // Another job of launchd's, as a shell it ran says `0`.
        assert_eq!(begun(true, false, Some("0"), label), Begun::Not);
        assert_eq!(begun(true, false, None, label), Begun::Not);
        assert_eq!(begun(true, false, named, || None), Begun::Not);
        // A child of anything else, whatever it says.
        assert_eq!(begun(false, true, named, label), Begun::Not);
        assert_eq!(begun(false, false, named, label), Begun::Not);
        // A test is no child of launchd's.
        assert!(!begin(true));
        assert!(!begin(false));
    }
}
