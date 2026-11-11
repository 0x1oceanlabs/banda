//! The `local` environment with the fence (ADR 0083, decision 1): a
//! Harness's programs, and its CLI asked about itself, start behind
//! `banda fence` where the fence holds, each with its Project's holes in
//! it; the Person's own, a terminal and a git act, start as [`Local`]
//! starts them. Where the fence does not hold, every program starts so,
//! and the environment says why ([`Environment::fence`]).
//!
//! The engine finds whether the fence holds once, as it starts, from the
//! probe over its own base ([`probe`]), and says so in its `welcome`.
//!
//! The SSH agent goes with trust (ADR 0083, F0-3): a program reaches the
//! one `SSH_AUTH_SOCK` names only when its holes say so
//! ([`Holes::ssh_agent`](banda_kernel::Holes)), as a Harness's in a Project
//! whose trust the Person said does. Any other starts without the
//! variable, and with every agent's socket the engine found hidden
//! ([`SshAgents`]).

use crate::local::Local;
use banda_kernel::{Environment, Fence, Input, Program, Pty, PtySize, Started};
#[cfg(target_os = "linux")]
use banda_kernel::{FenceLayer, FenceWhy};
#[cfg(target_os = "linux")]
use banda_kernel::{Holes, SSH_AGENT};
use std::io;
#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

/// The variables that move where an engine keeps its state, data, cache
/// and Spaces: a program behind the fence never gets them, so a `banda` it
/// runs reaches the engine by its pass alone, and looks for none of the
/// folders the fence hides. `BANDA_CONFIG` stays: it reads Banda's config,
/// which it cannot change.
#[cfg(target_os = "linux")]
const ENGINES_OWN: [&str; 4] = ["BANDA_STATE", "BANDA_DATA", "BANDA_ROOT", "BANDA_CACHE"];

/// How long a program may take to start behind the fence before its
/// environment stops waiting to hear that it did.
#[cfg(target_os = "linux")]
const STARTS_WITHIN: std::time::Duration = std::time::Duration::from_secs(5);

/// How long the probe may take.
#[cfg(target_os = "linux")]
const PROBED_WITHIN: std::time::Duration = std::time::Duration::from_secs(20);

/// Runs a Project's programs on the host, a Harness's behind the fence
/// where it holds.
#[derive(Clone, Debug)]
pub struct Fenced {
    /// What the fence keeps from every Harness's program here, whatever its
    /// Project; none where the fence does not hold, as on every system but
    /// Linux yet.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    base: Option<Arc<banda_fence::Spec>>,
    /// The Person's SSH agents, as the engine found them
    /// ([`Fenced::ssh_agents`]).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    agents: SshAgents,
    fence: Fence,
    /// The `banda` that is the launcher: the engine's own running program.
    launcher: PathBuf,
}

/// The Person's SSH agents, as the engine finds them as it starts (ADR
/// 0083, F0-3): a program given the agent reaches the one `SSH_AUTH_SOCK`
/// names, and one not given it has each socket here hidden, as the
/// program starts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SshAgents {
    /// The socket `SSH_AUTH_SOCK` names, where it is in a folder the base
    /// hides, as the session's runtime folder: a program given the agent
    /// reaches it through a hole of its own.
    pub hole: Option<PathBuf>,
    /// Whether the socket `SSH_AUTH_SOCK` names is in sight behind the
    /// fence, in no folder the base hides: a program given the agent keeps
    /// the variable with no hole.
    pub named_in_sight: bool,
    /// Every agent's socket in sight: the one `SSH_AUTH_SOCK` names, those
    /// the Person's ssh config names, and where the well-known agents keep
    /// theirs. Hidden from a program not given the agent.
    pub in_sight: Vec<PathBuf>,
    /// The starts of the names of the folders ssh-agent makes its sockets
    /// in, as `/tmp/ssh-`: those folders are hidden from a program not
    /// given the agent.
    pub starting: Vec<PathBuf>,
}

impl Local {
    /// `Local`, with each Harness's program behind the fence `base`
    /// describes, where the probe found that it holds (`fence`); where it
    /// does not, every program starts as `Local` starts it.
    pub fn fenced(base: banda_fence::Spec, fence: Fence) -> Fenced {
        let holds = cfg!(target_os = "linux") && matches!(fence, Fence::Holds { .. });
        Fenced {
            base: holds.then(|| Arc::new(base)),
            agents: SshAgents::default(),
            fence,
            launcher: launcher(),
        }
    }

