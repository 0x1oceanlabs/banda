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
//!
//! Another machine's window runs it here too, over ssh, and says so
//! (`BANDA_OVER_SSH`, ADR 0081, decision 4). On a Mac, until arc may start
//! the Mac's engine over ssh (ADR 0086, plan step 7c), and where the
//! engine is its window's child on a system with no service for it yet
//! (Windows), whatever made it the child (`BANDA_ENGINE_AS`, Banda
//! Local), it then only follows the engine that runs here, and starts
//! none: a child would live only as long as the link, in the ssh session's
//! environment, and a window opened here meanwhile would follow it and
//! lose it, with its Agents, as the link drops. While no engine runs here,
//! and once it stops as asked, it exits 75 (`Failure::Later`): that
//! window tries again, and sees this machine once Banda runs here.

use crate::client::{Client, Pass};
use crate::places::{Places, Running};
use crate::run::{self, Before};
use crate::serve::Serving;
use crate::service::launchd::{self, Launchctl};
use crate::service::{self, Manager, Service, User, Way, Why};
use crate::{Failure, build_id, parent, serve};
use banda_kernel::{Code, CommandId, ENGINE_VARIABLE, Named, PROTOCOL, Refusal};
use banda_machines::Machine;
use serde_json::{Value, json};
use std::fs::{File, TryLockError};
use std::io::{BufRead, IsTerminal, Write};
use std::time::{Duration, Instant};

/// Set by another machine's window on the `banda start --with-parent` it
/// runs here over ssh (`client/desktop/src/hosts.ts`).
pub(crate) const OVER_SSH_VARIABLE: &str = "BANDA_OVER_SSH";

/// Whether `banda start --with-parent` only follows the engine that runs
/// here, and starts none: for another machine's window (`over_ssh`), on a
/// Mac, until step 7c, and where the engine is its window's child and the
/// system has no service for it (see the module's words). On Linux it
/// serves one as before.
fn follows_only(way: Way, over_ssh: bool) -> bool {
    let no_service = matches!(way, Way::Child(_)) && !service::SERVICE_HERE;
    over_ssh && (cfg!(target_os = "macos") || no_service)
}

/// [`follows_only`], as `BANDA_OVER_SSH` says.
pub fn follows_only_here(way: Way) -> bool {
    let over_ssh = std::env::var_os(OVER_SSH_VARIABLE).is_some_and(|set| !set.is_empty());
    follows_only(way, over_ssh)
}

