//! `banda serve`: the one engine of this machine (ADR 0001, decision 1).
//! It opens the Projects under the root with their modules and serves the API
//! on this machine only.
//!
//! It knows how the run before left (`run.rs`), and keeps a crash as a
//! Problem before it opens anything. It is whole before clients find it:
//! an `engine.json` it finds is the run before's, and goes at once; it
//! opens every Project, with its modules' migrations and the outbox's
//! recovery, and only then says where it listens, in `engine.json`. It
//! listens on the port the run before did when that is free, so the
//! address its Agents' passes name stays across a restart (ADR 0086,
//! decision 1; ADR 0083, decision 2). Asked to stop, as it opens too, it
//! says so at once; as it stops, it keeps its sessions' passes for the
//! next run, and says that it stopped.
//!
//! As macOS's launchd job (`service/launchd.rs`) it stops with exit 0,
//! which launchd leaves stopped, where another engine holds its state's
//! lock, and where it started again after a crash three times within a
//! minute. On macOS it keeps its job's plist where "Start Banda at login"
//! says, the job or not.
//!
//! While its Agents work, and while plugged in if the Person says so, it
//! keeps its machine from idle sleep, until it stops (ADR 0097).

use crate::apps::{self, HostContext};
use crate::places::{FOLDER, HOST, Places, Running, from_checkout};
use crate::run::{self, Before, Left, Run};
use crate::service::{self, launchd};
use crate::{Failure, build_id, parent};
use banda_agents::Pipe;
use banda_harnesses::Harnesses;
use banda_harnesses::carried::{Carried, Here};
use banda_kernel::api::{self, OwnerSecret};
use banda_kernel::{Kernel, PROTOCOL, Working};
use banda_machines::Machine;
use std::fs::{File, TryLockError};
use std::path::Path;

/// How an engine serves, by what started it.
#[derive(Debug, Default)]
pub struct Serving {
    /// The port on 127.0.0.1; 0 takes the one it listened on last.
    pub port: u16,
    /// For a window that starts it: it runs until its stdin closes, and
    /// prints where it listens on its first line.
    pub with_parent: bool,
    /// Why it is the window's child, not the session's service, which
    /// `banda status` says.
    pub child: Option<String>,
    /// Whether it is macOS's launchd job (`launchd::begin`).
    pub job: bool,
}

impl Serving {
    /// The window's child, for the reason `why`.
    pub fn child(why: impl Into<String>) -> Serving {
        Serving {
            with_parent: true,
            child: Some(why.into()),
            ..Serving::default()
        }
    }
}

