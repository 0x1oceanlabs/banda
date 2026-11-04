//! The Person's own CLI that a Harness's adapter runs instead of a copy of
//! its own (ADR 0003, decision 3): Claude Code's `claude`, Codex's `codex`.
//! Each time the Harness starts, the engine finds the CLI and asks its
//! version; a CLI that is not there stops the start, so Banda never runs
//! a bundled one in its place. A CLI older than the entry's `minimum` runs,
//! with a warning (ADR 0003, decision 3).

use crate::Harness;
use crate::model::CliView;
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::timeout;

/// How long a CLI may take to say its version.
const ASKING: Duration = Duration::from_secs(5);

/// The version each CLI said, by its path, at the latest look: a fact of
/// this computer, whichever process looked. So a Person who updated it and
/// checked again sees every Thread on it stop warning.
static SAID: Mutex<BTreeMap<String, Option<String>>> = Mutex::new(BTreeMap::new());

/// Where a Harness's CLI was found, and the least version its entry asks
/// for: what tells, at each look, whether it is old.
pub struct Located {
    pub path: String,
    minimum: Option<String>,
}

impl Located {
    pub fn new(path: String, harness: &Harness) -> Self {
        let minimum = harness.cli.as_ref().and_then(|cli| cli.minimum.clone());
        Self { path, minimum }
    }

    /// Why it is old, for the Harness `name`, as the latest look found.
    pub fn outdated(&self, name: &str) -> Option<String> {
        let version = SAID.lock().unwrap().get(&self.path).cloned()??;
        warning(name, &self.path, &version, self.minimum.as_deref()?)
    }
}

/// What a Harness's CLI at `path` that says `version` warns, when it is
/// older than `minimum`.
fn warning(name: &str, path: &str, version: &str, minimum: &str) -> Option<String> {
    older(version, minimum).then(|| {
        let program = Path::new(path).file_name().unwrap_or_default();
        format!(
            "{} {version} is older than {minimum}, which Banda's {name} adapter was built \
             for. It still runs, but some things may not work until you update it.",
            program.display(),
        )
    })
}

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
    SAID.lock().unwrap().insert(path.clone(), version.clone());
    let outdated = Located::new(path.clone(), harness).outdated(&harness.name);
    let mut started = harness.clone();
    started.env.insert(cli.variable.clone(), path.clone());
    let view = CliView {
        path,
        version,
        outdated,
    };
    Ok((started, Some(view)))
}

/// `program` itself when it is a path, or the first of that name on PATH.
pub(crate) fn located(program: &str) -> Option<PathBuf> {
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

/// Whether `version` comes before `minimum`, number by number: 2.1.99
/// before 2.1.312, 2.1 the same as 2.1.0. A leading `v` and what follows
/// `-` or `+`, as in `0.165.0-alpha.3`, are not compared.
fn older(version: &str, minimum: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        let version = version.trim_start_matches('v');
        let release = version.split(['-', '+']).next().unwrap_or_default();
        release
            .split('.')
            .map(|part| {
                let digits = part
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(part.len());
                part[..digits].parse().unwrap_or(0)
            })
            .collect()
    };
    let (version, minimum) = (numbers(version), numbers(minimum));
    let at = |numbers: &[u64], i: usize| numbers.get(i).copied().unwrap_or(0);
    (0..version.len().max(minimum.len()))
        .map(|i| at(&version, i).cmp(&at(&minimum, i)))
        .find(|order| order.is_ne())
        .is_some_and(std::cmp::Ordering::is_lt)
}

#[cfg(test)]
mod tests {
    use super::{older, version_in};

    #[test]
    fn a_version_is_older_number_by_number() {
        assert!(older("2.1.99", "2.1.312"));
        assert!(older("0.164.9", "0.165.0"));
        assert!(!older("2.1", "2.1.0"));
        assert!(older("2.1", "2.1.1"));
        assert!(!older("2.1.312", "2.1.312"));
        assert!(!older("0.165.0-alpha.3", "0.165.0"));
        assert!(older("2.1.311", "v2.1.312"));
        assert!(!older("2.1.316", "2.1.312"));
        assert!(!older("0.166.0", "0.165.0"));
        assert!(!older("3.0.0-beta", "2.9.9"));
    }

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
