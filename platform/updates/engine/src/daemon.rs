//! `banda-update run`: the updater as a service of its own, beside the
//! engine's, never inside it (ADR 0131, decision 2). It looks at the
//! channel a minute after it starts, then every hour, and keeps what it
//! found in `engine/state.json` for the engine. The engine moves onto a
//! copy once nothing runs, as it knows that; this guards the move: a copy
//! the engine moved onto that does not answer on its version within
//! [`guard::GRACE_MS`] is marked bad, never taken again, and the copy it
//! moved from is started again.

use crate::guard::{self, Guard};
use crate::{Banda, Updates};
use banda_machines::TakeUpdates;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::watch;

/// The first look, after it starts, and each after it.
const FIRST: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(60 * 60);
/// How often it looks at the engine's last move.
const WATCH: Duration = Duration::from_secs(5);

/// The Banda it serves.
#[derive(Clone, Debug)]
pub struct Serves {
    pub channel: &'static str,
    pub folder: &'static str,
    /// Where its copies are: the data folder's `engine/`.
    pub engine: PathBuf,
    /// Its state folder, where `engine.json` says what runs.
    pub state: PathBuf,
    /// Its config folder, where `machine.toml` says whether it updates.
    pub config: PathBuf,
    /// Where it reads releases, in place of GitHub's: for the tests.
    pub releases: Option<String>,
    /// Its first look, after it starts: a minute, or a test's.
    pub first: Duration,
}

/// Its first look, after it starts.
pub const FIRST_LOOK: Duration = FIRST;

/// What it reads of `engine.json`.
#[derive(Deserialize)]
struct Running {
    version: Option<String>,
    #[serde(default)]
    unit: Option<String>,
}

/// Runs until it is stopped.
pub async fn run(serves: Serves) {
    tracing::info!(engine = %serves.engine.display(), "banda-update runs");
    let mut next_look = tokio::time::Instant::now() + serves.first;
    let mut guarded: Option<i64> = None;
    let mut unit: Option<String> = None;
    // The look that runs, in a task of its own: a download, or a network
    // gone quiet, never keeps the guard from a move.
    let mut looking: Option<tokio::task::JoinHandle<()>> = None;
    loop {
        let running = running(&serves.state);
        if let Some(said) = running.as_ref().and_then(|r| r.unit.clone()) {
            unit = Some(said);
        }
        let version = running.and_then(|r| r.version);
        // The last move, once.
        if let Some(moved) = guard::moved(&serves.engine).filter(|m| guarded != Some(m.at)) {
            match guard::guard(&moved, version.as_deref(), banda_kernel::now_ms()) {
                Guard::Fine => guarded = Some(moved.at),
                Guard::Wait => {}
                Guard::PutBack => {
                    guarded = Some(moved.at);
                    put_back(&serves, &moved, unit.as_deref(), version.is_some()).await;
                }
            }
        }
        let free = looking.as_ref().is_none_or(|look| look.is_finished());
        if free && tokio::time::Instant::now() >= next_look {
            next_look = tokio::time::Instant::now() + EVERY;
            if let Some(version) = version {
                looking = Some(tokio::spawn(look(serves.clone(), version)));
            }
        }
        tokio::time::sleep(WATCH).await;
    }
}

/// One look for the engine that runs `version`, each change of it kept
/// as it comes, a download's share too. It waits for a look or a take
/// the engine asked (`guard::lock`).
async fn look(serves: Serves, version: String) {
    let engine = serves.engine.clone();
    let _one = tokio::task::spawn_blocking(move || guard::lock(&engine)).await;
    let updates = updates(&serves, version);
    let mut changes = updates.watch();
    let engine = serves.engine.clone();
    let keeping = tokio::spawn(async move {
        while changes.changed().await.is_ok() {
            guard::keep_state(&engine, &changes.borrow_and_update().clone());
        }
    });
    let state = updates.look().await;
    keeping.abort();
    guard::keep_state(&serves.engine, &state);
}

/// The Updates of the engine that runs `version`.
fn updates(serves: &Serves, version: String) -> Updates {
    let own = serves.engine.join(&version).join(crate::PROGRAM);
    let program = own.is_file().then_some(own).or_else(|| {
        let beside = std::env::current_exe().ok()?.parent()?.join(crate::PROGRAM);
        beside.is_file().then_some(beside)
    });
    let banda = Banda {
        channel: serves.channel,
        folder: serves.folder,
        version,
        program,
        engine: serves.engine.clone(),
    };
    let (_, take) = watch::channel(takes(&serves.config));
    let updates = Updates::new(banda, take);
    match &serves.releases {
        Some(at) => updates.reading(at, Duration::MAX, Duration::MAX),
        None => updates,
    }
}

