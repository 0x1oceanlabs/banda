//! The engine as a service of the Person's session (ADR 0086, decision 1).
//!
//! On Linux it runs as a systemd user unit, `<folder>-engine`
//! (`banda-engine`, `banda-dev-engine`), which any client starts when no
//! engine answers: the window, and every command that reaches the engine.
//! It is started with `systemd-run --user`, so it has the user manager's
//! environment, never its starter's: what a starter's shell sets for
//! itself, as Claude Code's `CLAUDECODE`, reaches no Harness or Terminal
//! of the engine. Only Banda's own variables come with it, which say where
//! its folders are, and PATH from the login shell before the manager's,
//! with what the shell's profile adds, where Harnesses are found. The unit
//! goes on when one child dies for want of memory (`OOMPolicy=continue`),
//! and stops its children first: SIGTERM to the engine, which stops its
//! Harnesses and Terminals itself, and what is left is killed after the
//! timeout (`KillMode=mixed`).
//!
//! Where no systemd user session answers (macOS, until its launchd agent,
//! step 7; a container; CI), the engine stays the window's child, as
//! before, and the log says so. So does a checkout's, Banda Local, which an
//! Agent's test runs must leave nothing of behind, unless `BANDA_ENGINE_AS`
//! says `service`, as a test of the service does.
//!
//! Every call to systemd goes through [`Systemd`], so tests give their own.

use crate::Failure;
use crate::places::{FOLDER, Places, Running};
use banda_kernel::{ENGINE_VARIABLE, PROJECT_VARIABLE, TOKEN_VARIABLE};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Says how this Banda runs its engine: `service`, as the session's, or
/// `child`, the window's. Unsaid, a released Banda runs it as the
/// session's service where systemd's user manager answers, and a checkout's
/// as the window's child.
pub const WAY_VARIABLE: &str = "BANDA_ENGINE_AS";

/// What the unit's engine finds its unit's name in, to say it in
/// `engine.json` for `banda status` and `banda stop`.
pub const UNIT_VARIABLE: &str = "BANDA_UNIT";

/// The most a client waits for an engine whose unit runs to answer: it
/// opens its Projects first, and answers once it is whole.
pub const OPENS_WITHIN: Duration = Duration::from_secs(120);

/// How long the login shell may take to say its PATH, as the window waits
/// for it on macOS (`login.ts`).
const LOGIN_WITHIN: Duration = Duration::from_secs(10);

/// Around the PATH the login shell prints, so its profile's own output is
/// skipped.
const MARK: &str = "__banda_path__";

/// How this Banda runs its engine here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Way {
    /// As a systemd user unit, with the user manager's version.
    Service { systemd: u32 },
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

/// What a unit is now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    /// It runs, or starts.
    Up,
    /// It is not there, or stopped.
    Gone,
}

/// The user's systemd, as the engine asks it.
pub trait Systemd: Sync {
    /// The user manager's version; none when no user manager answers.
    fn version(&self) -> Option<u32>;
    /// The user manager's PATH, as its units get it.
    fn path(&self) -> Option<String>;
    /// `systemd-run` with `arguments`, which start a transient unit.
    fn run(&self, arguments: &[String]) -> Result<(), String>;
    /// What `unit` is now.
    fn state(&self, unit: &str) -> State;
    /// Stops `unit`, and returns once it has.
    fn stop(&self, unit: &str) -> Result<(), String>;
}

/// The systemd of this user's session, through `systemctl --user` and
/// `systemd-run --user`.
pub struct User;

impl User {
    /// What `program arguments…` printed, or the words it failed with.
    fn ran(program: &str, arguments: &[&str]) -> Result<String, String> {
        let output = Command::new(program)
            .args(arguments)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("{program} did not start: {error}"))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
        }
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }

    fn systemctl(arguments: &[&str]) -> Option<String> {
        let arguments: Vec<&str> = std::iter::once("--user")
            .chain(arguments.iter().copied())
            .collect();
        User::ran("systemctl", &arguments).ok()
    }
}

impl Systemd for User {
    fn version(&self) -> Option<u32> {
        version_of(&User::systemctl(&[
            "show",
            "--property=Version",
            "--value",
        ])?)
    }

    fn path(&self) -> Option<String> {
        let environment = User::systemctl(&["show-environment"])?;
        environment
            .lines()
            .find_map(|line| line.strip_prefix("PATH="))
            .map(|path| path.trim_matches(['\'', '"']).to_owned())
    }

    fn run(&self, arguments: &[String]) -> Result<(), String> {
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        User::ran("systemd-run", &arguments).map(drop)
    }

