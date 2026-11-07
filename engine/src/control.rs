//! The engine's life as its clients see it (ADR 0086, decisions 1 and 3):
//! every command that reaches the engine starts it when none answers,
//! `banda start` does only that, `banda status` says whether it runs, since
//! when and its build, and `banda stop` is Quit Banda.
//!
//! The window runs `banda start --with-parent`: it prints where the engine
//! listens, as `serve --with-parent` does, then follows the engine until
//! the window goes, which leaves the engine running, or until the engine
//! stops. It exits 0 when the engine said it was asked to stop, as Quit
//! Banda asks it, so the window quits too; otherwise the window starts it
//! again. Where the engine is the window's child (`service.rs`), or its
//! unit does not start, it serves the engine itself.

use crate::client::Client;
use crate::places::{Places, Running};
use crate::run::{self, Before};
use crate::service::{self, Systemd, User, Way, Why};
use crate::{Failure, build_id, parent, serve};
use banda_kernel::{Code, CommandId, ENGINE_VARIABLE, Refusal};
use serde_json::{Value, json};
use std::fs::{File, TryLockError};
use std::io::{BufRead, IsTerminal, Write};
use std::time::{Duration, Instant};

/// How long `banda stop`, and the window's follower, wait for the engine
/// to go: past its own timeout to stop its Harnesses (`TimeoutStopSec`),
/// after which systemd kills what is left.
const STOPS_WITHIN: Duration = Duration::from_secs(20);

/// How long a client waits for the engine `engine.json` names to say
/// welcome: one that takes connections and does not answer is none.
const ANSWERS_WITHIN: Duration = Duration::from_secs(3);

/// Says that no engine answers where `engine.json` says one listens.
const NOWHERE: &str = "Banda's engine does not answer. Start it with: banda serve";

/// A client of the running engine, as its owner: one that answers, or else
/// one this starts as the session's service where it runs as one. Where
/// the engine is the window's child, a client says that none runs, as
/// before.
pub async fn connect(places: &Places) -> Result<Client, Failure> {
    let none = match answering(places).await {
        Ok((_, client)) => return Ok(client),
        Err(refused @ Failure::Refused(_)) => return Err(refused),
        Err(none) => none,
    };
    match service::way_here(&User) {
        Way::Service { version } => Ok(started(places, version, &User).await?.1),
        Way::Child(_) => Err(none),
    }
}

/// The running engine and a client of it as its owner, when one answers
/// within [`ANSWERS_WITHIN`]; else why not: none runs, none answers, or
/// it refused, as one of another build that does not speak this program's
/// protocol does, which says so.
async fn answering(places: &Places) -> Result<(Running, Client), Failure> {
    let running = places.running()?;
    let url = running.url();
    let hello = Client::hello(&url, running.secret.clone(), NOWHERE);
    match tokio::time::timeout(ANSWERS_WITHIN, hello).await {
        Ok(Ok(client)) => Ok((running, client)),
        Ok(Err(Failure::Refused(refusal))) if refusal.code == Code::Protocol => {
            Err(Failure::Refused(Refusal::new(
                Code::Protocol,
                format!(
                    "Banda's engine of another build runs: {} Quit Banda, or run banda stop, \
                     and the next start is this build's.",
                    refusal.message
                ),
            )))
        }
        Ok(Err(failed)) => Err(failed),
        Err(_) => Err(Failure::broken(NOWHERE)),
    }
}

/// Starts the engine as the session's service, and returns once it
/// answers, with a client of it.
async fn started(
    places: &Places,
    version: u32,
    systemd: &dyn Systemd,
) -> Result<(Running, Client), Failure> {
    let program = std::env::current_exe().map_err(Failure::broken)?;
    let unit = service::unit(places, program, version, systemd).await;
    tracing::info!(unit = %unit.name, "Banda's engine starts as the session's service");
    service::start(systemd, &unit, || answering(places)).await
}

/// `banda start`: starts the engine when none answers, and says how it
/// runs. With `with_parent`, for the window: see the module's words.
pub async fn start(places: Places, with_parent: bool, way: Way) -> Result<(), Failure> {
    let found = match (answering(&places).await, way) {
        (Ok(found), _) => found,
        (Err(refused @ Failure::Refused(_)), _) => return Err(refused),
        (Err(_), Way::Service { version }) => match started(&places, version, &User).await {
            Ok(found) => found,
            // The window still gets an engine: its own child, this once.
            Err(failed @ Failure::Broken(_)) if with_parent => {
                tracing::warn!(
                    "{} The engine runs as the window's child this time, and stops with it; \
                     its log is the window's.",
                    failed.words()
                );
                banda_problems::catch_panics(places.problems());
                return serve::serve(places, 0, true).await;
            }
            Err(failed) => return Err(failed),
        },
        (Err(_), Way::Child(why)) if with_parent => {
            match why {
                Why::NoSystemd => tracing::warn!(
                    "{}: the engine runs as the window's child, and stops with it",
                    why.words()
                ),
                _ => tracing::info!("the engine runs as the window's child: {}", why.words()),
            }
            return serve::serve(places, 0, true).await;
        }
        (Err(_), Way::Child(why)) => {
            return Err(Failure::Broken(format!(
                "Banda's engine is the window's child here ({}): open Banda, or start it with: banda serve",
                why.words()
            )));
        }
    };
    if with_parent {
        return follow(&places, found).await;
    }
    println!("{}", said(&found.0));
    Ok(())
}

