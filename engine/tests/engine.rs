//! The `banda` program as a window and a script use it: `serve` with a
//! parent, then `call` and `follow` over the API; and `banda mcp` as a
//! Harness starts it for an Agent. The Harness is the fake agent from
//! `tools/fake-agent`.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Builds the fake agent, next to this test's own binary.
fn fake_agent() -> PathBuf {
    let status = Command::new(env!("CARGO"))
        .args(["build", "-q", "-p", "banda-fake-agent"])
        .status()
        .expect("cargo runs");
    assert!(status.success(), "the fake agent builds");
    let deps = std::env::current_exe().unwrap();
    let profile = deps.parent().and_then(Path::parent).unwrap();
    profile.join("banda-fake-agent")
}

/// Temporary places for one engine, with the fake agent as its only
/// Harness. The fake agent writes the MCP servers of its last new session
/// in `mcp`.
struct Places {
    _dir: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    config: PathBuf,
    mcp: PathBuf,
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
        let mcp = dir.path().join("mcp.json");
        let list = format!(
            "[[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = {:?}\nenv = {{ FAKE_AGENT_MCP = {:?} }}\n",
            fake_agent().display().to_string(),
            mcp.display().to_string(),
        );
        std::fs::write(config.join("harnesses.toml"), list).unwrap();
        Places {
            _dir: dir,
            root,
            state,
            config,
            mcp,
        }
    }

    fn banda(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_banda"));
        command
            .args(args)
            .env("BANDA_ROOT", &self.root)
            .env("BANDA_DATA", self._dir.path().join("data"))
            .env("BANDA_STATE", &self.state)
            .env("BANDA_CONFIG", &self.config)
            .env("BANDA_LOG", "warn");
        command
    }

    /// Starts `banda serve --with-parent` and reads the line that says
    /// where it listens.
    fn serve(&self) -> (Child, ChildStdin, Value) {
        let mut engine = self
            .banda(&["serve", "--with-parent"])
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
        self.banda(&args).output().unwrap()
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

    let second = places.banda(&["serve"]).output().unwrap();
    assert_eq!(second.status.code(), Some(2), "{second:?}");
    assert!(second.stdout.is_empty(), "the secret stays off a terminal");
    assert!(String::from_utf8_lossy(&second.stderr).contains("already runs"));

    let space = places.ok("spaces.create", None, json!({ "name": "Work" }));
    let space = text(&space["id"]);

    let refused = places.call("agents.thread", Some(space), json!({}));
    assert_eq!(refusal(&refused), "invalid");
    let nowhere = places
        .banda(&["follow", "--space", &uuid::Uuid::now_v7().to_string()])
        .output()
        .unwrap();
    assert_eq!(refusal(&nowhere), "not_found");

    let mut follow = places
        .banda(&["follow", "--space", space, "--module", "agents"])
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
        json!({ "harness": "fake", "text": "hello" }),
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
            "thread.started",
            "message.posted",
            "turn.started",
            "thread.offered",
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
        .banda(&["call", "spaces.list", "--params", "{not json"])
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
    let Some(status) = wait_for(Duration::from_secs(5), || engine.try_wait().unwrap()) else {
        engine.kill().unwrap();
        panic!("the engine did not stop within five seconds");
    };
    assert!(status.success(), "{status:?}");
    assert!(!places.state.join("engine.json").exists());
}

