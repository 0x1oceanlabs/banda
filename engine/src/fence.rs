//! `banda fence`: the launcher an environment starts a Harness's program
//! behind (ADR 0083, decision 1), and its probe (`platform/fence`). It runs
//! first, on the one thread the program starts with: no runtime, no log,
//! nothing on stdout but the probe's line.

use crate::build_id;
use banda_fence::UNSET;
use std::ffi::OsString;
use std::process::ExitCode;

/// `banda fence`: runs `program` behind the fence the spec on `spec_fd`
/// describes, or with `probe`, prints whether the fence holds here as one
/// JSON line: over that spec, else over this Banda's own [`base`].
pub fn run(probe: bool, spec_fd: Option<i32>, program: Vec<OsString>) -> ExitCode {
    let build = build_id::own();
    if probe {
        let found = probed(spec_fd, build.as_deref());
        return match serde_json::to_string(&found) {
            Ok(line) => {
                println!("{line}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("banda fence: {error}");
                ExitCode::from(UNSET)
            }
        };
    }
    let Some(build) = build else {
        eprintln!("banda fence: this banda has no build id, so it takes no spec");
        return ExitCode::from(UNSET);
    };
    match spec_fd {
        Some(spec_fd) => banda_fence::launch(spec_fd, &program, &build),
        None => {
            eprintln!("banda fence: no --spec-fd, so no fence to run the program behind");
            ExitCode::from(UNSET)
        }
    }
}

/// What the probe finds: over the spec on `spec_fd`, which must be of this
/// build, else over this Banda's own base. Behind it runs this program,
/// asked only its version.
#[cfg(target_os = "linux")]
fn probed(spec_fd: Option<i32>, build: Option<&str>) -> banda_fence::Probe {
    use banda_fence::{Probe, Why};
    let spec = match (spec_fd, build) {
        (Some(number), Some(build)) => banda_fence::take(number, build),
        (Some(_), None) => Err("this banda has no build id, so it takes no spec".to_owned()),
        (None, build) => crate::places::Places::from_env()
            .map_err(crate::Failure::words)
            .and_then(|places| Folders::here(&places).map_err(|error| error.to_string()))
            .and_then(|folders| {
                base(&folders, build.unwrap_or_default()).map_err(|error| error.to_string())
            }),
    };
    let program = [banda_fence::LAUNCHER, "--version"].map(OsString::from);
    match spec {
        Ok(spec) => banda_fence::probe(&spec, &program),
        Err(words) => Probe::Missing {
            why: Why::SetupFailed,
            words,
        },
    }
}

#[cfg(not(target_os = "linux"))]
fn probed(_spec_fd: Option<i32>, _build: Option<&str>) -> banda_fence::Probe {
    banda_fence::probe(&banda_fence::Spec::default(), &[])
}

#[cfg(target_os = "linux")]
pub use base::{Folders, base};

#[cfg(target_os = "linux")]
mod base {
    use crate::places::{FOLDERS, Places, state_base};
    use rustix::fs::Access;
    use std::io;
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    use std::path::{Path, PathBuf};

    /// Where this Banda's folders are, and every Banda's, and the
    /// session's: all [`base`] reads.
    #[derive(Clone, Debug)]
    pub struct Folders {
        /// This Banda's state, data and config, as its places have them,
        /// moved or not.
        pub state: PathBuf,
        pub data: PathBuf,
        pub config: PathBuf,
        /// Where every Banda keeps its state, data and config folders by
        /// default: `~/.local/state`, `~/.local/share`, `~/.config`.
        pub state_base: Option<PathBuf>,
        pub data_base: Option<PathBuf>,
        pub config_base: Option<PathBuf>,
        /// The session's runtime folder, if it has one.
        pub runtime: Option<PathBuf>,
        /// tmux's folder of this user's sockets.
        pub tmux: PathBuf,
        /// The engine's program, as it runs.
        pub running: PathBuf,
    }

    impl Folders {
        /// This Banda's, from `places`, and the rest as the session has
        /// them.
        pub fn here(places: &Places) -> io::Result<Folders> {
            let uid = rustix::process::getuid().as_raw();
            let set = |name: &str| std::env::var_os(name).filter(|set| !set.is_empty());
            let tmux = PathBuf::from(set("TMUX_TMPDIR").unwrap_or_else(|| "/tmp".into()));
            Ok(Folders {
                state: places.state.clone(),
                data: places.data.clone(),
                config: places.config.clone(),
                state_base: state_base(),
                data_base: dirs::data_dir(),
                config_base: dirs::config_dir(),
                runtime: set("XDG_RUNTIME_DIR").map(PathBuf::from),
                tmux: tmux.join(format!("tmux-{uid}")),
                running: std::env::current_exe()?,
            })
        }
    }

    /// What the fence keeps from every Harness's program here, whatever
    /// its Project (ADR 0083, decision 1): every Banda's state and data
    /// folders, this one's as `places` moves them too, hidden, with the
    /// running engine's own folder left to run; the session's runtime
    /// folder and tmux's, hidden; the display's and the container engines'
    /// sockets, hidden where they are; and every Banda's config, read-only.
    ///
    /// It makes this Banda's folders and the others' it hides that are not
    /// there yet, `0700`, so the fence covers each where the engine will
    /// look for it. It refuses a folder reached through a link this user
    /// could move (see [`steady`]).
    pub fn base(folders: &Folders, build: &str) -> io::Result<banda_fence::Spec> {
        let mut hidden = Vec::new();
        for under in [&folders.state_base, &folders.data_base]
            .into_iter()
            .flatten()
        {
            hidden.extend(FOLDERS.iter().map(|folder| under.join(folder)));
        }
        hidden.extend([
            folders.state.clone(),
            folders.data.clone(),
            folders.tmux.clone(),
        ]);
        for folder in &mut hidden {
            made(folder)?;
            *folder = kept(folder)?;
        }
        if let Some(runtime) = &folders.runtime {
            hidden.push(kept(runtime)?);
        }
        hidden.sort();
        hidden.dedup();

        made(&folders.config)?;
        let mut read_only = vec![kept(&folders.config)?];
        if let Some(under) = &folders.config_base {
            for folder in FOLDERS.map(|folder| under.join(folder)) {
                if std::fs::symlink_metadata(&folder).is_ok() {
                    read_only.push(kept(&folder)?);
                }
            }
        }
        read_only.sort();
        read_only.dedup();

        // The engine runs from its copy in the data folder (ADR 0086); its
        // Agents' tools run it from there too.
        let engines = kept(&folders.data)?.join("engine");
        let runs = (folders.running.parent())
            .filter(|folder| folder.starts_with(&engines) && *folder != engines)
            .map(PathBuf::from);

        Ok(banda_fence::Spec {
            build: build.to_owned(),
            hidden,
            hidden_if_there: Vec::from(
                [
                    "/tmp/.X11-unix",
                    "/run/docker.sock",
                    "/run/podman/podman.sock",
                ]
                .map(PathBuf::from),
            ),
            read_only,
            holes: banda_fence::Holes {
                runs: runs.into_iter().collect(),
                ..banda_fence::Holes::default()
            },
            cwd: None,
        })
    }

    /// Makes `folder` and the folders above it where they are not there
    /// yet, each `0700`.
    fn made(folder: &Path) -> io::Result<()> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(folder)
    }

    /// `path` where it is, once [`steady`]: the folders above it resolved,
    /// and not itself, as the fence refuses to cover a link.
    fn kept(path: &Path) -> io::Result<PathBuf> {
        steady(path)?;
        match (path.parent(), path.file_name()) {
            (Some(parent), Some(name)) => Ok(dunce::canonicalize(parent)?.join(name)),
            _ => dunce::canonicalize(path),
        }
    }

    /// Refuses `path` when a link on the way to it, or it itself, is in a
    /// folder this user may change: the link could be moved, and another
    /// folder take the place where Banda looks for its own. A link in a
    /// folder only root changes, as `/var/run`, stays where it is.
    pub(super) fn steady(path: &Path) -> io::Result<()> {
        let me = rustix::process::getuid().as_raw();
        for at in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
            let Ok(found) = std::fs::symlink_metadata(at) else {
                continue;
            };
            let Some(parent) = at.parent().filter(|_| found.file_type().is_symlink()) else {
                continue;
            };
            let owned = std::fs::metadata(parent).is_ok_and(|parent| parent.uid() == me);
            if owned || rustix::fs::access(parent, Access::WRITE_OK).is_ok() {
                return Err(io::Error::other(format!(
                    "{} is a link this user can move, so the fence cannot keep {} where \
                     Banda looks for it: put the folder it leads to in its place",
                    at.display(),
                    path.display()
                )));
            }
        }
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// A home with this Banda's folders under the usual places, and the
    /// engine running from its copy in the data folder.
    fn folders(home: &Path) -> Folders {
        let (state, data, config) = (
            home.join(".local/state"),
            home.join(".local/share"),
            home.join(".config"),
        );
        let running = data.join("banda-local/engine/1.0/banda");
        std::fs::create_dir_all(running.parent().unwrap()).unwrap();
        std::fs::write(&running, "").unwrap();
        Folders {
            state: state.join("banda-local"),
            data: data.join("banda-local"),
            config: config.join("banda-local"),
            state_base: Some(state),
            data_base: Some(data),
            config_base: Some(config),
            runtime: Some(home.join("run")),
            tmux: home.join("tmp/tmux-1000"),
            running,
        }
    }

    #[test]
    fn the_base_hides_every_bandas_folders_and_the_sessions_and_keeps_config_read_only() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(home.join("run")).unwrap();
        std::fs::create_dir_all(home.join(".config/banda-dev")).unwrap();
        let mut folders = folders(&home);
        // This Banda's state, moved.
        folders.state = home.join("moved/state");
        let spec = base(&folders, "b1").unwrap();
        let under = |paths: &[&str]| -> Vec<PathBuf> {
            let mut paths: Vec<PathBuf> = paths.iter().map(|path| home.join(path)).collect();
            paths.sort();
            paths
        };
        assert_eq!(spec.build, "b1");
        assert_eq!(
            spec.hidden,
            under(&[
                ".local/share/banda",
                ".local/share/banda-dev",
                ".local/share/banda-local",
                ".local/state/banda",
                ".local/state/banda-dev",
                ".local/state/banda-local",
                "moved/state",
                "run",
                "tmp/tmux-1000",
            ])
        );
        for made in &spec.hidden {
            assert!(made.is_dir(), "{}", made.display());
        }
        // Each Banda's config that is there, and this one's, made.
        assert_eq!(
            spec.read_only,
            under(&[".config/banda-dev", ".config/banda-local"])
        );
        assert_eq!(
            spec.holes.runs,
            under(&[".local/share/banda-local/engine/1.0"])
        );
        assert!(spec.holes.writes.is_empty() && spec.holes.reads.is_empty());
        assert!(
            spec.hidden_if_there
                .contains(&PathBuf::from("/tmp/.X11-unix"))
        );
    }

    #[test]
    fn the_base_refuses_a_folder_reached_through_a_link_the_user_can_move() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(home.join("run")).unwrap();
        let folders = folders(&home);

        // The state folders, linked elsewhere.
        std::fs::create_dir(home.join("elsewhere")).unwrap();
        std::os::unix::fs::symlink(home.join("elsewhere"), home.join(".local/state")).unwrap();
        let refused = base(&folders, "b1").unwrap_err().to_string();
        assert!(
            refused.contains("is a link this user can move"),
            "{refused}"
        );
        std::fs::remove_file(home.join(".local/state")).unwrap();

        // The config, itself a link.
        std::fs::create_dir_all(home.join("dotfiles/banda-local")).unwrap();
        std::fs::create_dir(home.join(".config")).unwrap();
        let config = home.join(".config/banda-local");
        std::os::unix::fs::symlink(home.join("dotfiles/banda-local"), &config).unwrap();
        let refused = base(&folders, "b1").unwrap_err().to_string();
        assert!(
            refused.contains(".config/banda-local is a link"),
            "{refused}"
        );
    }

    #[test]
    fn a_link_only_root_can_move_is_no_trouble() {
        // `/proc/self` is a link in a folder only root changes.
        assert!(base::steady(Path::new("/proc/self/fd")).is_ok());
    }

    #[test]
    fn every_bandas_folders_are_this_ones_too() {
        assert!(crate::places::FOLDERS.contains(&crate::places::FOLDER));
    }
}