    fn state(&self, unit: &str) -> State {
        let service = format!("{unit}.service");
        let said = User::systemctl(&["show", "--property=ActiveState", "--value", &service]);
        match said.as_deref() {
            Some("active" | "activating" | "reloading") => State::Up,
            _ => State::Gone,
        }
    }

    fn stop(&self, unit: &str) -> Result<(), String> {
        User::ran("systemctl", &["--user", "stop", &format!("{unit}.service")]).map(drop)
    }
}

/// The version systemd says, as `257 (257.5-1-arch)`.
fn version_of(said: &str) -> Option<u32> {
    let digits: String = said.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// How this Banda runs its engine: as `asked` says (`BANDA_ENGINE_AS`),
/// else the window's child for a `checkout`'s, else the session's service
/// where systemd's user manager answers on Linux.
pub fn way(asked: Option<&str>, checkout: bool, systemd: &dyn Systemd) -> Way {
    match asked {
        Some("child") => return Way::Child(Why::Asked),
        Some("service") => {}
        _ if checkout => return Way::Child(Why::Checkout),
        _ => {}
    }
    if !cfg!(target_os = "linux") {
        return Way::Child(Why::NotYet);
    }
    match systemd.version() {
        Some(systemd) => Way::Service { systemd },
        None => Way::Child(Why::NoSystemd),
    }
}

/// [`way`], as this program's environment and build say.
pub fn way_here(systemd: &dyn Systemd) -> Way {
    let asked = std::env::var(WAY_VARIABLE).ok();
    way(asked.as_deref(), crate::places::from_checkout(), systemd)
}

/// The unit's name: `<folder>-engine`, and for a state folder that a test
/// or a trial names (`named`), a short hash of it after, so each engine has
/// its own.
pub fn unit_name(state: &Path, named: bool) -> String {
    use sha2::{Digest, Sha256};
    if !named {
        return format!("{FOLDER}-engine");
    }
    let hash = Sha256::digest(state.as_os_str().as_encoded_bytes());
    let short: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("{FOLDER}-engine-{short}")
}

/// The unit that runs `program serve` as the session's engine.
#[derive(Clone, Debug)]
pub struct Unit {
    pub name: String,
    pub program: PathBuf,
    /// Set over the user manager's environment.
    pub env: Vec<(String, String)>,
    /// The user manager's version, which says what the unit may ask.
    pub systemd: u32,
}

impl Unit {
    /// What `systemd-run` takes to start it.
    pub fn arguments(&self) -> Vec<String> {
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
            if self.systemd >= 240 {
                "Type=exec"
            } else {
                "Type=simple"
            },
            // SIGTERM to the engine alone, which stops its Harnesses and
            // Terminals itself; what is left after the timeout is killed.
            "KillMode=mixed",
            "TimeoutStopSec=15",
        ];
        // One child killed for want of memory does not stop the rest
        // (services take it from systemd 243).
        if self.systemd >= 243 {
            properties.push("OOMPolicy=continue");
        }
        arguments.extend(properties.iter().map(|p| format!("--property={p}")));
        arguments.extend((self.env.iter()).map(|(name, value)| format!("--setenv={name}={value}")));
        arguments.push("--".to_owned());
        arguments.push(self.program.display().to_string());
        arguments.push("serve".to_owned());
        arguments
    }
}

/// The variables a unit named `unit` gets over the user manager's: those
/// of Banda's own its `starter` has, but for what names an Agent's pass or
/// Project, or Electron inside an AppImage, which goes as the AppImage
/// stops; every place as `places` resolved it; its name; and PATH, the
/// login shell's (`login`) then the manager's (`manager`).
pub fn environment(
    starter: impl IntoIterator<Item = (String, String)>,
    places: &Places,
    unit: &str,
    login: Option<&str>,
    manager: Option<&str>,
) -> Vec<(String, String)> {
    let starter: Vec<(String, String)> = starter.into_iter().collect();
    let in_appimage = starter.iter().any(|(name, _)| name == "APPIMAGE");
    let never = [
        TOKEN_VARIABLE,
        ENGINE_VARIABLE,
        PROJECT_VARIABLE,
        "BANDA_SPACE",
        WAY_VARIABLE,
        UNIT_VARIABLE,
    ];
    let placed = crate::places::VARIABLES;
    let mut env: Vec<(String, String)> = starter
        .into_iter()
        .filter(|(name, _)| name.starts_with("BANDA_"))
        .filter(|(name, _)| !never.contains(&name.as_str()) && !placed.contains(&name.as_str()))
        .filter(|(name, _)| !(in_appimage && name == banda_harnesses::carried::NODE_VARIABLE))
        .collect();
    env.sort();
    env.extend(
        (places.variables().into_iter())
            .map(|(name, place)| (name.to_owned(), place.display().to_string())),
    );
    env.push((UNIT_VARIABLE.to_owned(), unit.to_owned()));
    let path = match (login, manager) {
        (Some(login), Some(manager)) => Some(merged(login, manager)),
        (Some(one), None) | (None, Some(one)) => Some(merged(one, "")),
        (None, None) => None,
    };
    if let Some(path) = path {
        env.push(("PATH".to_owned(), path));
    }
    env
}

