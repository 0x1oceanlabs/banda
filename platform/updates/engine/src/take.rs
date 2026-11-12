//! Taking a new engine (ADR 0115, decisions 2 and 5): the bundle a feed
//! names, downloaded, checked by its size and SHA-512, unpacked beside the
//! engine's copies, checked by its own `--version`, and renamed into place
//! as `<engine>/<version>/`, laid out as the window's copy is
//! (`client/desktop/src/program.ts`): `banda`, `adapters/` and `version`.
//! The two newest copies stay, and the one that runs.

use crate::feed::{Feed, Version};
use base64::Engine as _;
use sha2::{Digest, Sha512};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The hosts GitHub sends a release's file from. The engine's HTTPS client
/// follows no redirect (`banda_kernel::https`), so what a request carries
/// goes only to the address it names; a release's download answers with a
/// redirect to its storage, which is followed here, once, and only to
/// these.
const STORAGE: [&str; 3] = [
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

/// How long a copy has to say its version.
const SAYING: Duration = Duration::from_secs(20);

/// An answer of `url`, after GitHub's one redirect to its storage.
pub async fn get(url: &str) -> Result<reqwest::Response, String> {
    let client = banda_kernel::https::client()?;
    let words = |e: reqwest::Error| format!("{url}: {}", banda_kernel::https::cause(&e));
    let response = client.get(url).send().await.map_err(words)?;
    if !response.status().is_redirection() {
        return Ok(response);
    }
    let to = (response.headers().get(reqwest::header::LOCATION))
        .and_then(|to| to.to_str().ok())
        .and_then(|to| reqwest::Url::parse(to).ok())
        .ok_or_else(|| format!("{url} redirects nowhere Banda can read"))?;
    if to.scheme() != "https" || !STORAGE.contains(&to.host_str().unwrap_or_default()) {
        return Err(format!(
            "{url} redirects to {to}, which is not GitHub's storage"
        ));
    }
    let words = |e: reqwest::Error| format!("{to}: {}", banda_kernel::https::cause(&e));
    client.get(to.clone()).send().await.map_err(words)
}

/// Downloads `url`, the file `feed` names, into `into`, telling `share`
/// how much of it came; checks its size and SHA-512.
pub async fn download(
    url: &str,
    feed: &Feed,
    into: &Path,
    mut share: impl FnMut(f64),
) -> Result<(), String> {
    let mut response = get(url).await?;
    if !response.status().is_success() {
        return Err(format!("{} answered {}", feed.file, response.status()));
    }
    let mut file = std::fs::File::create(into).map_err(|e| format!("{}: {e}", into.display()))?;
    let mut hash = Sha512::new();
    let mut came: u64 = 0;
    while let Some(piece) = (response.chunk().await)
        .map_err(|e| format!("{}: {}", feed.file, banda_kernel::https::cause(&e)))?
    {
        came += piece.len() as u64;
        if came > feed.size {
            return Err(format!("{} is longer than its feed says", feed.file));
        }
        hash.update(&piece);
        file.write_all(&piece)
            .map_err(|e| format!("{}: {e}", into.display()))?;
        share(came as f64 / feed.size.max(1) as f64);
    }
    file.sync_all()
        .map_err(|e| format!("{}: {e}", into.display()))?;
    if came != feed.size {
        return Err(format!(
            "{} came short: {came} of {} bytes",
            feed.file, feed.size
        ));
    }
    let sha512 = base64::engine::general_purpose::STANDARD.encode(hash.finalize());
    if sha512 != feed.sha512 {
        return Err(format!(
            "{} is not the file its feed names: its SHA-512 differs",
            feed.file
        ));
    }
    Ok(())
}

/// Unpacks `bundle` into a folder beside the copies in `engine`, checks
/// what it says, and renames it into place: `<engine>/<version>/`. A copy
/// of that version there already is replaced.
pub async fn place(bundle: &Path, engine: &Path, version: &str) -> Result<PathBuf, String> {
    let fresh = engine.join(format!(".{version}.new"));
    let _ = std::fs::remove_dir_all(&fresh);
    std::fs::create_dir_all(&fresh).map_err(|e| format!("{}: {e}", fresh.display()))?;
    let unpacked = {
        let bundle = bundle.to_owned();
        let fresh = fresh.clone();
        tokio::task::spawn_blocking(move || unpack(&bundle, &fresh))
            .await
            .map_err(|e| e.to_string())?
    };
    if let Err(why) = unpacked.and(check(&fresh, version).await) {
        let _ = std::fs::remove_dir_all(&fresh);
        return Err(why);
    }
    let kept = engine.join(version);
    let _ = std::fs::remove_dir_all(&kept);
    std::fs::rename(&fresh, &kept).map_err(|e| format!("{}: {e}", kept.display()))?;
    Ok(kept)
}

/// Unpacks the gzip'd tar `bundle` into `into`. The tar crate keeps every
/// entry inside it, and its modes, so `banda` runs.
fn unpack(bundle: &Path, into: &Path) -> Result<(), String> {
    let file = std::fs::File::open(bundle).map_err(|e| format!("{}: {e}", bundle.display()))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    archive.set_preserve_permissions(true);
    archive
        .unpack(into)
        .map_err(|e| format!("the bundle did not unpack: {e}"))?;
    for needed in [
        "banda",
        "adapters/claude-agent-acp.mjs",
        "adapters/codex-acp.mjs",
    ] {
        if !into.join(needed).is_file() {
            return Err(format!("the bundle has no {needed}"));
        }
    }
    Ok(())
}

/// Runs the copy in `folder` with `--version`: it must say `version`. What
/// it said goes into `version` beside it, as the window's copy keeps it.
async fn check(folder: &Path, version: &str) -> Result<(), String> {
    let program = folder.join("banda");
    let run = tokio::process::Command::new(&program)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = (tokio::time::timeout(SAYING, run).await)
        .map_err(|_| "the new engine did not say its version in time".to_owned())?
        .map_err(|e| format!("the new engine did not run: {e}"))?;
    let said = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if !output.status.success() || !said.starts_with(&format!("banda {version} ")) {
        return Err(format!("the new engine says \"{said}\", not {version}"));
    }
    std::fs::write(folder.join("version"), format!("{said}\n"))
        .map_err(|e| format!("{}: {e}", folder.display()))
}

/// The versions of the copies in `engine`, each whole: a folder named for
/// a version Banda publishes, with its `banda` and `version`. Highest
/// first.
pub fn copies(engine: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(engine) else {
        return Vec::new();
    };
    let mut copies: Vec<String> = read
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| Version::of(name).is_some())
        .filter(|name| engine.join(name).join("banda").is_file())
        .filter(|name| engine.join(name).join("version").is_file())
        .collect();
    copies.sort_by(|a, b| Version::of(b).cmp(&Version::of(a)));
    copies
}

