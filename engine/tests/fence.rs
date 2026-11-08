//! `banda fence` as an environment starts it: this program, with the spec
//! on a sealed memfd, and its probe. Every place it hides or reads is under
//! the test's own home. Where the system refuses the fence (a container's
//! seccomp, say), the tests that need it skip, saying why; with
//! `BANDA_FENCE_TESTS=require`, as `scripts/check.sh` sets outside CI, or
//! `all`, as CI's `fence` part sets, they fail instead.
#![cfg(target_os = "linux")]

use banda_fence::{Layer, Probe, Spec, Why};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::OnceLock;

/// `banda` with nothing of the Person's: its home, its config, state and
/// data, the session's runtime folder and tmux's all under `home`.
fn banda(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_banda"));
    command
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home.join(".config"))
        .env("XDG_STATE_HOME", home.join(".local/state"))
        .env("XDG_DATA_HOME", home.join(".local/share"))
        .env("XDG_CACHE_HOME", home.join(".cache"))
        .env("XDG_RUNTIME_DIR", home.join("run"))
        .env("TMUX_TMPDIR", home.join("tmp"));
    command
}

/// A home for [`banda`], with its runtime folder there as a session's is.
fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    for folder in ["run", "tmp"] {
        std::fs::create_dir(home.path().join(folder)).unwrap();
    }
    home
}

/// This `banda`'s build id, as `--version` says it.
fn own_build() -> String {
    let said = banda(Path::new("/nonexistent"))
        .arg("--version")
        .output()
        .unwrap();
    let said = String::from_utf8(said.stdout).unwrap();
    let (_, build) = said.trim_end().split_once("(build ").expect("a build id");
    build.trim_end_matches(')').to_owned()
}

/// `banda fence --probe` over this `banda`'s own folders under `home`.
fn probe(home: &Path) -> (Probe, Output) {
    let said = banda(home).args(["fence", "--probe"]).output().unwrap();
    let stdout = String::from_utf8(said.stdout.clone()).unwrap();
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 1, "one JSON line: {stdout:?}");
    (serde_json::from_str(lines[0]).unwrap(), said)
}

/// What `BANDA_FENCE_TESTS` asks: `require` or `all`, or anything else.
fn asked() -> String {
    std::env::var("BANDA_FENCE_TESTS").unwrap_or_default()
}

/// Whether a test that cannot run here fails, rather than skips.
fn required() -> bool {
    matches!(asked().as_str(), "require" | "all")
}

/// Why the fence cannot hold on this system, if the system refuses it: the
/// probe's words, once. A probe that fails for another reason is no reason
/// to skip.
fn cannot_hold() -> Option<&'static str> {
    static FOUND: OnceLock<Option<String>> = OnceLock::new();
    let found = FOUND.get_or_init(|| {
        let home = home();
        match probe(home.path()).0 {
            Probe::Missing {
                why: Why::NoUserNamespaces | Why::Refused,
                words,
            } => Some(words),
            _ => None,
        }
    });
    if let Some(why) = found.as_deref().filter(|_| required()) {
        panic!(
            "the fence cannot hold here: {why} (BANDA_FENCE_TESTS={}; set \
             BANDA_FENCE_TESTS=skip to run without)",
            asked()
        );
    }
    found.as_deref()
}

/// Skips the test, saying why on stderr past the test's capture, where the
/// fence cannot hold here.
macro_rules! needs_the_fence {
    () => {
        if let Some(why) = cannot_hold() {
            let _ = writeln!(
                std::io::stderr(),
                "SKIPPED: the fence cannot hold on this system: {why}"
            );
            return;
        }
    };
}

/// Runs `sh -c script` through `banda fence` behind `spec`.
fn fenced(home: &Path, spec: &Spec, script: &str) -> Output {
    let sealed = spec.seal().unwrap();
    let mut command = banda(home);
    let args = ["-c".to_owned(), script.to_owned()];
    command.args(banda_fence::argv(&sealed, None, "sh", &args));
    banda_fence::attach(&mut command, sealed, None);
    command.output().unwrap()
}

