//! The engine's life as its clients see it (ADR 0086, decisions 1 and 3):
//! every command that reaches the engine starts it when none answers,
//! `banda start` does only that, `banda status` says whether it runs, since
//! when and its build, and `banda stop` is Quit Banda.
//!
//! The window runs `banda start --with-parent`: it prints where the engine
//! listens, as `serve --with-parent` does, then follows the engine until
//! the window goes, which leaves the engine running, or until the engine
//! stops. It exits 0 when the engine said it stopped, as Quit Banda stops
//! it, so the window quits too; otherwise the window starts it again.
//! Where the engine is the window's child (`service.rs`), it serves the
//! engine itself.

use crate::client::Client;
use crate::places::{Places, Running};
use crate::run::{self, Before, Left};
use crate::service::{self, Systemd, User, Way};
use crate::{Failure, parent, serve};
use banda_kernel::{CommandId, ENGINE_VARIABLE, Refusal};
use serde_json::{Value, json};
use std::io::{BufRead, IsTerminal, Write};
use std::time::{Duration, Instant};

/// How long `banda stop` waits for the engine to go, past its own timeout
/// to stop its Harnesses (`TimeoutStopSec`).
const STOPS_WITHIN: Duration = Duration::from_secs(20);

/// How long the window's follower waits for an engine that let go of it to
/// end, before it reads how it left.
const ENDS_WITHIN: Duration = Duration::from_secs(10);

/// A client of the running engine, as its owner: one that answers, or else
/// one this starts as the session's service where it runs as one. Where
/// the engine is the window's child, a client says that none runs, as
/// before.
pub async fn connect(places: &Places) -> Result<Client, Failure> {
    if let Some(client) = answering(places).await {
        return Ok(client.1);
    }
    let systemd = User;
    match service::way_here(&systemd) {
        Way::Service { systemd: version } => {
            let running = started(places, version, &systemd).await?;
            let nowhere = "Banda's engine does not answer.";
            Client::hello(&running.url(), running.secret, nowhere).await
        }
        Way::Child(_) => {
            let running = places.running()?;
            let nowhere = "Banda's engine does not answer. Start it with: banda serve";
            Client::hello(&running.url(), running.secret, nowhere).await
        }
    }
}

/// The running engine and a client of it as its owner, when one answers.
async fn answering(places: &Places) -> Option<(Running, Client)> {
    let running = places.running().ok()?;
    let client = Client::hello(&running.url(), running.secret.clone(), "").await;
    Some((running, client.ok()?))
}

/// Starts the engine as the session's service, and returns once it
/// answers.
async fn started(places: &Places, version: u32, systemd: &dyn Systemd) -> Result<Running, Failure> {
    let program = std::env::current_exe().map_err(Failure::broken)?;
    let unit = service::unit(places, program, version, systemd).await;
    tracing::info!(unit = %unit.name, "Banda's engine starts as the session's service");
    service::start(systemd, &unit, || async {
        answering(places).await.map(|(running, _)| running)
    })
    .await
}

/// `banda start`: starts the engine when none answers, and says how it
/// runs. With `with_parent`, for the window: see the module's words.
pub async fn start(places: Places, with_parent: bool, way: Way) -> Result<(), Failure> {
    if !with_parent {
        let running = match (answering(&places).await, way) {
            (Some((running, _)), _) => running,
            (None, Way::Service { systemd: version }) => started(&places, version, &User).await?,
            (None, Way::Child(why)) => {
                return Err(Failure::Broken(format!(
                    "Banda's engine is the window's child here ({}): open Banda, or start it with: banda serve",
                    why.words()
                )));
            }
        };
        println!("{}", said(&running));
        return Ok(());
    }
    let running = match (answering(&places).await, way) {
        (Some((running, _)), _) => running,
        (None, Way::Service { systemd: version }) => started(&places, version, &User).await?,
        (None, Way::Child(why)) => {
            match why {
                service::Why::NoSystemd => tracing::warn!(
                    "{}: the engine runs as the window's child, and stops with it",
                    why.words()
                ),
                _ => tracing::info!("the engine runs as the window's child: {}", why.words()),
            }
            return serve::serve(places, 0, true).await;
        }
    };
    follow(&places, running).await
}

