//! The engine's life as its clients see it (ADR 0086, decisions 1 and 3):
//! every command that reaches the engine starts it when none answers,
//! `banda start` does only that, and `banda stop` is Quit Banda.
//! `banda status`, which says whether it runs, starts nothing
//! (`status.rs`).
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
//! (`BANDA_OVER_SSH`, ADR 0081, decision 4). It starts the engine as the
//! session's service, as a window here does ([`Starts`]): on a Mac its
//! launchd job, in the gui domain of the Person logged in at the screen,
//! locked or not, so the engine runs in the screen's session with their
//! sign-ins, as if started there (ADR 0086, plan step 7c;
//! `service/launchd.rs`), and a job that does not start is said, never
//! served as that window's child. Where the engine would be that window's
//! child off Linux (a Mac with nobody logged in at its screen, or
//! `BANDA_ENGINE_AS` or Banda Local there; Windows, with no service for it
//! yet), it only follows the engine that runs here, and starts none: a
//! child would live only as long as the link, in the ssh session's
//! environment, and a window opened here meanwhile would follow it and
//! lose it, with its Agents, as the link drops. While no engine runs where
//! it starts none, and once that engine stops as asked, or the Mac's job
//! stops as the Person logs out at its screen, it exits 75
//! (`Failure::Later`): that window tries again, and sees this machine once
//! Banda runs here.

use crate::client::Client;
use crate::places::{Places, Running};
use crate::run::{self, Before};
use crate::serve::Serving;
use crate::service::launchd::{self, Launchctl, Launchd};
use crate::service::{self, Manager, Service, User, Way, Why};
use crate::{Failure, build_id, parent, serve};
use banda_kernel::{Code, CommandId, ENGINE_VARIABLE, Refusal};
use serde_json::json;
use std::fs::{File, TryLockError};
use std::io::{BufRead, IsTerminal, Write};
use std::time::{Duration, Instant};

/// Set by another machine's window on the `banda start --with-parent` it
/// runs here over ssh (`client/desktop/src/hosts.ts`).
pub(crate) const OVER_SSH_VARIABLE: &str = "BANDA_OVER_SSH";

/// What `banda start --with-parent` may start when no engine answers, as
/// [`starts`] says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Starts {
    /// What a window here starts: the session's service, else the engine
    /// as its child. Another machine's window on Linux does the same.
    AsHere,
    /// The session's service alone, never the engine as the window's
    /// child: another machine's window on a Mac, which starts the launchd
    /// job.
    OnlyService,
    /// Nothing: it only follows the engine that runs here, as another
    /// machine's window does where the engine would be its child, off
    /// Linux.
    Nothing,
}

/// What `banda start --with-parent` may start for a window here, or for
/// another machine's (`over_ssh`), where this Banda runs its engine `way`
/// (see the module's words).
pub fn starts(way: Way, over_ssh: bool) -> Starts {
    match way {
        _ if !over_ssh || cfg!(target_os = "linux") => Starts::AsHere,
        Way::Service(_) => Starts::OnlyService,
        Way::Child(_) => Starts::Nothing,
    }
}

/// Whether another machine's window runs this, over ssh: `BANDA_OVER_SSH`
/// says so.
pub fn over_ssh_here() -> bool {
    std::env::var_os(OVER_SSH_VARIABLE).is_some_and(|set| !set.is_empty())
}

/// What another machine's window hears while no engine runs here where it
/// starts none, as this Banda runs its engine `way`: on a Mac with nobody
/// logged in at its screen, that; else that none runs.
fn not_open(way: Way) -> Failure {
    let words = match way {
        Way::Child(Why::NoScreen) => {
            "Nobody is logged in at this Mac's screen: Banda's engine starts here once someone is, \
             and another machine sees this one's Agents then."
        }
        _ => {
            "Banda's engine is not running here: another machine sees this one's Agents while it \
             runs."
        }
    };
    Failure::Later(words.into())
}

