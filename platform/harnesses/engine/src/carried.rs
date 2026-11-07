//! The ACP adapters Banda carries (ADR 0059) and the Node that runs them,
//! as this host has them. `banda serve` finds both as it starts, so an
//! engine started with no window, from a shell or as a service, starts
//! Banda's own Harness entries through the carried adapters, with the shim
//! that keeps Claude Code's sessions in the Project (ADR 0078), and not
//! through `npx` (ADR 0062, step S1):
//!
//! - The adapters: [`ADAPTERS_VARIABLE`] when set; else [`FOLDER`] beside
//!   the engine's program, as a packed app has them in its resources and
//!   the engine's own copy has them beside it (ADR 0086, decision 2); else,
//!   for a build from a checkout, what the harnesses' host package built
//!   in it (`platform/harnesses/adapters/dist`).
//! - The Node: [`NODE_VARIABLE`] when whoever started the engine names
//!   one, as the window names its own Electron; else the packed app's own
//!   Electron, beside the resources the engine's program is in; else the
//!   Electron that [`ELECTRON`], beside the engine's own copy, names, as
//!   the window wrote it for an app that stays where it is; else the first
//!   `node` on PATH that is at least [`NODE_MINIMUM`].
//!
//! An Electron runs them as Node with `ELECTRON_RUN_AS_NODE`. A `node`
//! needs no such variable, so the programs an Agent runs inherit none.
//! Without the adapters or a Node, Banda's entries start as they did
//! before Banda carried the adapters, through `npx`.

use crate::cli::runnable;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The variable that names the adapters' folder, over where the engine
/// looks: a test's or a trial's.
pub const ADAPTERS_VARIABLE: &str = "BANDA_ADAPTERS";

/// The variable that names the Node the adapters run on: an Electron, or a
/// program whose name starts with `node`, as `node`, `nodejs` or `node22`.
pub const NODE_VARIABLE: &str = "BANDA_NODE";

/// The adapters' folder beside the engine's program: the packed app's
/// `resources/adapters` (`client/desktop/electron-builder.config.mjs`),
/// and the copy's (`client/desktop/src/program.ts`, `CARRIED`).
pub const FOLDER: &str = "adapters";

/// The file beside the engine's own copy that names the packed app's
/// Electron, which runs the adapters as Node: the window writes it when
/// its Electron stays where it is, as a macOS app's does and an
/// AppImage's does not (`client/desktop/src/program.ts`, `ELECTRON`).
pub const ELECTRON: &str = "electron";

/// The oldest Node the adapters run on: Claude Code's adapter's
/// `engines.node`, and what the host package bundles them for.
pub const NODE_MINIMUM: u32 = 22;

/// Where this host keeps the adapters Banda carries, and what runs them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Carried {
    /// The folder of the bundled adapters, one file each, named as its
    /// package is.
    pub adapters: PathBuf,
    pub node: Node,
}

/// A program that runs an adapter as Node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    pub program: PathBuf,
    /// Whether it is an Electron, which runs as Node only with
    /// `ELECTRON_RUN_AS_NODE`.
    pub electron: bool,
}

/// Where the engine runs, as it says.
pub struct Here<'a> {
    /// The engine's own program, `banda`, through no link.
    pub program: &'a Path,
    /// What a packed app names its program on Linux: Banda's folder, such
    /// as `banda` or `banda-dev` (ADR 0033, decision 1).
    pub app: &'a str,
    /// Whether the engine was built from a checkout, where the harnesses'
    /// host package builds the adapters.
    pub checkout: bool,
}

impl Carried {
    /// The adapters and the Node on this host, as the engine's environment
    /// and `here` say; none when either is missing.
    pub fn find(here: &Here) -> Option<Carried> {
        Self::find_in(here, |name| std::env::var_os(name))
    }

    fn find_in(here: &Here, var: impl Fn(&str) -> Option<OsString>) -> Option<Carried> {
        let var = |name: &str| var(name).filter(|value| !value.is_empty());
        let beside = |name: &str| here.program.parent().map(|folder| folder.join(name));
        let adapters = match var(ADAPTERS_VARIABLE) {
            Some(named) => PathBuf::from(named),
            None => [beside(FOLDER), here.checkout.then(checkout)]
                .into_iter()
                .flatten()
                .find(|folder| folder.is_dir())?,
        };
        let node = match var(NODE_VARIABLE) {
            Some(named) => {
                let program = PathBuf::from(named);
                let name = program.file_stem().map(|name| name.to_string_lossy());
                let electron = name.is_none_or(|name| !name.starts_with("node"));
                Node { program, electron }
            }
            None => match packed(here).or_else(|| written(beside(ELECTRON)?)) {
                Some(program) => Node {
                    program,
                    electron: true,
                },
                None => Node {
                    program: node_on(var("PATH"))?,
                    electron: false,
                },
            },
        };
        Some(Carried { adapters, node })
    }
}

