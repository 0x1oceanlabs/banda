//! The fence around a Harness's programs (ADR 0083, decision 1): what
//! keeps Banda's own state, data and runtime folders out of an Agent's
//! shell, and Banda's config read-only there.
//!
//! The engine is its own launcher: an environment starts `banda fence`
//! from the engine's running program ([`LAUNCHER`]), with the program to
//! fence after `--` ([`argv`]) and what the fence does, a [`Spec`], on a
//! sealed memfd it keeps open in that child alone ([`Spec::seal`],
//! [`attach`]). This crate makes no process: the environment that starts
//! the launcher is the one place that does (`platform/environments`).
//!
//! `banda fence` runs single-threaded, before the engine starts anything:
//!
//! 1. It reads the spec, closes its fd and every other its starter left
//!    open, and refuses a spec another build of `banda` wrote. It refuses
//!    to run as root. It dies with its starter, and lets go of the
//!    starter's terminal.
//! 2. It makes a user, a mount and an IPC namespace, the user mapped to
//!    itself (never to root).
//! 3. It keeps `/sys` read-only, and gives the program a `/dev` of the
//!    fence's own: the devices a program needs, terminals and shared
//!    memory of its own. It pins every folder above what it covers or
//!    keeps that the user may rename, so each stays where the engine looks
//!    for it. It covers each hidden folder with an empty one of its own
//!    (`0700`, `nosuid`, `nodev`), and puts back the holes in it, each
//!    taken from the host before it was covered; it keeps the read-only
//!    folders so.
//! 4. It sets `no_new_privs`, and Landlock's scopes where the kernel has
//!    them: no signal to a process outside, no abstract socket made
//!    outside. Scopes only, so the sandboxes Harnesses make inside work.
//! 5. It makes a PID namespace, whose first process mounts its own
//!    `/proc`, starts the program in its folder with every other fd
//!    closed, reaps, and passes signals on.
//!
//! The launcher stays outside, holding its starter's process group, and
//! exits as the program did. Killed, it takes the namespace and all in it
//! along. Any step that fails stops it before the program runs.
//!
//! `banda fence --probe` does the same over a spec for real, and says what
//! held ([`Probe`]).

mod spec;

pub use spec::{Holes, Spec};

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
pub use linux::{Hears, LAUNCHER, Tells, argv, attach, launch, probe, status, take};
#[cfg(target_os = "linux")]
pub use spec::Sealed;

use serde::{Deserialize, Serialize};

/// How `banda fence` exits when it ran nothing: the fence was not set up,
/// or there is none here.
pub const UNSET: u8 = 125;

/// What the probe found: whether the fence holds here, and with which
/// layers, or why not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "fence", rename_all = "snake_case")]
pub enum Probe {
    Holds { layers: Vec<Layer> },
    Missing { why: Why, words: String },
}

/// A layer of the fence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Layer {
    /// The user, mount and PID namespaces, and the mounts in them.
    Namespaces,
    /// Landlock's scopes on signals and abstract sockets.
    Landlock,
}

/// Why the fence does not hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Why {
    /// The system gives this user no namespaces of its own: turned off, or
    /// refused by AppArmor or a container's seccomp.
    NoUserNamespaces,
    /// The system refuses a step the fence takes, or runs Banda where it
    /// cannot hold: as root, in a container that masks `/proc`, under a
    /// security module that refuses a mount, on a kernel before 5.12.
    Refused,
    /// A step of the setup failed, as the words say.
    SetupFailed,
    /// Not on this system yet.
    UnsupportedOs,
}

/// `banda fence` where there is no fence: it says so, and runs nothing.
#[cfg(not(target_os = "linux"))]
pub fn launch(
    _spec_fd: i32,
    _status_fd: Option<i32>,
    _program: &[std::ffi::OsString],
    _own_build: &str,
) -> std::process::ExitCode {
    eprintln!("banda fence: the fence is built for Linux only, so far");
    std::process::ExitCode::from(UNSET)
}

/// The probe where there is no fence.
#[cfg(not(target_os = "linux"))]
pub fn probe(_spec: &Spec, _program: &[std::ffi::OsString]) -> Probe {
    Probe::Missing {
        why: Why::UnsupportedOs,
        words: "The fence is built for Linux only, so far.".to_owned(),
    }
}

/// No spec is taken where there is no fence.
#[cfg(not(target_os = "linux"))]
pub fn take(_number: i32, _own_build: &str) -> Result<Spec, String> {
    Err("the fence is built for Linux only, so far".to_owned())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn the_launcher_reads_its_spec_by_fd_and_its_program_after_a_double_dash() {
        let sealed = Spec::default().seal().unwrap();
        let fd = sealed.number().to_string();
        let said = argv(
            &sealed,
            None,
            "claude",
            &["--resume".to_owned(), "a b".to_owned()],
        );
        assert_eq!(
            said,
            [
                "fence",
                "--spec-fd",
                fd.as_str(),
                "--",
                "claude",
                "--resume",
                "a b"
            ]
        );
        let (_hears, tells) = status().unwrap();
        let said = argv::<String>(&sealed, Some(&tells), "claude", &[]);
        assert_eq!(said[3], "--status-fd");
        assert_eq!(said[5], "--");
    }

    #[test]
    fn what_the_probe_finds_is_one_json_object() {
        let holds = Probe::Holds {
            layers: vec![Layer::Namespaces, Layer::Landlock],
        };
        assert_eq!(
            serde_json::to_string(&holds).unwrap(),
            r#"{"fence":"holds","layers":["namespaces","landlock"]}"#
        );
        let missing = Probe::Missing {
            why: Why::NoUserNamespaces,
            words: "no".to_owned(),
        };
        assert_eq!(
            serde_json::to_string(&missing).unwrap(),
            r#"{"fence":"missing","why":"no_user_namespaces","words":"no"}"#
        );
    }
}