    /// `Local`, which says why there is no fence here: none on this
    /// system yet, or off until `BANDA_FENCE=on` (ADR 0115).
    pub fn unfenced(fence: Fence) -> Fenced {
        Fenced {
            base: None,
            agents: SshAgents::default(),
            fence,
            launcher: launcher(),
        }
    }
}

/// The running program, which is the launcher too.
fn launcher() -> PathBuf {
    #[cfg(target_os = "linux")]
    return PathBuf::from(banda_fence::LAUNCHER);
    #[cfg(not(target_os = "linux"))]
    return PathBuf::new();
}

impl Fenced {
    /// The `banda` to start as the launcher, for a test whose own program
    /// is not one.
    pub fn launcher(mut self, banda: impl Into<PathBuf>) -> Self {
        self.launcher = banda.into();
        self
    }

    /// The Person's SSH agents `agents`, which the base's caller found
    /// and checked (ADR 0083, F0-3).
    pub fn ssh_agents(mut self, agents: SshAgents) -> Self {
        self.agents = agents;
        self
    }

    /// The hole to the SSH agent's socket a program with `holes` reaches
    /// through: only one they give the agent, while the socket is there.
    #[cfg(target_os = "linux")]
    fn agent_for(&self, holes: &Holes) -> Option<&Path> {
        (self.agents.hole.as_deref()).filter(|socket| holes.ssh_agent && socket.exists())
    }

    /// Whether a program with `holes` keeps `SSH_AUTH_SOCK`: only one they
    /// give the agent, where the socket it names is in sight or bound.
    #[cfg(target_os = "linux")]
    fn keeps_agent(&self, holes: &Holes) -> bool {
        holes.ssh_agent && (self.agents.named_in_sight || self.agent_for(holes).is_some())
    }

    /// What the fence keeps read-only from every Harness's program, where
    /// it holds: every Banda's config and gh's, and where each link in
    /// them leads now. None where it does not hold.
    pub fn kept(&self) -> Vec<PathBuf> {
        #[cfg(target_os = "linux")]
        if let Some(base) = &self.base {
            return base.read_only.clone();
        }
        Vec::new()
    }

    /// How the engine's own bookkeeping starts behind this fence, where it
    /// holds ([`banda_kernel::host::fence_books`]): through the launcher,
    /// behind the base with the base's holes that are there now, the
    /// folders it reads besides opened to it, in the command's folder.
    /// It is given the SSH agent, as Banda's own git was on the host: its
    /// fetch over ssh signs as before, and it runs no program a
    /// repository names.
    pub fn books(&self) -> Option<banda_kernel::host::Fencing> {
        #[cfg(target_os = "linux")]
        if let Some(base) = self.base.clone() {
            let launcher = self.launcher.clone();
            let agent = self.agents.hole.clone();
            return Some(Box::new(move |command, reads| {
                Fenced::bookkeeping(&base, agent.as_deref(), &launcher, command, reads)
            }));
        }
        None
    }

    /// `command`, set to start behind `base` through `launcher`, with
    /// `reads` opened to it and the hole to the SSH agent's socket `agent`:
    /// as [`Fenced::books`] says.
    #[cfg(target_os = "linux")]
    fn bookkeeping(
        base: &banda_fence::Spec,
        agent: Option<&Path>,
        launcher: &Path,
        command: &tokio::process::Command,
        reads: &[PathBuf],
    ) -> io::Result<tokio::process::Command> {
        let asked = command.as_std();
        let sealed = Fenced::books_spec(base, agent, asked, reads)?.seal()?;
        let args: Vec<&std::ffi::OsStr> = asked.get_args().collect();
        let mut started = std::process::Command::new(launcher);
        started.args(banda_fence::argv(&sealed, None, asked.get_program(), &args));
        banda_fence::attach(&mut started, sealed, None);
        for (name, value) in asked.get_envs() {
            match value {
                Some(value) => started.env(name, value),
                None => started.env_remove(name),
            };
        }
        for name in ENGINES_OWN {
            started.env_remove(name);
        }
        let mut command = tokio::process::Command::from(started);
        command.kill_on_drop(true);
        Ok(command)
    }