/// What `machine.toml` says of updates; `when-idle` where it says nothing.
fn takes(config: &Path) -> TakeUpdates {
    #[derive(Deserialize)]
    struct Said {
        updates: Option<TakeUpdates>,
    }
    std::fs::read_to_string(config.join("machine.toml"))
        .ok()
        .and_then(|text| toml::from_str::<Said>(&text).ok())
        .and_then(|said| said.updates)
        .unwrap_or_default()
}

/// What `engine.json` says runs; none while no engine does.
fn running(state: &Path) -> Option<Running> {
    serde_json::from_slice(&std::fs::read(state.join("engine.json")).ok()?).ok()
}

/// Marks the copy `moved` went to bad, and starts the one it came from:
/// `banda start` of that copy starts the engine's unit or job naming it,
/// and does nothing where an engine answers already. Where none
/// `answers`, the copy that hangs is stopped first, as `banda stop` stops
/// an engine that does not answer: its unit or job, else its process.
async fn put_back(serves: &Serves, moved: &guard::Moved, unit: Option<&str>, answers: bool) {
    tracing::warn!(to = %moved.to, from = %moved.from, "the new engine did not start: Banda goes back");
    if let Err(error) = guard::mark_bad(&serves.engine, &moved.to) {
        tracing::warn!(%error, "the copy that did not start is not marked");
    }
    let from = serves.engine.join(&moved.from).join(crate::PROGRAM);
    let banda = |command: &str| {
        let mut run = tokio::process::Command::new(&from);
        run.arg(command)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true);
        tokio::time::timeout(Duration::from_secs(60), run.status())
    };
    if !answers {
        let stopped = banda("stop").await;
        tracing::info!(?stopped, "the copy that did not answer was stopped");
    }
    // A unit that gave up after its crashes starts again only once reset.
    if cfg!(target_os = "linux")
        && let Some(unit) = unit
    {
        let _ = tokio::process::Command::new("systemctl")
            .args(["--user", "reset-failed", unit])
            .status()
            .await;
    }
    let started = banda("start").await;
    match started {
        Ok(Ok(status)) if status.success() => {
            tracing::info!(version = %moved.from, "the engine runs its copy before again");
        }
        other => tracing::warn!(?other, program = %from.display(), "the copy before did not start"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn machine_toml_says_whether_it_updates() {
        let config = tempfile::tempdir().unwrap();
        assert_eq!(takes(config.path()), TakeUpdates::WhenIdle);
        std::fs::write(
            config.path().join("machine.toml"),
            "name = \"arc\"\nupdates = \"ask\"\n",
        )
        .unwrap();
        assert_eq!(takes(config.path()), TakeUpdates::Ask);
    }
}

/// How the engine starts the updater's service beside its own (ADR 0131):
/// a systemd user unit, or a launchd job, named `name`.
#[derive(Clone, Debug)]
pub struct Service {
    /// `banda-dev-update` on Linux, `so.banda.dev.update` on macOS.
    pub name: String,
    pub state: PathBuf,
    pub config: PathBuf,
}

/// Starts `banda-update run` at `program` as the service `service` for
/// the Banda `banda` is, in place of one that runs: a newer engine brings
/// its own updater. Says whether it started; elsewhere than Linux and
/// macOS it does not.
pub async fn start(program: &Path, banda: &Banda, service: &Service) -> bool {
    let mut args: Vec<std::ffi::OsString> = vec![
        program.into(),
        "run".into(),
        "--channel".into(),
        banda.channel.into(),
        "--folder".into(),
        banda.folder.into(),
        "--engine".into(),
        banda.engine.clone().into(),
        "--state".into(),
        service.state.clone().into(),
        "--config".into(),
        service.config.clone().into(),
    ];
    let quiet = |name: &str, said: &[&str]| {
        let mut run = tokio::process::Command::new(name);
        run.args(said)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        run
    };
    let started = if cfg!(target_os = "linux") {
        let unit = format!("{}.service", service.name);
        let _ = quiet("systemctl", &["--user", "stop", &unit])
            .status()
            .await;
        let _ = quiet("systemctl", &["--user", "reset-failed", &unit])
            .status()
            .await;
        let mut run = quiet("systemd-run", &[]);
        run.args(["--user", "--collect", "--quiet"])
            .arg(format!("--unit={}", service.name))
            .args(["--property=Restart=always", "--property=RestartSec=30"])
            .args(&args);
        run.status().await
    } else if cfg!(target_os = "macos") {
        let _ = quiet("launchctl", &["remove", &service.name])
            .status()
            .await;
        let mut run = quiet("launchctl", &["submit", "-l", &service.name, "--"]);
        run.args(args.drain(..));
        run.status().await
    } else {
        return false;
    };
    match started {
        Ok(status) if status.success() => {
            tracing::info!(service = %service.name, "banda-update runs as its own service");
            true
        }
        other => {
            tracing::warn!(?other, service = %service.name, "banda-update did not start as a service: the engine looks itself");
            false
        }
    }
}