/// Runs until a signal, or until stdin closes when `with_parent` is set: a
/// window that starts the engine holds its stdin, and reads where the
/// engine listens from its first line of output.
pub async fn serve(places: Places, serving: Serving) -> Result<(), Failure> {
    let Serving {
        port,
        with_parent,
        child,
        job,
    } = serving;
    std::fs::create_dir_all(&places.state).map_err(Failure::broken)?;
    let lock = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(places.lock())
        .map_err(Failure::broken)?;
    match lock.try_lock() {
        Ok(()) => {}
        // launchd would start it again and again while the other runs.
        Err(TryLockError::WouldBlock) if job => {
            tracing::warn!(
                "another engine runs with this state folder: this launchd job stops, and \
                 launchd leaves it stopped"
            );
            return Ok(());
        }
        Err(TryLockError::WouldBlock) => {
            return Err(Failure::broken(
                "Banda's engine already runs with this state folder.",
            ));
        }
        Err(TryLockError::Error(error)) => return Err(Failure::broken(error)),
    }
    let (before, last_port) = run::before(&places);
    // Whatever `engine.json` says now, the run before said: no client
    // waits on an engine that is still opening.
    places.withdraw();
    match before {
        Before::Crashed => {
            tracing::warn!(
                "the engine's last run ended without stopping: it crashed, or was killed"
            );
            run::keep_crash(&places);
        }
        Before::Left(left) => tracing::info!(?left, "the engine's last run left"),
        Before::None => {}
    }
    // launchd puts no limit on starts, as systemd's unit has. Counted
    // first, so a start that crashes in what follows counts too.
    let gives_up = before == Before::Crashed
        && job
        && run::crash_starts(&places, banda_kernel::now_ms()) >= run::CRASH_STARTS;
    // What a run that did not say it stopped left running goes before
    // this one starts anything, the one that gives up too; on Linux the
    // unit stopped it already.
    #[cfg(target_os = "macos")]
    crate::children::stop_left(&places, before).await;
    if gives_up {
        tracing::error!(
            "the engine started again after a crash {} times within a minute: this launchd \
             job stops, and the next client starts it",
            run::CRASH_STARTS
        );
        return Ok(());
    }
    open_files();
    let owner = places.owner().map_err(Failure::broken)?;
    // Banda's own git finds no hooks in an empty folder of its state on
    // Windows, never in `\dev\null` on the current drive (ADR 0090,
    // decision 3).
    #[cfg(windows)]
    banda_git_cli::no_hooks_in(&places.state.join("no-hooks")).map_err(Failure::broken)?;
    let program = std::env::current_exe().map_err(Failure::broken)?;
    let harnesses = Harnesses::load(&places.harnesses()).map_err(Failure::broken)?;
    let listener = listen(port, last_port).await?;
    let port = listener.local_addr().map_err(Failure::broken)?.port();
    let run = Run::began(&places, port);
    // Whether the fence holds here, found once (ADR 0083), before the
    // engine runs any program of its own on the host.
    let environment = crate::fence::environment(&places).await;
    let kept = environment.kept();
    // Each Harness's and Terminal's program noted while it runs, for the
    // next engine to stop should this one crash.
    #[cfg(target_os = "macos")]
    let (environment, noting) = crate::children::noted(environment, &places);
    harnesses.carry(carried(&program));
    // Heard from here on: a TERM as the engine opens, or as soon as it
    // says where it listens, stops it as any other does, not by the
    // signal's default.
    #[cfg(unix)]
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    #[cfg(not(unix))]
    let mut term = None::<()>;
    // A secret for this run of the engine: whoever has it is the owner.
    let running = Running {
        protocol: PROTOCOL,
        port,
        secret: banda_kernel::secret().map_err(Failure::broken)?,
        build: build_id::own(),
        version: Some(env!("BANDA_VERSION").to_owned()),
        since: Some(banda_kernel::now_ms()),
        pid: Some(std::process::id()),
        unit: own_unit().or_else(|| job.then(|| launchd::label_of(&places))),
        child,
        pid_ns: crate::places::pid_ns(),
    };
    // Every Thread's session reaches the engine through this program's
    // `banda mcp` (ADR 0019).
    let pipe = Pipe {
        program,
        engine: running.url(),
    };
    // What this machine is called and drawn by: found once, as it is,
    // and named over that by its machine.toml.
    let machine = Machine::new(&places.config, banda_machines::found().await);
    // A child too, so a plist left in LaunchAgents goes as the setting
    // goes off.
    if cfg!(target_os = "macos") {
        launchd::follow_login(&places, machine.starts_at_login());
    }
    // The Turns that run, which hold the machine awake as machine.toml
    // says; the system lets the hold go too, should the engine crash.
    let working = Working::new();
    let awake = banda_machines::awake::keep(working.count(), machine.awake());
    let builder = Kernel::builder(&places.root, &places.data, owner)
        .machine(places.machine())
        .named(machine.named())
        // Every Project's programs run on this host, as the Person's own
        // do (ADR 0084), a Harness's behind the fence where it holds (ADR
        // 0083).
        .environment(environment)
        .passes(places.passes());
    // Every engine part in the list of Apps (ADR 0062, decision 11).
    let host = HostContext {
        places: &places,
        harnesses: &harnesses,
        pipe: &pipe,
        kept: &kept,
        machine: &machine,
        working: &working,
    };
    let opening = apps::serve(builder, &host).open();
    let kernel = tokio::select! {
        opened = opening => opened.map_err(Failure::broken)?,
        () = terminated(&mut term) => {
            tracing::info!("the engine stops as it opens");
            run.left(Left::Stopping);
            return Ok(());
        }
    };
    let identity = OwnerSecret {
        secret: running.secret.clone(),
        owner,
    };
    let engine = format!("banda {}", env!("BANDA_VERSION"));
    let app = api::router(kernel.clone(), identity, engine);
    // Whole now: clients may find it.
    places.announce(&running).map_err(Failure::broken)?;
    if with_parent {
        // And where the window listens for `banda menu`, so the CLI and
        // the window find it the same way.
        let mut line = serde_json::to_value(&running).map_err(Failure::broken)?;
        line["window"] = places.window().display().to_string().into();
        println!("{line}");
    }
    tracing::info!(port = running.port, root = %places.root.display(), "the engine serves");

    let asked = run.clone();
    let stop = async move {
        stopped(with_parent, term).await;
        // Asked to stop: what ends it from here on ends it as asked.
        asked.left(Left::Stopping);
    };
    let served = axum::serve(listener, app)
        .with_graceful_shutdown(stop)
        .await;
    kernel.stopping();
    drop(awake);
    places.withdraw();
    // Before the lock goes, as the next engine may take it at once.
    #[cfg(target_os = "macos")]
    drop(noting);
    run.left(Left::Stopped);
    drop(lock);
    served.map_err(Failure::broken)
}