/// Removes the copies past the two newest, but never one in `keep`: the
/// running one, whatever its age, and the one chosen; and what
/// a take that broke off left (`.<version>.new`, `.<version>.tar.gz`).
pub fn prune(engine: &Path, keep: &[&str]) {
    for old in copies(engine).into_iter().skip(2) {
        if !keep.contains(&old.as_str()) {
            let _ = std::fs::remove_dir_all(engine.join(&old));
            tracing::info!(version = %old, "an old copy of the engine went");
        }
    }
    let Ok(read) = std::fs::read_dir(engine) else {
        return;
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && (name.ends_with(".new") || name.ends_with(".tar.gz")) {
            let path = entry.path();
            let _ = std::fs::remove_dir_all(&path).or_else(|_| std::fs::remove_file(&path));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(engine: &Path, version: &str) {
        let folder = engine.join(version);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("banda"), "").unwrap();
        std::fs::write(
            folder.join("version"),
            format!("banda {version} (build x)\n"),
        )
        .unwrap();
    }

    #[test]
    fn the_two_newest_stay_and_the_running_one() {
        let engine = tempfile::tempdir().unwrap();
        for version in ["0.1.0-dev.8", "0.1.0-dev.9", "0.1.0-dev.10", "0.1.0-dev.11"] {
            copy(engine.path(), version);
        }
        std::fs::create_dir_all(engine.path().join(".0.1.0-dev.12.new")).unwrap();
        std::fs::write(engine.path().join(".0.1.0-dev.12.tar.gz"), "").unwrap();
        // Not a copy: half made, or not a version.
        std::fs::create_dir_all(engine.path().join("0.1.0-dev.7")).unwrap();
        prune(engine.path(), &["0.1.0-dev.8"]);
        assert_eq!(
            copies(engine.path()),
            ["0.1.0-dev.11", "0.1.0-dev.10", "0.1.0-dev.8"]
        );
        assert!(!engine.path().join(".0.1.0-dev.12.new").exists());
        assert!(!engine.path().join(".0.1.0-dev.12.tar.gz").exists());
    }
}