/// What another machine's window hears while no engine runs here: on a
/// Mac, none started at login or by Banda here.
fn not_open() -> Failure {
    Failure::Later(
        "Banda's engine is not running here: another machine sees this one's Agents while it \
         runs."
            .into(),
    )
}

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
    match service::way_here() {
        Way::Service(service) => Ok(started(places, service).await?.1),
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

/// Starts the engine as the session's `service`, and returns once it
/// answers, with a client of it.
async fn started(places: &Places, service: Service) -> Result<(Running, Client), Failure> {
    let program = std::env::current_exe().map_err(Failure::broken)?;
    match service {
        Service::Unit { version } => {
            let unit = service::unit(places, program, version, &User).await;
            tracing::info!(unit = %unit.name, "Banda's engine starts as the session's service");
            service::start(&User, &unit, || answering(places)).await
        }
        Service::Job => {
            let job = launchd::job(places, &program);
            tracing::info!(
                job = %job.label,
                at_login = job.at_login,
                "Banda's engine starts as a launchd job"
            );
            launchd::start(&Launchctl, &job, || answering(places)).await
        }
    }
}

/// `banda start`: starts the engine when none answers, and says how it
/// runs. With `with_parent`, for the window, here or over ssh; `only`
/// when it only follows ([`follows_only`]): see the module's words.
pub async fn start(places: Places, with_parent: bool, way: Way, only: bool) -> Result<(), Failure> {
    let only = with_parent && only;
    let found = match (answering(&places).await, way) {
        (Ok(found), _) => found,
        (Err(refused @ Failure::Refused(_)), _) => return Err(refused),
        (Err(_), _) if only => return Err(not_open()),
        (Err(_), Way::Service(service)) => match started(&places, service).await {
            Ok(found) => found,
            // The window still gets an engine: its own child, this once.
            Err(failed @ Failure::Broken(_)) if with_parent => {
                let why = failed.words();
                tracing::warn!(
                    "{why} The engine runs as the window's child this time, and stops with it; \
                     its log is the window's."
                );
                banda_problems::catch_panics(places.problems());
                return serve::serve(places, Serving::child(why)).await;
            }
            Err(failed) => return Err(failed),
        },
        (Err(_), Way::Child(why)) if with_parent => {
            match why {
                Why::NoSystemd | Why::NoScreen => tracing::warn!(
                    "{}: the engine runs as the window's child, and stops with it",
                    why.words()
                ),
                _ => tracing::info!("the engine runs as the window's child: {}", why.words()),
            }
            return serve::serve(places, Serving::child(why.words())).await;
        }
        (Err(_), Way::Child(why)) => {
            return Err(Failure::Broken(format!(
                "Banda's engine is the window's child here ({}): open Banda, or start it with: banda serve",
                why.words()
            )));
        }
    };
    if with_parent {
        return follow(&places, found, only).await;
    }
    println!("{}", said(&found.0));
    Ok(())
}

/// Prints where the engine listens, as `serve --with-parent` does, and
/// follows it until the window goes, or until it stops: then it says
/// whether it stopped as asked, or must be started again. When it `only`
/// follows, an engine stopped as asked is a Banda no longer open here.
async fn follow(
    places: &Places,
    (running, client): (Running, Client),
    only: bool,
) -> Result<(), Failure> {
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
        Before::Left(_) if only => Err(not_open()),
        Before::Left(_) => Ok(()),
        _ => Err(Failure::Broken(
            "Banda's engine stopped without being asked to: the window starts it again.".into(),
        )),
    }
}

/// `banda status`: whether the engine runs, since when, its build, and
/// whether the fence around its Harnesses holds as it said in its
/// welcome, as one JSON line. It starts nothing. An engine of another
/// build, which this program cannot speak with, runs too.
///
/// It says what this machine is too, for another machine's Test (ADR
/// 0095, decision 9): the system it runs (`system`), and its own name and
/// icon (`named`), as the engine said them in its welcome, else as
/// `machine.toml` says them over what Banda finds here.
///
/// Under an Agent's pass it says of the engine that gave the pass, what
/// that engine says: behind the fence the file that names where an
/// engine runs, and since when, is hidden, and so may `machine.toml` be.
pub async fn status(places: &Places) -> Result<(), Failure> {
    let pass = Pass::from_env()?.is_some();
    println!("{}", status_line(places, pass).await?);
    Ok(())
}

/// What `banda status` says, under an Agent's pass (`pass`) or not.
async fn status_line(places: &Places, pass: bool) -> Result<Value, Failure> {
    let (line, named) = if pass {
        match tokio::time::timeout(ANSWERS_WITHIN, Client::connect(places)).await {
            Ok(Ok(client)) => (
                fenced(json!({ "running": true, "protocol": PROTOCOL }), &client)?,
                client.named().cloned(),
            ),
            Ok(Err(refused @ Failure::Refused(_))) => return Err(refused),
            _ => (json!({ "running": false }), None),
        }
    } else {
        match answering(places).await {
            Ok((running, client)) => (fenced(said(&running), &client)?, client.named().cloned()),
            Err(Failure::Refused(refusal)) if refusal.code == Code::Protocol => {
                (said(&places.running()?), None)
            }
            Err(refused @ Failure::Refused(_)) => return Err(refused),
            Err(_) => (json!({ "running": false }), None),
        }
    };
    let named = match named {
        None if !pass => Some(named_here(places).await),
        named => named,
    };
    Ok(this_machine(
        line,
        banda_machines::about().system,
        named.as_ref(),
    ))
}

