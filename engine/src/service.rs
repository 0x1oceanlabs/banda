//! The engine as a service of the Person's session (ADR 0086, decision 1).
//!
//! On Linux it runs as a systemd user unit, `<folder>-engine`
//! (`banda-engine`, `banda-dev-engine`), which any client starts when no
//! engine answers: the window, and every command that reaches the engine.
//! It is started with `systemd-run --user`, so it has the user manager's
//! environment, never its starter's: what a starter's shell sets for
//! itself, as Claude Code's `CLAUDECODE`, reaches no Harness or Terminal
//! of the engine. What comes with it from its starter:
//!
//! - Banda's own variables, but for an Agent's pass and Project;
//! - the places its starter set, or that the starter's XDG folders move
//!   where the manager's do not, so the window and the engine find the
//!   same things;
//! - the session's display and ssh agent, where the manager lacks them;
//! - PATH from the login shell before the manager's, with what the
//!   shell's profile adds, where Harnesses are found.
//!
//! The unit goes on when one child dies for want of memory
//! (`OOMPolicy=continue`), and stops its children first: SIGTERM to the
//! engine, which stops its Harnesses and Terminals itself, and what is
//! left is killed after the timeout (`KillMode=mixed`). An engine that
//! crashes is started again, as the engine never stops by itself; one
//! that crashes again and again as it starts is not.
//!
//! Where no systemd user session answers (macOS, until its launchd agent,
//! step 7; a container; CI), or where the unit does not start, the engine
//! stays the window's child, as before, and the log says so. So does a
//! checkout's, Banda Local, which an Agent's test runs must leave nothing
//! of behind, unless `BANDA_ENGINE_AS` says `service`, as a test of the
//! service does.
//!
//! Every call to systemd goes through [`Systemd`], so tests give their own.

use crate::Failure;
use crate::places::{FOLDER, Places};
use banda_kernel::{ENGINE_VARIABLE, PROJECT_VARIABLE, TOKEN_VARIABLE};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Says how this Banda runs its engine: `service`, as the session's, or
/// `child`, the window's. Unsaid, a released Banda runs it as the
/// session's service where systemd's user manager answers, and a checkout's
/// as the window's child.
const WAY_VARIABLE: &str = "BANDA_ENGINE_AS";

/// The most a client waits for an engine whose unit runs to answer: it
/// opens its Projects first, with their migrations, and answers once it
/// is whole (ADR 0086, Changes: not 5 s).
const OPENS_WITHIN: Duration = Duration::from_secs(120);

/// How long the login shell may take to say its PATH, as the window waits
/// for it on macOS (`login.ts`).
const LOGIN_WITHIN: Duration = Duration::from_secs(10);

/// Around the PATH the login shell prints, so its profile's own output is
/// skipped.
const MARK: &str = "__banda_path__";

/// What the login shell is asked with of its starter's environment, over
/// the manager's PATH: who and where the Person is, and nothing a shell
/// set for itself.
const LOGIN_KEEPS: [&str; 5] = ["HOME", "USER", "LOGNAME", "SHELL", "LANG"];

/// The session's own variables, which a desktop that does not hand them
/// to the user manager leaves out of it: taken from the starter where the
/// manager lacks them, so Agents' shells still reach the ssh agent and the
/// display.
const SESSION: [&str; 5] = [
    "SSH_AUTH_SOCK",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_SESSION_TYPE",
];

/// The XDG variable each place's default is under, in the order of
/// [`Places::variables`]: the root is under the home folder.
const XDG_BASES: [Option<&str>; 5] = [
    None,
    Some("XDG_DATA_HOME"),
    Some("XDG_STATE_HOME"),
    Some("XDG_CONFIG_HOME"),
    Some("XDG_CACHE_HOME"),
];

/// Whether this system has a service to run the engine as: systemd's
/// user manager on Linux. macOS's, a launchd agent, comes later (ADR 0086,
/// plan step 7).
pub const SERVICE_HERE: bool = cfg!(target_os = "linux");

/// How this Banda runs its engine here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Way {
    /// As a systemd user unit, with the user manager's version.
    Service { version: u32 },
    /// As the window's child.
    Child(Why),
}