/// What the harnesses' host package builds the adapters into, in the
/// checkout this crate was built in.
fn checkout() -> PathBuf {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../adapters/dist");
    dist.canonicalize().unwrap_or(dist)
}

/// The packed app's own Electron, when the engine's program is in its
/// resources: on Linux `resources/banda` beside the app's program, named
/// as Banda's folder is; on macOS `Contents/Resources/banda` beside the one
/// program in `Contents/MacOS`. An engine run from its own copy is in no
/// app's resources.
fn packed(here: &Here) -> Option<PathBuf> {
    let resources = here.program.parent()?;
    if !resources.file_name()?.eq_ignore_ascii_case("resources") {
        return None;
    }
    let app = resources.parent()?;
    let linux = app.join(here.app);
    if runnable(&linux) {
        return Some(linux);
    }
    let mut programs = (std::fs::read_dir(app.join("MacOS")).ok()?)
        .filter_map(|entry| Some(entry.ok()?.path()))
        .filter(|path| runnable(path));
    let program = programs.next()?;
    programs.next().is_none().then_some(program)
}

/// The program the file `record` names, when it names one that runs: an
/// app moved or removed since leaves it naming nothing.
fn written(record: PathBuf) -> Option<PathBuf> {
    let named = PathBuf::from(std::fs::read_to_string(record).ok()?.trim());
    (named.is_absolute() && runnable(&named)).then_some(named)
}

/// The first program named `node` in the folders of `path` that is at
/// least [`NODE_MINIMUM`]: an older one is passed over, and the log says
/// which and why.
fn node_on(path: Option<OsString>) -> Option<PathBuf> {
    std::env::split_paths(&path?)
        .map(|folder| folder.join("node"))
        .filter(|candidate| runnable(candidate))
        .find(|candidate| {
            let said = version_of(candidate);
            let fits = (said.as_deref().and_then(major)).is_some_and(|major| major >= NODE_MINIMUM);
            if !fits {
                tracing::warn!(
                    node = %candidate.display(),
                    version = said.as_deref().unwrap_or("none it says"),
                    "this node is older than the Node {NODE_MINIMUM} the adapters Banda carries run on"
                );
            }
            fits
        })
}

/// What `node --version` says, as `v22.11.0`; none when it says nothing.
fn version_of(node: &Path) -> Option<String> {
    let mut asked = Command::new(node);
    asked
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    for _ in 0..3 {
        match asked.output() {
            // A program written a moment ago may still be open in a process
            // another thread is starting, as a test's is.
            Err(e) if e.kind() == std::io::ErrorKind::ExecutableFileBusy => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            said => {
                let said = String::from_utf8_lossy(&said.ok()?.stdout)
                    .trim()
                    .to_owned();
                return (!said.is_empty()).then_some(said);
            }
        }
    }
    None
}