/// This machine's name and icon as `machine.toml` says them over what
/// Banda finds here, as its engine would, starting none.
async fn named_here(places: &Places) -> Named {
    let machine = Machine::new(&places.config, banda_machines::found().await);
    machine.named().borrow().clone()
}

/// `line`, with what this machine is: the `system` it runs, and its own
/// name and icon, `named`, each where there is one.
fn this_machine(mut line: Value, system: Option<String>, named: Option<&Named>) -> Value {
    if let Some(system) = system {
        line["system"] = system.into();
    }
    if let Some(named) = named {
        line["named"] = json!(named);
    }
    line
}

/// `line`, with the fence as the engine said it in its welcome, never as
/// a file says.
fn fenced(mut line: Value, client: &Client) -> Result<Value, Failure> {
    if let Some(fence) = client.fence() {
        line["fence"] = serde_json::to_value(fence).map_err(Failure::broken)?;
    }
    Ok(line)
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
        ("child", running.child.clone().map(Value::from)),
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
    let manager = service::manager();
    let Ok((running, mut client)) = answering(places).await else {
        return stop_unanswering(places, manager).await;
    };
    if !force {
        let working = working(&mut client).await?;
        if working > 0 && !agreed(working)? {
            return Err(Failure::Broken("Nothing was stopped.".into()));
        }
    }
    drop(client);
    match (&running.unit, running.pid) {
        (Some(unit), _) => stop_unit(manager, unit)?,
        (None, Some(pid)) => terminate(&running, pid)?,
        (None, None) => {
            return Err(Failure::Broken(
                "This engine does not say its process: stop it where it was started.".into(),
            ));
        }
    }
    gone(manager, running.unit.as_deref(), running.pid).await
}

/// Stops an engine that does not answer: its unit, or job, when it runs,
/// else the process `engine.json` names while the engine's lock is held,
/// which only a running engine holds and only it wrote. With neither,
/// none runs.
async fn stop_unanswering(places: &Places, manager: &dyn Manager) -> Result<(), Failure> {
    let unit = service::unit_of(places);
    if manager.runs(&unit) {
        return stop_unit(manager, &unit);
    }
    let running = places.running().ok();
    let pid = (running.as_ref())
        .and_then(|running| running.pid)
        .filter(|_| locked(places));
    match (running, pid) {
        (Some(running), Some(pid)) => {
            terminate(&running, pid)?;
            gone(manager, None, Some(pid)).await
        }
        _ => {
            eprintln!("banda: Banda's engine is not running.");
            Ok(())
        }
    }
}

/// Stops the engine's `unit`, or job, and returns once its manager has.
fn stop_unit(manager: &dyn Manager, unit: &str) -> Result<(), Failure> {
    (manager.stop(unit))
        .map_err(|said| Failure::Broken(format!("Banda's engine did not stop: {said}")))
}