/// How long another machine's window, on a Mac, looks for the Person's gui
/// domain to go once the engine's job stopped as asked: launchd stops the
/// job as the Person logs out too, and takes the domain away then.
const LOGS_OUT_WITHIN: Duration = Duration::from_secs(10);

/// How long `banda stop`, and the window's follower, wait for the engine
/// to go: past its own timeout to stop its Harnesses (`TimeoutStopSec`),
/// after which systemd kills what is left.
const STOPS_WITHIN: Duration = Duration::from_secs(20);

/// How long a client waits for the engine `engine.json` names to say
/// welcome: one that takes connections and does not answer is none.
pub(crate) const ANSWERS_WITHIN: Duration = Duration::from_secs(3);

/// Says that no engine answers where `engine.json` says one listens.
pub(crate) const NOWHERE: &str = "Banda's engine does not answer. Start it with: banda serve";

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
pub(crate) async fn answering(places: &Places) -> Result<(Running, Client), Failure> {
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
/// runs. With `with_parent`, for the window, here or over ssh, what it
/// `starts`: see the module's words.
pub async fn start(
    places: Places,
    with_parent: bool,
    way: Way,
    starts: Starts,
) -> Result<(), Failure> {
    let only = with_parent && starts == Starts::Nothing;
    let found = match (answering(&places).await, way) {
        (Ok(found), _) => found,
        (Err(refused @ Failure::Refused(_)), _) => return Err(refused),
        (Err(_), _) if only => return Err(not_open(way)),
        (Err(_), Way::Service(service)) => match started(&places, service).await {
            Ok(found) => found,
            // The window still gets an engine: its own child, this once;
            // never another machine's window.
            Err(failed @ Failure::Broken(_)) if with_parent && starts == Starts::AsHere => {
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
        let session = || Launchctl.session();
        return follow(&places, found, starts, way, session).await;
    }
    println!("{}", crate::status::said(&found.0));
    Ok(())
}

/// Prints where the engine listens, as `serve --with-parent` does, and
/// follows it until the window goes, or until it stops: then it says
/// whether it stopped as asked ([`left_as_asked`]), or must be started
/// again.
async fn follow(
    places: &Places,
    (running, client): (Running, Client),
    starts: Starts,
    way: Way,
    session: impl Fn() -> bool,
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
        Before::Left(_) => left_as_asked(starts, way, session, LOGS_OUT_WITHIN).await,
        _ => Err(Failure::Broken(
            "Banda's engine stopped without being asked to: the window starts it again.".into(),
        )),
    }
}

/// What the follower says of an engine that stopped as asked, by what it
/// `starts`: Banda quits, and the window with it; where it starts none, it
/// is a Banda no longer open here (`way`); on a Mac, for another machine's
/// window, it is a Person who logged out at the screen when their gui
/// domain (`session`) goes `within` a while, and Banda quit at the Mac
/// otherwise.
async fn left_as_asked(
    starts: Starts,
    way: Way,
    session: impl Fn() -> bool,
    within: Duration,
) -> Result<(), Failure> {
    match starts {
        Starts::AsHere => Ok(()),
        Starts::Nothing => Err(not_open(way)),
        Starts::OnlyService if logged_out(session, within).await => {
            Err(not_open(Way::Child(Why::NoScreen)))
        }
        Starts::OnlyService => Ok(()),
    }
}

/// Whether the Person's gui domain goes (`session`) within `within`, as it
/// does as they log out.
async fn logged_out(session: impl Fn() -> bool, within: Duration) -> bool {
    let began = Instant::now();
    loop {
        if !session() {
            return true;
        }
        if began.elapsed() >= within {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
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
    use std::path::Path;

    #[test]
    fn quit_asks_in_plain_words_how_many_agents_work() {
        assert_eq!(question(1), "An Agent is working. Stop it and quit?");
        assert_eq!(question(2), "2 Agents are working. Stop them and quit?");
    }

    #[test]
    fn another_machines_window_starts_a_mac_s_job_and_never_a_child_off_linux() {
        let linux = cfg!(target_os = "linux");
        // Whatever made the engine the window's child: on a Mac, nobody
        // logged in at its screen, `BANDA_ENGINE_AS=child` or Banda Local.
        for why in [
            Why::NotYet,
            Why::Asked,
            Why::Checkout,
            Why::NoSystemd,
            Why::NoScreen,
        ] {
            let way = Way::Child(why);
            let over_ssh = if linux {
                Starts::AsHere
            } else {
                Starts::Nothing
            };
            assert_eq!(starts(way, true), over_ssh, "{way:?}");
            assert_eq!(starts(way, false), Starts::AsHere, "{way:?}");
        }
        // A Mac's launchd job, while the Person is logged in at its screen.
        let job = Way::Service(Service::Job);
        let over_ssh = if linux {
            Starts::AsHere
        } else {
            Starts::OnlyService
        };
        assert_eq!(starts(job, true), over_ssh);
        assert_eq!(starts(job, false), Starts::AsHere);
        let unit = Way::Service(Service::Unit { version: 257 });
        assert_eq!(starts(unit, false), Starts::AsHere);
        if linux {
            assert_eq!(starts(unit, true), Starts::AsHere, "Linux as before");
        }
    }

    #[tokio::test]
    async fn over_ssh_where_it_starts_none_it_says_later_and_why() {
        async fn later(base: &Path, way: Way) -> String {
            let started = start(Places::under(base), true, way, Starts::Nothing).await;
            let Err(Failure::Later(words)) = started else {
                panic!("it should say: later");
            };
            words
        }
        let base = tempfile::tempdir().unwrap();
        let words = later(base.path(), Way::Child(Why::NotYet)).await;
        assert!(
            words.starts_with("Banda's engine is not running here"),
            "{words}"
        );
        let words = later(base.path(), Way::Child(Why::NoScreen)).await;
        assert!(
            words.starts_with("Nobody is logged in at this Mac's screen"),
            "{words}"
        );
        // No engine served here: it took no lock, and wrote no state.
        assert!(!base.path().join("state").exists());
    }

    /// Off macOS no launchctl answers, so the job never starts.
    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn over_ssh_a_mac_s_job_that_does_not_start_is_said_never_served_as_that_window_s_child()
    {
        let base = tempfile::tempdir().unwrap();
        let places = || Places::under(base.path());
        let job = Way::Service(Service::Job);
        let started = start(places(), true, job, Starts::OnlyService).await;
        let Err(Failure::Broken(words)) = started else {
            panic!("it should say the job did not start");
        };
        assert!(words.starts_with("launchd did not start"), "{words}");
        // No engine served here: none announced, and no run begun.
        assert!(!places().state.join("engine.json").exists());
        assert!(!places().run().exists());
        assert!(!places().lock().exists());
    }

    #[tokio::test]
    async fn an_engine_stopped_as_asked_quits_the_window_unless_the_mac_s_person_logged_out() {
        let way = Way::Child(Why::NotYet);
        let within = Duration::from_millis(600);
        let never = || -> bool { panic!("launchd is asked nothing") };
        assert!(
            left_as_asked(Starts::AsHere, way, never, within)
                .await
                .is_ok()
        );
        let Err(Failure::Later(words)) = left_as_asked(Starts::Nothing, way, never, within).await
        else {
            panic!("a Banda no longer open here");
        };
        assert!(words.starts_with("Banda's engine is not running here"));

        // Quit at the Mac: the Person's gui domain stays.
        let stays = left_as_asked(Starts::OnlyService, way, || true, within).await;
        assert!(stays.is_ok());
        // Logged out there: it goes, at once or a moment later.
        let Err(Failure::Later(words)) =
            left_as_asked(Starts::OnlyService, way, || false, within).await
        else {
            panic!("logged out: later");
        };
        assert!(words.starts_with("Nobody is logged in at this Mac's screen"));
        let looks = std::sync::atomic::AtomicU32::new(0);
        let goes = || looks.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 1;
        let went = left_as_asked(Starts::OnlyService, way, goes, within).await;
        assert!(matches!(went, Err(Failure::Later(_))));
    }
}
