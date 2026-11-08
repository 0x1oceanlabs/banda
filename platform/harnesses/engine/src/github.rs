//! The Person's GitHub token, for the Harnesses' programs of a Project
//! the Person said they trust (ADR 0083): `gh` keeps it in the system's
//! keyring, which the fence keeps out of their reach, so it goes to them
//! as `GH_TOKEN`. A Project's programs get no GitHub token in any other,
//! not even one in the engine's own environment ([`credentials`]).
//!
//! It is read where gh keeps it, with no `gh` run on Linux
//! ([`banda_kernel::gh`]), and kept a while: a Harness that starts again
//! gets the same, and a read that fails keeps the last.

use crate::Credentials;
use banda_kernel::gh::GITHUB;

/// The variable `gh` and GitHub's tools read a token from.
pub const VARIABLE: &str = "GH_TOKEN";

/// Every variable `gh` and git's helpers read a GitHub token from.
const VARIABLES: [&str; 4] = [
    VARIABLE,
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
];

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
    banda_kernel::gh::token(GITHUB).await
}

/// Keeps `token` as if `gh` had said it now: for a test, on a machine
/// whose `gh` says what it says.
pub fn keep(token: Option<String>) {
    banda_kernel::gh::keep(GITHUB, token);
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