/// Waits until the engine's process `pid` and its `unit`, or job, have
/// gone.
async fn gone(manager: &dyn Manager, unit: Option<&str>, pid: Option<u32>) -> Result<(), Failure> {
    let began = Instant::now();
    while pid.is_some_and(alive) || unit.is_some_and(|unit| manager.runs(unit)) {
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

/// SIGTERM to the engine's process: it stops as it does on Quit. Only
/// where its number names it: in the PID namespace it says it ran in, so
/// a `banda` in another, as one behind the fence, never signals whatever
/// has that number there.
#[cfg(unix)]
fn terminate(running: &Running, pid: u32) -> Result<(), Failure> {
    use rustix::process::{Pid, Signal, kill_process};
    if running
        .pid_ns
        .is_some_and(|ns| Some(ns) != crate::places::pid_ns())
    {
        return Err(Failure::Broken(
            "Banda's engine runs where this banda cannot stop it: stop it where it was started."
                .into(),
        ));
    }
    let pid = i32::try_from(pid)
        .ok()
        .and_then(Pid::from_raw)
        .ok_or_else(|| Failure::broken("engine.json names no process"))?;
    kill_process(pid, Signal::TERM)
        .map_err(|error| Failure::Broken(format!("Banda's engine did not stop: {error}")))
}

#[cfg(not(unix))]
fn terminate(_: &Running, _: u32) -> Result<(), Failure> {
    Err(Failure::broken(
        "banda stop is not on Windows yet (ADR 0090, step 10): close the window, or stop \
         `banda serve` where it runs.",
    ))
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
            ..Running::default()
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
        // A window's child where launchd or systemd did not start it says
        // why.
        let child = Running {
            child: Some("launchd did not start Banda's engine".into()),
            ..Running::default()
        };
        assert_eq!(
            said(&child)["child"],
            "launchd did not start Banda's engine"
        );
    }

    #[tokio::test]
    async fn status_says_what_this_machine_is_and_its_own_name_with_no_engine() {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        std::fs::create_dir_all(&places.config).unwrap();
        std::fs::write(
            places.config.join("machine.toml"),
            "name = \"studio\"\nicon = \"tower\"\n",
        )
        .unwrap();
        let Ok(line) = status_line(&places, false).await else {
            panic!("status should say");
        };
        assert_eq!(line["running"], false);
        assert_eq!(line["named"], json!({ "name": "studio", "icon": "tower" }));
        assert_eq!(line["system"], json!(banda_machines::about().system));
        assert!(line["system"].is_string(), "{line}");
        // It started nothing: no engine's state was written.
        assert!(!base.path().join("state").exists());
    }

    #[test]
    fn what_this_machine_is_goes_in_only_where_it_is_known() {
        let named = Named {
            name: "arc".into(),
            icon: banda_kernel::MachineIcon::Server,
        };
        let line = this_machine(
            json!({ "running": true }),
            Some("Arch Linux".into()),
            Some(&named),
        );
        assert_eq!(
            line,
            json!({
                "running": true, "system": "Arch Linux",
                "named": { "name": "arc", "icon": "server" },
            })
        );
        let bare = this_machine(json!({ "running": false }), None, None);
        assert_eq!(
            bare,
            json!({ "running": false }),
            "older readers parse it as before"
        );
    }

    #[test]
    fn only_another_machines_window_off_linux_only_follows() {
        // Whatever made the engine the window's child: on a Mac, also
        // `BANDA_ENGINE_AS=child` and Banda Local.
        let off_linux = !cfg!(target_os = "linux");
        for why in [
            Why::NotYet,
            Why::Asked,
            Why::Checkout,
            Why::NoSystemd,
            Why::NoScreen,
        ] {
            let way = Way::Child(why);
            assert_eq!(follows_only(way, true), off_linux, "{way:?}");
            assert!(!follows_only(way, false), "{way:?}");
        }
        // A Mac's launchd job is started over ssh from step 7c.
        let job = Way::Service(Service::Job);
        assert_eq!(follows_only(job, true), cfg!(target_os = "macos"));
        assert!(!follows_only(job, false));
        let unit = Way::Service(Service::Unit { version: 257 });
        assert_eq!(follows_only(unit, true), cfg!(target_os = "macos"));
    }

    #[tokio::test]
    async fn over_ssh_on_a_mac_with_no_banda_open_it_starts_none_and_says_later() {
        let base = tempfile::tempdir().unwrap();
        let started = start(
            Places::under(base.path()),
            true,
            Way::Child(Why::NotYet),
            true,
        )
        .await;
        let Err(Failure::Later(words)) = started else {
            panic!("it should say: later");
        };
        assert!(
            words.starts_with("Banda's engine is not running here"),
            "{words}"
        );
        // No engine served here: it took no lock, and wrote no state.
        assert!(!base.path().join("state").exists());
    }
}
