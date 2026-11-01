//! `bandaso serve`: the one engine of this machine (ADR 0001, decision 1).
//! It opens the Spaces under the root with their modules and serves the API
//! on this machine only.

use crate::Failure;
use crate::places::{HOST, Places, Running};
use bandaso_agents::Agents;
use bandaso_agents::settings::Harnesses;
use bandaso_kernel::api::{self, OwnerSecret};
use bandaso_kernel::{Kernel, PROTOCOL};
use bandaso_terminal::Terminals;
use std::fs::{File, TryLockError};
use std::io::Read;

/// A secret for this run of the engine: whoever has it is the owner.
fn secret() -> Result<String, Failure> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(Failure::broken)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

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
                "Bandaso's engine already runs with this state folder.",
            ));
        }
        Err(TryLockError::Error(error)) => return Err(Failure::broken(error)),
    }
    let owner = places.owner().map_err(Failure::broken)?;
    let harnesses = Harnesses::load(&places.harnesses()).map_err(Failure::broken)?;
    let kernel = Kernel::builder(&places.root, owner)
        .module(Agents::new(harnesses))
        .module(Terminals::new())
        .open()
        .await
        .map_err(Failure::broken)?;
    let listener = tokio::net::TcpListener::bind((HOST, port))
        .await
        .map_err(Failure::broken)?;
    let running = Running {
        protocol: PROTOCOL,
        port: listener.local_addr().map_err(Failure::broken)?.port(),
        secret: secret()?,
    };
    let identity = OwnerSecret {
        secret: running.secret.clone(),
        owner,
    };
    let engine = format!("bandaso {}", env!("CARGO_PKG_VERSION"));
    let app = api::router(kernel, identity, engine);
    places.announce(&running).map_err(Failure::broken)?;
    if with_parent {
        let line = serde_json::to_string(&running).map_err(Failure::broken)?;
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