/// The major version of `v22.11.0`.
fn major(version: &str) -> Option<u32> {
    let digits = version.strip_prefix('v').unwrap_or(version);
    digits.split('.').next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A program at `path` that says `said` when it runs.
    fn program_saying(path: &Path, said: &str) -> PathBuf {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\necho {said}\n")).unwrap();
        std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        path.to_owned()
    }

    fn program(path: &Path) -> PathBuf {
        program_saying(path, "")
    }

    /// A `node` in `folder` that says it is `version`.
    fn node(folder: &Path, version: &str) -> PathBuf {
        program_saying(&folder.join("node"), version)
    }

    fn found(here: &Here, vars: &[(&str, &Path)]) -> Option<Carried> {
        let vars: HashMap<&str, OsString> = (vars.iter())
            .map(|(name, value)| (*name, value.as_os_str().to_owned()))
            .collect();
        Carried::find_in(here, |name| vars.get(name).cloned())
    }

    #[test]
    fn a_packed_app_runs_them_on_its_own_electron() {
        let root = tempfile::tempdir().unwrap();
        let banda = program(&root.path().join("opt/banda/resources/banda"));
        std::fs::create_dir(root.path().join("opt/banda/resources/adapters")).unwrap();
        let electron = program(&root.path().join("opt/banda/banda"));
        let bin = root.path().join("bin");
        node(&bin, "v22.11.0");
        let here = Here {
            program: &banda,
            app: "banda",
            checkout: false,
        };
        let carried = found(&here, &[("PATH", &bin)]).unwrap();
        assert_eq!(
            carried.adapters,
            root.path().join("opt/banda/resources/adapters")
        );
        assert_eq!(
            carried.node,
            Node {
                program: electron,
                electron: true
            },
            "the app's own, though a node is on PATH"
        );

        // macOS: the one program in the app's Contents/MacOS.
        let banda = program(&root.path().join("Banda.app/Contents/Resources/banda"));
        std::fs::create_dir(root.path().join("Banda.app/Contents/Resources/adapters")).unwrap();
        let electron = program(&root.path().join("Banda.app/Contents/MacOS/Banda"));
        let here = Here {
            program: &banda,
            ..here
        };
        assert_eq!(found(&here, &[]).unwrap().node.program, electron);
    }

    #[test]
    fn the_engines_own_copy_runs_the_adapters_beside_it_on_a_node_found_or_named() {
        let root = tempfile::tempdir().unwrap();
        let banda = program(&root.path().join("data/engine/1.2.3/banda"));
        let here = Here {
            program: &banda,
            app: "banda",
            checkout: false,
        };
        let bin = root.path().join("bin");
        node(&bin, "v22.11.0");
        assert_eq!(found(&here, &[("PATH", &bin)]), None, "no adapters");
        std::fs::create_dir(root.path().join("data/engine/1.2.3/adapters")).unwrap();
        assert_eq!(found(&here, &[]), None, "no Node");
        let carried = found(&here, &[("PATH", &bin)]).unwrap();
        assert_eq!(
            carried.adapters,
            root.path().join("data/engine/1.2.3/adapters")
        );
        assert_eq!(
            carried.node,
            Node {
                program: bin.join("node"),
                electron: false
            }
        );

        // Whoever starts the engine may name its Node: the window its own
        // Electron, a test a node, whatever the system calls it.
        let app = Path::new("/tmp/.mount_banda/banda");
        let named = found(&here, &[("PATH", &bin), (NODE_VARIABLE, app)]);
        assert_eq!(
            named.unwrap().node,
            Node {
                program: app.into(),
                electron: true
            }
        );
        for node in ["/usr/local/bin/node", "/usr/bin/nodejs", "/opt/node22"] {
            let named = found(&here, &[(NODE_VARIABLE, Path::new(node))]).unwrap();
            assert!(!named.node.electron, "{node} runs them as itself");
        }
        let node = Path::new("/usr/local/bin/node");
        let elsewhere = Path::new("/srv/adapters");
        let named = found(
            &here,
            &[(NODE_VARIABLE, node), (ADAPTERS_VARIABLE, elsewhere)],
        );
        assert_eq!(named.unwrap().adapters, elsewhere);
    }

    #[test]
    fn the_copy_of_an_app_that_stays_runs_them_on_the_electron_it_names() {
        let root = tempfile::tempdir().unwrap();
        let banda = program(&root.path().join("data/engine/1.2.3/banda"));
        std::fs::create_dir(root.path().join("data/engine/1.2.3/adapters")).unwrap();
        let electron = program(&root.path().join("Banda.app/Contents/MacOS/Banda"));
        let record = root.path().join("data/engine/1.2.3").join(ELECTRON);
        std::fs::write(&record, format!("{}\n", electron.display())).unwrap();
        let bin = root.path().join("bin");
        node(&bin, "v22.11.0");
        let here = Here {
            program: &banda,
            app: "banda",
            checkout: false,
        };
        assert_eq!(
            found(&here, &[("PATH", &bin)]).unwrap().node,
            Node {
                program: electron.clone(),
                electron: true
            },
            "the app's, over a node on PATH"
        );

        // The app moved: the record names nothing that runs.
        std::fs::remove_file(&electron).unwrap();
        assert_eq!(
            found(&here, &[("PATH", &bin)]).unwrap().node.program,
            bin.join("node")
        );
        std::fs::write(&record, "Banda.app/Contents/MacOS/Banda").unwrap();
        assert_eq!(found(&here, &[]), None, "a relative path names nothing");
    }

    #[test]
    fn a_node_on_path_older_than_the_adapters_run_on_is_passed_over() {
        let root = tempfile::tempdir().unwrap();
        let banda = program(&root.path().join("data/engine/1.2.3/banda"));
        std::fs::create_dir(root.path().join("data/engine/1.2.3/adapters")).unwrap();
        let here = Here {
            program: &banda,
            app: "banda",
            checkout: false,
        };
        let (old, silent, new) = (
            root.path().join("old"),
            root.path().join("silent"),
            root.path().join("new"),
        );
        node(&old, "v20.18.1");
        node(&silent, "");
        node(&new, "v24.1.0");
        let path = std::env::join_paths([&old, &silent]).unwrap();
        assert_eq!(found(&here, &[("PATH", Path::new(&path))]), None);
        let path = std::env::join_paths([&old, &silent, &new]).unwrap();
        let carried = found(&here, &[("PATH", Path::new(&path))]).unwrap();
        assert_eq!(carried.node.program, new.join("node"));
        assert_eq!(major("v22.11.0"), Some(22));
        assert_eq!(major("node"), None);
    }

    #[test]
    fn a_released_build_has_no_checkout_to_look_in() {
        let target = Path::new("/src/banda/target/debug/banda");
        let here = Here {
            program: target,
            app: "banda-local",
            checkout: false,
        };
        assert_eq!(found(&here, &[]), None);
    }
}
