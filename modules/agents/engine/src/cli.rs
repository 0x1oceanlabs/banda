//! The Person's own CLI that a Harness's adapter runs instead of a copy of
//! its own (ADR 0003, decision 3): Claude Code's `claude`, Codex's `codex`.
//! Each time the Harness starts, the engine finds the CLI and asks its
//! version; a CLI that is not there stops the start, so Bandaso never runs
//! a bundled one in its place.

use crate::model::CliView;
use crate::settings::Harness;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::timeout;

/// How long a CLI may take to say its version.
const ASKING: Duration = Duration::from_secs(5);

/// Finds the CLI `harness` names, and the version it says. The entry it
/// returns sets the adapter's variable to the CLI's path.
pub async fn find(harness: &Harness) -> Result<(Harness, Option<CliView>), String> {
    let Some(cli) = &harness.cli else {
        return Ok((harness.clone(), None));
    };
    let path = located(&cli.program).ok_or_else(|| {
        format!(
            "{} runs `{}`, which is not installed on this computer: install it, then check again.",
            harness.name, cli.program
        )
    })?;
    let path = path.display().to_string();
    let version = version_of(&path, harness).await;
    let mut started = harness.clone();
    started.env.insert(cli.variable.clone(), path.clone());
    Ok((started, Some(CliView { path, version })))
}

/// `program` itself when it is a path, or the first of that name on PATH.
fn located(program: &str) -> Option<PathBuf> {
    if program.contains('/') {
        return runnable(Path::new(program)).then(|| PathBuf::from(program));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|folder| folder.join(program))
        .find(|candidate| runnable(candidate))
}

fn runnable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

async fn version_of(path: &str, harness: &Harness) -> Option<String> {
    let asked = tokio::process::Command::new(path)
        .arg("--version")
        .envs(&harness.env)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let said = timeout(ASKING, asked).await.ok()?.ok()?;
    version_in(&String::from_utf8_lossy(&said.stdout))
}

/// The first word of `said` that reads as a version: `2.1.316` in
/// "2.1.316 (Claude Code)", `0.166.0` in "codex-cli 0.166.0".
fn version_in(said: &str) -> Option<String> {
    said.split_whitespace()
        .map(|word| word.trim_start_matches('v'))
        .find(|word| {
            word.starts_with(|c: char| c.is_ascii_digit())
                && word.contains('.')
                && word
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
        })
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::version_in;

    #[test]
    fn a_version_is_the_first_word_that_reads_as_one() {
        assert_eq!(
            version_in("2.1.316 (Claude Code)\n").as_deref(),
            Some("2.1.316")
        );
        assert_eq!(version_in("codex-cli 0.166.0").as_deref(), Some("0.166.0"));
        assert_eq!(version_in("tool v1.2").as_deref(), Some("1.2"));
        assert_eq!(version_in("no version here"), None);
    }
}
