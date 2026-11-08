//! The `local` environment with the fence (ADR 0083, decision 1): a
//! Harness's programs, and its CLI asked about itself, start behind
//! `banda fence` where the fence holds, each with its Project's holes in
//! it; the Person's own, a terminal and a git act, start as [`Local`]
//! starts them. Where the fence does not hold, every program starts so,
//! and the environment says why ([`Environment::fence`]).
//!
//! The engine finds whether the fence holds once, as it starts, from the
//! probe over its own base ([`probe`]), and says so in its `welcome`.

use crate::local::Local;
use banda_kernel::{Environment, Fence, Input, Program, Pty, PtySize, Started};
#[cfg(target_os = "linux")]
use banda_kernel::{FenceLayer, FenceWhy};
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
    fence: Fence,
    /// The `banda` that is the launcher: the engine's own running program.
    launcher: PathBuf,
}

impl Local {
    /// `Local`, with each Harness's program behind the fence `base`
    /// describes, where the probe found that it holds (`fence`); where it
    /// does not, every program starts as `Local` starts it.
    pub fn fenced(base: banda_fence::Spec, fence: Fence) -> Fenced {
        let holds = cfg!(target_os = "linux") && matches!(fence, Fence::Holds { .. });
        Fenced {
            base: holds.then(|| Arc::new(base)),
            fence,
            launcher: launcher(),
        }
    }

    /// `Local`, which says why there is no fence here: none on this
    /// system yet, or a debug build's `BANDA_FENCE=off`.
    pub fn unfenced(fence: Fence) -> Fenced {
        Fenced {
            base: None,
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

    /// The spec a program with `holes` starts behind: the base, with those
    /// holes (each made where it is not there yet, as a folder of the
    /// Person's alone) and the base's own holes that are there now, and the
    /// program's folder.
    #[cfg(target_os = "linux")]
    fn spec(
        base: &banda_fence::Spec,
        program: &Program,
        holes: &banda_kernel::Holes,
    ) -> io::Result<banda_fence::Spec> {
        let mut spec = base.clone();
        // A socket of the base's, as the SSH agent's, may be gone since.
        spec.holes.writes.retain(|hole| hole.exists());
        spec.holes.reads.retain(|hole| hole.exists());
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
        Ok(spec)
    }

    /// The launcher, set to start `program` behind the fence, and the end
    /// of the pipe it says on whether the program started. It starts as
    /// [`Local`] starts a program, without the engine's own folders
    /// ([`ENGINES_OWN`]).
    #[cfg(target_os = "linux")]
    fn launching(
        &self,
        base: &banda_fence::Spec,
        program: &Program,
        holes: &banda_kernel::Holes,
        input: Input,
    ) -> io::Result<(tokio::process::Command, banda_fence::Hears)> {
        use std::process::Stdio;
        let sealed = Fenced::spec(base, program, holes)?.seal()?;
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
        holes: &banda_kernel::Holes,
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
        Ok(banda_fence::Probe::Holds { layers }) => Fence::Holds {
            layers: (layers.into_iter())
                .map(|layer| match layer {
                    banda_fence::Layer::Namespaces => FenceLayer::Namespaces,
                    banda_fence::Layer::Landlock => FenceLayer::Landlock,
                })
                .collect(),
            docker_group: in_docker_group(),
        },
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
    fn a_harness_s_holes_are_made_and_the_base_s_gone_ones_left_out() {
        let t = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(t.path()).unwrap();
        let socket = home.join("agent.sock");
        let base = banda_fence::Spec {
            build: "b".to_owned(),
            holes: banda_fence::Holes {
                writes: vec![socket.clone()],
                ..banda_fence::Holes::default()
            },
            ..banda_fence::Spec::default()
        };
        let sessions = home.join("data/projects/p/claude");
        let holes = banda_kernel::Holes {
            writes: vec![sessions.clone()],
            reads: Vec::new(),
        };
        let mut program = Program::harness("claude", Vec::new(), holes.clone());
        program.cwd = Some(home.clone());
        let spec = Fenced::spec(&base, &program, &holes).unwrap();
        assert_eq!(spec.holes.writes, std::slice::from_ref(&sessions));
        assert!(sessions.is_dir());
        assert_eq!(spec.cwd.as_deref(), Some(home.as_path()));

        std::fs::write(&socket, "").unwrap();
        let spec = Fenced::spec(&base, &program, &holes).unwrap();
        assert_eq!(spec.holes.writes, [socket, sessions]);
    }

    #[cfg(target_os = "linux")]
    fn holds() -> Fence {
        Fence::Holds {
            layers: vec![FenceLayer::Namespaces, FenceLayer::Landlock],
            docker_group: false,
        }
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

    #[test]
    fn where_the_fence_does_not_hold_programs_start_as_local_starts_them() {
        let fence = Fence::missing(banda_kernel::FenceWhy::NoUserNamespaces, "no");
        let fenced = Local::fenced(banda_fence::Spec::default(), fence.clone());
        assert!(fenced.base.is_none());
        assert_eq!(fenced.fence(), fence);
        assert_eq!(Local.fence(), Fence::not_built());
    }
}