/// Why the engine is the window's child here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    /// `BANDA_ENGINE_AS=child` asks for it.
    Asked,
    /// A checkout's Banda, Banda Local: a test run leaves nothing behind.
    Checkout,
    /// No systemd user manager answers.
    NoSystemd,
    /// macOS, until its launchd agent (ADR 0086, plan step 7).
    NotYet,
}

impl Why {
    pub fn words(self) -> &'static str {
        match self {
            Why::Asked => "BANDA_ENGINE_AS asks for it",
            Why::Checkout => "Banda Local's engine always is",
            Why::NoSystemd => "no systemd user session answers here",
            Why::NotYet => "this system's service for it, a launchd agent on macOS, comes later",
        }
    }
}

/// The user's systemd, as the engine asks it.
pub trait Systemd: Sync {
    /// The user manager's version; none when no user manager answers.
    fn version(&self) -> Option<u32>;
    /// The user manager's environment, as its units get it.
    fn environment(&self) -> Vec<(String, String)>;
    /// `systemd-run` with `arguments`, which start a transient unit.
    fn run(&self, arguments: &[String]) -> Result<(), String>;
    /// Whether `unit` runs, or starts.
    fn runs(&self, unit: &str) -> bool;
    /// The process `unit` runs, when it runs one.
    fn main_pid(&self, unit: &str) -> Option<u32>;
    /// Stops `unit`, and returns once it has.
    fn stop(&self, unit: &str) -> Result<(), String>;
}

/// The systemd of this user's session, through `systemctl --user` and
/// `systemd-run --user`.
pub struct User;

impl User {
    /// What `program arguments…` printed, or the words it failed with:
    /// the system's own `program`, one only root changes, never one of
    /// its name an Agent could have put first on the PATH
    /// ([`banda_kernel::host::system`]).
    fn ran(program: &str, arguments: &[&str]) -> Result<String, String> {
        let found = banda_kernel::host::system(program)
            .ok_or_else(|| format!("there is no {program} of the system's on the PATH"))?;
        let output = Command::new(found)
            .args(arguments)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("{program} did not start: {error}"))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
        }
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }

    fn systemctl(arguments: &[&str]) -> Result<String, String> {
        let arguments: Vec<&str> = std::iter::once("--user")
            .chain(arguments.iter().copied())
            .collect();
        User::ran("systemctl", &arguments)
    }

    /// One property of `unit`'s service, as systemd says it.
    fn property(unit: &str, property: &str) -> Option<String> {
        let service = format!("{unit}.service");
        let property = format!("--property={property}");
        User::systemctl(&["show", &property, "--value", &service]).ok()
    }
}

impl Systemd for User {
    fn version(&self) -> Option<u32> {
        version_of(&User::systemctl(&["show", "--property=Version", "--value"]).ok()?)
    }

    fn environment(&self) -> Vec<(String, String)> {
        let said = User::systemctl(&["show-environment"]).unwrap_or_default();
        said.lines().filter_map(assignment).collect()
    }

    fn run(&self, arguments: &[String]) -> Result<(), String> {
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        User::ran("systemd-run", &arguments).map(drop)
    }

    fn runs(&self, unit: &str) -> bool {
        matches!(
            User::property(unit, "ActiveState").as_deref(),
            Some("active" | "activating" | "reloading")
        )
    }

    fn main_pid(&self, unit: &str) -> Option<u32> {
        let pid: u32 = User::property(unit, "MainPID")?.parse().ok()?;
        (pid != 0).then_some(pid)
    }

    fn stop(&self, unit: &str) -> Result<(), String> {
        User::systemctl(&["stop", &format!("{unit}.service")]).map(drop)
    }
}