/// `first`'s folders, then those of `then` it lacks, each once.
pub fn merged(first: &str, then: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let folders: Vec<&str> = (first.split(':').chain(then.split(':')))
        .filter(|folder| !folder.is_empty() && seen.insert(*folder))
        .collect();
    folders.join(":")
}

/// The PATH `shell`, as a login shell, says it has; none when it fails,
/// says nothing of it, or takes longer than the window waits.
pub async fn login_path(shell: &Path) -> Option<String> {
    let script = format!("echo {MARK}; printenv PATH; echo {MARK}");
    let asked = tokio::process::Command::new(shell)
        .args(["-ilc", &script])
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
pub fn shell() -> PathBuf {
    std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from)
}

/// The unit that runs `program` as the engine of `places`, for a user
/// manager of version `systemd`.
pub async fn unit(places: &Places, program: PathBuf, systemd: u32, user: &dyn Systemd) -> Unit {
    let name = unit_name(&places.state, crate::places::state_named());
    let login = login_path(&shell()).await;
    if login.is_none() {
        tracing::warn!("the login shell did not say its PATH: the engine has the session's");
    }
    let env = environment(
        std::env::vars(),
        places,
        &name,
        login.as_deref(),
        user.path().as_deref(),
    );
    Unit {
        name,
        program,
        env,
        systemd,
    }
}

