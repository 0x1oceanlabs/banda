//! `banda fence`: the launcher an environment starts a Harness's program
//! behind (ADR 0083, decision 1), and its probe (`platform/fence`). It runs
//! first, on the one thread the program starts with: no runtime, no log,
//! nothing on stdout but the probe's line.

use crate::build_id;
use banda_fence::UNSET;
use std::ffi::OsString;
use std::process::ExitCode;

/// `banda fence`: runs `program` behind the fence the spec on `spec_fd`
/// describes, saying on `status_fd` whether it started; or with `probe`,
/// prints whether the fence holds here as one JSON line: over that spec,
/// else over this Banda's own [`base`].
pub fn run(
    probe: bool,
    spec_fd: Option<i32>,
    status_fd: Option<i32>,
    program: Vec<OsString>,
) -> ExitCode {
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
        Some(spec_fd) => banda_fence::launch(spec_fd, status_fd, &program, &build),
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

/// Where every Project's programs run here (ADR 0084): on the host, a
/// Harness's behind the fence where the probe over this Banda's base finds
/// that it holds (ADR 0083, decision 1), which the log says. Where it
/// holds, the engine's own programs are found where only root changes
/// them ([`banda_kernel::host::guard`]). A debug build's `BANDA_FENCE=off`
/// leaves it out, for a test that needs none; a release build ignores it.
pub async fn environment(places: &crate::places::Places) -> banda_environments::Fenced {
    let environment = found(places).await;
    let fence = banda_kernel::Environment::fence(&environment);
    if matches!(fence, banda_kernel::Fence::Holds { .. }) {
        banda_kernel::host::guard();
    }
    logged(&fence);
    environment
}

async fn found(places: &crate::places::Places) -> banda_environments::Fenced {
    use banda_environments::Local;
    use banda_kernel::{Fence, FenceWhy};
    if cfg!(debug_assertions) && std::env::var("BANDA_FENCE").is_ok_and(|said| said == "off") {
        let words = "BANDA_FENCE=off turned the fence off, for a test.";
        return Local::unfenced(Fence::missing(FenceWhy::Off, words));
    }
    #[cfg(target_os = "linux")]
    {
        let Some(build) = build_id::own() else {
            let words = "This banda has no build id, so it starts no fence.";
            return Local::unfenced(Fence::missing(FenceWhy::SetupFailed, words));
        };
        let base = match Folders::here(places).and_then(|folders| base(&folders, &build)) {
            Ok(base) => base,
            Err(error) => {
                let words = format!("The fence's folders: {error}");
                return Local::unfenced(Fence::missing(FenceWhy::SetupFailed, words));
            }
        };
        let launcher = std::path::Path::new(banda_fence::LAUNCHER);
        let fence = banda_environments::probe(&base, launcher).await;
        Local::fenced(base, fence)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = places;
        let words = "Banda has no fence on this system: new Threads start Supervised.";
        Local::unfenced(Fence::missing(FenceWhy::UnsupportedOs, words))
    }
}

/// Says in the log whether the fence holds, and what a new Thread's mode
/// is then.
fn logged(fence: &banda_kernel::Fence) {
    use banda_kernel::Fence;
    match fence {
        Fence::Holds {
            layers,
            docker_group: true,
        } => tracing::warn!(
            ?layers,
            "the fence holds, but this user is in the docker group, which reaches past it: \
             new Threads start Supervised"
        ),
        Fence::Holds { layers, .. } if !fence.holds_whole() => {
            tracing::warn!(
                ?layers,
                "the fence holds partly: new Threads start Supervised"
            )
        }
        Fence::Holds { layers, .. } => tracing::info!(?layers, "the fence holds"),
        Fence::Missing { why, words } => tracing::warn!(
            ?why,
            words,
            "the fence does not hold: new Threads start Supervised"
        ),
    }
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
    /// session's, and its SSH agent's socket: all [`base`] reads.
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
        /// Where other programs of the session take what they are told,
        /// when they run: screen's, Emacs's and zellij's folders of this
        /// user's sockets, and the session bus's socket outside the runtime
        /// folder.
        pub sessions: Vec<PathBuf>,
        /// The SSH agent's socket, as `SSH_AUTH_SOCK` names it.
        pub agent: Option<PathBuf>,
        /// Where the container and machine managers of this user take
        /// what they are told, beside the system's: Docker Desktop's,
        /// Rancher Desktop's, Lima's and Colima's folders in the home, and
        /// the sockets `DOCKER_HOST` and `CONTAINER_HOST` name.
        pub managers: Vec<PathBuf>,
        /// Where a terminal takes remote control, as the start of each
        /// socket's name: kitty's, with its process's number after it.
        pub controls: Vec<PathBuf>,
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
            // An engine started outside the session, from ssh or cron,
            // has none named, and the session's is there all the same.
            let runtime = (set("XDG_RUNTIME_DIR").map(PathBuf::from)).or_else(|| {
                Some(PathBuf::from(format!("/run/user/{uid}"))).filter(|at| at.is_dir())
            });
            let mut sessions: Vec<PathBuf> =
                [format!("/tmp/emacs{uid}"), format!("/tmp/zellij-{uid}")]
                    .map(PathBuf::from)
                    .into();
            if let Some(user) = set("USER").or_else(|| set("LOGNAME")) {
                let user = user.to_string_lossy();
                for screens in ["/run/screen", "/var/run/screen", "/tmp/screens"] {
                    sessions.push(PathBuf::from(format!("{screens}/S-{user}")));
                }
            }
            sessions.extend(set("SCREENDIR").map(PathBuf::from));
            if let Some(bus) = set("DBUS_SESSION_BUS_ADDRESS") {
                sessions.extend(bus_sockets(&bus.to_string_lossy()));
            }
            sessions.retain(|path| path.is_absolute());
            let home = dirs::home_dir();
            let mut managers: Vec<PathBuf> = Vec::new();
            if let Some(home) = &home {
                let under = [".docker/desktop", ".docker/run", ".rd", ".lima", ".colima"];
                managers.extend(under.map(|folder| home.join(folder)));
            }
            for variable in ["DOCKER_HOST", "CONTAINER_HOST"] {
                let named = set(variable).and_then(|host| unix_socket(&host.to_string_lossy()));
                managers.extend(named);
            }
            let mut controls = vec![PathBuf::from("/tmp/kitty-")];
            if let Some(config) = dirs::config_dir() {
                let conf = std::fs::read_to_string(config.join("kitty/kitty.conf"));
                let (exact, starting) = kitty_listens(&conf.unwrap_or_default(), home.as_deref());
                managers.extend(exact);
                controls.extend(starting);
            }
            Ok(Folders {
                state: places.state.clone(),
                data: places.data.clone(),
                config: places.config.clone(),
                state_base: state_base(),
                data_base: dirs::data_dir(),
                config_base: dirs::config_dir(),
                runtime,
                tmux: tmux.join(format!("tmux-{uid}")),
                sessions,
                agent: set("SSH_AUTH_SOCK").map(PathBuf::from),
                managers: managers.into_iter().filter_map(plain).collect(),
                controls: controls.into_iter().filter_map(plain).collect(),
                running: std::env::current_exe()?,
            })
        }
    }

    /// The socket a `unix://` address names, as `DOCKER_HOST` does.
    pub(super) fn unix_socket(address: &str) -> Option<PathBuf> {
        address.strip_prefix("unix://").map(PathBuf::from)
    }

    /// Where kitty's config says it listens for remote control, on a
    /// socket by its path: that path, and the start of the name of each
    /// socket it makes there, one for each kitty, its process's number
    /// put in for `{kitty_pid}` or after a `-`.
    pub(super) fn kitty_listens(conf: &str, home: Option<&Path>) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let (mut exact, mut starting) = (Vec::new(), Vec::new());
        let lines = conf.lines().map(str::trim);
        for value in lines.filter_map(|line| line.strip_prefix("listen_on")) {
            // An abstract socket is out of reach behind Landlock's scopes.
            let Some(named) =
                (value.trim().strip_prefix("unix:")).filter(|at| !at.starts_with('@'))
            else {
                continue;
            };
            let named = match (named.strip_prefix("~/"), home) {
                (Some(rest), Some(home)) => home.join(rest),
                _ => PathBuf::from(named),
            };
            let text = named.to_string_lossy();
            match text.split_once("{kitty_pid}") {
                Some((start, _)) => starting.push(PathBuf::from(start)),
                None => {
                    starting.push(PathBuf::from(format!("{text}-")));
                    exact.push(named);
                }
            }
        }
        (exact, starting)
    }

    /// `path` as the fence takes one: absolute, with no `..` in it, its
    /// `.` parts left out.
    fn plain(path: PathBuf) -> Option<PathBuf> {
        use std::path::Component;
        let plain = path
            .components()
            .all(|part| matches!(part, Component::RootDir | Component::Normal(_)));
        (path.is_absolute() && plain && path.parent().is_some())
            .then(|| path.components().collect())
    }

    /// The sockets a D-Bus address names by their paths, as
    /// `unix:path=/run/user/1000/bus`.
    pub(super) fn bus_sockets(address: &str) -> Vec<PathBuf> {
        (address.split(';'))
            .filter_map(|one| one.strip_prefix("unix:"))
            .flat_map(|options| options.split(','))
            .filter_map(|option| option.strip_prefix("path="))
            .map(PathBuf::from)
            .collect()
    }

    /// What the fence keeps from every Harness's program here, whatever
    /// its Project (ADR 0083, decision 1): every Banda's state and data
    /// folders, this one's as `places` moves them too, hidden, with the
    /// running engine's own folder left to run; the session's runtime
    /// folder and tmux's, hidden, with the SSH agent's socket in them left
    /// to sign with ([`agent_socket`]); the display's, the other sessions'
    /// and the container and machine managers' sockets, hidden where they
    /// are; and every Banda's config, read-only.
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

        let agent = (folders.agent.as_deref()).and_then(|named| agent_socket(named, &hidden));
        let mut hidden_if_there: Vec<PathBuf> = [
            "/tmp/.X11-unix",
            "/run/docker.sock",
            "/run/podman/podman.sock",
            "/run/containerd/containerd.sock",
            "/var/lib/lxd/unix.socket",
            "/var/snap/lxd/common/lxd/unix.socket",
            "/var/lib/incus/unix.socket",
            "/run/incus",
            "/run/libvirt",
        ]
        .map(PathBuf::from)
        .into();
        hidden_if_there.extend(folders.sessions.iter().cloned());
        hidden_if_there.extend(folders.managers.iter().cloned());
        let read_only = linked(read_only, &hidden)?;
        Ok(banda_fence::Spec {
            build: build.to_owned(),
            hidden,
            hidden_if_there,
            hidden_starting: folders.controls.clone(),
            read_only,
            owned: vec![PathBuf::from("/etc/ssh/ssh_config.d")],
            holes: banda_fence::Holes {
                runs: runs.into_iter().collect(),
                writes: agent.into_iter().collect(),
                ..banda_fence::Holes::default()
            },
            cwd: None,
        })
    }

    /// The hole for the SSH agent's socket `named`, where it is one in a
    /// folder the fence hides (`hidden`), as the session's runtime folder:
    /// an Agent signs with the Person's keys as their own shell does, and
    /// the folder's other sockets, as the keyring's, stay out of reach. It
    /// must be this user's socket, reached through no link this user could
    /// move, which could lead the hole to another. A socket gone by the
    /// time a program starts is left out then.
    fn agent_socket(named: &Path, hidden: &[PathBuf]) -> Option<PathBuf> {
        use std::os::unix::fs::FileTypeExt;
        if !named.is_absolute() || steady(named).is_err() {
            return None;
        }
        let socket = dunce::canonicalize(named).ok()?;
        let found = std::fs::metadata(&socket).ok()?;
        let me = rustix::process::getuid().as_raw();
        let inside = hidden
            .iter()
            .any(|folder| socket.starts_with(folder) && socket != *folder);
        (inside && found.file_type().is_socket() && found.uid() == me).then_some(socket)
    }

    /// `read_only`, with where each link in it leads, kept read-only too:
    /// a setting kept in the Person's dotfiles, linked into Banda's config,
    /// is read-only as the config is. A link to a folder brings the links in it
    /// along; one to nothing keeps the folder it would be in, where it is
    /// there. A link that leads through one this user could move, or into
    /// no folder there is, is refused, as the config folder that is a link
    /// is ([`steady`]). What leads into a folder the fence hides is hidden
    /// already.
    fn linked(mut read_only: Vec<PathBuf>, hidden: &[PathBuf]) -> io::Result<Vec<PathBuf>> {
        /// The most entries of the config looked at for links.
        const MOST: usize = 20_000;
        let mut folders = read_only.clone();
        let mut seen = 0;
        while let Some(folder) = folders.pop() {
            for entry in std::fs::read_dir(&folder)? {
                let entry = entry?;
                seen += 1;
                if seen > MOST {
                    return Err(io::Error::other(format!(
                        "Banda's config holds more than {MOST} files, too many to look for links in"
                    )));
                }
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    folders.push(entry.path());
                }
                if !kind.is_symlink() {
                    continue;
                }
                let link = entry.path();
                let leads = led(&link)?;
                steady(&leads)?;
                let kept = match dunce::canonicalize(&leads) {
                    Ok(kept) => kept,
                    // A link to nothing yet: what is made there is in the
                    // folder kept read-only.
                    Err(_) => match leads.parent().map(dunce::canonicalize) {
                        Some(Ok(parent)) => parent,
                        _ => {
                            return Err(io::Error::other(format!(
                                "{} is a link into no folder there is: put the file it leads \
                                 to in its place",
                                link.display()
                            )));
                        }
                    },
                };
                let within = |roots: &[PathBuf]| roots.iter().any(|root| kept.starts_with(root));
                if within(&read_only) || within(hidden) {
                    continue;
                }
                if kept.is_dir() {
                    folders.push(kept.clone());
                }
                read_only.push(kept);
            }
        }
        read_only.sort();
        read_only.dedup();
        let outer = read_only.clone();
        read_only.retain(|path| {
            !outer
                .iter()
                .any(|root| path != root && path.starts_with(root))
        });
        Ok(read_only)
    }

    /// Where the link `link` leads, as it names it: from the folder it is
    /// in, resolved, when it names a relative path, its leading `..` taken
    /// there.
    fn led(link: &Path) -> io::Result<PathBuf> {
        use std::path::Component;
        let named = std::fs::read_link(link)?;
        if named.is_absolute() {
            return Ok(named);
        }
        let mut from = match link.parent() {
            Some(parent) => dunce::canonicalize(parent)?,
            None => PathBuf::from("/"),
        };
        let mut parts = named.components().peekable();
        while parts.next_if_eq(&Component::ParentDir).is_some() {
            from.pop();
        }
        Ok(parts.fold(from, |path, part| path.join(part)))
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
            sessions: vec![home.join("tmp/emacs1000")],
            agent: None,
            managers: vec![home.join(".lima")],
            controls: vec![PathBuf::from("/tmp/kitty-")],
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
        for there in [
            PathBuf::from("/tmp/.X11-unix"),
            PathBuf::from("/run/libvirt"),
            home.join("tmp/emacs1000"),
            home.join(".lima"),
        ] {
            assert!(spec.hidden_if_there.contains(&there), "{}", there.display());
        }
        assert_eq!(spec.hidden_starting, [PathBuf::from("/tmp/kitty-")]);
        assert_eq!(spec.owned, [PathBuf::from("/etc/ssh/ssh_config.d")]);
    }

    #[test]
    fn where_a_link_in_the_config_leads_is_kept_read_only_too() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(home.join("run")).unwrap();
        let folders = folders(&home);
        let config = home.join(".config/banda-local");
        std::fs::create_dir_all(config.join("themes")).unwrap();
        let dotfiles = home.join("dotfiles/banda");
        std::fs::create_dir_all(dotfiles.join("themes")).unwrap();
        std::fs::write(dotfiles.join("agents.toml"), "").unwrap();
        std::fs::write(dotfiles.join("themes/dark.toml"), "").unwrap();
        std::fs::create_dir_all(home.join("dotfiles/more")).unwrap();
        std::fs::write(home.join("dotfiles/more/look.toml"), "").unwrap();
        use std::os::unix::fs::symlink as link;
        // A file, by an absolute path; one by a relative path, in a
        // folder; one to nothing yet; one into what the fence hides.
        link(dotfiles.join("agents.toml"), config.join("agents.toml")).unwrap();
        link(
            "../../../dotfiles/more/look.toml",
            config.join("themes/look.toml"),
        )
        .unwrap();
        link(dotfiles.join("keys.toml"), config.join("keys.toml")).unwrap();
        let state = home.join(".local/state/banda-local");
        link(state.join("x.toml"), config.join("x.toml")).unwrap();
        let read_only = |folders: &Folders| base(folders, "b1").unwrap().read_only;
        assert_eq!(
            read_only(&folders),
            [
                config.clone(),
                dotfiles.clone(),
                home.join("dotfiles/more/look.toml"),
            ]
        );

        // A folder, its own links followed: one inside it is kept already,
        // one out of it is kept besides.
        std::fs::remove_file(config.join("keys.toml")).unwrap();
        std::fs::remove_dir_all(config.join("themes")).unwrap();
        link(dotfiles.join("themes"), config.join("themes")).unwrap();
        link(home.join("dotfiles/more"), dotfiles.join("themes/more")).unwrap();
        assert_eq!(
            read_only(&folders),
            [
                config.clone(),
                dotfiles.join("agents.toml"),
                dotfiles.join("themes"),
                home.join("dotfiles/more"),
            ]
        );

        // Through a link this user could move: refused.
        link(home.join("dotfiles"), home.join("df")).unwrap();
        link(home.join("df/banda/agents.toml"), config.join("a2.toml")).unwrap();
        let refused = base(&folders, "b1").unwrap_err().to_string();
        assert!(
            refused.contains("df is a link this user can move"),
            "{refused}"
        );
        std::fs::remove_file(config.join("a2.toml")).unwrap();

        // Into no folder there is: refused.
        link(home.join("gone/agents.toml"), config.join("a3.toml")).unwrap();
        let refused = base(&folders, "b1").unwrap_err().to_string();
        assert!(
            refused.contains("a link into no folder there is"),
            "{refused}"
        );
    }

    #[test]
    fn the_sockets_a_manager_or_a_terminal_listens_on_are_found_by_their_names() {
        assert_eq!(
            base::unix_socket("unix:///home/p/.docker/desktop/docker.sock"),
            Some(PathBuf::from("/home/p/.docker/desktop/docker.sock"))
        );
        assert_eq!(base::unix_socket("tcp://127.0.0.1:2375"), None);
        let conf = "font_size 12\nlisten_on unix:/tmp/mykitty\n  listen_on unix:~/k-{kitty_pid}.sock\nlisten_on unix:@abstract\nlisten_on tcp:localhost:1";
        let (exact, starting) = base::kitty_listens(conf, Some(Path::new("/home/p")));
        assert_eq!(exact, [PathBuf::from("/tmp/mykitty")]);
        assert_eq!(
            starting,
            [PathBuf::from("/tmp/mykitty-"), PathBuf::from("/home/p/k-")]
        );
    }

    #[test]
    fn the_ssh_agent_s_socket_is_a_hole_only_where_it_is_one_reached_steadily() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(home.join("run")).unwrap();
        let socket = home.join("run/ssh");
        let _listening = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        let mut folders = folders(&home);
        let holes = |folders: &Folders| base(folders, "b1").unwrap().holes.writes;

        folders.agent = Some(socket.clone());
        assert_eq!(holes(&folders), std::slice::from_ref(&socket));
        // Through a link this user could move elsewhere: none.
        std::os::unix::fs::symlink(&socket, home.join("agent.sock")).unwrap();
        folders.agent = Some(home.join("agent.sock"));
        assert!(holes(&folders).is_empty());
        // A folder, or a socket the fence does not hide: none.
        std::fs::create_dir(home.join("run/keyring")).unwrap();
        folders.agent = Some(home.join("run/keyring"));
        assert!(holes(&folders).is_empty());
        let outside = home.join("outside.sock");
        let _there = std::os::unix::net::UnixListener::bind(&outside).unwrap();
        folders.agent = Some(outside);
        assert!(holes(&folders).is_empty());
    }

    #[test]
    fn a_session_bus_s_socket_is_hidden_by_its_path() {
        assert_eq!(
            base::bus_sockets("unix:path=/tmp/dbus-1,guid=a;unix:abstract=/tmp/x;tcp:host=h"),
            [PathBuf::from("/tmp/dbus-1")]
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