/// The version systemd says, as `257 (257.5-1-arch)`.
fn version_of(said: &str) -> Option<u32> {
    let digits: String = said.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// One line of `systemctl show-environment`, `NAME=value`, its value
/// quoted when it holds what a shell reads, as `$'…'`.
fn assignment(line: &str) -> Option<(String, String)> {
    let (name, value) = line.split_once('=')?;
    let value = value.strip_prefix('$').unwrap_or(value);
    Some((name.to_owned(), value.trim_matches(['\'', '"']).to_owned()))
}

/// How this Banda runs its engine: as `asked` says (`BANDA_ENGINE_AS`),
/// else the window's child for a `checkout`'s, else the session's service
/// where systemd's user manager answers on Linux.
fn way(asked: Option<&str>, checkout: bool, systemd: &dyn Systemd) -> Way {
    match asked {
        Some("child") => return Way::Child(Why::Asked),
        Some("service") => {}
        _ if checkout => return Way::Child(Why::Checkout),
        _ => {}
    }
    if !SERVICE_HERE {
        return Way::Child(Why::NotYet);
    }
    match systemd.version() {
        Some(version) => Way::Service { version },
        None => Way::Child(Why::NoSystemd),
    }
}

/// [`way`], as this program's environment and build say.
pub fn way_here(systemd: &dyn Systemd) -> Way {
    let asked = std::env::var(WAY_VARIABLE).ok();
    way(asked.as_deref(), crate::places::from_checkout(), systemd)
}

/// The unit's name: `<folder>-engine`, and for a state folder other than
/// the `default`, as a test or a trial has, a short hash of it after, so
/// each engine has its own.
fn unit_name(state: &Path, default: Option<&Path>) -> String {
    use sha2::{Digest, Sha256};
    if default == Some(state) {
        return format!("{FOLDER}-engine");
    }
    let hash = Sha256::digest(state.as_os_str().as_encoded_bytes());
    let short: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("{FOLDER}-engine-{short}")
}

/// The unit the engine of `places` runs as, when it runs as the session's
/// service.
pub fn unit_of(places: &Places) -> String {
    unit_name(&places.state, crate::places::default_state().as_deref())
}

/// The unit this engine runs as, when it is that unit's own process: its
/// cgroup names an engine's unit, and the user manager says the unit runs
/// this process. A program the engine started, as a test's engine in an
/// Agent's shell, is in the same cgroup, and is not the unit's.
pub fn own_unit(systemd: &dyn Systemd) -> Option<String> {
    let cgroup = std::fs::read_to_string("/proc/self/cgroup").ok()?;
    let unit = unit_in(&cgroup)?;
    (systemd.main_pid(unit) == Some(std::process::id())).then(|| unit.to_owned())
}

/// The engine's unit a cgroup file names, as
/// `0::/user.slice/…/app.slice/banda-engine.service`.
fn unit_in(cgroup: &str) -> Option<&str> {
    let engine = format!("{FOLDER}-engine");
    cgroup.lines().find_map(|line| {
        let path = line.splitn(3, ':').nth(2)?;
        let unit = path.rsplit('/').next()?.strip_suffix(".service")?;
        let ours = unit == engine
            || (unit.strip_prefix(engine.as_str())).is_some_and(|rest| rest.starts_with('-'));
        ours.then_some(unit)
    })
}

/// The unit that runs `program serve` as the session's engine.
#[derive(Clone, Debug)]
pub struct Unit {
    pub name: String,
    program: PathBuf,
    /// Set over the user manager's environment.
    env: Vec<(String, String)>,
    /// The user manager's version, which says what the unit may ask.
    version: u32,
}

impl Unit {
    /// What `systemd-run` takes to start it.
    fn arguments(&self) -> Vec<String> {
        let mut arguments: Vec<String> = [
            "--user",
            "--quiet",
            // A unit that stopped, even failed, goes, so the next start
            // may take its name.
            "--collect",
        ]
        .map(str::to_owned)
        .into();
        arguments.push(format!("--unit={}", self.name));
        arguments.push(format!("--description=Banda's engine ({FOLDER})"));
        let mut properties = vec![
            // Started once the program runs: systemd says so when it
            // cannot (from systemd 240).
            if self.version >= 240 {
                "Type=exec"
            } else {
                "Type=simple"
            },
            // SIGTERM to the engine alone, which stops its Harnesses and
            // Terminals itself; what is left after the timeout is killed.
            "KillMode=mixed",
            "TimeoutStopSec=15",
            // The engine never stops by itself: one that crashed starts
            // again. One stopped as asked does not.
            "Restart=on-failure",
            "RestartSec=2",
        ];
        // One child killed for want of memory does not stop the rest
        // (services take it from systemd 243), and one that crashes
        // three times in a minute as it starts stops trying.
        if self.version >= 243 {
            properties.extend([
                "OOMPolicy=continue",
                "StartLimitIntervalSec=60",
                "StartLimitBurst=3",
            ]);
        }
        arguments.extend(properties.iter().map(|p| format!("--property={p}")));
        arguments.extend((self.env.iter()).map(|(name, value)| format!("--setenv={name}={value}")));
        arguments.push("--".to_owned());
        arguments.push(self.program.display().to_string());
        arguments.push("serve".to_owned());
        arguments
    }
}

/// The variables a unit gets over the user manager's (`manager`), from
/// its `starter`'s:
///
/// - those of Banda's own, but for what names an Agent's pass or Project,
///   or Electron inside an AppImage, which goes as the AppImage stops;
/// - each place as `places` resolved it, where the starter set it, or
///   where the starter's XDG folder for it is not the manager's;
/// - the [`SESSION`]'s, where the manager lacks them;
/// - PATH, the login shell's (`login`) then the manager's.
fn environment(
    starter: &[(String, String)],
    places: &Places,
    manager: &[(String, String)],
    login: Option<&str>,
) -> Vec<(String, String)> {
    let given = |among: &[(String, String)], name: &str| {
        (among.iter())
            .find(|(named, value)| named == name && !value.is_empty())
            .map(|(_, value)| value.clone())
    };
    let in_appimage = given(starter, "APPIMAGE").is_some();
    let never = [
        TOKEN_VARIABLE,
        ENGINE_VARIABLE,
        PROJECT_VARIABLE,
        "BANDA_SPACE",
        WAY_VARIABLE,
    ];
    let placed = crate::places::VARIABLES;
    let mut env: Vec<(String, String)> = (starter.iter())
        .filter(|(name, _)| name.starts_with("BANDA_"))
        .filter(|(name, _)| !never.contains(&name.as_str()) && !placed.contains(&name.as_str()))
        .filter(|(name, _)| !(in_appimage && name == banda_harnesses::carried::NODE_VARIABLE))
        .cloned()
        .collect();
    env.sort();
    for ((name, place), base) in places.variables().into_iter().zip(XDG_BASES) {
        let moved = base.is_some_and(|base| given(starter, base) != given(manager, base));
        if given(starter, name).is_some() || moved {
            env.push((name.to_owned(), place.display().to_string()));
        }
    }
    for name in SESSION {
        if let (Some(value), None) = (given(starter, name), given(manager, name)) {
            env.push((name.to_owned(), value));
        }
    }
    let manager_path = given(manager, "PATH").unwrap_or_default();
    let path = merged(login.unwrap_or_default(), &manager_path);
    if !path.is_empty() {
        env.push(("PATH".to_owned(), path));
    }
    env
}

/// `first`'s folders, then those of `then` it lacks, each once.
fn merged(first: &str, then: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let folders: Vec<&str> = (first.split(':').chain(then.split(':')))
        .filter(|folder| !folder.is_empty() && seen.insert(*folder))
        .collect();
    folders.join(":")
}

/// The PATH `shell`, as a login shell, says it has, started with only
/// [`LOGIN_KEEPS`] of `starter`'s environment and `path`, the manager's,
/// so what it says is the profile's over the session's, never over the
/// starter's; none when it fails, says nothing of it, or takes longer
/// than the window waits.
async fn login_path(shell: &Path, starter: &[(String, String)], path: &str) -> Option<String> {
    let script = format!("echo {MARK}; printenv PATH; echo {MARK}");
    let kept = (starter.iter()).filter(|(name, _)| LOGIN_KEEPS.contains(&name.as_str()));
    let asked = tokio::process::Command::new(shell)
        .args(["-ilc", &script])
        .env_clear()
        .envs(kept.cloned())
        .env("PATH", path)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(LOGIN_WITHIN, asked).await.ok()?.ok()?;
    between(&String::from_utf8_lossy(&output.stdout))
}

/// The line between the first two marks, if there is one.
fn between(said: &str) -> Option<String> {
    let lines: Vec<&str> = said.lines().map(str::trim).collect();
    let start = lines.iter().position(|line| *line == MARK)?;
    match (lines.get(start + 1), lines.get(start + 2)) {
        (Some(path), Some(&MARK)) if !path.is_empty() => Some((*path).to_owned()),
        _ => None,
    }
}

/// The Person's login shell: `SHELL`, else `/bin/sh`.
fn shell() -> PathBuf {
    std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from)
}