    /// The spec `asked` starts behind as bookkeeping: the base, with its
    /// own holes and the SSH agent's socket `agent` where they are there
    /// now, `reads` opened to read, and the command's folder, resolved.
    #[cfg(target_os = "linux")]
    fn books_spec(
        base: &banda_fence::Spec,
        agent: Option<&Path>,
        asked: &std::process::Command,
        reads: &[PathBuf],
    ) -> io::Result<banda_fence::Spec> {
        let mut spec = base.clone();
        spec.holes.writes.extend(agent.map(Path::to_owned));
        spec.holes.writes.retain(|hole| hole.exists());
        spec.holes.reads.retain(|hole| hole.exists());
        for read in reads {
            spec.holes.reads.push(dunce::canonicalize(read)?);
        }
        let cwd = match asked.get_current_dir() {
            Some(dir) => dir.to_owned(),
            None => std::env::current_dir()?,
        };
        spec.cwd = Some(dunce::canonicalize(cwd)?);
        Ok(spec)
    }

    /// The spec a program with `holes` starts behind: the base, with those
    /// holes (each made where it is not there yet, as a folder of the
    /// Person's alone) and the program's folder; with the hole to the SSH
    /// agent's socket where they give it the agent, else with every
    /// agent's socket in sight hidden.
    #[cfg(target_os = "linux")]
    fn spec(
        &self,
        base: &banda_fence::Spec,
        program: &Program,
        holes: &Holes,
    ) -> io::Result<banda_fence::Spec> {
        let mut spec = base.clone();
        spec.holes
            .writes
            .extend(self.agent_for(holes).map(Path::to_owned));
        for (from, into) in [
            (&holes.writes, &mut spec.holes.writes),
            (&holes.reads, &mut spec.holes.reads),
        ] {
            for hole in from {
                made(hole)?;
                into.push(dunce::canonicalize(hole)?);
            }
        }
        spec.cwd = program.cwd.clone();
        if !holes.ssh_agent {
            // None that holds a hole or the program's folder, which the
            // fence would refuse to hide.
            let holds = |socket: &PathBuf| {
                (spec.holes.writes.iter())
                    .chain(&spec.holes.reads)
                    .chain(&spec.holes.runs)
                    .chain(&spec.cwd)
                    .any(|inside| inside.starts_with(socket))
            };
            let sockets = self.agents.in_sight.iter().filter(|socket| !holds(socket));
            spec.hidden_if_there.extend(sockets.cloned());
            (spec.hidden_starting).extend(self.agents.starting.iter().cloned());
        }
        Ok(spec)
    }