/// `banda mcp` as a Harness runs it: the command, arguments and
/// environment a session was given.
struct Mcp {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Mcp {
    fn start(server: &Value) -> Mcp {
        assert_eq!(server["name"], "banda");
        assert_eq!(server["args"], json!(["mcp"]));
        let mut command = Command::new(text(&server["command"]));
        command.args(["mcp"]).env("BANDA_LOG", "warn");
        for variable in server["env"].as_array().unwrap() {
            command.env(text(&variable["name"]), text(&variable["value"]));
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let (stdin, stdout) = (child.stdin.take().unwrap(), child.stdout.take().unwrap());
        Mcp {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        }
    }

    fn tell(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
    }

    /// Sends a request and reads its answer, which must carry its ID.
    fn ask(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.tell(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let answer: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(answer["id"], id, "{answer}");
        answer
    }

    /// Calls a tool: whether it was an error, and its text.
    fn call(&mut self, id: u64, tool: &str, arguments: Value) -> (bool, String) {
        let params = json!({ "name": tool, "arguments": arguments });
        let result = self.ask(id, "tools/call", params)["result"].clone();
        let said = text(&result["content"][0]["text"]).to_owned();
        (result["isError"].as_bool().unwrap(), said)
    }

    fn end(mut self) {
        drop(self.stdin);
        assert!(self.child.wait().unwrap().success());
    }
}

#[test]
fn an_agent_reaches_banda_through_banda_mcp() {
    let places = Places::new();
    let (mut engine, stdin, _) = places.serve();
    let work = places.ok("spaces.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]);
    let sent = places.ok(
        "agents.send",
        Some(work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let thread = text(&sent["thread"]);

    // The session the agents module opened for the Thread got it.
    let servers = wait_for(Duration::from_secs(30), || {
        let bytes = std::fs::read(&places.mcp).ok()?;
        Some(serde_json::from_slice::<Value>(&bytes).unwrap())
    })
    .expect("the session got its MCP servers");
    let server = &servers[0];
    let variables = server["env"].as_array().unwrap();
    let names: Vec<_> = variables.iter().map(|v| text(&v["name"])).collect();
    assert_eq!(names, ["BANDA_ENGINE", "BANDA_TOKEN"]);
    assert_eq!(text(&variables[1]["value"]).len(), 64);

    let mut mcp = Mcp::start(server);
    let hello = json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } });
    let welcome = mcp.ask(1, "initialize", hello)["result"].clone();
    assert_eq!(welcome["protocolVersion"], "2025-06-18");
    assert_eq!(welcome["serverInfo"]["name"], "banda");
    assert!(text(&welcome["instructions"]).contains("the `skill` tool"));
    // A notification gets no answer: the next line answers the ping.
    mcp.tell(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    assert_eq!(mcp.ask(2, "ping", json!({}))["result"], json!({}));

    let tools = mcp.ask(3, "tools/list", json!({}))["result"]["tools"].clone();
    let names: Vec<_> = tools
        .as_array()
        .unwrap()
        .iter()
        .map(|t| text(&t["name"]))
        .collect();
    let arranging = ["panes", "open_pane", "move_pane", "close_pane"];
    assert_eq!(
        names,
        [&["threads", "read", "send"][..], &arranging, &["skill"]].concat()
    );
    assert_eq!(tools[1]["inputSchema"]["required"], json!(["thread"]));

    let (error, threads) = mcp.call(4, "threads", json!({}));
    assert!(!error, "{threads}");
    let threads: Value = serde_json::from_str(&threads).unwrap();
    assert_eq!(threads["threads"][0]["id"], thread);
    let (error, read) = mcp.call(5, "read", json!({ "thread": thread }));
    assert!(!error, "{read}");
    assert_eq!(
        serde_json::from_str::<Value>(&read).unwrap()["thread"]["id"],
        thread
    );

    let nowhere = uuid::Uuid::now_v7().to_string();
    let (error, said) = mcp.call(6, "read", json!({ "thread": nowhere }));
    assert!(error);
    assert!(
        said.contains("There is no such Thread. Nothing was done."),
        "{said}"
    );
    let (error, said) = mcp.call(7, "read", json!({ "thread": "nope" }));
    assert!(error && said.contains("do not fit"), "{said}");
    let (error, said) = mcp.call(8, "send", json!({ "thread": thread, "text": "hi" }));
    assert!(error && said.contains("your own Thread"), "{said}");
    let (error, said) = mcp.call(11, "send", json!({ "harness": "fake", "text": "hi" }));
    assert!(!error, "{said}");
    let started = serde_json::from_str::<Value>(&said).unwrap()["thread"].clone();
    assert_ne!(started, thread);

    // It puts its Thread on the screen, in its Space, without the focus.
    let shown = json!({ "kind": "agents.thread", "args": { "thread": thread } });
    let (error, said) = mcp.call(12, "open_pane", shown);
    assert!(!error, "{said}");
    let (error, said) = mcp.call(13, "panes", json!({}));
    assert!(!error, "{said}");
    let seen: Value = serde_json::from_str(&said).unwrap();
    let pane = &seen[0]["columns"][0]["panes"][0];
    assert_eq!(
        (pane["space"].clone(), pane["yours"].clone()),
        (json!(work), json!(true))
    );
    let (error, said) = mcp.call(
        14,
        "open_pane",
        json!({ "kind": "terminal.terminal", "args": {} }),
    );
    assert!(
        error && said.contains("run nothing as your Person"),
        "{said}"
    );

    let (error, said) = mcp.call(9, "skill", json!({ "topic": "sidebar" }));
    assert!(!error);
    assert!(said.contains("sidebar.toml"), "{said}");
    let unknown = mcp.ask(10, "resources/list", json!({}));
    assert_eq!(unknown["error"]["code"], -32601);
    mcp.end();

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

/// What `found` finds, asked every ten milliseconds until `within` passes.
fn wait_for<T>(within: Duration, mut found: impl FnMut() -> Option<T>) -> Option<T> {
    let until = std::time::Instant::now() + within;
    while std::time::Instant::now() < until {
        if let Some(found) = found() {
            return Some(found);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}