#[cfg(unix)]
type Term = Option<tokio::signal::unix::Signal>;
#[cfg(not(unix))]
type Term = Option<()>;

/// Listens on `port`, or when it is 0, on the port the run before did when
/// it is free, else on any.
async fn listen(port: u16, last: Option<u16>) -> Result<tokio::net::TcpListener, Failure> {
    if port == 0
        && let Some(last) = last
    {
        match tokio::net::TcpListener::bind((HOST, last)).await {
            Ok(listener) => return Ok(listener),
            Err(error) => tracing::info!(last, %error, "the engine listens on another port"),
        }
    }
    tokio::net::TcpListener::bind((HOST, port))
        .await
        .map_err(Failure::broken)
}

/// The unit this engine runs as, when it is the session's service.
fn own_unit() -> Option<String> {
    if cfg!(target_os = "linux") {
        service::own_unit(&service::User)
    } else {
        None
    }
}

/// Raises the soft limit on open files to the most [`open_files_most`]
/// allows, as a window's child had it from Electron: a user manager's
/// units start at 1024, and launchd's jobs at 256, too few for the builds
/// and watchers of the Agents' shells.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_files() {
    use rustix::process::{Resource, getrlimit, setrlimit};
    let mut limit = getrlimit(Resource::Nofile);
    let most = open_files_most(limit.maximum);
    if limit.current < most {
        limit.current = most;
        if let Err(error) = setrlimit(Resource::Nofile, limit) {
            tracing::warn!(%error, "the engine keeps its limit on open files");
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn open_files() {}

/// The most open files the engine takes, by the hard limit `maximum`
/// (none: no limit): all of it on Linux; on macOS, where a launchd job has
/// no hard limit and the system refuses more than its own, at most
/// `OPEN_MAX`, which every Mac allows.
#[cfg_attr(
    not(any(target_os = "linux", target_os = "macos")),
    expect(dead_code, reason = "Windows has no such limit")
)]
fn open_files_most(maximum: Option<u64>) -> Option<u64> {
    const OPEN_MAX: u64 = 10_240;
    if cfg!(target_os = "macos") {
        Some(maximum.map_or(OPEN_MAX, |maximum| maximum.min(OPEN_MAX)))
    } else {
        maximum
    }
}

/// Returns once TERM comes; never where it is not heard.
#[cfg(unix)]
async fn terminated(term: &mut Term) {
    match term {
        Some(term) => {
            term.recv().await;
        }
        None => std::future::pending().await,
    }
}

#[cfg(not(unix))]
async fn terminated(_: &mut Term) {
    std::future::pending().await
}

async fn stopped(with_parent: bool, mut term: Term) {
    let parent = async move {
        if !with_parent {
            return std::future::pending().await;
        }
        let (gone, parent_gone) = tokio::sync::oneshot::channel::<()>();
        parent::on_gone(move || {
            let _ = gone.send(());
        });
        let _ = parent_gone.await;
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = terminated(&mut term) => {}
        () = parent => {}
    }
    tracing::info!("the engine stops");
}

