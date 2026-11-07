//! The ACP adapters Banda carries (ADR 0059) and the Node that runs them,
//! as this host has them. `banda serve` finds both as it starts, so an
//! engine started with no window, from a shell or as a service, starts
//! Banda's own Harness entries through the carried adapters, with the shim
//! that keeps Claude Code's sessions in the Project (ADR 0078), and not
//! through `npx` (ADR 0062, step S1):
//!
//! - The adapters: [`ADAPTERS_VARIABLE`] when set; else [`ADAPTERS`]
//!   beside the engine's program, as a packed app has them in its
//!   resources and the engine's own copy has them beside it (ADR 0086,
//!   decision 2); else, for a build from a checkout, what the harnesses'
//!   host package built in it (`platform/harnesses/adapters/dist`).
//! - The Node: [`NODE_VARIABLE`] when whoever started the engine names
//!   one, as the window names its own Electron; else the packed app's own
//!   Electron, beside the resources the engine's program is in; else the
//!   first `node` on PATH.
//!
//! An Electron runs them as Node with `ELECTRON_RUN_AS_NODE`. A `node`
//! needs no such variable, so the programs an Agent runs inherit none.
//! Without the adapters or a Node, Banda's entries start as they did
//! before Banda carried the adapters, through `npx`.

use crate::cli::runnable;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The variable that names the adapters' folder, over where the engine
/// looks: a test's or a trial's.
pub const ADAPTERS_VARIABLE: &str = "BANDA_ADAPTERS";

/// The variable that names the Node the adapters run on: an Electron, or a
/// program named `node`.
pub const NODE_VARIABLE: &str = "BANDA_NODE";

/// The adapters' folder beside the engine's program: the packed app's
/// `resources/adapters` (`client/desktop/electron-builder.config.mjs`),
/// and the copy's (`client/desktop/src/program.ts`, `ADAPTERS`).
pub const ADAPTERS: &str = "adapters";

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
    /// The engine's own program, `banda`.
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
        let adapters = match var(ADAPTERS_VARIABLE) {
            Some(named) => PathBuf::from(named),
            None => [here.program.parent().map(|folder| folder.join(ADAPTERS))]
                .into_iter()
                .chain([here.checkout.then(checkout)])
                .flatten()
                .find(|folder| folder.is_dir())?,
        };
        let node = match var(NODE_VARIABLE) {
            Some(named) => {
                let program = PathBuf::from(named);
                let electron = program.file_stem().is_none_or(|name| name != "node");
                Node { program, electron }
            }
            None => match packed(here) {
                Some(program) => Node {
                    program,
                    electron: true,
                },
                None => Node {
                    program: on_path("node", var("PATH"))?,
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

/// The first program named `name` in the folders of `path`.
fn on_path(name: &str, path: Option<OsString>) -> Option<PathBuf> {
    std::env::split_paths(&path?)
        .map(|folder| folder.join(name))
        .find(|candidate| runnable(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn program(path: &Path) -> PathBuf {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        path.to_owned()
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
        program(&bin.join("node"));
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
        program(&bin.join("node"));
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
        // Electron, a test a node.
        let app = Path::new("/tmp/.mount_banda/banda");
        let named = found(&here, &[("PATH", &bin), (NODE_VARIABLE, app)]);
        assert_eq!(
            named.unwrap().node,
            Node {
                program: app.into(),
                electron: true
            }
        );
        let node = Path::new("/usr/local/bin/node");
        let named = found(&here, &[(NODE_VARIABLE, node)]).unwrap();
        assert!(!named.node.electron, "a node runs them as itself");
        let elsewhere = Path::new("/srv/adapters");
        let named = found(
            &here,
            &[(NODE_VARIABLE, node), (ADAPTERS_VARIABLE, elsewhere)],
        );
        assert_eq!(named.unwrap().adapters, elsewhere);
    }

    #[test]
    fn a_checkouts_engine_runs_what_the_harnesses_host_package_builds() {
        let package = checkout().join("../package.json");
        let package = std::fs::read_to_string(package).unwrap();
        assert!(
            package.contains(r#""name": "@banda/harnesses-adapters""#),
            "{package}"
        );
        assert!(package.contains(r#""build": "node build.mjs""#));
        let build = std::fs::read_to_string(checkout().join("../build.mjs")).unwrap();
        assert!(
            build.contains(r#"join(here, "dist")"#),
            "it builds into dist/"
        );
        let target = Path::new("/src/banda/target/debug/banda");
        let here = Here {
            program: target,
            app: "banda-local",
            checkout: false,
        };
        assert_eq!(found(&here, &[]), None, "a released build has no checkout");
    }
}
