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
                let base = base(&folders, build.unwrap_or_default());
                base.map(|(spec, _)| spec)
                    .map_err(|error| error.to_string())
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
/// them ([`banda_kernel::host::guard`]), and its own git, which reads what
/// an Agent writes, starts behind the fence too
/// ([`banda_kernel::host::fence_books`]). Where the fence was set up and
/// failed, its programs are found so all the same: what failed may be
/// what an Agent left. Until it is designed whole, the fence is off
/// unless `BANDA_FENCE=on` turns it on (ADR 0115): Banda is written in
/// Banda, and the fence still stands in its way.
pub async fn environment(places: &crate::places::Places) -> banda_environments::Fenced {
    use banda_kernel::{Fence, FenceWhy};
    let environment = found(places).await;
    let fence = banda_kernel::Environment::fence(&environment);
    if let Fence::Holds { .. }
    | Fence::Missing {
        why: FenceWhy::SetupFailed,
        ..
    } = fence
    {
        banda_kernel::host::guard();
    }
    if let Some(books) = environment.books() {
        banda_kernel::host::fence_books(books);
    }
    logged(&fence);
    environment
}

async fn found(places: &crate::places::Places) -> banda_environments::Fenced {
    use banda_environments::Local;
    use banda_kernel::{Fence, FenceWhy};
    if std::env::var("BANDA_FENCE").map_or(true, |said| said != "on") {
        let words = "The fence is off until it is designed whole; BANDA_FENCE=on turns it on.";
        return Local::unfenced(Fence::missing(FenceWhy::Off, words));
    }
    #[cfg(target_os = "linux")]
    {
        let Some(build) = build_id::own() else {
            let words = "This banda has no build id, so it starts no fence.";
            return Local::unfenced(Fence::missing(FenceWhy::SetupFailed, words));
        };
        let based = Folders::here(places).and_then(|folders| {
            let (base, movable) = base(&folders, &build)?;
            let agents = ssh_agents(&folders, &base);
            Ok((base, movable, agents))
        });
        let (base, movable, agents) = match based {
            Ok(based) => based,
            Err(error) => {
                let words = format!("The fence's folders: {error}");
                return Local::unfenced(Fence::missing(FenceWhy::SetupFailed, words));
            }
        };
        let launcher = std::path::Path::new(banda_fence::LAUNCHER);
        let movable = (movable.iter()).map(|link| link.display().to_string());
        let fence = banda_environments::probe(&base, launcher).await;
        Local::fenced(base, fence.with_movable(movable.collect())).ssh_agents(agents)
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
            layers, movable, ..
        } if !movable.is_empty() => tracing::warn!(
            ?layers,
            ?movable,
            "the fence holds partly: these links in what it keeps read-only lead through one \
             this user can move, or into no folder there is, so an Agent could lead them \
             elsewhere; new Threads start Supervised"
        ),
        Fence::Holds {
            layers,
            docker_group: true,
            ..
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
pub use base::{Folders, base, ssh_agents};

#[cfg(target_os = "linux")]
mod base {
    use crate::places::{FOLDERS, Places, state_base};
    use rustix::fs::Access;
    use std::io;
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    use std::path::{Path, PathBuf};

    /// Where this Banda's folders are, and every Banda's, and the
    /// session's, and its SSH agents' sockets: all [`base`] and
    /// [`ssh_agents`] read.
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
        /// The session's runtime folders: the one `XDG_RUNTIME_DIR` names,
        /// and this user's in `/run/user`, where it is another.
        pub runtime: Vec<PathBuf>,
        /// tmux's folder of this user's sockets.
        pub tmux: PathBuf,
        /// Where other programs of the session take what they are told,
        /// when they run: screen's, Emacs's and zellij's folders of this
        /// user's sockets, and the session bus's socket outside the runtime
        /// folder.
        pub sessions: Vec<PathBuf>,
        /// The SSH agent's socket, as `SSH_AUTH_SOCK` names it.
        pub agent: Option<PathBuf>,
        /// Where else the Person's SSH agents keep their sockets: those
        /// their ssh config names as `IdentityAgent`, and the well-known
        /// agents' own, 1Password's folder, Bitwarden's and GnuPG's.
        pub agents: Vec<PathBuf>,
        /// Where ssh-agent makes the folder of its socket, as the start of
        /// its name: `ssh-` in `/tmp`, and in `TMPDIR`.
        pub agent_folders: Vec<PathBuf>,
        /// gh's config folder, which holds its sign-in
        /// ([`banda_kernel::gh::folder`]).
        pub gh: Option<PathBuf>,
        /// Where the container and machine managers of this user take
        /// what they are told, beside the system's: Docker Desktop's,
        /// Rancher Desktop's, Lima's and Colima's folders in the home, or
        /// where `LIMA_HOME` and `COLIMA_HOME` move them; the sockets
        /// `DOCKER_HOST` and `CONTAINER_HOST` name, and each of Docker's
        /// contexts.
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
            // has none named, or another, and the session's is there all
            // the same.
            let mut runtime: Vec<PathBuf> =
                (set("XDG_RUNTIME_DIR").map(PathBuf::from).into_iter()).collect();
            runtime.push(PathBuf::from(format!("/run/user/{uid}")));
            runtime.retain(|at| at.is_dir());
            runtime.dedup();
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
            managers.extend(
                ["LIMA_HOME", "COLIMA_HOME"]
                    .into_iter()
                    .filter_map(set)
                    .map(PathBuf::from),
            );
            for variable in ["DOCKER_HOST", "CONTAINER_HOST"] {
                let named = set(variable).and_then(|host| unix_socket(&host.to_string_lossy()));
                managers.extend(named);
            }
            // Docker's contexts and kitty's config are files an Agent may
            // write: what they name is taken as a hint, kept only where a
            // socket is now. What would cover what the fence needs the
            // launcher leaves out besides.
            let docker = (set("DOCKER_CONFIG").map(PathBuf::from))
                .or_else(|| home.as_ref().map(|home| home.join(".docker")));
            let contexts = docker.iter().flat_map(|docker| docker_contexts(docker));
            managers.extend(contexts.filter(|path| socket_now(path)));
            let mut agents: Vec<PathBuf> = Vec::new();
            if let Some(home) = &home {
                agents.extend(WELL_KNOWN_AGENTS.map(|at| home.join(at)));
                agents.extend(identity_agents(home));
            }
            let mut agent_folders = vec![PathBuf::from("/tmp/ssh-")];
            agent_folders.extend(set("TMPDIR").map(|tmp| PathBuf::from(tmp).join("ssh-")));
            let mut controls = vec![PathBuf::from("/tmp/kitty-")];
            if let Some(config) = dirs::config_dir() {
                let conf = std::fs::read_to_string(config.join("kitty/kitty.conf"));
                let (exact, starting) = kitty_listens(&conf.unwrap_or_default(), home.as_deref());
                managers.extend(exact.into_iter().filter(|path| socket_now(path)));
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
                agents: agents.into_iter().filter_map(plain).collect(),
                agent_folders: agent_folders.into_iter().filter_map(plain).collect(),
                gh: banda_kernel::gh::folder(),
                managers: managers.into_iter().filter_map(plain).collect(),
                controls: controls.into_iter().filter_map(plain).collect(),
                running: std::env::current_exe()?,
            })
        }
    }

    /// Whether `path` is a socket now, itself and not a link to one.
    pub(super) fn socket_now(path: &Path) -> bool {
        use std::os::unix::fs::FileTypeExt;
        std::fs::symlink_metadata(path).is_ok_and(|found| found.file_type().is_socket())
    }

    /// Where the well-known SSH agents keep their sockets, in the home:
    /// 1Password's folder, which holds its socket alone, Bitwarden's
    /// socket, as installed and as a Flatpak, and GnuPG's, where the
    /// session has no runtime folder.
    const WELL_KNOWN_AGENTS: [&str; 4] = [
        ".1password",
        ".bitwarden-ssh-agent.sock",
        ".var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock",
        ".gnupg/S.gpg-agent.ssh",
    ];

    /// The most files of the Person's ssh config read for agents.
    const SSH_CONFIGS: usize = 32;

    /// Where the Person's ssh config, `~/.ssh/config` and the files it
    /// includes, tells ssh to find an agent: each `IdentityAgent` that
    /// names a socket by its path, or by a variable other than
    /// `SSH_AUTH_SOCK`.
    pub(super) fn identity_agents(home: &Path) -> Vec<PathBuf> {
        let ssh = home.join(".ssh");
        let (mut files, mut found, mut read) = (vec![ssh.join("config")], Vec::new(), 0);
        while let Some(file) = files.pop() {
            read += 1;
            if read > SSH_CONFIGS {
                break;
            }
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            for (key, value) in ssh_options(&text) {
                if key.eq_ignore_ascii_case("IdentityAgent") {
                    found.extend(agent_named(value, home));
                } else if key.eq_ignore_ascii_case("Include") {
                    for pattern in value.split_whitespace() {
                        files.extend(included(pattern, home, &ssh));
                    }
                }
            }
        }
        found
    }

    /// Each option `text` sets, as ssh reads its config: a keyword, then
    /// its value after spaces or an `=`, a line each; `#` starts a comment.
    fn ssh_options(text: &str) -> impl Iterator<Item = (&str, &str)> {
        text.lines().filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let end = line.find(|c: char| c.is_whitespace() || c == '=')?;
            let (key, rest) = line.split_at(end);
            let rest = rest.trim_start();
            Some((key, rest.strip_prefix('=').unwrap_or(rest).trim()))
        })
    }

    /// The socket an `IdentityAgent` value names: none for `none`, or for
    /// `SSH_AUTH_SOCK`, which [`Folders::agent`] is.
    fn agent_named(value: &str, home: &Path) -> Option<PathBuf> {
        let value = value.trim_matches('"');
        if value.eq_ignore_ascii_case("none") {
            return None;
        }
        // A variable's name alone: the socket is where it says.
        let variable = (value.strip_prefix('$')).or((value == "SSH_AUTH_SOCK").then_some(value));
        if let Some(name) = variable.filter(|name| !name.starts_with('{')) {
            return (name != "SSH_AUTH_SOCK")
                .then(|| std::env::var_os(name))
                .flatten()
                .map(PathBuf::from)
                .filter(|path| path.is_absolute());
        }
        expanded(value, home)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    }

    /// The files an `Include` pattern names: in `~/.ssh` when it is not
    /// absolute, by a `*` or `?` in its last part.
    fn included(pattern: &str, home: &Path, ssh: &Path) -> Vec<PathBuf> {
        let Some(pattern) = expanded(pattern.trim_matches('"'), home) else {
            return Vec::new();
        };
        let path = ssh.join(pattern);
        let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
            return Vec::new();
        };
        let name = name.to_string_lossy();
        if !name.contains(['*', '?']) {
            return vec![path.clone()];
        }
        if folder.to_string_lossy().contains(['*', '?']) {
            return Vec::new();
        }
        let Ok(entries) = std::fs::read_dir(folder) else {
            return Vec::new();
        };
        let mut found: Vec<PathBuf> = (entries.flatten())
            .filter(|entry| {
                let file = entry.file_name();
                let file = file.to_string_lossy();
                (name.starts_with('.') || !file.starts_with('.')) && matches(&name, &file)
            })
            .map(|entry| entry.path())
            .collect();
        found.sort();
        found
    }

    /// Whether `name` matches `pattern`, its `*` any run of characters and
    /// its `?` any one.
    pub(super) fn matches(pattern: &str, name: &str) -> bool {
        let (pattern, name): (Vec<char>, Vec<char>) =
            (pattern.chars().collect(), name.chars().collect());
        let (mut p, mut n, mut star, mut from) = (0, 0, None, 0);
        while n < name.len() {
            if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
                (p, n) = (p + 1, n + 1);
            } else if p < pattern.len() && pattern[p] == '*' {
                (star, from, p) = (Some(p), n, p + 1);
            } else if let Some(at) = star {
                (p, from) = (at + 1, from + 1);
                n = from;
            } else {
                return false;
            }
        }
        pattern[p..].iter().all(|c| *c == '*')
    }

    /// `value` as ssh expands a path in its config: `~` and `%d` the home,
    /// `%u` the user, `%i` their number, `%%` a `%`, `${NAME}` the
    /// variable's value; none with another token, or a variable not set.
    pub(super) fn expanded(value: &str, home: &Path) -> Option<String> {
        let home = home.to_str()?;
        let mut out = String::new();
        let rest = match value.strip_prefix('~') {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => {
                out.push_str(home);
                rest
            }
            _ => value,
        };
        let mut chars = rest.chars();
        while let Some(c) = chars.next() {
            match c {
                '%' => match chars.next()? {
                    'd' => out.push_str(home),
                    'u' => out.push_str(&std::env::var("USER").ok()?),
                    'i' => out.push_str(&rustix::process::getuid().as_raw().to_string()),
                    '%' => out.push('%'),
                    _ => return None,
                },
                '$' if chars.as_str().starts_with('{') => {
                    let (name, after) = chars.as_str()[1..].split_once('}')?;
                    out.push_str(&std::env::var(name).ok()?);
                    chars = after.chars();
                }
                c => out.push(c),
            }
        }
        Some(out)
    }

    /// The socket a `unix://` address names, as `DOCKER_HOST` does.
    pub(super) fn unix_socket(address: &str) -> Option<PathBuf> {
        address.strip_prefix("unix://").map(PathBuf::from)
    }

    /// The socket each of Docker's contexts in the config folder `docker`
    /// reaches its engine on, as `docker context create` keeps it:
    /// `contexts/meta/<hash>/meta.json`, `Endpoints.docker.Host`.
    pub(super) fn docker_contexts(docker: &Path) -> Vec<PathBuf> {
        /// The most contexts read.
        const MOST: usize = 64;
        let Ok(contexts) = std::fs::read_dir(docker.join("contexts/meta")) else {
            return Vec::new();
        };
        (contexts.flatten().take(MOST))
            .filter_map(|context| std::fs::read(context.path().join("meta.json")).ok())
            .filter_map(|meta| serde_json::from_slice::<serde_json::Value>(&meta).ok())
            .filter_map(|meta| unix_socket(meta["Endpoints"]["docker"]["Host"].as_str()?))
            .collect()
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
    /// folders and tmux's, hidden, the SSH agent's socket in them too but
    /// for a program given it ([`ssh_agents`]); the display's, the other
    /// sessions' and the container and machine managers' sockets, hidden
    /// where they are; and every Banda's config and gh's, read-only, so no
    /// Agent signs gh in for every Project's.
    ///
    /// It makes this Banda's folders and the others' it hides that are not
    /// there yet, `0700`, and gh's, so the fence covers each where it will
    /// be looked for. It refuses a folder it hides reached through a link
    /// this user could move (see [`steady`]). What it keeps read-only that
    /// is such a link, or leads through one, it keeps where it leads now,
    /// and says beside the spec: an Agent could lead it elsewhere.
    pub fn base(folders: &Folders, build: &str) -> io::Result<(banda_fence::Spec, Vec<PathBuf>)> {
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
        for runtime in &folders.runtime {
            hidden.push(kept(runtime)?);
        }
        hidden.sort();
        hidden.dedup();

        let mut movable = Vec::new();
        made(&folders.config)?;
        let mut read_only = Vec::new();
        read_only_kept(&folders.config, &mut read_only, &mut movable)?;
        if let Some(under) = &folders.config_base {
            for folder in FOLDERS.map(|folder| under.join(folder)) {
                if std::fs::symlink_metadata(&folder).is_ok() {
                    read_only_kept(&folder, &mut read_only, &mut movable)?;
                }
            }
        }
        let gh =
            (folders.gh.as_ref()).filter(|gh| !hidden.iter().any(|folder| gh.starts_with(folder)));
        if let Some(gh) = gh {
            match made(gh) {
                Ok(()) => read_only_kept(gh, &mut read_only, &mut movable)?,
                Err(_) => movable.push(gh.clone()),
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
        let read_only = linked(read_only, &hidden, &mut movable)?;
        movable.sort();
        movable.dedup();
        let spec = banda_fence::Spec {
            build: build.to_owned(),
            hidden,
            hidden_if_there,
            hidden_starting: folders.controls.clone(),
            read_only,
            owned: vec![PathBuf::from("/etc/ssh/ssh_config.d")],
            holes: banda_fence::Holes {
                runs: runs.into_iter().collect(),
                ..banda_fence::Holes::default()
            },
            cwd: None,
        };
        Ok((spec, movable))
    }

    /// Keeps `path` among `read_only` where it is ([`kept`]); where it is
    /// a link this user could move, or one leads to it, where it leads
    /// now, and the path among `movable`.
    fn read_only_kept(
        path: &Path,
        read_only: &mut Vec<PathBuf>,
        movable: &mut Vec<PathBuf>,
    ) -> io::Result<()> {
        if steady(path).is_ok() {
            read_only.push(kept(path)?);
            return Ok(());
        }
        movable.push(path.to_owned());
        read_only.extend(dunce::canonicalize(path));
        Ok(())
    }

    /// The Person's SSH agents, as a program behind the fence over `base`
    /// would find them (ADR 0083, F0-3). A program given the agent, a
    /// Harness's in a Project whose trust the Person said, reaches the one
    /// `SSH_AUTH_SOCK` names: through a hole where it is in a folder `base`
    /// hides, as the session's runtime folder, so the folder's other
    /// sockets, as the keyring's, stay out of reach; as it is where it is
    /// in sight. One not given it has every agent's socket in sight
    /// hidden, the one `SSH_AUTH_SOCK` names and those of [`Folders::agents`]
    /// and [`Folders::agent_folders`], where each is when it starts.
    pub fn ssh_agents(
        folders: &Folders,
        base: &banda_fence::Spec,
    ) -> banda_environments::SshAgents {
        let hidden = |path: &Path| base.hidden.iter().any(|folder| path.starts_with(folder));
        // Where each is, its links followed, where it is there yet.
        let at = |named: &Path| dunce::canonicalize(named).unwrap_or_else(|_| named.to_owned());
        let named = folders.agent.as_deref().filter(|named| named.is_absolute());
        let mut in_sight: Vec<PathBuf> = (named.into_iter())
            .chain(folders.agents.iter().map(PathBuf::as_path))
            .map(at)
            .filter_map(plain)
            .filter(|socket| !hidden(socket) && shaped(socket))
            .collect();
        in_sight.sort();
        in_sight.dedup();
        banda_environments::SshAgents {
            hole: named.and_then(|named| agent_socket(named, &base.hidden)),
            named_in_sight: named.is_some_and(|named| !hidden(&at(named))),
            in_sight,
            starting: folders.agent_folders.clone(),
        }
    }

    /// Whether the fence can cover `path` when it is there: the nearest of
    /// the folders above it that is there is a folder.
    fn shaped(path: &Path) -> bool {
        (path.ancestors().skip(1))
            .find(|above| std::fs::symlink_metadata(above).is_ok())
            .is_none_or(Path::is_dir)
    }

    /// The socket `named`, where it is one in `hidden`. It must be this
    /// user's socket, reached through no link this user could move, which
    /// could lead the hole to another. A socket gone by the time a program
    /// starts is left out then.
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
    /// there. A link that leads through one this user could move
    /// ([`steady`]), or into no folder there is, goes among `movable`: an
    /// Agent could lead it elsewhere. What leads into a folder the fence
    /// hides is hidden already.
    fn linked(
        mut read_only: Vec<PathBuf>,
        hidden: &[PathBuf],
        movable: &mut Vec<PathBuf>,
    ) -> io::Result<Vec<PathBuf>> {
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
                // A link to nothing yet: what is made there is in the
                // folder kept read-only.
                let kept = (dunce::canonicalize(&leads).ok())
                    .or_else(|| dunce::canonicalize(leads.parent()?).ok());
                if steady(&leads).is_err() || kept.is_none() {
                    movable.push(link);
                }
                let Some(kept) = kept else {
                    continue;
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
            runtime: vec![home.join("run")],
            tmux: home.join("tmp/tmux-1000"),
            sessions: vec![home.join("tmp/emacs1000")],
            agent: None,
            agents: Vec::new(),
            agent_folders: vec![PathBuf::from("/tmp/ssh-")],
            gh: None,
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
        // This Banda's state, moved; and the session's runtime folder
        // named elsewhere than this user's own.
        folders.state = home.join("moved/state");
        std::fs::create_dir(home.join("user-run")).unwrap();
        folders.runtime.push(home.join("user-run"));
        // gh's config, not there yet.
        folders.gh = Some(home.join(".config/gh"));
        let (spec, movable) = base(&folders, "b1").unwrap();
        assert!(movable.is_empty(), "{movable:?}");
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
                "user-run",
            ])
        );
        for made in &spec.hidden {
            assert!(made.is_dir(), "{}", made.display());
        }
        // Each Banda's config that is there, and this one's, made; and
        // gh's, made, so no Agent signs gh in there for every Project's.
        assert_eq!(
            spec.read_only,
            under(&[".config/banda-dev", ".config/banda-local", ".config/gh"])
        );
        assert!(home.join(".config/gh").is_dir());
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
        let read_only = |folders: &Folders| {
            let (spec, movable) = base(folders, "b1").unwrap();
            assert!(movable.is_empty(), "{movable:?}");
            spec.read_only
        };
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

        // Through a link this user could move: kept where it leads now,
        // and said, as an Agent could lead it elsewhere.
        link(home.join("dotfiles"), home.join("df")).unwrap();
        link(home.join("df/banda/agents.toml"), config.join("a2.toml")).unwrap();
        let (spec, movable) = base(&folders, "b1").unwrap();
        assert_eq!(movable, [config.join("a2.toml")]);
        assert!(spec.read_only.contains(&dotfiles.join("agents.toml")));
        std::fs::remove_file(config.join("a2.toml")).unwrap();

        // Into no folder there is: said, with nothing to keep.
        link(home.join("gone/agents.toml"), config.join("a3.toml")).unwrap();
        let (spec, movable) = base(&folders, "b1").unwrap();
        assert_eq!(movable, [config.join("a3.toml")]);
        assert!(
            !spec
                .read_only
                .iter()
                .any(|kept| kept.starts_with(home.join("gone")))
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
        let agents = |folders: &Folders| {
            let (base, _) = base(folders, "b1").unwrap();
            assert!(base.holes.writes.is_empty(), "no hole of the base's");
            ssh_agents(folders, &base)
        };
        let hole = |folders: &Folders| agents(folders).hole;

        folders.agent = Some(socket.clone());
        assert_eq!(hole(&folders), Some(socket.clone()));
        assert!(!agents(&folders).named_in_sight);
        assert!(agents(&folders).in_sight.is_empty(), "hidden already");
        // Through a link this user could move elsewhere: none.
        std::os::unix::fs::symlink(&socket, home.join("agent.sock")).unwrap();
        folders.agent = Some(home.join("agent.sock"));
        assert_eq!(hole(&folders), None);
        assert!(!agents(&folders).named_in_sight);
        // A folder the fence hides: none.
        std::fs::create_dir(home.join("run/keyring")).unwrap();
        folders.agent = Some(home.join("run/keyring"));
        assert_eq!(hole(&folders), None);
    }

    /// An agent's socket the fence does not hide, as ssh-agent's in
    /// `/tmp` or 1Password's in the home, is in sight: a program given
    /// the agent keeps the variable, and one not given it has the socket
    /// hidden, with the others' (ADR 0083, F0-3).
    #[test]
    fn an_agent_s_socket_in_sight_is_kept_from_a_program_not_given_it() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(home.join("run")).unwrap();
        let outside = home.join("tmp/ssh-x/agent.1");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        let _there = std::os::unix::net::UnixListener::bind(&outside).unwrap();
        // Named through a link: where it leads is what is hidden.
        std::os::unix::fs::symlink(&outside, home.join("agent.sock")).unwrap();
        let mut folders = folders(&home);
        folders.agent = Some(home.join("agent.sock"));
        folders.agents = vec![
            home.join(".1password"),
            home.join("run/gnupg/S.gpg-agent.ssh"),
            home.join("file/inside"),
        ];
        std::fs::write(home.join("file"), "").unwrap();
        let (base, _) = base(&folders, "b1").unwrap();
        let agents = ssh_agents(&folders, &base);
        assert_eq!(agents.hole, None);
        assert!(agents.named_in_sight);
        // One in a folder hidden already, or under a file, is left out.
        assert_eq!(agents.in_sight, [home.join(".1password"), outside]);
        assert_eq!(agents.starting, [PathBuf::from("/tmp/ssh-")]);
    }

    #[test]
    fn the_ssh_config_s_agents_are_found_where_it_and_what_it_includes_name_them() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir_all(home.join(".ssh/config.d")).unwrap();
        std::fs::write(
            home.join(".ssh/config"),
            "# mine\nInclude config.d/*.conf ~/more\nHost *\n  IdentityAgent ~/.1password/agent.sock\nHost a\n  identityagent=\"%d/a b.sock\"\nHost b\n  IdentityAgent none\nHost c\n  IdentityAgent SSH_AUTH_SOCK\nHost d\n  IdentityAgent $SSH_AUTH_SOCK\nHost e\n  IdentityAgent %h.sock\n",
        )
        .unwrap();
        std::fs::write(
            home.join(".ssh/config.d/one.conf"),
            "IdentityAgent = /tmp/one.sock\n",
        )
        .unwrap();
        std::fs::write(
            home.join(".ssh/config.d/two.txt"),
            "IdentityAgent /tmp/two.sock\n",
        )
        .unwrap();
        std::fs::write(home.join("more"), "IdentityAgent ${HOME}/more.sock\n").unwrap();
        let mut found = base::identity_agents(&home);
        found.sort();
        let mut wanted = vec![
            home.join(".1password/agent.sock"),
            home.join("a b.sock"),
            PathBuf::from("/tmp/one.sock"),
        ];
        if let Ok(own) = std::env::var("HOME") {
            wanted.push(PathBuf::from(own).join("more.sock"));
        }
        wanted.sort();
        assert_eq!(found, wanted);
        assert!(base::matches("*.conf", "one.conf") && !base::matches("*.conf", "two.txt"));
        assert!(base::matches("a?c*", "abcdef") && !base::matches("a?c", "ac"));
    }

    #[test]
    fn a_session_bus_s_socket_is_hidden_by_its_path() {
        assert_eq!(
            base::bus_sockets("unix:path=/tmp/dbus-1,guid=a;unix:abstract=/tmp/x;tcp:host=h"),
            [PathBuf::from("/tmp/dbus-1")]
        );
    }

    #[test]
    fn each_of_docker_s_contexts_is_found_by_the_socket_it_reaches() {
        let t = tempfile::tempdir().unwrap();
        let docker = t.path().join(".docker");
        for (hash, host) in [
            ("a1", "unix:///home/p/.colima/work/docker.sock"),
            ("b2", "tcp://10.0.0.2:2376"),
        ] {
            let meta = docker.join("contexts/meta").join(hash);
            std::fs::create_dir_all(&meta).unwrap();
            let json =
                format!(r#"{{"Name":"{hash}","Endpoints":{{"docker":{{"Host":"{host}"}}}}}}"#);
            std::fs::write(meta.join("meta.json"), json).unwrap();
        }
        assert_eq!(
            base::docker_contexts(&docker),
            [PathBuf::from("/home/p/.colima/work/docker.sock")]
        );
        assert!(base::docker_contexts(&t.path().join("none")).is_empty());
    }

    #[test]
    fn a_place_a_hint_names_is_kept_only_where_a_socket_is_now() {
        let t = tempfile::tempdir().unwrap();
        let socket = t.path().join("docker.sock");
        let _listening = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert!(base::socket_now(&socket));
        let folder = t.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        assert!(!base::socket_now(&folder), "a folder an Agent named");
        let link = t.path().join("link");
        std::os::unix::fs::symlink(&socket, &link).unwrap();
        assert!(!base::socket_now(&link), "a link to one");
        assert!(!base::socket_now(&t.path().join("gone")));
    }

    #[test]
    fn a_hidden_folder_through_a_movable_link_is_refused_and_a_config_one_is_said() {
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

        // The config, itself a link: kept where it leads now, and said.
        std::fs::create_dir_all(home.join("dotfiles/banda-local")).unwrap();
        std::fs::create_dir(home.join(".config")).unwrap();
        let config = home.join(".config/banda-local");
        std::os::unix::fs::symlink(home.join("dotfiles/banda-local"), &config).unwrap();
        let (spec, movable) = base(&folders, "b1").unwrap();
        assert_eq!(movable, [config]);
        assert!(spec.read_only.contains(&home.join("dotfiles/banda-local")));
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
