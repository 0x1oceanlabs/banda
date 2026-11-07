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
    command.args(banda_fence::argv(&sealed, "sh", &args));
    banda_fence::attach(&mut command, sealed);
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