/// Starts `unit` and waits for its engine to answer (`answers`), while the
/// unit runs and for [`OPENS_WITHIN`] at most. A unit of that name that
/// runs already, which another client just started, is waited for too.
pub async fn start<F>(
    systemd: &dyn Systemd,
    unit: &Unit,
    mut answers: impl FnMut() -> F,
) -> Result<Running, Failure>
where
    F: Future<Output = Option<Running>>,
{
    if let Err(said) = systemd.run(&unit.arguments())
        && systemd.state(&unit.name) == State::Gone
    {
        return Err(Failure::Broken(format!(
            "Banda's engine did not start as a service: {said}"
        )));
    }
    let began = Instant::now();
    loop {
        if let Some(running) = answers().await {
            return Ok(running);
        }
        if systemd.state(&unit.name) == State::Gone {
            // It may have answered as it went.
            if let Some(running) = answers().await {
                return Ok(running);
            }
            return Err(Failure::Broken(format!(
                "Banda's engine stopped as it started: its log, engine.log, says why \
                 (journalctl --user -u {}).",
                unit.name
            )));
        }
        if began.elapsed() > OPENS_WITHIN {
            return Err(Failure::Broken(format!(
                "Banda's engine did not answer within {} s of its start.",
                OPENS_WITHIN.as_secs()
            )));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// A user manager that answers as told, and keeps what it was asked.
    #[derive(Default)]
    struct Fake {
        version: Option<u32>,
        /// Whether `systemd-run` fails, saying this.
        refuses: Option<String>,
        /// Whether the unit runs, as `state` says.
        up: AtomicBool,
        /// Whether a unit that starts stops at once.
        dies: bool,
        ran: Mutex<Vec<Vec<String>>>,
        stopped: Mutex<Vec<String>>,
    }

    impl Systemd for Fake {
        fn version(&self) -> Option<u32> {
            self.version
        }
        fn path(&self) -> Option<String> {
            Some("/usr/local/bin:/usr/bin".into())
        }
        fn run(&self, arguments: &[String]) -> Result<(), String> {
            self.ran.lock().unwrap().push(arguments.to_vec());
            if let Some(said) = &self.refuses {
                return Err(said.clone());
            }
            self.up.store(!self.dies, Ordering::SeqCst);
            Ok(())
        }
        fn state(&self, _: &str) -> State {
            if self.up.load(Ordering::SeqCst) {
                State::Up
            } else {
                State::Gone
            }
        }
        fn stop(&self, unit: &str) -> Result<(), String> {
            self.stopped.lock().unwrap().push(unit.to_owned());
            self.up.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    fn places() -> Places {
        let at = |name: &str| PathBuf::from("/home/person").join(name);
        Places {
            root: at("Banda"),
            data: at(".local/share/banda"),
            state: at(".local/state/banda"),
            config: at(".config/banda"),
            cache: at(".cache/banda"),
        }
    }

    fn running() -> Running {
        Running {
            protocol: 1,
            port: 4100,
            secret: "secret".into(),
            build: None,
            version: None,
            since: None,
            pid: None,
            unit: None,
        }
    }

    fn unit(systemd: u32) -> Unit {
        Unit {
            name: "banda-engine".into(),
            program: "/home/person/.local/share/banda/engine/0.3.0/banda".into(),
            env: vec![("BANDA_UNIT".into(), "banda-engine".into())],
            systemd,
        }
    }

    #[test]
    fn a_released_banda_runs_its_engine_as_the_sessions_service_where_systemd_answers() {
        let systemd = Fake {
            version: Some(257),
            ..Fake::default()
        };
        let none = Fake::default();
        let service = Way::Service { systemd: 257 };
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
    fn the_unit_is_named_by_banda_s_folder_and_a_named_state_s_hash() {
        let state = Path::new("/tmp/test/state");
        assert_eq!(unit_name(state, false), format!("{FOLDER}-engine"));
        let named = unit_name(state, true);
        assert!(named.starts_with(&format!("{FOLDER}-engine-")), "{named}");
        assert_eq!(named.len(), format!("{FOLDER}-engine-").len() + 8);
        assert_eq!(named, unit_name(state, true), "the same each time");
        assert_ne!(named, unit_name(Path::new("/tmp/other/state"), true));
    }

    #[test]
    fn the_unit_goes_on_when_a_child_dies_and_stops_its_children_first() {
        let arguments = unit(257).arguments();
        let has = |argument: &str| arguments.iter().any(|a| a == argument);
        for argument in [
            "--user",
            "--collect",
            "--unit=banda-engine",
            "--property=Type=exec",
            "--property=KillMode=mixed",
            "--property=OOMPolicy=continue",
            "--setenv=BANDA_UNIT=banda-engine",
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
        assert!(old.iter().any(|a| a == "--property=KillMode=mixed"));
    }

    #[test]
    fn the_unit_has_banda_s_own_variables_and_none_of_its_starter_s_else() {
        let starter = [
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
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned()));
        let env = environment(
            starter.clone(),
            &places(),
            "banda-engine",
            Some("/home/person/.local/share/mise/shims:/usr/bin"),
            Some("/usr/local/bin:/usr/bin"),
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
        ] {
            assert_eq!(value(never), None, "{never}");
        }
        // Its places are those its starter resolved, once each.
        assert_eq!(
            value("BANDA_STATE"),
            Some("/home/person/.local/state/banda")
        );
        assert_eq!(
            env.iter().filter(|(name, _)| name == "BANDA_STATE").count(),
            1
        );
        assert_eq!(value("BANDA_ROOT"), Some("/home/person/Banda"));
        assert_eq!(value("BANDA_UNIT"), Some("banda-engine"));
        assert_eq!(
            value("PATH"),
            Some("/home/person/.local/share/mise/shims:/usr/bin:/usr/local/bin")
        );

        // An AppImage's Electron goes as it stops: the engine is not told it.
        let mut from_appimage = starter.to_vec();
        from_appimage.push(("APPIMAGE".into(), "/home/person/Banda.AppImage".into()));
        let env = environment(from_appimage, &places(), "banda-engine", None, None);
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
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_login_shell_says_its_path() {
        let path = login_path(Path::new("/bin/sh")).await;
        assert!(path.is_some_and(|path| !path.is_empty()));
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
            async move { up.then(running) }
        };
        let started = start(&systemd, &unit(257), answers).await;
        assert_eq!(started.ok().map(|r| r.port), Some(4100));
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
        let started = start(&systemd, &unit(257), || async { Some(running()) }).await;
        assert!(started.is_ok());
    }

    #[tokio::test]
    async fn a_unit_that_does_not_start_or_stops_at_once_is_said() {
        let refused = Fake {
            version: Some(257),
            refuses: Some("Failed to connect to bus".into()),
            ..Fake::default()
        };
        let said = start(&refused, &unit(257), || async { None })
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
        let said = start(&dies, &unit(257), || async { None })
            .await
            .err()
            .unwrap()
            .words();
        assert!(said.contains("stopped as it started"), "{said}");
        assert!(dies.stopped.lock().unwrap().is_empty());
    }
}