/// Prints where the engine listens, as `serve --with-parent` does, and
/// follows it until the window goes, or until it stops: then it says
/// whether it stopped as asked, or must be started again.
async fn follow(places: &Places, (running, client): (Running, Client)) -> Result<(), Failure> {
    let own = build_id::own();
    if running.build.is_some() && own.is_some() && running.build != own {
        tracing::warn!(
            running = ?running.build,
            own = ?own,
            "the engine that runs is another build than this window's: it runs until Banda quits"
        );
    }
    let mut line = serde_json::to_value(&running).map_err(Failure::broken)?;
    line["window"] = places.window().display().to_string().into();
    println!("{line}");
    let _ = std::io::stdout().flush();
    let (gone, window_gone) = tokio::sync::oneshot::channel::<()>();
    parent::on_gone(move || {
        let _ = gone.send(());
    });
    tokio::select! {
        // The window went: the engine goes on.
        _ = window_gone => return Ok(()),
        () = client.closed() => {}
    }
    // It says it is stopping as soon as it is asked to, and may take as
    // long as systemd gives it to stop its Harnesses.
    let began = Instant::now();
    while running.pid.is_some_and(alive) && began.elapsed() < STOPS_WITHIN {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    match run::before(places).0 {
        Before::Left(_) => Ok(()),
        _ => Err(Failure::Broken(
            "Banda's engine stopped without being asked to: the window starts it again.".into(),
        )),
    }
}

/// `banda status`: whether the engine runs, since when, and its build, as
/// one JSON line. It starts nothing. An engine of another build, which
/// this program cannot speak with, runs too.
pub async fn status(places: &Places) -> Result<(), Failure> {
    let line = match answering(places).await {
        Ok((running, _)) => said(&running),
        Err(Failure::Refused(refusal)) if refusal.code == Code::Protocol => {
            said(&places.running()?)
        }
        Err(refused @ Failure::Refused(_)) => return Err(refused),
        Err(_) => json!({ "running": false }),
    };
    println!("{line}");
    Ok(())
}

/// What `banda status` says of a running engine.
fn said(running: &Running) -> Value {
    let mut line = json!({ "running": true, "protocol": running.protocol });
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
/// An engine that does not answer, hung or still opening, is stopped
/// without asking.
pub async fn stop(places: &Places, force: bool) -> Result<(), Failure> {
    if std::env::var_os(ENGINE_VARIABLE).is_some_and(|set| !set.is_empty()) {
        return Err(Failure::Refused(Refusal::forbidden(format!(
            "Only the Person quits Banda: {ENGINE_VARIABLE} says this runs under an Agent's pass. \
             Nothing was stopped."
        ))));
    }
    let systemd = User;
    let Ok((running, mut client)) = answering(places).await else {
        return stop_unanswering(places, &systemd).await;
    };
    if !force {
        let working = working(&mut client).await?;
        if working > 0 && !agreed(working)? {
            return Err(Failure::Broken("Nothing was stopped.".into()));
        }
    }
    drop(client);
    match (&running.unit, running.pid) {
        (Some(unit), _) => stop_unit(&systemd, unit)?,
        (None, Some(pid)) => terminate(pid)?,
        (None, None) => {
            return Err(Failure::Broken(
                "This engine does not say its process: stop it where it was started.".into(),
            ));
        }
    }
    gone(&systemd, running.unit.as_deref(), running.pid).await
}

/// Stops an engine that does not answer: its unit when it runs, else the
/// process `engine.json` names while the engine's lock is held, which
/// only a running engine holds and only it wrote. With neither, none runs.
async fn stop_unanswering(places: &Places, systemd: &dyn Systemd) -> Result<(), Failure> {
    let unit = service::unit_of(places);
    if systemd.runs(&unit) {
        return stop_unit(systemd, &unit);
    }
    let pid = (places.running().ok())
        .and_then(|running| running.pid)
        .filter(|_| locked(places));
    match pid {
        Some(pid) => {
            terminate(pid)?;
            gone(systemd, None, Some(pid)).await
        }
        None => {
            eprintln!("banda: Banda's engine is not running.");
            Ok(())
        }
    }
}

/// Stops the engine's `unit`, and returns once systemd has.
fn stop_unit(systemd: &dyn Systemd, unit: &str) -> Result<(), Failure> {
    (systemd.stop(unit))
        .map_err(|said| Failure::Broken(format!("Banda's engine did not stop: {said}")))
}

/// Waits until the engine's process `pid` and its `unit` have gone.
async fn gone(systemd: &dyn Systemd, unit: Option<&str>, pid: Option<u32>) -> Result<(), Failure> {
    let began = Instant::now();
    while pid.is_some_and(alive) || unit.is_some_and(|unit| systemd.runs(unit)) {
        if began.elapsed() > STOPS_WITHIN {
            return Err(Failure::Broken(format!(
                "Banda's engine did not stop within {} s.",
                STOPS_WITHIN.as_secs()
            )));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}

/// Whether an engine holds the lock of `places`' state.
fn locked(places: &Places) -> bool {
    let Ok(lock) = File::options().write(true).open(places.lock()) else {
        return false;
    };
    matches!(lock.try_lock(), Err(TryLockError::WouldBlock))
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
fn question(working: usize) -> String {
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
                "running": true, "protocol": 1, "version": "0.3.0", "build": "16da2821",
                "since": 1_794_000_000_000_i64, "pid": 42, "unit": "banda-engine",
            })
        );
        assert!(!line.to_string().contains("never said"), "no secret");
        let bare = said(&Running::default());
        assert_eq!(bare, json!({ "running": true, "protocol": 0 }));
    }
}