/// The adapters Banda carries and the Node to run them on, as this host
/// has them beside the engine's `program`, in its checkout or on its PATH
/// (ADR 0059; ADR 0062, step S1): an engine started in a shell, with no
/// window, runs Banda's own Harness entries through them too.
fn carried(program: &Path) -> Option<Carried> {
    // Where it is, through any link it was started by, as macOS names
    // it: the app's resources or the engine's own copy.
    let program = dunce::canonicalize(program).unwrap_or_else(|_| program.to_owned());
    let here = Here {
        program: &program,
        app: FOLDER,
        checkout: from_checkout(),
    };
    let carried = Carried::find(&here);
    match &carried {
        Some(Carried { adapters, node }) => tracing::info!(
            adapters = %adapters.display(),
            node = %node.program.display(),
            "Banda's own Harnesses start through the adapters it carries"
        ),
        None => tracing::warn!(
            "this host has no Node or no adapters Banda carries: its own Harnesses start through npx"
        ),
    }
    carried
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A job's [`Serving`].
    fn job() -> Serving {
        Serving {
            job: true,
            ..Serving::default()
        }
    }

    #[tokio::test]
    async fn a_launchd_job_whose_state_another_engine_holds_stops_cleanly() {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        std::fs::create_dir_all(&places.state).unwrap();
        let held = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(places.lock())
            .unwrap();
        held.try_lock().unwrap();
        // launchd leaves a job that exited 0 stopped.
        assert!(serve(Places::under(base.path()), job()).await.is_ok());
        let said = serve(Places::under(base.path()), Serving::default()).await;
        let words = said.expect_err("not the job: it says so").words();
        assert!(words.contains("already runs"), "{words}");
        assert!(places.running().is_err(), "neither announced itself");
    }

    #[tokio::test]
    async fn a_launchd_job_started_again_after_a_crash_a_third_time_in_a_minute_stops() {
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        std::fs::create_dir_all(&places.state).unwrap();
        // A run that never said it stopped, after two starts after a crash.
        Run::began(&places, 4100);
        let now = banda_kernel::now_ms();
        run::crash_starts(&places, now - 20_000);
        run::crash_starts(&places, now - 10_000);
        assert!(serve(Places::under(base.path()), job()).await.is_ok());
        assert!(places.running().is_err(), "it opened nothing");
        assert_eq!(run::before(&places).0, Before::Crashed, "as it was");
        let starts = std::fs::read_to_string(run::crash_starts_file(&places)).unwrap();
        assert_eq!(
            starts.matches(',').count(),
            2,
            "this start counted: {starts}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn what_a_crashed_run_left_is_stopped_on_macos_before_its_job_stops_trying() {
        use banda_kernel::{Environment, Holes, Input, Program};
        use rustix::process::{Pid, Signal, WaitOptions, kill_process, waitpid};
        let base = tempfile::tempdir().unwrap();
        let places = Places::under(base.path());
        // A Harness's program the run before noted, and never let go of.
        let (environment, noting) = crate::children::noted(banda_environments::Local, &places);
        let sleep = Program::harness("sleep", vec!["300".to_owned()], Holes::default());
        let started = environment.spawn(&sleep, Input::Null).unwrap();
        let pid = Pid::from_raw(i32::try_from(started.id().unwrap()).unwrap()).unwrap();
        std::mem::forget(started);
        drop(noting);
        // That run crashed, after two starts after a crash.
        Run::began(&places, 4100);
        let now = banda_kernel::now_ms();
        run::crash_starts(&places, now - 20_000);
        run::crash_starts(&places, now - 10_000);
        assert!(serve(Places::under(base.path()), job()).await.is_ok());
        let ended = matches!(waitpid(Some(pid), WaitOptions::NOHANG), Ok(Some(_)));
        // On Linux the engine's unit stops it, not the engine.
        assert_eq!(ended, cfg!(target_os = "macos"));
        if !ended {
            kill_process(pid, Signal::KILL).unwrap();
            waitpid(Some(pid), WaitOptions::empty()).unwrap();
        }
    }
}
