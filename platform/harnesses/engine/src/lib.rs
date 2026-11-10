//! The Harnesses of this computer (ADR 0040): the agent programs
//! `harnesses.toml` lists, how to find and start each, who is signed in to
//! it, and the pool of their processes; and the machine's module
//! `harnesses`, which a window asks about them ([`HarnessesModule`]). A
//! Thread runs on one, but this crate knows nothing of Threads: the agents
//! module builds on it, and never the other way.

use banda_kernel::{Code, Refusal};

pub mod accounts;
pub mod acp;
pub mod carried;
pub mod cli;
pub mod github;
pub mod hosts;
mod limits;
mod list;
pub mod model;
mod module;
mod record;
mod serving;
mod shadow;

pub use accounts::account_changed;
pub use list::{Cli, Credentials, FILE, Harness, Harnesses, LimitsSettings};
pub use module::{HarnessesModule, LimitsNow, SETTINGS};

pub mod usage;

/// Why a Harness did not do what it was asked, in words for a Person, and
/// whether asking again may go otherwise. A command's receipt keeps only a
/// refusal that lasts, so a resend after one that may pass runs again
/// (ADR 0082, decision 4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failed {
    /// A state that lasts until someone changes it: a CLI that is not
    /// installed, an ACP version Banda does not speak, a Harness that does
    /// not sign out from Banda. Refused as `conflict`.
    Lasting(String),
    /// What may pass: a process that did not start or stopped as it
    /// started, an answer that took too long, a file not written, an error
    /// the Harness answered. Refused as `internal`.
    Passing(String),
}

impl std::fmt::Display for Failed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Failed::Lasting(words) | Failed::Passing(words) => f.write_str(words),
        }
    }
}

impl From<Failed> for Refusal {
    fn from(failed: Failed) -> Self {
        match failed {
            Failed::Lasting(words) => Refusal::conflict(words),
            Failed::Passing(words) => Refusal::new(Code::Internal, words),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_lasting_failure_is_kept_on_a_receipt() {
        let lasting = Refusal::from(Failed::Lasting("Not installed.".into()));
        assert_eq!(lasting, Refusal::conflict("Not installed."));
        assert!(lasting.code.is_final());
        let passing = Refusal::from(Failed::Passing("Took too long.".into()));
        assert_eq!(passing, Refusal::new(Code::Internal, "Took too long."));
        assert!(!passing.code.is_final(), "a resend runs again");
    }
}