/// Prints where the engine listens, as `serve --with-parent` does, and
/// follows it until the window goes, or until it stops: then it says
/// whether it stopped as asked, or must be started again.
async fn follow(places: &Places, running: Running) -> Result<(), Failure> {
    let mut line = serde_json::to_value(&running).map_err(Failure::broken)?;
    line["window"] = places.window().display().to_string().into();
    println!("{line}");
    let _ = std::io::stdout().flush();
    let (gone, window_gone) = tokio::sync::oneshot::channel::<()>();
    parent::on_gone(move || {
        let _ = gone.send(());
    });
    let nowhere = "Banda's engine does not answer.";
    let client = Client::hello(&running.url(), running.secret.clone(), nowhere).await?;
    tokio::select! {
        // The window went: the engine goes on.
        _ = window_gone => return Ok(()),
        () = client.closed() => {}
    }
    let began = Instant::now();
    while running.pid.is_some_and(alive) && began.elapsed() < ENDS_WITHIN {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    match run::before(places).0 {
        Before::Left(Left::Stopped) => Ok(()),
        _ => Err(Failure::Broken(
            "Banda's engine stopped without saying it left: the window starts it again.".into(),
        )),
    }
}

/// `banda status`: whether the engine runs, since when, and its build, as
/// one JSON line. It starts nothing.
pub async fn status(places: &Places) -> Result<(), Failure> {
    let line = match answering(places).await {
        Some((running, _)) => said(&running),
        None => json!({ "running": false }),
    };
    println!("{line}");
    Ok(())
}

/// What `banda status` says of a running engine.
fn said(running: &Running) -> Value {
    let mut line = json!({ "running": true });
    for (key, value) in [
        ("version", running.version.clone().map(Value::from)),
        ("build", running.build.clone().map(Value::from)),
        ("since", running.since.map(Value::from)),
        ("pid", running.pid.map(Value::from)),
        ("unit", running.unit.clone().map(Value::from)),
    ] {
        if let Some(value) = value {
            line[key] = value;
        }
    }
    line
}

/// `banda stop`: Quit Banda. It asks first when Agents are working, unless
/// `force`; then it stops the engine, which stops its Harnesses and
/// Terminals, and returns once it has gone. A window open on it quits too.
pub async fn stop(places: &Places, force: bool) -> Result<(), Failure> {
    if std::env::var_os(ENGINE_VARIABLE).is_some_and(|set| !set.is_empty()) {
        return Err(Failure::Refused(Refusal::forbidden(format!(
            "Only the Person quits Banda: {ENGINE_VARIABLE} says this runs under an Agent's pass. \
             Nothing was stopped."
        ))));
    }
    let Some((running, mut client)) = answering(places).await else {
        eprintln!("banda: Banda's engine is not running.");
        return Ok(());
    };
    if !force {
        let working = working(&mut client).await?;
        if working > 0 && !agreed(working)? {
            return Err(Failure::Broken("Nothing was stopped.".into()));
        }
    }
    drop(client);
    match (&running.unit, running.pid) {
        (Some(unit), _) => {
            let unit = unit.clone();
            let stopped = tokio::task::spawn_blocking(move || User.stop(&unit)).await;
            stopped
                .map_err(Failure::broken)?
                .map_err(|said| Failure::Broken(format!("Banda's engine did not stop: {said}")))?;
        }
        (None, Some(pid)) => terminate(pid)?,
        (None, None) => {
            return Err(Failure::Broken(
                "This engine does not say its process: stop it where it was started.".into(),
            ));
        }
    }
    let began = Instant::now();
    loop {
        let ended = !running.pid.is_some_and(alive) && answering(places).await.is_none();
        if ended {
            return Ok(());
        }
        if began.elapsed() > STOPS_WITHIN {
            return Err(Failure::Broken(format!(
                "Banda's engine did not stop within {} s.",
                STOPS_WITHIN.as_secs()
            )));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// How many Agents are working now: Threads whose latest turn runs, in
/// every Project.
async fn working(client: &mut Client) -> Result<usize, Failure> {
    let projects = client
        .ask("projects.list", None, CommandId::new(), json!({}))
        .await?;
    let mut working = 0;
    for project in projects.as_array().into_iter().flatten() {
        if project["missing"] == true {
            continue;
        }
        let Some(id) = project["id"].as_str().and_then(|id| id.parse().ok()) else {
            continue;
        };
        let Ok(threads) =
            (client.ask("agents.threads", Some(id), CommandId::new(), json!({}))).await
        else {
            continue;
        };
        working += (threads["threads"].as_array().into_iter().flatten())
            .filter(|thread| thread["latest"]["state"] == "running")
            .count();
    }
    Ok(working)
}

/// The question Quit asks when Agents are working (decision 3).
pub fn question(working: usize) -> String {
    match working {
        1 => "An Agent is working. Stop it and quit?".to_owned(),
        n => format!("{n} Agents are working. Stop them and quit?"),
    }
}

/// Asks the Person in the terminal whether to stop `working` Agents; with
/// no terminal to ask in, refuses, saying how to stop them anyway.
fn agreed(working: usize) -> Result<bool, Failure> {
    if !std::io::stdin().is_terminal() {
        return Err(Failure::Refused(Refusal::conflict(format!(
            "{} Nothing was stopped: banda stop --force stops them.",
            question(working)
        ))));
    }
    eprint!("{} [y/N] ", question(working));
    let _ = std::io::stderr().flush();
    let mut answer = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut answer)
        .map_err(Failure::broken)?;
    Ok(matches!(answer.trim(), "y" | "Y" | "yes" | "Yes"))
}

/// Whether process `pid` runs: one that ended and waits for its parent to
/// hear it, a zombie, does not.
#[cfg(target_os = "linux")]
fn alive(pid: u32) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    // `pid (name) state …`: the name may hold anything, a `)` too.
    let state = stat
        .rsplit_once(')')
        .and_then(|(_, rest)| rest.trim().chars().next());
    !matches!(state, Some('Z' | 'X') | None)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn alive(pid: u32) -> bool {
    let Some(pid) = i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
    else {
        return false;
    };
    rustix::process::test_kill_process(pid).is_ok()
}

#[cfg(not(unix))]
fn alive(_: u32) -> bool {
    false
}

/// SIGTERM to the engine's process: it stops as it does on Quit.
#[cfg(unix)]
fn terminate(pid: u32) -> Result<(), Failure> {
    use rustix::process::{Pid, Signal, kill_process};
    let pid = i32::try_from(pid)
        .ok()
        .and_then(Pid::from_raw)
        .ok_or_else(|| Failure::broken("engine.json names no process"))?;
    kill_process(pid, Signal::TERM)
        .map_err(|error| Failure::Broken(format!("Banda's engine did not stop: {error}")))
}

#[cfg(not(unix))]
fn terminate(_: u32) -> Result<(), Failure> {
    Err(Failure::broken("banda stop needs a Unix system."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_asks_in_plain_words_how_many_agents_work() {
        assert_eq!(question(1), "An Agent is working. Stop it and quit?");
        assert_eq!(question(2), "2 Agents are working. Stop them and quit?");
    }

    #[test]
    fn status_says_what_the_engine_says_of_itself() {
        let running = Running {
            protocol: 1,
            port: 4100,
            secret: "never said".into(),
            build: Some("16da2821".into()),
            version: Some("0.3.0".into()),
            since: Some(1_794_000_000_000),
            pid: Some(42),
            unit: Some("banda-engine".into()),
        };
        let line = said(&running);
        assert_eq!(
            line,
            json!({
                "running": true, "version": "0.3.0", "build": "16da2821",
                "since": 1_794_000_000_000_i64, "pid": 42, "unit": "banda-engine",
            })
        );
        assert!(!line.to_string().contains("never said"), "no secret");
    }
}
