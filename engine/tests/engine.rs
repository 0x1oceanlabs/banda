//! The `bandaso` program as a window and a script use it: `serve` with a
//! parent, then `call` and `follow` over the API. The Harness is the fake
//! agent from `tools/fake-agent`.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Builds the fake agent, next to this test's own binary.
fn fake_agent() -> PathBuf {
    let status = Command::new(env!("CARGO"))
        .args(["build", "-q", "-p", "bandaso-fake-agent"])
        .status()
        .expect("cargo runs");
    assert!(status.success(), "the fake agent builds");
    let deps = std::env::current_exe().unwrap();
    let profile = deps.parent().and_then(Path::parent).unwrap();
    profile.join("bandaso-fake-agent")
}

/// Temporary places for one engine, with the fake agent as its only
/// Harness.
struct Places {
    _dir: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    config: PathBuf,
}

impl Places {
    fn new() -> Places {
        let dir = tempfile::tempdir().unwrap();
        let (root, state, config) = (
            dir.path().join("root"),
            dir.path().join("state"),
            dir.path().join("config"),
        );
        std::fs::create_dir_all(&config).unwrap();
        let list = format!(
            "[[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = {:?}\n",
            fake_agent().display().to_string()
        );
        std::fs::write(config.join("harnesses.toml"), list).unwrap();
        Places {
            _dir: dir,
            root,
            state,
            config,
        }
    }

    fn bandaso(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_bandaso"));
        command
            .args(args)
            .env("BANDASO_ROOT", &self.root)
            .env("BANDASO_STATE", &self.state)
            .env("BANDASO_CONFIG", &self.config)
            .env("BANDASO_LOG", "warn");
        command
    }

    /// Starts `bandaso serve --with-parent` and reads the line that says
    /// where it listens.
    fn serve(&self) -> (Child, ChildStdin, Value) {
        let mut engine = self
            .bandaso(&["serve", "--with-parent"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = engine.stdin.take().unwrap();
        let mut line = String::new();
        BufReader::new(engine.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        (engine, stdin, serde_json::from_str(&line).unwrap())
    }

    fn call(&self, method: &str, space: Option<&str>, params: Value) -> Output {
        let params = params.to_string();
        let mut args = vec!["call", method, "--params", &params];
        if let Some(space) = space {
            args.extend(["--space", space]);
        }
        self.bandaso(&args).output().unwrap()
    }

    /// Calls a method that must succeed, and returns what it answered.
    fn ok(&self, method: &str, space: Option<&str>, params: Value) -> Value {
        let output = self.call(method, space, params);
        assert!(output.status.success(), "{method}: {output:?}");
        let answer: Value = serde_json::from_slice(&output.stdout).unwrap();
        answer["ok"].clone()
    }
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap()
}

#[test]
fn a_script_drives_an_agent_through_the_engine_a_window_started() {
    let places = Places::new();
    let (mut engine, stdin, running) = places.serve();
    assert!(running["port"].as_u64().unwrap() > 0);
    assert_eq!(running["secret"].as_str().unwrap().len(), 64);

    let second = places.bandaso(&["serve"]).output().unwrap();
    assert_eq!(second.status.code(), Some(2), "{second:?}");
    assert!(second.stdout.is_empty(), "the secret stays off a terminal");
    assert!(String::from_utf8_lossy(&second.stderr).contains("already runs"));

    let space = places.ok("spaces.create", None, json!({ "name": "Work" }));
    let space = text(&space["id"]);
    let agent = places.ok(
        "agents.create",
        Some(space),
        json!({ "name": "Writer", "harness": "fake" }),
    );
    assert!(
        places
            .root
            .join("Work/.bandaso/agents/Writer.toml")
            .exists()
    );

    let refused = places.call("agents.thread", Some(space), json!({}));
    assert_eq!(refusal(&refused), "invalid");
    let nowhere = places
        .bandaso(&["follow", "--space", &uuid::Uuid::now_v7().to_string()])
        .output()
        .unwrap();
    assert_eq!(refusal(&nowhere), "not_found");

    let mut follow = places
        .bandaso(&["follow", "--space", space, "--module", "agents"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let (heard, events) = mpsc::channel();
    let lines = BufReader::new(follow.stdout.take().unwrap());
    std::thread::spawn(move || {
        for line in lines.lines().map_while(Result::ok) {
            let _ = heard.send(serde_json::from_str::<Value>(&line).unwrap());
        }
    });

    let sent = places.ok(
        "agents.send",
        Some(space),
        json!({ "agent": agent["id"], "text": "hello" }),
    );
    let mut kinds = Vec::new();
    while kinds.last().map(String::as_str) != Some("turn.ended") {
        let event = events
            .recv_timeout(Duration::from_secs(30))
            .expect("the turn ends");
        kinds.push(text(&event["kind"]).to_owned());
    }
    follow.kill().unwrap();
    follow.wait().unwrap();
    assert_eq!(
        kinds,
        [
            "agent.created",
            "thread.started",
            "message.posted",
            "turn.started",
            "thought.grew",
            "reply.grew",
            "turn.ended",
        ]
    );

    let view = places.ok(
        "agents.thread",
        Some(space),
        json!({ "thread": sent["thread"] }),
    );
    let last = view["items"].as_array().unwrap().last().unwrap();
    assert_eq!(last["body"]["text"], "You said: hello");

    let file = places.state.join("engine.json");
    let real = std::fs::read_to_string(&file).unwrap();
    std::fs::write(
        &file,
        real.replace(text(&running["secret"]), &"0".repeat(64)),
    )
    .unwrap();
    let stranger = places.call("spaces.list", None, json!({}));
    assert_eq!(refusal(&stranger), "forbidden", "a wrong secret is refused");
    std::fs::write(&file, real).unwrap();

    // The window closes: the engine stops and says it no longer runs.
    drop(stdin);
    assert!(engine.wait().unwrap().success());
    assert!(!places.state.join("engine.json").exists());
    let gone = places.call("spaces.list", None, json!({}));
    assert_eq!(gone.status.code(), Some(2), "{gone:?}");
}

/// The code of a refusal the CLI printed, which exits 1.
fn refusal(output: &Output) -> String {
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let answer: Value = serde_json::from_slice(&output.stdout).unwrap();
    text(&answer["error"]["code"]).to_owned()
}

#[test]
fn bad_params_are_refused_before_the_engine_is_reached() {
    let places = Places::new();
    let output = places
        .bandaso(&["call", "spaces.list", "--params", "{not json"])
        .output()
        .unwrap();
    assert_eq!(refusal(&output), "invalid");
}

#[cfg(unix)]
#[test]
fn an_engine_with_a_parent_still_stops_on_sigterm() {
    let places = Places::new();
    let (mut engine, _stdin, _) = places.serve();
    let sent = Command::new("kill")
        .arg(engine.id().to_string())
        .status()
        .unwrap();
    assert!(sent.success());
    for _ in 0..500 {
        if let Some(status) = engine.try_wait().unwrap() {
            assert!(status.success(), "{status:?}");
            assert!(!places.state.join("engine.json").exists());
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    engine.kill().unwrap();
    panic!("the engine did not stop within five seconds");
}
