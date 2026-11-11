//! A look at a channel's releases, served by a fake GitHub: what the
//! module takes, and what it refuses.

use axum::Router;
use axum::extract::{Path as Url, State};
use axum::routing::get;
use banda_machines::TakeUpdates;
use banda_updates::{Banda, Updates, feed};
use base64::Engine as _;
use sha2::{Digest, Sha512};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

/// What the fake GitHub serves: the releases' list, and their files.
#[derive(Clone, Default)]
struct Served {
    releases: String,
    files: HashMap<String, Vec<u8>>,
}

/// Serves `served` from `listener`.
fn serve(listener: tokio::net::TcpListener, served: Served) {
    let app = Router::new()
        .route(
            "/releases",
            get(|State(s): State<Arc<Served>>| async move { s.releases.clone() }),
        )
        .route(
            "/files/{name}",
            get(
                |State(s): State<Arc<Served>>, Url(name): Url<String>| async move {
                    s.files.get(&name).cloned().unwrap_or_default()
                },
            ),
        )
        .with_state(Arc::new(served));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
}

/// A bundle whose `banda` says `says`, as scripts/engine.mjs packs one.
fn bundle(says: &str) -> Vec<u8> {
    let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    let mut add = |name: &str, body: &[u8], mode: u32| {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(mode);
        header.set_cksum();
        tar.append_data(&mut header, name, body).unwrap();
    };
    add(
        "banda",
        format!("#!/bin/sh\necho '{says}'\n").as_bytes(),
        0o755,
    );
    add("adapters/claude-agent-acp.mjs", b"", 0o644);
    add("adapters/codex-acp.mjs", b"", 0o644);
    add("LICENSE", b"Apache-2.0", 0o644);
    tar.into_inner().unwrap().finish().unwrap()
}

fn sha512(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
}

/// A Dev's release with its engine feed and bundle, as release.yml
/// publishes one, into `served`: its feed names `sha`, or the bundle's own.
fn publish(
    served: &mut Served,
    at: &str,
    version: &str,
    body: Vec<u8>,
    sha: Option<&str>,
) -> String {
    let (os, arch) = feed::system().unwrap();
    let name = feed::bundle_name("banda-dev", version, os, arch);
    let feed_name = feed::feed_name(feed::Which::Dev, os);
    let feed_file = format!("{version}-{feed_name}");
    let text = format!(
        "version: {version}\nfiles:\n  - url: {name}\n    sha512: {}\n    size: {}\npath: {name}\n",
        sha.map_or_else(|| sha512(&body), str::to_owned),
        body.len()
    );
    served.files.insert(feed_file.clone(), text.into_bytes());
    served.files.insert(name.clone(), body);
    format!(
        r#"{{"tag_name":"v{version}","name":"Banda Dev {version}","draft":false,"prerelease":true,"assets":[
            {{"name":"{feed_name}","state":"uploaded","browser_download_url":"{at}/files/{feed_file}"}},
            {{"name":"{name}","state":"uploaded","browser_download_url":"{at}/files/{name}"}}]}}"#
    )
}

struct Machine {
    updates: Updates,
    engine: PathBuf,
    _folder: tempfile::TempDir,
}

/// The fake GitHub's address is only known once it listens: `releases`
/// makes the list from it.
async fn machine_running(
    channel: &'static str,
    version: &str,
    releases: impl FnOnce(&str, &mut Served) -> String,
    program: impl FnOnce(&Path) -> Option<PathBuf>,
) -> Machine {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let at = format!("http://{}", listener.local_addr().unwrap());
    let mut served = Served::default();
    served.releases = releases(&at, &mut served);
    serve(listener, served);
    let folder = tempfile::tempdir().unwrap();
    let engine = folder.path().join("engine");
    let banda = Banda {
        channel,
        folder: "banda-dev",
        version: version.to_owned(),
        program: program(folder.path()),
        engine: engine.clone(),
    };
    let (_, take) = watch::channel(TakeUpdates::WhenIdle);
    let updates = Updates::new(banda, take).reading(
        &at,
        Duration::from_secs(3600),
        Duration::from_secs(3600),
    );
    Machine {
        updates,
        engine,
        _folder: folder,
    }
}

