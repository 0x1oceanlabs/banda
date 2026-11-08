//! The Person's GitHub token, for the Harnesses' programs of a Project
//! the Person said they trust (ADR 0083): `gh` keeps it in the system's
//! keyring, which the fence keeps out of their reach, so it goes to them
//! as `GH_TOKEN`. A Project's programs get no GitHub token in any other,
//! not even one in the engine's own environment ([`credentials`]).
//!
//! It is read with the Person's own `gh` on the host, found as the engine
//! finds its own programs ([`banda_kernel::host::own`]), and kept a while:
//! a Harness that starts again gets the same, and a read that fails keeps
//! the last.

use crate::Credentials;
use std::process::ExitStatus;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// The variable `gh` and GitHub's tools read a token from.
pub const VARIABLE: &str = "GH_TOKEN";

/// Every variable `gh` and git's helpers read a GitHub token from.
const VARIABLES: [&str; 4] = [
    VARIABLE,
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
];

/// How long `gh` may take to say it.
const ASKED_WITHIN: Duration = Duration::from_secs(2);

/// How long a token read is kept.
const KEPT_FOR: Duration = Duration::from_secs(10 * 60);

/// How long `gh` saying there is none is kept: the Person may sign in.
const NONE_KEPT_FOR: Duration = Duration::from_secs(30);

static KEPT: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);

/// Whether the log said that there is no `gh`.
static SAID_MISSING: AtomicBool = AtomicBool::new(false);

/// Whether the log said that `gh` gave no token, and why.
static SAID_FAILED: AtomicBool = AtomicBool::new(false);

/// The most of what `gh` says on stderr that the log keeps.
const SAID_AT_MOST: usize = 400;

/// What a Harness's process for a Project gets of the Person's GitHub
/// credentials: their token, where they said they trust the Project, else
/// none.
pub async fn credentials(trust_said: bool) -> Credentials {
    if !trust_said {
        return Credentials {
            unset: VARIABLES.map(str::to_owned).into(),
            ..Credentials::default()
        };
    }
    let set = token().await.map(|token| (VARIABLE.to_owned(), token));
    Credentials {
        set: set.into_iter().collect(),
        ..Credentials::default()
    }
}

/// The token `gh` is signed in with for github.com: none without `gh`,
/// or signed out.
pub async fn token() -> Option<String> {
    let last = KEPT.lock().unwrap().clone();
    if let Some((at, token)) = &last {
        let kept_for = if token.is_some() {
            KEPT_FOR
        } else {
            NONE_KEPT_FOR
        };
        if at.elapsed() < kept_for {
            return token.clone();
        }
    }
    let token = match asked().await {
        Asked::Said(token) => Some(token),
        Asked::Missing => {
            if !SAID_MISSING.swap(true, Ordering::Relaxed) {
                tracing::info!(
                    "there is no gh on the PATH: Agents in a Project the Person trusts have no \
                     GitHub token until gh is installed and signed in"
                );
            }
            None
        }
        Asked::Failed { status, said } => {
            if !SAID_FAILED.swap(true, Ordering::Relaxed) {
                tracing::warn!(
                    %status,
                    said,
                    "gh auth token gave no GitHub token: Agents in a Project the Person trusts \
                     have none until it does"
                );
            }
            None
        }
        // Slow, or the keyring busy a moment: the last one read holds.
        Asked::Silent => last.and_then(|(_, token)| token),
    };
    *KEPT.lock().unwrap() = Some((Instant::now(), token.clone()));
    token
}

/// Keeps `token` as if `gh` had said it now: for a test, on a machine
/// whose `gh` says what it says.
pub fn keep(token: Option<String>) {
    *KEPT.lock().unwrap() = Some((Instant::now(), token));
}

/// What `gh` answered.
enum Asked {
    /// The token.
    Said(String),
    /// There is no `gh`.
    Missing,
    /// It ran, and gave none: signed out, or it failed, as it said.
    Failed { status: ExitStatus, said: String },
    /// Nothing in time, or it did not start.
    Silent,
}

/// Asks `gh` for the token, found as the engine finds its own programs
/// ([`banda_kernel::host::own`]).
async fn asked() -> Asked {
    let Ok(mut asking) = banda_kernel::host::own("gh") else {
        return Asked::Missing;
    };
    asking
        .args(["auth", "token", "--hostname", "github.com"])
        .current_dir("/")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(std::process::Stdio::null());
    let Ok(Ok(output)) = tokio::time::timeout(ASKED_WITHIN, asking.output()).await else {
        return Asked::Silent;
    };
    let token = String::from_utf8(output.stdout).unwrap_or_default();
    let token = token.trim();
    if output.status.success() && !token.is_empty() {
        return Asked::Said(token.to_owned());
    }
    let said = String::from_utf8_lossy(&output.stderr);
    Asked::Failed {
        status: output.status,
        said: said.trim().chars().take(SAID_AT_MOST).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_project_not_said_trusted_starts_without_any_github_token() {
        let untrusted = credentials(false).await;
        assert!(untrusted.set.is_empty());
        for variable in VARIABLES {
            assert!(untrusted.unset.iter().any(|unset| unset == variable));
        }
        keep(Some("t".to_owned()));
        let trusted = credentials(true).await;
        assert_eq!(trusted.set.get(VARIABLE).map(String::as_str), Some("t"));
        assert!(trusted.unset.is_empty());
    }
}
