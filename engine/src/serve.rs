//! `banda serve`: the one engine of this machine (ADR 0001, decision 1).
//! It opens the Projects under the root with their modules and serves the API
//! on this machine only.

use crate::Failure;
use crate::places::{HOST, Places, Running, channel, from_checkout};
use banda_agents::{Agents, Pipe};
use banda_browser::Browser;
use banda_files::Files;
use banda_git::Git;
use banda_harnesses::{Harnesses, HarnessesModule};
use banda_kernel::api::{self, OwnerSecret};
use banda_kernel::{Kernel, PROTOCOL};
use banda_problems::Problems;
use banda_pulls::Pulls;
use banda_sharing::{Never, Sharing};
use banda_terminal::Terminals;
use banda_workspaces::Workspaces;
use std::fs::{File, TryLockError};
use std::io::Read;

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
    let owner = places.owner().map_err(Failure::broken)?;
    let harnesses = Harnesses::load(&places.harnesses()).map_err(Failure::broken)?;
    let listener = tokio::net::TcpListener::bind((HOST, port))
        .await
        .map_err(Failure::broken)?;
    // A secret for this run of the engine: whoever has it is the owner.
    let running = Running {
        protocol: PROTOCOL,
        port: listener.local_addr().map_err(Failure::broken)?.port(),
        secret: banda_kernel::secret().map_err(Failure::broken)?,
    };
    // Every Thread's session reaches the engine through this program's
    // `banda mcp` (ADR 0019).
    let pipe = Pipe {
        program: std::env::current_exe().map_err(Failure::broken)?,
        engine: running.url(),
    };
    let kernel = Kernel::builder(&places.root, &places.data, owner)
        .machine(places.machine())
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
        // decision 8).
        .module(Files::new().config_in(places.config.clone()))
        .module(Pulls::new())
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
    let app = api::router(kernel, identity, engine);
    places.announce(&running).map_err(Failure::broken)?;
    if with_parent {
        // And where the window listens for `banda menu` and says its
        // browser's endpoint, so the CLI and the window find them the
        // same way.
        let mut line = serde_json::to_value(&running).map_err(Failure::broken)?;
        line["window"] = places.window().display().to_string().into();
        line["browser"] = places.browser().display().to_string().into();
        println!("{line}");
    }
    tracing::info!(port = running.port, root = %places.root.display(), "the engine serves");

    let served = axum::serve(listener, app)
        .with_graceful_shutdown(stopped(with_parent))
        .await;
    places.withdraw();
    drop(lock);
    served.map_err(Failure::broken)
}

async fn stopped(with_parent: bool) {
    // A plain thread reads stdin: a blocking read cannot be cancelled, and
    // the runtime would wait for it on the way out.
    let parent = async move {
        if !with_parent {
            return std::future::pending().await;
        }
        let (gone, parent_gone) = tokio::sync::oneshot::channel::<()>();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin();
            let mut sink = [0u8; 256];
            while matches!(stdin.read(&mut sink), Ok(n) if n > 0) {}
            let _ = gone.send(());
        });
        let _ = parent_gone.await;
    };
    #[cfg(unix)]
    let terminated = async {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                term.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminated = std::future::pending::<()>();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = terminated => {}
        () = parent => {}
    }
    tracing::info!("the engine stops");
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