#[tokio::test]
async fn the_newest_engine_is_taken_checked_and_put_in_place() {
    let machine = machine_running(
        "dev",
        "0.1.0-dev.10",
        |at, served| {
            let newest = publish(
                served,
                at,
                "0.1.0-dev.12",
                bundle("banda 0.1.0-dev.12 (build b)"),
                None,
            );
            let older = publish(
                served,
                at,
                "0.1.0-dev.11",
                bundle("banda 0.1.0-dev.11 (build a)"),
                None,
            );
            format!("[{newest},{older}]")
        },
        |_| None,
    )
    .await;
    let state = machine.updates.look().await;
    assert_eq!(state.failed, None, "{state:?}");
    assert_eq!(state.newest.as_deref(), Some("0.1.0-dev.12"));
    assert_eq!(state.ready.as_deref(), Some("0.1.0-dev.12"));
    assert_eq!(state.taking, None);
    assert!(state.looked.is_some());
    let kept = machine.engine.join("0.1.0-dev.12");
    assert!(kept.join("banda").is_file());
    assert!(kept.join("adapters/codex-acp.mjs").is_file());
    assert_eq!(
        std::fs::read_to_string(kept.join("version")).unwrap(),
        "banda 0.1.0-dev.12 (build b)\n"
    );
    // Nothing half made is left beside it, and a look again takes nothing.
    let names: Vec<_> = std::fs::read_dir(&machine.engine)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(names, ["0.1.0-dev.12"]);
    let again = machine.updates.look().await;
    assert_eq!(again.ready.as_deref(), Some("0.1.0-dev.12"));
}

#[tokio::test]
async fn a_bundle_that_is_not_what_its_feed_names_is_refused() {
    let machine = machine_running(
        "dev",
        "0.1.0-dev.10",
        |at, served| {
            let wrong = sha512(b"another file");
            let one = publish(
                served,
                at,
                "0.1.0-dev.12",
                bundle("banda 0.1.0-dev.12 (build b)"),
                Some(&wrong),
            );
            format!("[{one}]")
        },
        |_| None,
    )
    .await;
    let state = machine.updates.look().await;
    let failed = state.failed.unwrap();
    assert!(failed.contains("SHA-512"), "{failed}");
    assert_eq!(state.ready, None);
    assert_eq!(take_left(&machine.engine), Vec::<String>::new());
}

#[tokio::test]
async fn an_engine_that_says_another_version_is_refused() {
    let machine = machine_running(
        "dev",
        "0.1.0-dev.10",
        |at, served| {
            let one = publish(
                served,
                at,
                "0.1.0-dev.12",
                bundle("banda 0.1.0-dev.9 (build z)"),
                None,
            );
            format!("[{one}]")
        },
        |_| None,
    )
    .await;
    let state = machine.updates.look().await;
    let failed = state.failed.unwrap();
    assert!(failed.contains("not 0.1.0-dev.12"), "{failed}");
    assert_eq!(take_left(&machine.engine), Vec::<String>::new());
}

#[tokio::test]
async fn nothing_newer_takes_nothing() {
    let machine = machine_running(
        "dev",
        "0.1.0-dev.12",
        |at, served| {
            let one = publish(
                served,
                at,
                "0.1.0-dev.12",
                bundle("banda 0.1.0-dev.12 (build b)"),
                None,
            );
            format!("[{one}]")
        },
        |_| None,
    )
    .await;
    let state = machine.updates.look().await;
    assert_eq!(state.newest.as_deref(), Some("0.1.0-dev.12"));
    assert_eq!((state.ready, state.failed), (None, None));
}

#[tokio::test]
async fn a_package_managers_banda_and_a_checkouts_take_nothing() {
    let managed = machine_running(
        "dev",
        "0.1.0-dev.10",
        |_, _| "[]".to_owned(),
        |folder| {
            let program = folder.join("opt/banda");
            std::fs::create_dir_all(program.parent().unwrap()).unwrap();
            std::fs::write(folder.join("opt/package-type"), "pacman\n").unwrap();
            Some(program)
        },
    )
    .await;
    let state = managed.updates.look().await;
    assert_eq!(state.off.as_deref(), Some("pacman updates Banda here"));
    assert_eq!(state.looked, None, "it looks at nothing");

    let local = machine_running("local", "0.1.0-local", |_, _| "[]".to_owned(), |_| None).await;
    let state = local.updates.look().await;
    assert!(state.off.unwrap().contains("checkout"));
}

/// What a take left in `engine`, but whole copies.
fn take_left(engine: &Path) -> Vec<String> {
    std::fs::read_dir(engine)
        .map(|read| {
            read.flatten()
                .map(|e| e.file_name().into_string().unwrap())
                .collect()
        })
        .unwrap_or_default()
}