/// The unit that runs `program` as the engine of `places`, for a user
/// manager of version `version`.
pub async fn unit(places: &Places, program: PathBuf, version: u32, systemd: &dyn Systemd) -> Unit {
    let name = unit_of(places);
    let starter: Vec<(String, String)> = std::env::vars().collect();
    let manager = systemd.environment();
    let manager_path = (manager.iter())
        .find(|(name, _)| name == "PATH")
        .map_or("", |(_, path)| path.as_str());
    let login = login_path(&shell(), &starter, manager_path).await;
    if login.is_none() {
        tracing::warn!("the login shell did not say its PATH: the engine has the session's");
    }
    let env = environment(&starter, places, &manager, login.as_deref());
    let taken: Vec<&str> = (env.iter())
        .map(|(name, _)| name.as_str())
        .filter(|name| SESSION.contains(name))
        .collect();
    if !taken.is_empty() {
        tracing::info!(
            ?taken,
            "the user manager lacks these of the session's variables: the engine takes its starter's"
        );
    }
    Unit {
        name,
        program,
        env,
        version,
    }
}

/// Starts `unit` and waits for its engine to answer (`answers`), while the
/// unit runs and for [`OPENS_WITHIN`] at most. A unit of that name that
/// runs already, which another client just started, is waited for too.
/// An engine that answers with a refusal, as one of another protocol
/// does, is not waited for.
pub async fn start<T, F>(
    systemd: &dyn Systemd,
    unit: &Unit,
    mut answers: impl FnMut() -> F,
) -> Result<T, Failure>
where
    F: Future<Output = Result<T, Failure>>,
{
    if let Err(said) = systemd.run(&unit.arguments())
        && !systemd.runs(&unit.name)
    {
        return Err(Failure::Broken(format!(
            "Banda's engine did not start as a service: {said}"
        )));
    }
    let began = Instant::now();
    loop {
        match answers().await {
            Ok(found) => return Ok(found),
            Err(refused @ Failure::Refused(_)) => return Err(refused),
            Err(_) => {}
        }
        if !systemd.runs(&unit.name) {
            // It may have answered as it went.
            if let Ok(found) = answers().await {
                return Ok(found);
            }
            return Err(Failure::Broken(format!(
                "Banda's engine stopped as it started: its log, engine.log, says why \
                 (journalctl --user -u {}).",
                unit.name
            )));
        }
        if began.elapsed() > OPENS_WITHIN {
            return Err(Failure::Broken(format!(
                "Banda's engine did not answer within {} s of its start: banda stop stops \
                 it (journalctl --user -u {} says what it did).",
                OPENS_WITHIN.as_secs(),
                unit.name
            )));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Refusal;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// A user manager that answers as told, and keeps what it was asked.
    #[derive(Default)]
    struct Fake {
        version: Option<u32>,
        /// Whether `systemd-run` fails, saying this.
        refuses: Option<String>,
        /// Whether the unit runs, as `runs` says.
        up: AtomicBool,
        /// Whether a unit that starts stops at once.
        dies: bool,
        /// The process the unit runs.
        pid: Option<u32>,
        ran: Mutex<Vec<Vec<String>>>,
    }

    impl Systemd for Fake {
        fn version(&self) -> Option<u32> {
            self.version
        }
        fn environment(&self) -> Vec<(String, String)> {
            vec![("PATH".into(), "/usr/local/bin:/usr/bin".into())]
        }
        fn run(&self, arguments: &[String]) -> Result<(), String> {
            self.ran.lock().unwrap().push(arguments.to_vec());
            if let Some(said) = &self.refuses {
                return Err(said.clone());
            }
            self.up.store(!self.dies, Ordering::SeqCst);
            Ok(())
        }
        fn runs(&self, _: &str) -> bool {
            self.up.load(Ordering::SeqCst)
        }
        fn main_pid(&self, _: &str) -> Option<u32> {
            self.pid
        }
        fn stop(&self, _: &str) -> Result<(), String> {
            self.up.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    fn unit(version: u32) -> Unit {
        Unit {
            name: "banda-engine".into(),
            program: "/home/person/.local/share/banda/engine/0.3.0/banda".into(),
            env: vec![("BANDA_LOG".into(), "debug".into())],
            version,
        }
    }

    fn pairs(of: &[(&str, &str)]) -> Vec<(String, String)> {
        (of.iter())
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn a_released_banda_runs_its_engine_as_the_sessions_service_where_systemd_answers() {
        let systemd = Fake {
            version: Some(257),
            ..Fake::default()
        };
        let none = Fake::default();
        let service = Way::Service { version: 257 };
        if cfg!(target_os = "linux") {
            assert_eq!(way(None, false, &systemd), service);
            assert_eq!(way(Some("service"), true, &systemd), service);
            assert_eq!(way(None, false, &none), Way::Child(Why::NoSystemd));
            let asked = way(Some("service"), true, &none);
            assert_eq!(asked, Way::Child(Why::NoSystemd));
        } else {
            assert_eq!(way(None, false, &systemd), Way::Child(Why::NotYet));
        }
        assert_eq!(way(None, true, &systemd), Way::Child(Why::Checkout));
        assert_eq!(way(Some("child"), false, &systemd), Way::Child(Why::Asked));
    }

    #[test]
    fn the_unit_is_named_by_banda_s_folder_and_another_state_s_hash() {
        let default = Path::new("/home/person/.local/state/banda");
        assert_eq!(
            unit_name(default, Some(default)),
            format!("{FOLDER}-engine")
        );
        let state = Path::new("/tmp/test/state");
        let named = unit_name(state, Some(default));
        assert!(named.starts_with(&format!("{FOLDER}-engine-")), "{named}");
        assert_eq!(named.len(), format!("{FOLDER}-engine-").len() + 8);
        assert_eq!(named, unit_name(state, None), "the same each time");
        assert_ne!(named, unit_name(Path::new("/tmp/other/state"), None));
    }

    #[test]
    fn the_engine_says_its_unit_only_as_that_unit_s_own_process() {
        let engine = format!("{FOLDER}-engine");
        let cgroup = format!(
            "0::/user.slice/user-1000.slice/user@1000.service/app.slice/{engine}.service\n"
        );
        assert_eq!(unit_in(&cgroup), Some(engine.as_str()));
        let hashed = format!("0::/user.slice/app.slice/{engine}-1a2b3c4d.service\n");
        let named = format!("{engine}-1a2b3c4d");
        assert_eq!(unit_in(&hashed), Some(named.as_str()));
        let v1 = format!("12:pids:/x\n1:name=systemd:/user.slice/app.slice/{engine}.service\n");
        assert_eq!(unit_in(&v1), Some(engine.as_str()));
        let others = [
            "0::/user.slice/app.slice/app-foot-1234.scope\n".to_owned(),
            "0::/user.slice/app.slice/banda-trial-x.scope\n".to_owned(),
            format!("0::/user.slice/app.slice/{engine}s.service\n"),
            String::new(),
        ];
        for other in &others {
            assert_eq!(unit_in(other), None, "{other}");
        }
        // A program in the unit's cgroup that is not its process, as a
        // test's engine an Agent's shell started, says no unit.
        let elsewhere = Fake {
            pid: Some(1),
            ..Fake::default()
        };
        assert_eq!(own_unit(&elsewhere), None);
    }

    #[test]
    fn the_unit_goes_on_when_a_child_dies_stops_its_children_first_and_starts_after_a_crash() {
        let arguments = unit(257).arguments();
        let has = |argument: &str| arguments.iter().any(|a| a == argument);
        for argument in [
            "--user",
            "--collect",
            "--unit=banda-engine",
            "--property=Type=exec",
            "--property=KillMode=mixed",
            "--property=OOMPolicy=continue",
            "--property=Restart=on-failure",
            "--property=StartLimitBurst=3",
            "--setenv=BANDA_LOG=debug",
        ] {
            assert!(has(argument), "{argument} in {arguments:?}");
        }
        let program = arguments.iter().position(|a| a == "--").unwrap();
        assert_eq!(
            arguments[program + 1..],
            [
                "/home/person/.local/share/banda/engine/0.3.0/banda".to_owned(),
                "serve".to_owned()
            ]
        );
        // An older systemd is not asked for what it lacks.
        let old = unit(239).arguments();
        assert!(old.iter().any(|a| a == "--property=Type=simple"));
        assert!(!old.iter().any(|a| a.contains("OOMPolicy")));
        assert!(!old.iter().any(|a| a.contains("StartLimit")));
        assert!(old.iter().any(|a| a == "--property=KillMode=mixed"));
    }

    #[test]
    #[cfg_attr(
        windows,
        ignore = "a systemd unit, Linux's: Windows starts the engine its own way with ADR 0090's step 10"
    )]
    fn the_unit_has_banda_s_own_variables_and_none_of_its_starter_s_else() {
        let starter = pairs(&[
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_SESSION_ID", "abc"),
            ("PATH", "/starter/bin"),
            ("BANDA_LOG", "debug"),
            ("BANDA_TOKEN", "a pass"),
            ("BANDA_ENGINE", "ws://127.0.0.1:1/ws"),
            ("BANDA_PROJECT", "0190"),
            ("BANDA_SPACE", "0190"),
            ("BANDA_ENGINE_AS", "service"),
            ("BANDA_STATE", "/elsewhere"),
            ("BANDA_NODE", "/opt/banda/electron"),
            ("SSH_AUTH_SOCK", "/run/user/1000/ssh-agent.socket"),
            ("WAYLAND_DISPLAY", "wayland-1"),
            ("XDG_CACHE_HOME", "/home/person/.cache"),
        ]);
        let manager = pairs(&[
            ("PATH", "/usr/local/bin:/usr/bin"),
            ("WAYLAND_DISPLAY", "wayland-0"),
        ]);
        let places = Places::under(Path::new("/home/person"));
        let env = environment(
            &starter,
            &places,
            &manager,
            Some("/home/person/.local/share/mise/shims:/usr/bin"),
        );
        let value = |name: &str| {
            (env.iter())
                .find(|(named, _)| named == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(value("BANDA_LOG"), Some("debug"));
        assert_eq!(value("BANDA_NODE"), Some("/opt/banda/electron"));
        for never in [
            "CLAUDECODE",
            "CLAUDE_CODE_SESSION_ID",
            "BANDA_TOKEN",
            "BANDA_ENGINE",
            "BANDA_PROJECT",
            "BANDA_SPACE",
            "BANDA_ENGINE_AS",
            "XDG_CACHE_HOME",
        ] {
            assert_eq!(value(never), None, "{never}");
        }
        // A place its starter set is as the starter resolved it, once; so
        // is one the starter's XDG folder moved. The rest the engine
        // finds where its starter does, and its programs are not told.
        assert_eq!(value("BANDA_STATE"), Some("/home/person/state"));
        assert_eq!(
            env.iter().filter(|(name, _)| name == "BANDA_STATE").count(),
            1
        );
        assert_eq!(value("BANDA_CACHE"), Some("/home/person/cache"));
        for unset in ["BANDA_ROOT", "BANDA_DATA", "BANDA_CONFIG"] {
            assert_eq!(value(unset), None, "{unset}");
        }
        // The session's ssh agent, which the manager lacks, comes; the
        // display is the manager's.
        assert_eq!(
            value("SSH_AUTH_SOCK"),
            Some("/run/user/1000/ssh-agent.socket")
        );
        assert_eq!(value("WAYLAND_DISPLAY"), None);
        assert_eq!(
            value("PATH"),
            Some("/home/person/.local/share/mise/shims:/usr/bin:/usr/local/bin")
        );

        // An AppImage's Electron goes as it stops: the engine is not told it.
        let mut from_appimage = starter.clone();
        from_appimage.push(("APPIMAGE".into(), "/home/person/Banda.AppImage".into()));
        let env = environment(&from_appimage, &places, &[], None);
        assert!(!env.iter().any(|(name, _)| name == "BANDA_NODE"));
        assert!(!env.iter().any(|(name, _)| name == "PATH"));
    }

    #[test]
    fn the_login_shell_s_path_is_read_between_its_marks() {
        let said = format!("Welcome!\n{MARK}\n/a:/b\n{MARK}\n");
        assert_eq!(between(&said).as_deref(), Some("/a:/b"));
        assert_eq!(between("no marks"), None);
        assert_eq!(between(&format!("{MARK}\n\n{MARK}\n")), None);
        assert_eq!(merged("/a:/b", "/b:/c::"), "/a:/b:/c");
        assert_eq!(version_of("257 (257.5-1-arch)"), Some(257));
        assert_eq!(version_of(""), None);
        assert_eq!(
            assignment("PATH=/usr/bin"),
            Some(("PATH".into(), "/usr/bin".into()))
        );
        assert_eq!(
            assignment("NAME=$'a b'"),
            Some(("NAME".into(), "a b".into()))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_login_shell_says_its_path_over_the_session_s_and_never_its_starter_s() {
        let starter = pairs(&[("HOME", "/nonexistent"), ("PATH", "/starter/bin")]);
        let path = login_path(Path::new("/bin/sh"), &starter, "/usr/bin:/bin").await;
        let path = path.expect("the shell says its PATH");
        assert!(path.contains("/usr/bin"), "{path}");
        assert!(!path.contains("/starter/bin"), "{path}");
    }

    #[tokio::test]
    async fn a_client_starts_the_unit_and_waits_for_its_engine_to_answer() {
        let systemd = Fake {
            version: Some(257),
            ..Fake::default()
        };
        let mut asked = 0;
        let answers = || {
            asked += 1;
            let up = systemd.up.load(Ordering::SeqCst) && asked > 3;
            async move {
                if up {
                    Ok(4100)
                } else {
                    Err(Failure::broken("no answer yet"))
                }
            }
        };
        let started = start(&systemd, &unit(257), answers).await;
        assert_eq!(started.ok(), Some(4100));
        assert_eq!(systemd.ran.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_unit_another_client_started_is_waited_for() {
        let systemd = Fake {
            version: Some(257),
            refuses: Some("Unit banda-engine.service was already loaded".into()),
            up: AtomicBool::new(true),
            ..Fake::default()
        };
        let started = start(&systemd, &unit(257), || async { Ok(()) }).await;
        assert!(started.is_ok());
    }

    #[tokio::test]
    async fn an_engine_that_refuses_is_not_waited_for() {
        let systemd = Fake {
            version: Some(257),
            up: AtomicBool::new(true),
            ..Fake::default()
        };
        let refused = start(&systemd, &unit(257), || async {
            Err::<(), _>(Failure::Refused(Refusal::forbidden("another protocol")))
        })
        .await;
        assert!(matches!(refused, Err(Failure::Refused(_))));
    }

    #[tokio::test]
    async fn a_unit_that_does_not_start_or_stops_at_once_is_said() {
        let refused = Fake {
            version: Some(257),
            refuses: Some("Failed to connect to bus".into()),
            ..Fake::default()
        };
        let none = || async { Err::<(), _>(Failure::broken("no answer")) };
        let said = start(&refused, &unit(257), none)
            .await
            .err()
            .unwrap()
            .words();
        assert!(said.contains("Failed to connect to bus"), "{said}");

        let dies = Fake {
            version: Some(257),
            dies: true,
            ..Fake::default()
        };
        let said = start(&dies, &unit(257), none).await.err().unwrap().words();
        assert!(said.contains("stopped as it started"), "{said}");
    }
}