#[test]
fn the_probe_says_in_one_line_whether_the_fence_holds_over_this_bandas_folders() {
    let home = home();
    let (found, said) = probe(home.path());
    assert!(said.status.success(), "{said:?}");
    if let Some(why) = cannot_hold() {
        let _ = writeln!(std::io::stderr(), "SKIPPED the rest: {why}");
        assert!(matches!(found, Probe::Missing { .. }), "{found:?}");
        return;
    }
    let Probe::Holds { layers } = found else {
        panic!("the fence does not hold: {found:?}");
    };
    assert!(layers.contains(&Layer::Namespaces), "{layers:?}");
    // It made each Banda's folders it hides, so it covered them.
    for folder in ["banda", "banda-dev", "banda-local"] {
        for under in [".local/state", ".local/share"] {
            assert!(
                home.path().join(under).join(folder).is_dir(),
                "{under}/{folder}"
            );
        }
    }
}

#[test]
fn a_program_behind_the_fence_finds_a_hidden_folder_empty_and_has_stdout_alone() {
    needs_the_fence!();
    let home = home();
    let (secret, config) = (home.path().join("secret"), home.path().join("config"));
    for folder in [&secret, &config] {
        std::fs::create_dir(folder).unwrap();
        std::fs::write(folder.join("a"), "a").unwrap();
    }
    let spec = Spec {
        build: own_build(),
        hidden: vec![secret.clone()],
        read_only: vec![config.clone()],
        ..Spec::default()
    };
    let script = format!(
        "ls -A {secret}; cat {config}/a; echo; echo b > {config}/a || echo refused",
        secret = secret.display(),
        config = config.display()
    );
    let said = fenced(home.path(), &spec, &script);
    assert!(said.status.success(), "{said:?}");
    assert_eq!(String::from_utf8_lossy(&said.stdout), "a\nrefused\n");
    assert_eq!(std::fs::read_to_string(config.join("a")).unwrap(), "a");
}

#[test]
fn a_spec_of_another_build_runs_nothing() {
    let home = home();
    let spec = Spec {
        build: "another".to_owned(),
        ..Spec::default()
    };
    let said = fenced(home.path(), &spec, "echo ran");
    assert_eq!(said.status.code(), Some(125));
    assert!(said.stdout.is_empty(), "{said:?}");
    let stderr = String::from_utf8_lossy(&said.stderr);
    assert!(stderr.contains("another build"), "{stderr}");
}

#[test]
fn no_spec_runs_nothing() {
    let home = home();
    let said = banda(home.path())
        .args(["fence", "--", "sh", "-c", "echo ran"])
        .output()
        .unwrap();
    assert_eq!(said.status.code(), Some(125));
    assert!(said.stdout.is_empty(), "{said:?}");
}

/// The engine's environment starts a Harness's program behind the fence,
/// with its holes, and a git act the Person asked for outside it, where
/// the probe over the base finds that the fence holds (ADR 0083).
#[tokio::test]
async fn a_harness_s_program_starts_behind_the_fence_and_a_person_s_act_does_not() {
    use banda_kernel::{Environment, Fence, Holes, Input, Program};
    needs_the_fence!();
    let home = home();
    let secret = home.path().join("secret");
    std::fs::create_dir(&secret).unwrap();
    std::fs::write(secret.join("a"), "a").unwrap();
    let base = Spec {
        build: own_build(),
        hidden: vec![dunce::canonicalize(&secret).unwrap()],
        ..Spec::default()
    };
    let banda = Path::new(env!("CARGO_BIN_EXE_banda"));
    let fence = banda_environments::probe(&base, banda).await;
    assert!(matches!(fence, Fence::Holds { .. }), "{fence:?}");
    let environment = banda_environments::Local::fenced(base, fence).launcher(banda);

    let listed = format!("ls -A {}", secret.display());
    let holes = Holes {
        writes: vec![secret.join("sessions")],
        ..Holes::default()
    };
    let harness_s = Program::harness("sh", vec!["-c".to_owned(), listed.clone()], holes);
    let child = environment.spawn(&harness_s, Input::Null).unwrap();
    let output = child.wait_with_output().await.unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "sessions\n",
        "the hidden folder, but for its hole"
    );

    let act = Program::act("sh", vec!["-c".to_owned(), listed]);
    let child = environment.spawn(&act, Input::Null).unwrap();
    let output = child.wait_with_output().await.unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stdout), "a\nsessions\n");

    // A program that is not there: the launcher says so as it starts.
    let missing = Program::harness("/no/such/harness", Vec::new(), Holes::default());
    let refused = environment.spawn(&missing, Input::Null).unwrap_err();
    assert!(refused.to_string().contains("could not start"), "{refused}");
}

