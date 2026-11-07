//! `banda serve`: the one engine of this machine (ADR 0001, decision 1).
//! It opens the Projects under the root with their modules and serves the API
//! on this machine only.
//!
//! It knows how the run before left (`run.rs`), and keeps a crash as a
//! Problem before it opens anything. It is whole before it listens: it
//! opens every Project, with its modules' migrations and the outbox's
//! recovery, and only then says where it listens, in `engine.json`. It
//! listens on the port the run before did when that is free, so the
//! address its Agents' passes name stays across a restart (ADR 0086,
//! decision 1; ADR 0083, decision 2). As it stops, it keeps its sessions'
//! passes for the next run, and says that it stopped.

use crate::places::{FOLDER, HOST, Places, Running, channel, from_checkout};
use crate::run::{self, Before, Left};
use crate::service::UNIT_VARIABLE;
use crate::{Failure, build_id, parent};
use banda_agents::{Agents, Pipe};
use banda_browser::Browser;
use banda_environments::Local;
use banda_files::Files;
use banda_git::Git;
use banda_harnesses::carried::{Carried, Here};
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::api::{self, OwnerSecret};
use banda_kernel::{Kernel, PROTOCOL};
use banda_keys::KeysModule;
use banda_problems::Problems;
use banda_pulls::Pulls;
use banda_sharing::{Never, Sharing};
use banda_terminal::Terminals;
use banda_workspaces::Workspaces;
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
    let owner = places.owner().map_err(Failure::broken)?;
    let program = std::env::current_exe().map_err(Failure::broken)?;
    let harnesses = Harnesses::load(&places.harnesses()).map_err(Failure::broken)?;
    harnesses.carry(carried(&program));
    let listener = listen(port, last_port).await?;
    // A secret for this run of the engine: whoever has it is the owner.
    let running = Running {
        protocol: PROTOCOL,
        port: listener.local_addr().map_err(Failure::broken)?.port(),
        secret: banda_kernel::secret().map_err(Failure::broken)?,
        build: build_id::own(),
        version: Some(env!("BANDA_VERSION").to_owned()),
        since: Some(banda_kernel::now_ms()),
        pid: Some(std::process::id()),
        unit: std::env::var(UNIT_VARIABLE)
            .ok()
            .filter(|unit| !unit.is_empty()),
    };
    // Every Thread's session reaches the engine through this program's
    // `banda mcp` (ADR 0019).
    let pipe = Pipe {
        program,
        engine: running.url(),
    };
    let kernel = Kernel::builder(&places.root, &places.data, owner)
        .machine(places.machine())
        // Every Project's programs run on this host, as the Person's own
        // do (ADR 0084).
        .environment(Local)
        .passes(places.passes())
        .module(
            Agents::new(harnesses.clone())
                .config_in(places.config.clone())
                .piped(pipe),
        )
        // One list, which both read again as its file changes.
        .module(HarnessesModule::new(harnesses))
        .module(Terminals::new())
        .module(Browser::new())
        .module(Git::new())
        // Banda's settings are the settings Pane's to write (ADR 0073,
        // decision 8); files' small pictures are kept in Banda's cache,
        // and freedesktop's (step F6).
        .module(
            Files::new()
                .config_in(places.config.clone())
                .thumbs_in(places.thumbnails(), banda_files::thumb::shared_from_env()),
        )
        .module(Pulls::new())
        // Banda's keys, which an Agent binds for its Person (ADR 0071).
        .module(KeysModule::new(places.config.clone()))
        .module(Workspaces::new())
        .module(problems(&places))
        .module(sharing(&places))
        .open()
        .await
        .map_err(Failure::broken)?;
    let identity = OwnerSecret {
        secret: running.secret.clone(),
        owner,
    };
    let engine = format!("banda {}", env!("BANDA_VERSION"));
    let app = api::router(kernel.clone(), identity, engine);
    // Heard from here on: a TERM that comes as soon as the first line is
    // out stops the engine as any other does, not by the signal's default.
    #[cfg(unix)]
    let term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    #[cfg(not(unix))]
    let term = None::<()>;
    // Whole now: clients may find it.
    places.announce(&running).map_err(Failure::broken)?;
    let since = running.since.unwrap_or_default();
    if let Err(error) = run::began(&places, since, running.port) {
        tracing::error!(%error, "the engine could not say that it runs");
    }
    if with_parent {
        // And where the window listens for `banda menu`, so the CLI and
        // the window find it the same way.
        let mut line = serde_json::to_value(&running).map_err(Failure::broken)?;
        line["window"] = places.window().display().to_string().into();
        println!("{line}");
    }
    tracing::info!(port = running.port, root = %places.root.display(), "the engine serves");

    let served = axum::serve(listener, app)
        .with_graceful_shutdown(stopped(with_parent, term))
        .await;
    kernel.stopping();
    places.withdraw();
    if let Err(error) = run::left(&places, since, running.port, Left::Stopped) {
        tracing::error!(%error, "the engine could not say that it stopped");
    }
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

async fn stopped(with_parent: bool, term: Term) {
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
    #[cfg(unix)]
    let terminated = async move {
        match term {
            Some(mut term) => {
                term.recv().await;
            }
            None => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminated = {
        let _ = term;
        std::future::pending::<()>()
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = terminated => {}
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
    let program = program
        .canonicalize()
        .unwrap_or_else(|_| program.to_owned());
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

/// What broke in Banda (ADR 0039), and, from a checkout's build, the
/// checkout an Agent fixes it in.
fn problems(places: &Places) -> Problems {
    let problems = Problems::new(places.problems(), places.logs());
    if from_checkout() {
        problems.from_checkout()
    } else {
        problems
    }
}

/// The one part of Banda that sends anything (ADR 0039, decision 4): never
/// from a checkout's build, as in CI and the tests, nor with
/// `BANDA_SHARING=0`.
fn sharing(places: &Places) -> Sharing {
    let sharing = Sharing::new(&places.config, &places.state).channel(channel());
    if from_checkout() {
        sharing.never(Never::Checkout)
    } else if std::env::var_os("BANDA_SHARING").is_some_and(|off| off == "0") {
        sharing.never(Never::Run)
    } else {
        sharing
    }
}