    /// The launcher, set to start `program` behind the fence, and the end
    /// of the pipe it says on whether the program started. It starts as
    /// [`Local`] starts a program, without the engine's own folders
    /// ([`ENGINES_OWN`]), and without `SSH_AUTH_SOCK` where it does not
    /// reach the SSH agent ([`Fenced::keeps_agent`]).
    #[cfg(target_os = "linux")]
    fn launching(
        &self,
        base: &banda_fence::Spec,
        program: &Program,
        holes: &Holes,
        input: Input,
    ) -> io::Result<(tokio::process::Command, banda_fence::Hears)> {
        use std::process::Stdio;
        let sealed = self.spec(base, program, holes)?.seal()?;
        let (hears, tells) = banda_fence::status()?;
        let mut command = std::process::Command::new(&self.launcher);
        command.args(banda_fence::argv(
            &sealed,
            Some(&tells),
            &program.program,
            &program.args,
        ));
        banda_fence::attach(&mut command, sealed, Some(tells));
        let mut command = tokio::process::Command::from(command);
        for name in program.unset.iter().map(String::as_str).chain(ENGINES_OWN) {
            command.env_remove(name);
        }
        if !self.keeps_agent(holes) {
            command.env_remove(SSH_AGENT);
        }
        command
            .envs(&program.env)
            .stdin(match input {
                Input::Null => Stdio::null(),
                Input::Piped => Stdio::piped(),
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Ok((command, hears))
    }

    #[cfg(target_os = "linux")]
    fn behind(
        &self,
        base: &banda_fence::Spec,
        program: &Program,
        holes: &Holes,
        input: Input,
    ) -> io::Result<Started> {
        let (command, hears) = self.launching(base, program, holes, input)?;
        // Its end of the status pipe goes with the command, so the pipe
        // ends once the program runs.
        let started = Started::spawn(command)?;
        // Within milliseconds, as a rule: off the runtime's own threads,
        // where it has others for them.
        let heard = || hears.started(STARTS_WITHIN);
        match tokio::runtime::Handle::try_current().map(|runtime| runtime.runtime_flavor()) {
            Ok(tokio::runtime::RuntimeFlavor::MultiThread) => tokio::task::block_in_place(heard),
            _ => heard(),
        }?;
        Ok(started)
    }
}

impl Environment for Fenced {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Started> {
        #[cfg(target_os = "linux")]
        if let (Some(base), Some(holes)) = (&self.base, program.holes()) {
            return self.behind(base, program, holes, input);
        }
        Local.spawn(program, input)
    }

    fn pty(&self, program: &Program, size: PtySize) -> io::Result<(Started, Pty)> {
        Local.pty(program, size)
    }

    fn fence(&self) -> Fence {
        self.fence.clone()
    }
}

/// Makes the folder `hole` where it is not there yet, the Person's alone.
#[cfg(target_os = "linux")]
fn made(hole: &Path) -> io::Result<()> {
    if hole.exists() {
        return Ok(());
    }
    let mut folders = std::fs::DirBuilder::new();
    folders.recursive(true);
    std::os::unix::fs::DirBuilderExt::mode(&mut folders, 0o700);
    folders.create(hole)
}

/// Whether the fence holds over `base` here, from doing it: `banda fence
/// --probe` (the `launcher`) sets it up for real, checks it from inside and
/// runs a program behind it. It says why it does not hold in the
/// Person's terms: AppArmor's, where that is what keeps the namespaces
/// away. A fence that holds says too whether this user is in the `docker`
/// group.
#[cfg(target_os = "linux")]
pub async fn probe(base: &banda_fence::Spec, launcher: &Path) -> Fence {
    match probed(base, launcher).await {
        Ok(banda_fence::Probe::Holds { layers }) => Fence::holds(
            (layers.into_iter())
                .map(|layer| match layer {
                    banda_fence::Layer::Namespaces => FenceLayer::Namespaces,
                    banda_fence::Layer::Landlock => FenceLayer::Landlock,
                })
                .collect(),
            in_docker_group(),
        ),
        Ok(banda_fence::Probe::Missing { why, words }) => {
            let why = match why {
                banda_fence::Why::NoUserNamespaces | banda_fence::Why::Refused
                    if apparmor_restricts() =>
                {
                    FenceWhy::AppArmor
                }
                banda_fence::Why::NoUserNamespaces => FenceWhy::NoUserNamespaces,
                banda_fence::Why::Refused => FenceWhy::Refused,
                banda_fence::Why::SetupFailed => FenceWhy::SetupFailed,
                banda_fence::Why::UnsupportedOs => FenceWhy::UnsupportedOs,
            };
            Fence::missing(why, words)
        }
        Err(words) => Fence::missing(FenceWhy::SetupFailed, words),
    }
}

#[cfg(target_os = "linux")]
async fn probed(base: &banda_fence::Spec, launcher: &Path) -> Result<banda_fence::Probe, String> {
    let sealed = base.seal().map_err(|error| error.to_string())?;
    let mut command = std::process::Command::new(launcher);
    command.args([
        "fence",
        "--probe",
        "--spec-fd",
        &sealed.number().to_string(),
    ]);
    banda_fence::attach(&mut command, sealed, None);
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(PROBED_WITHIN, command.output())
        .await
        .map_err(|_| "the probe did not end in time".to_owned())?
        .map_err(|error| format!("the probe did not start: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or_default();
    serde_json::from_str(line).map_err(|_| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        format!("the probe said nothing of the fence: {}", stderr.trim())
    })
}

/// Whether AppArmor keeps namespaces from apps it has no profile for, as
/// Ubuntu's does from 24.04 on.
#[cfg(target_os = "linux")]
fn apparmor_restricts() -> bool {
    let path = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
    std::fs::read_to_string(path).is_ok_and(|said| said.trim() == "1")
}

/// Whether this user is in the `docker` group, whose members run
/// containers as root through Docker's socket: this process is, or the
/// group lists the user, who is in it from their next login on. The
/// group as the system's name service has it, LDAP's too.
#[cfg(target_os = "linux")]
fn in_docker_group() -> bool {
    use nix::unistd::{Group, User, getgroups, getuid};
    let Ok(Some(docker)) = Group::from_name("docker") else {
        return false;
    };
    let now = getgroups().is_ok_and(|groups| groups.contains(&docker.gid));
    let listed = || {
        User::from_uid(getuid())
            .ok()
            .flatten()
            .is_some_and(|me| me.gid == docker.gid || docker.mem.contains(&me.name))
    };
    now || listed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn a_harness_s_holes_are_made_with_its_folder() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        let base = banda_fence::Spec {
            build: "b".to_owned(),
            ..banda_fence::Spec::default()
        };
        let sessions = home.join("data/projects/p/claude");
        let holes = Holes {
            writes: vec![sessions.clone()],
            ..Holes::default()
        };
        let mut program = Program::harness("claude", Vec::new(), holes.clone());
        program.cwd = Some(home.clone());
        let fenced = Local::fenced(base.clone(), holds());
        let spec = fenced.spec(&base, &program, &holes).unwrap();
        assert_eq!(spec.holes.writes, std::slice::from_ref(&sessions));
        assert!(sessions.is_dir());
        assert_eq!(spec.cwd.as_deref(), Some(home.as_path()));
    }

    /// The SSH agent goes only to a program whose holes give it, as a
    /// Harness's in a Project whose trust the Person said (ADR 0083,
    /// F0-3): any other gets no hole for its socket, no `SSH_AUTH_SOCK`,
    /// and every agent's socket in sight hidden.
    #[cfg(target_os = "linux")]
    #[test]
    fn only_a_program_given_the_ssh_agent_reaches_its_socket() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        let socket = home.join("agent.sock");
        let elsewhere = home.join(".1password/agent.sock");
        let base = banda_fence::Spec {
            build: "b".to_owned(),
            ..banda_fence::Spec::default()
        };
        let given = Holes {
            ssh_agent: true,
            ..Holes::default()
        };
        // (holes made, variable unset, hidden, hidden by the start of a name)
        let reaches = |agents: &SshAgents, holes: &Holes| {
            let fenced = Local::fenced(base.clone(), holds())
                .ssh_agents(agents.clone())
                .launcher("/opt/banda");
            let program = Program::harness("claude", Vec::new(), holes.clone());
            let (command, _hears) = fenced
                .launching(&base, &program, holes, Input::Null)
                .unwrap();
            let unset = (command.as_std().get_envs())
                .any(|(name, value)| name == SSH_AGENT && value.is_none());
            let spec = fenced.spec(&base, &program, holes).unwrap();
            (
                spec.holes.writes,
                unset,
                spec.hidden_if_there,
                spec.hidden_starting,
            )
        };
        let starting = vec![PathBuf::from("/tmp/ssh-")];

        // In a folder the fence hides: a hole, while the socket is there.
        let hidden = SshAgents {
            hole: Some(socket.clone()),
            in_sight: vec![elsewhere.clone()],
            starting: starting.clone(),
            ..SshAgents::default()
        };
        assert_eq!(reaches(&hidden, &given), (vec![], true, vec![], vec![]));
        let _listening = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert_eq!(
            reaches(&hidden, &given),
            (vec![socket.clone()], false, vec![], vec![])
        );
        assert_eq!(
            reaches(&hidden, &Holes::default()),
            (vec![], true, vec![elsewhere.clone()], starting.clone()),
            "not given"
        );

        // In sight: no hole, the variable kept where it is given, the socket
        // hidden where it is not.
        let in_sight = SshAgents {
            named_in_sight: true,
            in_sight: vec![socket.clone(), elsewhere.clone()],
            starting: starting.clone(),
            ..SshAgents::default()
        };
        assert_eq!(reaches(&in_sight, &given), (vec![], false, vec![], vec![]));
        assert_eq!(
            reaches(&in_sight, &Holes::default()),
            (vec![], true, vec![socket, elsewhere], starting),
            "not given"
        );
    }

    #[cfg(target_os = "linux")]
    fn holds() -> Fence {
        Fence::holds(vec![FenceLayer::Namespaces, FenceLayer::Landlock], false)
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_harness_s_program_starts_through_the_launcher_with_its_spec_and_status_pipe() {
        let base = banda_fence::Spec {
            build: "b".to_owned(),
            ..banda_fence::Spec::default()
        };
        let fenced = Local::fenced(base.clone(), holds()).launcher("/opt/banda");
        let mut program = Program::harness("claude", vec!["--acp".to_owned()], Default::default());
        program.env.insert("ADDED".to_owned(), "1".to_owned());
        let (command, _hears) = fenced
            .launching(&base, &program, &Default::default(), Input::Piped)
            .unwrap();
        let command = command.as_std();
        assert_eq!(command.get_program(), "/opt/banda");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        assert_eq!(args[..2], ["fence", "--spec-fd"]);
        assert_eq!(args[3], "--status-fd");
        assert_eq!(args[5..], ["--", "claude", "--acp"]);
        let envs: Vec<_> = command.get_envs().collect();
        assert!(envs.contains(&("ADDED".as_ref(), Some("1".as_ref()))));
        for name in ENGINES_OWN {
            assert!(envs.contains(&(name.as_ref(), None)), "{name} taken away");
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn only_a_harness_s_programs_go_through_the_launcher() {
        // A launcher that is not there: what goes through it never starts.
        let fenced = Local::fenced(banda_fence::Spec::default(), holds()).launcher("/nonexistent");
        let script = |program: fn(String, Vec<String>) -> Program| {
            program(
                "sh".to_owned(),
                vec!["-c".to_owned(), "echo ran".to_owned()],
            )
        };
        let harness = |name, args| Program::harness(name, args, Default::default());
        let probe = |name, args| Program::harness_probe(name, args);
        for program in [script(harness), script(probe)] {
            let started = fenced.spawn(&program, Input::Null);
            assert!(started.is_err(), "{:?}", program.whose());
        }
        let act = fenced.spawn(&script(Program::act), Input::Null);
        let output = act.unwrap().wait_with_output().await.unwrap();
        assert_eq!(
            output.stdout, b"ran\n",
            "a git act starts as Local starts it"
        );
        // Where the fence does not hold, a Harness's does too.
        let unfenced = Local::unfenced(Fence::not_built()).launcher("/nonexistent");
        let started = unfenced.spawn(&script(harness), Input::Null).unwrap();
        assert_eq!(started.wait_with_output().await.unwrap().stdout, b"ran\n");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_engine_s_own_bookkeeping_starts_through_the_launcher_in_its_folder() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        let (data, project) = (home.join("data"), home.join("project"));
        let shadow = data.join("p/git-fetched");
        std::fs::create_dir_all(&shadow).unwrap();
        std::fs::create_dir(&project).unwrap();
        let base = banda_fence::Spec {
            build: "b".to_owned(),
            hidden: vec![data.clone()],
            read_only: vec![home.join("config")],
            ..banda_fence::Spec::default()
        };
        let agent = home.join("agent.sock");
        let agents = SshAgents {
            hole: Some(agent.clone()),
            ..SshAgents::default()
        };
        let fenced = Local::fenced(base.clone(), holds())
            .ssh_agents(agents)
            .launcher("/opt/banda");
        let mut git = tokio::process::Command::new("/usr/bin/git");
        git.arg("status")
            .env("GIT_CONFIG_COUNT", "1")
            .env_remove("GIT_DIR")
            .current_dir(&project);
        let books = fenced.books().unwrap();
        let started = books(&git, std::slice::from_ref(&shadow)).unwrap();
        let started = started.as_std();
        assert_eq!(started.get_program(), "/opt/banda");
        let args: Vec<_> = started.get_args().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(args[..2], ["fence", "--spec-fd"]);
        assert_eq!(args[3..], ["--", "/usr/bin/git", "status"]);
        let envs: Vec<_> = started.get_envs().collect();
        assert!(envs.contains(&("GIT_CONFIG_COUNT".as_ref(), Some("1".as_ref()))));
        assert!(envs.contains(&("GIT_DIR".as_ref(), None)));
        for name in ENGINES_OWN {
            assert!(envs.contains(&(name.as_ref(), None)), "{name} taken away");
        }
        let spec = || {
            Fenced::books_spec(
                &base,
                Some(&agent),
                git.as_std(),
                std::slice::from_ref(&shadow),
            )
            .unwrap()
        };
        assert_eq!(spec().cwd.as_deref(), Some(project.as_path()));
        assert_eq!(spec().holes.reads, std::slice::from_ref(&shadow));
        assert!(spec().holes.writes.is_empty(), "a socket gone is no hole");
        // The SSH agent's socket, while it is there: its fetch signs as
        // Banda's own git did on the host.
        let _listening = std::os::unix::net::UnixListener::bind(&agent).unwrap();
        assert_eq!(spec().holes.writes, std::slice::from_ref(&agent));
        // Where the fence does not hold, there is no fence to start behind.
        assert!(Local::unfenced(Fence::not_built()).books().is_none());
        assert_eq!(fenced.kept(), [home.join("config")]);
        assert!(Local::unfenced(Fence::not_built()).kept().is_empty());
    }

    #[test]
    fn where_the_fence_does_not_hold_programs_start_as_local_starts_them() {
        let fence = Fence::missing(banda_kernel::FenceWhy::NoUserNamespaces, "no");
        let fenced = Local::fenced(banda_fence::Spec::default(), fence.clone());
        assert!(fenced.base.is_none());
        assert_eq!(fenced.fence(), fence);
        assert_eq!(Local.fence(), Fence::not_built());
    }
}
