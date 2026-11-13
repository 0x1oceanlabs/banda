//! The kernel: what every module needs, and nothing that names a module
//! (ADR 0001, decision 3; `docs/architecture.md`).
//!
//! - [`Kernel`] keeps the Projects of this machine and routes each call to
//!   the module that owns it.
//! - [`Project`] is a folder with its own SQLite. One writer thread commits
//!   every change, and events are published only after commit (ADR 0002).
//! - A [`Module`] owns its words, its tables and its events. It reaches its
//!   Project only through a [`ModuleProject`], which can emit only that module's
//!   events, and its SQL reaches only its own tables: a SQLite authorizer
//!   refuses it the rest, the kernel's included (ADR 0062, decision 5).
//! - The outbox runs side effects after commit, in order per target: the
//!   engine's own, and workers' outside it under leases. It settles what a
//!   restart or a lease that ran out cut short, and lets old rows go.
//! - A module hears the log through a durable listener
//!   ([`ModuleProject::listen`]): the kernel keeps its cursor, so a crash
//!   loses no fact. A reaction that writes in the store acks each fact in
//!   its transaction, so it runs once. One that cannot, its work outside
//!   the store or what it follows spanning several facts, acks once its
//!   work is done, and looks before it acts (ADR 0082, decision 6).
//! - [`access::decide`] is the one place that says whether a Participant may
//!   do something, and [`access::within`] keeps an Agent in its Project.
//! - A pass names an Agent's session in its Project, and the session's
//!   Thread, for `banda mcp` ([`ModuleProject::pass`], [`Call::thread`]).
//!   The host keeps it hashed, so it outlives an engine restart, until
//!   its session ends or it expires.
//! - The window's road lets a module ask the window and await its answer
//!   ([`Call::ask_window`]).
//! - [`Reach`] is the path guard: where a path a call names is, and
//!   whether its caller may reach it. [`ModuleProject::watch`] watches
//!   folders (ADR 0073, decision 14).
//! - [`https`] is the one client for the requests the engine makes itself.
//! - [`gh`] reads gh's sign-in where gh keeps it, with no program run.
//! - [`host`] is the host system's ways where the engine needs them alike:
//!   the PATH a program is found on, how paths compare, the names Windows
//!   refuses, a file renamed into place (ADR 0090, decision 3).
//! - [`Environment`] is the port every program a Project runs starts
//!   through ([`ModuleProject::environment`], ADR 0084). It hands back
//!   the handle that stops what it started ([`Started`]), and a
//!   terminal's own handle ([`Pty`]).
//! - [`Named`] is what this host is called and drawn by, which its
//!   `welcome` says and `machine.named` streams ([`KernelBuilder::named`],
//!   ADR 0095).
//! - [`Working`] counts the Turns that run on this host, which hold the
//!   engine's machine awake (ADR 0097). Its battery, and why it is held
//!   awake, `machine.power` streams ([`KernelBuilder::power`]).
//! - [`api`] serves all of it over WebSocket.

pub mod access;
pub mod api;
mod apps;
mod cursors;
pub mod devices;
mod environment;
mod error;
mod events;
mod fence;
mod foreign;
pub mod gh;
mod hands;
pub mod host;
pub mod https;
mod ids;
mod kernel;
pub mod methods;
mod module;
mod named;
mod old;
mod outbox;
mod passes;
mod project;
mod projects;
mod pty;
mod reach;
mod registry;
mod router;
mod scopes;
mod sign;
mod started;
mod store;
mod tables;
mod watching;
mod window;
mod working;

pub use access::{Caller, Right};
pub use apps::{App, AppMethods};
pub use cursors::{Ack, Listener};
pub use environment::{Environment, Holes, Input, Program, SSH_AGENT, Whose};
pub use error::{Code, Error, Refusal};
pub use events::{Event, EventFilter};
pub use fence::{Fence, FenceLayer, FenceWhy};
pub use foreign::{Foreign, ForeignWhy};
pub use hands::{Hands, InHand, TYPED_TOLD_EVERY_MS};
pub use ids::{AgentId, CommandId, DeviceId, EventId, Participant, PersonId, ProjectId};
pub use kernel::{Kernel, ProjectSummary, decode, present};
pub use methods::{Does, Kind, Method, Nothing, Picture, Tool};
pub use module::Other;
pub use module::{Call, Module, Scope, Stream, Wall, watching, watching_as};
pub use named::{MachineIcon, NAME_MOST, Named, clean_name};
pub use outbox::{Claim, Effect, LONGEST_LEASE, Lease, OnRestart, Outcome, Retry, Settled};
pub use passes::{Pass, secret};
pub use project::{Committed, ModuleProject, Project, Tally, WeakModuleProject};
pub use pty::{Pty, PtyControl, PtySize};
pub use reach::Reach;
pub use registry::{Registry, TurnedOff};
/// For `methods!` and `id!`, which name it from a module's crate.
pub use schemars;
pub use scopes::KernelBuilder;
pub use sign::{PictureKind, Sign, SignColor, SignKind, SignPick};
pub use started::Started;
pub use store::{Answer, Tx, try_steps};
pub use tables::module_name;
pub use watching::{Changed, Watch};
pub use window::{WindowAnswer, WindowRequest};
pub use working::{AtWork, Working};

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
/// version is refused before anything else (ADR 0002, decision 8). The
/// contract takes it from here, `generated/PROTOCOL.ts`, and copies it
/// nowhere by hand (ADR 0082, decision 14).
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

static BUILD: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// The engine's build id, in hex, as `banda --version` says it; none when
/// its program has none, or before the engine told it.
pub fn build() -> Option<&'static str> {
    BUILD.get().and_then(Option::as_deref)
}

/// Tells the kernel the engine's build id; `banda serve` does, once.
pub fn set_build(build: Option<String>) {
    let _ = BUILD.set(build);
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
    fn a_date_is_read_by_utc_from_the_clock() {
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

    /// Writes the protocol's version beside the types ts-rs writes, so
    /// the contract's client says the one the engine speaks.
    #[test]
    fn export_the_protocol() {
        let Ok(dir) = std::env::var("TS_RS_EXPORT_DIR") else {
            return;
        };
        let file = std::path::Path::new(&dir).join("PROTOCOL.ts");
        let text = format!(
            "// Written by kernel/src/lib.rs. Do not edit this file manually.\n\n\
             /** The version of the API's wire protocol this client speaks; the\n \
             * engine's `hello` checks it (ADR 0002, decision 8). */\n\
             export const PROTOCOL = {}\n",
            super::PROTOCOL
        );
        if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, text).unwrap();
        }
    }
}
