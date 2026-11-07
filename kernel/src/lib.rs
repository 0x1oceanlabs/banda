//! The kernel: what every module needs, and nothing that names a module
//! (ADR 0001, decision 3; `docs/architecture.md`).
//!
//! - [`Kernel`] keeps the Projects of this machine and routes each call to
//!   the module that owns it.
//! - [`Project`] is a folder with its own SQLite. One writer thread commits
//!   every change, and events are published only after commit (ADR 0002).
//! - A [`Module`] owns its words, its tables and its events. It reaches its
//!   Project only through a [`ModuleProject`], which can emit only that module's
//!   events.
//! - The outbox runs side effects after commit, in order per target: the
//!   engine's own, and workers' outside it under leases. It settles what a
//!   restart or a lease that ran out cut short, and lets old rows go.
//! - [`access::decide`] is the one place that says whether a Participant may
//!   do something, and [`access::within`] keeps an Agent in its Project.
//! - A pass names an Agent's session in its Project, for `banda mcp`
//!   ([`ModuleProject::pass`]). The host keeps it hashed, so it outlives
//!   an engine restart, until its session ends or it expires.
//! - The window's road lets a module ask the window and await its answer
//!   ([`Call::ask_window`]).
//! - [`Reach`] is the path guard: where a path a call names is, and
//!   whether its caller may reach it. [`ModuleProject::watch`] watches
//!   folders (ADR 0073, decision 14).
//! - [`https`] is the one client for the requests the engine makes itself.
//! - [`Environment`] is the port every program a Project runs starts
//!   through ([`ModuleProject::environment`], ADR 0084).
//! - [`api`] serves all of it over WebSocket.

pub mod access;
pub mod api;
mod environment;
mod error;
mod events;
mod foreign;
pub mod https;
mod ids;
mod kernel;
pub mod methods;
mod module;
mod old;
mod outbox;
mod passes;
mod project;
mod reach;
mod sign;
mod store;
mod watching;
mod window;

pub use access::{Caller, Right};
pub use environment::{Environment, Input, ProcessGroup, Program};
pub use error::{Code, Error, Refusal};
pub use events::{Event, EventFilter};
pub use foreign::{Foreign, ForeignWhy};
pub use ids::{AgentId, CommandId, EventId, Participant, PersonId, ProjectId};
pub use kernel::{Kernel, KernelBuilder, ProjectSummary, decode};
pub use methods::{Kind, Method, Nothing, Picture, Tool};
pub use module::{Call, Module, Scope, Stream, Wall};
pub use outbox::{Claim, Effect, LONGEST_LEASE, Lease, OnRestart, Outcome, Retry, Settled};
pub use passes::{Audience, Pass, secret};
pub use project::{Committed, Heard, ModuleProject, Project, Tally};
pub use reach::Reach;
/// For `methods!` and `id!`, which name it from a module's crate.
pub use schemars;
pub use sign::{PictureKind, Sign, SignColor, SignKind, SignPick};
pub use store::{Answer, Tx};
pub use watching::{Changed, Watch};
pub use window::{WindowAnswer, WindowRequest};

/// The variable that names its Project in the environment of what Banda
/// starts in one, a terminal's program or a Harness's process, which all
/// they start inherits: so the servers started in Banda are known by it
/// (ADR 0044, decision 2).
pub const PROJECT_VARIABLE: &str = "BANDA_PROJECT";

/// `PROJECT_VARIABLE` by its name before ADR 0069, set beside it for one
/// stable release, for what an Agent or a Person wrote to read it
/// (ADR 0069 grace).
const SPACE_VARIABLE: &str = "BANDA_SPACE";

/// The variables that name `project` in the environment of what Banda
/// starts in it (ADR 0044, decision 2).
pub fn project_env(project: ProjectId) -> [(&'static str, String); 2] {
    [PROJECT_VARIABLE, SPACE_VARIABLE].map(|key| (key, project.to_string()))
}

/// The Project an environment variable names, when it is one of
/// `project_env`'s.
pub fn project_in_env(key: &str, value: &str) -> Option<ProjectId> {
    [PROJECT_VARIABLE, SPACE_VARIABLE]
        .contains(&key)
        .then(|| value.parse().ok())
        .flatten()
}

/// The Project this process's environment names, by either of
/// `project_env`'s variables, read as they are: one that is not UTF-8,
/// or no Project's ID, names none.
pub fn project_from_env() -> Option<ProjectId> {
    [PROJECT_VARIABLE, SPACE_VARIABLE]
        .into_iter()
        .find_map(|key| std::env::var(key).ok()?.parse().ok())
}

/// The variable that holds an Agent's pass for `banda`, in its `banda
/// mcp` and in the shell it runs commands in (ADR 0019, decision 2).
pub const TOKEN_VARIABLE: &str = "BANDA_TOKEN";

/// The variable that says where the engine that gave the pass listens.
pub const ENGINE_VARIABLE: &str = "BANDA_ENGINE";

/// The variables that hand `banda` `pass`, from the engine at `engine`.
pub fn pass_env(pass: String, engine: String) -> [(&'static str, String); 2] {
    [(TOKEN_VARIABLE, pass), (ENGINE_VARIABLE, engine)]
}

/// The version of the API's wire protocol. A window that speaks another
/// version is refused before anything else (ADR 0002, decision 8).
pub const PROTOCOL: u32 = 1;

static VERSION: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();

/// Banda's version, as its app says it (ADR 0033, decision 2): the one
/// the engine was built with (`engine/build.rs`), told as it starts, so a
/// new version rebuilds the engine alone. The workspace's until then.
pub fn version() -> &'static str {
    VERSION.get().copied().unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Tells the modules Banda's version; the engine does, once, as it starts.
pub fn set_version(version: &'static str) {
    let _ = VERSION.set(version);
}

/// A name that works as one file or folder name: 1 to 64 characters, with
/// no slashes and no leading dot. Returns it without surrounding projects.
pub fn plain_name(name: &str) -> Option<&str> {
    let name = name.trim();
    let plain = !name.is_empty()
        && name.chars().count() <= 64
        && !name.starts_with('.')
        && !name.contains(['/', '\\', '\0']);
    plain.then_some(name)
}

/// Milliseconds since the Unix epoch: the one clock reading the kernel uses.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// The UTC date of `ms` since the Unix epoch: `2026-11-04`.
pub fn utc_date(ms: i64) -> String {
    // Days since 1970 to a civil date (Howard Hinnant's `civil_from_days`).
    let days = ms.div_euclid(86_400_000) + 719_468;
    let era = days.div_euclid(146_097);
    let of_era = days - era * 146_097;
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * of_year + 2) / 153;
    let day = of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_date_is_read_from_the_clock_by_utc() {
        for (ms, date) in [
            (0, "1970-01-01"),
            (-1_000, "1969-12-31"),
            (951_868_799_000, "2000-02-29"),
            (1_793_836_799_000, "2026-11-04"),
            (4_107_628_799_000, "2100-03-01"),
        ] {
            assert_eq!(super::utc_date(ms), date, "{ms}");
        }
    }
}
