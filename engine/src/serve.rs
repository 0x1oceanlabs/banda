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

use crate::apps::{self, HostContext};
use crate::places::{FOLDER, HOST, Places, Running, from_checkout};
use crate::run::{self, Before, Left, Run};
use crate::service;
use crate::{Failure, build_id, parent};
use banda_agents::Pipe;
use banda_harnesses::Harnesses;
use banda_harnesses::carried::{Carried, Here};
use banda_kernel::api::{self, OwnerSecret};
use banda_kernel::{Kernel, PROTOCOL};
use std::fs::{File, TryLockError};
use std::path::Path;

/// Runs until a signal, or until stdin closes when `with_parent` is set: a
/// window that starts the engine holds its stdin, and reads where the
/// engine listens from its first line of output.
pub async fn serve(places: Places, port: u16, with_parent: bool) -> Result<(), Failure> {
    std::fs::create_dir_all(&places.state).map_err(Failure::broken)?;
    let lock = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(places.lock())
        .map_err(Failure::broken)?;
    match lock.try_lock() {
        Ok(()) => {}
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
        unit: own_unit(),
        pid_ns: crate::places::pid_ns(),
    };
    // Every Thread's session reaches the engine through this program's
    // `banda mcp` (ADR 0019).
    let pipe = Pipe {
        program,
        engine: running.url(),
    };
    let builder = Kernel::builder(&places.root, &places.data, owner)
        .machine(places.machine())
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
    places.withdraw();
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

/// Raises the soft limit on open files to the hard one, as a window's
/// child had it from Electron: a user manager's units start at 1024, too
/// few for the builds and watchers of the Agents' shells.
#[cfg(target_os = "linux")]
fn open_files() {
    use rustix::process::{Resource, getrlimit, setrlimit};
    let mut limit = getrlimit(Resource::Nofile);
    if limit.current < limit.maximum {
        limit.current = limit.maximum;
        if let Err(error) = setrlimit(Resource::Nofile, limit) {
            tracing::warn!(%error, "the engine keeps its limit on open files");
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn open_files() {}

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