/// The SSH agent goes with trust (ADR 0083, F0-3): an agent's socket in
/// sight, as 1Password's in the home or ssh-agent's in its folder in
/// `/tmp`, is hidden from a Harness's program not given the agent, and
/// left where it is for one given it.
#[tokio::test]
async fn an_ssh_agent_s_socket_in_sight_is_hidden_from_a_program_not_given_the_agent() {
    use banda_kernel::{Environment, Fence, Holes, Input, Program};
    use std::os::unix::net::UnixListener;
    needs_the_fence!();
    let home = home();
    let at = dunce::canonicalize(home.path()).unwrap();
    let socket = at.join(".1password/agent.sock");
    let classic = at.join("tmp/ssh-x/agent.1");
    for one in [&socket, &classic] {
        std::fs::create_dir_all(one.parent().unwrap()).unwrap();
    }
    let _listening = [UnixListener::bind(&socket), UnixListener::bind(&classic)];
    let base = Spec {
        build: own_build(),
        ..Spec::default()
    };
    let banda = Path::new(env!("CARGO_BIN_EXE_banda"));
    let fence = banda_environments::probe(&base, banda).await;
    assert!(matches!(fence, Fence::Holds { .. }), "{fence:?}");
    let agents = banda_environments::SshAgents {
        named_in_sight: true,
        in_sight: vec![socket.clone()],
        starting: vec![at.join("tmp/ssh-")],
        ..Default::default()
    };
    let environment = banda_environments::Local::fenced(base, fence)
        .ssh_agents(agents)
        .launcher(banda);
    let script = format!(
        "for s in {} {}; do test -S $s && echo reached || echo hidden; done",
        socket.display(),
        classic.display()
    );
    let reached = async |ssh_agent: bool| {
        let holes = Holes {
            ssh_agent,
            ..Holes::default()
        };
        let program = Program::harness("sh", vec!["-c".to_owned(), script.clone()], holes);
        let child = environment.spawn(&program, Input::Null).unwrap();
        let output = child.wait_with_output().await.unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    assert_eq!(reached(true).await, "reached\nreached\n", "given the agent");
    assert_eq!(reached(false).await, "hidden\nhidden\n", "not given it");
}

/// The engine's own git, which reads what an Agent may write, starts
/// behind the fence where it holds, with only what it is to read opened to
/// it: whatever git runs then reaches no more than an Agent does (ADR
/// 0083).
#[tokio::test]
async fn the_engine_s_own_git_starts_behind_the_fence_with_what_it_reads_opened() {
    use banda_kernel::Fence;
    needs_the_fence!();
    let home = home();
    let secret = home.path().join("secret");
    let fetched = secret.join("p/git-fetched");
    std::fs::create_dir_all(&fetched).unwrap();
    std::fs::write(secret.join("token"), "t").unwrap();
    std::fs::write(fetched.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let base = Spec {
        build: own_build(),
        hidden: vec![dunce::canonicalize(&secret).unwrap()],
        ..Spec::default()
    };
    let banda = Path::new(env!("CARGO_BIN_EXE_banda"));
    let fence = banda_environments::probe(&base, banda).await;
    assert!(matches!(fence, Fence::Holds { .. }), "{fence:?}");
    let environment = banda_environments::Local::fenced(base, fence).launcher(banda);
    let books = environment.books().expect("the fence holds");

    // What a filter of the repository's would run, were it named after
    // Banda read the config.
    let project = home.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let script = format!("ls -A {}; cat {}/HEAD", secret.display(), fetched.display());
    let mut sh = tokio::process::Command::new("sh");
    sh.args(["-c", &script]).current_dir(&project);
    let output = books(&sh, std::slice::from_ref(&fetched))
        .unwrap()
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "p\nref: refs/heads/main\n",
        "the hidden folder, but for what it reads"
    );

    // Banda's own git, once the engine said so, goes through it, and
    // reads the repository as it is.
    let ran = std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&project)
        .status()
        .unwrap();
    assert!(ran.success());
    banda_kernel::host::fence_books(books);
    let mut git = banda_git_cli::bookkeeping(&project, ["status", "--porcelain=v2", "--branch"])
        .await
        .unwrap();
    assert_eq!(git.as_std().get_program(), banda.as_os_str());
    let output = git.output().await.unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("# branch.oid (initial)"));
}
